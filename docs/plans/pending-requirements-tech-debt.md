---
type: pending-requirement
title: 待开发需求登记 — 技术债治理延期项（L8 命名 / L9 测试比 / L16 DST token）
date: 2026-07-30
status: pending
related: docs/plans/tech-debt-remediation-plan.md, .trae/documents/tech-debt-scan-20260729.md
tags: [pending, tech-debt, naming, test-coverage, dst]
---

# 待开发需求登记 — 技术债治理延期项（L8 / L9 / L16）

## 一、需求来源

2026-07-29 技术债全量扫描（`.trae/documents/tech-debt-scan-20260729.md`，38 项）中，3 项低优先级债务经方案论证（`docs/plans/tech-debt-remediation-plan.md` §四 不做清单）裁决为「登记排期，不在本次治理范围内」，统一登记于此追踪。

## 二、延期项清单

### L8：store_shop_config.ts 命名 snake_case

- **现状**：`panel/backend/src/api/routes/store_shop_config.ts` 为 snake_case 命名，与同目录 camelCase 惯例不一致。
- **登记理由**：改名影响面大（路由注册、测试引用、部署 rsync 路径），改名本身无功能收益，违反最小必要原则。
- **接续入口**：若未来对该路由做结构性重构（如拆分/合并），顺手统一命名为 `storeShopConfig.ts`，需全仓 grep 引用同步。

### L9：路由测试比偏低（约 10%）

- **现状**：`panel/backend/src/api/routes/` 约 60 个源文件仅 6 个测试文件；middleware / daemonClient / websocket 层零测试。
- **登记理由**：补齐到合理比例属测试基建建设（超出「技术债落地」边界进入新基建，方案 C 已否决）；本次治理已补齐资金服务 9 文件核心路径单测（H4/M14）作为最高风险面覆盖。
- **接续入口**：建议按「路由风险分级」排期——先补鉴权/资金/实例生命周期路由契约测试，再向 middleware/daemonClient/websocket 扩展；不设覆盖率 KPI，以关键路径契约测试为准。

### L16：DST token 占位符

- **现状**：`daemon/src/instances/manager.ts` 附近 klei_cluster_token 为 `'__REPLACE_WITH_YOUR_KLEI_TOKEN__'` 占位。
- **登记理由**：功能性占位（Don't Starve Together 需要用户在 Klei 官网申请 cluster token 后填入），非缺陷；属用户侧配置动作。
- **接续入口**：若后续做 DST 实例向导，可在创建流程中引导用户填写 cluster token 并写入实例配置（类似 minecraft eula 引导）。

## 三、不阻断主路径声明

- 三项均为低优先级登记项，**不阻断**任何主路径开发与部署；
- 无任何运行时风险（L8 纯命名 / L9 测试覆盖 / L16 用户配置占位）；
- 可独立排期，无需依附特定版本。

## 四、交接状态

- **工程过程**：2026-07-29 扫描识别 → 方案论证裁决登记（方案 B 不做清单）→ 2026-07-30 W10 收尾时统一登记于本文件。
- **交接状态**：pending，等待独立排期。
- **最终结果**：本文件 `docs/plans/pending-requirements-tech-debt.md`，作为技术债治理的延期项追踪锚点。
