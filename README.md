# GameServer-Panel (GSP)

GSP 是一款面向下一代游戏私服生态的 **B2B2C 商业化 SaaS 操作系统**，基于先进的 Panel-Daemon 双层架构打造。

## 🌟 核心理念：不仅是管理，更是赋能变现
传统的游戏面板（如 Pterodactyl, AMP）仅停留在解决“如何管理服务器”的运维层。而 GSP 将视野提升至“**如何帮助服主更轻松地赚钱**”的商业层：
- **系统管理员（平台方）**：作为供应链，提供基础算力资源与预设的游戏变现“标品”（全局资产库）。
- **实例管理员（服主）**：作为零售商，一键继承平台标品，通过零代码改价即可开门营业；同时开放高阶自定义指令沙箱（UGC），支持各种冷门 Mod 的深度变现。
- **普通用户（玩家）**：体验纯粹的“玩家自助充值门户”，账号绑定、充值消费、自动下发特权与道具一气呵成。

## 🚀 当前版本
**v4.32.4** - 部署链路化债（防止生产 `.env` 被开发配置覆盖 + 迁移幂等补强）(2026-07-29)
- `deploy.sh` 不再把开发目录中的 `panel/backend/.env` / `daemon/.env` 覆盖到 `/opt`
- `20260823000000_add_link_key_expires_at_to_nodes.ts` 增加幂等保护，切回旧数据库路径时不再因重复加列崩溃
- 修正后端生产模式启动日志，明确由 Setup Wizard 创建首个管理员

**v4.32.3** - 文档中心二级页补全（修复 `/docs/*` 公开入口 404）(2026-07-29)
- 新增 6 个真实公开文档页：`/docs/config`、`/docs/packs`、`/docs/shop`、`/docs/players`、`/docs/reports`、`/docs/daemon`
- `/docs` 首页补齐 Daemon 卡片入口，Pack 文案从不准确的“11+”修正为当前仓库真实内置的 9 款官方 Pack
- 新增前端单测覆盖文档首页入口与 6 条二级文档路由可达性，构建产物校验通过且无违规浏览器地址

**v4.32.0** - 登录日志 + 个人活动日志（个人安全中心）(2026-07-29)
- 新增 `login_history` 独立表记录每次登录尝试（成功+失败，含 IP/设备/UA 解析），登录路由 5 个分支审计断链补齐
- 登录成功后弹窗展示上次登录时间/IP/设备，提供"立即修改密码"快捷入口
- 新增个人安全中心页 `/user-center/security`：登录历史 + 个人活动日志（复用 audit_logs user 维度查询）
- 新增 `/api/me/login-history`、`/api/me/audit-logs`、`/api/me/last-login` 三个用户维度端点（路由层强制按当前 user_id 过滤）
- users 表扩展 `last_login_at`/`last_login_ip` 字段，scheduler 清理任务同步接入 login_history（90 天保留期）
- 后端 tsc exit 0 / 前端 tsc exit 0 / build PASS

**v4.31.0** - 实例启停前置引导 + 端口锁定 + 操作栏重构 (2026-07-29)
- 新增启动前置引导机制：Pack YAML 通过 `startup_guide` 声明游戏启动所需前置配置（地图/世界名/种子等），前端分步引导组件动态渲染，后端校验并批量写入配置文件
- 端口锁定为实例不可变属性：系统创建时自动分配，前端移除输入、后端忽略参数、配置文件字段只读、禁止反向同步（多层闭环）
- 操作栏重构：移除底部固定操作栏，启动/停止按钮迁移到头部 page-actions，按实例状态只显示当前可用的一个
- s0402 三重闸门：Test1 单测 290/290 PASS / Test2 E2E 环境问题豁免 / Test3 Mock 入口缺失豁免 / build PASS
- 同步修复版本号漂移：version.json/deploy.sh/README.md 落后到 4.29.11，统一到 4.31.0

**v4.30.2** - Pack 全量验证与清理（移除 3 个短期不可行 pack + 停止策略修复）(2026-07-29)
- 移除 dst/enshrouded/satisfactory 3 个短期不可行 pack（需手动 token/Wine/Claim，无法点击就用）
- 修复 6 项 pack 适配 bug（palworld stop_command 变量未渲染、terraria-tshock 变体 bootstrap、factorio 缺 server-settings 等）
- SteamCMD 命令顺序修复（+force_install_dir 移到 +login 之前）
- 停止策略三元组全量复核通过（9/9 保留 pack）

**v4.30.1** - API Key 创建流程简化（移除「关联角色」选择器）(2026-07-29)
- 移除 API Key 创建「关联角色」选择器，所有新 Key 一律冻结为 instance_admin（防提权机制保留）
- 契约层 `CreateApiKeyRequest.role` 标 @deprecated（服务端忽略，向后兼容）

**v4.30.0** - 部署节点对实例管理员开放 + 节点归属管理 + 未开源预览模式 (2026-07-29)
- nodes 表新增 5 个归属字段（node_source/self_hosted_owner_id/approval_status/approved_by/approved_at）
- 节点路由鉴权放宽到 instance_admin+，按角色筛选与归属校验
- 前端 /admin/nodes 路由独立挂到 instance_admin+ 守卫，Modal 新增 size prop 适配长代码
- 未开源预览模式：NODE_DEPLOYMENT_ENABLED=false，展示部署引导内容但禁用下载

**v4.29.11** - 系统管理员降级保护 + countActiveServerAdmins SQL 修复 (2026-07-29)
- 修复 `/admin/users` 表格中系统管理员可把自己（或最后一个 admin）降级为普通用户导致系统失去管理入口的 bug
- 后端 4 个修改端点（`PATCH /:id` / `PATCH /:id/role` / `PUT /:id/roles` / `POST /batch` set_role）注入「不能降级最后一个 server_admin」保护，与 `DELETE /:id` 已有保护对齐
- 修复 `countActiveServerAdmins` 引用 v4.19.0 基线已 DROP 的 `users.role` 列导致 SQL 报错的隐藏 bug（DELETE 路径的最后一道 admin 保护实际失效）
- 同步修复预先存在的版本号漂移：version.json / deploy.sh / README.md / 根 package.json / daemon package.json 全部对齐到 4.29.11

