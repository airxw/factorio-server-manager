# SSH 执行位置深入研究：浏览器 vs 服务器

> 调研日期：2026-07-23
> 调研性质：在第一份调研报告基础上，针对用户提出的安全顾虑深入展开
> 用户诉求：避免 master 服务器持有 SSH 凭据，让浏览器直接发起 SSH，master 仅做流程引导

---

## 一、用户诉求与技术约束的核心矛盾

### 1.1 用户的安全设想

> "能否简单的从用户的浏览器出发？而不是在服务器中执行？否则本身从服务器传递这个信息的风险就很大，从用户前端进行执行，一切执行后，gsp服务器做流程引导，添加这个服务器。"

**核心目标**：
- SSH 凭据不经过 master 服务器
- 部署执行由浏览器发起
- master 仅做"流程引导"（生成命令、等待注册、状态展示）

### 1.2 浏览器原生能力的硬约束

| 能力 | 浏览器是否支持 | 说明 |
|------|---------------|------|
| 原生 TCP socket | ❌ 不支持 | 仅有 WICG 提案（direct-sockets），未落地；Chrome 曾实验性支持但已撤回 |
| 直接发起 SSH 协议 | ❌ 不可能 | SSH 基于 TCP，浏览器无 TCP API |
| WebSocket 出站 | ✅ 支持 | 但 WS 是应用层协议，目标端必须有 WS 服务端 |
| WebRTC DataChannel | ✅ 支持（P2P） | 理论可行，但需要 STUN/TURN 信令服务器；且 DataChannel 是数据流非字节流，需自封装 SSH 协议 |
| WebAssembly | ✅ 支持 | 可在浏览器内跑 SSH 协议栈，但底层仍需 TCP（受上一条约束） |
| 浏览器扩展 Native Messaging | ✅ 支持 | 可调用本地 SSH 客户端，但要求用户安装扩展 |
| WebCrypto API | ✅ 支持 | 可在浏览器内做 AES/RSA 加密 |

**结论**：**浏览器无法绕过服务器直接发起 SSH 连接**。所有"浏览器 SSH"方案都需要某种形式的服务器中转。

### 1.3 业界方案盘点

