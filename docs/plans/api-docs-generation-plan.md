---
type: plan
title: gsp 项目 API 接口梳理与文档化方案
date: 2026-07-25
status: done
related:
  - docs/api/00-index.md
  - docs/api/01-auth-user.md
  - docs/api/02-server-instance.md
  - docs/api/03-shop-player.md
  - docs/api/04-game-ops.md
  - docs/api/05-system-ops.md
  - docs/api/06-daemon.md
  - panel/backend/src/routes-registry.ts
  - daemon/src/server.ts
tags: [api, docs, plan, panel, daemon]
---

# gsp 项目 API 接口梳理与文档化方案

> 本方案文档记录 demo 阶段结束后，对 gsp 项目全部 API 接口进行系统梳理与文档化的执行步骤、开发事项与建议。方案编制不计人力工期与开发投入，不区分优先级。

## 一、背景与目标

### 1.1 背景

gsp 项目 demo 阶段已正式结束，进入实际功能开发阶段。前期开发积累了 59+ 业务路由工厂 + 内联路由 + 4 个系统模块路由 + Daemon 守护端 HTTP/WS 接口，接口规模庞大但缺乏统一的标准 API 文档库，新成员上手、跨模块协作、前后端联调均缺乏标准化接口参考依据。

### 1.2 目标

- 系统梳理 Panel 控制端 + Daemon 守护端的全部对外接口
- 输出标准 API 文档库，覆盖：接口名称、请求方法、URL 路径、请求参数（含类型/必填/说明）、响应数据结构、错误码、功能描述、调用示例
- 按业务域分册组织 + 总索引，便于查阅与维护
- 为后续功能开发、契约对齐、自动化测试、外部系统集成提供标准化依据

## 二、执行步骤

### 步骤 1：项目结构与路由注册中心分析

**事项**：
- 通过 `LS`/`Glob` 列出 `panel/backend/src/` 与 `daemon/src/` 全部 `.ts` 文件，定位路由层
- 读取 `panel/backend/src/routes-registry.ts`，提取所有路由工厂导入与挂载点
- 读取 `panel/backend/src/app.ts`，确认全局中间件链（cors/json/helmet/rateLimiter/maintenance/audit）
- 读取 `daemon/src/server.ts`，确认 Daemon HTTP + WS 路由清单
- 读取 `panel/backend/src/middleware/auth.ts`，提取鉴权机制（JWT + API Key 双路径，3 级角色，实例级鉴权）
- 读取 `panel/backend/src/services/errors.ts`，提取运行时错误类与错误码

**产出**：
- 路由挂载点表（含中间件叠加顺序）
- 全局中间件链顺序图
- 鉴权体系说明
- 错误码清单

### 步骤 2：业务域分组与并行分析策略

**事项**：
将 59+ 路由按业务域分为 5 组（Panel 后端）+ 1 组（Daemon），分别由独立 subagent 并行分析，避免上下文窗口爆炸与互相污染：

| 组 | 业务域 | 涉及路由文件数 | 输出分册 |
|----|--------|----------------|----------|
| A | 认证与用户域 | 11 | `01-auth-user.md` |
| B | 服务器与实例域 | 8 | `02-server-instance.md` |
| C | 商店与玩家域 | 15 | `03-shop-player.md` |
| D | 游戏运维域 | 13 | `04-game-ops.md` |
| E | 系统运维域（含模块 0-3） | 14 + 1 内联 | `05-system-ops.md` |
| F | Daemon 守护端 | 7 | `06-daemon.md` |

**调度策略**：
- subagent 统一使用 `general_purpose_task` 类型
- 每个 subagent 仅负责读取源码 + 生成单个 MD 文件，不修改任何源码
- 通过 prompt 注入统一的文档模板、鉴权背景、通用响应结构、调用示例域名规则
- 受保护上下文（已读取的 routes-registry.ts 摘录、错误码清单、鉴权机制说明）作为公共输入注入各 subagent
- 未保护上下文（瞬时分析状态）不跨 subagent 传递

