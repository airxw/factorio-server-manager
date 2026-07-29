# P0 模块拆分与编排 — GameServer Panel 3.0.0

> 阶段：S3 模块拆分（s0203 产出）
> 关联 spec：[spec.md](./spec.md) | 关联 tasks：[tasks.md](./tasks.md)
> 并行规则：MAX_PARALLEL_PER_BATCH=2，MAX_PARALLEL_GLOBAL=3
> 状态：待 GN-004 审查 + 人类裁决

---

## 一、工程过程

- S2 契约冻结已完成（spec.md + tasks.md + checklist.md 三件套闭合）
- PoC 3 个验证点全部通过，schema/RCON/通信架构已验证
- 4 项 [V] 价值判断节点已裁决（仓库名/Panel框架/UI库/Factorio Pack 时机）
- 本文件为 S3 模块拆分产出，服务 S4 并行开发编排

---

## 二、交接状态

- **当前状态**：✅ 已闭合（模块拆分表 + public/ 边界 + 依赖 DAG + 并行组 + 回退锚点 齐备）
- **未闭合项**：无
- **阻塞项**：无
- **下一步**：S3 AGENTS.md 生成（s0301） → S4 并行开发

---

## 三、最终结果

### 3.1 模块拆分表

> 命名规则：`模块N_中文名`，N 从 0 递增，数字前缀表达依赖深度。
> 物理路径为新仓库 `gameserver-panel/` 下的实际目录。

| 模块 | 中文名 | 物理路径 | 职责 | 输入 | 输出 | 依赖 |
|------|--------|---------|------|------|------|------|
| 模块0 | 共享契约层 | `public/` | Pack zod schema、API 契约类型、WS 事件类型、Mock 资源、配置模板 | PoC schema.ts | 可被 Panel/Daemon/Frontend 共享导入的契约与类型 | 无（基础层） |
| 模块1 | Panel后端骨架 | `panel/backend/src/{core,db,middleware,websocket}/` | Express + Knex + SQLite + JWT 认证 + WS 服务端 + Pack Registry/Loader | 模块0 契约 | 可启动 Panel 后端，health/login/WS 可用 | 模块0 |
| 模块2 | Daemon后端骨架 | `daemon/src/{server,auth}.ts` | Express + ws + Bearer Token/WS query token 鉴权 | 模块0 契约 | 可启动 Daemon，health/401 拦截可用 | 模块0 |
| 模块3 | Minecraft游戏包 | `packs/minecraft-vanilla/` | 完整 Pack YAML（启动/命令/配置/版本/备份/EULA） | 模块0 schema | 通过 zod 校验的 pack.yaml | 模块0 |
| 模块4 | Daemon实例管理 | `daemon/src/instances/` | ProcessDriver(spawn) + 状态机 + 就绪检测 + 事件触发 | 模块0 类型、模块2 Daemon、模块3 Pack ready_pattern | 实例生命周期闭环 + 状态变更事件 | 模块0,2,3 |
| 模块5 | Daemon协议层 | `daemon/src/protocol/` | RconClient + stdinClient(stub) + ProtocolFactory + CommandProtocol 接口 | 模块0 protocol schema、模块2 Daemon | 命令发送 + 响应接收 | 模块0,2 |
| 模块6 | Panel通信客户端 | `panel/backend/src/daemonClient/` | HTTP 客户端(fetch+Bearer) + WS 事件流客户端 + 事件转发 + 重连 | 模块0 类型、模块1 Panel、模块2 Daemon | Panel↔Daemon 双通道通信 | 模块0,1,2 |
| 模块7 | Panel业务API | `panel/backend/src/api/` | Server CRUD + Pack 列表 + 端口分配 + Daemon 调用转发 | 模块0 类型、模块1 Panel、模块3 Pack、模块6 通信客户端 | REST API 全套 | 模块0,1,3,6 |
| 模块8 | 前端应用 | `panel/frontend/` | React + Vite + 路由 + 登录/列表/创建/详情 + Console Tab + WS 日志流 | 模块0 类型、模块7 API | 端到端可用 Web UI | 模块0,7 |
| 模块9 | 集成测试 | `tests/e2e/` | 端到端测试脚本（create→start→command→stop） + 集成问题修复 | 模块1-8 全部 | 测试报告 + spec §3.8 验收通过 | 模块1-8 |

