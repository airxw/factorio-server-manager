// ============================================================================
// initPreflightService — v4.18.0 首启动环境预检服务
//
// 设计目标：
//   进入 SetupWizard 前先做服务器环境/依赖预检，让用户一眼看到"哪些就绪、哪些缺失"，
//   避免在生产环境根本不知道底层依赖是否就绪，即使配置错了也能走到改密步骤。
//
// 8 项检查（按 plan §4.1）：
//   1. database         — 数据库连通性
//   2. migrations       — Migrations 是否就绪
//   3. daemon           — Daemon 连通性（GET DAEMON_URL/health）
//   4. packs            — Pack 加载状态
//   5. db_config        — 数据库类型与路径（SQLite/PostgreSQL）
//   6. mode             — 当前运行模式（VITE_ENABLE_DEMO）
//   7. disk             — 磁盘剩余空间（INSTANCES_DIR）
//   8. public_url       — HTTPS / 域名（PUBLIC_BASE_URL）
//
// 来源：docs/plans/setup-wizard-fix-plan.md §4.1 + §4.4
// ============================================================================

import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import type { PackRegistry } from '../core/packs/registry.js';
import type { InitPreflightCheck } from '@public/schema/panel-api-types';

/**
 * DaemonClientService 最小接口约束——避免循环依赖，仅声明 preflight 用到的方法。
 */
interface DaemonClientLike {
  /** 探测节点健康状态（GET /health） */
  getHealth(nodeId: string): Promise<unknown>;
}

/**
 * 节点表行（仅取 preflight 所需字段）
 */
interface NodeRow {
  id: string;
  name: string;
  status: string;
}

export interface InitPreflightServiceDeps {
  db: Knex;
  registry: PackRegistry;
  daemonClientService?: DaemonClientLike;
}

export class InitPreflightService {
  constructor(private readonly deps: InitPreflightServiceDeps) {}

