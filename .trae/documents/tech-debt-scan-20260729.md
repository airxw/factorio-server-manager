# 技术债扫描报告（2026-07-29）

> s0602 技术债扫描产出。扫描范围：全仓（panel 前后端 + daemon + public 契约层 + docs/backup/logs/scripts/modules/.trae 留痕），经人类裁决推迟功能项（M7/B5/B6/B7 等）全部纳入。本报告仅识别与分级，未做任何文件变更。

- 扫描执行：2 个并行 subagent（general_purpose_task 承载）+ 主线程复核
- 状态：**已闭合**（8+7 类全覆盖，每项附实体证据）
- 人类裁决记录（2026-07-29 AskUserQuestion）：①范围=全仓；②推迟项全部纳入；③方案审批后批量执行+「方案论证后直接修，不要问我」（视为对治理清单的整体显式授权；public/ 契约变更仍走 s0601 分析流程但不再单独请示）

---

## 一、高优先级（7 项，立即治理）

| # | 类型 | 证据 | 建议动作 |
|---|------|------|----------|
| H1 | daemon 依赖声明与安装态漂移 | `daemon/package.json:19,23,25` 声明 `@types/yauzl`/`rcon-client`/`yauzl`，lockfile 有记录但根 node_modules 实际未安装 → `modScanner.ts:24,25`、`rconClient.ts:8` TS2307 ×3，daemon typecheck/verify 必红 | 根目录 `npm install` 对齐安装态 |
| H2 | daemon tsconfig include 越界 | `daemon/tsconfig.json:14` include `../public/**/*.ts` 把 `public/test_cases/*.ts`（5 文件）拉入编译 → 5 个 TS2307（缺 jsonschema） | include 收窄为 `../public/schema`、`../public/interface_stub` |
| H3 | itemAttributeResolver 孤岛（假闭合模式） | `panel/backend/src/core/packs/itemAttributeResolver.ts` 全仓仅被自身测试 `itemAttributeResolver.test.ts:14` 引用，无生产消费方（v4.13.0 步骤5 设计的 special_attributes 自适应未接入运行时，违反 rules-0 §四-13） | 接入 give-item 命令渲染链（playerManagementService/commandDispatcher）或删除 |
| H4 | 资金类服务零单测 | services 66 源文件仅 13 有测试（~20%）；`walletService/withdrawService/balanceService/cdkService/vipService/shopService/integralService/pointsService/pricingService` 均无 .test.ts | 按资金风险补核心路径单测 |
| H5 | Servers.test.tsx 红（前端套件唯一失败） | `panel/frontend/src/pages/__tests__/Servers.test.tsx:71` waitFor 超时；根因：fixture（:21-62）缺 v4.31.0 新增必填键 `node_name`（`src/api/schemas.ts:91`）→ validateResponse 抛错 → 列表渲染为空 | fixture 补 `node_name: null` |
| H6 | 工作区无 git 仓库 | `/home/airxw/gsp` 与 `/opt/gameserver-panel` 均无 `.git`（find /home/airxw maxdepth3 零命中）；current-note 记录的 commit 603c92d / tag pre-polish-stage-2 本机不可验证；无版本回滚能力 | git init + 基线提交（治理前建立回滚锚点） |
| H7 | E2E `/admin /store /guild` 首页 body 渲染为空 | 记录于 version.md:245 与 test_reports/frontend_gate_20260729_010433/summary.json:26-56；涉及 login/role-switching/guild-portal/mobile-viewport/instance-flow 5 个 spec；globalSetup token 复用正常（/auth/me 通过），问题在页面渲染层；三重闸门 Test2 对三门户首页长期无回归证据 | 立排查任务定位渲染层根因并修复 |

## 二、中优先级（14 项，本批治理）