### 3.2 `public/` 共享边界定义

> `public/` 是 AC 范式的共享契约与公共资源边界。模块间仅允许依赖 `public/` 下的契约，禁止跨模块直接导入其他模块的内部实现。

```
public/
├── schema/                         # 数据契约（zod schema + TS 类型）
│   ├── pack-schema.ts              # Pack zod schema（从 PoC 迁移，含 discriminatedUnion）
│   ├── daemon-api-types.ts         # Panel↔Daemon REST 请求/响应类型
│   ├── panel-api-types.ts          # Panel↔Frontend REST 请求/响应类型
│   └── ws-events.ts                # WS 事件类型（Daemon→Panel→Frontend 统一）
├── interface_stub/                 # 接口存根（TS interface 声明，零实现）
│   ├── daemon-rest.ts              # Daemon REST 接口签名
│   ├── panel-rest.ts               # Panel REST 接口签名
│   └── command-protocol.ts         # CommandProtocol 接口（send 返回 Promise<string|null>）
├── pre_generated_mock/             # 预生成 Mock（测试用）
│   └── rcon-mock-server.ts         # PoC mock RCON server（从 PoC 迁移）
├── config_template/                # 配置模板
│   ├── panel.env.template          # Panel 环境变量模板
│   └── daemon.env.template         # Daemon 环境变量模板
└── test_cases/                     # 通用测试数据
    └── pack-fixtures/              # Pack 校验测试数据（valid + invalid YAML）
```

**跨模块协作约束**：

1. **禁止跨模块直连内部实现**：`panel/backend/` 不得 `import` `daemon/src/` 的内部代码，反之亦然。所有跨模块类型引用必须经 `public/schema/` 或 `public/interface_stub/`。
2. **Pack 文件是运行时资源**：`packs/*.yaml` 由 Panel 的 PackRegistry 加载，Daemon 通过 Panel API 获取 Pack 定义，不直接读取文件系统。
3. **WS 事件类型统一**：Daemon→Panel 与 Panel→Frontend 的 WS 事件类型定义在 `public/schema/ws-events.ts`，确保三端类型一致。
4. **CommandProtocol 接口隔离**：Daemon 的 `protocol/factory.ts` 实现 `public/interface_stub/command-protocol.ts` 接口，Panel 通过接口类型而非具体实现引用。
5. **Mock 资源共享**：`public/pre_generated_mock/rcon-mock-server.ts` 供 Daemon 单元测试和 E2E 测试共用。

### 3.3 依赖 DAG

```
                    模块0 (共享契约层)
                   /        |         \
                  v         v          v
          模块1 (Panel)  模块2 (Daemon)  模块3 (MC Pack)
                  |         |               |
                  |         v               |
                  |    模块4 (实例管理) <----+ (ready_pattern)
                  |    模块5 (协议层)
                  |         |               |
                  v         v               |
          模块6 (通信客户端) <---------------+
                  |
                  v
          模块7 (业务API) <--- 模块3 (Pack 列表)
                  |
                  v
          模块8 (前端)
                  |
                  v
          模块9 (E2E 测试) <--- 模块1-8 全部
```

**依赖矩阵**（行依赖列，✓=直接依赖）：

|  | 模块0 | 模块1 | 模块2 | 模块3 | 模块4 | 模块5 | 模块6 | 模块7 | 模块8 |
|--|---|---|---|---|---|---|---|---|---|
| 模块1 | ✓ | | | | | | | | |
| 模块2 | ✓ | | | | | | | | |
| 模块3 | ✓ | | | | | | | | |
| 模块4 | ✓ | | ✓ | ✓ | | | | | |
| 模块5 | ✓ | | ✓ | | | | | | |
| 模块6 | ✓ | ✓ | ✓ | | | | | | |
| 模块7 | ✓ | ✓ | | ✓ | | | ✓ | | |
| 模块8 | ✓ | | | | | | | ✓ | |
| 模块9 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**关键路径**：模块0 → 模块1 → 模块6 → 模块7 → 模块8 → 模块9

