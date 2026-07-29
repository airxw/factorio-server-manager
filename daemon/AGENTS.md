# 模块2_Daemon后端骨架 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块2_Daemon后端骨架
- **物理路径**：`daemon/src/`
- **职责**：Express + ws + Bearer Token/WS query token 鉴权
- **依赖**：模块0（public/ 契约）
- **Wave**：Wave 1 P-G1（与模块1并行）

---

## 可修改文件范围

```
daemon/
├── src/
│   ├── server.ts                   # Express + ws 服务端
│   ├── auth.ts                     # Bearer Token + WS query token 鉴权
│   └── index.ts                    # 入口
├── package.json
├── tsconfig.json
└── .env.example
```

## gsp 项目规范通用约束

- 禁止 import `panel/backend/` 或 `panel/frontend/` 内部代码
- 仅允许 import `public/schema/` 和 `public/interface_stub/` 下的契约
- 所有接口必须匹配 `public/interface_stub/daemon-rest.ts` 签名

## 模块专属约束

1. **单端口双协议**：HTTP + WebSocket 共用一个端口（8080），WS 路径为 `/ws`
2. **Bearer Token 鉴权**：REST 请求头 `Authorization: Bearer <token>`，无 token 返回 401，错误 token 返回 403
3. **WS query token 鉴权**：`ws://host:8080/ws?token=<token>`，错误 token 关闭连接 code=4001
4. **WS 鉴权时序**：`open` 事件先于 `close` 触发，必须等 `close` 事件确认鉴权拒绝（PoC 验证）
5. **健康检查**：`GET /health` 无需鉴权，返回 200
6. **占位路由**：`/api/instances` 路由占位，实际实现在模块4
7. **端口**：Daemon 监听 8080

## 依赖的契约入口

- `public/schema/daemon-api-types.ts` → API 类型
- `public/schema/ws-events.ts` → WS 事件类型
- `public/interface_stub/daemon-rest.ts` → 接口签名
- `public/config_template/daemon.env.template` → 环境变量模板

## 测试要求

- `GET /health` 返回 200（无需 token）
- 无 token 访问 `/api/instances` 返回 401
- 错误 token 访问返回 403
- WS 无 token / 错误 token 连接被关闭（code=4001）

## 失败回退

- 回退点：PoC `poc/panel-daemon/daemon.ts`（已验证 22/22 测试通过）
- 策略：以 PoC daemon 为骨架参考，重写为生产代码

## 闭合判据

- `npm run daemon` 启动无错误
- health + 401 拦截 + WS 鉴权 全部可用
- `tsc --noEmit` 通过
