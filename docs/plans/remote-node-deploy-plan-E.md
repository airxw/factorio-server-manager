# 方案 E 可行性方案：浏览器引导 + 用户本地 SSH 工具执行

> 文档性质：可行性方案（仅执行步骤，不区分优先级，不修改代码）
> 日期：2026-07-23
> 关联文档：
> - [docs/remote-node-deploy-research.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/remote-node-deploy-research.md)（架构现状盘点）
> - [docs/remote-node-deploy-research-2-ssh-location.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/remote-node-deploy-research-2-ssh-location.md)（SSH 执行位置深入研究，含 F/G 方案归档）

---

## 一、方案概述

**核心思路**：master 完全零接触 SSH 凭据。前端发起邀请生成，master 仅产出一次性 `link_key` + 引导脚本；用户用自己的 SSH 客户端登录远程机器执行；远程 slave daemon 启动后通过 `link_key` 自注册到 master，master WS 通知前端节点上线。

**安全边界**：master 全程不持有、不传输、不存储任何 SSH 凭据。SSH 操作完全在用户控制的 SSH 客户端与远程机器之间进行。

**与业界对比**：体验等同 Pterodactyl 官方手动模式（业界标杆），安全等级高于所有"master 中转 SSH"方案。

---

## 二、现有基础（已就绪资产，无需开发）

| 资产 | 位置 | 状态 |
|------|------|------|
| nodes 表 + 集群字段 | [20260804000001_extend_nodes_for_cluster.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260804000001_extend_nodes_for_cluster.ts) | ✅ |
| 节点 API（9 端点） | [nodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts) | ✅ |
| NodeService（createInvite/linkSlave/heartbeat） | [nodeService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts) | ✅ |
| DaemonClient 节点路由 | [daemonClientService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/daemonClientService.ts) | ✅ |
| 契约定义 | [panel-api-types.ts](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts) | ✅ |
| 前端节点列表页 | [Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx) | ✅（仅展示，待扩展） |

---

## 三、鉴权设计

### 3.1 三层鉴权体系（已实现 + 待完善）

方案 E 的鉴权分三层，层层递进，每层保护不同资源：

```
┌─────────────────────────────────────────────────────────────────┐
│ 第 1 层：管理员鉴权（JWT + 角色）                                  │
│ 保护：创建邀请、节点列表、详情、删除                              │
│ 方式：authenticateToken 中间件 + requireAdmin（仅 server_admin）  │
│ 谁能访问：登录 master 且角色为 server_admin 的用户                │
│ 代码：nodes.ts createNodesRouter（挂在 authenticateToken 之后）   │
└────────────────────────────┬────────────────────────────────────┘
                             │ admin 创建邀请后
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 第 2 层：邀请密钥（link_key）                                     │
│ 保护：slave 注册（POST /api/nodes/link）                         │
│ 方式：link_key 自鉴权（128 位熵、一次性、SHA-256 hash 存储）      │
│ 谁能访问：持有有效 link_key 的人（admin 通过安全渠道传递给部署者） │
│ 特性：注册成功后 link_key_hash 立即清空（一次性邀请码）            │
│ 代码：nodeService.ts createInvite / linkSlave                    │
└────────────────────────────┬────────────────────────────────────┘
                             │ slave 注册成功后
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 第 3 层：通信密钥（comms_key）                                    │
│ 保护：心跳上报、verify-token 转发                                │
│ 方式：requireCommsKey 中间件（x-comms-key 请求头）               │
│ 谁能访问：持有有效 comms_key 的 slave daemon（注册时由 master 颁发）│
│ 特性：明文存储（双向信任：master→slave + slave→master）           │
│ 代码：nodes.ts requireCommsKey / nodeService.ts verifyCommsKey   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 密钥生成时机决策

**决策：link_key 按需创建（不预生成）**

| 维度 | 按需创建（选定） | deploy.sh 预生成 |
|------|----------------|-----------------|
| 生成时机 | admin 登录前端 → 点击"添加节点" → 即时生成 | master 部署时预生成写入文件 |
| 泄露面 | 零（仅会话内展示，用完即清空 hash） | 文件落盘增加泄露面 |
| 一次性影响 | 无（用完即失效，重新创建即可） | 预生成后不用则浪费；加第二个 slave 仍需重新创建 |
| 首次体验 | 需先登录前端才能加第一个 slave | 部署后立即可用 |
| 撤销能力 | 随时删除 pending 节点即撤销 | 文件残留需手动清理 |

**选定理由**：
- link_key 是一次性的（注册后即清空 hash），预生成只能注册一个 slave，加第二个仍需重新创建，预生成收益有限
- 按需创建零泄露面，符合方案 E"master 零接触凭据"的安全目标
- admin 登录前端是已有流程，不增加额外门槛

### 3.3 密钥流转全链路（安全边界）

```
[admin 浏览器]                                    [slave 机器]
      │                                                │
      │ 1. 登录 master（JWT）                          │
      │──────────────────────────────────────────────→│
      │                                                │
      │ 2. POST /api/nodes（创建邀请）                  │
      │   ← 返回 link_key（仅此一次明文）               │
      │                                                │
      │ 3. admin 复制 link_key / 下载 bootstrap.sh     │
      │                                                │
      │ 4. admin 通过安全渠道传递给部署者               │
      │   （当面/加密通讯/内部工单）                    │
      │                                                │
      │                            5. 部署者 SSH 登录 slave ──→ [slave]
      │                                                │
      │                            6. 执行 bootstrap.sh         │
      │                                （含 link_key）            │
      │                                                │
      │                            7. slave daemon 启动           │
      │                                                │
      │ ←────── 8. slave 调用 POST /api/nodes/link ────│
      │          （携带 link_key 自鉴权）               │
      │                                                │
      │ 9. master 校验 link_key → 颁发 comms_key        │
      │    → 清空 link_key_hash（一次性）               │
      │                                                │
      │ ←──── 10. slave 定时 heartbeat（comms_key）────│
      │                                                │
      │ 11. master WS 通知前端"节点已上线"               │
      │ ←──── node.linked 事件 ────────────────────────│
      │                                                │