### 3.4 并行组与串行顺序

> 调度约束：单批最多 2 个 `parallel-sub-agent`，全局不超过 3 个并行分支。
> 每个 subagent_type 显式标注为 `general_purpose_task`（P0 无 parallel-sub-agent 可用，统一用 general_purpose_task 隔离启动）。

| Wave | 并行组 | 模块 | subagent_type | 批次 | 理由 |
|------|--------|------|---------------|------|------|
| Wave 0 | — | 模块0 | general_purpose_task | 单独 | 基础契约层，所有后续模块依赖，必须先完成 |
| Wave 1 | P-G1 | 模块1 + 模块2 | general_purpose_task ×2 | 批1 | 均仅依赖模块0，Panel/Daemon 骨架无交叉 |
| Wave 1 | P-G2 | 模块3 | general_purpose_task | 批2 | 仅依赖模块0 schema，G1 完成后启动 |
| Wave 2 | P-G3 | 模块5 + 模块6 | general_purpose_task ×2 | 批1 | 模块5(依赖0,2)+模块6(依赖0,1,2)，均在关键路径上优先启动 |
| Wave 2 | — | 模块4 | general_purpose_task | 批2 | 依赖0,2,3，G3批1完成后启动 |
| Wave 3 | — | 模块7 | general_purpose_task | 单独 | 依赖0,1,3,6，API 层需通信客户端就绪 |
| Wave 4 | — | 模块8 | general_purpose_task | 单独 | 依赖0,7，前端需 API 契约稳定 |
| Wave 5 | — | 模块9 | general_purpose_task | 单独 | 依赖全部，集成测试需所有模块就绪 |

**执行编排伪代码**：

```python
waves = [
    Wave("W0-契约层",  serial=["模块0"],                      batch_size=1),
    Wave("W1-骨架",    parallel=["模块1","模块2"],            batch_size=2),  # P-G1
    Wave("W1-Pack",    parallel=["模块3"],                    batch_size=1),  # P-G2
    Wave("W2-Daemon核",parallel=["模块5","模块6"],            batch_size=2),  # P-G3
    Wave("W2-实例",    parallel=["模块4"],                    batch_size=1),
    Wave("W3-API",     serial=["模块7"],                      batch_size=1),
    Wave("W4-前端",    serial=["模块8"],                      batch_size=1),
    Wave("W5-E2E",     serial=["模块9"],                      batch_size=1),
]
# 全程最多 2 个并行 general_purpose_task
```

### 3.5 失败回退锚点

| 模块 | 失败回退点 | 回退策略 |
|------|-----------|---------|
| 模块0 | PoC `poc/pack-yaml/schema.ts` | PoC schema 已验证通过，直接回退到 PoC 版本 |
| 模块1 | PoC `poc/panel-daemon/panel.ts` | PoC panel 客户端已验证，作为骨架参考重写 |
| 模块2 | PoC `poc/panel-daemon/daemon.ts` | PoC daemon 已验证，作为骨架参考重写 |
| 模块3 | PoC `poc/pack-yaml/packs/minecraft-vanilla.yaml` | PoC Pack 已通过校验，直接迁移 |
| 模块4 | PoC 验证通过检查点 | 回退到 mock 进程测试，ProcessDriver 用 echo 脚本验证状态流转 |
| 模块5 | PoC `poc/rcon-client/` | PoC rcon-client 已验证 8 命令全成功，回退到 PoC 版本 |
| 模块6 | PoC `poc/panel-daemon/panel.ts` | PoC 通信已验证 22/22，作为客户端参考 |
| 模块7 | 模块6 + 模块3 检查点 | API 路由可用 Mock Daemon 开发，待通信层就绪后联调 |
| 模块8 | 模块7 检查点 | 前端可用 Mock API 开发，待 API 就绪后联调 |
| 模块9 | 模块1-8 检查点 | 降级为手动 curl 测试，标注未自动化项 |

