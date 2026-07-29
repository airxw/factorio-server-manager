# Tasks

## Phase 1（当前阶段）

### Task 1: 初始化前后端项目结构 ✅
- [x] SubTask 1.1: 创建后端项目目录（Node.js + Express + TypeScript），初始化依赖管理
- [x] SubTask 1.2: 创建前端项目目录（React + TypeScript + Vite），初始化构建工具
- [x] SubTask 1.3: 配置 npm workspaces、跨域（CORS + Vite 代理）、开发脚本、基础目录结构
- [x] SubTask 1.4: 配置 `.env.example`、`.gitignore`、TypeScript 编译选项

### Task 2: 实现用户认证模块 ✅
- [x] SubTask 2.1: 后端实现 `POST /api/auth/login`（bcrypt 密码比对 + JWT 签发）
- [x] SubTask 2.2: 后端实现 `authenticateToken` 中间件与 `requireAdmin` 权限校验
- [x] SubTask 2.3: 后端实现 `GET /api/auth/me`（token 验证）
- [x] SubTask 2.4: 前端实现登录页面（表单 + 错误提示）
- [x] SubTask 2.5: 前端实现 AuthContext（token 持久化、刷新恢复、401 自动登出）
- [x] SubTask 2.6: 前端实现 PrivateRoute（未认证跳转登录页）

### Task 3: 实现 Factorio 服务端下载管理 ✅
- [x] SubTask 3.1: 后端实现从官方源异步下载 headless 服务端（axios stream + `tar -xJf` 解压）
- [x] SubTask 3.2: 后端实现下载任务管理（内存 Map，状态机：pending → downloading → done/error）
- [x] SubTask 3.3: 后端实现 SSE 下载进度推送（`GET /api/server/download/:id/progress`）
- [x] SubTask 3.4: 后端实现重复下载防护（同一版本并发去重）
- [x] SubTask 3.5: 后端实现已下载版本列表扫描（`GET /api/server/versions`）
- [x] SubTask 3.6: 前端实现版本输入、下载按钮、进度条、状态展示
- [x] SubTask 3.7: 前端实现 SSE 进度流订阅与自动刷新版本列表

### Task 4: 实现配置管理 ✅（部分）
- [x] SubTask 4.1: 后端实现 4 个配置文件的读取与写入接口（`GET/POST /api/config/:name`）
- [x] SubTask 4.2: 后端实现 `server-settings.json` 详细字段校验
- [x] SubTask 4.3: 后端实现配置保存前自动备份（`config/backups/`）
- [x] SubTask 4.4: 后端实现配置导入/导出接口
- [x] SubTask 4.5: 前端实现配置编辑页面（选择配置文件 → 编辑 JSON → 保存/导入/导出）
- [x] SubTask 4.6: 后端实现敏感字段脱敏（`token`、`game_password` 返回时替换为 `***`）
- [ ] SubTask 4.7: 后端实现 `map-gen-settings.json` 和 `map-settings.json` 详细字段校验

### Task 5: 实现服务端生命周期管理 ✅
- [x] SubTask 5.1: 后端封装 Factorio 进程启动/停止/重启逻辑（`spawn` + SIGTERM/SIGKILL）
- [x] SubTask 5.2: 后端实现状态机（stopped / starting / running / error）
- [x] SubTask 5.3: 后端监听进程 stdout/stderr/exit/error 事件
- [x] SubTask 5.4: 后端实现启动参数构造（`--start-server`、`--server-settings`、`--port`）
- [x] SubTask 5.5: 后端实现自动选择最新存档（未指定存档时）
- [x] SubTask 5.6: 前端实现启动/停止/重启按钮、版本与存档选择下拉框、状态显示
- [x] SubTask 5.7: 前端实现 3 秒轮询刷新状态

### Task 6: 实现日志实时推送 ✅
- [x] SubTask 6.1: 后端通过 WebSocket 实时推送日志行（JSON 帧 `{"type":"log","message":"..."}`）
- [x] SubTask 6.2: 后端 WebSocket 连接时 JWT 认证（URL 参数 `?token=xxx`）
- [x] SubTask 6.3: 后端连接后推送最近 100 行历史日志
- [x] SubTask 6.4: 后端实现日志缓冲区（最近 1000 行，环形覆盖）
- [x] SubTask 6.5: 后端实现 `filter` / `pause` / `resume` 控制消息
- [x] SubTask 6.6: 后端实现 `GET /api/server/logs` 历史日志查询（count + filter 参数）
- [x] SubTask 6.7: 前端实现日志滚动面板、关键字过滤输入框、暂停/继续按钮
- [x] SubTask 6.8: 前端实现 WebSocket 断线自动重连（当前固定 3 秒，未实现指数退避）
- [x] SubTask 6.9: 后端实现 WebSocket 心跳保活（ping/pong，30 秒间隔）

