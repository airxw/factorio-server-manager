# 版本热更新方案

## 一、现状分析

当前版本信息硬编码在 `backend/src/routes/version.ts` 中（`version: '1.0.0'`），前端通过 `/api/version` 获取并展示在顶栏。无任何更新机制。

## 二、目标

用户在 Web 界面点击「检查更新」→ 发现新版本 → 点击「立即更新」→ 后端自动拉取最新代码、构建、重启服务，全程零停机或最小停机时间。

## 三、架构设计

### 3.1 版本信息管理

将版本号从硬编码改为**文件+数据库双写**：

```
backend/config/version.json    ← 当前运行版本号、构建时间、commit hash
```

```json
{
  "version": "1.0.0",
  "buildTime": "2026-06-28T10:00:00Z",
  "commit": "abc1234",
  "changelog": ["功能A", "修复B"]
}
```

### 3.2 更新源

使用 **Git 仓库**作为更新源（项目已有 `.git`）：

- 远程仓库：`origin/main` 分支
- 版本对比：本地 commit hash vs 远程最新 commit hash
- 不需要单独的版本服务器，直接 `git fetch` + `git log` 对比

### 3.3 API 设计

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/version` | GET | 返回当前版本信息（已有，改为读 version.json） |
| `/api/version/check` | POST | 检查远程是否有新版本（git fetch + 对比 commit） |
| `/api/version/update` | POST | 执行热更新（git pull → build → 重启） |
| `/api/version/update/status` | GET | 获取更新进度（SSE 或轮询） |

### 3.4 更新流程

```
用户点击「检查更新」
    ↓
POST /api/version/check
    ↓
后端执行: git fetch origin
    ↓
对比本地 commit vs 远程 commit
    ↓
返回: { hasUpdate: true, latestVersion: "1.1.0", changelog: [...], commit: "def5678" }
    ↓
用户点击「立即更新」
    ↓
POST /api/version/update
    ↓
后端执行更新脚本（异步）:
    1. git pull origin main
    2. cd backend && npm install && npm run build
    3. cd frontend && npm install && npm run build
    4. 写入新 version.json
    5. 优雅关闭当前进程 (process.kill + graceful shutdown)
    6. 启动新进程 (nohup node dist/index.js)
    ↓
前端轮询 /api/version/update/status 获取进度
    ↓
更新完成，前端自动刷新页面
```

### 3.5 后端实现关键点

**更新脚本** `backend/src/services/updateService.ts`：

```typescript
import { execSync, spawn } from 'child_process';
import path from 'path';

interface UpdateStatus {
  step: string;
  progress: number;  // 0-100
  error: string | null;
  done: boolean;
}

let currentStatus: UpdateStatus = { step: 'idle', progress: 0, error: null, done: true };

export function getUpdateStatus(): UpdateStatus { return currentStatus; }

export async function checkUpdate(): Promise<{ hasUpdate: boolean; ... }> {
  execSync('git fetch origin', { cwd: PROJECT_ROOT });
  const localCommit = execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT }).toString().trim();
  const remoteCommit = execSync('git rev-parse origin/main', { cwd: PROJECT_ROOT }).toString().trim();
  const hasUpdate = localCommit !== remoteCommit;
  // 获取 changelog: git log localCommit..remoteCommit --oneline
  return { hasUpdate, localCommit, remoteCommit, ... };
}

export async function performUpdate(): Promise<void> {
  const steps = [
    { name: '拉取代码', cmd: 'git pull origin main', cwd: PROJECT_ROOT },
    { name: '安装后端依赖', cmd: 'npm install', cwd: BACKEND_DIR },
    { name: '构建后端', cmd: 'npm run build', cwd: BACKEND_DIR },
    { name: '安装前端依赖', cmd: 'npm install', cwd: FRONTEND_DIR },
    { name: '构建前端', cmd: 'npm run build', cwd: FRONTEND_DIR },
  ];

  for (let i = 0; i < steps.length; i++) {
    currentStatus = { step: steps[i].name, progress: (i / steps.length) * 100, error: null, done: false };
    try {
      execSync(steps[i].cmd, { cwd: steps[i].cwd, timeout: 120000 });
    } catch (e) {
      currentStatus = { step: steps[i].name, progress: (i / steps.length) * 100, error: e.message, done: true };
      throw e;
    }
  }

  currentStatus = { step: '重启服务', progress: 90, error: null, done: false };
  // 写入新版本信息
  writeVersionJson();
  // 优雅重启：启动新进程后退出当前进程
  spawn('node', ['dist/index.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, NODE_ENV: 'production' },
    detached: true,
    stdio: 'ignore',
  }).unref();
  process.exit(0);
}
```

**版本路由** `backend/src/routes/version.ts`：

```typescript
// GET /api/version — 读 version.json
// POST /api/version/check — 调用 checkUpdate()
// POST /api/version/update — 调用 performUpdate()（需管理员权限）
// GET /api/version/update/status — 返回 getUpdateStatus()
```

### 3.6 前端实现

在顶栏版本号旁添加更新按钮：

```tsx
// App.tsx topbar 区域
{hasUpdate && (
  <button className="topbar-btn topbar-update-btn" onClick={handleUpdate}>
    <RefreshCw size={14} />
    更新到 v{latestVersion}
  </button>
)}
<span className="topbar-version" title="当前版本">v{version}</span>
```

更新进度弹窗：
- 显示当前步骤（拉取代码 → 安装依赖 → 构建后端 → 构建前端 → 重启）
- 进度条
- 完成后 3 秒自动刷新页面

### 3.7 安全考虑

- `/api/version/update` 接口仅管理员可调用（已有 auth middleware）
- 更新前自动备份数据库（`cp manager.db manager.db.bak`）
- git pull 失败时回滚（`git reset --hard ORIG_HEAD`）
- 构建失败时不上线，保持旧版本运行
- 超时保护：每个步骤最多 2 分钟

### 3.8 部署要求

- 服务器上 `~/factorio` 必须是 git 仓库（已满足）
- 服务器需安装 Node.js + npm（已满足）
- 服务器需能访问 GitHub（`git pull origin main` 需要网络）
- 需要配置 git 远程仓库地址

## 四、实施任务

1. 创建 `backend/config/version.json`，修改 `version.ts` 读取文件
2. 实现 `updateService.ts`（checkUpdate + performUpdate + getUpdateStatus）
3. 添加 `/api/version/check`、`/api/version/update`、`/api/version/update/status` 路由
4. 前端 topbar 添加「检查更新」按钮 + 更新进度弹窗
5. 测试：手动 push 新 commit → 点击检查更新 → 点击更新 → 验证服务重启
