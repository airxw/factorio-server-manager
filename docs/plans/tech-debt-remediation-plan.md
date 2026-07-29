---
status: approved-for-execution
created: 2026-07-29
source_scan: .trae/documents/tech-debt-scan-20260729.md
authorization: 人类 2026-07-29 裁决「方案审批后批量执行 + 方案论证后直接修，不要问我」（对全部 38 项债务的整体显式授权；public/ 契约变更走 s0601 分析流程）
---

# 技术债治理方案（2026-07-29）

> 输入：38 项债务（7 高 / 14 中 / 17 低），证据见 `.trae/documents/tech-debt-scan-20260729.md`。

## 一、多方案对抗与论证

### 方案 A（保守派）：只修闸门级，其余登记
- 范围：仅 H1/H2（daemon typecheck）+ H5（前端红测），其余 35 项登记排期。
- 优点：单批风险最小，当天可闭合。
- 缺点：债务本金不减，H3 孤岛/H4 资金无测试/H6 无 VCS/H7 E2E 盲区四个结构性风险全部保留；与「完成技术债全部落地」目标直接冲突。
- 判定：**否决**（不满足目标）。

### 方案 B（平衡派，推荐）：全量治理，按风险分批递进
- 范围：38 项全量。按「基线保护 → 速赢闸门 → 契约 → 提炼 → 孤岛 → 功能债 → 测试 → E2E → 文档 → 大重构 → 总验证」11 波推进，每波独立闭合判据 + 回退锚点。
- 大项界定最小可行落地：B6 ServerDetail 拆分只做「核心视图逻辑抽离 ServerDetailCore + Admin/Store 包装复用」不改行为；D8 Friends 推荐做「同实例已绑定玩家推荐」单接口 + 前端区块，不做算法推荐。
- 优点：一次闭环全部债务；每波可独立回退；VCS 基线先行使后续批量变更可审计。
- 缺点：批次多，需严格渐进式生成。
- 判定：**采纳**。

### 方案 C（激进派）：B + 架构级整改
- 范围：B + 重建 CI/CD、测试覆盖率提到 80%、路由测试比从 10% 提到 60%、L8 路由文件重命名。
- 优点：测试基建彻底补强。
- 缺点：超出「技术债落地」边界进入新基建建设；路由重命名等引入无收益 churn；违反最小必要原则。
- 判定：**否决**（过度工程；覆盖率目标改为登记到 pending-requirements）。

### 论证结论
**B 为最优解**：A 不达标、C 越界，B 在「全部落地」与「可控风险」间取得唯一可行平衡。关键机制：Wave 0 先建 git 基线（同时治愈 H6），使后续 10 波任意失败均可 `git checkout` 回退到波前锚点。

## 二、执行波次（Wave 0-10）

| Wave | 内容 | 债务项 | 闭合判据 |
|------|------|--------|----------|
| W0 | git init + 基线提交 | H6 | `git log` 有基线 commit；`.gitignore` 已覆盖 node_modules/dist/data |
| W1 | 速赢批：daemon `npm install` + tsconfig include 收窄；Servers.test fixture 补 `node_name`；删 FormSkeleton/TabSkeleton/parallelDownloader/mock-pgrep/update-help.js；dev.sh/serve.sh 归档 docs/archive；.pids 清理；.npmrc chown；errors.ts 陈旧注释修正 | H1/H2/L1/H5/M1/M7/M8/M9/M10/L15/L7 | daemon tsc 0 错误；前端 vitest 306/306；后端 vitest 576/576 不回退 |
| W2 | 契约批（s0601）：PendingWithdrawItem/ListPendingWithdrawsResponse 上推 panel-api-types.ts；新建 public/schema/settings.ts 统一 SettingSchemaItem 双端引用；VerifyBindingViaWebhookRequest.game_type→server_id 语义对齐（无运行时消费方）；preflight mock 生成；CHANGELOG 记录 | M2/M3/M4/L5 | 前后端 tsc 0 错误；本地定义已移除改引用 public；CHANGELOG 含 4 条记录 |
| W3 | 提炼批：新建 utils/pagination.ts（parsePagination）替换 5 处内联；新建 utils/date.ts（utcDateKey）替换 6 处 | M5/L6 | grep 旧内联模式 0 残留；后端单测不回退 |
| W4 | 孤岛治理：itemAttributeResolver 接入 give-item 命令渲染链（playerManagementService/commandDispatcher），resolveGiveCommandVars+stripHiddenPlaceholders 真实调用；JwtPayload.role 等 4 处 @deprecated 注释按实际语义修订（API key 流程仍依赖 payload.role，删除改修订） | H3/M6 | 运行时接入 grep 证据（非测试引用 ≥1）；后端单测不回退 |
| W5 | D9 `!uptime` 接真实 uptime：Panel inGameCommandService 改调 daemonClient InstanceSummaryWithUptime，移除 3 处 TODO | M13/L3 | !uptime 返回 daemon 真实 uptime；TODO 注释 0 残留 |
| W6 | 测试补齐：9 个资金服务核心路径单测（balance/withdraw/wallet/cdk/vip/shop/integral/points/pricing）；StartupGuideWizard 前端单测 | H4/M14 | 新增测试全绿；后端+前端 vitest 全绿 |
| W7 | E2E 首页 body empty 排查修复：定位 /admin /store /guild 首屏渲染根因（token 有效但 body empty，疑 Suspense/Provider/首屏数据） | H7 | 相关 spec 相关用例转绿或定位根因并修复 |
| W8 | 文档批：docs/plans 14 篇 status 校正；.trae/documents test_reports 按月归档；backup/logs 用途登记 | M11/M12/L14 | status 与实际一致；documents 顶层条目 <40 |
| W9 | 大项最小落地：B6 ServerDetail 抽离 ServerDetailCore；B5 VirtualList 推广到 Users/PlayerBindings 列表 + note 技术栈修正；D7 Pack variant 展示（Packs 列表/详情 variant 标签）；D8 Friends 同实例玩家推荐（后端接口+前端区块） | L10/L11/L12/L13 | 前端 tsc/build 通过；行为无回归（现有单测绿） |
| W10 | 总验证 + 版本 4.33.0（含 D7/D8 新功能→中版本）+ version.md/README/current-note 收尾（含 L17 过时记录修正 + L8/L9/L16 登记 pending-requirements） | L17/L8/L9/L16 | 三端 tsc 0 错误；前后端单测全绿；build 通过无违规地址；check:version 全绿 |

## 三、并行与回退

- 并行约束：单批 ≤2 subagent（rules-0 §四-4）。W6 两组测试补齐可并行；W8 文档批可与 W6 并行；其余主线程内联。
- 回退锚点：W0 git 基线 + 每波结束打 commit，单波失败 `git checkout .` 回该波起点。
- public/ 变更集中在 W2，一次 s0601 影响面分析覆盖 4 项，CHANGELOG 统一记录。

## 四、不做清单（防越界）
- 不重建 CI、不定覆盖率 KPI、不重命名 store_shop_config.ts（L8 登记）。
- B6 拆分不改任何页面行为/样式；D8 不做复杂推荐算法。
- quotaService 注释代码块（L4）保留——决策留痕式保留，合规。
