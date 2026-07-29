# 远程节点自动部署方向调研

> 调研日期：2026-07-23
> 调研范围：在 GSP 现有分层 + 前后端分离 + 多服务器管理架构基础上，评估"前端填写远程 SSH 信息 → 项目自动部署 slave daemon 集群"的可行性、实现路径与方案选择
> 调研性质：方向性研究，不进入执行阶段

---

## 一、项目现状盘点

### 1.1 整体架构

- 分层 + 前后端分离
- Panel（Node/Express）+ Daemon（Node/Express）双进程同机部署
- Panel 后端监听 `127.0.0.1:3002`（内部端口，nginx 反代到 `3001` HTTPS / `3000` HTTP 跳转）
- Daemon 监听 `8080`（对公网禁用，仅 Panel 本机调用）
- 前端 React + Vite + nginx 静态托管
- 数据库 SQLite（`data/panel.db`），Knex 抽象层
- `deploy.sh` 为纯本地部署脚本（无 `REMOTE_HOST` 参数），通过 systemctl 启动 systemd 服务

### 1.2 已有的"节点"概念与集群字段

`nodes` 表（[20260703000001_create_core_tables.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260703000001_create_core_tables.ts)）基础字段：
- `id, name, fqdn, daemon_token_hash, public_ip, status, last_seen_at`

L2 集群扩展字段（[20260804000001_extend_nodes_for_cluster.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260804000001_extend_nodes_for_cluster.ts)）：
- `node_type` (master/slave，默认 master)
- `comms_key` (主从通信密钥，明文存储以支持双向信任)
- `link_key_hash` (邀请密钥 SHA-256 hash，一次性)
- `linked_at`
- `display_fqdn`

默认节点 `node-local`（master），通过 `DEFAULT_NODE_ID` 引用（[servers.ts:78](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L78)）；创建实例时未指定 `node_id` 则默认使用 `node-local`。

### 1.3 已有的 L2 集群 API（[nodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts)）

| 端点 | 用途 | 鉴权 | 状态 |
|------|------|------|------|
| `POST /api/nodes` | 创建邀请（返回 link_key + slave_command） | server_admin | ✅ 已实现 |
| `GET /api/nodes` | 节点列表 | JWT | ✅ 已实现 |
| `GET /api/nodes/:id` | 节点详情 | JWT | ✅ 已实现 |
| `DELETE /api/nodes/:id` | 删除节点 | server_admin | ✅ 已实现 |
| `POST /api/nodes/link` | **slave 注册**（验证 linkKey → 颁发 commsKey） | linkKey 自鉴权 | ✅ 已实现 |
| `POST /api/nodes/:id/heartbeat` | slave 心跳上报 | commsKey | ✅ 已实现 |
| `POST /api/nodes/verify-token` | slave 验证 user token | commsKey | ✅ 已实现 |
| `GET /api/nodes/:id/disk-usage` | 节点磁盘占用 | JWT | ✅ 已实现 |
| `GET /api/nodes/:id/javas` | 节点 Java 扫描 | JWT | ✅ 已实现 |

### 1.4 已有的 NodeService（[nodeService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts)）

- `createInvite(name, displayFqdn)` → 返回 `{ nodeId, linkKey, slaveCommand }`
  - `slaveCommand` 模板：`SLAVE_MODE=true MASTER_URL=http://<master-host>:3000 LINK_KEY=${linkKey} DAEMON_TOKEN=${DAEMON_TOKEN} npm start`
- `linkSlave(slaveUrl, linkKey, displayFqdn)` → 返回 `{ nodeId, commsKey }`
- `verifyCommsKey(commsKey)` / `heartbeat(nodeId, payload)` / `markStaleNodesOffline(staleMs=15s)`
- `deleteNode(id)`（删除前校验无活跃实例、master 不可删）
- 设计要点：linkKey 一次性（hash 存储），commsKey 明文存储（双向信任）

### 1.5 DaemonClient 的节点路由（[daemonClientService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/daemonClientService.ts)）

`DaemonClientImpl.getHttpClient(nodeId)` 已支持多节点：
- master 节点（node-local）：baseUrl 用 `defaultBaseUrl`（DAEMON_URL 环境变量），token 用 `defaultToken`（DAEMON_TOKEN）
- slave 节点：baseUrl 用 `http://{fqdn}:8080`，token 用 `comms_key`
- 客户端实例缓存 + `invalidateClient` 接口

### 1.6 已有契约（[panel-api-types.ts:130-224](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L130-L224)）

