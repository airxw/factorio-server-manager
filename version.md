4.39.2

## v4.39.2 (2026-07-31) — PATCH：生产运行时迁移 node dist/（build pipeline 重构）+ fresh install 迁移崩溃修复

**类型：** PATCH（现有构建/部署机制改进 + bug 修复，小版本号 +1，4.39.1 → 4.39.2，bb.md 规则）

**背景：** 落地 v4.39.0 登记的 build pipeline 重构 TODO——生产运行时从 `npx tsx src/index.ts` 迁移到 `node dist/index.js`（esbuild 单文件 bundle），消除 tsx 运行时依赖与 v4.39.0 首次尝试 `node dist/` 失败的两个根因（tsc 嵌套输出路径 + @public 路径别名运行时不可解析）。

**本次变更：**

### 一、build pipeline 重构（Panel Backend + Daemon）

1. **esbuild 单文件 bundle**：
   - 新增 [panel/backend/scripts/build-dist.mjs](panel/backend/scripts/build-dist.mjs)：应用入口 `src/index.ts` → `dist/index.js`（约 1.6MB）；`--packages=external`（node_modules 保持外部依赖——sqlite3 原生模块 / knex 动态 dialect / pino worker transport 不打入 bundle）；`alias @public` 编译期解析，运行时无别名依赖
   - 新增 [daemon/scripts/build-dist.mjs](daemon/scripts/build-dist.mjs)：`src/index.ts` → `dist/index.js`（约 180K）；adapters 字面量动态导入自动内联；`package.json` 版本号 import 编译期内联
   - 两端新增 `build:bundle` / `start:dist` 脚本 + `esbuild ^0.28.1` devDependency

2. **migrations 编译与双模式加载**：
   - build-dist.mjs 将 `src/db/migrations/*.ts`（29 个）多入口编译至 `dist/db/migrations/*.js`，共享 chunk 隔离至 `dist/db/chunks/`（避免 knex 误载）
   - [connection.ts](panel/backend/src/db/connection.ts) 新增 `resolveMigrationsConfig()`：按目录存在性自动切换——tsx/dev 模式加载 `src/db/migrations`（.ts），node dist 生产模式加载 `dist/db/migrations`（.js）；启动时自动迁移行为两端一致保留

3. **路径深度修复**：
   - daemon [ExecutionEngine.ts](daemon/src/modules/execution_engine/ExecutionEngine.ts) schema 路径从 `__dirname` 相对（bundle 后深度变化失效）改为 `process.cwd()` 相对（tsx / node dist / systemd 三模式 cwd 均为 daemon/）
   - backend changelog-parser.ts 经核实 src 与 dist 同为一级子目录深度，`../../../version.md` 解析天然兼容，无需改动

4. **deploy.sh / systemd 切换**：
   - `build()` 新增 `npm run build:bundle` 步骤（backend + daemon；保留 `npm run build` tsc 作为类型门禁，esbuild 不做类型检查）
   - 两个 systemd 单元 `ExecStart` 从 `/usr/bin/npx tsx src/index.ts` 切换为 `/usr/bin/node dist/index.js`，v4.39.0 TODO 注释闭合

### 二、附带缺陷修复：fresh install 迁移崩溃（DEF-008）

- **问题**：迁移 `20260730000006_adjust_pricing_divide_100` 直接 UPDATE `instance_type_pricing` 表，但其文件名时序（2026-07-30）先于建表迁移 `20260830000002`（2026-08-30）。fresh install 时调整迁移先执行 → `SQLITE_ERROR: no such table: instance_type_pricing` → Panel 启动失败。该缺陷自 v4.35.4 起存在于全新安装路径（存量库不受影响，故未被部署暴露），由本次 dist 临时库启动测试首次暴露。
- **修复**：up/down 均增加 `hasTable` 幂等防护——fresh install 跳过（后续 seed 迁移 `20260830000005` 插入的已是调整后新值），存量库行为不变。与 DEF-006 同类（迁移防护缺失），预防措施已在 defect-log 登记强化。

**验证：**

- backend dist 临时库 fresh install 启动：29 个迁移全部从 `dist/db/migrations`（编译 JS）按序执行成功（含 baseline 113 DDL），服务监听 3999，`/api/health` ok、`/api/version`=4.39.x、`/api/version/changelog` 正常、前端静态 200
- daemon dist 启动：`/health` ok + version 正确（JSON 内联），`/api/instances` 鉴权双向（带 token 200 / 无 token 401 missing_authorization）
- 三端 `tsc --noEmit` 0 错误；后端 vitest 705/705 PASS；daemon vitest PASS；前端 build 通过；dist 无 `localhost:3000` / `127.0.0.1:3000` 违规
- BUILD_ID 更新为 20260731-002；check:version 12 源全绿