| # | 类型 | 证据 | 建议动作 |
|---|------|------|----------|
| M1 | parallelDownloader.ts 孤岛 | `panel/backend/src/utils/parallelDownloader.ts` src 内零 import | 删除 |
| M2 | 契约漂移：PendingWithdrawItem 本地定义 | `panel/frontend/src/api/modules/admin.ts:94-114` 本地定义（自述待 B7 上推）；被 client.ts:190,280-281、WithdrawApprovals.tsx:16-17 消费；public/schema/panel-api-types.ts 无此二类型 | s0601 上推 public/，前端改引用 |
| M3 | 契约漂移：VerifyBindingViaWebhookRequest.game_type | `public/schema/panel-api-types.ts:3609-3614` 仍含 game_type，而 CreatePlayerBindingRequest 已 v4.27.0 改 server_id（BREAKING） | 查消费方后迁移或注释留档（s0601） |
| M4 | SettingSchemaItem 双处定义 | 后端 `settingSchemaService.ts:68` + 前端 `api/modules/settings.ts:23-36`；`public/schema/settings.ts` 不存在 | s0601 新建 public 契约双端引用 |
| M5 | 分页 clamp 逻辑 5+ 处重复 | userCenter.ts:1197-1204 有局部 helper，但 users.ts:207-208、store-gm.ts:112-113、auditLogService.ts:176、meSecurity.ts 各自内联重写 | 提炼共享 `parsePagination` util |
| M6 | @deprecated 逾期字段未删 | `core/auth/jwt.ts:32-33` JwtPayload.role 标注 v4.18.0 删除（现 4.32.4）；同型 users.ts:55、routes-registry.ts:148、userService.ts:79 | 留痕后删除或修订注释承诺 |
| M7 | FormSkeleton/TabSkeleton 死代码 | `components/ui/FormSkeleton.tsx`、`TabSkeleton.tsx` 仅被 ui/index.ts:16-17 barrel 导出，无页面 import | 删除 |
| M8 | update-help.js 孤儿脚本 | 根目录 528B 不完整一次性 codemod 片段，全仓零引用 | 删除 |
| M9 | dev.sh/serve.sh 遗产脚本 | 仅被 docs/archive/deployment-experience.md 引用；与 systemd 双轨（rules-0 §3.1.2） | 归档至 docs/archive |
| M10 | .pids/ 陈旧 PID 文件 | `.pids/{panel,daemon,frontend}.pid`（serve.sh 时代残留） | 清理 |
| M11 | docs/plans 14 篇 frontmatter status 失配 | 抽查坐实：instance-startup-guide-and-action-bar-plan(draft→已上线)、admin-frontend-risk-remediation-plan(draft→B1-B9 已执行)、player-binding-instance-scope-migration-plan(pending→已闭合)、quota-simplification-plan(draft→已上线)、instance-billing-implementation-plan(draft→Wave 0/1 已闭合) | 批量校正 status |
| M12 | .trae/documents 历史积存 | 2.3MB / 73 顶层条目；18 个 test_reports/frontend_gate_*（7月3-29日） | test_reports 按月归档，历史方案移 docs/archive |
| M13 | D9 `!uptime` 未接真实 uptime | 后端 inGameCommandService.ts:393 用 servers.created_at 估算；Daemon 已具备真实字段（manager.ts:48,192 InstanceSummaryWithUptime） | Panel 改调 daemonClient 真实 uptime，消除 TODO |
| M14 | StartupGuideWizard 前端零单测 | 组件存在 src/components/StartupGuideWizard.tsx，28 个 test 文件无对应测试（后端已有 startupGuideService.test.ts） | 补前端单测 |

## 三、低优先级（17 项，本批顺带或登记）

