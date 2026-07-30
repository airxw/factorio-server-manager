# 模块1_Panel后端骨架 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块1_Panel后端骨架
- **物理路径**：`panel/backend/src/{core,db,middleware,websocket}/`
- **职责**：Express + Knex + SQLite + JWT 认证 + WS 服务端 + Pack Registry/Loader
- **依赖**：模块0（public/ 契约）
- **Wave**：Wave 1 P-G1（与模块2并行）

---

## 可修改文件范围

```
panel/backend/
├── src/
│   ├── core/
│   │   ├── auth/
│   │   │   ├── jwt.ts              # JWT 签发/验证
│   │   │   ├── roles.ts            # 4级角色：system_admin/admin/operator/viewer
│   │   │   └── permissions.ts      # 权限矩阵
│   │   └── packs/
│   │       ├── registry.ts         # PackRegistry 类
│   │       └── loader.ts           # YAML 加载器（js-yaml + zod）
│   ├── db/
│   │   ├── connection.ts           # Knex 连接
│   │   ├── schema.ts               # 表结构（users/nodes/servers/packs）
│   │   └── migrations/
│   ├── middleware/
│   │   └── auth.ts                 # authenticateToken 中间件
│   ├── websocket/
│   │   └── server.ts               # Panel→Frontend WS 服务端
│   └── index.ts                    # Express 入口
├── package.json
├── tsconfig.json
└── .env.example
```

## gsp 项目规范通用约束

- 禁止 import `daemon/src/` 内部代码
- 禁止 import `panel/frontend/` 内部代码
- 仅允许 import `public/schema/` 和 `public/interface_stub/` 下的契约
- 所有数据读写必须通过 zod 校验

## 模块专属约束

1. **Express 框架**：使用 Express（非 Fastify），与现有项目一致
2. **数据库**：P0 用 SQLite（零配置），Knex 支持 P4 切 PostgreSQL
3. **JWT 认证**：Panel↔Frontend 用 JWT，Panel↔Daemon 用 Bearer Token（Bearer Token 在模块6实现）
4. **WS 服务端**：`websocket/server.ts` 实现 Panel→Frontend WS，按 server_id 隔离订阅，JWT query 鉴权
5. **预设 admin**：seed 脚本创建 system_admin 账号，无注册流程
6. **Pack Registry**：从 `packs/` 目录加载 YAML，用 `public/schema/pack-schema.ts` 校验
7. **端口**：Panel 后端监听 127.0.0.1:3002（仅本机，nginx 3001 反代，见 0.md）

## 依赖的契约入口

- `public/schema/pack-schema.ts` → Pack 加载校验
- `public/schema/panel-api-types.ts` → API 类型
- `public/schema/ws-events.ts` → WS 事件类型
- `public/config_template/panel.env.template` → 环境变量模板

## 测试要求

- `GET /api/health` 返回 200
- `POST /api/auth/login` 返回 JWT
- WS 连接 `ws://127.0.0.1:3002/ws?token=<jwt>` 成功（Panel 内部端口，见 0.md）
- 无 token / 错误 token 访问受保护路由返回 401

## 失败回退

- 回退点：PoC `poc/panel-daemon/panel.ts`（已验证通信）
- 策略：以 PoC panel 为骨架参考，重写为生产代码

## 闭合判据

- `npm run dev` 启动 Panel 后端无错误
- health + login + WS 全部可用
- `tsc --noEmit` 通过
