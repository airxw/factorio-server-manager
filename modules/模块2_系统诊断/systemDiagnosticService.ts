// ============================================================================
// systemDiagnosticService.ts — 模块2_系统诊断：静态规则诊断 + 白名单脚本修复
//
// 契约对齐：
//   - @public/interface_stub/system-diagnostic-service.d.ts (SystemDiagnosticService, @version 1.0.0)
//   - @public/interface_stub/shared-types.d.ts
//       (DiagnosticProblem, DiagnosticsResult, ApplyFixResponse)
//   - @public/schema/error-codes-schema.json (SYSTEM_FIX_001, http_status=404)
//   - @public/config_template/panel-config.schema.json
//       (diagnostic_rules_path, diagnostic_fixes_path)
//
// 实现要点（模块专属约束）：
//   - 诊断规则来源：rulesPath（默认 ./config/diagnostic-rules.json），运行时读取（非 import）
//   - 修复脚本白名单：fixesPath（默认 ./config/diagnostic-fixes.json）
//   - 脚本目录限制：所有修复脚本必须位于 scriptsDir 内，path.resolve 校验防路径遍历
//   - 执行方式：child_process.execFile（非 exec，避免 shell 注入），按 fix.timeout_ms 超时
//   - check_type 支持：disk_usage / file_exists / process_running / port_listening / db_connectivity
//   - 诊断结果不缓存，每次实时检查
//   - 不存在的 fixId 或脚本路径越界 → 抛 SystemFixInvalidError (404)
//
// 偏离契约说明：
//   - 契约 DiagnosticProblem 字段为 {id, severity, message, fixId}
//     而 AGENTS.md/任务书描述规则配置含 {id, title, description, severity, fixable, fix_id}
//     故本服务将 title + 动态检查结果拼入 message，fixable+fix_id 映射为 fixId（不可修复则 null）
//   - 配置 severity 使用 'error'，而契约 DiagnosticProblem.severity 枚举为 'critical'|'warning'|'info'
//     故服务将 'error' 归一化为 'critical'（配置文件保持原值不动）
//
// 约束:
//   - 禁止 import panel/backend/src/services/ 或 panel/backend/src/api/routes/ 内部实现
//   - 故 AppError + SystemFixInvalidError 在本模块 errors.ts 内提供运行时实现
// ============================================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { Knex } from 'knex';
import type {
  DiagnosticProblem,
  DiagnosticsResult,
  ApplyFixResponse,
} from '@public/interface_stub/shared-types';
import { SystemFixInvalidError } from './errors.js';

// ----------------------------------------------------------------------------
// 常量
// ----------------------------------------------------------------------------

/** 默认端口的连接探测超时（ms） */
const PORT_PROBE_TIMEOUT_MS = 2000;

/** 默认进程检查超时（ms） */
const PROCESS_PROBE_TIMEOUT_MS = 5000;

/** execFile 输出缓冲上限（字节），防止巨型输出打爆内存 */
const EXEC_MAX_BUFFER = 1024 * 1024;

// ----------------------------------------------------------------------------
// 配置类型（本模块内部，非 public 契约）
// ----------------------------------------------------------------------------

/** 诊断规则配置文件结构（config/diagnostic-rules.json） */
interface DiagnosticRuleConfig {
  rules: DiagnosticRuleDefinition[];
}

interface DiagnosticRuleDefinition {
  id: string;
  title: string;
  category?: string;
  check_type: string;
  check_params: Record<string, unknown>;
  severity: string;
  fixable: boolean;
  fix_id?: string | null;
  description?: string;
  success_message?: string;
}

/** 单个诊断检查结果（含通过和未通过） */
export interface DiagnosticCheck {
  id: string;
  title: string;
  category: string;
  status: 'pass' | 'warning' | 'error';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  fixable: boolean;
  fixId: string | null;
  description?: string;
}

/**
 * v3.8.0-D4: 诊断运行环境标记。
 * - production：生产部署（systemd 服务 / NODE_ENV=production）
 * - development：开发环境（npm run dev / tsx watch / 缺少 systemd 单元）
 */
export type DiagnosticEnvironment = 'production' | 'development';

/** 修复脚本白名单配置文件结构（config/diagnostic-fixes.json） */
interface DiagnosticFixConfig {
  fixes: DiagnosticFixDefinition[];
}

interface DiagnosticFixDefinition {
  fixId: string;
  script: string;
  args: string[];
  timeout_ms: number;
  description?: string;
}

// ----------------------------------------------------------------------------
// 服务实现
// ----------------------------------------------------------------------------

const execFileP = promisify(execFile);

/**
 * SystemDiagnosticService 实现。
 *
 * 通过构造函数注入 rulesPath / fixesPath / scriptsDir / db（可选）。
 * 不依赖其他模块的内部实现。
 */
export class SystemDiagnosticServiceImpl {
  constructor(
    private readonly rulesPath: string,
    private readonly fixesPath: string,
    private readonly scriptsDir: string,
    private readonly db?: Knex,
  ) {}