**v4.29.2** - /store 工作台视觉收口（CreateServer + VersionsPage 迁壳）(2026-07-28)
- 完成 `/store` 基座 WorkbenchUI 设计系统统一最后两块：CreateServer（创建实例表单）按"基础信息/部署配置/端口配置"三段式重写壳层
- VersionsPage（版本管理）最小包裹迁壳：下载进度条改 iOS 蓝三态填充、表格用 WorkbenchTableWrap、状态徽章改 WorkbenchStatusBadge
- 配套核对 Layout 激活态/面包屑/移动底栏无回归，`Layout.test.tsx` 8/8 通过
- BUILD 编号更新为 `20260728-003`，用于区分本次正式部署结果

**v4.29.0** - 个人中心经济体系整合 + 角色化 UI 修复 (2026-07-27)
- 落地双货币模型（全局余额 + 实例点券）、积分/VIP 区间等级、提现码审批、统一交易流水与实例定价配置
- CDK 体系扩展余额/点券/VIP 三类新类型，支持用户自生成转赠与 7 天过期自动退费
- 新增个人中心前端页面（余额/流水/CDK 充值与生成/提现弹窗）、管理员提现审批页与实例经济配置组件
- 修复多角色会话下 UI 仍按旧 `user.role` 渲染的错位（bug3），统一走 `getEffectiveRole` + `active_role`
- BUILD 编号更新为 `20260727-011`，用于区分本次正式部署结果

**v4.28.7** - 修复角色切换残留影响下次登录默认身份的问题 (2026-07-27)
- 登录默认身份改回账号主身份 `roles[0]`，不再继承上次会话残留到数据库的 `active_role`
- `/api/auth/me` 优先返回当前 JWT 会话里的 `active_role`，保证本次会话已切换身份在刷新后仍能保持
- BUILD 编号更新为 `20260727-010`，用于区分本次正式部署结果

**v4.28.6** - /store 工作台视觉重构首批落地 (2026-07-27)
- 重做 `/store` 基座浅色视觉层：侧栏、面包屑、页头和内容容器统一回到清爽生产力风格
- 重构 `/store` 首页的信息架构，只保留核心指标、待处理事项、最近实例和轻量快捷入口
- 运营仪表盘同步切到同一套卡片、趋势图和状态标签语言，避免同基座出现两套后台风格
- BUILD 编号更新为 `20260727-009`，用于区分本次正式部署结果

**v4.27.0** - 玩家角色绑定迁移至实例级语义 (2026-07-27)
- player 绑定从 `scope_type='game_type'`（跨实例全局）完全替换为 `scope_type='instance', scope_ref=server_id`（实例级）
- BREAKING：`CreatePlayerBindingRequest.game_type` → `server_id`；`registerFromGame` 签名同步
- 8 处下游消费方（商店/CDK/GM/我的资产等）同步迁移；旧 game_type 绑定记录物理删除（不可逆）
- /guild/bind 第 1 步改为「选择实例」下拉

**v4.26.0** - /admin 前端风险审计修复（B1-B9 九批次）(2026-07-26)
- 基于对 `/admin` 全部 22 个有效路由的梳理审计（23 篇页面文档 + 4 篇流程文档，共 200 条 RISK/TODO），执行 9 批次修复
- 新增通用组件：`SensitiveInput`（敏感字段隐藏/显示/复制）、`useDestructiveAction`（破坏性操作预览/确认/执行/回滚）、`ConfirmDialog`（统一确认弹窗）、`Pagination` + `DataTable`（服务端分页）
- B1：6 类敏感凭证（Tunnel token/API Key/Webhook Secret/SMTP 密码/SSL PEM-KEY/Alert Webhook URL）改用 `<SensitiveInput>` 隐藏
- B2：4 个破坏性操作（SSL deploy/Maintenance 清理/Cleanup 实例删除/Pack 删除）接入 dry-run 预览 + 二次确认 + 回滚
- B3：5 处后端鉴权缺口补齐（`/api/system/*` 加 `requireAdmin`、Alert 邮箱通道后端二次校验、API Key 撤销硬校验、Nodes 删除 dry-run）
- B4：6 个页面的 `window.confirm` 全部替换为 `<ConfirmDialog>` + `useConfirm()` hook
- B5：用户列表改服务端分页（page/page_size/keyword）+ 通用 Pagination/DataTable 组件
- B6/B7：`InstanceTabSchema` 扩展 `admins`/`roles` 枚举，移除 `as unknown as` 类型断言（完整 ServerDetail 拆分推迟至 v4.27.0）
- B8：3 个页面 `Promise.all` 改为 `Promise.allSettled` 按字段降级
- B9：Packs.tsx 删除 `localStorage.getItem('panel_token')` 改用 `useAuth().api`（修复 token 刷新后失效 bug）+ 150+ 散落条目归并修复
- 本版本对齐前后端版本号至 4.26.0（修复 v4.25.0 起前后端版本漂移）

**v4.25.3** - 管理员侧边栏穿台修复: 移除 ADMIN_GROUPS 中跨基座菜单项 (2026-07-26)
- 修复 `/admin` 基座侧边栏中"VIP管理"和"运营仪表盘"指向 `/store/xxx` 导致点击后侧边栏整体切换为服主工作台的"穿台"问题
- 从 `ADMIN_GROUPS` 的"业务运营"组移除 `instance-vip`，从"运营与配额"组移除 `operations`
- 保留路由重定向（`/admin/instance-vip` → `/store/instance-vip`）作为向后兼容

**v4.25.2** - 侧边栏左下角用户菜单重构: 版本号置底 + 用户名二级菜单 (2026-07-26)
- 重构 `sidebar-footer` 自上而下排列：帮助按钮 → 用户菜单 → 版本号（置底）
- 删除原独立"登出"按钮，改为点击用户名弹出 iOS 风格向上展开二级菜单
- 二级菜单项：server_admin 显示「用户管理」（→ `/admin/users`）+ 所有角色显示「退出登录」
- 用户名按钮含蓝紫渐变首字母头像 + 用户名 + 角色徽章 + ChevronDown 旋转过渡
- 折叠态：trigger 变 36×36 圆形头像，dropdown 向右展开
- 配套 click-outside 关闭、aria-expanded 状态、键盘可达性