`NodeClusterInfo`、`ListNodeClusterResponse`、`CreateNodeInviteRequest/Response`、`LinkSlaveRequest/Response`、`NodeHeartbeatRequest/Response`、`VerifyTokenRequest/Response`、`DeleteNodeResponse`

### 1.7 当前断点（v4.9.0 留下的 L2 未完成项）

| 模块 | 状态 | 说明 |
|------|------|------|
| nodes 表 + 集群字段 | ✅ | migration 已就绪 |
| Panel 后端 nodes API | ✅ | 9 个端点全部实现 |
| Panel 后端 NodeService | ✅ | 注册/心跳/校验逻辑完整 |
| DaemonClient 节点路由 | ✅ | 多节点 client 已支持 |
| 契约定义 | ✅ | panel-api-types.ts 已包含 |
| **daemon 端 SLAVE_MODE 实现** | ❌ | `daemon/src/index.ts` 仅读 PORT/DAEMON_TOKEN/DAEMON_ID/LOG_LEVEL，没有读取 SLAVE_MODE/MASTER_URL/LINK_KEY 的代码 |
| **daemon 端 linkSlave 调用** | ❌ | 未实现启动时调用 master `/api/nodes/link` 注册 |
| **daemon 端 heartbeat 上报** | ❌ | 未实现定时上报 |
| **daemon 端 verify-token 转发** | ❌ | 未实现 commsKey 鉴权模式 |
| **前端 Nodes "添加节点" UI** | ❌ | Nodes.tsx 只有展示 + Java 扫描，未调用 `POST /api/nodes` 创建邀请 |
| **前端 slave_command 展示** | ❌ | API 已返回但 UI 未使用 |
| **前端"填写 SSH 信息自动部署"** | ❌ | 完全未实现 |
| **deploy.sh 远程部署能力** | ❌ | 仅本地部署，无 REMOTE_HOST 参数 |
| **SSH 客户端依赖** | ❌ | 顶层 / panel-backend package.json 均无 ssh2 / node-ssh |

### 1.8 设计意图（来源：[gsp-optimization-upgrade-plan.md L2 节](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/documents/gsp-optimization-upgrade-plan.md)）

- **节点注册协议**：slave daemon 携带 linkKey 向 master 注册，获取 commsKey 后持久化
- **Token 转发验证**：slave 收到请求时 `x-api-key=commsKey` 转发到 master `/api/nodes/verify-token`，验证结果缓存 5 分钟
- **远程命令执行**：Panel 通过 `x-node-id` Header 路由到指定 slave
- **状态上报**：slave 每 10 秒上报系统指标/实例状态/磁盘占用，master WS 广播到前端
- master 10 秒未收到 slave 上报则标记 offline

### 1.9 当前架构模式：pull-based slave 注册

1. 前端（server_admin）→ `POST /api/nodes` 创建邀请 → 返回 `{ link_key, slave_command }`
2. server_admin **手动**复制 `slave_command` 到远程机器执行
3. 远程机器启动 daemon（带 `SLAVE_MODE=true MASTER_URL=... LINK_KEY=...` 环境变量）
4. daemon 启动时调用 master `/api/nodes/link` 注册
5. master 校验 linkKey → 颁发 commsKey → 持久化到 nodes 表
6. slave 定时调用 `/api/nodes/:id/heartbeat` 上报

---

## 二、用户需求与现状的差距

| 维度 | 用户期望 | 现状提供 |
|------|---------|---------|
| 入口 | 前端 SSH 表单 | 无 UI |
| 触发 | 一键自动部署 | 手动复制命令到远程 |
| 范围 | 自动装好 slave daemon | 仅生成 slave_command 文本 |
| 通信 | API 交互（GSP 托管） | API 已就绪但 daemon 端未实现 SLAVE_MODE |
| 凭据 | SSH 账号密码 | 无 SSH 凭据管理 |

**差距核心**：
1. 缺少"前端 SSH 表单"入口
2. 缺少 SSH 执行器（Panel 后端无 SSH 客户端依赖）
3. 缺少"远程推送 deploy.sh + 执行"流程
4. daemon 端的 SLAVE_MODE 链路本身也没实现（不可避免的基础工作）

---

## 三、方案对比

### 方案 A：纯 pull 模式（沿用现有设计）

**流程**：
1. 前端新增"添加节点"按钮 → 调用 `POST /api/nodes`
2. 前端展示返回的 `slave_command` + `link_key`
3. 用户手动 SSH 到远程机器，执行 slave_command
4. daemon 启动 → 自注册到 master

