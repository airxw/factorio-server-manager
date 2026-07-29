// ============================================================================
// E2E 测试辅助模块
// - 凭证从环境变量读取，dev/prod 双模式默认值
// - isProduction() 判断当前是否走生产验证链路
// - v4.13.0: 暴露 3 个角色 demo 账号（server_admin / instance_admin / user）
// - v4.13.0 补跑: token 文件共享（globalSetup 预登录，避免多 worker 触发限流）
// ============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// v4.13.0 补跑修复:token 文件放在 test-results 之外,与 global-setup.ts 保持一致
const TOKEN_FILE = join(__dirname, '..', '.e2e-tokens.json');

/** 角色标识 */
export type Role = 'server_admin' | 'instance_admin' | 'user';

/** 角色账号信息 */
export interface RoleAccount {
  email: string;
  password: string;
  role: Role;
  /** 登录后期望跳转的基座路径 */
  homePath: string;
  /** 该角色的固定 demo 实例 ID（来自 seedDemoData.ts） */
  demoInstanceId: string;
}

/**
 * E2E 测试登录邮箱（默认值，可用 E2E_EMAIL 覆盖）
 * - 开发模式默认：admin@local.dev
 * - 生产模式通过 E2E_EMAIL 环境变量指定
 */
export const E2E_EMAIL = process.env.E2E_EMAIL || 'admin@local.dev';

/**
 * E2E 测试登录密码（默认值，可用 E2E_PASSWORD 覆盖）
 * - 开发模式默认：admin123
 * - 生产模式通过 E2E_PASSWORD 环境变量指定
 */
export const E2E_PASSWORD = process.env.E2E_PASSWORD || 'admin123';

/** 当前是否走生产验证链路（E2E_BASE_URL 指向 https://...） */
export const isProduction = (): boolean => {
  const base = process.env.E2E_BASE_URL || '';
  return base.startsWith('https://');
};

/**
 * v4.13.0 三角色 demo 账号清单
 *
 * 生产环境 demo 模式（VITE_ENABLE_DEMO=true）下由 seedDemoAccountsIfMissing 创建：
 *   - admin@local.dev   / admin123 / server_admin   → /admin
 *   - manager@local.dev / admin123 / instance_admin → /store
 *   - user@local.dev    / admin123 / user           → /guild
 *
 * 实例 ID 来自 seedDemoData.ts 的 fixedId 字段（幂等固定 UUID）：
 *   - admin 拥有 5 个实例的全部视角，取 Minecraft 演示服
 *   - manager 拥有 Rust 演示服
 *   - user 拥有 Factorio / Terraria 演示服，取 Terraria
 */
export const ROLE_ACCOUNTS: Record<Role, RoleAccount> = {
  server_admin: {
    email: 'admin@local.dev',
    password: 'admin123',
    role: 'server_admin',
    homePath: '/admin',
    demoInstanceId: '11111111-1111-4111-8111-111111111111', // Minecraft vanilla
  },
  instance_admin: {
    email: 'manager@local.dev',
    password: 'admin123',
    role: 'instance_admin',
    homePath: '/store',
    demoInstanceId: '33333333-3333-4333-8333-333333333333', // Rust vanilla
  },
  user: {
    email: 'user@local.dev',
    password: 'admin123',
    role: 'user',
    homePath: '/guild',
    demoInstanceId: '55555555-5555-4555-8555-555555555555', // Terraria vanilla
  },
};

/**
 * 通过 API 登录获取 token（在 page 上下文外使用 page.request.post 调用）
 * 返回 token 字符串，调用方负责注入 localStorage。
 *
 * v4.13.0 修复：生产环境有登录限流（PANEL_RATE_LIMITED 429），
 * 68 个测试每个都调登录 API 会触发限流。改为按 role 缓存 token，
 * 同一角色只登录一次，后续测试复用缓存 token。
 *
 * v4.13.0 补跑：增加文件级 token 共享。
 *   - globalSetup 在所有 worker 启动前预登录 3 角色，写入 test-results/.e2e-tokens.json
 *   - loginViaApi 优先从文件读取，避免 worker 间重复登录
 *   - 文件 token 失效时回退到 API 登录（in-process cache 防重复）
 */
const tokenCache = new Map<Role, string>();

/** 从 globalSetup 写入的 token 文件读取（跨 worker 共享） */
function readTokenFromFile(role: Role): string | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const content = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8')) as {
      tokens: Record<Role, string>;
      created_at: string;
    };
    const createdAt = new Date(content.created_at).getTime();
    const ageMs = Date.now() - createdAt;
    // 12 小时内有效（与 JWT 默认 24h 留余量）
    if (ageMs > 12 * 60 * 60 * 1000) return null;
    return content.tokens[role] ?? null;
  } catch {
    return null;
  }
}

export async function loginViaApi(
  page: import('@playwright/test').Page,
  account: RoleAccount,
): Promise<string> {
  // 1. in-process cache 命中（同一 worker 内复用）
  const cached = tokenCache.get(account.role);
  if (cached) return cached;

  // 2. 文件级 token 命中（跨 worker 共享，globalSetup 预登录写入）
  const fileToken = readTokenFromFile(account.role);
  if (fileToken) {
    tokenCache.set(account.role, fileToken);
    return fileToken;
  }

  // 3. 回退到 API 登录（仅当 globalSetup 未运行或文件丢失时）
  const res = await page.request.post('/api/auth/login', {
    data: { email: account.email, password: account.password },
  });
  if (!res.ok()) {
    throw new Error(`登录失败 (${account.email}): ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  tokenCache.set(account.role, body.token);
  return body.token;
}

/** 清除 token 缓存（用于需要重新登录的场景，如测试登出后） */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * 注入 token 到 localStorage 并跳过登录页（用于 E2E 快速登录）
 */
export async function injectTokenAndGoto(
  page: import('@playwright/test').Page,
  account: RoleAccount,
  path: string,
): Promise<void> {
  const token = await loginViaApi(page, account);
  await page.addInitScript((t) => {
    localStorage.setItem('panel_token', t);
  }, token);
  await page.goto(path);
}

/**
 * 在生产环境里，一些重页面会在 headless Chromium 中很快因资源不足崩溃；
 * 这类用例若只验证"最终跳到了哪个 URL"，应在导航链路里尽早捕获目标 URL，
 * 避免把目标页 crash 误判成重定向逻辑失败。
 */
export async function injectTokenAndWaitForUrl(
  page: import('@playwright/test').Page,
  account: RoleAccount,
  path: string,
  target: string | RegExp,
): Promise<void> {
  const token = await loginViaApi(page, account);
  await page.addInitScript((t) => {
    localStorage.setItem('panel_token', t);
  }, token);
  const waiter = page.waitForURL(target, { timeout: 10_000 });
  // 这里只验证路由跳转结果，不等待目标页完整 load，避免把重页面资源抖动误判成跳转失败。
  await page.goto(path, { waitUntil: 'commit' }).catch(() => {});
  await waiter;
}
