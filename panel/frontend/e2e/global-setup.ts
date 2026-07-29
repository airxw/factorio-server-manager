// ============================================================================
// E2E globalSetup — v4.13.0 步骤27/28/31 E2E 补跑防限流方案
//
// 背景：生产环境登录限流 10 次/15 分钟/IP（rateLimiter.ts createLoginRateLimiter）。
//       多 worker 并行 + 每 spec 独立登录 → 触发 429 PANEL_RATE_LIMITED。
//
// 方案：globalSetup 在所有 worker 启动前运行一次，预登录 3 个角色，
//       将 token 写入 test-results/.e2e-tokens.json。
//       helpers.ts 的 loginViaApi 优先从文件读取，避免重复 API 登录。
//
// 登录次数预算：
//   - globalSetup: 3 次 API 登录（server_admin/instance_admin/user）
//   - login.spec.ts: 4 次表单登录（仅 chromium project，mobile-chrome 跳过）
//   - 其他 spec: 0 次 API 登录（从文件读 token）
//   总计：7 次 < 10 次限流阈值 ✅
// ============================================================================

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLE_ACCOUNTS, type Role } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
// v4.13.0 补跑修复:token 文件放在 test-results 之外,避免 Playwright 每次运行前清理该目录导致 globalSetup 重复登录触发限流
const TOKEN_FILE = join(__dirname, '..', '.e2e-tokens.json');

interface TokenStore {
  tokens: Record<Role, string>;
  created_at: string;
}

async function globalSetup(): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
  const isProduction = baseURL.startsWith('https://');

  // 生产环境自签名证书：Node.js fetch 不支持 ignoreHTTPSErrors，
  // 必须在 globalSetup 内临时关闭 TLS 校验（仅影响本进程，不影响 worker）
  if (isProduction) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  // 复用已存在的 token 文件（v4.15.x：双模式启用，验证通过后复用）
  // 背景：开发模式 baseURL=5173 但 /api 经 vite proxy 命中真实后端（3002），
  //       登录限流同样生效（10 次/15 分钟/IP）。每次运行重新登录 3 角色会快速耗尽预算。
  // 策略：文件 <12h 且每个 token 通过 /api/auth/me 轻量校验 → 复用；否则重新登录。
  if (existsSync(TOKEN_FILE)) {
    try {
      const content = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8')) as TokenStore;
      const createdAt = new Date(content.created_at).getTime();
      const ageMs = Date.now() - createdAt;
      // token 有效期 24 小时（JWT 默认），文件 12 小时内可复用
      if (ageMs < 12 * 60 * 60 * 1000 && content.tokens.server_admin && content.tokens.instance_admin && content.tokens.user) {
        let allValid = true;
        for (const role of Object.keys(content.tokens) as Role[]) {
          const res = await fetch(`${baseURL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${content.tokens[role]}` },
          });
          if (!res.ok) {
            allValid = false;
            break;
          }
        }
        if (allValid) {
          console.log('[globalSetup] 复用已存在的 token 文件（/auth/me 校验通过）');
          return;
        }
        console.log('[globalSetup] 缓存 token 校验失败，重新登录');
      }
    } catch {
      // 文件损坏或校验异常，继续重新登录
    }
  }

  console.log(`[globalSetup] 开始预登录 3 角色，baseURL=${baseURL}`);

  // 确保 test-results 目录存在
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });

  const tokens: Record<Role, string> = {} as Record<Role, string>;

  // 串行登录 3 个角色（避免并发触发限流）
  for (const role of Object.keys(ROLE_ACCOUNTS) as Role[]) {
    const account = ROLE_ACCOUNTS[role];
    // fetch 需要完整 URL（开发模式 baseURL=http://localhost:5173，生产=https://...）
    const loginUrl = `${baseURL}/api/auth/login`;

    // 生产模式用 fetch，开发模式也用 fetch（baseURL 已含协议）
    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.password }),
      // 生产环境自签名证书
      ...(isProduction ? {} : {}),
    });

    // Node.js fetch: res.ok / res.status 是属性不是方法
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`[globalSetup] 登录失败 (${role}/${account.email}): ${res.status} ${errBody}`);
    }

    const body = (await res.json()) as { token: string };
    tokens[role] = body.token;
    console.log(`[globalSetup] ${role} 登录成功`);
  }

  const store: TokenStore = {
    tokens,
    created_at: new Date().toISOString(),
  };

  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  console.log(`[globalSetup] token 已写入 ${TOKEN_FILE}`);
}

export default globalSetup;