### 步骤 3：分册文档生成（并行）

**事项**：
按统一模板为每个接口生成详细文档，每个分册包含：
- 顶部 frontmatter（type/title/date/status/related/tags）
- 概述章节（业务域说明、鉴权要求、统一约定）
- 接口详情（按业务功能聚类排序）
- 附录（错误码索引、源码索引）

**接口模板**：
```
### 接口名称（中文 + 英文）
- 功能描述
- 请求方法 / URL 路径
- 鉴权要求
- 请求参数（路径/查询/请求体表格 + JSON 示例）
- 响应数据（成功字段表 + JSON 示例 + 错误码列表）
- 调用示例（curl，统一使用 https://gsp.ecsrz.com:3001）
```

**产出**：
- 6 个分册文件，合计 312 个接口/事件
  - `01-auth-user.md`：46 接口
  - `02-server-instance.md`：55 接口
  - `03-shop-player.md`：72 接口
  - `04-game-ops.md`：58 接口
  - `05-system-ops.md`：54 接口
  - `06-daemon.md`：20 HTTP + 2 WS 命令 + 5 WS 事件 = 27

### 步骤 4：总索引文档生成

**事项**：
- 汇总 6 个分册的接口数量、业务覆盖
- 提取项目架构概览（Panel + Daemon + nginx 三层架构、端口与对外暴露策略）
- 提取统一约定（响应结构、错误码、鉴权体系、中间件链、WS 通道）
- 生成按业务域快速查找的接口分类索引
- 列出公共契约入口（`public/schema/`、`public/interface_stub/`）
- 制定文档维护规则

**产出**：
- `00-index.md`：API 文档库总索引

### 步骤 5：方案文档生成（本文档）

**事项**：
- 记录执行步骤、开发事项与建议
- 不区分优先级、不计人力工期

## 三、开发事项

### 3.1 文档库结构

```
docs/api/
├── 00-index.md              # 总索引（项目架构、统一约定、分类导航）
├── 01-auth-user.md          # 认证与用户域（46 接口）
├── 02-server-instance.md    # 服务器与实例域（55 接口）
├── 03-shop-player.md        # 商店与玩家域（72 接口）
├── 04-game-ops.md           # 游戏运维域（58 接口）
├── 05-system-ops.md         # 系统运维域（54 接口）
└── 06-daemon.md             # Daemon 守护端（27 接口/事件）
```

### 3.2 文档模板规范

每个接口条目必须包含：
- 中文接口名称
- 功能描述（1-2 句话）
- 请求方法（GET/POST/PUT/DELETE/PATCH）
- 完整 URL 路径（含 `/api` 前缀）
- 鉴权要求（无需鉴权 / JWT / JWT + requireAdmin / JWT + requireInstanceAccess / x-report-key 等）
- 请求参数表（路径参数 / 查询参数 / 请求体字段，含字段名、类型、必填、说明）
- 请求体 JSON 示例（如有）
- 成功响应字段表 + JSON 示例
- 错误响应（HTTP 状态码 + 错误码 + 含义）
- curl 调用示例

### 3.3 域名规则

| 调用方 | 被调方 | 示例地址 |
|--------|--------|----------|
| 浏览器/外部 | Panel 后端 | `https://gsp.ecsrz.com:3001`（公网 HTTPS） |
| 浏览器/外部 | Panel 后端（局域网） | `https://192.168.5.14:3001` |
| Panel 后端 | Daemon | `http://127.0.0.1:8080` 或 `http://192.168.5.14:8080` |
| Daemon | Panel 后端 | `https://gsp.ecsrz.com:3001`（反向上报） |

严禁在文档示例中使用 `localhost:3000` / `127.0.0.1:3000`（违反 `.trae/rules/0.md` 最高优先级规则）。