---

## v4.39.1 (2026-07-31) — PATCH：前端清新设计语言对齐（Apple HIG）

**类型：** PATCH（现有功能改进 + UX 增强，小版本号 +1，4.39.0 → 4.39.1，bb.md 规则）

**背景：** 全面对齐苹果清新设计语言（Apple Human Interface Guidelines），统一视觉 Token 体系，修复圆角/阴影/行高/字距不一致问题，提升移动端可用性和操作反馈一致性。

**本次变更：**

### 一、CSS Token 体系统一（styles.css）
1. **圆角三级体系**：大容器 16px（--radius-lg）/ 中卡片 12px（--radius-md）/ 小元素 8px（--radius-sm），消除 20-28px 过度圆角
2. **阴影柔和化**：移除所有彩色发光阴影（shadow-glow），统一使用轻量 shadow-sm/shadow-md，按钮不再有蓝色光晕
3. **全局行高**：body 设置 line-height:1.5，中文文本阅读舒适度大幅提升
4. **字距修复**：表单标签 tracking 从 0.18em 降至 0.08em，消除字符过度疏离
5. **内容宽度**：app-content 添加 max-width:1280px，超宽屏不再无限拉伸
6. **表格行高**：data-table 单元格 padding 从 10px 14px 增至 12px 16px，呼吸感更好
7. **表单元素**：input/select/textarea min-height:36px，交互热区统一
8. **品牌名**：侧边栏品牌名从渐变色改为纯色，面包屑移除胶囊容器改为纯文本分隔符
9. **状态点**：徽章状态点从 6px 增大至 10px（h-2.5 w-2.5），可辨识性提升
10. **空态图标**：空态区域图标从 48px 增大至 56px（w-14 h-14），视觉权重更平衡