**需补工作**：
- daemon 端实现 SLAVE_MODE（读取环境变量、调用 /link、持久化 commsKey、定时心跳、verify-token 转发）
- 前端 Nodes.tsx 增加"添加节点"对话框 + slave_command 展示

**优点**：复用现有 API 与契约；安全边界清晰（master 不需持有 slave SSH 凭据）；实现复杂度低；用户无需将 SSH 密码/密钥上传到 master

**缺点**：用户体验不如"一键自动部署"；用户仍需登录远程机器手动执行命令

### 方案 B：纯 push SSH 模式（用户原意）

**流程**：
1. 前端填写：远程主机 IP、SSH 端口、账号、密码（或私钥）、部署目录
2. Panel 后端通过 SSH 执行：
   - 上传 deploy.sh + 项目代码（或 git clone / 下载 release tar）
   - 安装 Node.js + 系统依赖
   - 生成 daemon/.env（注入 MASTER_URL + LINK_KEY + DAEMON_TOKEN）
   - 创建 systemd 服务（仅 daemon，不含 panel）
   - 启动 daemon
3. daemon 启动后自动调用 master 注册（同方案 A 的注册流程）

**需补工作**：
- Panel 后端引入 SSH 客户端依赖（推荐 ssh2）
- 新增 `nodeDeployService`：编排远程部署流程
- 新增 `POST /api/nodes/deploy` 端点：接收 SSH 凭据 → 异步执行部署 → 返回部署任务 ID
- 部署任务进度 WS 推送（复用现有 WS 通道）
- SSH 凭据加密存储（可选，仅会话内使用）
- deploy.sh 重构为支持"仅 daemon 模式"（去掉 panel 部分）
- daemon 端 SLAVE_MODE 实现（同方案 A，不可避免）
- 前端新增"添加节点（SSH 自动部署）"对话框

**优点**：用户体验最佳；完美匹配用户期望

**缺点**：实现复杂度高；安全风险（master 持有 slave SSH 凭据；凭据存储/加密/传输需谨慎）；跨发行版兼容性（apt/yum/dnf 分支）；失败回滚困难；网络环境依赖（master 必须能直连 slave 的 22 端口）

### 方案 C：混合模式（推荐）

**流程**：
1. 前端新增"添加节点"对话框，提供两种模式：
   - **手动模式**（方案 A）：仅展示 slave_command，用户自行执行
   - **自动模式**（方案 B）：填写 SSH 信息，Panel 自动推送部署
2. 自动模式后端流程：
   - 第一步：调用 `POST /api/nodes` 创建邀请，获取 `link_key`（复用现有 API）
   - 第二步：通过 SSH 上传"slave bootstrap 脚本"到远程
   - 第三步：bootstrap 脚本执行：安装 Node.js → 下载 release tar → 解压到 `/opt/gsp-slave/`（不复制 panel/frontend/packs）→ 生成 `daemon/.env`（注入 `SLAVE_MODE=true MASTER_URL=<master URL> LINK_KEY=<link_key> DAEMON_TOKEN=<master DAEMON_TOKEN>`）→ 创建 systemd 服务 → 启动 daemon
   - 第四步：daemon 启动 → 自动调用 master `/api/nodes/link` 注册
   - 第五步：master 收到注册 → 标记节点 online → WS 通知前端

**需补工作**：
- daemon 端 SLAVE_MODE 实现（不可避免，方案 A/B/C 共需）
- 前端节点管理 UI 扩展（添加节点对话框，双模式切换）
- Panel 后端：
  - 新增 `POST /api/nodes/deploy` 端点（接收 SSH 凭据 + name + display_fqdn）
  - 内部先调用 `nodeService.createInvite()` 拿到 link_key
  - 引入 ssh2 依赖
  - 新增 `nodeDeployService`：编排 SSH 推送 + bootstrap 脚本执行
  - 部署任务进度 WS 推送
- 编写独立的 `slave-bootstrap.sh` 脚本（轻量，仅装 daemon 子集）
- 安全：SSH 凭据仅在内存中使用，不入库；可选持久化（加密）

**优点**：用户体验最佳（自动模式）+ 兼容手动模式（手动模式作为 fallback）；复用现有 `link_key` + `slave_command` 设计；daemon 端 SLAVE_MODE 是单一真相源，自动/手动殊途同归；master 不需要持有 slave 长期凭据（自动模式可临时使用，部署后即丢弃）；失败可降级到手动模式

