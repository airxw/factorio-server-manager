# 隐患转化检查清单

> 生成时间：2026-07-30 23:43:54
> 总条目：8（P0: 0 / P1: 3 / P2: 5）

## P0

- 暂无条目

## P1

### deploy

- ✅ `DEF-005` deploy.sh 更新时复制开发 .env 覆盖生产配置，导致 DATABASE_URL/IN
  - 转化状态：已转化
  - 转化产物：deploy.sh copy_project 已加 --exclude='backend/data/' --exclude='backend/.env' 与 --exclude='.env'（163-164 行），生产 .env 不再被开发副本覆盖——2026-07-31 核实

### code

- ✅ `DEF-006` migration 20260823000000_add_link_key_expires_at
  - 转化状态：已转化
  - 转化产物：20260823000000_add_link_key_expires_at_to_nodes 迁移 up/down 均已加 hasColumn 幂等检查（23/46 行），重复执行不再崩溃——2026-07-31 核实
- ✅ `DEF-008` fresh install 时 Panel 启动失败：migration 20260730000
  - 转化状态：已转化
  - 转化产物：test:panel/backend/src/db/__tests__/fresh-install-migrations.test.ts（4 用例：空库全链路按序执行 29 迁移不抛错 + seed 调整后定价断言 + 20260730000006 无表跳过 + 存量库 up/down 行为不变）——2026-07-31 验证 4/4 PASS

## P2

### code

- ✅ `DEF-003` 公开文档页 /docs/* 已挂入口但未注册路由，点击后进入 404
  - 转化状态：已转化
  - 转化产物：App.tsx 已注册 /docs 及 6 个子路由（346-352 行），DocsConfig/DocsPacks/DocsShop/DocsPlayers/DocsReports/DocsDaemon 页面齐备——2026-07-31 核实
- ✅ `DEF-004` ui barrel 回环导致前端 circular chunk warning
  - 转化状态：已转化
  - 转化产物：useDestructiveAction.ts 已改为直接引用 context/ConfirmContext 与 context/ToastContext（15-17 行），不再经 components/ui barrel 回跳——2026-07-31 核实
- ✅ `DEF-007` backups 表名漂移导致备份健康检查失效
  - 转化状态：已转化
  - 转化产物：scheduler-init.ts:546 + operationsService.ts:386 已改 db('backup_records')；后端 tsc 0 错误 + vitest 705/705 PASS（2026-07-31）

### config

- ✅ `DEF-001` 根脚本直接调用 tsx 导致隐患库流程失效
  - 转化状态：已转化
  - 转化产物：根 package.json defect:query/record/sync 三脚本均为 npx tsx 前缀；2026-07-31 defect:query/defect:record 冒烟执行成功
- ✅ `DEF-002` 前端构建链路耦合导致本地编译过慢
  - 转化状态：已转化
  - 转化产物：panel/frontend build 已拆为纯 vite build，build:release=typecheck+build+verify；vite.config ANALYZE=1 才注入 visualizer；tsconfig include 收窄至 src+public/schema 且 incremental=true；deploy.sh 用 build+verify（v4.33.0 决策，typecheck 由本地与测试门禁承担）——2026-07-31 核实