  /**
   * 执行全部 8 项检查并返回结果列表。
   * 使用 Promise.allSettled 并发执行——单检查失败不影响其他检查结果。
   */
  async runChecks(): Promise<InitPreflightCheck[]> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkMigrations(),
      this.checkDaemon(),
      this.checkPacks(),
      this.checkDatabaseConfig(),
      this.checkMode(),
      this.checkDiskSpace(),
      this.checkPublicBaseURL(),
    ]);

    // Promise.allSettled 不会 reject——rejected 的 promise 转为 error 状态
    return checks.map((result, idx) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      // 不应发生（每项 check 内部已 try-catch），防御性兜底
      const fallbackKeys = [
        'database',
        'migrations',
        'daemon',
        'packs',
        'db_config',
        'mode',
        'disk',
        'public_url',
      ];
      return {
        key: fallbackKeys[idx],
        label: fallbackKeys[idx],
        status: 'error' as const,
        detail: `检查异常：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        actionable: false,
      };
    });
  }

  // ------------------------------------------------------------------------
  // 检查 1: 数据库连通性
  // ------------------------------------------------------------------------
  private async checkDatabase(): Promise<InitPreflightCheck> {
    try {
      // 简单 SELECT 1 验证连通性
      await this.deps.db.raw('SELECT 1');
      return {
        key: 'database',
        label: '数据库连通性',
        status: 'ok',
        detail: '数据库响应正常',
        actionable: false,
      };
    } catch (err) {
      return {
        key: 'database',
        label: '数据库连通性',
        status: 'error',
        detail: `数据库连接失败：${err instanceof Error ? err.message : String(err)}`,
        actionable: false, // 需 SSH 修改 .env
      };
    }
  }

  // ------------------------------------------------------------------------
  // 检查 2: Migrations 是否就绪
  // ------------------------------------------------------------------------
  private async checkMigrations(): Promise<InitPreflightCheck> {
    try {
      const hasTable = await this.deps.db.schema.hasTable('knex_migrations');
      if (!hasTable) {
        return {
          key: 'migrations',
          label: '数据库迁移',
          status: 'error',
          detail: 'knex_migrations 表不存在——migrations 未执行',
          actionable: false, // 需 SSH 执行 npm run migrate
        };
      }
      // 查询最新 migration
      const rows: Array<{ name: string }> = await this.deps.db('knex_migrations')
        .orderBy('id', 'desc')
        .limit(1)
        .select('name');
      const latest = rows[0]?.name ?? '未知';
      return {
        key: 'migrations',
        label: '数据库迁移',
        status: 'ok',
        detail: `最新 migration：${latest}`,
        actionable: false,
      };
    } catch (err) {
      return {
        key: 'migrations',
        label: '数据库迁移',
        status: 'error',
        detail: `查询 migrations 失败：${err instanceof Error ? err.message : String(err)}`,
        actionable: false,
      };
    }
  }

  // ------------------------------------------------------------------------
  // 检查 3: Daemon 连通性
  // ------------------------------------------------------------------------
  private async checkDaemon(): Promise<InitPreflightCheck> {
    const daemonUrl = process.env.DAEMON_URL;
    if (!daemonUrl) {
      return {
        key: 'daemon',
        label: 'Daemon 节点',
        status: 'warn',
        detail: 'DAEMON_URL 未配置（单机模式下可忽略）',
        actionable: false,
      };
    }

    // 优先尝试通过 daemonClientService 探测节点列表中第一个节点的健康状态
    // v4.19.4.1 修复：原 orderBy('created_at', 'asc') 引用了 nodes 表不存在的列
    //   （nodes 表 schema 见 20260808000000_baseline_v4_post_demo.ts:77-91，无 created_at）
    //   导致 preflight 必然抛 SQLITE_ERROR: no such column: created_at，被 catch 标 error。
    //   改为 orderBy('id', 'asc') 与生产 schema 对齐。
    if (this.deps.daemonClientService) {
      try {
        const nodes: NodeRow[] = await this.deps.db('nodes')
          .select('id', 'name', 'status')
          .orderBy('id', 'asc')
          .limit(1);
        if (nodes.length === 0) {
          return {
            key: 'daemon',
            label: 'Daemon 节点',
            status: 'warn',
            detail: `DAEMON_URL=${daemonUrl}，但 nodes 表为空`,
            actionable: false,
          };
        }
        const firstNode = nodes[0];
        await this.deps.daemonClientService.getHealth(firstNode.id);
        return {
          key: 'daemon',
          label: 'Daemon 节点',
          status: 'ok',
          detail: `节点 ${firstNode.name} (${firstNode.id}) 健康检查通过`,
          actionable: false,
        };
      } catch (err) {
        return {
          key: 'daemon',
          label: 'Daemon 节点',
          status: 'error',
          detail: `节点健康检查失败：${err instanceof Error ? err.message : String(err)}`,
          actionable: false, // 需 SSH 检查 daemon 服务状态
        };
      }
    }

    // 兜底：DAEMON_URL 已配置但 daemonClientService 不可用
    return {
      key: 'daemon',
      label: 'Daemon 节点',
      status: 'warn',
      detail: `DAEMON_URL=${daemonUrl}（无法探测健康状态，daemonClientService 未注入）`,
      actionable: false,
    };
  }

  // ------------------------------------------------------------------------
  // 检查 4: Pack 加载状态
  // ------------------------------------------------------------------------
  private async checkPacks(): Promise<InitPreflightCheck> {
    try {
      const packs = this.deps.registry.list();
      if (packs.length === 0) {
        const packsDir = process.env.PACKS_DIR ?? path.resolve(process.cwd(), '../../packs');
        return {
          key: 'packs',
          label: '游戏 Pack',
          status: 'warn',
          detail: `未加载任何 Pack（PACKS_DIR=${packsDir}）`,
          actionable: false, // 需 SSH 检查 packs 目录
        };
      }
      return {
        key: 'packs',
        label: '游戏 Pack',
        status: 'ok',
        detail: `已加载 ${packs.length} 个 Pack：${packs.slice(0, 3).map((p) => p.pack.id).join(', ')}${packs.length > 3 ? '...' : ''}`,
        actionable: false,
      };
    } catch (err) {
      return {
        key: 'packs',
        label: '游戏 Pack',
        status: 'error',
        detail: `查询 Pack 列表失败：${err instanceof Error ? err.message : String(err)}`,
        actionable: false,
      };
    }
  }

  // ------------------------------------------------------------------------
  // 检查 5: 数据库类型与路径
  // ------------------------------------------------------------------------
  private checkDatabaseConfig(): InitPreflightCheck {
    const dbUrl = process.env.DATABASE_URL ?? '';
    if (!dbUrl) {
      return {
        key: 'db_config',
        label: '数据库配置',
        status: 'error',
        detail: 'DATABASE_URL 未配置',
        actionable: false,
      };
    }

    // SQLite: file: 前缀 或 .db 后缀 或纯路径
    if (dbUrl.startsWith('file:') || dbUrl.endsWith('.db') || dbUrl.endsWith('.sqlite') || dbUrl.endsWith('.sqlite3')) {
      const filePath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
      // v4.20.0：warn 措辞改为提示可在向导内切换；actionable=true 标记可在向导内修复
      return {
        key: 'db_config',
        label: '数据库配置',
        status: 'warn',
        detail: `SQLite at ${filePath}（可在向导「数据库连接」步骤切换为 MySQL/PostgreSQL）`,
        actionable: true, // v4.20.0: 可在向导内配置
      };
    }

    // PostgreSQL / MySQL：jdbc:postgresql:// / postgresql:// / mysql://
    if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://') || dbUrl.startsWith('mysql://')) {
      const protocol = dbUrl.startsWith('mysql') ? 'MySQL' : 'PostgreSQL';
      // 提取 host:port（不暴露密码）
      try {
        const url = new URL(dbUrl);
        return {
          key: 'db_config',
          label: '数据库配置',
          status: 'ok',
          detail: `${protocol} at ${url.hostname}:${url.port || '5432'}/${url.pathname.slice(1) || 'postgres'}`,
          actionable: false,
        };
      } catch {
        return {
          key: 'db_config',
          label: '数据库配置',
          status: 'ok',
          detail: `${protocol}（URL 解析失败，但已配置）`,
          actionable: false,
        };
      }
    }

    return {
      key: 'db_config',
      label: '数据库配置',
      status: 'warn',
      detail: `未识别的 DATABASE_URL 格式：${dbUrl.slice(0, 32)}...`,
      actionable: false,
    };
  }

  // ------------------------------------------------------------------------
  // 检查 6: 当前运行模式
  // ------------------------------------------------------------------------
  private async checkMode(): Promise<InitPreflightCheck> {
    const isDemo = process.env.VITE_ENABLE_DEMO === 'true';
    return {
      key: 'mode',
      label: '运行模式',
      status: 'ok',
      detail: isDemo
        ? '演示模式（VITE_ENABLE_DEMO=true）'
        : '生产模式（VITE_ENABLE_DEMO != true）',
      actionable: false, // 由 env 决定，向导内不可改
    };
  }

  // ------------------------------------------------------------------------
  // 检查 7: 磁盘剩余空间
  // ------------------------------------------------------------------------
  private async checkDiskSpace(): Promise<InitPreflightCheck> {
    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    try {
      // 解析为绝对路径并确保目录存在（不存在则用父目录统计）
      const absDir = path.resolve(instancesDir);
      const statDir = fs.existsSync(absDir) ? absDir : path.dirname(absDir);

      const stats = await fs.promises.statfs(statDir);
      const freeBytes = stats.bavail * stats.bsize;
      const totalBytes = stats.blocks * stats.bsize;
      const freeGB = freeBytes / (1024 * 1024 * 1024);
      const totalGB = totalBytes / (1024 * 1024 * 1024);

      // 阈值：剩余空间 < 1GB → warn
      if (freeGB < 1) {
        return {
          key: 'disk',
          label: '磁盘空间',
          status: 'warn',
          detail: `${statDir} 剩余 ${freeGB.toFixed(2)} GB / 总 ${totalGB.toFixed(2)} GB（< 1GB，建议清理）`,
          actionable: false,
        };
      }
      return {
        key: 'disk',
        label: '磁盘空间',
        status: 'ok',
        detail: `${statDir} 剩余 ${freeGB.toFixed(2)} GB / 总 ${totalGB.toFixed(2)} GB`,
        actionable: false,
      };
    } catch (err) {
      return {
        key: 'disk',
        label: '磁盘空间',
        status: 'warn',
        detail: `磁盘空间查询失败：${err instanceof Error ? err.message : String(err)}`,
        actionable: false,
      };
    }
  }

  // ------------------------------------------------------------------------
  // 检查 8: HTTPS / 域名
  // ------------------------------------------------------------------------
  private checkPublicBaseURL(): InitPreflightCheck {
    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    if (!publicBaseUrl) {
      // v4.20.0：warn 措辞改为提示可在向导内填写；actionable=true 标记可在向导内修复
      return {
        key: 'public_url',
        label: '公网入口',
        status: 'warn',
        detail: 'PUBLIC_BASE_URL 未配置（可在向导「站点信息」步骤填写）',
        actionable: true, // v4.20.0: 可在向导内配置
      };
    }

    try {
      const url = new URL(publicBaseUrl);
      const isHttps = url.protocol === 'https:';
      if (!isHttps) {
        return {
          key: 'public_url',
          label: '公网入口',
          status: 'warn',
          detail: `${publicBaseUrl}（非 HTTPS，生产环境建议启用 HTTPS）`,
          actionable: true, // v4.20.0: 可在向导内重新配置
        };
      }
      return {
        key: 'public_url',
        label: '公网入口',
        status: 'ok',
        detail: `${publicBaseUrl}`,
        actionable: false,
      };
    } catch {
      return {
        key: 'public_url',
        label: '公网入口',
        status: 'warn',
        detail: `PUBLIC_BASE_URL 格式无效：${publicBaseUrl}`,
        actionable: true, // v4.20.0: 可在向导内重新配置
      };
    }
  }
}

/**
 * 工厂函数——供 routes-registry 注入时调用
 */
export function createInitPreflightService(deps: InitPreflightServiceDeps): InitPreflightService {
  return new InitPreflightService(deps);
}