### 3.6 Subagent 执行台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|-------|---------------|---------|----------------|---------|-----------|------|
| 模块0 | — | general_purpose_task | public/ 契约层 | 待回填 | `public/` | PoC schema.ts | 待启动 |
| 模块1 | P-G1 | general_purpose_task | Panel 骨架代码 | 待回填 | `panel/backend/src/{core,db,middleware,websocket}/` | PoC panel.ts | 待启动 |
| 模块2 | P-G1 | general_purpose_task | Daemon 骨架代码 | 待回填 | `daemon/src/` | PoC daemon.ts | 待启动 |
| 模块3 | P-G2 | general_purpose_task | minecraft-vanilla.yaml | 待回填 | `packs/minecraft-vanilla/` | PoC minecraft-vanilla.yaml | 待启动 |
| 模块4 | — | general_purpose_task | ProcessDriver + 状态机 | 待回填 | `daemon/src/instances/` | PoC 验证通过检查点 | 待启动 |
| 模块5 | P-G3 | general_purpose_task | RconClient + Factory | 待回填 | `daemon/src/protocol/` | PoC rcon-client/ | 待启动 |
| 模块6 | P-G3 | general_purpose_task | Panel↔Daemon 通信层 | 待回填 | `panel/backend/src/daemonClient/` | PoC panel.ts | 待启动 |
| 模块7 | — | general_purpose_task | Server CRUD API | 待回填 | `panel/backend/src/api/` | 模块6+模块3 检查点 | 待启动 |
| 模块8 | — | general_purpose_task | 前端骨架 + Console | 待回填 | `panel/frontend/` | 模块7 检查点 | 待启动 |
| 模块9 | — | general_purpose_task | E2E 测试 + 修复 | 待回填 | `tests/e2e/` | 模块1-8 检查点 | 待启动 |

> 台账规则：subagent 启动后立即回填 actual agent id；失败时保留 previous_id + retry_count + failure_reason。

---

## 四、闭合判据预定义

| 模块 | 闭合判据 | 验证方式 |
|------|---------|---------|
| 模块0 | schema/类型/Mock 可被 Panel/Daemon 导入，无 TS 编译错误 | `tsc --noEmit` 通过 |
| 模块1 | Panel 启动 + health 200 + login 返回 JWT + WS 连接成功 | `curl localhost:3000/api/health` |
| 模块2 | Daemon 启动 + health 200 + 无 token 401 | `curl localhost:8080/health` |
| 模块3 | minecraft-vanilla.yaml 通过 zod 校验 | `npm run packs:validate` |
| 模块4 | mock 进程状态流转正确 + 就绪检测命中 | 单元测试 PASS |
| 模块5 | 连接 mock RCON + list 命令响应 + 错误密码拒绝 | 单元测试 PASS |
| 模块6 | Panel 调用 Daemon API + WS 事件接收 + 断线重连 | 集成测试 PASS |
| 模块7 | 创建/启动/停止实例 API 全流程 | `curl` 全流程 |
| 模块8 | 前端登录/创建/控制台可用 | 浏览器手动验证 |
| 模块9 | 端到端测试全通过，spec §3.8 验收标准满足 | `npm run test:e2e` PASS |

---

## 五、下游开发接续入口

1. **S3 AGENTS.md 生成（s0301）**：基于本模块拆分表，为每个模块生成模块级 AGENTS.md，注入可操作文件范围、依赖的 Mock 路径、测试要求
2. **S4 并行开发**：按 Wave 0→5 顺序调度 general_purpose_task subagent，每 Wave 内按 batch_size 控制并行度
3. **模块0 优先启动**：作为基础契约层，模块0 完成后才能启动后续模块
4. **PoC 迁移路径**：模块0/3 可直接从 PoC 迁移代码，模块1/2/5/6 以 PoC 为参考重写生产代码

---

## 六、AC 范式适配说明

> 本项目为 TypeScript 项目，AC 范式 rules-3 中的 `.pyi` 存根格式适配为 TypeScript 的 `.ts` 类型声明文件（interface/type 仅声明，零实现）。契约优先原则不变：所有跨模块协作经 `public/` 下的契约文件，禁止直接导入其他模块内部实现。