| # | 类型 | 证据/说明 | 动作 |
|---|------|-----------|------|
| L1 | daemon implicit any ×4 | modScanner.ts:90,107（随 H1 装回 @types/yauzl 后复验） | 随 H1 验证 |
| L2 | mock-pgrep.ts 孤立 | daemon/src/test/mock-pgrep.ts 零引用 | 删除 |
| L3 | `!uptime` TODO 注释 ×3 | inGameCommandService.ts:11,374,391 | 随 M13 消除 |
| L4 | quotaService 注释代码块 12 行 | :260-271 v4.29.13 DISABLED 决策留痕式保留 | 保留（合规） |
| L5 | preflight mock 缺失 | public/pre_generated_mock/ 11 文件无 preflight；global_mock/ 空目录 | 按 rules-3 §四补 mock |
| L6 | 日期格式化重复 ×6 | playerService.ts:645,672、chatService.ts:373、my.ts:168、store-gm.ts:310,400 `toISOString().slice(0,10)` | 提炼 `utcDateKey()` |
| L7 | errors.ts 陈旧注释 | :251 默认消息引用 game_type 语义；:383 域注释提及已删表 user_instance_bindings | 文本修正 |
| L8 | store_shop_config.ts 命名 snake_case | 与同目录 camelCase 惯例不一致 | 登记（改名影响面大，不动） |
| L9 | 路由测试比 10% | api/routes 60 源文件仅 6 测试；middleware/daemonClient/websocket 零测试 | 登记排期 |
| L10 | B6 ServerDetail 完整拆分 | ServerDetail.tsx 1478 行巨型组件（推迟自 v4.26.0） | 本批做核心拆分 |
| L11 | B5 VirtualList 虚拟滚动 | 仅 VirtualTable.tsx（@tanstack/react-virtual）被 AuditLogs 一处使用；note 误记为 react-window | 推广 + note 修正 |
| L12 | D7 Pack variant_type 展示 | 前端 src grep variant 零匹配；terraria-tshock/pack.yaml:18 有 variant: tshock | 最小落地（列表/详情展示） |
| L13 | D8 Friends 推荐 | Friends.tsx:367-372 占位「推荐功能暂未开放」，无后端接口 | 最小落地（同实例玩家推荐） |
| L14 | backup/ logs/ 空目录 | 均空，backup/ 今日被触碰 | 登记用途保留 |
| L15 | .npmrc root 属主 | -rw-rw-r-- root root | chown airxw |
| L16 | DST token 占位 | manager.ts:299 klei_cluster_token '__REPLACE_WITH_YOUR_KLEI_TOKEN__' | 登记（功能性占位） |
| L17 | current-note 过时记录 ×4 | SetupWizard 29 失败（实测全过）、startup_guide 12 缺失（实测 9/9 全有）、VirtualList 技术栈误记、defect:query 缺失（已补齐） | 收尾时统一修正 |

## 四、误报排除（扫描中验证为无债）

- daemon adapter TS 错误（writeDstClusterFiles 等）已不存在——v4.30.2 后改由 manager.ts:292-307 内联 generic 处理，current-note 记录过时
- backupService/routes/backups.ts 非孤岛（services-init/routes-registry/scheduler-init 均引用）
- routes/demo.ts 合法（双重闸门，已注册）
- userCenterRequest 无后端残留；前端 api/userCenter.ts 被 InstanceEconomyConfig 实际使用
- 前端生产代码 console.log 零匹配（唯一命中在注释示例）
- pages/ 56 个 tsx 均有路由/测试引用
- scripts/ 10 文件全部有入口；defect:query 已存在于 package.json:15
- modules/ 模块0-3 均有实质内容
- 版本源五处全部对齐 4.32.4，无漂移
- initPreflightService.test.ts 存在
- formValidation.test.ts 残留引用已清理
- 后端 FIXME/HACK 零匹配；前端 TODO/FIXME/HACK 零匹配
- dist 无 localhost:3000 / 127.0.0.1:3000 违规
- 后端单测 576/576 PASS；前端 305/306（唯一失败即 H5）

## 五、汇总统计

| 优先级 | 数量 | 说明 |
|--------|------|------|
| 高 | 7 | 闸门失效类（typecheck/单测红/E2E 盲区/无 VCS/孤岛/资金无测试） |
| 中 | 14 | 契约漂移、死代码、重复实现、文档失配、可低成本闭合的推迟项 |
| 低 | 17 | 注释、命名、登记项、大工程推迟项（B6/D8 等） |
| 误报排除 | 15 | 已验证无债 |
| **合计** | **38** | |

## 六、治理入口

- 治理方案：`docs/plans/tech-debt-remediation-plan.md`（多方案论证 + 分批执行）
- 涉及 public/ 契约的 M2/M3/M4/L5 走 s0601 适配流程（影响面分析 + CHANGELOG），人类已整体授权
- 大工程项 L10/L13 在方案中界定最小可行落地边界