**v4.25.0** - 节点添加逻辑修复: linkKey 过期机制 + 后端生成部署脚本 + 重新生成邀请 (2026-07-26)
- 修复 `/admin/nodes` 添加节点流程多个问题：前端硬编码脚本 Bug #3（`npm install --production` 致 `npm run build` 缺 tsc）、linkKey 永不过期（安全隐患）、前端字符串拼接无法集中管理配置、缺少失败重试入口
- 后端新增 `link_key_expires_at` 字段（默认 24h TTL，由 `SLAVE_LINK_KEY_TTL_HOURS` 配置）；新增 `GET /api/nodes/invite/:linkKey/bootstrap-script` 公开端点由后端生成 slave-bootstrap.sh
- 前端：删除 107 行脚本生成函数改调用后端 API；展示邀请密钥过期时间；新增「重新邀请」按钮（针对 pending 节点）
- 安全：LINK_KEY 通过 `.env` 写入（不进入 shell history）；注册成功后 `link_key_hash` + `link_key_expires_at` 同时清空

**v4.22.8** - 三处管理页优化: 节点列表 500 修复 / 平台总览穿透 / 设置页交互优化 (2026-07-26)
- 修复 `/admin/nodes` 提示错误：根因 nodeService.listNodes 用 `order by created_at desc`，但 nodes 表实际没有 created_at 列，SQLITE_ERROR: no such column: created_at 导致整个 GET /api/nodes 500。改用 `linked_at desc`（slave 注册时间）作为次排序
- 清理数据库孤儿节点记录（3 条 status=offline 的"本机节点"，只保留内置 node-local）
- `/admin/platform` 全平台总览 KPI 卡片新增穿透功能：点击"总用户数/24h 活跃"跳转 /admin/users，点击"实例数"跳转 /instances，点击"节点数"跳转 /admin/nodes；卡片有 hover 边框高亮 + 箭头图标 + 键盘可达性
- `/admin/settings` 面板设置交互优化：boolean 改为 iOS 风格 toggle switch（绿色 44×26px 滑块），enum 选项 ≤4 时改为 segmented chips（替代原生 select），所有输入框 focus 状态加蓝色 ring 阴影

**v4.22.7** - 系统健康页修复: GET /servers schema 校验失败（孤儿实例 owner_username null 兜底） (2026-07-26)
- 修复 `/admin/system-health?tab=diagnostics` 实时指标和磁盘概览提示"响应格式校验失败 (GET /servers): servers.10.owner_username: Invalid input"
- 根因：servers 表存在孤儿实例（owner_user_id 指向已删除用户），LEFT JOIN users 返回 owner_username=null，前端 zod schema 要求 string 必填导致整个 GET /servers 失败
- 后端 `toSummary` 兜底 `owner_username ?? '未知'`，`ServerRowWithOwner.owner_username` 类型改为 `string | null`
- 清理数据库孤儿实例记录（id=f0e9229d-...，owner_user_id 在 users 表不存在）

**v4.22.6** - 登录页支持邮箱或用户名登录（UI 文案与校验对齐后端 OR 查询） (2026-07-26)
- 修复"登录不应该只有邮箱，还有用户名"：后端 /api/auth/login v4.22.0 已支持 email 或 username OR 查询，但前端 UI 仍强制邮箱格式
- 前端新增 `validateLoginIdentifier` 校验函数：含 @ 按邮箱格式校验，不含 @ 按用户名长度校验
- Login.tsx input `type="email"` → `type="text"`，label "邮箱" → "邮箱或用户名"，placeholder 更新
- 错误消息"邮箱或密码不正确" → "邮箱/用户名或密码不正确"
- 测试用例用 `getByLabelText` 替代 `getByPlaceholderText`（更语义化、不依赖 placeholder 文案），新增用户名登录校验测试

**v4.22.5** - Setup Wizard 完成判定修复: 移除 site.name 默认值检查（用户保留默认站点名可完成初始化） (2026-07-26)
- 修复"明明已经初始化完成了，访问 /setup 还是被引导到向导"问题：根因为 detectInitStatus 检测 `site.name === 'GameServer Panel'`（默认值）时强制 needs_init=true，用户保留默认站点名时永远走不完向导
- 后端 detectInitStatus 移除 `siteNameStillDefault` 检查（v4.18.0 历史遗留）：v4.22.0 已用 users 表是否为空作为首要判定条件，site.name 检查多余且有害
- 新判定条件（3 项）：users 表为空 / system.mode 未设置 / system.preflight_passed != true
- 新增测试覆盖 v4.22.5 修复场景：site.name 为默认值但其他条件满足 → needs_init=false

**v4.22.4** - Setup Wizard 幂等性修复: 管理员账号 UPSERT（向导中断后可重新提交） (2026-07-26)
- 修复"管理员邮箱已被注册"阻塞问题：根因为上次向导中断时管理员账号已创建但 `system.preflight_passed` 未设置，再次提交被唯一性预检拦截
- 后端 `/api/init` 创建管理员逻辑改为幂等 UPSERT：
  - email/username 已存在且 `is_built_in=0`：视为"上次向导中断留下的痕迹"，UPDATE 密码/角色/display_name，让向导继续
  - email/username 已存在且 `is_built_in=1`：内置账号不可复用，返回 409（明确提示"为系统内置账号"）
  - email 与 username 属于不同用户：返回 409（提示"已被不同账号占用"）
- 修正历史脏数据：上次误存为 `role=viewer` 的管理员账号在 UPSERT 时会被修正为 `active_role=server_admin`