[admin 浏览器]                                    [slave 机器]
```

**安全边界验证**：
- master 全程不接触 SSH 凭据（步骤 5-6 在部署者 SSH 客户端与 slave 之间进行）
- link_key 仅在步骤 2 返回一次明文，之后 master 仅存 hash
- comms_key 由 master 颁发给 slave（步骤 9），用于后续心跳与 verify-token
- link_key 注册后立即失效（不可重放攻击）

### 3.4 各端点鉴权矩阵

| 端点 | 鉴权方式 | 谁可访问 | 用途 | 状态 |
|------|---------|---------|------|------|
| `POST /api/nodes` | JWT + requireAdmin | server_admin | 创建邀请 | ✅ |
| `GET /api/nodes` | JWT | 已登录用户 | 节点列表 | ✅ |
| `GET /api/nodes/:id` | JWT | 已登录用户 | 节点详情 | ✅ |
| `DELETE /api/nodes/:id` | JWT + requireAdmin | server_admin | 删除节点 | ✅ |
| `GET /api/nodes/:id/disk-usage` | JWT | 已登录用户 | 磁盘占用 | ✅ |
| `GET /api/nodes/:id/javas` | JWT | 已登录用户 | Java 扫描 | ✅ |
| `POST /api/nodes/link` | link_key 自鉴权 | 持有有效邀请密钥者 | slave 注册 | ✅ |
| `POST /api/nodes/:id/heartbeat` | comms_key 自鉴权 | 已注册的 slave | 心跳上报 | ✅ |
| `POST /api/nodes/verify-token` | comms_key 自鉴权 | 已注册的 slave | token 转发验证 | ✅ |
| `GET /api/nodes/release` | JWT + requireAdmin | server_admin | 下载 release tar | ❌ 待开发 |
| `POST /api/nodes/:id/regenerate-invite` | JWT + requireAdmin | server_admin | 重新生成邀请 | ❌ 待开发 |

### 3.5 密钥安全特性

**link_key（邀请密钥）**：
- 熵：128 位（`crypto.randomBytes(16)` → 32 hex 字符）
- 格式：`gsp_link_<32hex>`
- 存储：SHA-256 hash 存储（不存明文）
- 生命周期：创建时返回一次明文 → 注册成功后 hash 清空 → 不可重用
- 传输：master → admin（HTTPS） → admin 安全渠道 → 部署者 → slave bootstrap.sh

**comms_key（通信密钥）**：
- 熵：128 位
- 格式：`gsp_comms_<32hex>`
- 存储：明文存储（原因：双向信任，master 需用它调用 slave，slave 也需用它访问 master）
- 生命周期：注册时颁发 → 持久化到 slave 本地 `daemon/.comms_key` → 直到节点被删除
- 传输：master → slave（HTTPS，link 注册响应体）

**DAEMON_TOKEN（master 共享 token）**：
- 用途：slave 首次 link 时作为 Bearer 认证（之后切换为 comms_key）
- 来源：master 部署时环境变量 `DAEMON_TOKEN`
- 注入方式：由 slave-bootstrap.sh 写入 `daemon/.env`
- 风险：DAEMON_TOKEN 在 slave 端明文存储于 .env —— 可接受（slave 机器本身受 admin 控制）

### 3.6 前端页面访问控制

- "添加节点"对话框：仅 server_admin 可见（前端 `requireAdmin` 组件包裹）
- 节点列表页：已登录用户可查看（不含敏感字段，comms_key/link_key_hash 不返回前端）
- "重新生成邀请"按钮：仅 server_admin 可操作
- "删除节点"按钮：仅 server_admin 可操作

---

## 四、待开发清单（执行步骤）

### 模块 1：daemon 端 SLAVE_MODE 实现

> 基础工作，不可避免。无论手动/自动模式均依赖此基础。

**1.1** 在 [daemon/src/index.ts](file:///home/airxw/Documents/gsp/gameserver-panel/daemon/src/index.ts) 读取环境变量：`SLAVE_MODE`、`MASTER_URL`、`LINK_KEY`、`DAEMON_TOKEN`

**1.2** 拆分 daemon 启动逻辑为 master/slave 双模式：
- master 模式（默认）：维持现状
- slave 模式：
  - 启动时调用 `POST {MASTER_URL}/api/nodes/link`，body `{ slave_url, link_key }`，获取 `comms_key`
  - 持久化 `comms_key` 到本地文件 `daemon/.comms_key`（避免重启丢失）
  - 后续重启时优先读已持久化的 comms_key；若 master 拒绝则重新 link

**1.3** Bearer Token 切换：
- master 模式：`Authorization: Bearer {DAEMON_TOKEN}`
- slave 模式：`Authorization: Bearer {comms_key}`

**1.4** 实现定时心跳：每 10s 调用 `POST {MASTER_URL}/api/nodes/:id/heartbeat`，上报 CPU/内存/磁盘/实例数/daemon_version

**1.5** 实现 verify-token 转发：slave 收到请求时若 `Authorization` 不是 comms_key，则转发到 master `/api/nodes/verify-token`

**1.6** daemon 端单元测试覆盖 slave 模式启动/注册/心跳/重启恢复

### 模块 2：master 端 slaveCommand 模板修正

**2.1** 修正 [nodeService.ts:224](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts#L224) 的 `slaveCommand` 模板：
- `MASTER_URL` 改为生产实际地址 `https://gsp.ecsrz.com:3001`（按 rules 0.md，HTTPS 主入口；或从环境变量 `PUBLIC_BASE_URL` 读取，避免硬编码）
- `DAEMON_TOKEN` 直接注入值（当前模板写 `${DAEMON_TOKEN}` 是 bash 变量引用，但 slave 机器无此变量）
- 模板改为完整可执行命令，非占位符