  /**
   * 运行一键诊断。逐条执行 rulesPath 中的静态规则，返回问题清单 + 全量检查结果 + 汇总。
   * 单条规则检查异常不会中断整体诊断，会被记录为该规则的检查失败问题。
   * 配置加载失败时返回单个 critical 问题（诊断本身不可用），不抛错。
   *
   * v3.8.0-D4: 返回值新增 `environment` 字段（production / development）。
   */
  async runDiagnostics(): Promise<
    DiagnosticsResult & { checks: DiagnosticCheck[]; environment: DiagnosticEnvironment }
  > {
    const start = Date.now();
    // v3.8.0-D4: 环境探测——systemd 单元存在 OR NODE_ENV=production 视为 production
    const environment = await this.detectEnvironment();

    let rules: DiagnosticRuleDefinition[];
    try {
      rules = (await this.loadRules()).rules;
    } catch (err) {
      const message = `诊断规则配置加载失败: ${err instanceof Error ? err.message : String(err)}`;
      return {
        problems: [{ id: 'config_load', severity: 'critical', message, fixId: null }],
        checks: [
          {
            id: 'config_load',
            title: '诊断规则配置加载',
            category: '配置完整性',
            status: 'error',
            severity: 'critical',
            message,
            fixable: false,
            fixId: null,
          },
        ],
        summary: message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - start,
        environment,
      };
    }

    const problems: DiagnosticProblem[] = [];
    const checks: DiagnosticCheck[] = [];
    for (const rule of rules) {
      const check = await this.runRule(rule);
      checks.push(check);
      if (check.status !== 'pass') {
        problems.push({
          id: check.id,
          severity: check.severity,
          message: check.message,
          fixId: check.fixId,
        });
      }
    }

    return {
      problems,
      checks,
      summary: this.buildSummary(problems),
      timestamp: new Date().toISOString(),
      duration: Date.now() - start,
      environment,
    };
  }

  /**
   * 流式诊断：逐条执行规则，每完成一条即通过回调推送结果。
   * 前端可通过 SSE 接收，实现"出一个显示一个"的即时反馈。
   *
   * @param onCheck 每完成一条规则时回调，传入检查结果（含环境信息仅首条附带）
   */
  async runDiagnosticsStream(
    onCheck: (check: DiagnosticCheck, meta?: { environment: DiagnosticEnvironment; ruleIndex: number; totalRules: number }) => void,
  ): Promise<{ environment: DiagnosticEnvironment }> {
    const environment = await this.detectEnvironment();

    let rules: DiagnosticRuleDefinition[];
    try {
      rules = (await this.loadRules()).rules;
    } catch (err) {
      const message = `诊断规则配置加载失败: ${err instanceof Error ? err.message : String(err)}`;
      onCheck(
        {
          id: 'config_load',
          title: '诊断规则配置加载',
          category: '配置完整性',
          status: 'error',
          severity: 'critical',
          message,
          fixable: false,
          fixId: null,
        },
        { environment, ruleIndex: 0, totalRules: 1 },
      );
      return { environment };
    }

    const total = rules.length;
    for (let i = 0; i < total; i++) {
      const check = await this.runRule(rules[i]);
      onCheck(check, { environment, ruleIndex: i, totalRules: total });
    }

    return { environment };
  }

  /**
   * v3.8.0-D4: 探测当前运行环境。
   * - 若 `gameserver-panel.service` systemd 单元存在且 active → production
   * - 若 NODE_ENV=production → production
   * - 否则 → development
   */
  private async detectEnvironment(): Promise<DiagnosticEnvironment> {
    if (process.env.NODE_ENV === 'production') {
      return 'production';
    }
    try {
      const { stdout } = await execFileP('systemctl', ['is-active', 'gameserver-panel.service'], {
        timeout: 2000,
        encoding: 'utf8',
      });
      if (stdout.trim() === 'active') {
        return 'production';
      }
    } catch {
      // systemctl 不可用或服务不存在 → development
    }
    return 'development';
  }

