# GameServer Panel  — 全局 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须 100% 符合本文件要求，违反规则的内容必须自动修正后再输出。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

***

## 一、项目概览

- **项目名称**：GameServer Panel&#x20;
- **定位**：通用游戏服务器管理平台（参考 Pterodactyl 架构 + Tebex 商业化）
- **技术栈**：TypeScript + Express + Knex + SQLite(P0) + React 19 + Vite + shadcn/ui + Tailwind CSS
- **架构**：Panel（中心控制台）+ Daemon（节点代理）双层架构
- **P0 目标**：Panel + Daemon 双层架构跑通，用户可创建 Minecraft Vanilla 实例并端到端管理
- **关联文档**：
  - Spec：`.trae/specs/p0-platform-skeleton/spec.md`
  - Tasks：`.trae/specs/p0-platform-skeleton/tasks.md`
  - 模块拆分：`.trae/specs/p0-platform-skeleton/module-split.md`

***

## 二、gsp 项目规范通用约束（含禁止操作清单）

> 🚨 **public/ 目录保护**：`public/` 目录是契约的物理载体，不是代码库的可变部分。任何删除、修改、覆盖、移动 `public/` 下文件的操作必须先经人类显式授权。**不存在"零引用即可删除"的例外。** 契约变更必须走 s0601 流程，不得直接编辑 public/ 文件。

```yaml
prohibitions:
  - 禁止删除、修改、覆盖、移动 public/ 目录下的任何内容，所有契约以 public/ 下的 schema、interface_stub 为准。保护优先级高于任务指令。
  - 禁止在模块间直接导入其他模块的内部实现代码（panel/backend/ 不得 import daemon/src/ 内部代码，反之亦然）
  - 禁止写入不符合数据契约的数据
  - 禁止创建不符合命名规范的模块目录
  - 禁止使用相对路径跨目录引用（必须用 os.path.dirname(os.path.abspath(__file__)) 或 TS 等价的 path alias）

binding_rules:
  - 模块间仅允许依赖 public/ 下的契约（schema/、interface_stub/）
  - 所有数据读写必须通过公共契约校验（zod schema）
  - 所有对外接口必须严格匹配契约定义的签名、参数、返回值、异常
  - Pack YAML 文件由 Panel PackRegistry 加载，Daemon 通过 Panel API 获取 Pack 定义
  - WS 事件类型统一定义在 public/schema/ws-events.ts

# 违反上述任何一条，代码产出在合规检查中直接标记为不合规，不得合流
```

***

## 三、项目专属约束

### 3.1 技术栈约束

```yaml
backend:
  framework: Express
  orm: Knex
  database: SQLite (P0) → PostgreSQL (P4)
  auth: JWT (Panel↔Frontend) + Bearer Token (Panel↔Daemon)
  logging: pino 结构化日志
  validation: zod
  language: TypeScript strict 模式，禁止 any

frontend:
  framework: React 19 + Vite
  ui_library: shadcn/ui + Tailwind CSS
  state: React Context + hooks
  http_client: axios + JWT 拦截器
  ws_client: 原生 WebSocket

daemon:
  framework: Express + ws
  process_driver: child_process.spawn (P0 进程模式，无 Docker)
  rcon_library: rcon-client@^4.2.4
  auth: Bearer Token (REST) + query token (WS)
```

### 3.2 端口约定

```yaml
panel_backend: 3000
daemon: 8080
```

### 3.3 状态机约定

```yaml
lifecycle: stopped → starting → running → stopping → stopped
error_state: error (任意状态可转入，需人工干预恢复)
```

### 3.4 日志规范

```yaml
format: "[timestamp] [INFO/ERROR] [module] message"
scope: Panel 和 Daemon 各自输出独立日志
health_check: 仅做 API 轻量连通性检查（GET /health），禁止耗时生成或内容请求
```

### 3.5 测试要求

```yaml
unit_test: 核心逻辑（Pack 加载、状态机、RCON 客户端）必须有单元测试
e2e_test: create → start → command "list" → stop 全流程必须通过
test_order: 单测 → E2E → Mock 回归（顺序固定，不可跳关）
```

### 3.6 配置管理

```yaml
config_source: 环境变量 + .env 文件
prohibition: 禁止业务代码硬编码配置参数
auto_fill: 配置加载时自动补充缺失字段（zod default）
templates: public/config_template/ 下的 .env.template 文件
```

### 3.7 部署约定

```yaml
deployment: 关闭现有部署后再部署新版本，否则会报错
hot_update: 版本更新时需做数据库迁移脚本的前置处理
platform: Linux（不考虑 Windows）
```

***

## 四、模块边界速查

| 模块  | 路径                                                  | 可修改范围           | 依赖        |
| --- | --------------------------------------------------- | --------------- | --------- |
| 模块0 | `public/`                                           | 仅项目负责人可修改       | 无         |
| 模块1 | `panel/backend/src/{core,db,middleware,websocket}/` | 该目录下所有文件        | 模块0       |
| 模块2 | `daemon/src/`                                       | 该目录下所有文件        | 模块0       |
| 模块3 | `packs/minecraft-vanilla/`                          | pack.yaml 及相关定义 | 模块0       |
| 模块4 | `daemon/src/instances/`                             | 该目录下所有文件        | 模块0,2,3   |
| 模块5 | `daemon/src/protocol/`                              | 该目录下所有文件        | 模块0,2     |
| 模块6 | `panel/backend/src/daemonClient/`                   | 该目录下所有文件        | 模块0,1,2   |
| 模块7 | `panel/backend/src/api/`                            | 该目录下所有文件        | 模块0,1,3,6 |
| 模块8 | `panel/frontend/`                                   | 该目录下所有文件        | 模块0,7     |
| 模块9 | `tests/e2e/`                                        | 该目录下所有文件        | 模块1-8     |

> 详细模块拆分见 `.trae/specs/p0-platform-skeleton/module-split.md`

***

## 五、PoC 迁移指引

| PoC 文件                                       | 迁移目标                                            | 处理方式           |
| -------------------------------------------- | ----------------------------------------------- | -------------- |
| `poc/pack-yaml/schema.ts`                    | `public/schema/pack-schema.ts`                  | 直接迁移           |
| `poc/pack-yaml/packs/minecraft-vanilla.yaml` | `packs/minecraft-vanilla/pack.yaml`             | 直接迁移           |
| `poc/rcon-client/mock-server.ts`             | `public/pre_generated_mock/rcon-mock-server.ts` | 迁移为测试用 mock    |
| `poc/panel-daemon/daemon.ts`                 | `daemon/src/server.ts`                          | 作为骨架参考，重写为生产代码 |
| `poc/panel-daemon/panel.ts`                  | `panel/backend/src/daemonClient/client.ts`      | 作为客户端参考        |