**2.2** 新增 `GET /api/nodes/release` 端点：提供项目 release tar 下载，供 slave bootstrap 脚本 `curl` 拉取（slave 机器无项目源码）

**2.3** 新增 `POST /api/nodes/:id/regenerate-invite` 端点：失败重试时重新生成 link_key（当前 link_key 一次性，注册后即清空）

**2.4** WS 事件 `node.linked` 广播：slave 注册成功时通知所有在线前端，触发节点列表刷新

**2.5** WS 事件 `node.offline` 广播：slave 心跳超时标记 offline 时通知前端

### 模块 3：slave-bootstrap.sh 脚本编写

**3.1** 编写独立 `slave-bootstrap.sh`（参数化），放置于项目根目录 `scripts/slave-bootstrap.sh`

**3.2** 脚本参数：`MASTER_URL`、`LINK_KEY`、`DAEMON_TOKEN`、可选 `INSTALL_DIR`（默认 `/opt/gsp-slave`）

**3.3** 脚本步骤：
- 检查/安装 Node.js 20+（支持 apt-get）
- 创建 `gameserver` 用户（如不存在）
- 从 `MASTER_URL/api/nodes/release` 下载 release tar
- 解压到 `$INSTALL_DIR`，仅保留 `daemon/`、`public/`、`package.json`、`node_modules/`
- 执行 `npm install --production`（若未携带 node_modules）
- 生成 `daemon/.env`：注入 `SLAVE_MODE=true`、`MASTER_URL`、`LINK_KEY`、`DAEMON_TOKEN`、`PORT=8080`
- 创建 systemd 服务 `gameserver-slave-daemon.service`
- 启动 daemon
- daemon 启动后调用 master `/api/nodes/link` 自注册

**3.4** 幂等性：脚本可重复执行（已存在则跳过/更新）

