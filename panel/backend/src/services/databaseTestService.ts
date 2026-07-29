// ============================================================================
// databaseTestService — v4.20.0 数据库连接测试服务
//
// 设计目标：
//   Setup Wizard v2 「数据库连接」步骤中，用户填写连接串后点击「测试连接」，
//   调用此服务验证连接是否可用，返回 ok/latency/server_version/error。
//
// 核心能力：
//   - testConnection(req): 测试 sqlite / mysql / postgresql 连接
//   - 动态检测 driver 是否安装（mysql2 / pg），未安装时返回友好错误
//   - 超时控制（默认 10s），避免长时间挂起
//   - 密码脱敏：错误信息中不暴露完整 URL
//
// 来源：docs/plans/setup-wizard-v2-configuration-plan.md §4.3
// ============================================================================

import knex, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DatabaseType,
  TestDatabaseConnectionRequest,
  TestDatabaseConnectionResponse,
} from '@public/schema/panel-api-types';

/** 测试连接默认超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface DatabaseTestServiceDeps {
  /** 超时覆盖（测试时注入；默认 10s） */
  timeoutMs?: number;
}

export class DatabaseTestService {
  private readonly timeoutMs: number;

  constructor(deps: DatabaseTestServiceDeps = {}) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * 测试数据库连接。
   *
   * 实现策略：
   *   - sqlite：用 `:memory:` 模式打开（不污染用户文件），执行 `SELECT sqlite_version()`
   *     再单独校验用户指定的文件路径父目录存在且可写
   *   - mysql：动态 require('mysql2')，knex client='mysql2'，执行 `SELECT VERSION()`
   *   - postgresql：动态 require('pg')，knex client='pg'，执行 `SELECT VERSION()`
   *   - 所有路径都加超时保护（Promise.race）
   *   - 测试完立即 destroy knex 实例，释放连接
   */
  async testConnection(req: TestDatabaseConnectionRequest): Promise<TestDatabaseConnectionResponse> {
    // 1. 基本字段校验
    if (!req.type) {
      return { ok: false, error: '缺少 type 字段' };
    }
    if (!req.url || typeof req.url !== 'string') {
      return { ok: false, error: '缺少 url 字段' };
    }

    // 2. URL 格式校验
    const urlError = this.validateUrl(req.type, req.url);
    if (urlError) {
      return { ok: false, error: urlError };
    }

    // 3. 分派到具体实现（带超时）
    const start = Date.now();
    try {
      const result = await this.raceWithTimeout(
        this.testByType(req.type, req.url),
        this.timeoutMs,
      );
      const latency_ms = Date.now() - start;
      return { ok: true, latency_ms, server_version: result.serverVersion };
    } catch (err) {
      const latency_ms = Date.now() - start;
      const errMessage = err instanceof Error ? err.message : String(err);
      // 超时错误特殊处理
      if (errMessage.startsWith('TIMEOUT:')) {
        return {
          ok: false,
          latency_ms,
          error: `连接超时（${this.timeoutMs / 1000}s）— 请检查网络/防火墙/数据库是否允许远程连接`,
        };
      }
      return {
        ok: false,
        latency_ms,
        error: this.sanitizeErrorMessage(errMessage, req.url),
      };
    }
  }

  // -----------------------------------------------------------------------
  // 内部：分派
  // -----------------------------------------------------------------------

  private async testByType(
    type: DatabaseType,
    url: string,
  ): Promise<{ serverVersion: string }> {
    switch (type) {
      case 'sqlite':
        return this.testSqlite(url);
      case 'mysql':
        return this.testMysql(url);
      case 'postgresql':
        return this.testPostgresql(url);
      default:
        throw new Error(`不支持的数据库类型: ${type}`);
    }
  }

  // -----------------------------------------------------------------------
  // 内部：SQLite
  // -----------------------------------------------------------------------

  private async testSqlite(url: string): Promise<{ serverVersion: string }> {
    // SQLite 路径校验：
    //   - 允许 `:memory:` （测试用，但用户不应在向导内填这个）
    //   - 允许相对路径（相对 process.cwd()）和绝对路径
    //   - 父目录必须存在且可写（不自动创建，避免用户填错路径误创建目录）
    if (url !== ':memory:') {
      const dbPath = path.isAbsolute(url) ? url : path.resolve(process.cwd(), url);
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        throw new Error(`SQLite 父目录不存在: ${dir}`);
      }
      try {
        fs.accessSync(dir, fs.constants.W_OK);
      } catch {
        throw new Error(`SQLite 父目录不可写: ${dir}`);
      }
    }