| 方案 | 中转节点 | 凭据流转 | 代表项目 |
|------|---------|---------|---------|
| WebSSH2 | Node.js 服务器 | master 持有凭据 | [webssh2](https://www.npmjs.com/package/webssh2_client) |
| CloudSSH | Cloudflare Workers | 凭据 AES-256-GCM 加密存浏览器本地；OTT 机制使密码不经过前端 | [CloudSSH](https://juejin.cn/post/7658522877016309810) |
| WebTTY | WebRTC + 信令服务器 | 浏览器直连远程，信令服务器仅协调 | [WebTTY](https://github.com/maxmcd/webtty) |
| Cloudflare Access Clientless SSH | Cloudflare Tunnel + Access | 用户浏览器登录，cloudflared 在远程建立隧道 | [Cloudflare 官方方案](https://developers.cloudflare.com/cloudflare-one/setup/secure-private-apps/clientless-ssh/) |
| SpringBoot + JSch | Java 服务器 | master 持有凭据 | [cnblogs 教程](https://www.cnblogs.com/Chary/articles/19079733) |

**关键洞察**：
- 即便是 CloudSSH（业界安全标杆），SSH 字节流也经过 Cloudflare 边缘节点中转
- 但 CloudSSH 的"凭据零暴露"机制值得借鉴：**凭据加密存浏览器，master 只拿到一次性 token**

---

## 二、本项目（GSP）的方案推演

### 2.1 项目硬约束（来自 rules）

- 禁止本机代理（开发者电脑不能做网络转发）
- 8080 端口对公网禁用
- 不允许引入 Cloudflare 等第三方代理
- master = `gsp.ecsrz.com:3001`，slave = 远程机器

**结论**：不能照搬 CloudSSH（依赖 Cloudflare Workers 作为 TCP 出口）。必须用 GSP 自己的 master 作为中转，或让浏览器完全脱离 master 中转链路。

### 2.2 三种可行的"master 不持有凭据"方案

#### 方案 E：浏览器引导 + 用户本地 SSH 工具执行（最安全，master 零接触）

**流程**：
1. 前端 → `POST /api/nodes` → master 生成邀请 → 返回 `{ link_key, slave_command, deploy_script }`
2. 前端展示三种获取方式：
   - **复制命令**：用户复制 `slave_command` 到自己电脑的 SSH 客户端（系统终端、PuTTY、MobaXterm、Termius）执行
   - **下载脚本**：用户下载 `deploy-slave.sh` 文件，通过自己的 SSH 工具上传到远程执行（`bash deploy-slave.sh`）
   - **查看完整指令**：展示手动 SSH 步骤（含安装 Node.js、下载 release、配置 .env、创建 systemd 等）
3. 用户用自己的 SSH 工具登录远程机器执行命令
4. 远程 daemon 启动 → 调用 master `/api/nodes/link` 自注册
5. master WS 通知前端"节点已上线"

**master 接触的凭据**：**完全无**。master 只生成一次性 link_key，slave daemon 用 link_key 自注册获取 comms_key。

**优点**：
- 安全等级最高（master 完全零接触 SSH 凭据）
- 实现复杂度低（前端只是 UI 展示，复用现有 API）
- 用户保留对 SSH 凭据的完全控制
- 兼容所有 SSH 客户端（Windows/Mac/Linux 自带或第三方）

**缺点**：
- 用户体验非"一键自动"（需用户手动操作 SSH 工具）
- 用户需具备基础 SSH 使用能力

#### 方案 F：浏览器内 WebSSH（GSP master 作为 WS 中转，凭据加密存浏览器）

**流程**：
1. 前端用 `xterm.js` + `WebSocket` 实现 Web 终端
2. 用户在浏览器填写 SSH 凭据（host/port/user/password 或 privateKey）
3. 浏览器端用 WebCrypto API + 用户口令派生密钥，AES-256-GCM 加密凭据后存入 `localStorage`
4. 浏览器通过 HTTPS 把凭据传给 master（**仅部署会话期间**）
5. master 用 ssh2 库建立到 slave 的 SSH 连接，PTY 字节流通过 WS 双向转发到前端 xterm.js
6. master 在会话结束/超时后立即清除内存中的凭据（不持久化）
7. 远程执行 bootstrap 脚本 → slave daemon 启动 → 自注册

**master 接触的凭据**：**瞬时接触**（仅在内存中），不持久化。

**进阶安全（"零暴露"模式，借鉴 CloudSSH）**：
1. 前端生成一次性 token（OTT）
2. 前端把 OTT + 加密后的凭据一起传给 master
3. master 用 OTT 解密（实际上前端用 OTT 加密，master 只转发不解密）→ master 持有 OTT 但无法解密
4. 真正的解密在"另一个组件"完成（可以是浏览器扩展，或者用slave 上传的公钥）

**优点**：
- 用户体验最佳（一键自动部署，浏览器内完成）
- master 不持久化凭据（仅会话内瞬时使用）

**缺点**：
- master 仍瞬时接触凭据（即使不持久化）
- 实现复杂度高（xterm.js + WS + ssh2 + 凭据加密 + OTT 机制）
- 安全边界不如方案 E 清晰
- 若 master 被入侵，攻击者可在内存中窃取凭据

#### 方案 G：混合模式（推荐）

**流程**：
- 前端"添加节点"对话框提供两种模式切换：
  - **手动模式**（方案 E）：仅展示 slave_command + 下载脚本，用户自己执行
  - **自动模式**（方案 F）：浏览器内 WebSSH 自动执行
- 默认推荐手动模式（安全）
- 高级用户可选自动模式（便利）
- 两种模式殊途同归：master 等待 slave daemon 自注册

**优点**：
- 安全与便利兼顾
- 用户可选适合自己的模式
- 自动模式失败时可降级到手动模式

**缺点**：
- 实现工作量 = 方案 E + 方案 F

---

## 三、关键技术细节

### 3.1 方案 E 实现要点

**前端新增组件**：
1. `AddNodeDialog` 组件：
   - 调用 `POST /api/nodes` 获取 `{ link_key, slave_command }`
   - 三种展示方式：
     - Tab 1 "复制命令"：`slave_command` 文本框 + "复制" 按钮
     - Tab 2 "下载脚本"：生成完整 `deploy-slave.sh`（参数化）+ "下载 .sh" 按钮
     - Tab 3 "手动步骤"：分步教程（安装 Node.js、下载 release、配置 .env、systemd）
   - 状态指示："等待节点注册..."（轮询 `GET /api/nodes/:id` 或订阅 WS 事件）
   - 注册成功后自动关闭对话框 + 刷新节点列表

**master 侧改动**：
- 几乎无需改动（复用现有 `POST /api/nodes`）
- 可选：新增 `GET /api/nodes/release` 端点提供项目 release tar 下载（slave 脚本 curl 下载）
- 可选：新增 `POST /api/nodes/:id/regenerate-invite` 重新生成邀请（用于失败重试）

**deploy-slave.sh 模板**（参数化）：
```bash
#!/bin/bash
# GSP Slave Daemon Bootstrap Script
# 参数由 GSP Panel 生成并注入
set -e

MASTER_URL="https://gsp.ecsrz.com:3001"  # 由 Panel 注入
LINK_KEY="xxxxxxxxxxxxxxxx"                # 由 Panel 注入
DAEMON_TOKEN="yyyyyyyyyyyyyyyy"            # 由 Panel 注入
INSTALL_DIR="/opt/gsp-slave"               # 可由用户修改

# 1. 检查/安装 Node.js 20+
# 2. 创建 gameserver 用户
# 3. 下载 release tar（从 master /api/nodes/release 或 GitHub Releases）
# 4. 解压到 $INSTALL_DIR（仅保留 daemon/、public/、package.json、node_modules/）
# 5. npm install --production（若未携带 node_modules）
# 6. 生成 daemon/.env：
#    SLAVE_MODE=true
#    MASTER_URL=$MASTER_URL
#    LINK_KEY=$LINK_KEY
#    DAEMON_TOKEN=$DAEMON_TOKEN
#    PORT=8080
# 7. 创建 systemd 服务 gameserver-slave-daemon.service
# 8. 启动 daemon
# 9. daemon 启动后调用 master /api/nodes/link 自注册
```

### 3.2 方案 F 实现要点

**前端新增组件**：
1. `WebSSHTerminal` 组件：
   - 用 `xterm.js` + `@xterm/addon-fit` + `@xterm/addon-web-links`
   - 通过 WS 连接 master `/ws/ssh-proxy`
2. `AddNodeAutoDialog` 对话框：
   - 表单：host、port、user、password/privateKey、display_fqdn、install_dir
   - 用户口令派生密钥（PBKDF2）→ 加密 SSH 凭据 → 存 localStorage
   - 提交：HTTPS POST 到 master `/api/nodes/deploy-auto`，body 含加密凭据 + 部署参数
3. 部署进度展示：xterm.js 实时显示远程 SSH 输出

**master 侧新增**：
1. 依赖：`ssh2`
2. 新增 `/ws/ssh-proxy` WebSocket 端点：
   - 接收浏览器加密凭据
   - 在内存中解密（或仅中转不解密，取决于"零暴露"实现深度）
   - 用 ssh2 建立到 slave 的 SSH 连接
   - 双向转发 PTY 字节流 ↔ WS
3. 新增 `nodeDeployService.deployViaSSH(credential, params)`：
   - 通过 SSH 执行 bootstrap 命令序列
   - 每步通过 WS 推送进度
4. 会话清理：
   - WS 关闭时立即清除内存中的凭据
   - 超时（5 分钟无活动）自动清理

**安全增强（可选，借鉴 CloudSSH）**：
1. **One-Time-Token 机制**：
   - 前端生成 OTT
   - 用 OTT 加密真实凭据（AES-256-GCM）
   - master 收到 OTT + 加密凭据，但 master 无法解密（OTT 本身不解密，仅作为传输载体）
   - 真正的解密需要前端再传一个 "解密密钥"，但这个密钥只在用户点击"开始部署"时通过另一个通道传输（如 WS 握手头部）
   - **本质**：让 master 即使被入侵，也无法在静态存储中拿到明文凭据；只能通过运行时劫持 WS 通道才能拿到（动态攻击难度远高于静态窃取）

2. **凭据浏览器本地存储**：
   - 凭据用用户口令派生的密钥加密后存 `localStorage`
   - 下次部署同一节点可"记住"凭据，但需要用户重新输入口令解锁
   - master 从不持有持久化凭据

### 3.3 WebRTC DataChannel 方案（不推荐，仅作技术探讨）

**理论**：浏览器通过 WebRTC DataChannel 直接与远程 slave 通信，无需 master 中转 SSH 字节流。

**实现路径**：
1. slave 启动一个 WebRTC 客户端，向 master 注册（信令通道）
2. 浏览器从 master 获取 slave 的 WebRTC SDP
3. 浏览器与 slave 建立 P2P DataChannel
4. 浏览器在 DataChannel 上跑 SSH 协议栈（用 WebAssembly 移植 ssh2 或自实现）

**致命缺陷**：
- slave 端需要跑 WebRTC 服务端，复杂度爆炸
- 自实现 SSH 协议栈工作量巨大（CloudSSH 用纯 TS 实现花费了大量精力）
- 仍需 master 作为信令服务器（仅减少字节流中转，不消除服务器依赖）
- WebRTC 在 NAT 后需要 TURN 服务器（除非 master 做 TURN）
- 实际收益有限但复杂度极高

**结论**：不推荐。

---

## 四、方案对比矩阵

| 维度 | 方案 E（浏览器引导） | 方案 F（WebSSH 中转） | 方案 G（混合） |
|------|---------------------|---------------------|----------------|
| master 接触凭据 | ❌ 完全不接触 | ⚠️ 瞬时接触（内存） | 取决于用户选择 |
| 用户体验 | 中等（手动 SSH） | 最佳（一键自动） | 用户可选 |
| 实现复杂度 | 低 | 高 | 高 |
| 安全等级 | ⭐⭐⭐⭐⭐ 最高 | ⭐⭐⭐ 中等 | ⭐⭐⭐⭐ |
| 跨平台兼容 | 全部 SSH 客户端 | 仅现代浏览器 | 全部 |
| 离线/网络受限环境 | 完全可用 | 依赖 master 出站到 slave:22 | 可降级 |
| 失败排查 | 用户直接看 SSH 输出 | 浏览器内 xterm 显示 | 两种都有 |
| 长期维护成本 | 低 | 中（WS 通道维护） | 中 |
| 借鉴业界方案 | Pterodactyl 手动模式 | CloudSSH / WebSSH2 | — |

---

## 五、推荐路径

### 5.1 短期推荐：方案 E

**理由**：
1. 用户的核心顾虑是"master 持有凭据的风险"——方案 E 彻底消除该风险
2. 实现成本低，可快速上线
3. v4.9.0 已留下 nodes API 基础设施，仅缺前端 UI + slave bootstrap 脚本
4. Pterodactyl 业界标杆也是手动模式，方案 E 体验已达到业界标准
5. 用户原意"从浏览器出发"——方案 E 的"复制命令/下载脚本"也是从浏览器发起，只是执行位置在用户的 SSH 客户端而非浏览器内

**用户疑虑回应**：
> "能否简单的从用户的浏览器出发？"

**答**：可以。方案 E 的"出发"在浏览器（生成命令、下载脚本、展示引导），"执行"在用户的 SSH 客户端。这是浏览器纯技术约束下的最优解——浏览器本身无法直接发起 SSH TCP 连接。

### 5.2 中期可选：方案 G（混合）

**触发条件**：
- 用户反馈方案 E 体验不够便利
- 有强需求要"完全浏览器内一键部署"
- 团队有精力实现方案 F 的复杂度

**实施策略**：
- 保留方案 E 作为默认模式
- 新增方案 F 作为"高级模式"
- 默认推荐安全模式，高级用户主动切换

### 5.3 不推荐：方案 F 独立实施

**理由**：
- 牺牲了"master 零接触凭据"的安全优势
- 实现复杂度高但安全收益有限
- 若一定要做"自动部署"，应作为方案 G 的子选项而非独立方案

---

## 六、对既有调研报告的修正

第一份报告 [docs/remote-node-deploy-research.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/remote-node-deploy-research.md) 中的方案 B（纯 push SSH 模式）和方案 C（混合模式）假设 master 持有 SSH 凭据进行远程推送。本补充调研明确：

- **方案 B 已被本次调研否定**（master 持有凭据风险过高，违背用户安全诉求）
- **方案 C 需要修正**：原方案的"自动模式"应改用方案 F（浏览器 WebSSH + master WS 中转）或彻底用方案 E 替代
- **推荐的新混合方案 G** = 方案 E（默认）+ 方案 F（可选高级模式）

---

## 七、修订后的执行步骤（按方案 G 混合模式）

### Phase 1：daemon 端 SLAVE_MODE 实现（基础，不可避免）

不变，详见第一份报告。

### Phase 2：前端节点管理 UI（方案 E 部分）

1. Nodes.tsx 新增"添加节点"按钮（requireAdmin）
2. 实现 `AddNodeDialog` 组件，三个 Tab：
   - "复制命令"：展示 `slave_command` + 复制按钮
   - "下载脚本"：生成 `deploy-slave.sh` + 下载按钮
   - "手动步骤"：分步教程
3. 调用现有 `POST /api/nodes` 创建邀请
4. 状态指示："等待节点注册..."，订阅 WS 事件或轮询节点状态
5. 注册成功后关闭对话框 + 刷新列表

### Phase 3：master 端引导增强

1. 新增 `GET /api/nodes/release` 端点：提供项目 release tar 下载（用于 slave bootstrap curl）
2. 新增 `POST /api/nodes/:id/regenerate-invite` 端点：失败重试时重新生成 link_key
3. WS 事件 `node.linked` 广播：slave 注册成功时通知所有前端

### Phase 4：slave-bootstrap.sh 脚本

1. 编写独立 `slave-bootstrap.sh`（参数化 MASTER_URL/LINK_KEY/DAEMON_TOKEN/INSTALL_DIR）
2. 支持 Debian/Ubuntu（apt-get）+ CentOS/RHEL（yum/dnf）
3. 幂等性：可重复执行
4. 失败时清理已创建的资源

### Phase 5：（可选）方案 F 浏览器内 WebSSH

1. Panel 后端引入 `ssh2` 依赖
2. 新增 `/ws/ssh-proxy` WebSocket 端点
3. 前端引入 `xterm.js` + `@xterm/addon-fit`
4. 实现 `WebSSHTerminal` 组件
5. 实现 `AddNodeAutoDialog` 表单（SSH 凭据 + 部署参数）
6. 凭据加密存储（WebCrypto AES-256-GCM）
7. 部署进度通过 WS 推送
8. 会话超时清理凭据

### Phase 6：契约更新与测试

1. 更新 `public/schema/panel-api-types.ts`：新增 `RegenerateInviteResponse`、`DeployAutoRequest/Response`、`SSHProxyEvent`
2. 更新 `public/interface_stub/daemon-client.d.ts`：扩展 slave 模式接口
3. 更新 `daemon.env.template`：新增 SLAVE_MODE/MASTER_URL/LINK_KEY 字段
4. 单元测试：nodeService、nodeDeployService、AddNodeDialog
5. 集成测试：slave 注册全流程
6. E2E：前端添加节点（手动 + 自动模式）

---

## 八、关键风险与注意事项

### 8.1 方案 E 风险

1. **用户能力门槛**：需用户会使用 SSH 客户端。**缓解**：提供详细图文教程，"复制命令"一键搞定
2. **link_key 一次性**：部署失败需重新生成邀请。**缓解**：UI 提供"重新生成邀请"按钮
3. **网络环境**：slave 必须能访问 master:3001（HTTPS）。**缓解**：脚本前置检查网络连通性
4. **跨发行版兼容**：slave 操作系统多样。**缓解**：脚本支持 apt/yum/dnf 三种包管理器

### 8.2 方案 F 额外风险

1. **master 内存攻击面**：攻击者入侵 master 后可在内存窃取凭据。**缓解**：OTT 机制 + 会话超时清理
2. **WS 通道劫持**：中间人攻击 WS 通道。**缓解**：WS 走 HTTPS（wss://）+ token 鉴权
3. **凭据浏览器存储**：XSS 攻击可窃取 localStorage。**缓解**：CSP 严格策略 + 凭据用户口令加密
4. **ssh2 库维护**：ssh2 是活跃维护的库，但需关注安全更新

### 8.3 通用风险

1. **slave 出站到 master**：slave daemon 需访问 `master:3001`，若 slave 在严格 NAT 后可能失败
2. **master 出站到 slave**（仅方案 F 需要）：master 需访问 `slave:22`（SSH）和 `slave:8080`（daemon），slave 防火墙需放行
3. **版本一致性**：master 和 slave daemon 版本必须一致，升级时需协调
4. **GSP 自托管边界**：slave 只装 daemon，不含 panel/frontend；所有用户态操作通过 master API 转发

---

## 九、结论

### 9.1 用户原意回应

> "能否简单的从用户的浏览器出发？而不是在服务器中执行？"

**答**：**可以，但有技术边界**。浏览器无法直接发起 SSH（浏览器无 TCP API），但可以让"流程引导"完全从浏览器出发，"SSH 执行"在用户的 SSH 客户端完成（方案 E）。这是浏览器纯技术约束下的最优解，且完全消除 master 持有凭据的风险。

### 9.2 推荐方案

**方案 G（混合）**：
- 默认方案 E（浏览器引导 + 用户本地 SSH 工具执行）—— 安全等级最高，实现成本低
- 可选方案 F（浏览器内 WebSSH + master WS 中转 + 凭据加密）—— 体验最佳，但 master 瞬时接触凭据

### 9.3 关键决策点

| 决策 | 选项 A | 选项 B | 推荐 |
|------|--------|--------|------|
| 是否实现方案 F | 仅方案 E | 方案 E + F 混合 | 先做 E，根据用户反馈再决定是否做 F |
| 凭据存储位置 | 浏览器 localStorage（加密） | master 数据库（加密） | 浏览器 localStorage（即使做 F） |
| SSH 鉴权方式 | 仅密码 | 密码 + 私钥 | 两种都支持 |
| 跨发行版支持 | 仅 Debian/Ubuntu | + CentOS/RHEL | 先支持 Debian/Ubuntu，后续扩展 |

### 9.4 与第一份报告的关系

本补充报告修订了第一份报告的方案 B（已否定）和方案 C（修正为方案 G）。其余内容（daemon 端 SLAVE_MODE、契约、API、风险）保持一致。

### 9.5 行业对比修正

- **Pterodactyl**：仅提供手动模式（相当于方案 E）。本项目方案 E 体验已达到业界标杆水平。
- **CloudSSH**：用 Cloudflare Workers 实现"零暴露"模式，但本项目不能依赖 Cloudflare（项目规则禁止）。本项目方案 F 的 OTT 机制是 CloudSSH 思路的本土化实现。
- **WebSSH2**：master 持有凭据，安全等级低于本项目方案 F。
- **业界尚无完整开源方案**同时实现"浏览器一键自动部署 + master 零持有凭据"。本项目方案 G 若实现，将在安全与体验上达到业界领先水平。

---

## 十、参考文件索引

| 文件 | 用途 |
|------|------|
| [docs/remote-node-deploy-research.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/remote-node-deploy-research.md) | 第一份调研报告（架构现状盘点） |
| [panel/backend/src/api/routes/nodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts) | L2 集群管理 API |
| [panel/backend/src/services/nodeService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts) | createInvite/linkSlave/heartbeat 核心 |
| [panel/backend/src/services/daemonClientService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/daemonClientService.ts) | DaemonClient 节点路由 |
| [daemon/src/index.ts](file:///home/airxw/Documents/gsp/gameserver-panel/daemon/src/index.ts) | daemon 入口（待补 SLAVE_MODE） |
| [panel/frontend/src/pages/admin/Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx) | 节点列表页（待扩展添加 UI） |

## 十一、业界参考链接

- [CloudSSH 开源项目](https://juejin.cn/post/7658522877016309810) —— Cloudflare Workers + 纯 TS SSH 协议栈 + OTT 机制
- [Cloudflare Workers TCP Sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) —— `connect()` 出站 TCP
- [Cloudflare Access Clientless SSH](https://developers.cloudflare.com/cloudflare-one/setup/secure-private-apps/clientless-ssh/) —— 浏览器内 SSH 官方方案
- [webssh2_client](https://www.npmjs.com/package/webssh2_client) —— xterm.js + Socket.io + 服务端 ssh2 中转
- [WebTTY](https://github.com/maxmcd/webtty) —— WebRTC P2P SSH 方案
- [WICG direct-sockets proposal](https://github.com/WICG/direct-sockets/blob/main/docs/explainer.md) —— 浏览器原生 TCP API 提案（未落地）
