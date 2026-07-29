# Home.tsx 审计问题修复 Spec

## Why
首页 `Home.tsx` 经静态审查发现 1 个高危内存泄漏 Bug、3 个中危逻辑/数据缺陷、4 个低危代码质量问题。这些问题会导致组件卸载后事件监听器泄漏、渲染输出不稳定、版本信息前后矛盾。需一次性修复以提升首页稳定性与代码质量。

## What Changes
- 修复 `ParticleBackground` 中 `addEventListener` 注册匿名函数、`removeEventListener` 传入具名函数导致的内存泄漏
- 为 `ParticleBackground` 增加视口可见性检测，滚出视口时暂停 `requestAnimationFrame`，降低 CPU 占用
- 将 3 处渲染期内 `Math.random()` 调用迁移至 `useMemo` 缓存，消除重渲染时的视觉抖动
- 更新 `useVersion` 默认值与 fallback 从 `v2.11.1` → `v2.12.1`，与版本历程数据对齐
- 优化 `StatNumber` 在 `isVersion` 场景下跳过 `useCountUp` 动画，避免无效状态更新
- 将关键列表的 `key={i}` 索引键替换为稳定键（使用数据自然 id 或组合键）
- 修正版本历程描述文案 "从 v1.0 到 v2.12" → "从 v2.0 到 v2.12"，与实际时间线数据一致
- 验证 P4 聊天增强版本号（`CHAT_PHASES` 与 `VERSION_TIMELINE` 均为 `v2.8.0`，内部已一致，保留不动）

## Impact
- Affected specs: 无（本次仅修改前端单文件）
- Affected code: `frontend/src/pages/Home.tsx`（单文件，约 1290 行）
- 不涉及后端、数据库迁移、路由变更
- 不涉及 API 契约变更
- 版本号规则：本次属 bug 修复 + 微量优化，按规则自动递增小版本号（如 v2.12.1 → v2.12.2）

## ADDED Requirements

### Requirement: ParticleBackground 视口暂停
The system SHALL pause the particle animation `requestAnimationFrame` loop when the Hero section is not intersecting the viewport, and resume when it re-enters.

#### Scenario: Hero 滚出视口
- **WHEN** 用户向下滚动使 Hero 区完全离开视口
- **THEN** 粒子动画 `requestAnimationFrame` 停止调度
- **AND** CPU 占用回落至空闲水平

#### Scenario: Hero 重新进入视口
- **WHEN** 用户向上滚回 Hero 区
- **THEN** 粒子动画恢复调度

## MODIFIED Requirements

### Requirement: ParticleBackground 事件监听器生命周期
`ParticleBackground` 的 `useEffect` 清理函数 SHALL 移除与注册时完全相同的函数引用，确保组件卸载后 `resize` 与 `mousemove` 监听器被正确释放。

### Requirement: 渲染纯函数性
组件渲染输出 SHALL 不依赖 `Math.random()` 等非纯函数。随机值 SHALL 在 `useMemo` 中生成并缓存，依赖项为空数组，确保组件生命周期内输出稳定。

### Requirement: useVersion 默认值
`useVersion` 的初始 state 与 fetch 失败 fallback SHALL 为 `v2.12.1`，与 `VERSION_TIMELINE` 最新版本保持一致。

### Requirement: StatNumber 版本展示
当 `isVersion` 为 true 时，`StatNumber` SHALL 直接渲染 `value` 而不启动 `useCountUp` 动画循环，避免无效的 `setCount` 状态更新。

### Requirement: 列表 key 稳定性
对于有自然标识的数据（如 `STATS`、`PAIN_POINTS`、`FEATURE_TABS`、`COMPARISON_ROWS` 等），列表渲染 SHALL 使用数据的 `id`/`title`/`feature` 字段作为 key 而非数组索引。对于无自然标识的纯装饰性数组（如占位柱状图），保留索引键但加注注释。

### Requirement: 版本历程文案一致性
`VersionTimeline` 区段描述 SHALL 与 `VERSION_TIMELINE` 数据范围一致，不出现数据中不存在的版本号。
