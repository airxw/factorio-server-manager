# 模块8_前端应用 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块8_前端应用
- **物理路径**：`panel/frontend/`
- **职责**：React + Vite + 路由 + 登录/列表/创建/详情 + Console Tab + WS 日志流
- **依赖**：模块0（类型）、模块7（Panel API）
- **Wave**：Wave 4（单独）

---

## 可修改文件范围

```
panel/frontend/
├── src/
│   ├── pages/
│   │   ├── Login.tsx               # 登录页
│   │   ├── Servers.tsx             # 服务器列表 + 创建按钮
│   │   ├── CreateServer.tsx        # 选 Pack + 填名称 + 端口
│   │   ├── ServerDetail.tsx        # 兼容再导出层（v4.36.0 拆分，指向 ServerDetailCore）
│   │   └── instance-detail/ServerDetailCore.tsx  # 详情页核心（含 Console Tab + Tab 注册表）
│   ├── components/
│   │   └── RconConsole.tsx         # 命令输入 + WS 日志流 + 响应回显
│   ├── api/
│   │   └── client.ts               # axios 封装 + JWT 拦截器
│   ├── hooks/
│   │   └── useDaemonEvents.ts      # WS 事件订阅
│   ├── App.tsx                     # 路由
│   └── main.tsx                    # 入口
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## gsp 项目规范通用约束

- 禁止 import `panel/backend/` 或 `daemon/` 内部代码
- 仅允许 import `public/schema/` 下的类型定义
- TypeScript strict 模式，禁止 any

## 模块专属约束

1. **框架**：React 19 + Vite
2. **UI 库**：shadcn/ui + Tailwind CSS（非 Ant Design）
3. **路由**：`/login` `/servers` `/servers/:id`
4. **API 客户端**：axios + JWT 拦截器（自动附加 Authorization 头）
5. **WS 订阅**：`useDaemonEvents` hook 订阅 Panel WS，接收 `console.output` 和 `instance.state` 事件
6. **Console Tab**：命令输入框 + WS 日志流 + RCON 响应回显
7. **状态管理**：React Context + hooks（P0 不引入 Redux/Zustand）

## 依赖的契约入口

- `public/schema/panel-api-types.ts` → API 请求/响应类型
- `public/schema/ws-events.ts` → WS 事件类型
- 模块7 的 REST API → 后端接口

## 测试要求

- 前端可登录（调 `/api/auth/login` 获取 JWT）
- 可创建实例（选 Pack + 填名称）
- 可查看服务器列表
- 可进入详情页
- 可在 Console 发送命令并看到实时日志
- 浏览器手动验证 PASS

## 失败回退

- 回退点：模块7 检查点
- 策略：前端可用 Mock API 开发（Mock 响应数据），待 API 就绪后联调

## 闭合判据

- 登录/创建/控制台全流程可用
- WS 日志实时推送可见
- 命令发送 + 响应回显正常
