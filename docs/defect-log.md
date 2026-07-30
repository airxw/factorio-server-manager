# 缺陷隐患库

> 本文件由 `npm run defect:record` / `npm run defect:sync` 维护。
> 
> 录入规则：
> - 新条目统一以 `### DEF-xxx: 标题` 开头
> - `等级` 仅允许 `P0致命 / P1严重 / P2一般`
> - `类别` 仅允许 `deploy / code / fullstack / config / security`
> - `P0/P1` 条目必须补齐 `转化状态=已转化` 与 `转化产物`

### DEF-001: 根脚本直接调用 tsx 导致隐患库流程失效

| 字段 | 值 |
|------|-----|
| ID | DEF-001 |
| 等级 | P2一般 |
| 类别 | config |
| 首次发生版本 | 4.32.2 |
| 现象 | 根 package.json 中的缺陷库脚本使用 tsx 直调，在当前环境中执行 npm run defect:query / defect:sync 报 sh: 1: tsx: not found |
| 根因 | 根工作区未保证 tsx 二进制可直接解析到 PATH，流程设计停留在说明文档，缺少真实脚本接线验证 |
| 解决方案 | 将根目录脚本统一改为 npx tsx，并补齐 defect:query / defect:record / defect:sync 三个入口脚本 |
| 预防措施 | 根级 TypeScript 工具脚本统一使用 npx tsx，并在接入后立即执行一次 query/sync 冒烟验证 |
| 转化状态 | 已转化 |
| 转化产物 | 根 package.json defect:query/record/sync 三脚本均为 npx tsx 前缀；2026-07-31 defect:query/defect:record 冒烟执行成功 |

### DEF-002: 前端构建链路耦合导致本地编译过慢

| 字段 | 值 |
|------|-----|
| ID | DEF-002 |
| 等级 | P2一般 |
| 类别 | config |
| 首次发生版本 | 4.32.2 |
| 现象 | panel/frontend 的 build 串行执行 tsc、vite build、verify，并额外把 ../../public/**/*.ts 全量纳入前端类型检查，导致每次本地重新编译都要走完整类型图和全目录校验 |
| 根因 | 发布门禁与本地构建复用了同一入口，且前端 tsconfig 将大量与运行时无关的 public 测试/Mock 资产纳入类型检查，分析插件默认常驻 build 链路 |
| 解决方案 | 将日常 build 拆为纯 vite build，新增 build:release 承担 typecheck+build+verify；把 visualizer 改为 ANALYZE=1 才注入；将前端 tsconfig 检查范围收窄到 public/schema 并开启 incremental cache；部署脚本改走 build:release |
| 预防措施 | 保持本地 build 与发布 build 分离，新增共享资产时优先放入独立 typecheck 配置或专用检查入口，不把测试资产直接挂入前端主 tsconfig |
| 转化状态 | 已转化 |
| 转化产物 | panel/frontend build 已拆为纯 vite build，build:release=typecheck+build+verify；vite.config ANALYZE=1 才注入 visualizer；tsconfig include 收窄至 src+public/schema 且 incremental=true；deploy.sh 用 build+verify（v4.33.0 决策，typecheck 由本地与测试门禁承担）——2026-07-31 核实 |

### DEF-003: 公开文档页 /docs/* 已挂入口但未注册路由，点击后进入 404