**缺点**：实现复杂度仍高；需要新增 SSH 依赖

---

## 四、关键技术点

### 4.1 daemon 端 SLAVE_MODE 实现要点

- 读取环境变量：`SLAVE_MODE`、`MASTER_URL`、`LINK_KEY`、`DAEMON_TOKEN`
- 启动时分支：
  - master 模式（默认）：维持现状
  - slave 模式：
    1. 调用 `POST {MASTER_URL}/api/nodes/link` body `{ slave_url, link_key }` → 拿到 `comms_key`
    2. 持久化 `comms_key` 到本地（文件如 `daemon/.comms_key`，避免重启丢失）
    3. 后续重启时优先读已持久化的 comms_key，若 master 拒绝则重新 link
- Bearer Token 切换：
  - master 模式：`Authorization: Bearer {DAEMON_TOKEN}`
  - slave 模式：`Authorization: Bearer {comms_key}`
- 定时心跳：每 10s 调用 `POST {MASTER_URL}/api/nodes/:id/heartbeat` 上报 CPU/内存/磁盘/实例数/daemon_version
- Token 转发验证：slave 收到请求时若 `Authorization: Bearer xxx` 不是 comms_key，则转发到 master `/api/nodes/verify-token`

### 4.2 SSH 推送实现要点（方案 B/C）

- 依赖选择：`ssh2`（底层、纯 JS、Node 原生支持）或 `node-ssh`（封装层、API 友好）。推荐 `ssh2`，控制力强
- 鉴权方式支持：
  - 密码登录（用户首选，但安全风险高）
  - 私钥登录（推荐，可让用户粘贴私钥或上传 .pem）
- 命令执行：用 `exec` 顺序执行，每步记录 exit_code
- 文件传输：用 `sftp` 上传 bootstrap 脚本
- 超时控制：每步 5 分钟超时，整体 30 分钟超时
- 失败回滚：执行失败时清理已创建的 systemd 服务 + 部署目录

### 4.3 slave-bootstrap.sh 脚本要点

- 接受参数：`MASTER_URL`、`LINK_KEY`、`DAEMON_TOKEN`、可选 `INSTALL_DIR`（默认 `/opt/gsp-slave`）
- 步骤：
  1. 检查/安装 Node.js 20+
  2. 创建 `gameserver` 用户（如不存在）
  3. 下载项目 release tar（从 GitHub Releases 或 master 提供 `/api/nodes/release` 端点）
  4. 解压到 `$INSTALL_DIR`，仅保留 `daemon/`、`public/`、`package.json`、`node_modules/`
  5. `npm install --production`（如未携带 node_modules）
  6. 生成 `daemon/.env`
  7. 创建 systemd 服务
  8. 启动 daemon
- 幂等性：可重复执行

### 4.4 跨发行版兼容

- 当前 deploy.sh 仅支持 Debian/Ubuntu（apt-get）
- 若需支持 CentOS/RHEL/Fedora，需扩展 yum/dnf 分支
- 或采用"最小依赖 + 二进制 tar 包"策略：master 预编译 daemon 二进制（pkg/nexe），slave 仅需 Node.js 运行时

### 4.5 安全考虑

- SSH 密码传输：前端 → master HTTPS（已 TLS 加密）
- SSH 密码存储：
  - 推荐方案：仅会话内使用，不入库；部署完成立即从内存清除
  - 可选方案：加密存储到 nodes 表新字段 `deploy_credential_enc`（AES-256-GCM），用于后续重新部署/升级
- master → slave 通信：8080 端口必须仅局域网/VPN 可达（8080 对公网禁用，见 rules）
- slave → master 通信：3001 HTTPS，公网可达
- link_key 一次性 + comms_key 双向信任（现有设计已优秀）

### 4.6 端口与网络规划

- master 节点：
  - 3000 (HTTP) → 301 → 3001 (HTTPS) 对外
  - 3002 (Panel 内部)
  - 8080 (Daemon 内部)
- slave 节点：
  - 仅 8080（Daemon，仅局域网/VPN 可达）
  - 不需要 nginx / SSL / Panel
- master 访问 slave：通过 `http://{slave_fqdn}:8080` + `comms_key` 鉴权
- slave 访问 master：通过 `https://{master_fqdn}:3001` + `link_key`/`comms_key`

---

## 五、建议执行步骤（按方案 C 混合模式，不区分优先级）

### Phase 1：daemon 端 SLAVE_MODE 实现（基础，不可避免）