### 3.4 鉴权标注规范

每个接口必须显式标注鉴权要求，标注格式：
- `无需鉴权` — 公开端点（health/login/register/site-info/legal/init 等）
- `JWT` — 仅需登录（如 `/api/auth/me`、`/api/notifications`）
- `JWT + requireAdmin` — 需 server_admin 角色（如 `/api/users`、`/api/system-update`）
- `JWT + requireRole(INSTANCE_ADMIN, SERVER_ADMIN)` — 实例管理员或服务器管理员
- `JWT + requireInstanceAccess` — 实例访问权限（owner/共管/绑定/角色记录）
- `JWT + requireInstanceAdmin` — 实例管理员权限
- `Bearer Token（DAEMON_TOKEN）` — Daemon 端鉴权
- `x-report-key` — Daemon 反向上报 Panel（不走 authenticateToken）

## 四、建议

### 4.1 文档维护建议

1. **建立接口变更同步机制**：每次 PR 涉及路由变更时，必须同步更新对应分册与总索引；CI 可加入检查脚本扫描 `panel/backend/src/api/routes/` 与 `docs/api/` 的一致性
2. **错误码集中管理**：当前错误码分散在 `services/errors.ts` + `error-codes-schema.json` + 各路由 inline 返回中，建议统一收敛到 `error-codes-schema.json` 作为唯一真相源，并自动生成各分册附录
3. **契约对齐校验**：建议增加自动化测试，验证路由实现的请求/响应字段与 `public/schema/panel-api-types.ts` 契约一致；契约变更必须走 s0601 适配流程
4. **文档版本化**：每个分册 frontmatter 已含 `date` 与 `status` 字段，建议补充 `api_version`（对齐 `version.md`）便于追踪
5. **接口废弃流程**：废弃接口应在分册顶部"接口废弃说明"段落标记，并保留 30 天过渡期后再从文档库移除；同时在前端 TypeScript 类型上加 `@deprecated` 注释

### 4.2 接口质量建议

1. **响应结构统一性**：当前部分端点（如 `/api/version`、`/api/health`、`/api/version/changelog`）返回结构不规范，建议统一为 `{ data: ... }` 包裹或保持当前直返但显式在契约中标注
2. **Daemon 鉴权失败响应**：Daemon 401/403 使用 `{ "error": "missing_authorization" }` 简化形式，与 Panel 的 `{ "error": { code, message } }` 不一致，建议在下次 Daemon 升级时统一为结构化错误响应
3. **错误码语义化**：部分错误码（如 `DAEMON_INTERNAL_ERROR`）被用于多种业务场景（请求体校验失败、内部错误等），建议拆分为更细粒度的错误码以提升前端错误处理精度
4. **路径参数校验**：部分路由未对路径参数做格式校验（如 UUID 格式），建议增加统一的路径参数校验中间件
5. **API Key 路径标注**：当前文档默认 JWT 鉴权，API Key 旁路鉴权作为可选路径未在每个接口显式标注，建议在总索引统一说明"所有标注 JWT 的接口均支持 x-api-key 旁路"

### 4.3 文档工具化建议

1. **生成 OpenAPI/Swagger 规范**：基于现有 6 个分册 + `public/schema/panel-api-types.ts` 契约，可自动生成 OpenAPI 3.0 规范文件，配合 Swagger UI / Redoc 提供交互式 API 浏览
2. **Postman Collection 导出**：为前端联调与外部集成方提供 Postman Collection，按业务域分组
3. **Mock Server 生成**：基于 `public/pre_generated_mock/` 与契约自动生成 Mock Server，便于前端独立联调
4. **接口测试覆盖率统计**：将文档库接口清单与现有 E2E 测试（Playwright）+ 单元测试做映射，识别未覆盖接口

### 4.4 后续分册扩展建议

