---
plan: admin-servers-aesthetics-mobile-overhaul
version: v1
status: pending-approval
created: 2026-07-30
target_release: 4.38.0
source_research:
  - docs/frontend/pages/admin-servers.md
  - docs/frontend/pages/admin-server-detail.md
human_decisions:
  D1_scope: 全站样式体系重构（人类裁决 2026-07-30）
  D2_mobile_tab: 底部 ActionSheet 选择器（人类裁决 2026-07-30）
  D3_terminal: 改浅色终端（人类裁决 2026-07-30）
  D4_radius: 圆角迁移到新值 6/10/16，接受全站圆角视觉变化（GN-004 SOFT_BLOCK B5 人类裁决 2026-07-30）
---

# 实例管理系列页面 · 美学与移动端兼容性深入优化方案

## 0. 背景与输入

调研产出：[admin-servers.md](../frontend/pages/admin-servers.md)（诊断 D1-D8）、[admin-server-detail.md](../frontend/pages/admin-server-detail.md)（诊断 E1-E6）。
三项方向性决策已获人类裁决（见 frontmatter）：全站重构 / ActionSheet / 浅色终端。

**版本判定**：引入设计 token 体系 + 新组件 TabSheetPicker + 终端主题改造，属全新功能量级 → 目标版本 **4.38.0**（中版本，待人类确认）。

**前置依赖**：current-note 记录的 info-card 布局拆分（info-card-2col + info-card-ops 分区）已本地闭合，本方案在其结构上叠加，不得回退该拆分。

## 1. 设计 Token 规范（唯一真相源）

在 `styles.css` `:root` 层建立/补齐以下变量，全部样式引用变量，消灭裸 hex 与魔法数：

| Token 组 | 内容 |
|---|---|
| 颜色 | `--color-primary/-bg`、`--color-surface`、`--color-bg-secondary`、`--color-border/-subtle`、`--color-text/-muted`、`--color-success/-bg/-text`、`--color-warning/-bg/-text`、`--color-danger/-bg/-text`、`--color-info/-bg/-text`（Apple 浅色系） |
| 圆角 | `--radius-sm:6px`、`--radius:10px`、`--radius-lg:16px`、`--radius-pill:999px` |
| 间距 | `--space-1:4px … --space-6:24px`（4 基数） |
| 触控 | `--touch-target:44px`（Apple HIG） |
| 断点 | **收敛为 3 档**：`640px`（小手机）、`768px`（移动/桌面分界）、`1024px`（平板）。CSS 变量不能用于媒体查询，以注释约定 + 全文件归并执行 |
| 终端（浅色） | `--terminal-bg:#f6f8fa`、`--terminal-text:#1f2328`、`--terminal-muted:#656d76`、`--terminal-accent:#1a7f37`、`--terminal-error:#cf222e`、`--terminal-border:#d1d9e0` |

## 2. 波次拆分（渐进式，同文件串行）

| 波次 | 内容 | 闭合判据 |
|---|---|---|
| W0 基线 | 记录 git 基线点 + 前端 tsc/vitest 基线结果 | 基线日志落盘 |
| W1 Token 地基 | `:root` **新增**缺失变量（不动现有变量数值，圆角维持 10/12/20 暂存）+ 断点注释约定；**零行为变化** | build PASS + 抽测无视觉差异 |
| W2 颜色圆角收编 | styles.css 裸 hex → var（分 3-4 小批按区块）；表头去 uppercase/letter-spacing（中文场景）；**圆角数值迁移小批**：`--radius-sm 10→6 / --radius 12→10 / --radius-lg 20→16`（D4 裁决，全站圆角变小，波及所有引用 `--radius*` 的组件） | grep 裸 hex 计数大幅下降 + build PASS + 圆角迁移后浏览器抽测（列表/详情/弹窗/终端） |
| W3 断点收敛 | 480/520/600 → 邻近归并 640；900 → 768 或 1024；逐段核对 | 媒体查询断点仅剩 640/768/1024 + 抽测 |
| W4 触控与 hover | btn/btn-sm/tab-btn/checkbox ≥44px 热区；`.row-actions` 在 `@media (hover:none)` 常显 | 375px 推断核对 + 单测 PASS |
| W5 列表页收编 | quota-bar inline → 类（进度条 flex:1 自适应）；batch-bar 移动端复用 batch-toolbar 底部固定模式；排序图标/工具栏类化 | Servers.tsx 零 inline style（动态色除外）+ 浏览器核对 |
| W6 详情页收编 | 节点行 node_id → node_name（ServerSummary 已有该字段，fallback node_id）；续费/磁盘/子目录 inline → 类；头部操作区移动端收敛为「主操作 + ··· 菜单」 | ServerDetailCore.tsx inline 清零 + 双视图（admin/store）核对 |
| W7 浅色终端 | `.terminal` 切浅色 token；高度 `min(360px, 50dvh)`；stderr/时间戳/空态配色适配 | 控制台浏览器核对（日志可读性） |
| W8 ActionSheet | 新建 `components/ui/TabSheetPicker.tsx`（当前 tab 按钮 + 分组底部 sheet，含角色过滤后的 visibleTabs 全量）；ServerDetailCore 移动端接入替换打平横滑条；**E6 裁决：保留 useSwipe 绑定整个 tab 内容区**——理由：滑动切 tab 是快捷手势的补充入口，与 ActionSheet 主入口不冲突；`|dx|>|dy|` 守卫已过滤纵向滚动，收窄绑定到 tab 条会与 sheet 触发区域重叠反而增加误触；阈值 50px 维持；≥6 单测（含 keep-alive 的 activatedTabs 行为） | 单测 PASS + 组件被 ServerDetailCore 引用（运行时接入判据） |
| W9 验证与版本 | s0402 三重闸门；版本 12 源 → 4.38.0 + BUILD；version.md/README/docs/日志更新 | 见 §4 |

