# 模块6_Panel通信客户端 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块6_Panel通信客户端
- **物理路径**：`panel/backend/src/daemonClient/`
- **职责**：HTTP 客户端(fetch+Bearer) + WS 事件流客户端 + 事件转发 + 重连
- **依赖**：模块0（类型）、模块1（Panel 骨架）、模块2（Daemon）
- **Wave**：Wave 2 P-G3 批1（与模块5并行）

---

## 可修改文件范围

```
panel/backend/src/daemonClient/
├── client.ts                       # HTTP 客户端（fetch + Bearer Token）
├── eventStream.ts                  # WS 客户端（订阅 Daemon 事件）
└── types.ts                        # 本地类型定义（实现 public 接口）
```

## gsp 项目规范通用约束

- 禁止 import `daemon/src/` 内部代码
- 仅允许 import `public/schema/` 和 `public/interface_stub/` 下的契约
- 所有 HTTP/WS 调用必须匹配 `public/interface_stub/daemon-rest.ts` 签名

## 模块专属约束

1. **HTTP 客户端**：使用 `fetch` + `Authorization: Bearer <token>` 头
2. **WS 客户端**：连接 `ws://<daemon_host>:<daemon_port>/ws?token=<token>`
3. **事件转发**：接收 Daemon WS 事件 → 转发到 Panel 前端 WS（订阅了对应 server_id 的客户端）
4. **重连机制**：exponential backoff（初始 1s，最大 30s，无限重试）
5. **事件类型**：`connected` / `instance.started` / `instance.stopped` / `console.output` / `state.change`
6. **Panel 作为事件中继**：Panel 后端接收 Daemon WS 事件，转发到前端 WS 客户端
7. **订阅机制**：Panel→Daemon 发送 `subscribe` 事件订阅特定实例

## 依赖的契约入口

- `public/schema/daemon-api-types.ts` → REST 请求/响应类型
- `public/schema/ws-events.ts` → WS 事件类型
- `public/interface_stub/daemon-rest.ts` → Daemon REST 接口签名

## 测试要求

- Panel 调用 Daemon `GET /api/instances` 成功
- WS 连接接收 `connected` 事件
- 断线自动重连
- 事件转发到前端 WS
- 集成测试 PASS

## 失败回退

- 回退点：PoC `poc/panel-daemon/panel.ts`（已验证 22/22 通信测试通过）
- 策略：以 PoC panel 客户端为参考，重写为生产代码

## 闭合判据

- Panel 调用 Daemon REST API 成功
- WS 事件流接收正常
- 断线重连机制工作
- 事件可转发到前端 WS