当出现以下情况时新增分册：
1. 新增独立业务域（如"支付网关"、"消息推送"、"数据分析"等）→ 新增 `07-xxx.md` 编号分册
2. 新增独立模块（如 `modules/模块N_xxx/`）→ 评估是否独立成册或并入相关业务域分册
3. 新增对外协议（如 gRPC、MQTT 等）→ 新增协议专项分册

新增分册时必须同步更新 `00-index.md` 总索引的分册导航表、接口数量统计、分类索引。

## 五、subagent 调度台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|----------|-------|---------------|----------|-----------------|----------|------------|------|
| 分册 01 | — | general_purpose_task | `docs/api/01-auth-user.md` | subagent-01 | `docs/api/01-auth-user.md` | 主线程内联补写 | 已完成 |
| 分册 02 | — | general_purpose_task | `docs/api/02-server-instance.md` | subagent-02 | `docs/api/02-server-instance.md` | 主线程内联补写 | 已完成 |
| 分册 03 | — | general_purpose_task | `docs/api/03-shop-player.md` | subagent-03 | `docs/api/03-shop-player.md` | 主线程内联补写 | 已完成 |
| 分册 04 | — | general_purpose_task | `docs/api/04-game-ops.md` | subagent-04 | `docs/api/04-game-ops.md` | 主线程内联补写 | 已完成 |
| 分册 05 | — | general_purpose_task | `docs/api/05-system-ops.md` | subagent-05 | `docs/api/05-system-ops.md` | 主线程内联补写 | 已完成 |
| 分册 06 | — | general_purpose_task | `docs/api/06-daemon.md` | subagent-06 | `docs/api/06-daemon.md` | 主线程内联补写 | 已完成 |
| 总索引 | — | 主线程（非subagent） | `docs/api/00-index.md` | 主线程 | `docs/api/00-index.md` | — | 已完成 |
| 方案文档 | — | 主线程（非subagent） | `docs/plans/api-docs-generation-plan.md` | 主线程 | `docs/plans/api-docs-generation-plan.md` | — | 已完成 |

> 调度说明：6 个分册 subagent 顺序启动（每个 subagent 完成后再启动下一个，避免并行 subagent 间的文件写入冲突与上下文窗口压力）；总索引与方案文档由主线程内联生成，基于 6 个分册的产出汇报汇总。

## 六、交付清单

| 文件 | 行数（约） | 接口/事件数 | 说明 |
|------|-----------|-------------|------|
| `docs/api/00-index.md` | 308 | — | 总索引 |
| `docs/api/01-auth-user.md` | 1919 | 46 | 认证与用户域 |
| `docs/api/02-server-instance.md` | — | 55 | 服务器与实例域 |
| `docs/api/03-shop-player.md` | 2410 | 72 | 商店与玩家域 |
| `docs/api/04-game-ops.md` | — | 58 | 游戏运维域 |
| `docs/api/05-system-ops.md` | 3226 | 54 | 系统运维域 |
| `docs/api/06-daemon.md` | 1592 | 27 | Daemon 守护端 |
| `docs/plans/api-docs-generation-plan.md` | 本文档 | — | 方案文档 |
| **合计** | — | **312** | — |

## 七、闭合判据

- ✅ 6 个分册文件全部创建，frontmatter 字段完整
- ✅ 每个接口条目按统一模板填写（功能描述/方法/URL/鉴权/参数表/响应表/JSON 示例/错误码/curl 示例）
- ✅ 所有参数类型、字段名、必填性、错误码从源码逐项核对
- ✅ 调用示例统一使用 `https://gsp.ecsrz.com:3001`（Panel）或 `http://127.0.0.1:8080`（Daemon），无 `localhost:3000` / `127.0.0.1:3000` 违规
- ✅ 总索引包含项目架构、分册导航、统一约定、分类索引、公共契约入口、维护规则
- ✅ 方案文档包含执行步骤、开发事项、建议、调度台账、交付清单
- ✅ 未修改任何源码文件
- ✅ 文档全部为中文