| 字段 | 值 |
|------|-----|
| ID | DEF-003 |
| 等级 | P2一般 |
| 类别 | code |
| 首次发生版本 | 待补 |
| 现象 | 公开文档页 /docs/* 已挂入口但未注册路由，点击后进入 404 |
| 根因 | Docs 页面先渲染营销卡片与 FAQ 链接，但 App.tsx 仅注册了 /docs 单页，缺少对二级文档 URL 的真实页面与路由接线 |
| 解决方案 | 补齐 /docs/config /docs/packs /docs/shop /docs/players /docs/reports /docs/daemon 六个页面与公开路由，并为文档首页新增 Daemon 入口和路由单测 |
| 预防措施 | 新增公开入口链接时必须同步注册对应路由，路由合并后跑一轮全量链接点击核对 |
| 转化状态 | 已转化 |
| 转化产物 | App.tsx 已注册 /docs 及 6 个子路由（346-352 行），DocsConfig/DocsPacks/DocsShop/DocsPlayers/DocsReports/DocsDaemon 页面齐备——2026-07-31 核实 |

### DEF-004: ui barrel 回环导致前端 circular chunk warning

| 字段 | 值 |
|------|-----|
| ID | DEF-004 |
| 等级 | P2一般 |
| 类别 | code |
| 首次发生版本 | 4.32.3 |
| 现象 | 前端构建时出现 useDestructiveAction 经由 src/components/ui/index.ts 再回到 hooks 的 circular chunk warning，涉及 /admin/packs、/admin/cleanup、/admin/maintenance、/admin/ssl 等 chunk，存在执行顺序不稳定风险 |
| 根因 | hooks/useDestructiveAction.ts 从 components/ui barrel 导入 useToast，而 ui/index.ts 又反向导出 useDestructiveAction，形成 barrel 级循环依赖，Rollup 在拆分 chunk 时发出 circular dependency warning |
| 解决方案 | 将 useDestructiveAction 内部的 useToast 依赖改为直接引用 ToastContext，不再从 components/ui barrel 回跳；补充 hook 单测，并用内置浏览器验证受影响路由 chunk 可正常加载 |
| 预防措施 | hooks 与基础 context 禁止反向依赖 UI barrel；需要复用上下文能力时直接从 context 模块导入，避免 hook <-> barrel 回环 |
| 转化状态 | 已转化 |
| 转化产物 | useDestructiveAction.ts 已改为直接引用 context/ConfirmContext 与 context/ToastContext（15-17 行），不再经 components/ui barrel 回跳——2026-07-31 核实 |

### DEF-005: deploy.sh 更新时复制开发 .env 覆盖生产配置，导致 DATABASE_URL/IN

| 字段 | 值 |
|------|-----|
| ID | DEF-005 |
| 等级 | P1严重 |
| 类别 | deploy |
| 首次发生版本 | 待补 |
| 现象 | deploy.sh 更新时复制开发 .env 覆盖生产配置，导致 DATABASE_URL/INSTANCES_DIR 等生产路径被本地开发配置污染 |
| 根因 | deploy.sh 的 rsync/cp 直接复制 panel/daemon 目录，未排除 .env；随后 setup_env/check_env 因文件已存在而跳过正确生产值生成 |
| 解决方案 | copy_project 改为排除 panel/backend/.env 与 daemon/.env，保留生产环境现有 .env 不被开发副本覆盖 |
| 预防措施 | deploy.sh 的 copy/rsync 必须显式排除 .env 与 data/ 目录，新增同步路径时同步复核 exclude 清单 |
| 转化状态 | 已转化 |
| 转化产物 | deploy.sh copy_project 已加 --exclude='backend/data/' --exclude='backend/.env' 与 --exclude='.env'（163-164 行），生产 .env 不再被开发副本覆盖——2026-07-31 核实 |

### DEF-006: migration 20260823000000_add_link_key_expires_at

| 字段 | 值 |
|------|-----|
| ID | DEF-006 |
| 等级 | P1严重 |
| 类别 | code |
| 首次发生版本 | 待补 |
| 现象 | migration 20260823000000_add_link_key_expires_at_to_nodes 在旧库上重复加列，Panel 启动时因 duplicate column name 失败 |
| 根因 | 迁移直接 alterTable add column，未对历史库或手工补列场景做 hasColumn 防护，导致切换到旧数据库路径时启动迁移崩溃 |
| 解决方案 | 为 20260823000000 迁移增加 hasColumn 幂等检查；列已存在时仅做 pending 节点回填并跳过 add column/down 重复删除 |
| 预防措施 | 所有 ALTER TABLE 加列迁移必须先 hasColumn 防护，兼容历史库与手工补列场景 |
| 转化状态 | 已转化 |
| 转化产物 | 20260823000000_add_link_key_expires_at_to_nodes 迁移 up/down 均已加 hasColumn 幂等检查（23/46 行），重复执行不再崩溃——2026-07-31 核实 |

### DEF-007: backups 表名漂移导致备份健康检查失效

| 字段 | 值 |
|------|-----|
| ID | DEF-007 |
| 等级 | P2一般 |
| 类别 | code |
| 首次发生版本 | 待补 |
| 现象 | ALERT_BACKUP_HEALTH_CHECK 定时任务与 operationsService 备份健康度查询引用不存在的 backups 表（实际为 backup_records），每日调度持续报 SQLITE_ERROR: no such table: backups，备份健康检查功能永远失效 |
| 根因 | 调度器与运维服务按早期规划的 backups 表名编写查询，实际落库表名为 backup_records（baseline 迁移 20260808000000），两侧命名漂移且该路径无测试覆盖 |
| 解决方案 | scheduler-init.ts 与 operationsService.ts 两处 db('backups') 统一修正为 db('backup_records')，字段完全兼容无需迁移；后端 tsc 0 错误 + vitest 705/705 PASS |
| 预防措施 | 新增表查询时先核对 baseline schema 实际表名；调度任务连续报错应上升为可见告警而非每日静默 warn |
| 转化状态 | 已转化 |
| 转化产物 | scheduler-init.ts:546 + operationsService.ts:386 已改 db('backup_records')；后端 tsc 0 错误 + vitest 705/705 PASS（2026-07-31） |

### DEF-008: fresh install 时 Panel 启动失败：migration 20260730000

| 字段 | 值 |
|------|-----|
| ID | DEF-008 |
| 等级 | P1严重 |
| 类别 | code |
| 首次发生版本 | v4.36.0（migration 文件随 749c572 入库） |
| 现象 | fresh install 时 Panel 启动失败：migration 20260730000006_adjust_pricing_divide_100 报 SQLITE_ERROR: no such table: instance_type_pricing |
| 根因 | 该迁移文件名时序（20260730）先于建表迁移 20260830000002（20260830），fresh install 按名序先执行 UPDATE 时表尚不存在；迁移缺 hasTable 防护（与 DEF-006 同类），且 fresh install 路径自 v4.35.4 起无测试覆盖 |
| 解决方案 | 20260730000006 迁移 up/down 增加 hasTable 幂等防护——fresh install 跳过（后续 seed 迁移 20260830000005 插入的已是调整后新值），存量库行为不变 |
| 预防措施 | 所有直接 UPDATE/DELETE 业务表的迁移必须先 hasTable 防护；fresh install 全链路（空库按文件名序执行全部迁移）已有回归测试覆盖，新增迁移若缺防护会被测试拦截 |
| 转化状态 | 已转化 |
| 转化产物 | test:panel/backend/src/db/__tests__/fresh-install-migrations.test.ts（4 用例：空库全链路按序执行 29 迁移不抛错 + seed 调整后定价断言 + 20260730000006 无表跳过 + 存量库 up/down 行为不变）——2026-07-31 验证 4/4 PASS |