    // 用 :memory: 打开（避免创建用户文件），仅验证 sqlite3 driver 可用 + 拿版本
    let db: Knex | null = null;
    try {
      db = knex({
        client: 'sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      const rows = await db.raw('SELECT sqlite_version() AS version');
      // sqlite3 driver 返回 rows 为数组，第一项含 version 字段
      const version = rows[0]?.version ?? 'unknown';
      return { serverVersion: `SQLite ${version}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`SQLite 连接失败: ${msg}`);
    } finally {
      if (db) {
        await db.destroy();
      }
    }
  }

  // -----------------------------------------------------------------------
  // 内部：MySQL
  // -----------------------------------------------------------------------

  private async testMysql(url: string): Promise<{ serverVersion: string }> {
    // 动态检测 mysql2 driver（用变量名绕过 TS 静态模块解析，避免未安装时编译报错）
    // 运行时从 node_modules 解析；build 时不打包（作为 optionalDependencies）
    const moduleName = 'mysql2';
    try {
      await import(/* @vite-ignore */ moduleName);
    } catch {
      throw new Error(
        'MySQL 驱动（mysql2）未安装。请在服务器执行: npm install mysql2 --prefix panel/backend',
      );
    }

    let db: Knex | null = null;
    try {
      db = knex({
        client: 'mysql2',
        connection: url,
      });
      const rows = await db.raw('SELECT VERSION() AS version');
      // mysql2 返回 [rows, fields]，rows[0].version
      const version = Array.isArray(rows) ? rows[0]?.[0]?.version : rows[0]?.version;
      return { serverVersion: `MySQL ${version ?? 'unknown'}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`MySQL 连接失败: ${this.translateDbError(msg)}`);
    } finally {
      if (db) {
        await db.destroy();
      }
    }
  }

  // -----------------------------------------------------------------------
  // 内部：PostgreSQL
  // -----------------------------------------------------------------------

  private async testPostgresql(url: string): Promise<{ serverVersion: string }> {
    // 动态检测 pg driver（用变量名绕过 TS 静态模块解析）
    const moduleName = 'pg';
    try {
      await import(/* @vite-ignore */ moduleName);
    } catch {
      throw new Error(
        'PostgreSQL 驱动（pg）未安装。请在服务器执行: npm install pg --prefix panel/backend',
      );
    }

    let db: Knex | null = null;
    try {
      db = knex({
        client: 'pg',
        connection: url,
      });
      const rows = await db.raw('SELECT VERSION() AS version');
      // pg 返回 { rows: [...] }，rows[0].version 含 "PostgreSQL 16.4 on x86_64..."
      const rawVersion = rows.rows?.[0]?.version ?? rows[0]?.version ?? 'unknown';
      // 截取 "PostgreSQL 16.4" 部分
      const versionMatch = String(rawVersion).match(/^PostgreSQL\s+(\S+)/);
      const version = versionMatch ? versionMatch[1] : String(rawVersion);
      return { serverVersion: `PostgreSQL ${version}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`PostgreSQL 连接失败: ${this.translateDbError(msg)}`);
    } finally {
      if (db) {
        await db.destroy();
      }
    }
  }

  // -----------------------------------------------------------------------
  // 内部：URL 校验
  // -----------------------------------------------------------------------

  private validateUrl(type: DatabaseType, url: string): string | null {
    if (type === 'sqlite') {
      // sqlite 允许 :memory: 或文件路径（至少 1 字符）
      if (url.length === 0) {
        return 'SQLite 路径不能为空';
      }
      // 禁止 file:// 前缀（统一用纯路径）
      if (url.startsWith('file://')) {
        return 'SQLite 路径不要加 file:// 前缀，请直接填写路径（如 ./data/panel.db）';
      }
      return null;
    }

    if (type === 'mysql') {
      if (!url.startsWith('mysql://')) {
        return 'MySQL 连接串必须以 mysql:// 开头';
      }
      return null;
    }

    if (type === 'postgresql') {
      if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
        return 'PostgreSQL 连接串必须以 postgres:// 或 postgresql:// 开头';
      }
      return null;
    }

    return `不支持的数据库类型: ${type}`;
  }

  // -----------------------------------------------------------------------
  // 内部：超时控制
  // -----------------------------------------------------------------------

  private async raceWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`TIMEOUT: ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 内部：错误信息脱敏与翻译
  // -----------------------------------------------------------------------

  /**
   * 脱敏错误信息——移除 URL 中的密码部分。
   * 例：`mysql://user:secret@host` → `mysql://user:***@host`
   */
  private sanitizeErrorMessage(message: string, url: string): string {
    // 若错误信息中包含完整 URL，替换其中的密码
    if (url.includes('://')) {
      const maskedUrl = url.replace(/(:\/\/[^:]+):([^@]+)@/, '$1:***@');
      if (message.includes(url)) {
        return message.split(url).join(maskedUrl);
      }
    }
    return message;
  }

  /**
   * 翻译常见数据库错误为用户友好提示。
   * 仅处理鉴权/数据库不存在/连接拒绝等高频错误，其他原样返回。
   */
  private translateDbError(msg: string): string {
    const lower = msg.toLowerCase();
    if (lower.includes('econnrefused')) {
      return '连接被拒绝—目标端口无数据库服务监听（检查 IP/端口/防火墙）';
    }
    if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
      return '域名解析失败—检查主机名是否正确';
    }
    if (lower.includes('access denied') || lower.includes('password') || lower.includes('authentication')) {
      return '鉴权失败—用户名或密码错误';
    }
    if (lower.includes('unknown database') || lower.includes('database') && lower.includes('does not exist')) {
      return '数据库不存在—请先在数据库服务器上创建该库';
    }
    if (lower.includes('etimedout')) {
      return '网络超时—检查网络可达性/防火墙规则';
    }
    return msg;
  }
}

/**
 * 工厂函数——供 routes-registry / app.ts 注入时调用
 */
export function createDatabaseTestService(deps: DatabaseTestServiceDeps = {}): DatabaseTestService {
  return new DatabaseTestService(deps);
}