1. 在 `daemon/src/index.ts` 添加 SLAVE_MODE 环境变量读取
2. 拆分 `createDaemonServer` 为 master/slave 双模式初始化
3. slave 模式启动时调用 master `/api/nodes/link` 注册
4. 持久化 comms_key 到 `daemon/.comms_key` 文件
5. 实现 heartbeat 定时上报（10s 间隔）
6. 实现 verify-token 转发逻辑（slave 收到非 comms_key token 时转发到 master）
7. daemon 端单元测试覆盖 slave 模式启动/注册/心跳

### Phase 2：前端节点管理 UI

1. Nodes.tsx 新增"添加节点"按钮（requireAdmin）
2. 实现添加节点对话框，支持两种模式：
   - 手动模式：仅展示 slave_command + link_key + 二维码（可选）
   - 自动模式：填写 SSH 表单（host、port、user、password/privateKey、display_fqdn）
3. 调用现有 `POST /api/nodes` 完成邀请创建
4. 自动模式额外调用 `POST /api/nodes/deploy`（待实现）
5. 节点列表增加"重新生成邀请"、"重新部署"操作

### Phase 3：SSH 自动部署后端

1. Panel 后端引入 `ssh2` 依赖
2. 新增 `nodeDeployService.ts`：编排 SSH 部署流程
3. 新增 `POST /api/nodes/deploy` 端点：接收 SSH 凭据 + name + display_fqdn
4. 内部先调用 `nodeService.createInvite()` 获取 link_key
5. 编写 `slave-bootstrap.sh` 模板（参数化 MASTER_URL/LINK_KEY/DAEMON_TOKEN）
6. SSH 推送 bootstrap 脚本到远程 /tmp，执行
7. 部署进度通过 WS 推送到前端（复用现有 WS 通道）
8. 失败时清理远程残留 + 调用 `nodeService.deleteNode` 删除 pending 节点

### Phase 4：deploy.sh 重构与 slave-bootstrap.sh

1. 从 deploy.sh 抽取"daemon only"模式（环境变量 `SLAVE_MODE=true` 跳过 panel/frontend）
2. 编写独立的 `slave-bootstrap.sh`（轻量，由 master SSH 推送执行）
3. slave-bootstrap.sh 支持 Debian/Ubuntu + CentOS/RHEL（可选）
4. 提供 master 端 `/api/nodes/release` 端点（暴露项目 release tar 下载）

### Phase 5：节点运维功能

1. 节点详情页：实例列表、磁盘占用、Java 环境（已有）
2. 节点升级：通过 SSH 重新执行 bootstrap 脚本（拉取新版本 release）
3. 节点卸载：通过 SSH 停止 systemd + 清理目录
4. 节点状态实时更新：WS 广播心跳结果

### Phase 6：契约更新与测试

1. 更新 `public/schema/panel-api-types.ts`：新增 `DeployNodeRequest/Response`、`DeployProgressEvent`
2. 更新 `public/interface_stub/daemon-client.d.ts`：扩展 slave 模式接口
3. 更新 `daemon.env.template`：新增 SLAVE_MODE/MASTER_URL/LINK_KEY 字段
4. 单元测试：nodeService、nodeDeployService
5. 集成测试：slave 注册全流程（master + slave 双进程）
6. E2E：前端添加节点（手动 + 自动模式）

---

## 六、关键风险与注意事项

1. **SSH 凭据安全**：master 持有 slave 的 SSH 凭据是高风险点，建议默认仅会话内使用，不入库；如需持久化必须 AES-256-GCM 加密
2. **跨发行版兼容**：当前 deploy.sh 仅支持 Debian/Ubuntu，slave 节点若用其他发行版需扩展
3. **网络环境**：master 必须能直连 slave 的 22（SSH）和 8080（Daemon）端口；slave 必须能直连 master 的 3001（HTTPS）端口
4. **失败回滚**：远程部署失败时清理困难，必须设计幂等的 bootstrap 脚本
5. **8080 端口公网禁用**：slave 节点的 8080 不可对公网开放，需通过 VPN/SSH 隧道/局域网访问
6. **DAEMON_TOKEN 一致性**：slave 的 DAEMON_TOKEN 必须与 master 一致；建议 slave 模式下用 comms_key 替代 DAEMON_TOKEN 作为 Bearer
7. **版本一致性**：master 和 slave 的 daemon 版本必须一致，升级时需协调
8. **现有节点不被破坏**：node-local（master）不能被删除或重部署
9. **link_key 一次性**：现有设计 link_key 注册后即清空，自动模式若部署失败需重新生成邀请
10. **GSP 自托管边界**：slave 节点只装 daemon，不含 panel/frontend；slave daemon 通过 master 的 API 完成所有用户态操作（登录、实例创建、文件管理等），slave 本身不暴露管理 UI

