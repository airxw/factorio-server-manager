---
type: plan
title: 部署节点「添加节点」逻辑修复方案
date: 2026-07-26
status: reviewed
related:
  - panel/frontend/src/pages/admin/Nodes.tsx
  - panel/backend/src/api/routes/nodes.ts
  - panel/backend/src/services/nodeService.ts
  - panel/backend/src/services/nodeService.test.ts
  - public/schema/panel-api-types.ts
  - .trae/rules/0.md
  - .trae/rules/bb.md
tags: [nodes, slave-registration, bugfix, cluster, bootstrap-script, invite-expiry]
---

# 部署节点「添加节点」逻辑修复方案

## 一、问题现状

入口：`https://gsp.ecsrz.com:3001/admin/nodes` → 顶部「添加节点」按钮

涉及代码：

- 前端：[panel/frontend/src/pages/admin/Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L211-L386)
- 后端路由：[panel/backend/src/api/routes/nodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts#L242-L262)
- 后端服务：[panel/backend/src/services/nodeService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts#L226-L264)

整体流程符合「邀请制 slave 注册」预期：管理员创建邀请 → 生成 linkKey → 在 slave 机器执行命令 → slave 调 `/api/nodes/link` 完成注册 → 节点转 online。但实现层存在以下 8 处问题：

| # | 问题 | 性质 |
|---|------|------|
| 1 | bootstrap 脚本由前端字符串拼接生成（[Nodes.tsx:261-368](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L261-L368)） | 设计问题 |
| 2 | 硬编码 GitHub 仓库地址 `https://github.com/airxw/GSP-Panel.git`（[Nodes.tsx:312](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L312)） | 设计问题 |
| 3 | `npm install --production` 之后 `npm run build` 必失败（[Nodes.tsx:317-318](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L317-L318)），devDependencies 未安装导致 tsc 缺失 | 明确 Bug |
| 4 | `slave_command`（单行命令）与 bootstrap 脚本指向不一致的执行方式，前者假设项目代码已就绪，后者从零部署 | 设计问题 |
| 5 | 8080 端口在前端生成的脚本中硬编码（[Nodes.tsx:326](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L326)） | 设计问题 |
| 6 | 后端已实现 `POST /:id/regenerate-invite`（[nodes.ts:277-289](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts#L277-L289)），前端无任何调用入口 | 功能缺口 |
| 7 | linkKey 无过期机制，pending 节点的 linkKey 长期有效，泄露后可被任意 slave 注册 | 安全设计缺口 |
| 8 | `slave_command` 中 `LINK_KEY=xxx` 明文暴露在命令行，进入 shell history / `/proc/<pid>/environ` | 安全设计缺口 |

## 二、执行步骤

### 步骤 1：后端新增 bootstrap 脚本生成端点

**目标**：将脚本生成逻辑从前端迁移到后端，解决「前端拼接 shell + 硬编码仓库地址 + 端口硬编码」三个问题。

- 新增路由 `POST /api/nodes/invite/bootstrap-script`（body: `{ link_key: string }`）
- 采用 POST + body 方案而非 `GET /invite/:linkKey/bootstrap-script`，避免 linkKey 进入 nginx access log、浏览器历史（详见 4.4 安全建议）
- 该端点为公开路由（与 `/link` 同组），因为 slave 机器此时尚未注册、无 commsKey
- 通过 linkKey 反查 nodes 表，校验节点存在且 status='pending'、未过期
- 在后端用模板文件生成完整 shell 脚本，返回 `Content-Type: text/x-shellscript` + `Content-Disposition: attachment; filename="slave-bootstrap.sh"` + `Cache-Control: no-store`
- 脚本内参数（MASTER_URL、仓库地址、端口、安装目录）全部从后端配置读取，不写死

**涉及文件**：

- 新增 `panel/backend/src/services/bootstrapScriptTemplate.ts`（脚本模板生成器）
- 新增 `panel/backend/src/api/routes/nodes.ts` 中 `POST /invite/bootstrap-script` 路由（在 `createNodesPublicRouter` 中注册）
- 新增 `panel/backend/src/config/slaveDeploy.ts`（slave 部署配置：仓库地址、端口、安装目录等）

### 步骤 2：修复 bootstrap 脚本内容

**目标**：解决步骤 1 问题表中的 Bug #3。

**关键背景**：项目是 npm workspaces 结构，根 `package.json` 声明 `workspaces: ["panel/backend", "panel/frontend", "daemon"]`，`package-lock.json` **只在根目录**，`daemon/` 子目录无独立 lockfile。因此所有 npm 命令必须在项目根目录执行。

- 将 `npm install --production`（原 L317 在 `$INSTALL_DIR/daemon` 目录执行）改为在**项目根目录**执行 `npm ci`
- 推荐方案（在 `$INSTALL_DIR` 根目录执行）：

  ```bash
  cd "$INSTALL_DIR"
  npm ci                                 # 根目录 lockfile，安装所有 workspace 依赖（含 devDependencies）
  npm run build -w daemon                # 构建 daemon 子项目（typescript 在 devDependencies 中）
  npm prune --production                 # 清理所有 workspace 的 devDependencies，仅留运行时依赖
  ```

- 校验构建产物 `$INSTALL_DIR/daemon/dist/index.js` 存在后再创建 systemd 服务
- 注意：`npm prune --production` 会删除所有 workspace 的 devDependencies（包括 panel/backend、panel/frontend）。slave 机器仅运行 daemon，不影响；但脚本中需注释说明此约束
- daemon/tsconfig.json `extends: "../tsconfig.json"`，编译时需访问根 tsconfig 与 `../public/**/*.ts`，必须在项目根目录完成 clone 后再构建，不能单独 clone daemon 子目录

### 步骤 3：前端改为下载后端脚本

**目标**：消除前端生成脚本逻辑。

- 删除 [Nodes.tsx:261-368](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L261-L368) 的 `generateBootstrapScript` 函数
- 删除 [Nodes.tsx:371-386](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L371-L386) 的 `downloadBootstrapScript` 中前端拼装逻辑
- 「下载脚本」按钮改为：fetch `POST /api/nodes/invite/bootstrap-script`（body: `{ link_key }`）→ response.blob() → 触发浏览器下载
- 下载按钮文案保持「下载 slave-bootstrap.sh」
- 前端 API 客户端新增 `api.downloadBootstrapScript(linkKey): Promise<Blob>` 方法（返回 Blob 而非 JSON）

### 步骤 4：统一三种部署方式的语义

**目标**：解决 Bug #4，让 command / script / manual 三个 Tab 指向一致的执行路径。

- **command Tab**（单行命令）：仅适用于「已 clone 项目代码且依赖已装」的 slave 机器。UI 上增加显著提示：「适用于已部署项目代码的机器；新机器请用下方脚本或手动步骤」
- **script Tab**（下载脚本）：从零部署的推荐路径。下载后 `sudo bash slave-bootstrap.sh` 即可
- **manual Tab**（手动步骤）：与脚本逻辑逐项对齐，作为脚本失败时的降级路径

### 步骤 5：前端补 regenerate-invite 入口

**目标**：解决 Bug #6，让 pending 节点可重新生成邀请密钥。

**关键背景**：前端 API 客户端**已实现** `api.regenerateInvite(nodeId)` 方法（[client.ts:1627-1631](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1627)），接口也已声明（[servers.ts:419](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/servers.ts#L419)）。**前端只是缺少 UI 入口调用**，不需要新增 API 客户端方法。

- 在节点列表中，对 `status === 'pending'` 的节点行（含 linkKey 已过期的），操作列增加「重新生成邀请」按钮
- linkKey 已过期的 pending 节点应在行内高亮提示「邀请已过期」
- 点击后弹出确认框（二次确认，因为旧 linkKey 会失效）
- 调用 `api.regenerateInvite(nodeId)`（已存在的方法，无需新增）
- 成功后复用现有 `AddNodeState.result` 渲染邀请结果弹窗（展示新的 linkKey + slave_command + 下载按钮）

**涉及文件**：

- 修改 [panel/frontend/src/pages/admin/Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx)（新增按钮 + 调用，无需修改 API 层）

### 步骤 6：后端补 linkKey 过期机制

**目标**：解决 Bug #7，限制 linkKey 有效期。

- `nodes` 表新增字段 `link_key_expires_at`（ISO8601 字符串， nullable）
- `createInvite` 生成 linkKey 时写入 `link_key_expires_at = now + 24h`（默认 24 小时，可通过 `SLAVE_LINK_KEY_TTL_HOURS` 配置调整）
- `regenerateInvite` 同样刷新过期时间
- `linkSlave` 校验：若 `link_key_expires_at < now`，返回 401 `NODE_LINK_KEY_EXPIRED`
- 前端 Nodes.tsx 在 pending 节点行展示「邀请将于 X 时间过期」，过期后展示「已过期，点击重新生成」

**迁移文件命名**：项目实际格式为 `YYYYMMDDHHMMSS_xxx.ts`（参考 `20260822000000_clear_non_builtin_users.ts`）。本次迁移文件命名为 `20260826000001_add_link_key_expires_at_to_nodes.ts`（实际执行时按当日时间戳调整）。

**历史 pending 节点回填策略**（三选一，**推荐方案 C**）：

| 方案 | 处理方式 | 安全性 | 兼容性 |
|------|---------|--------|--------|
| A. 强制失效 | 迁移时不回填，NULL 视为「已过期」，所有历史 pending 节点必须重新生成邀请 | 最高 | 破坏向后兼容 |
| B. 续期 + 告警 | 回填 `now + 24h`，管理后台高亮提示「N 个历史 pending 节点已自动续期，请确认有效性」 | 中（泄露 linkKey 仍有 24h 窗口） | 良好 |
| **C. 短窗口续期（推荐）** | 回填 `now + 1h`，给管理员 1 小时窗口处理历史 pending 节点，过期后强制重新生成 | 较高（泄露 linkKey 仅 1h 窗口） | 良好 |

**down() 函数实现**：项目使用 sqlite3 npm 包 v5.1.7（自带静态编译 SQLite ≥ 3.35），`ALTER TABLE ... DROP COLUMN` 在理论上可用。但为兼容性保险，down() 应使用「重建表」方式（CREATE NEW TABLE → INSERT SELECT → DROP OLD → RENAME），而非直接 `DROP COLUMN`。

**涉及文件**：

- 新增 `panel/backend/src/db/migrations/20260826000001_add_link_key_expires_at_to_nodes.ts`
- 修改 [panel/backend/src/services/nodeService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts)（createInvite / regenerateInvite / linkSlave 三处）
- 修改 `public/schema/panel-api-types.ts`（CreateNodeInviteResponse 增加 `expires_at` 字段）
- 修改 [panel/frontend/src/pages/admin/Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx)（展示过期时间 + 过期高亮提示）

### 步骤 7：LINK_KEY 传递方式优化

**目标**：解决 Bug #8，避免 linkKey 进入 shell history / 进程 environ。

- `slave_command` 改为引导用户写入 `.env` 文件，而非命令行参数：

  ```bash
  # 在项目根目录下创建 daemon/.env
  cd /opt/gsp-slave   # 或你的项目安装目录
  cat >> daemon/.env << 'EOF'
  SLAVE_MODE=true
  MASTER_URL=https://gsp.ecsrz.com:3001
  LINK_KEY=<粘贴你的 linkKey>
  EOF
  cd daemon && npm start
  ```

- bootstrap 脚本内部保持现状（脚本内部用 heredoc 写入 `.env`，不经过命令行参数，已经是安全的方式）
- manual Tab 与新的 command Tab 保持一致，应包含五步逐条说明：
  1. `git clone` 项目到 `$INSTALL_DIR`
  2. `cd $INSTALL_DIR && npm ci`（根目录安装 workspace 依赖）
  3. `npm run build -w daemon`（构建 daemon）
  4. 写入 `daemon/.env`（heredoc 方式，含 SLAVE_MODE / MASTER_URL / LINK_KEY / PORT）
  5. 创建 systemd 服务并启动

## 三、开发事项

### 3.1 后端开发事项

1. **新增 `panel/backend/src/config/slaveDeploy.ts`**

   - 读取环境变量：`SLAVE_REPO_URL`（默认 `https://github.com/airxw/GSP-Panel.git`）、`SLAVE_INSTALL_DIR`（默认 `/opt/gsp-slave`）、`SLAVE_PORT`（默认 `8080`）、`SLAVE_LINK_KEY_TTL_HOURS`（默认 `24`）
   - 提供配置校验（zod schema）与默认值填充

2. **新增 `panel/backend/src/services/bootstrapScriptTemplate.ts`**

   - 导出 `generateBootstrapScript(params: { masterUrl, linkKey, repoUrl, installDir, port }): string`
   - 脚本内容与现有前端逻辑对齐，但修复 Bug #3（npm ci 替代 npm install --production）
   - 仓库地址、端口、安装目录全部参数化

3. **修改 `panel/backend/src/api/routes/nodes.ts`**

   - `createNodesPublicRouter` 中新增 `POST /invite/bootstrap-script` 路由（body: `{ link_key: string }`）
   - 路由内校验 linkKey 对应节点存在且 pending，未过期
   - 调用 `bootstrapScriptTemplate.generateBootstrapScript` 生成内容
   - 设置响应头 `Content-Type: text/x-shellscript; charset=utf-8`、`Content-Disposition: attachment; filename="slave-bootstrap.sh"`、`Cache-Control: no-store`

4. **修改 `panel/backend/src/services/nodeService.ts`**

   - `createInvite` / `regenerateInvite` 返回值增加 `expiresAt` 字段
   - `linkSlave` 增加 linkKey 过期校验

5. **新增数据库迁移**

   - 文件名：`panel/backend/src/db/migrations/20260826000001_add_link_key_expires_at_to_nodes.ts`（实际执行时按当日时间戳）
   - up 操作：`ALTER TABLE nodes ADD COLUMN link_key_expires_at TEXT`（SQLite 兼容写法）
   - up 操作额外：对 `status='pending'` 的历史节点回填 `link_key_expires_at = now + 1h`（方案 C 短窗口续期）
   - down 操作：使用「重建表」方式（CREATE NEW TABLE without column → INSERT SELECT → DROP OLD → RENAME），不依赖 `ALTER TABLE DROP COLUMN`

### 3.2 契约开发事项

6. **修改 `public/schema/panel-api-types.ts`**

   - `CreateNodeInviteResponse` 新增 `expires_at: string`（ISO8601）
   - 新增 `LinkKeyExpiredError` 错误码：`NODE_LINK_KEY_EXPIRED`

### 3.3 前端开发事项

7. **修改 `panel/frontend/src/pages/admin/Nodes.tsx`**

   - 删除 `generateBootstrapScript` 函数（[L261-L368](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L261-L368)）
   - 修改 `downloadBootstrapScript`：改为调用 `api.downloadBootstrapScript(linkKey)`（fetch POST + blob）→ 触发浏览器下载
   - `command` Tab 内容改为 `.env` 写入方式（步骤 7）
   - pending 节点行增加「重新生成邀请」按钮与「邀请将于 X 过期」提示
   - linkKey 已过期的 pending 节点行高亮提示「邀请已过期」
   - 邀请结果弹窗展示 `expires_at`

8. **修改 `panel/frontend/src/api/client.ts` + `panel/frontend/src/api/modules/servers.ts`**

   - 新增 `api.downloadBootstrapScript(linkKey: string): Promise<Blob>` 方法
   - 接口声明 `downloadBootstrapScript(linkKey: string): Promise<Blob>` 加入 `ServersApi`
   - 实现走 fetch POST `/api/nodes/invite/bootstrap-script`，body: `{ link_key: linkKey }`，返回 response.blob()（不走标准 JSON 错误处理，需单独处理 401/404 等 error response）
   - `api.regenerateInvite(nodeId)` 已在 [client.ts:1627](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1627) 实现无需新增

### 3.4 测试开发事项

9. **后端单测**

   - `nodeService.test.ts` 新增用例：
     - `createInvite` 返回的 `expiresAt` 不为空且在预期窗口内
     - `linkSlave` 对过期 linkKey 抛 `NODE_LINK_KEY_EXPIRED`
     - `regenerateInvite` 刷新 `expiresAt`
   - 新增 `bootstrapScriptTemplate.test.ts`：
     - 脚本包含正确的 linkKey / masterUrl / repoUrl
     - 脚本不包含 `npm install --production`（Bug #3 回归）
     - 脚本包含 `npm ci` 或等价正确命令

10. **前端单测**

    - Nodes.tsx 测试：pending 节点行渲染「重新生成邀请」按钮
    - 邀请结果弹窗展示 `expires_at`

11. **E2E 测试**

    - 创建邀请 → 下载脚本 → 脚本内容包含正确参数
    - pending 节点 → 重新生成邀请 → 旧 linkKey 失效
    - 过期 linkKey 调 `/link` 返回 401

## 四、建议

### 4.1 部署建议

- 本次修复涉及数据库字段新增（`link_key_expires_at`），需在 `version.md` 中标注「含数据库迁移」，部署时先执行迁移再重启服务
- 现有 pending 节点的 `link_key_expires_at` 为 NULL，`linkSlave` 校验逻辑需兼容：NULL 视为「已过期」（强制失效），或迁移时为现有 pending 节点回填
- **采用步骤 6 推荐方案 C**：迁移时对 `status='pending'` 的节点回填 `link_key_expires_at = now + 1h`（短窗口续期），1 小时后未注册的 pending 节点强制重新生成邀请
- 部署后管理后台应在节点列表高亮提示「N 个历史 pending 节点已自动续期 1h，请确认有效性」

### 4.2 文档建议

- 更新 `docs/guides/standard_deployment_guide.md`：补充 slave 节点部署章节，指向新的 bootstrap-script 端点
- 更新 `docs/api/06-daemon.md`：补充 `POST /api/nodes/invite/bootstrap-script` 与 `POST /api/nodes/:id/regenerate-invite` 两个端点说明

### 4.3 版本建议

- 按版本规则（`bb.md`）：本次为 bug 修复 + 现有功能修改 + 微量增加（regenerate-invite 前端接入 + linkKey 过期机制 + bootstrap-script 端点），应递增小版本号
- 当前主版本为 `v4.24.0`（详见 `version.json`），本次修复后应为 `v4.24.1`
- `version.md` 需追加本次修复条目，包含：8 个问题点修复说明、数据库迁移提示、新端点说明

### 4.4 安全建议

- linkKey 默认 24 小时过期可通过 `SLAVE_LINK_KEY_TTL_HOURS` 环境变量调整，生产环境不建议超过 72 小时
- 若 slave 机器处于内网且 master 通过公网访问 slave 端口，需注意 8080 端口对外禁用规则（见 [rules/0.md](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/0.md)）；slave daemon 监听 8080 本身合规，但 master 访问 slave 时应走 slave 机器的公网或 VPN 地址，不应暴露 slave 的 8080 到公网
- **linkKey 在 URL 路径中的日志泄露考量**（步骤 1 端点 `GET /api/nodes/invite/:linkKey/bootstrap-script`）：
  - linkKey 是一次性密钥且 24h 过期，风险可控，但仍会进入 nginx access log、反代日志、浏览器历史
  - 缓解措施（推荐组合使用）：
    1. nginx 配置中排除 `/api/nodes/invite/` 路径的 access log：`location /api/nodes/invite/ { access_log off; proxy_pass ...; }`
    2. 响应头加 `Cache-Control: no-store`，防止浏览器缓存
    3. 下载完成后立即调用 `regenerateInvite` 让 linkKey 失效（可选，权衡：用户重复下载需重新生成邀请）
  - 替代方案：改为 `POST /api/nodes/invite/bootstrap-script` + body `{ link_key }`，可避免 URL 日志泄露，但代价是不能用浏览器直接下载，需前端 fetch + Blob（与步骤 3 的 fetch + Blob 实现一致，建议采用）
  - **最终选择**：采用 POST + body 方案，与步骤 3 的前端 fetch + Blob 下载实现保持一致，避免 nginx 日志配置改动

### 4.5 验证建议

- 修复完成后，在测试环境完整跑一遍：创建邀请 → 下载脚本 → 在干净 Debian/Ubuntu 机器执行脚本 → 验证 slave 注册成功 → 验证节点转 online
- 特别验证 Bug #3 回归：脚本执行后 `dist/index.js` 存在且 systemd 服务能启动
- 验证 linkKey 过期：手动修改 `link_key_expires_at` 为过去时间，调用 `/link` 应返回 401
