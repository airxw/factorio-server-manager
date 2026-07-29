# Phase 1 验收清单（当前阶段）

## 项目基础
- [x] 前后端项目结构已初始化，`backend/` 与 `frontend/` 独立目录
- [x] npm workspaces 配置完成，`npm install` 统一安装依赖
- [x] TypeScript 编译配置就绪（`tsconfig.json`）
- [x] 开发脚本 `npm run dev` 同时启动前后端
- [x] 构建脚本 `npm run build` 可用
- [x] `.env.example` 模板文件存在，含所有必需配置项
- [x] `.gitignore` 覆盖 `node_modules/`、`dist/`、`.env`、`data/factorio/bin/`、`data/factorio/temp/`

## 认证与权限
- [x] `POST /api/auth/login` 接口可用，返回 JWT token
- [x] 密码使用 bcrypt（salt rounds=10）哈希存储
- [x] JWT 中间件 `authenticateToken` 校验所有受保护路由
- [x] `requireAdmin` 中间件校验管理员角色
- [x] 前端登录页面可用，登录后 token 持久化到 localStorage
- [x] 页面刷新后自动恢复登录状态（`GET /api/auth/me`）
- [x] 401 响应自动触发前端登出与跳转
- [x] 非管理员用户无法执行写操作（启动/停止/下载/配置修改等）

## 服务端下载管理
- [x] 后端支持从 Factorio 官方源异步下载 `.tar.xz` 并解压
- [x] 下载进度通过 SSE 实时推送到前端
- [x] 前端显示进度条（百分比 + 状态）
- [x] 同一版本重复下载返回已有任务 ID，不创建新任务
- [x] 下载失败时清理临时文件，前端显示错误信息
- [x] `GET /api/server/versions` 返回已下载版本列表
- [ ] 下载 URL 可配置（支持镜像源）

## 配置管理
- [x] 支持 `server-settings.json`、`map-gen-settings.json`、`map-settings.json`、`mod-list.json` 读写
- [x] `server-settings.json` 有详细字段校验（类型、范围、枚举值）
- [x] 其他配置文件有基础 JSON 格式校验
- [x] 配置保存前自动备份到 `config/backups/`（带时间戳）
- [x] 配置导入/导出功能可用
- [x] 前端配置编辑页面可用
- [x] `server-settings.json` 中 `token`、`game_password` 字段在 API 返回时脱敏
- [ ] `map-gen-settings.json` 和 `map-settings.json` 有详细字段校验

## 服务端生命周期
- [x] 启动 Factorio 进程（`spawn` + `--start-server` 参数）
- [x] 停止（优雅 SIGTERM → 10s 超时 → SIGKILL）
- [x] 重启（停止 → 启动）
- [x] 状态机：stopped / starting / running / error
- [x] 前端实时显示状态（3 秒轮询刷新）
- [x] 启动参数包含 `--server-settings`、`--port`、存档路径
- [x] 版本选择下拉框从已下载列表加载
- [x] 存档选择下拉框从存档列表加载
- [x] 启动失败时提供明确的错误原因（缺少二进制/存档/权限等）
- [x] 禁止重复启动（状态检查互斥）

## 日志实时推送
- [x] WebSocket 实时推送日志（`/ws?token=xxx`）
- [x] WebSocket 连接时验证 JWT
- [x] 连接后推送最近 100 行历史日志
- [x] 支持 `filter:xxx` 关键字过滤（不区分大小写）
- [x] 支持 `pause` / `resume` 控制推送
- [x] 日志缓冲区最近 1000 行，可配置
- [x] 前端日志页面支持滚动查看、过滤、暂停/继续
- [x] `GET /api/server/logs?count=N&filter=xxx` 历史日志查询
- [x] WebSocket 断线自动重连（前端，固定 3 秒）
- [x] WebSocket 心跳保活机制

## 控制台指令
- [x] 向 Factorio 进程 stdin 写入指令
- [x] 未运行时返回 400 错误
- [x] 前端指令输入框可用
- [x] 指令历史记录（前端，内存存储）
- [x] 指令执行结果回显（spec 已调整为通过日志流回显，不单独输出通道；指令发送时写入 `[command]` 标记便于识别）