### Task 7: 实现控制台指令发送 ✅
- [x] SubTask 7.1: 后端实现向 Factorio 进程 stdin 写入指令的接口（`POST /api/server/command`）
- [x] SubTask 7.2: 后端未运行时返回 400 错误
- [x] SubTask 7.3: 前端实现指令输入框与提交按钮
- [x] SubTask 7.4: 前端实现指令历史记录（当前为内存存储，未持久化到 localStorage）

### Task 8: 实现存档管理 ✅
- [x] SubTask 8.1: 后端实现存档列表接口（`GET /api/saves`，含名称、大小、修改时间，按时间倒序）
- [x] SubTask 8.2: 后端实现存档上传接口（multer 磁盘存储，`.zip` 白名单，最大 2GB）
- [x] SubTask 8.3: 后端实现存档有效性校验（手写流式 zip 中央目录解析：findEocd + 扫描条目判断 `level.dat`，避免 2GB 存档 OOM）
- [x] SubTask 8.4: 后端实现存档下载、删除、重命名接口
- [x] SubTask 8.5: 后端实现路径穿越防护（`path.basename()` 校验）
- [x] SubTask 8.6: 前端实现存档列表页面（表格 + 上传 + 删除 + 重命名 + 下载按钮）

### Task 9: 实现 Mod 管理 ✅
- [x] SubTask 9.1: 后端实现 Mod 列表读取（解析文件名 `{name}_{version}.zip`，合并 `mod-list.json` 状态）
- [x] SubTask 9.2: 后端实现 Mod 上传接口（multer 磁盘存储，`.zip` 白名单）
- [x] SubTask 9.3: 后端实现 Mod 启用/禁用（`POST /api/mods/:name/toggle`）
- [x] SubTask 9.4: 后端实现 Mod 删除接口
- [x] SubTask 9.5: 后端实现 Mod 列表同步（`POST /api/mods/sync`，扫描文件系统更新 `mod-list.json`）
- [x] SubTask 9.6: 前端实现 Mod 列表页面（表格 + 启用/禁用开关 + 上传 + 删除 + 同步按钮）

### Task 10: 安全加固 ✅
- [x] SubTask 10.1: 后端实现 `server-settings.json` 敏感字段脱敏（`token`、`game_password`）
- [x] SubTask 10.2: 后端实现请求速率限制（登录接口 5 次/分钟，内存计数器）
- [x] SubTask 10.3: 后端实现 Mod 上传大小限制（100MB，从 `UPLOAD_MOD_MAX_SIZE` 读取）
- [x] SubTask 10.4: 后端生产环境启动时检查 JWT_SECRET 是否为默认值，若是则打印警告

### Task 11: 测试与文档 — 因项目架构升级而取消
- [x] SubTask 11.1-11.9: ~~原 Factorio 单游戏管理器测试计划~~ → 项目已升级为 GameServer Panel 3.0（Express+Knex+SQLite+5 Pack 体系），原测试架构不再适用。测试覆盖已通过后续 spec 体系的单元测试 + E2E + Mock 回归承接。

---

## Phase 2（后续迭代）— 已被后续 spec 覆盖，不再需要独立追踪

### Task 12: 玩家管理 — 已被覆盖
- [x] 已在 Panel 体系中通过玩家绑定/玩家历史/!players 命令实现。详见 `add-in-game-chat-commands` spec。

### Task 13: 白名单/封禁/管理员列表管理 — 已被覆盖
- [x] 已在 Panel 的 `lists` 服务（白名单/黑名单统一管理）中实现。详见 `extend-pack-schema-for-factorio` spec。

### Task 14: 自动重启与崩溃恢复 — 已被覆盖
- [x] 已在 Daemon 的 `manager.ts` 中实现（MAX_RESTART_ATTEMPTS + 指数退避）。