  /**
   * 应用指定修复脚本。fixId 必须在 fixesPath 白名单中，且脚本路径必须在 scriptsDir 内。
   *
   * @throws {SystemFixInvalidError} fixId 不在白名单或脚本路径越界
   */
  async applyFix(fixId: string): Promise<ApplyFixResponse> {
    const fixes = await this.loadFixes();
    const fix = fixes.find((f) => f.fixId === fixId);
    if (!fix) {
      throw new SystemFixInvalidError(`Invalid fixId or fix not whitelisted: ${fixId}`);
    }

    // 路径安全校验：解析后必须仍在 scriptsDir 内（防路径遍历）
    const resolvedScriptsDir = path.resolve(this.scriptsDir);
    const resolvedScriptPath = path.resolve(resolvedScriptsDir, fix.script);
    if (
      resolvedScriptPath !== resolvedScriptsDir &&
      !resolvedScriptPath.startsWith(resolvedScriptsDir + path.sep)
    ) {
      throw new SystemFixInvalidError(`脚本路径越界: ${fix.script}`);
    }

    // 参数环境变量替换（如 ${DEPLOY_ROOT}/logs）
    const args = fix.args.map((a) => substituteEnv(a));
    const appliedAt = new Date().toISOString();

    try {
      const { stdout, stderr } = await execFileP(resolvedScriptPath, args, {
        timeout: fix.timeout_ms,
        maxBuffer: EXEC_MAX_BUFFER,
        encoding: 'utf8',
      });
      const message = stderr.trim() ? `${stdout.trim()}\n${stderr.trim()}`.trim() : stdout.trim();
      return { fixId, success: true, message: message || 'ok', appliedAt };
    } catch (err) {
      const e = err as Error & {
        killed?: boolean;
        signal?: string;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      // 超时判定：execFile 在 timeout 触发后 kill 子进程，error.killed=true 且 signal=SIGTERM
      if (e.killed === true && e.signal === 'SIGTERM') {
        return { fixId, success: false, message: 'timeout', appliedAt };
      }
      const stderrStr = toStr(e.stderr);
      const stdoutStr = toStr(e.stdout);
      const message = stderrStr || stdoutStr || e.message || 'execution failed';
      return { fixId, success: false, message, appliedAt };
    }
  }

  // ==========================================================================
  // 私有：诊断规则调度
  // ==========================================================================

  /**
   * 执行单条诊断规则，返回 DiagnosticCheck（包含状态：pass/warning/error）。
   * 检查本身抛错时归约为该规则的 error 状态，保证单条规则不阻断整体诊断。
   */
  private async runRule(rule: DiagnosticRuleDefinition): Promise<DiagnosticCheck> {
    let detail: string | null;
    try {
      detail = await this.evaluateCheck(rule);
    } catch (err) {
      detail = `检查执行失败: ${err instanceof Error ? err.message : String(err)}`;
    }

    const normSeverity = normalizeSeverity(rule.severity);
    const category = rule.category || '其他';

    if (detail === null) {
      const successMsg = rule.success_message || `${rule.title}: 正常`;
      return {
        id: rule.id,
        title: rule.title,
        category,
        status: 'pass',
        severity: normSeverity,
        message: successMsg,
        fixable: false,
        fixId: null,
        description: rule.description,
      };
    }

    const status: 'warning' | 'error' = normSeverity === 'info' || normSeverity === 'warning' ? 'warning' : 'error';
    return {
      id: rule.id,
      title: rule.title,
      category,
      status,
      severity: normSeverity,
      message: detail,
      fixable: rule.fixable && !!rule.fix_id,
      fixId: rule.fixable && rule.fix_id ? rule.fix_id : null,
      description: rule.description,
    };
  }

  /**
   * 按规则 check_type 分派执行检查。
   * @returns 检测到问题时返回问题描述字符串；无问题时返回 null
   */
  private async evaluateCheck(rule: DiagnosticRuleDefinition): Promise<string | null> {
    const params = rule.check_params ?? {};
    switch (rule.check_type) {
      case 'disk_usage':
        return this.checkDiskUsage(params);
      case 'memory_usage':
        return this.checkMemoryUsage(params);
      case 'file_exists':
        return this.checkFileExists(params);
      case 'directory_exists':
        return this.checkDirectoryExists(params);
      case 'process_running':
        return this.checkProcessRunning(params);
      case 'port_listening':
        return this.checkPortListening(params);
      case 'db_connectivity':
        return this.checkDbConnectivity();
      case 'command_exists':
        return this.checkCommandExists(params);
      case 'java_version':
        return this.checkJavaVersion(params);
      case 'steamcmd_check':
        return this.checkSteamcmd(params);
      case 'node_version':
        return this.checkNodeVersion(params);
      // v3.8.0-D1: 新增 systemd_service check_type——替代 pgrep -f node 的精准检测
      case 'systemd_service':
        return this.checkSystemdService(params);
      // v3.8.0-D6: 新增 port_conflict check_type——扫描 servers 表检测端口重叠
      case 'port_conflict':
        return this.checkPortConflict(params);
      // v3.8.0-D7: 新增 path_uniqueness check_type——验证实例目录可写性（实例路径由 UUID 派生，唯一性内建）
      case 'path_uniqueness':
        return this.checkPathUniqueness(params);
      // v3.8.0-D9: 新增 state_stuck check_type——检测 starting/stopping 状态卡死 > 5min
      case 'state_stuck':
        return this.checkStateStuck(params);
      // v3.8.0-D10: 新增 file_permission check_type——验证实例/版本目录读写权限
      case 'file_permission':
        return this.checkFilePermission(params);
      // v3.8.0-D11: 新增 admin_password_default check_type——检测管理员是否使用默认密码 admin123
      case 'admin_password_default':
        return this.checkAdminPasswordDefault(params);
      // v3.9.0-D8: 新增 zombie_instance check_type——检测 status=running 但 updated_at 超时的实例
      case 'zombie_instance':
        return this.checkZombieInstance(params);
      default:
        return `不支持的检查类型: ${rule.check_type}`;
    }
  }

  /** 磁盘使用率检查：超过 threshold_percent 视为问题 */
  private async checkDiskUsage(params: Record<string, unknown>): Promise<string | null> {
    const rawPath = typeof params.path === 'string' ? params.path : '/';
    const targetPath = substituteEnv(rawPath) || '/';
    const threshold = toNumber(params.threshold_percent, 90);

    let stats: { bsize: number; blocks: number; bfree: number };
    try {
      stats = await fs.statfs(targetPath);
    } catch (err) {
      return `磁盘使用率检查失败 (path=${targetPath}): ${err instanceof Error ? err.message : String(err)}`;
    }

    const total = stats.blocks * stats.bsize;
    if (total <= 0) {
      return `磁盘使用率检查失败 (path=${targetPath}): 总容量为 0`;
    }
    const free = stats.bfree * stats.bsize;
    const usedPercent = ((total - free) / total) * 100;
    if (usedPercent >= threshold) {
      return `磁盘使用率 ${usedPercent.toFixed(1)}% 超过阈值 ${threshold}% (path=${targetPath})`;
    }
    return null;
  }

  /** 文件存在性检查：文件不可访问视为问题 */
  private async checkFileExists(params: Record<string, unknown>): Promise<string | null> {
    const rawPath = typeof params.path === 'string' ? params.path : '';
    const targetPath = substituteEnv(rawPath);
    if (!targetPath) {
      return '未配置 file_exists.path';
    }
    try {
      await fs.access(targetPath);
      return null;
    } catch {
      return `文件不存在: ${targetPath}`;
    }
  }

  /** 进程运行检查：pgrep 无匹配视为问题 */
  private async checkProcessRunning(params: Record<string, unknown>): Promise<string | null> {
    const name = typeof params.process_name === 'string' ? params.process_name : '';
    if (!name) {
      return '未配置 process_running.process_name';
    }
    try {
      await execFileP('pgrep', ['-f', name], {
        timeout: PROCESS_PROBE_TIMEOUT_MS,
        encoding: 'utf8',
      });
      return null;
    } catch {
      return `进程未运行: ${name}`;
    }
  }

  /** 端口监听检查：TCP 连接失败视为问题。
   *  v3.8.0-D3: 当提供 `process_name` 参数时，额外用 `ss -tlnp` 验证监听进程匹配，
   *  避免开发环境 dev server 监听同端口导致误判为生产 Panel 进程。
   */
  private async checkPortListening(params: Record<string, unknown>): Promise<string | null> {
    const port = toNumber(params.port, 0);
    if (!Number.isInteger(port) || port <= 0) {
      return `无效端口: ${String(params.port ?? '')}`;
    }
    const host = typeof params.host === 'string' ? params.host : '127.0.0.1';
    const expectedProcess =
      typeof params.process_name === 'string' ? params.process_name : '';

    const listening = await probePort(port, host, PORT_PROBE_TIMEOUT_MS);
    if (!listening) {
      return `端口 ${port} 未监听 (host=${host})`;
    }

    // v3.8.0-D3: 进程绑定验证——若配置了 process_name，用 ss 验证监听进程匹配
    if (expectedProcess) {
      const processInfo = await queryPortProcess(port);
      if (processInfo === null) {
        // ss 不可用或权限不足，降级为仅端口探测通过
        return null;
      }
      if (!processInfo.includes(expectedProcess)) {
        return `端口 ${port} 监听进程不匹配：期望含 "${expectedProcess}"，实际 "${processInfo}"（可能是开发模式 dev server）`;
      }
    }
    return null;
  }

  /**
   * v3.8.0-D1: systemd 服务状态检查。
   * 用 `systemctl is-active <service>` 替代 `pgrep -f node`，避免匹配任意 Node 进程的误判。
   * systemctl 不可用（非 Linux / 未安装 systemd）时返回警告信息。
   */
  private async checkSystemdService(params: Record<string, unknown>): Promise<string | null> {
    const serviceName = typeof params.service_name === 'string' ? params.service_name : '';
    if (!serviceName) {
      return '未配置 systemd_service.service_name';
    }
    // 期望状态默认 active，可配置为 inactive / failed 等
    const expectedState = typeof params.expected_state === 'string' ? params.expected_state : 'active';
    try {
      const { stdout } = await execFileP('systemctl', ['is-active', serviceName], {
        timeout: PROCESS_PROBE_TIMEOUT_MS,
        encoding: 'utf8',
      });
      const actualState = stdout.trim();
      if (actualState === expectedState) {
        return null;
      }
      return `systemd 服务 ${serviceName} 状态为 "${actualState}"，期望 "${expectedState}"`;
    } catch (err) {
      const e = err as { code?: number | string; stderr?: string };
      // systemctl is-active 在服务不存在时 exit code=3，inactive 时 exit code=3
      const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
      if (stderr.includes('Unit') && stderr.includes('could not be found')) {
        return `systemd 服务 ${serviceName} 未安装（单元不存在）`;
      }
      return `systemd 服务检查失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** 数据库连通性检查：SELECT 1 失败视为问题 */
  private async checkDbConnectivity(): Promise<string | null> {
    if (!this.db) {
      return '数据库未注入，无法检查连通性';
    }
    try {
      await this.db.raw('SELECT 1');
      return null;
    } catch (err) {
      return `数据库连通性失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** 内存使用率检查：超过 threshold_percent 视为问题 */
  private async checkMemoryUsage(params: Record<string, unknown>): Promise<string | null> {
    const threshold = toNumber(params.threshold_percent, 90);
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedPercent = ((totalMem - freeMem) / totalMem) * 100;
      if (usedPercent >= threshold) {
        return `内存使用率 ${usedPercent.toFixed(1)}% 超过阈值 ${threshold}%（已用 ${Math.round((totalMem - freeMem) / 1024 / 1024)} MB / 总 ${Math.round(totalMem / 1024 / 1024)} MB）`;
      }
      return null;
    } catch (err) {
      return `内存使用率检查失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** 目录存在性检查：目录不可访问视为问题 */
  private async checkDirectoryExists(params: Record<string, unknown>): Promise<string | null> {
    const rawPath = typeof params.path === 'string' ? params.path : '';
    const targetPath = substituteEnv(rawPath);
    if (!targetPath) {
      return '未配置 directory_exists.path';
    }
    try {
      const stat = await fs.stat(targetPath);
      if (!stat.isDirectory()) {
        return `路径不是目录: ${targetPath}`;
      }
      return null;
    } catch {
      return `目录不存在: ${targetPath}`;
    }
  }

  /** 命令存在性检查：which/command -v 无匹配视为问题 */
  private async checkCommandExists(params: Record<string, unknown>): Promise<string | null> {
    const cmd = typeof params.command === 'string' ? params.command : '';
    if (!cmd) {
      return '未配置 command_exists.command';
    }
    try {
      await execFileP('which', [cmd], {
        timeout: PROCESS_PROBE_TIMEOUT_MS,
        encoding: 'utf8',
      });
      return null;
    } catch {
      return `命令未找到: ${cmd}`;
    }
  }

  /** Java 版本检查：检查 java 命令是否存在及版本是否满足最低要求 */
  private async checkJavaVersion(params: Record<string, unknown>): Promise<string | null> {
    const minVersion = typeof params.min_version === 'string' ? params.min_version : '1.8';
    try {
      const { stderr } = await execFileP('java', ['-version'], {
        timeout: PROCESS_PROBE_TIMEOUT_MS,
        encoding: 'utf8',
      });
      const versionMatch = stderr.match(/version "?(\d+)(?:\.(\d+))?/);
      if (!versionMatch) {
        return `Java 版本解析失败: ${stderr.substring(0, 100)}`;
      }
      const major = parseInt(versionMatch[1], 10);
      const minor = versionMatch[2] ? parseInt(versionMatch[2], 10) : 0;
      const versionStr = major >= 9 ? `${major}` : `${major}.${minor}`;
      const minMajorMatch = minVersion.match(/^(\d+)(?:\.(\d+))?/);
      if (minMajorMatch) {
        const minMajor = parseInt(minMajorMatch[1], 10);
        const minMinor = minMajorMatch[2] ? parseInt(minMajorMatch[2], 10) : 0;
        // Java 版本比较：1.x 是旧格式（如 1.8 = Java 8），9+ 是新格式（如 21 = Java 21）
        const currentNormalized = major === 1 ? minor : major;
        const minNormalized = minMajor === 1 ? minMinor : minMajor;
        if (currentNormalized < minNormalized) {
          return `Java 版本过低：当前 ${versionStr}，最低要求 ${minVersion}`;
        }
      }
      return null;
    } catch (err) {
      return `Java 检查失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** SteamCMD 检查：检查 steamcmd.sh 是否存在及能否初始化 */
  private async checkSteamcmd(params: Record<string, unknown>): Promise<string | null> {
    const rawPath = typeof params.path === 'string' ? params.path : '/opt/steamcmd/steamcmd.sh';
    const steamcmdPath = substituteEnv(rawPath);
    try {
      await fs.access(steamcmdPath);
    } catch {
      return `SteamCMD 未安装: ${steamcmdPath} 不存在`;
    }
    try {
      const linux32Path = path.join(path.dirname(steamcmdPath), 'linux32', 'steamcmd');
      await fs.access(linux32Path);
    } catch {
      return 'SteamCMD 未初始化：缺少 linux32/steamcmd 二进制，请先运行一次 steamcmd.sh +quit';
    }
    try {
      await execFileP(steamcmdPath, ['+quit'], {
        timeout: 30000,
        encoding: 'utf8',
      });
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('无法执行') || msg.includes('cannot execute')) {
        return 'SteamCMD 无法执行：缺少 32 位依赖库，请安装 lib32gcc-s1';
      }
      return `SteamCMD 运行失败: ${msg.substring(0, 100)}`;
    }
  }

  /** Node.js 版本检查：检查当前 node 版本是否满足最低要求 */
  private async checkNodeVersion(params: Record<string, unknown>): Promise<string | null> {
    const minVersion = typeof params.min_version === 'string' ? params.min_version : '18.0.0';
    const currentVersion = process.version.replace(/^v/, '');
    const currentParts = currentVersion.split('.').map((n) => parseInt(n, 10));
    const minParts = minVersion.split('.').map((n) => parseInt(n, 10));
    for (let i = 0; i < Math.max(currentParts.length, minParts.length); i++) {
      const cur = currentParts[i] ?? 0;
      const min = minParts[i] ?? 0;
      if (cur < min) {
        return `Node.js 版本过低：当前 ${currentVersion}，最低要求 ${minVersion}`;
      }
      if (cur > min) {
        return null;
      }
    }
    return null;
  }

  /**
   * v3.8.0-D6: 端口冲突检测。
   * 扫描 servers 表，检测 port 或 rcon_port 是否在多个实例间重叠。
   * 同一端口被多个 server 使用 → 启动时必然冲突，需提前告警。
   */
  private async checkPortConflict(params: Record<string, unknown>): Promise<string | null> {
    if (!this.db) {
      return '数据库未注入，无法检查端口冲突';
    }
    const column = typeof params.column === 'string' ? params.column : 'port';
    if (column !== 'port' && column !== 'rcon_port') {
      return `port_conflict.column 仅支持 "port" / "rcon_port"，当前: ${column}`;
    }
    try {
      const rows = await this.db('servers')
        .select(column)
        .count('* as cnt')
        .groupBy(column)
        .havingRaw('COUNT(*) > 1');
      if (rows.length === 0) {
        return null;
      }
      const conflictPorts = rows.map((r) => r[column]).join(', ');
      return `检测到 ${rows.length} 组 ${column} 冲突（涉及端口：${conflictPorts}），多实例共用端口将导致启动失败`;
    } catch (err) {
      return `端口冲突检查失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * v3.8.0-D7: 实例路径唯一性 / 可写性检查。
   * servers 表无 instance_root 字段——实例路径由 INSTANCES_DIR/<server_id> 派生，
   * server_id 为 UUID，路径唯一性由 ID 生成器保证。
   * 本检查退化为：验证 INSTANCES_DIR 配置存在且当前进程可写，确保新建实例不会因目录不可写失败。
   */
  private async checkPathUniqueness(params: Record<string, unknown>): Promise<string | null> {
    const rawPath = typeof params.path === 'string' ? params.path : '';
    const targetPath = substituteEnv(rawPath);
    if (!targetPath) {
      return '未配置 path_uniqueness.path';
    }
    try {
      const stat = await fs.stat(targetPath);
      if (!stat.isDirectory()) {
        return `路径不是目录: ${targetPath}`;
      }
    } catch {
      return `实例目录不存在: ${targetPath}（实例路径唯一性由 UUID 派生，但目录必须先创建）`;
    }
    // 验证可写性——尝试在目录内创建临时文件
    const probeFile = path.join(targetPath, `.diag-probe-${Date.now()}.tmp`);
    try {
      await fs.writeFile(probeFile, 'probe');
      await fs.unlink(probeFile);
      return null;
    } catch (err) {
      return `实例目录不可写: ${targetPath}（${err instanceof Error ? err.message : String(err)}）`;
    }
  }

  /**
   * v3.8.0-D9: 状态卡死检测。
   * 扫描 servers 表，找出 status 为 starting/stopping 且 updated_at 距今超过 threshold_minutes 的实例。
   * 这些实例可能因进程崩溃或事件丢失导致状态永久卡住，需人工介入或自动重置。
   *
   * TODO(v3.9.0): D8 僵尸实例检测（DB running 但 daemon 无对应进程）需注入 daemonClient，
   *               当前模块 AGENTS.md 允许通过构造函数注入共享基础设施，但需调整 index.ts 装配代码，
   *               暂延后到 v3.9.0 与安全加固一同处理。
   */
  private async checkStateStuck(params: Record<string, unknown>): Promise<string | null> {
    if (!this.db) {
      return '数据库未注入，无法检查状态卡死';
    }
    const thresholdMinutes = toNumber(params.threshold_minutes, 5);
    const thresholdMs = thresholdMinutes * 60 * 1000;
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();
    try {
      const rows = await this.db('servers')
        .select('id', 'name', 'status', 'updated_at')
        .whereIn('status', ['starting', 'stopping'])
        .andWhere('updated_at', '<', cutoff);
      if (rows.length === 0) {
        return null;
      }
      const stuckList = rows
        .map((r) => `${r.name || r.id}(${r.status}@${r.updated_at})`)
        .join(', ');
      return `检测到 ${rows.length} 个实例状态卡死超过 ${thresholdMinutes} 分钟：${stuckList}`;
    } catch (err) {
      return `状态卡死检查失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * v3.9.0-D8: 僵尸实例检测。
   * 扫描 status='running' 的实例，检测 updated_at 超过 stale_hours 未更新的记录。
   *
   * 判定逻辑（启发式）：
   *   - status='running' 但 updated_at 超过阈值未更新
   *   - 可能原因：Daemon 进程崩溃但 Panel 未收到 state_changed 事件 / 网络分区导致事件丢失 / 进程实际已退出但 DB 状态未同步
   *   - 与 state_stuck 区别：state_stuck 针对 starting/stopping 短暂状态，zombie 针对 running 长期状态
   *
   * params:
   *   - stale_hours: 视为僵尸的小时阈值（默认 6）
   */
  private async checkZombieInstance(params: Record<string, unknown>): Promise<string | null> {
    if (!this.db) {
      return '数据库未注入，无法检查僵尸实例';
    }
    const staleHours = toNumber(params.stale_hours, 6);
    const staleMs = staleHours * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    try {
      const rows = await this.db('servers')
        .select('id', 'name', 'status', 'updated_at')
        .where('status', 'running')
        .andWhere('updated_at', '<', cutoff);
      if (rows.length === 0) {
        return null;
      }
      const zombieList = rows
        .map((r) => `${r.name || r.id}(updated_at=${r.updated_at})`)
        .join(', ');
      return `检测到 ${rows.length} 个僵尸实例（status=running 但超过 ${staleHours} 小时未更新）：${zombieList}`;
    } catch (err) {
      return `僵尸实例检查失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * v3.8.0-D10: 文件权限检查。
   * 验证指定路径的读/写/执行权限，确保 Panel 进程能正常访问实例数据目录。
   * params:
   *   - path: 目标路径（支持 ${VAR:-default} 环境变量替换）
   *   - require: 权限组合字符串，如 "rw" / "rwx" / "r"（默认 "rw"）
   */
  private async checkFilePermission(params: Record<string, unknown>): Promise<string | null> {
    const rawPath = typeof params.path === 'string' ? params.path : '';
    const targetPath = substituteEnv(rawPath);
    if (!targetPath) {
      return '未配置 file_permission.path';
    }
    const required = typeof params.require === 'string' ? params.require : 'rw';
    try {
      // 检查目录存在性
      const stat = await fs.stat(targetPath);
      if (!stat.isDirectory()) {
        return `路径不是目录: ${targetPath}`;
      }
      // 逐项验证权限
      const mode = stat.mode & 0o777;
      const checks: Array<{ flag: number; label: string }> = [];
      if (required.includes('r')) checks.push({ flag: 0o400, label: '读' });
      if (required.includes('w')) checks.push({ flag: 0o200, label: '写' });
      if (required.includes('x')) checks.push({ flag: 0o100, label: '执行' });
      // 同时校验 owner 位的实际权限
      const missing: string[] = [];
      for (const c of checks) {
        if ((mode & c.flag) !== c.flag) {
          missing.push(c.label);
        }
      }
      if (missing.length > 0) {
        return `路径 ${targetPath} 缺少权限：${missing.join('/')}（当前 mode=${mode.toString(8)}，要求 "${required}"）`;
      }
      // 额外验证写权限——尝试创建临时文件
      if (required.includes('w')) {
        const probeFile = path.join(targetPath, `.diag-perm-${Date.now()}.tmp`);
        try {
          await fs.writeFile(probeFile, 'probe');
          await fs.unlink(probeFile);
        } catch (err) {
          return `路径 ${targetPath} 实际不可写：${err instanceof Error ? err.message : String(err)}`;
        }
      }
      return null;
    } catch (err) {
      return `文件权限检查失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * v3.8.0-D11: 管理员默认密码检测。
   * 查询所有 role=server_admin 的用户，检测其 password_hash 是否匹配默认密码 'admin123'。
   * 生产环境使用默认密码是严重安全风险，必须强制告警。
   */
  private async checkAdminPasswordDefault(
    params: Record<string, unknown>,
  ): Promise<string | null> {
    if (!this.db) {
      return '数据库未注入，无法检查管理员密码';
    }
    const defaultPassword =
      typeof params.default_password === 'string' ? params.default_password : 'admin123';
    const adminRole =
      typeof params.admin_role === 'string' ? params.admin_role : 'server_admin';
    try {
      const admins = await this.db('users')
        .select('id', 'username', 'email', 'password_hash')
        .where('role', adminRole)
        .andWhere('status', 'active');
      if (admins.length === 0) {
        return `未找到 role=${adminRole} 的活跃管理员账号（请检查是否已初始化）`;
      }
      const vulnerable: string[] = [];
      for (const admin of admins) {
        if (!admin.password_hash) continue;
        try {
          const matched = await bcrypt.compare(defaultPassword, admin.password_hash);
          if (matched) {
            vulnerable.push(`${admin.username || admin.email || admin.id}`);
          }
        } catch {
          // password_hash 格式异常或不可解析 → 跳过该账号
        }
      }
      if (vulnerable.length === 0) {
        return null;
      }
      return `检测到 ${vulnerable.length} 个管理员使用默认密码 "${defaultPassword}"：${vulnerable.join(', ')}（请立即修改密码）`;
    } catch (err) {
      return `管理员密码检查失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ==========================================================================
  // 私有：配置加载与汇总
  // ==========================================================================

  /** 读取诊断规则配置。文件缺失或 JSON 解析失败时抛错（由 runDiagnostics 捕获） */
  private async loadRules(): Promise<DiagnosticRuleConfig> {
    const content = await fs.readFile(this.rulesPath, 'utf8');
    return JSON.parse(content) as DiagnosticRuleConfig;
  }

  /** 读取修复脚本白名单配置。文件缺失或 JSON 解析失败时抛错（由 applyFix 传播） */
  private async loadFixes(): Promise<DiagnosticFixDefinition[]> {
    const content = await fs.readFile(this.fixesPath, 'utf8');
    const parsed = JSON.parse(content) as DiagnosticFixConfig;
    return parsed.fixes ?? [];
  }

  /** 汇总诊断结果为人类可读摘要 */
  private buildSummary(problems: DiagnosticProblem[]): string {
    if (problems.length === 0) {
      return '诊断完成：未发现问题';
    }
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const p of problems) {
      counts[p.severity] += 1;
    }
    return `诊断完成：发现 ${problems.length} 个问题（critical=${counts.critical}, warning=${counts.warning}, info=${counts.info}）`;
  }
}

// ----------------------------------------------------------------------------
// 工厂函数
// ----------------------------------------------------------------------------

/**
 * 创建 SystemDiagnosticService 实例。
 * 由 index.ts 装配时调用，注入共享 db（knex 连接，可选）。
 */
export function createSystemDiagnosticService(
  rulesPath: string,
  fixesPath: string,
  scriptsDir: string,
  db?: Knex,
): SystemDiagnosticServiceImpl {
  return new SystemDiagnosticServiceImpl(rulesPath, fixesPath, scriptsDir, db);
}

// ----------------------------------------------------------------------------
// 辅助函数（模块内私有）
// ----------------------------------------------------------------------------

/**
 * 环境变量替换：支持两种语法（v3.8.0-D5 扩展）：
 *   - `${VAR}`：未设置时替换为空串（向后兼容）
 *   - `${VAR:-default}`：未设置时替换为 default 值
 * 用于配置中 ${DEPLOY_ROOT} / ${DEPLOY_ROOT:-/opt/gameserver-panel} 等动态路径。
 */
function substituteEnv(value: string): string {
  return value.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_match, name: string, fallback: string | undefined) => {
    const v = process.env[name];
    if (v !== undefined && v !== '') {
      return v;
    }
    return fallback ?? '';
  });
}

/**
 * 将配置中的 severity 归一化为契约枚举 'critical'|'warning'|'info'。
 * 配置中 'error' 归一化为 'critical'；未知值归一化为 'info'。
 */
function normalizeSeverity(raw: string): 'critical' | 'warning' | 'info' {
  if (raw === 'critical' || raw === 'warning' || raw === 'info') {
    return raw;
  }
  if (raw === 'error') {
    return 'critical';
  }
  return 'info';
}

/** 安全转 number：非法或缺失返回 fallback */
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return fallback;
}

/** Buffer/string 安全转 string */
function toStr(value: string | Buffer | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : value.toString('utf8');
}

/**
 * TCP 端口探测：尝试建立连接，连接成功表示端口在监听。
 * 任一结束条件（connect/error/timeout）触发后销毁 socket 并 resolve。
 */
function probePort(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

/**
 * v3.8.0-D3: 查询监听指定端口的进程信息（用 `ss -tlnp`）。
 * 返回进程描述字符串（如 "node"），ss 不可用或无权限时返回 null（降级为不校验进程）。
 */
async function queryPortProcess(port: number): Promise<string | null> {
  try {
    const { stdout } = await execFileP('ss', ['-tlnp', `sport = :${port}`], {
      timeout: PROCESS_PROBE_TIMEOUT_MS,
      encoding: 'utf8',
    });
    // ss 输出示例：
    //   State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
    //   LISTEN  0       511     127.0.0.1:3000     0.0.0.0:*          users:(("node",pid=12345,fd=20))
    const match = stdout.match(/users:\(\("([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// 重新导出错误类（供路由层使用，避免分散 import）
// ============================================================================

export { AppError, SystemFixInvalidError } from './errors.js';