## 存档管理
- [x] 存档列表（名称、大小、修改时间），按时间倒序
- [x] 上传存档（最大 2GB，`.zip` 白名单）
- [x] 存档有效性校验（检测 `level.dat` 文件）
- [x] 无效存档自动删除
- [x] 路径穿越防护（`path.basename()` 校验）
- [x] 下载存档
- [x] 删除存档
- [x] 重命名存档
- [x] 前端存档管理页面（列表 + 上传 + 删除 + 重命名 + 下载）
- [ ] 存档大小格式化显示（MB/GB）

## Mod 管理
- [x] Mod 列表（文件名、名称、版本、启用状态），按名称排序
- [x] 上传 Mod（`.zip` 白名单）
- [x] 文件名解析（`{name}_{version}.zip` 格式）
- [x] 启用/禁用 Mod（更新 `mod-list.json`）
- [x] 删除 Mod
- [x] 同步 Mod 列表（`POST /api/mods/sync`）
- [x] 前端 Mod 管理页面可用
- [x] Mod 上传大小限制（100MB，从 `UPLOAD_MOD_MAX_SIZE` 读取）

## 安全
- [x] 所有管理接口（除登录/健康检查）均需 JWT 认证
- [x] 写操作额外要求 `admin` 角色
- [x] 文件上传类型白名单（`.zip`）
- [x] 路径穿越防护
- [x] CORS 白名单仅允许前端地址
- [x] 生产环境 JWT_SECRET 强制修改（fallback 警告）
- [x] 请求速率限制（防暴力破解，登录接口 5 次/分钟）
- [x] `server-settings.json` 敏感字段脱敏

## 测试
- [ ] 后端 API 单元测试（认证中间件、路由处理函数）
- [ ] 进程管理 mock 测试（spawn 行为模拟）
- [ ] 配置校验逻辑测试（合法/非法输入全覆盖）
- [ ] 存档校验逻辑测试（流式 zip 中央目录解析，含畸形/超大文件）
- [ ] 前端组件单元测试（关键页面）
- [ ] 端到端测试（下载 → 启动 → 日志 → 指令 → 停止完整流程）

## 文档
- [x] README.md 包含技术栈、目录结构、快速开始
- [x] 部署说明（环境变量配置、二进制放置）
- [ ] API 文档（OpenAPI/Swagger 或 Markdown 参考）
- [ ] 配置项说明（`server-settings.json` 各字段含义）
- [x] 故障排查指南（spec.md 中已含 8 个常见问题表）
- [x] 环境变量配置参考表（spec.md 中已含 14 个变量）

## 架构与部署（设计产出物，已在 spec.md 中完成）
- [x] 系统架构概览图（Mermaid，4 个 subgraph：浏览器/后端服务/Factorio 运行时/文件系统）
- [x] 组件职责表（9 个组件：React SPA / Express API / WS Server / SSE / Auth / 进程管理 / 文件系统 / 下载服务 / Factorio Headless）
- [x] 关键数据流序列图（启动服务端 / 日志实时推送 / 存档上传与流式校验）
- [x] 目录结构树（backend / frontend / data/factorio 三层）
- [x] 架构约束与边界（单实例假设 / 无数据库 / 进程隔离 / 通信边界）
- [x] 运行环境要求表（OS / Node / 内存 / 磁盘 / 系统依赖 / 网络）
- [x] 部署方式三选一（Dockerfile / systemd unit / 裸机 npm）
- [x] 环境变量配置参考表（14 个变量）
- [x] 监控与告警方案（Phase 1 已具备 + Phase 2 规划）
- [x] 故障排查指南（8 个常见问题）
- [x] 备份策略（配置 / 存档 / 元数据 / 回滚）