**3.5** 失败清理：执行失败时清理已创建的 systemd 服务 + 部署目录

**3.6** 跨发行版支持：首版支持 Debian/Ubuntu（apt-get），后续可扩展 yum/dnf

### 模块 4：前端添加节点 UI

**4.1** 在 [Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx) 新增"添加节点"按钮（requireAdmin）

**4.2** 实现 `AddNodeDialog` 组件，包含三个 Tab：

- **Tab 1 "复制命令"**：
  - 调用 `POST /api/nodes` 创建邀请
  - 展示返回的 `slave_command` 文本框（只读）+ "复制" 按钮
  - 展示 `link_key`（只读，方便用户核对）

- **Tab 2 "下载脚本"**：
  - 调用 `POST /api/nodes` 创建邀请（或复用 Tab 1 的邀请）
  - 生成参数化 `deploy-slave.sh`（基于 `scripts/slave-bootstrap.sh` 模板，注入 MASTER_URL/LINK_KEY/DAEMON_TOKEN）
  - "下载 .sh" 按钮：触发浏览器下载

- **Tab 3 "手动步骤"**：
  - 分步教程（图文）：
    1. SSH 登录远程机器
    2. 安装 Node.js 20+（提供 apt-get 命令）
    3. 下载 release（提供 `curl` 命令，从 `MASTER_URL/api/nodes/release`）
    4. 解压并 `npm install --production`
    5. 配置 `daemon/.env`（展示完整内容，含 LINK_KEY）
    6. 创建 systemd 服务（提供完整 unit 文件）
    7. 启动 daemon

**4.3** 状态指示器：
- 创建邀请后显示"等待节点注册..."（旋转图标）
- 订阅 WS 事件 `node.linked` 或轮询 `GET /api/nodes/:id`
- 注册成功后自动关闭对话框 + 刷新节点列表
- 超时提示（5 分钟未注册）+ "重新生成邀请" 按钮

**4.4** 节点列表增加操作：
- "重新生成邀请"（对 pending 节点）
- "删除节点"（对 pending/offline 节点，已有 API）

### 模块 5：前端 API 客户端扩展

**5.1** 在 [panel/frontend/src/api/modules/servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/servers.ts) 扩展节点相关方法：
- `createNodeInvite(name, displayFqdn?)` → 调用 `POST /api/nodes`
- `regenerateInvite(nodeId)` → 调用 `POST /api/nodes/:id/regenerate-invite`
- `getNodeReleaseUrl()` → 返回 `MASTER_URL/api/nodes/release` 下载地址

**5.2** WebSocket 事件订阅：
- 订阅 `node.linked` 事件
- 订阅 `node.offline` 事件
- 事件触发后刷新节点列表

### 模块 6：契约更新

**6.1** 更新 [public/schema/panel-api-types.ts](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts)：
- 新增 `RegenerateInviteRequest`、`RegenerateInviteResponse`
- 新增 `NodeLinkedEvent`、`NodeOfflineEvent`（WS 事件 payload）
- 新增 `GetNodeReleaseResponse`（返回 release 下载信息）