### Task 15: 资源监控 — 已被覆盖
- [x] 已在 Panel 的系统健康页 + monitorService + monitor_snapshots 表中实现。详见 `restore-vip-shop-and-redesign-sidebar` spec。

### Task 16: 备份与回滚 — 已被覆盖
- [x] 已在 Panel 的 backupService + backup_records 表中实现。详见 `extend-pack-schema-for-factorio` spec。

### Task 17: Mod 依赖校验 — 部分覆盖
- [x] Pack mods 字段已有 `dependency_check` 声明，基础文件解析校验不完善。低优先级，可在后续增强。

### Task 18: 通知告警 — 已被覆盖
- [x] 已在 Panel 的 webhookService + webhooks 表中实现（支持 Discord/Slack）。

### Task 19: 多实例管理 — 已被覆盖
- [x] 项目从一开始即为 Panel+Daemon 多实例架构，非原单实例模型。详见 `p0-platform-skeleton` spec。

---

# Task Dependencies

```
Task 1 (项目结构) ─────────────────────────────────────────────────────────────┐
    │                                                                          │
    ├── Task 2 (认证) ─────────────────────────────────────────────────────┐   │
    │       │                                                              │   │
    │       ├── Task 3 (下载管理) ─────────────────────────────────────┐   │   │
    │       │       │                                                  │   │   │
    │       │       └── Task 5 (生命周期) ─────────────────────────┐   │   │   │
    │       │               │                                      │   │   │   │
    │       │               ├── Task 6 (日志推送) ─────────────┐   │   │   │   │
    │       │               │       │                          │   │   │   │   │
    │       │               │       └── Task 7 (指令发送)      │   │   │   │   │
    │       │               │                                  │   │   │   │   │
    │       │               └── Task 12 (玩家管理) ────────────┼───│───│───│───│── (Phase 2)
    │       │                                                  │   │   │   │   │
    │       ├── Task 4 (配置管理)                               │   │   │   │   │
    │       │                                                  │   │   │   │   │
    │       ├── Task 8 (存档管理)                               │   │   │   │   │
    │       │                                                  │   │   │   │   │
    │       └── Task 9 (Mod 管理)                               │   │   │   │   │
    │                                                          │   │   │   │   │
    └── Task 10 (安全加固) ─────────────────────────────────────│───│───│───│───│
    └── Task 11 (测试与文档) ───────────────────────────────────│───│───│───│───│
                                                                │   │   │   │   │
    (Phase 2 tasks) ────────────────────────────────────────────┘   │   │   │   │
    ├── Task 13 (白名单/封禁管理)                                     │   │   │   │
    ├── Task 14 (自动重启) ─────────────────── 依赖 Task 5 ──────────┘   │   │   │
    ├── Task 15 (资源监控) ─────────────────── 依赖 Task 5 ──────────────┘   │   │
    ├── Task 16 (备份回滚) ─────────────────── 依赖 Task 4/8/9 ──────────────┘   │
    ├── Task 17 (Mod 依赖校验) ─────────────── 依赖 Task 9 ──────────────────────┘
    ├── Task 18 (通知告警) ─────────────────── 依赖 Task 5 ──────────────────────┘
    └── Task 19 (多实例管理) ────────────────── 依赖 Task 5/6/4/8/9 ──────────────┘
                                                                                
    注：Task 19 需重构进程管理服务为多实例模型，影响 Task 5/6 的单实例假设；
        建议在 Task 12-18 完成后启动，避免与 Phase 2 其他功能并行产生冲突。
```

## 并行化建议
- Task 2、3、4、8、9 可并行开发（均依赖 Task 1）
- Task 5 依赖 Task 3（需已下载二进制）与 Task 8（需存档），但可用 mock 并行开发
- Task 6、7 依赖 Task 5（需运行进程），可通过 mock 日志流并行开发前端
- Task 10 可在 Task 2-9 全部完成后集中处理
- Task 11 应与 Task 2-9 开发同步进行，而非最后集中补
- Task 12-18 之间相互独立，可并行开发（均依赖 Phase 1 已稳定的模块）
- **Task 19 建议最后启动**：需重构进程管理为多实例模型，与 Task 14（自动重启）、Task 15（资源监控）、Task 6（日志推送）有耦合，应在这些 Task 稳定后再重构