## 数据契约与状态机（设计产出物，已在 spec.md 中完成）
- [x] 状态机转换图（Mermaid stateDiagram-v2，5 个状态：stopped/starting/running/stopping/error）
- [x] 合法状态转换表（9 个转换，含触发条件与副作用）
- [x] 非法转换列表（3 个，返回 HTTP 409）
- [x] ServerStatus TypeScript 接口定义
- [x] `users.json` 数据结构（6 个字段，含类型/必填/说明）
- [x] `instances.json` 数据结构（Phase 2，8 个字段）
- [x] 下载任务对象 TypeScript 接口（9 个字段）
- [x] WebSocket 消息格式（9 种消息类型，S→C 5 种 + C→S 4 种）
- [x] SSE 事件格式（3 种事件：progress/done/error）
- [x] API 统一响应格式（成功 `{data, message}` + 错误 `{error, details, code}`）
- [x] 错误码表（20 个错误码，含 HTTP 状态与说明）
- [x] 日志缓冲区结构（LogBuffer 类，环形数组）
- [x] `server-settings.json` 字段校验规则（23 个字段，含类型/必填/校验规则/默认值）
- [x] 接口规范详解（22 个接口，每个含认证要求/请求参数/响应示例/错误码）

---

# Phase 2 验收清单（待实现）

## 玩家管理
- [ ] 在线玩家列表（通过 `/players` 指令或 RCON 获取，标注 `/players` 输出解析的技术风险）
- [ ] 踢出玩家 Web 操作（`/kick <player>` 指令封装）
- [ ] 封禁玩家 Web 操作（`/ban <player>` 指令 + `server-banlist.json` 持久化）
- [ ] 解封玩家 Web 操作（`/unban <player>` 指令 + 列表移除）
- [ ] 前端玩家管理页面（在线列表 + 踢出/封禁/解封按钮）

## 白名单/封禁/管理员列表管理
- [ ] `server-whitelist.json` 读取与编辑接口
- [ ] `server-banlist.json` 读取与编辑接口
- [ ] `server-adminlist.json` 读取与编辑接口
- [ ] 添加白名单条目（用户名或 UUID）
- [ ] 移除封禁条目
- [ ] 管理员列表变更（添加/移除管理员）
- [ ] 前端列表编辑页面（增删改查 + JSON 校验）

## 自动重启与崩溃恢复
- [ ] 进程异常退出时自动重启触发（区分异常退出 vs 正常退出 vs 手动停止）
- [ ] 可配置最大重试次数（`MAX_RESTART_ATTEMPTS` 环境变量）
- [ ] 指数退避策略（首次 1s，之后翻倍，最大 60s）
- [ ] 手动停止不触发自动重启
- [ ] 正常退出（exit code 0）不触发自动重启
- [ ] 前端显示自动重启状态与倒计时

## 资源监控
- [ ] 进程 CPU 使用率采集（`pidusage` 或 `/proc` 读取）
- [ ] 进程内存使用率采集
- [ ] UPS（Updates Per Second）解析（从日志中提取性能统计）
- [ ] 服务端未运行时返回空指标（不报错）
- [ ] 前端图表展示（折线图/仪表盘，实时刷新）

## 备份与回滚
- [ ] 手动创建完整快照（存档 + 配置 + Mod 打包为 zip）
- [ ] 快照列表（名称、大小、创建时间）
- [ ] 从快照恢复（解包覆盖，需停止服务端）
- [ ] 删除快照
- [ ] 前端快照管理页面（列表 + 创建 + 恢复 + 删除）

## Mod 依赖校验
- [ ] 解析 Mod 的 `info.json` 获取依赖信息
- [ ] 上传时校验依赖（缺失依赖给出提示）
- [ ] 启动前校验依赖（缺失依赖阻止启动或给出警告）
- [ ] 版本兼容性检测（依赖版本与已安装版本比对）
- [ ] 前端在 Mod 列表中显示依赖状态

## 通知告警
- [ ] Webhook URL 配置（Discord/Slack 格式）
- [ ] 服务端崩溃告警（含退出码、最近日志）
- [ ] 磁盘空间不足告警（含剩余空间、最大目录）
- [ ] 下载失败告警（含版本、错误信息）
- [ ] 前端 Webhook 配置页面

## 多实例管理
- [ ] 创建实例（名称、版本、端口、存档，分配独立目录 `data/instances/{id}/`）
- [ ] 实例元信息持久化到 `instances.json`
- [ ] 实例列表展示（名称、状态、端口、版本）
- [ ] 独立生命周期（启动/停止某实例不影响其他实例）
- [ ] 每个实例独立的日志流与状态
- [ ] 端口冲突检测（游戏端口已被占用时返回 HTTP 409）
- [ ] 前端实例管理页面（列表 + 创建 + 启停 + 删除）