**6.2** 更新 [public/config_template/daemon.env.template](file:///home/airxw/Documents/gsp/gameserver-panel/public/config_template/daemon.env.template)：
- 新增 `SLAVE_MODE`（默认 false）
- 新增 `MASTER_URL`（slave 模式必填）
- 新增 `LINK_KEY`（slave 模式首次启动必填）
- 注释说明 `DAEMON_TOKEN` 在 slave 模式下用于首次 link 注册

**6.3** 更新 [public/interface_stub/daemon-client.d.ts](file:///home/airxw/Documents/gsp/gameserver-panel/public/interface_stub/daemon-client.d.ts)：
- 扩展 slave 模式接口签名

### 模块 7：测试

**7.1** 后端单元测试：
- nodeService.createInvite / regenerateInvite
- nodeService.linkSlave（linkKey 一次性、commsKey 颁发）
- `GET /api/nodes/release` 端点

**7.2** daemon 端单元测试：
- slave 模式启动
- link 注册流程
- heartbeat 上报
- 重启恢复（读持久化 comms_key）

**7.3** 前端组件测试：
- AddNodeDialog 三个 Tab 切换
- 复制命令功能
- 下载脚本功能
- 状态指示器（pending → online）

**7.4** 集成测试：
- master + slave 双进程联调
- slave 注册全流程（启动 → link → heartbeat → master 标记 online）

**7.5** E2E 测试：
- 前端添加节点（手动模式）
- 节点注册成功后列表刷新

---

## 五、关键技术点

### 5.1 slaveCommand 模板修正（必须）

当前 [nodeService.ts:224](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts#L224) 模板：

```
SLAVE_MODE=true MASTER_URL=http://<master-host>:3000 LINK_KEY=${linkKey} DAEMON_TOKEN=\${DAEMON_TOKEN} npm start
```

修正后（建议从环境变量 `PUBLIC_BASE_URL` 读取，默认 `https://gsp.ecsrz.com:3001`）：

```
SLAVE_MODE=true MASTER_URL=https://gsp.ecsrz.com:3001 LINK_KEY=gsp_link_xxxx DAEMON_TOKEN=<实际值> npm start
```

### 5.2 release tar 打包

master 需提供 release tar 下载端点，包含 slave 所需最小文件集：
- `daemon/`（完整源码）
- `public/`（schema + interface_stub + config_template）
- `package.json`（顶层，含 daemon 依赖）
- `node_modules/`（可选，预装可避免 slave 端 npm install）

### 5.3 slave daemon .env 生成

slave-bootstrap.sh 生成 `daemon/.env` 内容：

```
SLAVE_MODE=true
MASTER_URL=https://gsp.ecsrz.com:3001
LINK_KEY=gsp_link_xxxx
DAEMON_TOKEN=<master 的 DAEMON_TOKEN>
PORT=8080
LOG_LEVEL=info
```

### 5.4 systemd 服务文件

`gameserver-slave-daemon.service`：

```
[Unit]
Description=GSP Slave Daemon
After=network.target

[Service]
Type=simple
User=gameserver
WorkingDirectory=/opt/gsp-slave/daemon
EnvironmentFile=/opt/gsp-slave/daemon/.env
ExecStart=/usr/bin/node /opt/gsp-slave/daemon/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 4.5 网络要求

- slave 出站：访问 `master:3001`（HTTPS）—— 用于 link 注册 + heartbeat + verify-token
- master 出站：访问 `slave:8080`（HTTP）—— 用于实例管理（start/stop/command）
- slave 的 8080 端口仅局域网/VPN 可达（对公网禁用，按 rules）
- 用户 SSH 客户端 → slave:22（用户自行控制）

### 5.6 版本一致性

master 与 slave 的 daemon 版本必须一致。slave-bootstrap.sh 下载的 release tar 版本由 master 当前运行版本决定。master 升级后需重新部署 slave（或后续提供 slave 升级流程）。

---

## 五、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 用户不会使用 SSH 客户端 | Tab 3 提供详细图文教程；"复制命令"一键搞定 |
| link_key 一次性，部署失败需重新生成 | UI 提供"重新生成邀请"按钮 |
| slave 无法访问 master:3001 | 脚本前置网络连通性检查 |
| 跨发行版兼容（仅 apt-get） | 首版仅支持 Debian/Ubuntu，文档明确说明 |
| master/slave 版本不一致 | release tar 由 master 当前版本决定；升级时重新部署 slave |
| slave 重启后 comms_key 丢失 | 持久化到 `daemon/.comms_key` 文件 |
| 节点长时间 pending 占用列表 | 提供"删除节点"操作（已有 API） |

---

## 七、验收标准

- [ ] 前端"添加节点"对话框可用，三个 Tab 均可展示完整引导
- [ ] `slave-bootstrap.sh` 可在干净 Debian/Ubuntu 机器上一键部署 slave daemon
- [ ] slave daemon 启动后自动注册到 master，master 标记节点 online
- [ ] master WS 推送 `node.linked` 事件，前端自动刷新
- [ ] slave 定时心跳上报，master 心跳超时标记 offline 并 WS 通知
- [ ] 节点列表可查看 slave 节点状态（online/offline/pending）
- [ ] 可删除 pending/offline 节点
- [ ] master 全程不接触任何 SSH 凭据（安全边界验证）
- [ ] daemon 端 slave 模式单元测试通过
- [ ] 集成测试：master + slave 双进程注册全流程通过

---

## 八、未来规划归档（不设版本号，仅记录）

以下方案已归档于 [docs/remote-node-deploy-research-2-ssh-location.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/remote-node-deploy-research-2-ssh-location.md)，作为未来宏观规划参考，当前不实施：

- **方案 F**：浏览器内 WebSSH（xterm.js + master WS 中转 + ssh2 + 凭据加密存储）
- **方案 G**：混合模式（方案 E 默认 + 方案 F 可选高级模式）

触发条件：用户反馈方案 E 体验不够便利，且有强需求要"完全浏览器内一键部署"时，再评估是否启动方案 F/G。