### 二、WorkbenchUI 组件库对齐（WorkbenchUI.tsx）
1. **WorkbenchContainer**：rounded-2xl + shadow-sm + border + bg-white，移除 backdrop-blur 和渐变背景
2. **WorkbenchPrimaryButton**：rounded-full + bg-[#007AFF]（iOS蓝）+ min-h-[44px]，移除 translateY hover 和发光阴影
3. **WorkbenchSecondaryButton**：rounded-full + border 风格，移除 translateY 和阴影
4. **WorkbenchGhostButton**：简洁圆形图标按钮，移除阴影
5. **WorkbenchKpiCard**：rounded-xl + shadow-sm，移除 translateY 跳跃效果
6. **WorkbenchEmptyState**：增大图标至 w-14 h-14，优化间距和 CTA 按钮样式
7. **WorkbenchQuickEntry**：rounded-xl + 响应式 grid-cols-2/sm:3/lg:4，移除 translateY hover
8. **WorkbenchSectionTitle/Kicker**：tracking-wide（0.025em）替代 tracking-[0.18em]，font-semibold 替代过度加粗
9. **WorkbenchRowActionButton**：从 hover 才显示改为常驻透明度 70%（hover:opacity-100），可发现性提升

### 三、页面修复
1. **StoreHome（工作台首页）**：InstanceRow 移除 translateY/glow，KPI 卡片间距优化，快捷入口响应式网格，段描述精简
2. **Servers（我的实例）**：空态区域样式优化，内联圆角替换为 Tailwind 标准类，tracking 修正
3. **跨页面一致性**：修复 Servers.tsx / ShopConfigEditor.tsx / CreateServer.tsx / OperationsDashboard.tsx / VersionsPage.tsx / ProductList.tsx / InstanceEconomyConfig.tsx / InstanceVipUsers.tsx / PriceOverridePanel.tsx / UgcForm.tsx 等 10+ 文件的残留旧圆角、发光阴影、过度字距

### 四、交互体验增强
1. **折叠侧边栏 Tooltip**：侧边栏折叠状态下菜单项添加 CSS Tooltip，鼠标悬停显示菜单名称
2. **侧边栏分组持久化**：分组折叠/展开状态通过 localStorage 持久化（SIDEBAR_GROUPS_KEY），刷新后保持用户偏好
3. **侧边栏分组精简**：ADMIN_GROUPS 从 10 组精简为 5 组（总览/用户与权限/资源管理/系统配置/运维），导航更清晰

**验证：**
- tsc --noEmit 0 错误（frontend）
- vite build 成功（6.78s，dist/index.css 135.14KB）
- 构建产物无 localhost:3000 / 127.0.0.1:3000 违规
- 浏览器视觉核对通过：工作台首页 / 我的实例 / 个人设置页截图验证
- BUILD_ID 更新为 20260731-001
- check:version 全部对齐 4.39.1

### 五、附加热修复（2026-07-31，并入本版本一并部署）

1. **backups 表名漂移修复（缺陷库 DEF-007）**：`scheduler-init.ts` 的 `ALERT_BACKUP_HEALTH_CHECK` 定时任务与 `operationsService.ts` 的备份健康度查询误用不存在的 `backups` 表（实际表为 `backup_records`），导致每日告警任务持续报 `SQLITE_ERROR: no such table: backups` 且备份健康检查永远失效（lastBackupAt 恒为 null）。已将 2 处查询统一修正为 `backup_records`。验证：后端 tsc 0 错误 + vitest 705/705 PASS。

---

## v4.39.0 (2026-07-30) — PATCH：项目整改批次1（致命项修复 + 僵尸清理）

**类型：** PATCH（bug 修复 + 现有功能修改，小版本号 +1，4.38.0 → 4.39.0，bb.md 规则）

**背景：** 项目锐评发现 10 项问题，本版本为 4 版本整改计划的第一批，处理致命项与僵尸清理。

**本次变更：**

1. **P1 生产入口审查**：审查 systemd ExecStart 合规性——rules-0 §3.1.2 仅禁止 `tsx watch` / `npm run dev`，`npx tsx src/index.ts`（非 watch）合规。迁移到 `node dist/` 需先重构 build pipeline（tsconfig rootDir + @public 路径别名运行时解析 + .ts 扩展名），已标记 TODO 延后至独立版本处理。deploy.sh update 流程新增 `create_systemd_services` 刷新步骤确保 service 文件同步
2. **P11 僵尸测试清理**：`serverService.test.ts`（无对应 service 文件）重命名为 `servers.lifecycle.test.ts` 并移至 `api/routes/`，调整 import 与 describe 名称
3. **P4 version.md 归档**：5234 行 → 212 行，v4.35.4 及更早版本归档至 `docs/version-history/version-archive-v1-v4.38.md`
4. **P8 AGENTS.md 同步**：panel/backend/AGENTS.md WS 测试端口 3000→3002；panel/frontend/AGENTS.md ServerDetail 文件结构更新；backend .env 注释端口修正
5. **P9 Test2 闸门加固**：新增 `npm run seed:dev` 脚本（`src/db/seed-dev.ts`），一键填充 dev 数据库演示账号，解决 Test2 浏览器核对因无认证凭据被跳过的根因
6. **P10 注释清理 / 版本号对齐**：12 个版本来源统一为 4.39.0；BUILD_ID 更新为 20260730-006

**验证：**
- 三端 tsc --noEmit 0 错误
- BUILD_ID 更新为 20260730-006
- check:version 12 来源全部 4.39.0
- 构建产物无 localhost:3000 / 127.0.0.1:3000 违规

**部署状态：** 已部署至生产（2026-07-30），Panel 3002 + HTTPS 3001 + HTTP 301 跳转 + Daemon 8080 全部健康检查通过，生产 /api/version=4.39.0。

---

## v4.38.0 (2026-07-30) — MINOR：公会服务器市场重做 + 绑定申请审批流程

**类型：** MINOR（全新功能，中版本号 +1，4.37.2 → 4.38.0，bb.md 规则）

**背景：** 原 `/guild/servers` 可绑定列表数据源有缺陷（仅能看到自己创建的实例），且缺少公开/私有实例的上下架与申请-审批机制。本次将公会服务器页重做为全平台服务器市场：公开实例可直接绑定，私有实例走申请-审批流程。

**本次变更：**

1. **服务器市场重做**：`/guild/servers` 重做为全平台服务器市场，支持公开实例直接绑定 + 私有实例申请-审批流程两条路径
2. **绑定申请数据层**：新增 `binding_requests` 表 + 6 个绑定申请端点（创建/列表/审批/拒绝/取消/我的申请）+ 1 个可绑定实例列表端点
3. **实例上下架**：服主可上架/下架自己的实例（`is_public` 字段），权限下放给 owner / instance_admin
4. **申请通道开关**：服主可开启/关闭绑定申请通道（`binding_requests_enabled` 字段）
5. **审批自动建绑定**：审批通过自动创建 binding（`vip_level=1`，与直接绑定一致，用户裁决选项 A）
6. **我的绑定申请页**：新增 `/guild/my-binding-requests` 页面，玩家可查看自己提交的申请及审批状态
7. **实例详情绑定申请 Tab**：实例详情页新增"绑定申请"Tab，服主在此集中审批管理
8. **Bug 修复**：修复 GuildBind 可绑定列表数据源（原只能看到自己创建的实例）

**验证：**
- 三端 tsc --noEmit 0 错误
- BUILD_ID 更新为 20260730-002
- check:version 12 来源全部 4.38.0

---

## v4.38.0 补充 (2026-07-30) — MINOR：/admin/servers 美学与移动端兼容性优化（W1-W8）

**类型：** MINOR（设计 token 体系 + 新组件 TabSheetPicker，全新功能量级；与公会市场重做同版本号 4.38.0 交付，人类裁决 2026-07-30）

**背景：** `/admin/servers` 列表页与 `/admin/servers/:id` 详情页存在美学不一致（裸 hex 颜色、表头大写不符合中文场景、圆角偏大）与移动端兼容性问题（横滑条 tab 体验差、触控目标过小、终端深色配色与浅色主题冲突）。本次以 Apple 浅色设计语言为基线，引入设计 token 体系并分 9 个波次（W0-W8 + W9 验证）渐进式优化。

**本次变更（W1-W8）：**

1. **W1 Token 地基**：`styles.css :root` 新增语义色/圆角药丸/触控目标/浅色终端 token，断点约定收敛为 640/768/1024 三档
2. **W2 颜色圆角收编**：styles.css 裸 hex → var（分批）；表头去 uppercase/letter-spacing；圆角数值迁移 `--radius-sm 10→6 / --radius 12→10 / --radius-lg 20→16`（人类裁决 D4，全站圆角变小）
3. **W3 断点收敛**：480/520/600 → 640，900 → 768/1024，媒体查询仅剩 3 档
4. **W4 触控与 hover**：btn/btn-sm/tab-btn/checkbox ≥44px 热区；`.row-actions` 在 `@media (hover:none)` 常显
5. **W5 列表页收编**：Servers.tsx inline style → 类（quota-bar/batch-bar/排序图标工具栏类化）
6. **W6 详情页收编**：ServerDetailCore.tsx inline style → 类；node_id → node_name（fallback）；续费/磁盘/子目录操作区类化
7. **W7 浅色终端**：`.terminal` 切浅色 token（GitHub Light 风格），高度 `min(360px, 50dvh)`，stderr/时间戳/空态/滚动条全部 token 化
8. **W8 ActionSheet**：新建 `components/ui/TabSheetPicker.tsx`（触发器 + 底部分组 sheet，含角色过滤后的 visibleTabs 全量）；ServerDetailCore 移动端接入替换打平横滑条；保留 useSwipe 绑定整个 tab 内容区（E6 裁决）；12 单测（含 keep-alive rerender、键盘 ←→ 循环、ESC/遮罩关闭）

**验证（W9，用户裁决"立即部署"2026-07-30，跳过浏览器核对与独立审查）：**
- Test1 单测/编译：前端 tsc --noEmit exit 0；vitest 328/328 PASS（含 TabSheetPicker 12 用例 + ServerDetail 8 用例 + Servers 1 用例修复 auto_approve_binding_requests schema 字段）；vite build PASS；dist 无 localhost:3000/127.0.0.1:3000（0.md 最高规则）
- Test2 浏览器核对：用户授权跳过（降级，待真机复核 375×812）
- Test3 Mock 回归：用户授权跳过（纯样式/组件改动不触及 Mock 路径）
- GN-004 独立审查：用户授权跳过（降级，人工 checklist 替代——Test1 证据链完整）
- BUILD_ID 升至 20260730-003
- check:version 12 来源全部 4.38.0

**已知未闭合项（交付时声明，不阻断）：**
- 375×812 真机/设备模拟复核（调研 D8）：内置浏览器工具无法缩放视口，移动端结论以 CSS 推断 + 单测 + dev server 核对为准；交付后需真机复核卡片布局/ActionSheet 交互

**回退锚点：** W0 基线点 git commit d65b8d2 + 每波次闭合点

**降级声明：** 本次交付经人类授权跳过 Test2/Test3/GN-004，以 Test1 实体证据（tsc/vitest/build/dist 检查输出）作为人工 checklist 替代。独立审查未执行，已在 note 标注。

---

## v4.37.2 (2026-07-30) — 修复多角色用户切换 active_role=user 后访问自有实例 403

**问题：** 多角色用户（身兼 `server_admin/instance_admin/user`）将会话级 `active_role` 切换到 `user`（玩家门户视图）后，在「我的服务器」列表能见到自有实例，但点击进入详情页 `/guild/servers/:id` 时后端返回 `403 PANEL_FORBIDDEN`，前端显示「您无权访问该实例」。

**根因：** `requireInstanceAccess` 中间件中，owner 匹配校验被嵌套在 `if (role === Role.INSTANCE_ADMIN)` 分支内。而列表 API `GET /api/servers` 的 `user` 分支会返回 `owner_user_id = userId` 的实例。两者不一致：列表对 `user` 角色包含 owner 实例，但访问鉴权仅对 `instance_admin` 角色做 owner 兜底——`user` 角色即使是 owner 也走不到 owner 判断，直接落到 403。

**本次变更：**

1. **[auth.ts](panel/backend/src/middleware/auth.ts) `requireInstanceAccess`**：将 owner 匹配校验从 `if (role === Role.INSTANCE_ADMIN)` 块内提到块外，使任意 `active_role` 命中 owner 即放行。`instance_admin` 分支仅保留 `instance_admins` 共管记录检查。同步更新 JSDoc 鉴权顺序说明。

**业务逻辑保留：** `server_admin` 全通过、`instance_roles` 显式授权、`instance_admins` 共管记录、`bindings` verified 绑定——全部不变。`requireInstanceAdmin`（管理员级鉴权）未改动，保持"管理员操作需切到 instance_admin 角色"的设计意图。

**版本递增依据：** bug 修复 → 小版本号 +1（4.37.1 → 4.37.2，bb.md 规则）。

**验证：**
- backend `tsc --noEmit` 0 错误
- backend vitest 688/688 PASS（无回归）
- check:version 12 来源全部 4.37.2
- BUILD_ID 更新为 20260730-005

---

## v4.37.1 (2026-07-30) — 修复新注册用户被重定向到 /forbidden + Forbidden 页视觉重做

**问题：** 新注册用户登录后被定向到 `/forbidden` 无权限页。根因：[Register.tsx](panel/frontend/src/pages/Register.tsx) 注册成功后 `navigate('/dashboard')`，但 `/dashboard` 在 v4.12.0 已废弃并重定向到 `/admin`；新用户 role=user 命中 `/admin` 守卫（`RequireRole allow=['server_admin','system_admin','admin']`）被弹到 `/forbidden`。同一根因也影响 `NotFound.tsx` / `ServerError.tsx` / `EmailVerify.tsx` / `useKeyboardShortcuts.ts` / `CommandPalette.tsx` / `Layout.tsx` 中残留的 `/dashboard` 引用。

**本次变更：**

1. **根因防御性修复（[App.tsx](panel/frontend/src/App.tsx)）**：`/dashboard` 重定向目标从 `/admin` 改为 `/`（由 `RootRedirect` 按角色分流：admin→/admin、instance_admin→/store、user→/guild）。此单点修复让所有残留的 `/dashboard` 调用方（快捷键、命令面板、邮箱验证、侧边栏 home 按钮）自动路由到角色对应基座，杜绝非管理员被弹到 `/forbidden` 的整个 bug 类。

2. **直接调用方修正**：
   - [Register.tsx](panel/frontend/src/pages/Register.tsx)：注册成功后 `navigate('/dashboard')` → `navigate('/')`；已登录用户访问 `/register` 的 `Navigate to="/dashboard"` → `Navigate to="/"`
   - [NotFound.tsx](panel/frontend/src/pages/NotFound.tsx) / [ServerError.tsx](panel/frontend/src/pages/ServerError.tsx)：返回按钮 `to="/dashboard"` → `to="/"`

3. **Forbidden 页视觉重做（[Forbidden.tsx](panel/frontend/src/pages/Forbidden.tsx) + [styles.css](panel/frontend/src/styles.css)）**：原页面用内联样式 + 纯文本「403」，不符合 Apple 浅色设计语言。重做为居中圆角卡片：
   - 顶部蓝色圆形盾牌图标（ShieldAlert，背景 `var(--color-primary-bg)`）
   - 眉标「403 · 访问受限」（uppercase + letter-spacing）
   - 标题 + 提示文案 + 角色对应「返回首页」按钮 + 免密切换服主身份 CTA（保留原有全部业务逻辑）
   - 移动端响应式（<600px 缩小图标/标题、按钮自适应）
   - 全部使用设计 token（`--color-surface` / `--shadow-md` / `--radius-xl` 等），无硬编码色值

**业务逻辑保留：** 角色对应 home 路径（admin→/admin、instance_admin→/store、user→/guild）、免密切换服主身份 CTA（v4.28.0）、切换失败 toast、切换中按钮 disabled——全部不变，6/6 既有单测无需修改即通过。

**版本递增依据：** bug 修复 + 现有功能修改 → 小版本号 +1（4.37.0 → 4.37.1，bb.md 规则）。

**验证（s0402 前端三重闸门 · 已闭合）：**
- Test1 单测：Forbidden 6/6 + 前端全量 316/316 PASS；tsc --noEmit 0 错误
- Test2 内置浏览器：注册新用户 → 跳转 /guild（非 /forbidden，bug 修复验证）；/admin/users → /forbidden 新卡片设计渲染正常；返回首页 → /guild
- Test3 Mock：N/A（无 API/WS/数据契约变更）
- vite build 通过；dist 无 `localhost:3000` / `127.0.0.1:3000` 违规（0.md §五）
- BUILD_ID 更新为 20260730-004
- 证据目录：`.trae/documents/test_reports/frontend_gate_20260730_124858/`

---

## v4.37.0 (2026-07-30) — CDK 机制改造：服主发放 + 可重复使用 CDK

**背景：** 用户反馈 CDK 子 Tab（`/instances/:id/business?subtab=cdk`）机制有误——原为玩家兑换入口，实际应为服主发放 CDK 的管理位置。服主需生成一个或多个 CDK，每个 CDK 对应某个物品（礼包），玩家凭 CDK 兑换。

**本次变更：**

1. **Bug 修复：Business.tsx cdk 子 Tab 组件挂载错误**
   - 原 `cdk` 子 Tab 渲染玩家兑换组件 `CdkRedeem`，改为渲染管理员管理组件 `CdkCodes`（embedded 模式，传入 `serverId`）
   - 子 Tab 标签由"CDK"改为"CDK 发放"，语义对齐服主发放场景

2. **新功能：可重复使用 CDK（max_uses）**
   - **数据库**：`cdk_codes` 表新增 `max_uses`（最大使用次数：1=一次性/N=多次/0=无限）和 `use_count`（已使用次数）列；新建 `cdk_redemptions` 子表记录每次兑换（cdk_code_id + player_name + redeemed_at，唯一约束防同一玩家重复兑换）
   - **后端服务**（[cdkService.ts](panel/backend/src/services/cdkService.ts)）：`redeem` 方法按 `max_uses` 分支——一次性走原两段事务（unused→claiming→claimed）；多次用走 redemption 事务（插入记录 + 递增 use_count + 命令派发，失败回滚）；`deleteCode` 增加 `use_count>0` 拒绝删除保护；`getCode` 附带 redemptions 列表
   - **后端路由**（[cdk.ts](panel/backend/src/api/routes/cdk.ts)）：创建路由增加 `max_uses` 校验（非负整数，经济类型固定 1）；兑换响应增加 `remaining_uses`；lookup 端点附带 `max_uses`/`use_count`
   - **数据契约**（[panel-api-types.ts](public/schema/panel-api-types.ts)）：`CdkCodeSummary` 增加 `max_uses`/`use_count`/`redemptions`；新增 `CdkRedemptionRecord` 接口；`RedeemCdkResponse` 增加 `remaining_uses`；`CreateCdkCodesRequest` 条目增加 `max_uses`
   - **前端管理**（[CdkCodes.tsx](panel/frontend/src/pages/admin/CdkCodes.tsx)）：生成表单增加使用次数模式选择（一次性/限N次/无限次）；列表新增"使用次数"列（显示 use_count/max_uses）；多次用 CDK 可展开查看兑换记录（玩家名 + 兑换时间）；删除条件修正为 `unused && use_count===0`；支持 embedded 模式（隐藏服务器选择、propServerId 同步）
   - **前端兑换**（[GuildCdk.tsx](panel/frontend/src/pages/guild/GuildCdk.tsx) / [CdkRedeem.tsx](panel/frontend/src/pages/CdkRedeem.tsx)）：兑换成功后展示剩余次数提示（多用途）；预览阶段展示可重复兑换信息

3. **数据库迁移**：[20260901000000_add_cdk_reusable.ts](panel/backend/src/db/migrations/20260901000000_add_cdk_reusable.ts) 添加 `max_uses`/`use_count` 列 + 创建 `cdk_redemptions` 表

**版本递增依据：** 可重复使用 CDK 为全新功能 → 中版本号 +1（4.36.1 → 4.37.0，bb.md 规则）。

**验证：**
- 三端 tsc --noEmit 0 错误（panel/backend + panel/frontend；daemon 未改动）
- 后端 cdkService 单测 16/16 全绿（原 10 + 新增 6 个多用途分支：多次兑换递增/防同一玩家重复/达上限拒绝/命令失败回滚/无限次/删除保护）
- 前端 build 通过；dist 无 `localhost:3000` / `127.0.0.1:3000` 违规引用（0.md §五）
- BUILD_ID 更新为 20260730-003

---

## v4.36.1 (2026-07-30) — 修复部署后 lazy chunk 加载失败导致页面白屏

**问题：** 部署新版本后，浏览器缓存的旧 index.html 引用了不存在的 chunk hash（如 `AdminDashboard-7cWmUAxh.js`），React `lazy()` 动态导入抛出 `Failed to fetch dynamically imported module`，ErrorBoundary 捕获后显示"页面渲染时发生错误"。用户手动刷新后恢复正常，但首次访问体验受损。

**修复：** 新增 [lazyWithRetry.ts](panel/frontend/src/utils/lazyWithRetry.ts) 工具函数，包装 `React.lazy`：
- 检测到 chunk 加载失败时，通过 `sessionStorage` 标记防止无限循环，自动 `window.location.reload()` 加载新 HTML
- App 根组件 mount 成功后清除标记，允许下次部署再次触发
- 替换 App.tsx + ServerDetailCore/ServerDetailAdmin/ServerDetailStore/PlayerHome/Home 共 6 个文件中所有 `lazy(() => import(...))` 调用

**验证：** tsc 0 错误；前端 316/316 测试全绿；build 通过；dist 无违规地址。

**追加修复（同版本部署）：** daemon 重启后"Instance not found"错误 + 前端状态不一致
- **根因 1（后端）**：[websocket-init.ts](panel/backend/src/websocket-init.ts) 的 `onConnect` 回调仅做正向同步（Daemon 实例 → DB），缺少反向同步。daemon 重启后内存表清空，但 DB 中 `running/starting` 状态的实例未被修正，用户操作时 Panel 调 daemon → 404 "Instance not found" → 透传 502。
- **修复 1**：`onConnect` 中补充反向同步——将 DB 中 `running/starting` 但不在 Daemon `listInstances()` 返回列表中的实例自动标记为 `stopped`。部署日志验证：检测到 2 个孤儿实例（Factorio + Minecraft）并自动修正。
- **根因 2（前端）**：[ServerDetailCore.tsx](panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx) 的 `displayState = liveState ?? server.status`，WS 重连后 `refresh()` 只更新 `server.status`，但 `liveState` 残留旧值（running），导致页面仍显示"运行中"而后端实际为 stopped。
- **修复 2**：WS 重连成功时（`handleConnectedChange` false→true）先 `setLiveState(null)` 再 `refresh()`，让 `displayState` 回退到 API 最新数据。

---

## v4.36.0 (2026-07-30) — 技术债全量治理（38 项债务 11 波落地）+ Pack variant 标签 + Friends 同实例推荐

**背景：** 2026-07-29 全仓技术债扫描（`.trae/documents/tech-debt-scan-20260729.md`）识别 38 项债务（7 高 / 14 中 / 17 低），经多方案对抗论证采纳方案 B（全量治理、按风险分批递进），按 `docs/plans/tech-debt-remediation-plan.md` 分 W0-W10 共 11 波推进，人类整体授权「方案论证后直接修」。

**本次变更（按波次）：**

1. **W0 基线**：git init + 基线 commit（治愈 H6 无版本控制）；`.gitignore` 覆盖 node_modules/dist/data。
2. **W1 速赢批**：daemon 依赖补齐 + tsconfig include 收窄（H1/H2 daemon tsc 0 错误）；Servers.test fixture 补 `node_name`（H5 前端红测修复）；删除 FormSkeleton/TabSkeleton/parallelDownloader/mock-pgrep/update-help.js 死文件；dev.sh/serve.sh 归档 docs/archive；.pids 清理；errors.ts 陈旧注释修正。
3. **W2 契约批（s0601）**：`PendingWithdrawItem`/`ListPendingWithdrawsResponse`/`CleanupAllPreviewResponse` 上推 public 契约（唯一真相源）；新建 `public/schema/settings.ts` 统一 SettingSchemaItem 双端引用；`VerifyBindingViaWebhookRequest` 移除冗余 `game_type` 字段（BREAKING，无运行时消费方）；新增 preflight 预生成 Mock；CHANGELOG v4.33.0 记录。
4. **W3 提炼批**：新建 `utils/pagination.ts`（parsePagination）替换 5 处内联；新建 `utils/date.ts`（utcDateKey）替换 6 处内联。
5. **W4 孤岛治理**：itemAttributeResolver 接入 give-item 命令渲染链（resolveGiveCommandVars + stripHiddenPlaceholders 真实调用，治愈 H3 孤岛）；JwtPayload.role 等 4 处 @deprecated 注释按实际语义修订。
6. **W5**：`!uptime` 游戏内命令接 daemon 真实 uptime（InstanceSummaryWithUptime），移除 3 处 TODO。
7. **W6 测试补齐**：9 个资金服务核心路径单测（balance/withdraw/wallet/cdk/vip/shop/integral/points/pricing，治愈 H4 资金零测试）；StartupGuideWizard 前端单测。
8. **W7 E2E 修复**：/admin /store /guild 首屏 body empty 根因定位并修复（H7）。
9. **W8 文档批**：docs/plans 14 篇 status 校正；.trae/documents test_reports 按月归档；backup/logs 用途登记。
10. **W9 大项最小落地**：B6 ServerDetail 抽离 [ServerDetailCore.tsx](panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx)（+ ExpiryEditModal 独立组件，Admin/Store 包装复用，不改行为）；B5 `<VirtualTable>`（@tanstack/react-virtual）推广到 AuditLogs/Users/PlayerBindings 三列表；**D7 新功能**——Packs 列表/详情 variant 标签徽章展示（partial 闭合 pending-requirements.md 第 1 条）；**D8 新功能**——Friends 同实例玩家推荐（`GET /api/friends/recommendations`：同实例 verified 玩家绑定的其他用户，排除已是好友/待处理，聚合共同实例计数排序取前 20；前端 Friends 页面推荐区块 + 一键加好友；契约 `FriendRecommendation`/`FriendRecommendationsResponse`，CHANGELOG v4.36.0 MINOR 记录 + 6 单测）。
11. **W10 收尾**：current-note L17 四处过时记录修正（SetupWizard 29 失败→实测全过 / startup_guide 12 缺失→9/9 全有 / VirtualList 技术栈误记→VirtualTable @tanstack/react-virtual / defect:query 缺失→已补齐）；L8/L9/L16 登记 `docs/plans/pending-requirements-tech-debt.md`；12 版本源统一 4.36.0。

**版本递增依据：** D7/D8 为全新功能 → 中版本号 +1（4.35.4 → 4.36.0，bb.md 规则）。

**验证：**
- 三端 tsc --noEmit 0 错误（panel/backend + panel/frontend + daemon）
- 后端 vitest 682/682 全绿（含新增资金服务 + 好友推荐测试）
- 前端 vitest 316/316 全绿（含 SetupWizard 全套件）
- 前端 build 通过；dist 无 `localhost:3000` / `127.0.0.1:3000` 违规引用（0.md §五）
- `npm run check:version` 12 版本源全对齐 4.36.0
- 运行时接入校验（rules-0 §四-13）：好友推荐路由已注册 routes-registry；VirtualTable 被 3 页面引用；ServerDetailCore 被 Admin/Store 包装引用

**已知遗留（不阻断）：**
- L8 store_shop_config.ts 命名 / L9 路由测试比 / L16 DST token 占位 → 已登记 `docs/plans/pending-requirements-tech-debt.md`
- quotaService 注释代码块（L4）保留——决策留痕式保留，合规

**追加修复（v4.36.0 部署时一并上线）：**

12. **RCON 连接重试机制**（daemon）：[daemon/src/instances/manager.ts](daemon/src/instances/manager.ts) 新增 `connectRconWithRetry` 方法，解决 Minecraft/Factorio 等"ready_pattern 先于 RCON 端口就绪"的时序 bug。
    - **根因**：daemon 在 ready_pattern 命中后立即连接 RCON，但此时 RCON 端口可能还未绑定（毫秒级差异），导致 `ECONNREFUSED`，命令通道永久不可用（发送 `list` 报错）。
    - **修复策略**：仅对 `ECONNREFUSED` 重试（端口未就绪），密码错误/超时不重试；5 次重试，间隔 1s/2s/3s/4s/5s（总最长 15s）；每次重试前检查实例状态是否仍为 running（停止时取消）；连接成功后才设置 `instance.protocol`。
    - **验证**：Minecraft 实例启动后发送 `list` 命令成功返回 `There are 0 of a max of 20 players online:`（内置浏览器核对通过）。

**部署状态：** 已部署至生产（2026-07-30），s0701 前置自检 7 项全通过，健康检查通过，RCON 命令验证通过。

---

## 历史版本归档

v4.35.4 及更早版本（v1.0.0 ~ v4.35.4）已归档至 `docs/version-history/version-archive-v1-v4.38.md`。

如需查阅历史变更记录，请访问上述归档文件。
