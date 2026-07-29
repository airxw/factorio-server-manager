# 模块7_Panel业务API AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块7_Panel业务API
- **物理路径**：`panel/backend/src/api/`
- **职责**：Server CRUD + Pack 列表 + 端口分配 + Daemon 调用转发
- **依赖**：模块0（类型）、模块1（Panel 骨架）、模块3（Pack 列表）、模块6（通信客户端）
- **Wave**：Wave 3（单独）

---

## 可修改文件范围

```
panel/backend/src/api/
└── routes/
    ├── servers.ts                  # Server CRUD + start/stop/command
    └── packs.ts                    # GET /api/packs 列出可用 Pack
```

## gsp 项目规范通用约束

- 禁止 import `daemon/src/` 内部代码
- 仅允许 import `public/schema/` 和 `public/interface_stub/` 下的契约
- 所有 API 必须匹配 `public/interface_stub/panel-rest.ts` 签名
- 所有数据读写必须通过 zod 校验

## 模块专属约束

1. **REST API 清单**：
   - `GET /api/packs` — 列出可用 Pack（JWT 鉴权）
   - `POST /api/servers` — 创建实例（选 pack_id，分配端口/rcon_port）
   - `GET /api/servers` — 列出当前用户实例
   - `GET /api/servers/:id` — 实例详情
   - `DELETE /api/servers/:id` — 删除（仅 stopped 状态）
   - `POST /api/servers/:id/start` → 转发 Daemon start
   - `POST /api/servers/:id/stop` → 转发 Daemon stop
   - `POST /api/servers/:id/command` → 转发 Daemon command

2. **端口分配**：创建实例时检测端口占用（游戏端口 25565+，RCON 端口 25575+）
3. **Daemon 转发**：start/stop/command 通过模块6的 daemonClient 转发到 Daemon
4. **删除限制**：仅 `stopped` 状态的实例可删除
5. **JWT 鉴权**：所有路由需 `authenticateToken` 中间件
6. **owner 隔离**：用户只能看到/操作自己的实例（P0 单用户 owner 模式）

## 依赖的契约入口

- `public/schema/panel-api-types.ts` → API 请求/响应类型
- `public/schema/daemon-api-types.ts` → 转发到 Daemon 的请求类型
- `public/interface_stub/panel-rest.ts` → Panel REST 接口签名
- 模块1 的 `db/` → 数据库读写
- 模块6 的 `daemonClient/` → Daemon 调用

## 测试要求

- 创建实例 API 可用
- 启动/停止/命令 API 转发到 Daemon
- 仅 stopped 状态可删除
- `curl` 全流程测试 PASS

## 失败回退

- 回退点：模块6 + 模块3 检查点
- 策略：API 路由可用 Mock Daemon 开发，待通信层就绪后联调

## 闭合判据

- `POST /api/servers` 创建实例成功
- `POST /api/servers/:id/start` 启动实例
- `POST /api/servers/:id/stop` 停止实例
- `POST /api/servers/:id/command` 发送命令
- `DELETE /api/servers/:id` 删除实例（仅 stopped）