## 3. Subagent 调度台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---|---|---|---|---|---|---|---|
| W0-W8 | — | 主线程（非subagent） | 各波次代码改动 | 主线程（非subagent） | 本文件 | 上一闭合波次 | 待启动 |
| W9-T2 浏览器核对 | — | general_purpose_task（browser_use 能力） | 核对报告（列表/详情/控制台/移动推断 + 抽测 2 页） | 待回填（启动后填入真实拉起ID） | .trae/documents/test_reports/ | W8 闭合点 | 待启动 |
| W9-GN004 交付前审查 | — | general_purpose_task（审查 rubric，仅审查不写码） | 审查结论（通过/警示/阻断） | 待回填（启动后填入真实拉起ID） | .trae/documents/ | W9 验证前 | 待启动 |

> 同文件（styles.css）串行编辑约束：W1-W7 不可并行，均由主线程内联执行。

## 4. 验证方案（s0402 三重闸门，顺序固定）

1. **Test1 单测/编译**：前端 `tsc --noEmit` exit 0；vitest 全量 PASS（含 TabSheetPicker 新增 ≥6 用例）；`vite build` PASS；dist 无 `localhost:3000`/`127.0.0.1:3000`（0.md 最高规则）
2. **Test2 内置浏览器核对**（口径统一：W1-W7 波次内核对 = 本地 build + 静态证据 + 本机 dev server 内置浏览器核对（vite 5173 仅本机开发用途，符合 0.md 开发模式例外）；W9 交付级 Test2 = 部署后生产 https://gsp.ecsrz.com:3001 核对）：列表页/详情页/控制台浅色终端/抽测 2 个其他页面（回归波及）；移动端项以 CSS 推断 + 375×812 待真机复核标注
3. **Test3 Mock 回归**：纯样式/组件改动不触及 Mock 路径，按 checklist 逐项说明
4. **运行时接入校验**（rules-0 §四-13）：TabSheetPicker 被 ServerDetailCore import；样式为全局层无需注册，以 build + 浏览器截图为接入证据
5. **版本升级**：12 版本源统一 + BUILD_ID + version.md 详述 + README 更新 + docs/frontend 日志收尾

## 5. 风险与回退

- [RISK] W2/W3 全站波及：任何区块视觉回归 → 回退该小批（git 细粒度 commit/暂存边界），不影响已闭合波次
- [RISK] ServerDetailCore 双视图复用（admin/store）：W6/W8 改动需双视图核对
- [RISK] tab keep-alive 与 ActionSheet 切换：activatedTabs 行为需单测覆盖
- [RISK] 浅色终端日志可读性（彩色日志流降级为单色）：以浏览器核对为准，必要时微调 token
- 回退锚点：W0 基线点 + 每波次闭合点

## 6. 明确不做（防范围蔓延）

- 不改 guild-portal.css 的选择器（仅享受 `:root` 变量红利）；玩家门户专项优化另立方案
- 不改任何后端/API/契约
- 不引入 CSS-in-JS/新构建工具；维持单文件 styles.css（拆文件另立方案）
- 不做暗色模式（dark mode 另立方案）

## 7. 已知未闭合项（交付时如实声明，不视为阻断）

- **375×812 真机/设备模拟复核**（调研 D8）：内置浏览器工具无法缩放视口，移动端结论以 CSS 推断 + 单测 + dev server 核对为准；交付后需真机复核卡片布局/横滑/溢出/ActionSheet 交互，发现问题走缺陷流程
