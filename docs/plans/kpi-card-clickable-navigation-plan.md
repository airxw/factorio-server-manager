---
type: plan
title: /store 首页 KPI 卡片可点击跳转方案
date: 2026-07-29
status: draft
related:
  - panel/frontend/src/pages/store/components/WorkbenchUI.tsx
  - panel/frontend/src/pages/store/StoreHome.tsx
  - panel/frontend/src/pages/admin/OperationsDashboard.tsx
  - panel/frontend/src/pages/store/ReportsPlaytime.tsx
  - panel/frontend/src/pages/store/ReportsRevenue.tsx
  - docs/plans/store-ui-polish-plan.md
tags: [frontend, store, workbench, kpi-card, navigation, apple-style, a11y]
---

# /store 首页 KPI 卡片可点击跳转方案

> **背景**：用户反馈首页 4 张 KPI 卡片（我的实例 / 当前在线 / 今日收入 / 待处理）"不能穿透，操作起来反人类"——当前 `WorkbenchMetricCard` 是纯展示型 `<article>`，无 `onClick`、无 `to`，用户无法通过卡片直达对应业务页。
> **约束**：只输出执行步骤、开发事项与建议；不估工期、不排优先级。保持浅色 Apple 生产力风，不引入杀马特电竞配色。默认不改 API 契约与 KPI 数据。

---

## 0. 工程过程 / 交接状态 / 最终结果