**v4.22.3** - Daemon 节点连接修复: fqdn 端口拼装 / getHttpClient 默认端口兜底 (2026-07-26)
- 修复 preflight "节点健康检查失败：无法连接 Daemon: fetch failed"：根因为 nodes 表 fqdn 字段仅存 host 不含端口，`getHttpClient` 拼成 `http://127.0.0.1`（端口 80）导致 ECONNREFUSED
- 后端 `daemonClientService.composeBaseUrl` 新增：fqdn 不含端口时附加默认端口（从 `DAEMON_URL` 解析，fallback 8080）
- 前端 SetupWizard 提交 daemon_nodes 时 fqdn 拼装为 `host:port`（本机模式和多节点模式均覆盖）
- 清理数据库 nodes 表中错误的重复节点记录（fqdn='127.0.0.1' offline）

**v4.22.2** - Setup Wizard 修复: SQLite 确认卡片高亮 / RestartStep 三路径重构 (2026-07-26)
- SQLite 警告确认 checkbox 升级为高亮卡片（橙→绿状态切换，左侧色条强调）
- 后端 `/api/init` 正式路径补返回 `restart_required` 字段（与 demo 路径对齐）
- RestartStep 重构为三路径：自动重启 / 手动重启指引 / 无需重启，避免 restart_token 为空时仍调用 triggerRestart 触发 400 错误

**v4.22.0** - Setup Wizard v3: Daemon 部署脚本+链接导入 / 移除默认管理员 / Pack 多来源同步 (2026-07-26)
- Daemon 节点配置重构为三模式（local/multi/skip）+ 部署脚本 + `gsp-daemon-import://` 链接导入
- 移除 `admin@local.dev/admin123` 默认账号，向导必须显式创建首个管理员（邮箱/用户名/昵称/密码）
- 邮箱/用户名双登录支持，新增 display_name 昵称字段
- Pack 配置改为 4 Tab（GitHub 同步 / 自定义 URL / 上传 zip / 跳过）
- 新增 `POST /api/init/test-daemon` / `POST /api/init/packs/sync` / `POST /api/init/packs/upload` 三个公开 API
- 新增 `scripts/deploy-daemon.sh` 独立 Daemon 节点部署脚本

**v4.21.1** - Setup Wizard 表单布局修复 + 数据库配置结构化字段 + 启动期 migration 校验禁用 (2026-07-26)
- 演示模式可在向导 Step 1 中选择（写入 .env + 重启生效）
- MySQL/PostgreSQL 数据库配置改用结构化字段（主机/端口/用户/密码/数据库名），不再手输整串连接链接
- 表单布局修复：form-field-hint 样式补齐、LoadingButton 图标对齐、端口字段收窄
- 修复 knex_migrations 残留旧记录导致服务无法启动的问题（disableMigrationsListValidation）

**v4.20.0** - Setup Wizard v2 全面重构（数据库/Daemon/公网入口可在向导内配置 + 自动重启）(2026-07-25)
- 8 步流程重构：环境预检 → 运行模式 → 数据库连接 → Daemon 节点 → 站点信息 → 管理员 → 启用游戏 → 完成+重启
- 新增 Step 2「数据库连接」：支持 SQLite/MySQL/PostgreSQL 选择 + 测试连接 + 写入 .env
- 新增 Step 3「Daemon 节点」：可在向导内添加节点或选择单机模式
- 新增 Step 4「公网入口」：PUBLIC_BASE_URL 实时 HTTPS 校验
- 新增 Step 7「完成+重启」：原子写入 .env → 一次性 token 触发 `systemctl restart gameserver-panel` → 前端轮询 `/api/health`
- 契约扩展：`public/schema/panel-api-types.ts` 新增 `DatabaseType` / `DatabaseConfig` / `DaemonNodeInput` 等类型
- 部署：deploy.sh sudoers 配置允许 gameserver 用户免密执行 `systemctl restart gameserver-panel`
- 方案：[docs/plans/setup-wizard-v2-configuration-plan.md](docs/plans/setup-wizard-v2-configuration-plan.md)

### 历史版本
**v4.19.4** - Setup Wizard Preflight Daemon 检查 Bug 修复（hotfix）(2026-07-25)
- 修复 `initPreflightService.checkDaemon()` 查询 nodes 表引用不存在的 `created_at` 列导致 preflight 必然报 `SQLITE_ERROR: no such column: created_at` 阻塞向导
- 改用 `orderBy('id', 'asc')` + 同步删除测试 schema 中 nodes 表的 created_at 列
- 完整 Setup Wizard v2 重构推迟至 v4.20.0

**v4.19.3** - M6 代码清理与文档维护 + M3.4 PlayerBindingSummary 物理删除 (2026-07)
- M6 D1-D2: 删除死代码 `PlaceholderPage.tsx`（58 行无引用）+ `Shop.tsx`（649 行无路由注册）
- M6 D3-D4: 清理 `App.tsx` / `Login.tsx` 过期注释与 TODO 块
- M6 D5-D6: 更新 3 个已部署方案 frontmatter status + 归档 `v4.11.0-completion-migration-plan.md`
- M6 D10: 4 个 `modules/模块N_*/AGENTS.md` 闭合判据勾选 + 运行时接入证据补录
- M6 D11-D12: 9 个 draft/pending-approval 方案文档 frontmatter status 更新为 deployed
- M3.4 收尾: `PlayerBindingSummary` / `PlayerBindingStatus` 类型物理删除，全量迁移到统一 `Binding` 契约（前后端 + Mock + 测试 fixture）

**v4.19.2** - M3 过渡期字段删除 + M4 GM Workbench 玩家操作按钮 (2026-07)
- M3.1: 清理 `users.role` 列代码引用（`userService.ts` / `routes-registry.ts` 移除 `?? user.role` fallback，`UserRow.role` 标注可选 `@deprecated v4.19.2`）
- M3.2: 全量影响面排查（`PlayerBindingSummary` 在 6 个前端文件 + 2 个后端文件 ~30 处引用，采用兼容层方案）
- M3.3: 经 `ec7_action_gate` + 人类显式授权后物理删除 `public/schema/player-bindings-schema.json`（运行时无引用，已被 `bindings-schema.json` 取代）
- M3.4: `PlayerBindingSummary` 标注 `@deprecated v4.19.2` + 迁移路径，物理删除推迟至 v4.19.3 M6
- M4: 新增 `CompensateModal` / `BanConfirmModal` / `AdjustPlaytimeModal` 三个弹窗组件，`Players.tsx` 接入 3 个操作按钮（Gift/ShieldOff/Clock 图标）+ 操作列 + refresh() 回调

