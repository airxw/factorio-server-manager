# Test3 Mock 回归 Checklist
# 项目: gsp gameserver-panel (React + Vite + Vitest)
# 执行时间: 2026-07-29 00:10 (approx)
# 变更范围: panel/frontend/src/pages/ServerDetail.tsx (tab 渲染层) + panel/frontend/src/styles.css (.tab-groups 样式)

## Mock 模式入口检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| VITE_MOCK 环境变量 | 不存在 | 前端无运行时 Mock 模式开关 |
| useMock / enableMock 代码路径 | 不存在 | 无 Mock 交互路径 |
| global_mock 目录引用 | 不存在 | 前端不消费 public/global_mock/ |
| pre_generated_mock 目录引用 | 不存在 | 前端不消费 public/pre_generated_mock/ |
| vite.config.ts mock 插件 | 不存在 | 未使用 vite-plugin-mock 等 |

## 结论: Mock 回归入口缺失

前端 (panel/frontend) 无独立运行时 Mock 模式：
- 数据流: 前端通过 vite.config.ts proxy (开发) 或同源 /api (生产) 调真实后端
- 测试 Mock: 单元测试 (vitest + jsdom) 内部 Mock API，但无独立 Mock 运行模式
- 本次改动不涉及 Mock 路径: tab 渲染层 (groupedTabs/GROUP_LABELS) 数据流来自 visibleTabs (真实后端数据)，未触碰任何 Mock 交互路径

## 风险评估

| 风险项 | 评估 | 依据 |
|--------|------|------|
| 改动是否影响 Mock 数据消费 | 无 | 改动仅在渲染层 (JSX) + 样式 (CSS)，数据流 (groupedTabs useMemo) 不变 |
| 改动是否影响 Mock 交互路径 | 无 | 移除的 expandedGroups/toggleGroup 是纯 UI 状态，不涉及 Mock 数据 |
| Mock 模式下 tab 渲染是否会异常 | 不会 | groupedTabs 数据结构未变，渲染逻辑仅从折叠卡片改为横向 inline |

## 替代验证

由于前端无 Mock 模式，Test3 Mock 回归无法执行。替代证据:
1. Test1 单测 PASS (4/4): 覆盖 ServerDetail 渲染逻辑
2. 浏览器视觉验证 PASS: 真实后端数据下 tab 布局渲染正确
3. TypeScript 检查 PASS: 无类型错误
4. Vite build PASS: 产物正常

## 状态: 入口缺失 (前端无 Mock 模式)

按 s0402 规则，Mock 回归入口缺失不视为"自动通过"。本次改动不涉及 Mock 路径，风险评估为低，但 Test3 客观状态为"入口缺失"。