### 工程过程
1. 用户在 Trae 浏览器检查器中选中首页 4 张 `article`（KPI 卡片），反馈"不能穿透，操作反人类"。
2. 通过 AskUserQuestion 与用户确认意图：希望卡片可点击跳转到对应功能页（非 overlay 阻挡、非 Trae 检查器标记问题）。
3. 定位组件本体：[WorkbenchUI.tsx#L120-L151](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/WorkbenchUI.tsx#L120-L151) `WorkbenchMetricCard`。
4. 盘点 4 张卡片在 [StoreHome.tsx#L362-L397](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx#L362-L397) 的使用与跳转目标映射。
5. 盘点 `WorkbenchMetricCard` 其他使用方（运营仪表盘 / 时长报表 / 流水报表），确认扩展需向后兼容。

### 交接状态
- 当前：方案 MD 已落盘，**未开始编码**。
- 权威文件：本路径 `docs/plans/kpi-card-clickable-navigation-plan.md`。
- 下一动作：人类确认 §3 跳转映射与 §5 执行步骤后进入开发。

### 最终结果（方案阶段）
- 产出：本 MD。
- 验证：IDE 可打开上述路径；方案覆盖组件扩展、跳转映射、a11y、影响面与不做什么。

---

## 1. 结论（先说清楚）

**问题本质**：KPI 卡片是 dashboard 的天然入口，用户期望"看数 → 点进去管"。当前组件没有任何交互能力，造成"看见却摸不到"的反人体感。

**定稿建议**：
1. 扩展 `WorkbenchMetricCard`，新增可选 `onClick?: () => void` 字段，**API 向后兼容**（不传则保持纯展示，避免影响运营/报表页等既有调用方）。
2. 在 StoreHome 中给 4 张卡片绑定跳转：
   - 我的实例 → `/store/servers`
   - 当前在线 → `/store/players`
   - 今日收入 → `/store/reports/revenue`
   - 待处理 → `/store/operations`
3. 可点击卡片整体响应（整张卡片是 button），加 hover 抬升 + 阴影加深 + focus-visible 蓝色 ring，保持 Apple 浅色克制；**不加箭头图标**（避免视觉噪点，hover 抬升已是足够暗示）。
4. a11y：可点击卡片 `role="button"` + `tabIndex={0}` + 键盘 Enter/Space 触发。
5. 不改 KPI 数据契约、不引入新依赖、不改父容器布局。

---

## 2. 现状盘点

### 2.1 组件本体（[WorkbenchUI.tsx#L120-L151](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/WorkbenchUI.tsx#L120-L151)）

```tsx
export function WorkbenchMetricCard({
  label, value, hint, icon: Icon, tone = 'slate', extra,
}: WorkbenchMetricCardProps) {
  // ...
  return (
    <article className="rounded-[24px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.35)]">
      {/* 纯展示，无 onClick / 无 to */}
    </article>
  );
}
```

- `<article>` 是语义化标签，但当前没有交互。
- 已有 `extra` 槽位（待处理卡片用了 chip），扩展时不能破坏。

### 2.2 使用方清单

| 文件 | 调用次数 | 是否需要跳转 |
|------|---------|--------------|
| [StoreHome.tsx#L362-L397](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx#L362-L397) | 4 | **是**（本方案目标） |
| [OperationsDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/OperationsDashboard.tsx) | 若干 | 暂不需要（后续可按需启用） |
| [ReportsPlaytime.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/ReportsPlaytime.tsx) | 若干 | 暂不需要 |
| [ReportsRevenue.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/ReportsRevenue.tsx) | 若干 | 暂不需要 |

→ 扩展必须**向后兼容**：未传 `onClick` 时表现与现状完全一致。

### 2.3 StoreHome 现有跳转能力
- 已 import `useNavigate`，且 `WorkbenchHeader` 的"创建实例"按钮、各 `WorkbenchSection` 的 `WorkbenchLinkAction` 都在用。
- 直接复用 `useNavigate`，无需新增依赖。

---

## 3. 跳转目标映射

| 卡片 label | 当前 value 来源 | 目标路由 | 路由存在性 | 跳转是否始终启用 |
|-----------|----------------|----------|------------|------------------|
| 我的实例 | `data.total_instances` | `/store/servers` | 已存在 | 是 |
| 当前在线 | `data.total_players_online` | `/store/players` | 已存在 | 是 |
| 今日收入 | `formatMoney(data.revenue_today)` | `/store/reports/revenue` | 已存在 | 是 |
| 待处理 | `alerts.length` | `/store/operations` | 已存在 | 是（运营仪表盘承载"待处理"上下文） |

> **设计取舍**：即使"待处理"为 0 也允许跳转（运营仪表盘本身值得作为常态入口），避免出现"有时可点有时不可点"的不一致体感。

---

## 4. 组件扩展设计

### 4.1 Props 扩展

```tsx
interface WorkbenchMetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  extra?: ReactNode;
  onClick?: () => void;  // 新增：可选，传入则卡片整体可点击
}
```

- 只加一个可选 `onClick`，不引入 `to?: string`（避免在 DS 组件里耦合路由库；调用方自己用 `useNavigate` 传 `() => navigate(...)`）。
- 未传 `onClick` → 渲染为 `<article>`，与现状完全一致。
- 传入 `onClick` → 渲染为 `<button type="button">`，整张卡片可点击。

### 4.2 渲染分支

```tsx
const baseClass = 'rounded-[24px] border border-slate-200/80 bg-white/90 p-5 text-left shadow-[0_18px_40px_-34px_rgba(15,23,42,0.35)]';
const interactiveClass = onClick
  ? 'cursor-pointer transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-30px_rgba(15,23,42,0.4)] hover:border-slate-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 active:translate-y-0'
  : '';

if (onClick) {
  return (
    <button type="button" onClick={onClick} className={cx(baseClass, interactiveClass, 'block w-full')}>
      {/* 原有内容 */}
    </button>
  );
}
return (
  <article className={cx(baseClass, interactiveClass)}>
    {/* 原有内容 */}
  </article>
);
```

**视觉细节**：
- `text-left` + `block w-full`：让 `<button>` 表现得像 `<article>`（按钮默认 inline 居中）。
- hover 抬升 `-translate-y-0.5`（2px）+ 阴影从 `-34px` 加深到 `-30px`，足够暗示但不浮夸。
- `focus-visible:ring-blue-300`：与 Workbench 主按钮一致。
- 不加箭头图标、不加 hover 时的渐变背景——保持 Apple 克制。

### 4.3 a11y
- `<button>` 原生具备键盘可达性与 Enter/Space 触发，无需额外 `role`/`tabIndex`。
- `aria-label` 可选：默认按钮内文本（label + value）已被屏幕阅读器读出，不强制加。

---

## 5. 执行步骤

### 步骤 1：扩展 `WorkbenchMetricCard`
- 文件：[WorkbenchUI.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/WorkbenchUI.tsx)
- 改动范围：L111-L151（接口 + 组件实现）
- 验证：未传 `onClick` 时输出 `<article>`、传入时输出 `<button>`；TypeScript 编译通过。

### 步骤 2：在 StoreHome 绑定跳转
- 文件：[StoreHome.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx) L362-L397
- 改动：
  - 我的实例 → `onClick={() => navigate('/store/servers')}`
  - 当前在线 → `onClick={() => navigate('/store/players')}`
  - 今日收入 → `onClick={() => navigate('/store/reports/revenue')}`
  - 待处理 → `onClick={() => navigate('/store/operations')}`
- 验证：4 张卡片可点击跳转，跳转目标路由存在且可访问。

### 步骤 3：回归验证
- 浏览器手动验证：
  - 首页 4 张卡片 hover 有抬升 + 阴影加深。
  - 点击分别跳到 4 个目标路由。
  - 键盘 Tab 可聚焦，Enter/Space 可触发跳转。
  - focus-visible ring 蓝色显示。
- 既有调用方回归：
  - 运营仪表盘 / 时长报表 / 流水报表的 `WorkbenchMetricCard` 未传 `onClick`，仍渲染为 `<article>`，外观不变。
- 现有测试：
  - [Layout.test.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.test.tsx) 涉及"我的实例"文案，确认未被破坏。
- 视觉规则遵守：
  - 不引入深色 / 电竞配色。
  - 不在卡片上加箭头图标 / 渐变 / 装饰元素。

### 步骤 4：版本与文档
- 按 [bb.md](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/bb.md)：新增功能 → 中版本号 +1，小版本重置为 0。
- 更新 [version.md](file:///home/airxw/Documents/gsp/gameserver-panel/version.md)：登记本次功能与版本号。
- 评估是否更新 [README.md](file:///home/airxw/Documents/gsp/gameserver-panel/README.md)：非重大功能，默认不更新；若 README 有"首页功能"清单则补一行。

---

## 6. 不做的事（边界）

- 不改 KPI 数据契约（`InstanceAdminOverviewResponse` 等类型不动）。
- 不引入 `react-router-dom` 的 `Link` 进 DS 组件（保持 DS 与路由解耦，用 `onClick` 回调）。
- 不新增 `WorkbenchMetricLinkCard` 独立组件（避免 DS 膨胀，一个可选 prop 足够）。
- 不在卡片上加箭头图标 / hover 渐变 / 装饰元素（Apple 克制）。
- 不改其他使用方（运营/报表页）——它们当前不需要跳转，向后兼容即可。
- 不处理 Trae 浏览器检查器注入的 `trae-browser-inspect-draggable` class（那是 IDE 检查器标记，不进入生产构建）。
- 不改父容器 `grid` 布局。

---

## 7. 风险与注意点

| 风险 | 影响 | 缓解 |
|------|------|------|
| `<button>` 内嵌 `<div>` + `<p>` 嵌套合法但需注意 `text-left`/`w-full` | 视觉偏移 | §4.2 已显式设置 |
| `extra` 槽位内若有交互元素（如 chip 内按钮）会与卡片 button 形成嵌套 button | HTML 不合法 | 当前 StoreHome 的 extra 只是展示型 chip，无嵌套 button；后续若加交互需改用 `<article>` + 局部点击 |
| 用户期望"待处理=0 时不可点" | 体感不一致 | §3 已决定始终可点；如人类有不同意见可在确认时提出 |
| 既有测试快照可能因 `<article>` → `<button>` 失败 | 测试红 | 步骤 3 已纳入回归；如有快照测试需更新 |

---

## 8. 待人类确认项

1. **跳转映射**：§3 的 4 个目标路由是否正确？特别是"当前在线 → /store/players"与"待处理 → /store/operations"是否符合作业直觉？
2. **待处理=0 时是否仍可点击**：§3 建议始终可点，是否同意？
3. **视觉表达**：hover 抬升 + 阴影加深，不加箭头——是否符合期望？

确认后即可按 §5 进入开发。