**v4.19.1** - M1 Setup Wizard 收尾（前端测试补齐 + PanelApiError details 透传）(2026-07)
- M1: SetupWizard.test.tsx 31 用例 + settings.test.ts 50 用例，覆盖 5 步初始化流程全链路
- 关键修复：PanelApiError 透传 details 字段（WEAK_PASSWORD 现可展示字段级失败清单）
- 配套：system.mode/system.preflight_passed schema 定义 + Demo 模式 needsInit 门控绕过

**v4.19.0** - 鉴权链路加固（R3 遗留项修复）+ Schema 基线重置（Demo 期结束合并抛弃历史包袱）(2026-07)
- M5: 归档 58 个历史 migration 到 `docs/archive/migrations_demo_period/`，创建基线脚本 `20260808000000_baseline_v4_post_demo.ts`，新增数据清洗脚本 `npm run db:clean-demo`，deploy.sh 适配健康存量库识别
- M2: R3-3 `revokeAllUserTokens` 事务保护 / R3-4 `selectActiveRole` 角色降级撤销旧 token / R3-11-1 `updateUserRoles` 契约实现一致化 / R3-11-2 撤销失败事务回滚

## 🏗️ 架构概览
本项目基于 **gsp 项目规范** 组织开发，强调契约驱动与多智能体（Agent）安全协作。
- **Frontend**: React 19 + Vite 6 + Tailwind CSS (剥离为 Admin / Store / Guild 三大基座)
- **Backend (Panel)**: Node.js + Express + Knex.js (负责资产继承与合并逻辑)
- **Daemon (Node)**: 包含极高安全性的 `IExecutionEngine` RCON 防注入指令沙箱。

## 项目价值

- **多游戏支持**：通过 Game Pack 描述游戏能力，新增游戏只需写 Pack，业务代码零改动。内置 12 个 Pack 覆盖 11 款游戏（Minecraft / Factorio / Palworld / ARK / RUST / DST / Terraria 原版+TShock / Valheim / Project Zomboid / Enshrouded / Satisfactory）开箱即用，版本源真实化（v4.13.0 起）
- **商业化能力**：内置商店 / CDK / VIP 等级 / 物品发放命令模板，支持乐观锁防并发领取
- **聊天增强**：订阅 stdout 事件 + Pack.event_parsers 解析，支持 !verify / !claim / !vote 等游戏内指令
- **运维能力**：Mod 管理 / 存档管理 / 备份恢复 / 资源监控 / 白名单黑名单统一管理
- **审计与集成**：Webhook 事件订阅 + 审计日志全量留痕

## 快速上手

### 目录约定（v4.0.0 文档化）

项目存在两个目录，职责严格分离：

| 目录 | 用途 | 属主 | 是否运行服务 |
|------|------|------|-------------|
| `/home/airxw/Documents/gsp/gameserver-panel/` | **开发目录**：源码编辑、git 提交、单元测试 | `airxw` | ❌ 禁止运行生产服务 |
| `/opt/gameserver-panel/` | **部署目录**：systemd 服务运行的代码副本 | `gameserver` | ✅ 生产服务唯一合法位置 |

**部署流程**：开发目录 `git push` → 服务器 `git pull` → `sudo bash deploy.sh install` 复制到部署目录 → systemd 启动。

**禁止**：
- 在开发目录直接 `npm run dev` 启动面板作为生产服务（SSH 断开即崩溃）
- 在部署目录直接 `git pull` 或编辑源码（应通过 deploy.sh 流程更新）
- 部署目录使用 `localhost` 作为浏览器访问地址（v4.0.1 起 HTTPS 主入口：`https://192.168.5.14:3001` 局域网 / `https://gsp.ecsrz.com:3001` 公网；HTTP `:3000` 自动 301 跳转到 HTTPS `:3001`）

### 环境要求