---

## 七、结论与建议

### 7.1 可行性结论

✅ **完全可行**。项目已为集群管理预留了完整的 API、契约、数据库字段，只差 daemon 端 SLAVE_MODE 实现 + 前端 UI + SSH 推送三层补全。

### 7.2 推荐方案

**方案 C（混合模式）**：
- 默认提供"自动 SSH 部署"（用户期望）
- 保留"手动 slave_command"作为 fallback（环境受限时使用）
- daemon 端 SLAVE_MODE 是单一真相源，两种模式殊途同归

### 7.3 关键依赖

- daemon 端 SLAVE_MODE 实现（不可避免的基础）
- ssh2 依赖（仅方案 B/C 需要）
- slave-bootstrap.sh 脚本（方案 B/C 需要）

### 7.4 现有可复用资产

- ✅ nodes 表 + 集群字段（master/slave、comms_key、link_key_hash 等）
- ✅ 9 个 nodes API 端点
- ✅ NodeService（createInvite/linkSlave/heartbeat/...）
- ✅ DaemonClient 节点路由
- ✅ 契约定义（panel-api-types.ts）
- ✅ 前端 Nodes.tsx 列表页（仅展示，待扩展）

### 7.5 待新增资产

- ❌ daemon 端 SLAVE_MODE 逻辑
- ❌ 前端"添加节点"对话框
- ❌ nodeDeployService + SSH 推送
- ❌ slave-bootstrap.sh 脚本
- ❌ POST /api/nodes/deploy 端点
- ❌ DeployNodeRequest/Response 契约
- ❌ daemon.env.template SLAVE_MODE 字段

### 7.6 行业参考

Pterodactyl（业界主流游戏面板）的 Panel + Wings 架构与本项目的 Panel + Daemon 高度相似：
- Wings 是 daemon（worker），Panel 是 master
- 节点添加采用"Generate Token → 复制命令到远程执行"模式（即本调研的方案 A pull 模式）
- 业界也有第三方自动化部署工具（如 space-node 提供的 Paramiko + SSH 自动化部署 Pterodactyl Wings 的方案），证明 SSH 推送模式可行
- 本项目若实现方案 C，体验上将超越 Pterodactyl 官方的手动模式

---

## 八、参考文件索引

| 文件 | 用途 |
|------|------|
| [panel/backend/src/api/routes/nodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts) | L2 集群管理 API（9 个端点） |
| [panel/backend/src/services/nodeService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts) | createInvite/linkSlave/heartbeat 核心服务 |
| [panel/backend/src/services/daemonClientService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/daemonClientService.ts) | DaemonClient 节点路由 |
| [panel/backend/src/db/migrations/20260804000001_extend_nodes_for_cluster.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260804000001_extend_nodes_for_cluster.ts) | nodes 表 L2 集群字段扩展 |
| [panel/backend/src/db/migrations/20260703000001_create_core_tables.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260703000001_create_core_tables.ts) | nodes 表初始定义 |
| [panel/backend/src/api/routes/servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts) | 实例 CRUD（含 node_id 路由） |
| [daemon/src/index.ts](file:///home/airxw/Documents/gsp/gameserver-panel/daemon/src/index.ts) | daemon 入口（待补 SLAVE_MODE） |
| [panel/frontend/src/pages/admin/Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx) | 节点列表页（仅展示，待补添加节点 UI） |
| [panel/frontend/src/api/modules/servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/servers.ts) | 前端 API 客户端 |
| [public/schema/panel-api-types.ts](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts) | 节点相关契约定义 |
| [public/config_template/daemon.env.template](file:///home/airxw/Documents/gsp/gameserver-panel/public/config_template/daemon.env.template) | Daemon 环境变量模板 |
| [public/config_template/panel.env.template](file:///home/airxw/Documents/gsp/gameserver-panel/public/config_template/panel.env.template) | Panel 环境变量模板 |
| [deploy.sh](file:///home/airxw/Documents/gsp/gameserver-panel/deploy.sh) | 本地部署脚本 |
| [.trae/documents/gsp-optimization-upgrade-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/documents/gsp-optimization-upgrade-plan.md) | L2 集群设计意图 |