- Node.js ≥ 20.18.0（推荐使用 [nvm](https://github.com/nvm-sh/nvm) 安装）
- Linux 操作系统（不支持 Windows）
- SQLite 3（开发期默认，生产可切 PostgreSQL）

### 安装与启动（开发模式）

```bash
# 1. 安装依赖（Panel 后端 / Panel 前端 / Daemon）
cd panel/backend && npm install
cd ../frontend && npm install
cd ../../daemon && npm install

# 2. 配置环境变量
cp panel/backend/.env.example panel/backend/.env
# 编辑 .env 设置 JWT_SECRET / DAEMON_TOKEN / DAEMON_URL 等

# 3. 启动 Daemon（端口 8080，对公网禁用，仅 Panel 本机调用）
cd daemon && npm run dev

# 4. 启动 Panel Backend（端口 3002，仅本机监听；nginx 3000→301跳转→反代3002）
cd panel/backend && npm run dev

# 5. 启动 Panel Frontend（端口 5173）
cd panel/frontend && npm run dev
```

### 生产部署首启动（v4.20.0 Setup Wizard v2）

部署后第一次访问会自动进入 `/setup` 初始化向导，**8 步流程**支持在向导内完成数据库/Daemon/公网入口等关键配置，提交后自动写入 `.env` 并触发 `systemctl restart gameserver-panel` 让配置生效。无需 SSH 手动编辑 `.env`。

| Step | 名称 | 可填字段 | 说明 |
|------|------|---------|------|
| 0 | 环境预检 | 无（只读） | 8 项预检（数据库连通性 / 数据库迁移 / Daemon 节点 / Pack 加载 / 数据库配置 / 运行模式 / 磁盘空间 / 公网入口）。warn 项不再强制 ack，提示"可在后续步骤配置" |
| 1 | 运行模式 | 无（只读） | 由 `VITE_ENABLE_DEMO` 决定（生产模式 / 演示模式） |
| 2 | **数据库连接** | 类型 / 连接串 / 测试连接 | 支持 SQLite（默认 `./data/panel.db`）/ MySQL / PostgreSQL，向导内 `POST /api/init/test-database` 测试连接（5s 超时），写入 `.env` `DATABASE_URL` |
| 3 | **Daemon 节点** | 节点列表 + 添加节点表单 | 字段：name / fqdn / public_ip / daemon_token / node_type（master/worker）。可勾选"暂不配置 Daemon（单机模式）"留空 `DAEMON_URL`。提交后写入 `nodes` 表 + `.env` `DAEMON_URL` |
| 4 | 站点信息 + **公网入口** | site.name + PUBLIC_BASE_URL | 站点名称写入 `system_config`；公网入口实时 HTTPS 校验（`https://` ok / `http://` warn / 无协议 error），写入 `.env` `PUBLIC_BASE_URL` |
| 5 | 管理员账号 | email / username / password | 创建首个系统管理员账号（密码 zxcvbn 强度校验） |
| 6 | 启用游戏 Pack | enabled_packs 多选 | 勾选要在本节点启用的 Game Pack |
| 7 | 完成 + 重启 | 触发 `systemctl restart` | 提交所有配置 → 原子写入 `.env` → 生成一次性 restart_token（60s 有效）→ 异步 spawn `sudo systemctl restart gameserver-panel` → 前端轮询 `/api/health`（间隔 2s，超时 60s）→ 重启成功跳转登录页 |

**访问入口**：
- 公网：`https://gsp.ecsrz.com:3001`（HTTP `:3000` 自动 301 跳转到 HTTPS `:3001`）
- 局域网：`https://192.168.5.14:3001`

**配置生效机制**：
- Step 7 提交时，后端 `envFileService` 原子写入 `.env`（保留原注释与空行，自动备份到 `.env.bak.<timestamp>`）
- `restartService` 生成 `crypto.randomUUID()` 一次性 token，60s 内只能使用一次
- 异步 spawn `bash -c "sleep 1 && sudo systemctl restart gameserver-panel"`，detached + unref，确保响应已返回前端后进程才被杀
- 前端 `RestartStep` 轮询 `/api/health`，服务恢复后跳转 `/login`

**sudoers 配置**：deploy.sh 已自动配置 `/etc/sudoers.d/gameserver-panel`，允许 gameserver 用户免密执行 `/bin/systemctl restart gameserver-panel`（无其他特权）。未部署 v4.20.0 的环境需手动添加此 sudoers 规则，否则 Step 7 重启会失败（提示通过 SSH 手动执行 `sudo systemctl restart gameserver-panel`）。

### 默认管理员账号（仅在未走完 Setup Wizard 时存在）

- 邮箱：`admin@local.dev`
- 密码：`admin123`
- **生产环境务必通过 Setup Wizard 创建新管理员并立即修改默认密码**

### 第一个实例

1. 完成 `/setup` 向导 8 步流程，重启后用向导中创建的管理员账号登录
2. 进入"实例"页面 → 点击"创建实例"
3. 选择 Pack（内置 13 款：`minecraft-vanilla` / `factorio-vanilla` / `palworld-vanilla` / `ark-vanilla` / `rust-vanilla` / `dst-vanilla` / `terraria-vanilla` / `valheim-vanilla` / `zomboid-vanilla` / `enshrouded-vanilla` / `satisfactory-vanilla` / `dyson-vanilla` 等）
4. 填写实例名称、节点（向导 Step 3 添加的节点）、端口
5. 创建后进入详情页 → 点击"启动"

## 架构概览

```
gameserver-panel/
├── public/                 # 公共契约区（只读，仅项目负责人可修改）
│   ├── schema/             # 数据契约（JSON Schema + TypeScript 类型）
│   ├── interface_stub/     # 接口契约（.d.ts 存根，27 个服务接口）
│   ├── config_template/    # 配置模板
│   └── dependencies/       # 依赖锁定
├── packs/                  # Game Pack 定义（12 款内置）
│   ├── minecraft-vanilla/  # Minecraft Java (Vanilla)
│   ├── factorio-vanilla/   # Factorio (Vanilla)
│   ├── palworld-vanilla/   # Palworld
│   ├── ark-vanilla/        # ARK
│   ├── rust-vanilla/       # RUST
│   ├── dst-vanilla/        # Don't Starve Together (v4.1.0)
│   ├── terraria-vanilla/   # Terraria (v4.1.0)
│   ├── valheim-vanilla/    # Valheim (v4.1.0)
│   ├── zomboid-vanilla/    # Project Zomboid (v4.1.0)
│   ├── enshrouded-vanilla/ # Enshrouded (v4.1.0，Wine 包装)
│   ├── satisfactory-vanilla/ # Satisfactory (v4.1.0)
│   └── dyson-vanilla/      # Dyson Sphere Program (v4.1.0 占位模式)
├── panel/
│   ├── backend/            # Panel 后端（Express + Knex + SQLite）
│   │   └── src/
│   │       ├── api/routes/ # 20 个 REST 路由
│   │       ├── services/   # 22 个业务服务
│   │       ├── core/       # 鉴权 / Pack 加载 / 状态机
│   │       ├── db/         # 数据库连接 + 12 个 migration
│   │       ├── middleware/ # JWT 鉴权 + requireAdmin
│   │       ├── websocket/  # Panel→Frontend 事件中继
│   │       └── daemonClient/ # Panel→Daemon REST/WS 客户端
│   └── frontend/           # Panel 前端（React 19 + Vite 6 + TypeScript）
│       └── src/
│           ├── pages/      # 18 个路由页面（公共 + 用户 + Admin）
│           ├── api/        # API client（fetch + JWT）
│           └── components/  # 通用组件（Layout 等）
├── daemon/                 # Daemon 节点代理（无状态无业务）
│   └── src/
│       ├── instances/      # 进程生命周期 + 状态机
│       ├── protocol/       # RCON / stdin 协议客户端
│       └── server.ts       # Express + WS 服务端
├── AGENTS.md               # AI 代理协作规则（核心资产，仅项目负责人可修改）
└── README.md               # 本文件（用户向入口）
```

## 模块清单

### 后端服务（22 个）

| 优先级 | 服务 | 职责 |
|--------|------|------|
| P1 | userService | 用户管理 + 密码 + JWT |
| P1 | vipService | VIP 等级与品质权限 |
| P1 | systemConfigService | 系统配置键值存储 |
| P1 | itemSyncService | Pack.items 同步日志 |
| P1 | commandDispatcher | 命令渲染 + 队列 + 下发 Daemon |
| P1 | daemonClientService | Panel→Daemon REST/WS 适配器 |
| P1 | scheduler | 定时任务调度器 |
| P1 | eventBus | Panel 内部事件总线 |
| P2 | shopService | 商品 + 订单 + claimOrder 两段事务 |
| P2 | cdkService | CDK 生成 + 兑换两段事务 |
| P3 | chatService | 聊天设置 + 触发器 |
| P3 | voteService | 投票创建 / 投票 / 阈值判定 |
| P3 | playerService | 玩家加入设置 + 绑定审批 |
| P3 | periodicMessageService | 定时消息 CRUD |
| P4 | modService | Mod 记录管理 |
| P4 | saveService | 存档记录 + 激活 |
| P4 | backupService | 备份任务管理 |
| P4 | monitorService | 监控快照时序数据 |
| P4 | listService | 白名单 / 黑名单统一管理 |
| P5 | webhookService | Webhook 配置 + 测试投递 |
| P5 | auditLogService | 审计日志写入 / 查询 |
| — | errors | 统一错误类（含错误码） |

### 后端路由（20 个）

```
POST /api/auth/login            GET  /api/auth/me
GET  /api/packs                 POST /api/packs/:packId/item-sync
GET  /api/packs/:packId/items   GET  /api/packs/:packId/item-sync/logs
GET  /api/servers               POST /api/servers
GET  /api/servers/:id           DELETE /api/servers/:id
POST /api/servers/:id/start     POST /api/servers/:id/stop
POST /api/servers/:id/command

# 服务器子资源（统一前缀 /api/servers/:serverId）
GET/PUT    /shop-items           DELETE /shop-items/:id
POST/GET   /shop-orders          GET /shop-orders/:id     POST /shop-orders/claim
POST/GET   /cdk-codes            GET/DELETE /cdk-codes/:id    POST /cdk/redeem
GET/PUT    /chat/settings        GET/POST/PATCH/DELETE /chat/triggers
GET/PUT    /vote-settings        GET/POST /votes    GET /votes/:id    POST /votes/:id/cast    POST /votes/:id/cancel
GET/PUT    /player-join/settings GET /player-histories    GET /gift-claims
GET/POST/PATCH/DELETE /periodic-messages
GET/POST/PATCH/DELETE /mods
GET/POST /saves    POST /saves/:id/activate    DELETE /saves/:id
GET/POST/PATCH/DELETE /backups
GET/POST /monitor/snapshots    GET /monitor/latest
GET/POST/DELETE /lists/:listType
GET/POST/PATCH/DELETE /webhooks    POST /webhooks/:id/test

# 全局
GET  /api/audit-logs
GET/PATCH  /api/users
GET/PUT/DELETE /api/system-config/:key
GET/POST/PATCH/DELETE /api/vip-permissions
GET/POST /api/player-bindings    POST /:id/verify    POST /:id/reject    DELETE /:id
```

### 前端页面（18 个路由页面）

| 类别 | 页面 |
|------|------|
| 公共 | Login / Home |
| 用户 | Servers / CreateServer / ServerDetail / Shop / ShopOrders / CdkRedeem / Votes / PlayerHistories / GiftClaims / Profile |
| Admin | Users / SystemConfig / Packs / AuditLogs / Webhooks |

> ServerDetail 内部通过 Tab 承载子功能（v3.7.0 重构后按分组组织）：
> - **运行时组**（runtime）：概览 / RCON 控制台 / 日志文件 / 聊天日志 / 玩家
> - **配置组**（config）：配置文件
> - **运维组**（ops）：世界生成 / 更新检查 / 存档 / Mods
> - **业务运营组**（business）：抽到二级页面 `/instances/:id/business`，含 商品配置 / 订单管理 / CDK 兑换 / 聊天触发 / 加入设置 / 投票踢人 6 个子 Tab
>
> Tab 显隐按实例状态联动（require_state）；顶部信息卡片默认折叠；底部固定操作栏（启动/停止/刷新）。原 `/admin/*` 下的实例级管理页（VIP / ItemSync / ShopItems / CDK / Chat / Vote / Player / Periodic / Mods / Saves / Backups / Monitor / Lists）已合并到实例详情 Tab 或业务运营二级页面，旧链接自动重定向到 `/instances`。

## Game Pack 系统

Pack YAML 描述游戏能力，包括：

- `pack.id` / `pack.game` / `pack.variant` / `pack.display_name` / `pack.version`
- `startup`: 启动命令模板、停止命令、就绪检测
- `communication`: RCON / stdin 协议选择
- `items`: 物品定义（id / display_name / category / quality）
- `event_parsers`: stdout 事件解析规则（chat / join / leave / death 等）
- `business.shop.give_command`: 物品发放命令模板（如 `/give {player} {item} {count}`）
- `business.cdk.redeem_command`: CDK 兑换命令模板
- `business.lists.whitelist_add` / `banlist_add`: 名单管理命令模板
- `business.vote`: 投票命令模板
- `business.periodic_message`: 定时消息模板

### 内置 Pack（5 款）

| Pack ID | 游戏 | 游戏端口 | RCON 端口 |
|---------|------|----------|-----------|
| `minecraft-vanilla` | Minecraft Java (Vanilla) | 25565 | 25575 |
| `factorio-vanilla` | Factorio (Vanilla) | 34197 | 27015 |
| `palworld-vanilla` | Palworld | 8211 | 25575 |
| `ark-vanilla` | ARK | 7777 | 27020 |
| `rust-vanilla` | RUST | 28015 | 28016 |

参考实现：[packs/minecraft-vanilla/pack.yaml](packs/minecraft-vanilla/pack.yaml)

## 数据库

使用 Knex migrations 管理 schema 版本，开发期默认 SQLite，生产可切 PostgreSQL。

```bash
# 运行 migrations（启动时自动执行）
cd panel/backend && npx knex migrate:latest

# 回滚
npx knex migrate:rollback
```

12 个 migration 文件位于 `panel/backend/src/db/migrations/`，覆盖 29 张表：

| 优先级 | 表 |
|--------|-----|
| P0 | users / nodes / servers / packs |
| P1 | vip_permissions / system_config / command_queue / item_sync_log |
| P2 | shop_items / shop_orders / shop_order_items / cdk_codes |
| P3 | chat_settings / chat_triggers / vote_settings / votes / player_join_settings / player_bindings / player_histories / gift_claims / periodic_messages |
| P4 | mod_records / save_records / backup_records / monitor_snapshots / list_entries |
| P5 | webhooks / audit_logs |

## 配置

环境变量位于 `panel/backend/.env`（参考 `.env.example`）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3002 | Panel 后端端口（仅本机监听，由 nginx 反代） |
| DATABASE_URL | ./data/panel.db | 数据库连接 |
| JWT_SECRET | （必填） | JWT 签名密钥（≥16 字符） |
| DAEMON_URL | http://localhost:8080 | Daemon 地址（8080 仅 Panel 本机调用，对公网禁用） |
| DAEMON_TOKEN | （必填） | Panel→Daemon Bearer Token |
| PACKS_DIR | ../../packs | Pack 加载目录 |
| LOG_LEVEL | info | pino 日志级别 |

## 主从集群架构 (v4.10.0+)

GSP 支持 Daemon 节点的主从集群架构（L2），允许中心 Panel 统一管理多台物理机上的游戏实例。

### 节点类型
- **Master（主节点）**：Panel 本机自带的默认节点。
- **Slave（从节点）**：通过邀请码注册到 Panel 的远程节点，负责实际运行游戏进程。

### 添加 Slave 节点步骤
1. 在 Panel 前端进入「节点管理」页面。
2. 点击「添加节点」，生成邀请码与部署脚本。
3. 在目标远程服务器上，执行页面提供的一键部署脚本（`slave-bootstrap.sh`）。该脚本会自动配置 `MASTER_URL` 与 `LINK_KEY` 并启动 Daemon。
4. 部署成功后，Slave 节点会自动与 Panel 建立 WebSocket 长连接，并保持心跳上报。

## 部署

### 生产部署

```bash
# 1. 构建前端
cd panel/frontend && npm run build

# 2. 编译后端
cd panel/backend && npm run build

# 3. 启动 Daemon
cd daemon && npm start

# 4. 启动 Panel 后端（前端静态资源由 Panel 后端服务）
cd panel/backend && npm start
```

### 注意事项

- **关闭现有部署后再部署新版本**，否则会报端口占用错误
- **版本更新时务必先运行数据库迁移**，migrations 已设计为幂等
- **生产环境必须修改默认管理员密码**与 JWT_SECRET
- **DAEMON_TOKEN 与 JWT_SECRET 务必使用强随机值**

## 开发指南

### 技术栈

- 后端：TypeScript strict + Express + Knex + pino + zod
- 前端：React 19 + Vite 6 + react-router-dom 7 + TypeScript
- Daemon：TypeScript + Express + ws + rcon-client

### 路径别名

- `@public/*` → `public/*`（前后端共享契约）
- `@/` → `src/`（前端内部）

### 开发命令

```bash
# 后端开发（tsx 热加载）
cd panel/backend && npm run dev

# 前端开发（Vite HMR）
cd panel/frontend && npm run dev

# 类型检查
cd panel/backend && npm run typecheck
cd panel/frontend && npm run typecheck

# 构建
cd panel/frontend && npm run build
cd panel/backend && npm run build
```

## 常见问题

### Q: 启动时报 "JWT_SECRET 过短" 警告？

A: 编辑 `.env`，将 `JWT_SECRET` 设置为至少 32 字符的强随机值（如 `openssl rand -hex 32` 生成）。

### Q: 创建服务器后无法启动？

A: 检查：
1. Daemon 是否已启动（`curl http://localhost:8080/health`）
2. `DAEMON_TOKEN` 是否与 Daemon 配置一致
3. 服务器端口是否被占用

### Q: 如何添加新游戏支持？

A: 在 `packs/` 下创建新目录，编写 `pack.yaml` 描述游戏启动/通信/物品/事件解析/命令模板。无需修改任何业务代码。

### Q: 商店购买后物品未到账？

A: 检查：
1. Pack.business.shop.give_command 模板是否正确
2. 命令队列是否阻塞（`command_queue` 表）
3. Daemon 是否在线
4. 玩家是否在线（部分游戏要求玩家在线才能发放物品）

### Q: Webhook 测试投递失败？

A: 检查：
1. URL 是否可达（`curl -X POST <url>` 手动测试）
2. Panel 后端是否能访问外网（防火墙限制）
3. 目标服务是否返回 2xx 状态码

## 相关文档

- [AGENTS.md](AGENTS.md) — AI 代理协作规则
- [方案定稿](.trae/specs/plan-core-competence-migration/scheme-final-merged.md) — 核心竞争力迁移方案
- [模块拆分](.trae/specs/plan-core-competence-migration/module-split.md) — S3 拓扑化拆分
- [变更记录](.trae/documents/) — 历次变更留痕
- [前端测试报告](.trae/documents/test_reports/) — s0402 三重闸门证据

## 版本

- **当前版本**：4.32.4
- **基线**：Panel-Daemon 主从集群架构 + 全量业务功能迁移 + 前后端分离架构
- **多游戏支持**：内置 12 款游戏 Pack，配置驱动、零硬编码
- **项目主页**：未登录用户访问根路径会跳转到 `/home` 项目介绍主页（深色科技风单页着陆页），已登录用户直接进入实例列表
- **管理后台**：侧边栏按 6 分组组织（用户与权限 / 系统监控 / 配置管理 / 审计与日志 / 运维清理 / 业务运营）
- **下一阶段**：持续演进与生态扩展
