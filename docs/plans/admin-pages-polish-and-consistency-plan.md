---
type: plan
title: "/admin 页面完善方案与可行性分析（v2，已按审批意见修订）"
date: 2026-07-29
status: approved
revision: v2
related:
  - docs/reports/admin-pages-analysis-report.md
  - docs/plans/admin-frontend-risk-remediation-plan.md
  - panel/frontend/src/pages/admin/
  - panel/frontend/src/api/queries/admin.ts
  - panel/frontend/src/api/queries/servers.ts
  - panel/frontend/src/layouts/AdminLayout.tsx
tags: [admin, frontend, consistency, mobile, ux, tanstack-query, feasibility]
---

# `/admin` 页面完善方案与可行性分析（v2）

> 本方案基于 [admin-pages-analysis-report.md](../reports/admin-pages-analysis-report.md) 的 16 条发现编制，并已按审批评估意见修订。
> 核心约束：**渐进式、可回滚、避免全炸**——每批次独立可验证、独立可回滚，禁止一次性合流大改动。
> v2 修订要点：①决策点已裁决；②新增 B1.0 提炼 MobileCardList 共享组件；③B2.4-B2.6 由"新建降级 hook"改为"迁移到 TanStack Query"，避免重复造轮子；④取消阶段三，压缩为两阶段；⑤新增 B2.7 共享 KPI hook、B2.8 数据量监控告警。

---

## 一、方案目标与原则

### 1.1 目标

1. **一致性**：统一 27 个 admin 页面的角色门控风格、移动端适配等级、数据获取模式
2. **移动端体验**：补齐破坏性操作页面与多列表格页面的移动端卡片降级（基于共享组件）
3. **架构清晰**：消除 WithdrawApprovals 孤立风格；AdminDashboard 与 PlatformDashboard 保持门户+报表分层，仅共享数据获取 hook
4. **基础设施对齐**：将 AdminDashboard/PlatformDashboard/SystemHealth 的 `Promise.allSettled + useState` 手动管理迁移到 TanStack Query，消除"三套数据获取模式"债务
5. **零回归**：所有改动保留旧路径兼容期，破坏性操作保护机制（已到位）不破坏

### 1.2 五项原则

| 原则 | 含义 |
|------|------|
| 渐进式 | 每批次 ≤5 文件，测通一步走下一步（rules-0 §一-2） |
| 可回滚 | 每批次独立 git commit，失败时 `git revert` 单批回退 |
| 契约优先 | 涉及类型契约变更走 s0601，不直接编辑 `public/`（rules-0 §四-10） |
| 后端兜底 | 前端角色门控仅做 UX，后端必须有二次鉴权（与 B3 方案对齐） |
| 不破坏现有 | 已到位的破坏性操作保护、虚拟化表格、键盘可访问性等不改动；**不重复造轮子**，优先复用 TanStack Query 等已有基础设施 |

### 1.3 与现有方案的关系

| 现有方案 | 关系 | 说明 |
|----------|------|------|
| [admin-frontend-risk-remediation-plan.md](admin-frontend-risk-remediation-plan.md) | **互补 + 部分重叠** | 该方案聚焦安全/敏感数据/鉴权/契约漂移（200 条 RISK/TODO）；本方案聚焦一致性/移动端/降级/分页。重叠点：B4 window.confirm 统一、B5 列表分页、B8 Promise.all 单点失败。**建议合并执行**，本方案在重叠点引用 B 编号 |
| [user-batch-management-plan.md](user-batch-management-plan.md) | 已交付 | v4.24.0 已实现批量操作，本方案不重复 |
| [quota-simplification-plan.md](quota-simplification-plan.md) | 已交付 | v4.29.13 已禁用 max_instances/max_players_total，本方案不改动 |
| [nodes-instance-admin-access-plan.md](nodes-instance-admin-access-plan.md) | 已交付 | v4.28.0 已迁出 /admin 基座，本方案不改动 |
| TanStack Query（已引入） | **基础设施** | 项目已在 [servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/queries/servers.ts) / [admin.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/queries/admin.ts) 等 6 文件使用。本方案 B2.4-B2.7 将 AdminDashboard/PlatformDashboard/SystemHealth 迁移至此，**不新建 hook** |

---

## 二、可行性分析框架

### 2.1 评估维度

每个改进项按以下 4 维度评级：

| 维度 | 等级 | 判定标准 |
|------|------|----------|
| **影响范围** | S / M / L | S=单文件、M=2-5 文件、L=6+ 文件或跨层 |
| **风险等级** | 低 / 中 / 高 | 低=纯前端可回滚、中=需测试覆盖、高=涉及契约或破坏性 |
| **依赖关系** | 无 / 前端 / 跨层 | 无=独立改动、前端=仅前端协同、跨层=需后端配合 |
| **验证难度** | 易 / 中 / 难 | 易=单测+视觉、中=E2E、难=需多角色实测 |

### 2.2 「避免全炸」三道防线

1. **批次隔离**：每批次独立 commit，失败 `git revert` 不影响其他批次
2. **灰度验证**：每批次完成后在本地 + 预发环境验证，通过后再合流下一批
3. **回滚锚点**：每批次开始前打 git tag `pre-polish-batch-{N}`，回滚时 `git reset --hard` 到 tag

### 2.3 不做清单（明确排除）

以下事项**不在本方案范围**，避免范围蔓延：

- ❌ 节点部署功能开源（`NODE_DEPLOYMENT_ENABLED=false`，属独立功能线）
- ❌ 14 个废弃路由的重定向体验优化（已重定向到 `/instances?uiTab=`，低优先级）
- ❌ 后端 API 行为变更（本方案聚焦前端，后端仅必要时配合）
- ❌ 已到位的破坏性操作保护重构（`useDestructiveAction` 运行良好）
- ❌ 角色权限模型调整（三级权限体系稳定）
- ❌ **新建 `useAsyncAllSettled` 降级 hook**（v2 排除：与 TanStack Query 重复造轮子，改为迁移到 Query）
- ❌ **9 个全量加载页面统一分页改造**（v2 排除：YAGNI，8/9 页数据天然有限增长；仅做数据量监控告警 B2.8）
- ❌ **AdminDashboard / PlatformDashboard 合并或重新定位**（v2 排除：决策点 2 裁决为 X1 保持现状）

---

## 三、问题清单与可行性评级

> 来源：[分析报告第五节「关键发现与风险点」](../reports/admin-pages-analysis-report.md#五关键发现与风险点)

### 3.1 架构与一致性（4 项）

| 编号 | 问题 | 影响范围 | 风险 | 依赖 | 验证 | 可行性结论 |
|------|------|----------|------|------|------|------------|
| A1 | 角色门控不一致（12 显式 + 5 仅路由守卫 + 1 告警条 + 7 无门控） | M（5 文件补检查） | 低 | 前端 | 易 | ✅ 高可行，纯前端补 `Navigate to="/forbidden"` |
| A2 | WithdrawApprovals 风格孤立（`userCenterRequest` + 告警条） | M（1 文件改造 + 1 客户端方法） | 中 | 跨层 | 中 | ⚠️ 中可行，需后端 `/admin/withdraw/*` 路由确认走标准鉴权中间件 |
| A3 | AdminDashboard vs PlatformDashboard 功能重叠 | — | — | — | — | ⏸️ **已裁决不改动**（决策点 2 = X1），仅补 B2.7 共享 hook |
| A4 | 降级策略差异（4 种实现） | L（3 页面迁移到 TanStack Query） | 中 | 前端 | 中 | ✅ 高可行（v2 修正：迁移到 Query，非新建 hook） |

### 3.2 移动端体验（2 项）

| 编号 | 问题 | 影响范围 | 风险 | 依赖 | 验证 | 可行性结论 |
|------|------|----------|------|------|------|------------|
| M1 | 运维清理、实例清理移动端适配较弱（无 mobile-only 降级） | M（2 文件 + 1 共享组件） | 低 | 前端 | 易 | ✅ 高可行，先提炼 `<MobileCardList>` 再复用 |
| M2 | 多列表格窄屏体验差（提现审批 8 列、API Keys 9 列、Webhooks 7 列、玩家绑定 7 列） | L（4 文件 + 1 共享组件） | 低 | 前端 | 中 | ✅ 高可行，基于 B1.0 共享组件分批接入 |

### 3.3 数据展示与性能（1 项）

| 编号 | 问题 | 影响范围 | 风险 | 依赖 | 验证 | 可行性结论 |
|------|------|----------|------|------|------|------------|
| P1 | 全量加载无分页页面较多（9 个） | S（仅监控告警） | 低 | 跨层 | 易 | ⏸️ **已裁决不改造分页**（决策点 3 = B），仅做 B2.8 数据量监控告警；8/9 页数据天然有限增长 |

### 3.4 已到位无需改动（5 项，仅记录）

| 编号 | 事项 | 状态 |
|------|------|------|
| OK1 | 破坏性操作保护（useDestructiveAction + 文本匹配 + SSL 回滚） | ✅ 到位 |
| OK2 | 虚拟化表格（AuditLogs VirtualTable） | ✅ 到位 |
| OK3 | KPI 卡片键盘可访问（role=button + tabIndex + Enter/Space） | ✅ 到位 |
| OK4 | 快捷键支持（/搜索、Cmd+K 命令面板、?帮助） | ✅ 到位 |
| OK5 | Tab 状态 URL 同步（系统监控、实例详情、审计日志、实例列表） | ✅ 到位 |

---

## 四、分阶段执行计划

> 按「低风险快速修复 → 一致性统一 + 基础设施对齐」两阶段推进。每阶段内批次独立可回滚。
> v2 修订：取消原阶段三（B3.1 裁决不改动、B3.2 裁决不改造），将 B2.7/B2.8 并入阶段二。

### 阶段一：低风险快速修复（纯前端、可独立验证）

| 批次 | 主题 | 对应问题 | 涉及文件 | 验证标准 |
|------|------|----------|----------|----------|
| **B1.0** | 提炼 `<MobileCardList>` 共享组件 | M1/M2 前置 | 新建 `MobileCardList.tsx` + 重构 Users.tsx 接入 | Users.tsx 移动端行为不变；共享组件单测通过 |
| **B1.1** | 角色门控补显式检查（选项 A） | A1 | Maintenance.tsx、CleanupPage.tsx、Quotas.tsx、AdminDashboard.tsx、PlatformDashboard.tsx | 5 页面以 instance_admin 角色访问跳转 `/forbidden`；server_admin 正常访问 |
| **B1.2** | 运维清理移动端卡片降级 | M1（半） | Maintenance.tsx（复用 B1.0） | 移动端（<768px）显示卡片列表，桌面端保持表格 |
| **B1.3** | 实例清理移动端卡片降级 | M1（半） | CleanupPage.tsx（复用 B1.0） | 同上，破坏性操作按钮在卡片上保留二次确认 |
| **B1.4** | 玩家绑定移动端卡片降级 | M2（1/4） | PlayerBindings.tsx（复用 B1.0） | 7 列表格在窄屏切换为卡片 |
| **B1.5** | Webhooks 移动端卡片降级 | M2（1/4） | Webhooks.tsx（复用 B1.0） | 7 列表格在窄屏切换为卡片 |

**阶段一验证门**：6 批次全部通过单测 + 视觉验证 + E2E（instance_admin 角色访问 5 页面跳 forbidden），打 tag `pre-polish-stage-1`。

### 阶段二：一致性统一 + 基础设施对齐（中等风险、需测试覆盖）

| 批次 | 主题 | 对应问题 | 涉及文件 | 验证标准 |
|------|------|----------|----------|----------|
| **B2.1** | WithdrawApprovals 风格统一 | A2 | WithdrawApprovals.tsx + api 客户端新增方法 | 使用 `api` 客户端；`isAdminRole` 检查 → `Navigate to="/forbidden"`；后端路由审计通过 |
| **B2.2** | 提现审批移动端卡片降级 | M2（1/4） | WithdrawApprovals.tsx（复用 B1.0） | 8 列表格在窄屏切换为卡片 |
| **B2.3** | API Keys 移动端卡片降级 | M2（1/4） | ApiKeys.tsx（复用 B1.0） | 9 列表格在窄屏切换为卡片，明文 Key 模态保持响应式 |
| **B2.4** | 迁移 AdminDashboard 到 TanStack Query | A4 | AdminDashboard.tsx + queries/admin.ts | 资产模板失败保持 amber 提示；行为不变；Query 缓存生效 |
| **B2.5** | 迁移 PlatformDashboard 到 TanStack Query | A4 | PlatformDashboard.tsx + queries/admin.ts | 5 个 `*Error` 状态位改用 Query error；独立降级行为不变 |
| **B2.6** | 迁移 SystemHealth 到 TanStack Query | A4 | SystemHealth.tsx + queries/admin.ts | `isEndpointUnavailable` 判断逻辑保留；WS 实时监控保留 |
| **B2.7** | 提炼 `usePlatformOverview` 共享 hook | A3 补充 | queries/admin.ts + AdminDashboard + PlatformDashboard | 两页面共享数据获取 + 缓存；KPI 卡片渲染逻辑不变 |
| **B2.8** | 建立数据量监控告警 | P1 | 后端 getMaintenanceOverview 扩展 + SystemHealth 展示 | 各表行数超过阈值时 SystemHealth 显示告警 |

**阶段二验证门**：8 批次通过单测 + E2E + 多角色实测（server_admin / instance_admin / user 三角色访问 WithdrawApprovals 验证门控），打 tag `pre-polish-stage-2`。

---

## 五、详细执行步骤与开发事项

### 批次 B1.0：提炼 `<MobileCardList>` 共享组件（M1/M2 前置）

**目标**：从 Users.tsx 的 mc-item 结构提炼通用共享组件，避免 B1.2-B1.5 重复实现。

**为什么这么做**：审批评估发现，原方案 4 个移动端降级批次各自实现 mc-item JSX，会引入"重复代码债"。先提炼共享组件，再让各页面复用，是"消除债务而非累积债务"的正确路径。

**开发事项**：

1. **新建共享组件**：`panel/frontend/src/components/ui/MobileCardList.tsx`
   ```tsx
   interface MobileCardListProps<T> {
     items: T[];
     renderHeader: (item: T) => React.ReactNode;
     renderBody: (item: T) => React.ReactNode;
     renderActions?: (item: T) => React.ReactNode;
     keyExtractor: (item: T) => string;
     emptyText?: string;
   }
   export function MobileCardList<T>({ items, ... }: MobileCardListProps<T>) {
     if (items.length === 0) return <EmptyState title={emptyText ?? '暂无数据'} />;
     return (
       <div className="mobile-only mobile-card-list">
         {items.map(item => (
           <div key={keyExtractor(item)} className="mc-item">
             <div className="mc-item-header">{renderHeader(item)}</div>
             <div className="mc-item-body">{renderBody(item)}</div>
             {renderActions && <div className="mc-actions">{renderActions(item)}</div>}
           </div>
         ))}
       </div>
     );
   }
   ```

2. **重构 Users.tsx 接入**：将现有 `mobile-card-list` 区块替换为 `<MobileCardList>` 调用，验证行为不变

3. **单测**：覆盖空列表 / 单项 / 多项 / 自定义渲染

**验证**：
- 单测：组件渲染、空态、keyExtractor
- E2E：Users.tsx 移动端行为回归（卡片渲染、编辑/删除按钮可点击）
- 回归：Users.tsx 桌面端表格渲染不变

**回滚**：`git revert` 单 commit，恢复 Users.tsx 原 mc-item 实现。

---

### 批次 B1.1：角色门控补显式检查（A1，决策点 1 = A）

**目标**：5 个仅依赖路由守卫的页面补 `isAdminRole` 显式检查 → `Navigate to="/forbidden"`。

**为什么这么做**（决策点 1 裁决理由）：
1. **业务语义对齐**：Maintenance（清理平台级 audit_logs 等 4 表）、CleanupPage（删除待清理实例）、Quotas（角色默认配额）、AdminDashboard/PlatformDashboard（系统管理员视角）——5 个页面从业务语义上就是 server_admin 专属，instance_admin 不应访问
2. **防御性兜底**：12 个页面已有此检查，5 个没有就是"一致性缺口"；路由守卫被绕过时（如未来误改 RequireRole），页面内检查是最后一道防线
3. **可观测性**：`Navigate to="/forbidden"` 比"渲染一半才发现权限不足"体验好

**开发事项**：

1. **Maintenance.tsx** 顶部增加：
   ```tsx
   if (!isAdminRole(user)) return <Navigate to="/forbidden" replace />;
   ```
   位置：`useAuth` 之后、`useEffect` 之前

2. **CleanupPage.tsx** 同上

3. **Quotas.tsx** 同上

4. **AdminDashboard.tsx** 同上（与 PlatformDashboard 保持一致风格）

5. **PlatformDashboard.tsx** 同上（文件头已注释「仅 server_admin 可见」，补代码实现）

**验证**：
- 单测：mock `user.role = 'instance_admin'`，断言渲染 `<Navigate to="/forbidden">`
- E2E：以 instance_admin 登录访问 5 个路径，断言跳转 `/forbidden`
- 回归：server_admin 访问 5 个路径正常加载

**回滚**：`git revert` 单 commit。

---

### 批次 B1.2：运维清理移动端卡片降级（M1 半）

**目标**：Maintenance.tsx 的四张表概览表格在 <768px 切换为卡片列表（复用 B1.0 共享组件）。

**开发事项**：

1. 引入 `<MobileCardList>`，传入四张表的行数据
2. `renderHeader`：表名（中文 + 英文 mono badge）
3. `renderBody`：行数（>10000 加粗红色）/ retention（天）/ 上次清理时间
4. `renderActions`：清理按钮（`useConfirm` danger）+ 修改 retention 按钮（仅 RETENTION_EDITABLE 表显示）
5. 桌面端 `<div className="desktop-only"><table>...</table></div>` 保持不变

**验证**：
- 视觉：浏览器 DevTools 切换移动端视口，确认卡片渲染
- E2E：移动端点击「清理」按钮触发确认弹窗
- 回归：桌面端表格渲染不变

---

### 批次 B1.3：实例清理移动端卡片降级（M1 半）

**目标**：CleanupPage.tsx 的待清理实例表格 + 全部实例概览表格在 <768px 切换为卡片（复用 B1.0）。

**开发事项**：

1. **待清理实例卡片**：`renderHeader` 实例名 / `renderBody` Pack+游戏+归属者+闲置天数 / `renderActions` 确认删除+忽略
2. **全部实例概览卡片**：`renderHeader` 实例名+状态徽章 / `renderBody` 归属者+闲置天数 / `renderActions` 标记徽章
3. 破坏性操作按钮保留 `useDestructiveAction`（preview → confirm → execute + 输入 ID 匹配）

**验证**：
- 视觉：移动端卡片渲染
- E2E：移动端「确认删除」触发 dry-run 预览 → 输入 ID 匹配 → execute
- 回归：桌面端双表格渲染不变

---

### 批次 B1.4：玩家绑定移动端卡片降级（M2 1/4）

**目标**：PlayerBindings.tsx 的 7 列表格在 <768px 切换为卡片（复用 B1.0）。

**开发事项**：

1. `renderHeader`：游戏玩家名
2. `renderBody`：用户名 / 游戏类型 / 状态徽章（STATUS_LABEL 中文）/ 绑定时间（mono）
3. `renderActions`：解绑按钮（`useConfirm` 二次确认）

**验证**：视觉 + E2E（移动端解绑流程）+ 回归。

---

### 批次 B1.5：Webhooks 移动端卡片降级（M2 1/4）

**目标**：Webhooks.tsx 的 7 列表格在 <768px 切换为卡片（复用 B1.0）。

**开发事项**：

1. `renderHeader`：URL（mono，截断 + title 悬浮全显）
2. `renderBody`：事件类型徽章（空时「全部」）/ 启用状态徽章 / 创建时间
3. `renderActions`：启用 checkbox + 测试按钮 + 删除按钮（`useConfirm` danger）

**验证**：视觉 + E2E + 回归。

---

### 批次 B2.1：WithdrawApprovals 风格统一（A2）

**目标**：消除 WithdrawApprovals 的三处孤立风格（API 客户端 / 角色门控 / 错误处理）。

**开发事项**：

1. **后端路由审计（执行前置）**：
   ```bash
   # 确认 /api/admin/withdraw/* 路由挂载 requireRole('server_admin') 中间件
   grep -rn "router\.\(get\|post\).*withdraw" panel/backend/src/api/routes/
   grep -rn "requireRole\|requireAdmin" panel/backend/src/api/routes/withdraw*.ts
   ```
   若中间件缺失，先补后端鉴权再改前端

2. **API 客户端统一**：
   - 在 `panel/frontend/src/api/client.ts` 新增方法：
     ```ts
     listPendingWithdraws(page: number): Promise<{ items: Withdraw[]; total: number }>
     approveWithdraw(code: string): Promise<void>
     rejectWithdraw(code: string): Promise<void>
     ```
   - WithdrawApprovals.tsx 改用 `api` 客户端，移除 `userCenterRequest` 依赖

3. **角色门控统一**：
   - 移除 `if (!isAdmin) return <div className="alert alert-error">仅管理员可访问此页面</div>`
   - 改为 `if (!isAdminRole(user)) return <Navigate to="/forbidden" replace />`

4. **错误处理保持**：行级错误 `toast.error`、整页错误 `alert-error`（已用，保持）

**验证**：
- 单测：mock `api.listPendingWithdraws`，断言渲染
- E2E：server_admin 访问正常；instance_admin 访问跳 `/forbidden`
- 回归：核销/拒绝流程正常，复制按钮正常

**回滚**：`git revert`，恢复 `userCenterRequest` 依赖。

---

### 批次 B2.2：提现审批移动端卡片降级（M2 1/4）

**目标**：WithdrawApprovals.tsx 的 8 列表格在 <768px 切换为卡片（复用 B1.0）。

**开发事项**：

1. `renderHeader`：提现码（mono + 复制按钮）
2. `renderBody`：用户名+邮箱 / 申请金额 ¥ / 实际到账 ¥ / 比例 % / 申请时间 / 有效期
3. `renderActions`：核销按钮（`btn-primary` + `useConfirm`）+ 拒绝按钮（`btn-danger` + `useConfirm` danger）

**验证**：视觉 + E2E + 回归。建议与 B2.1 同批或紧随。

---

### 批次 B2.3：API Keys 移动端卡片降级（M2 1/4）

**目标**：ApiKeys.tsx 的 9 列表格在 <768px 切换为卡片（复用 B1.0）。

**开发事项**：

1. `renderHeader`：名称 + 状态徽章
2. `renderBody`：Key 前缀（mono + …）/ 关联用户 / 角色徽章（v4.30.1 后恒为「实例管理员」）/ 创建时间 / 过期时间或「永不过期」/ 最后使用或「从未使用」
3. `renderActions`：撤销按钮（`Trash2` 红色 + Modal 二次确认）
4. 明文 Key 显示模态保持通用 `Modal` 自带响应式（不动）

**验证**：视觉 + E2E + 回归。

---

### 批次 B2.4：迁移 AdminDashboard 到 TanStack Query（A4，v2 修正）

**目标**：将 AdminDashboard 的 `Promise.allSettled + useState + useEffect` 手动管理迁移到 TanStack Query，消除"三套数据获取模式"债务。

**为什么这么做**（v2 修正理由）：
- 原方案提议新建 `useAsyncAllSettled` hook，但项目已用 TanStack Query（6 文件）
- 新建 hook 会引入"第三套数据获取模式"（Query / Promise.allSettled+useState / useAsyncAllSettled），是重复造轮子
- TanStack Query 自带 isLoading/isError/data/error 状态管理 + retry/cache/invalidate，能力远超自建 hook
- 迁移到 Query 是"消除债务"，新建 hook 是"增加债务"

**开发事项**：

1. **在 [queries/admin.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/queries/admin.ts) 新增**：
   ```ts
   // 主数据：失败阻断
   export const usePlatformOverview = () => useQuery({
     queryKey: ['admin', 'platform-overview'],
     queryFn: () => api.getPlatformOverview(),
     retry: 1,
   });

   // 附属数据：失败非阻断（资产模板）
   export const useGlobalAssets = () => useQuery({
     queryKey: ['admin', 'global-assets'],
     queryFn: () => api.listGlobalAssets(),
     retry: false, // 附属数据不重试
     staleTime: 5 * 60 * 1000,
   });
   ```

2. **AdminDashboard.tsx 改造**：
   - 移除 `useState`（overview/assetCount/loading/error/assetCountError）
   - 移除 `useEffect` 中的 `Promise.allSettled`
   - 改用 `const { data: overview, isLoading, error } = usePlatformOverview()` + `const { data: assets, error: assetsError } = useGlobalAssets()`
   - 「刷新」按钮改用 `refetch()` 或 `queryClient.invalidateQueries(['admin'])`
   - 资产模板失败保持 amber 提示条（`assetsError` 非空时渲染）

3. **行为对齐验证**：确保迁移后 loading 态、error 态、amber 提示条、刷新行为完全一致

**验证**：
- 单测：mock QueryClient，验证 loading/error/success 三态
- E2E：资产模板接口 500 时显示 amber 提示，其他 KPI 正常
- 回归：AdminDashboard 行为不变（含刷新按钮、KPI 卡片点击穿透）

**回滚**：`git revert`，恢复 useState + useEffect 实现。

---

### 批次 B2.5：迁移 PlatformDashboard 到 TanStack Query（A4）

**目标**：PlatformDashboard 的 5 接口并行 + 5 个 `*Error` 状态位迁移到 `useQueries` 或多个 `useQuery`。

**开发事项**：

1. **queries/admin.ts 新增 5 个 query hook**：
   ```ts
   usePlatformUsersTrend(range: '24h' | '30d')
   usePlatformRevenueTrend(days: number)
   useDiskUsageTop(limit: number)
   useUserStats()
   // usePlatformOverview 已在 B2.4 定义，复用
   ```

2. **PlatformDashboard.tsx 改造**：
   - 移除 5 组 `useState` + `useEffect`
   - 改用 5 个 `useQuery` hook（或 `useQueries` 批量）
   - 5 个 `*Error` 状态位改用各 query 的 `error` 字段
   - 独立降级行为不变（每区块单独「加载失败」+ 重试按钮 → `refetch()`）
   - 用户活跃度切换（24h/30d）通过 `queryKey` 参数触发重新查询

3. **行为对齐验证**：确保 5 个区块的独立降级、独立重试、用户活跃度切换行为一致

**验证**：单测 + E2E（模拟各接口失败，验证独立降级）+ 回归。

---

### 批次 B2.6：迁移 SystemHealth 到 TanStack Query（A4）

**目标**：SystemHealth 的 `getSystemMetrics` / `getSystemHealth` / `listServers` / `listNodes` + `getNodeDiskUsage(n.id)` 迁移到 Query。

**开发事项**：

1. **queries/admin.ts 新增**：
   ```ts
   useSystemMetrics()
   useSystemHealth()
   useNodesDiskUsage() // 内部 useQueries 批量查询各节点磁盘
   ```

2. **SystemHealth.tsx 改造**：
   - `isEndpointUnavailable` 判断逻辑保留（404/NETWORK_ERROR →「接口暂未开放」占位）
   - WS 实时监控（`systemMonitorStore.subscribe`）保留，不迁移到 Query（WS 是实时流，不适合 Query 轮询模型）
   - 刷新按钮改用 `refetch()`

3. **行为对齐验证**：确保 Tab 切换、WS 实时监控、端点不可用降级行为一致

**验证**：单测 + E2E + 回归。

---

### 批次 B2.7：提炼 `usePlatformOverview` 共享 hook（A3 补充，决策点 2 = X1）

**目标**：AdminDashboard 与 PlatformDashboard 共享 `usePlatformOverview` hook，消除"两处各写一遍数据获取"的真正债务。

**为什么这么做**（决策点 2 裁决理由）：
- 决策点 2 裁决为 X1（保持现状），因为"门户+报表"分层是成熟模式（苹果/Linear/Vercel 都是），X2 合并会性能退化+信息密度过高，X3 重新定位会空洞化
- 但 X1 的真正债务是"两页面各自调用 `api.getPlatformOverview()` + 各写一遍 Promise.allSettled"
- B2.4 已在 queries/admin.ts 定义 `usePlatformOverview`，B2.5 复用即可——本批次是 B2.4/B2.5 的收尾验证

**开发事项**：

1. 确认 B2.4/B2.5 均使用同一个 `usePlatformOverview`（同一 queryKey → 共享缓存）
2. 验证两页面切换时缓存生效（5 秒内切换不重新请求）
3. 验证任一页面刷新后，另一页面 staleTime 到期自动获取最新数据

**验证**：
- 单测：两页面共享 queryKey
- E2E：AdminDashboard 刷新 → 切换到 PlatformDashboard → 5 秒内不重新请求 → staleTime 到期后自动刷新
- 回归：两页面 KPI 卡片渲染不变

**注意**：本批次实际是 B2.4/B2.5 的验收检查，无独立代码改动。若 B2.4/B2.5 已正确共享 queryKey，本批次标记完成。

---

### 批次 B2.8：建立数据量监控告警（P1，决策点 3 = B）

**目标**：建立"数据量监控告警"，当某表行数超过阈值时在 SystemHealth 页显示告警，触发后再决定是否改造分页。

**为什么这么做**（决策点 3 裁决理由）：
- 9 个全量加载页面中 8 个是"天然有限增长"（PlayerBindings 按服务器维度、Webhooks 通常 <10、API Keys <50、SSL 单证书、Tunnel 单配置、SystemConfig KV 项固定、Packs 12 种、Profile 单用户）
- 当前数据量下无性能问题，统一分页是"为 0% 的场景做 100% 的设计"（YAGNI）
- 选项 A（试点 2 页）会引入"分页/全量"风格分裂债
- 真正需要关注的是数据增长后何时触发改造——用监控告警驱动决策，而非预测性改造

**开发事项**：

1. **后端扩展 `getMaintenanceOverview`**：返回各表行数（audit_logs / user_notifications / item_sync_log / chat_logs）
2. **后端新增 `/api/admin/data-volume` 接口**：返回关键表行数（player_bindings 总数 / webhooks 总数 / api_keys 总数 / notifications 总数）
3. **SystemHealth.tsx 新增「数据量监控」Tab 或区块**：
   - 展示各表当前行数
   - 阈值告警：>80% 警告（黄）、>95% 严重（红）
   - 阈值配置：通过 SystemConfig KV 配置（如 `monitor.data_volume_threshold.notifications = 500`）
4. **告警触发后的人工决策流程**：当某表持续告警时，由用户决定是否单独改造该页面分页（不强制推广到 9 页）

**验证**：
- 单测：阈值判定逻辑
- E2E：mock 各表行数超阈值，验证告警渲染
- 回归：SystemHealth 原有 4 Tab 行为不变

**回滚**：`git revert`，恢复 SystemHealth 原 4 Tab。

---

## 六、测试与验证策略

### 6.1 三重测试闸门（rules-0 §二-5）

按 s0402 前端三重闸门执行，顺序固定，不可跳关：

1. **单元测试**：每个改动文件补单测，覆盖角色门控分支、TanStack Query hook 三态、MobileCardList 渲染
2. **E2E 测试**：关键路径（角色门控跳转、破坏性操作二次确认、移动端卡片操作、TanStack Query 缓存共享）全链路通
3. **Mock 回归**：UI 层 Mock 模式验证，确保 Mock 数据下渲染正常

### 6.2 多角色实测矩阵

| 角色 | 访问页面 | 预期行为 |
|------|----------|----------|
| server_admin | 27 个 admin 页面 | 全部正常加载 |
| instance_admin | Maintenance / Cleanup / Quotas / AdminDashboard / PlatformDashboard / WithdrawApprovals | 跳转 `/forbidden` |
| instance_admin | Nodes | 正常加载（v4.28.0 已开放） |
| user | /admin/* 全部 | 路由守卫跳转 `/forbidden` |

### 6.3 移动端视觉验证

- 视口：375px（iPhone SE）/ 768px（iPad mini）/ 1024px（iPad）
- 验证点：`<MobileCardList>` 卡片渲染、按钮可点击、破坏性操作二次确认弹窗可关闭、表格横向滚动不出现

### 6.4 TanStack Query 行为验证（B2.4-B2.7 专项）

- loading 态：骨架屏/Skeleton 渲染
- error 态：错误提示 + 重试按钮
- success 态：数据正确渲染
- 缓存共享：AdminDashboard ↔ PlatformDashboard 切换时 5 秒内不重新请求
- 刷新：`refetch()` 触发重新请求

### 6.5 部署前验证（rules 0.md §五）

```bash
# 验证构建产物中无 localhost:3000 引用
grep -r "localhost:3000" panel/frontend/dist/ && echo "❌ 违规" || echo "✅ 验证通过"
grep -r "127.0.0.1:3000" panel/frontend/dist/ && echo "❌ 违规" || echo "✅ 验证通过"
```

---

## 七、回滚机制

### 7.1 三级回滚

| 级别 | 触发条件 | 操作 |
|------|----------|------|
| L1 单批次 | 单批次验证失败 | `git revert <commit>` |
| L2 单阶段 | 阶段内多批次失败 | `git reset --hard pre-polish-stage-{N}` |
| L3 全方案 | 阶段二高风险改动失败 | `git reset --hard pre-polish-stage-1`（回到阶段一完成态） |

### 7.2 回滚锚点

- 每批次开始前：`git tag pre-polish-batch-{阶段}-{编号}`（如 `pre-polish-batch-1-0`）
- 每阶段完成后：`git tag pre-polish-stage-{N}`
- 部署前：`git tag pre-polish-deploy-{版本号}`

### 7.3 数据库迁移回滚

本方案**不涉及数据库字段变更**，无需迁移脚本。B2.8 数据量监控告警仅新增只读接口 + KV 配置项，无 schema 变更。

---

## 八、版本号规划

按 [rules bb.md](.trae/rules/bb.md) 规则：

- 本方案属「对现有功能修改」，**小版本号递增**
- 当前版本：v4.32.0
- 预期版本：
  - 阶段一完成：v4.32.1（B1.0 共享组件 + B1.1 角色门控 + B1.2-B1.5 移动端降级）
  - 阶段二完成：v4.32.2（B2.1 WithdrawApprovals 统一 + B2.2-B2.3 移动端降级 + B2.4-B2.7 TanStack Query 迁移 + B2.8 监控告警）
- 大版本号由用户决定，不调整

每次发版同步更新 [version.md](version.md) 详细说明；本方案不涉及文件结构调整，无需更新 [README.md](README.md)。

---

## 九、风险与建议

### 9.1 主要风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 角色门控补检查后，instance_admin 无法访问 5 个页面 | 低 | 低 | 业务语义已确认 5 页面为 server_admin 专属（决策点 1 = A） |
| WithdrawApprovals 后端路由鉴权不一致 | 低 | 高 | B2.1 执行前先 grep 后端路由确认中间件挂载（已补具体命令） |
| TanStack Query 迁移后行为漂移 | 中 | 中 | B2.4 先单页接入（AdminDashboard）验证行为一致后再推广 B2.5/B2.6 |
| 移动端卡片降级遗漏破坏性操作二次确认 | 低 | 高 | 每批次 E2E 必须覆盖移动端破坏性操作流程 |
| TanStack Query 缓存导致数据过期 | 低 | 中 | staleTime 设为 5 分钟，刷新按钮触发 `invalidateQueries` |
| MobileCardList 共享组件抽象不当 | 中 | 中 | B1.0 先重构 Users.tsx 验证通用性，再让 B1.2-B1.5 复用 |

### 9.2 建议

1. **先做 B1.0 提炼共享组件**——避免 4-5 个页面重复实现 mc-item，是"消除债务而非累积债务"的前置
2. **B2.1 改造前先做后端路由审计**——已补 grep 命令，确认鉴权一致后再改前端
3. **B2.4 先单页接入 TanStack Query**——AdminDashboard 验证行为一致后再推广 B2.5/B2.6
4. **移动端降级优先破坏性操作页面**——CleanupPage / Maintenance 涉及删除，移动端误触风险高，优先于其他表格
5. **B2.7 是 B2.4/B2.5 的验收检查**——确认两页面共享 queryKey 即可，无独立代码改动
6. **B2.8 监控告警驱动分页决策**——不预测性改造 9 页分页，用数据增长告警触发定向改造

---

## 十、决策记录（已裁决）

> v2 修订：本章从"分叉点"改为"决策记录"，3 个决策点均已裁决。

### 决策点 1：角色门控补检查的角色范围（B1.1）—— **裁决：A**

**裁决**：A（统一补 `isAdminRole` → `Navigate to="/forbidden"`）

**理由**：
1. 业务语义对齐——5 个页面（Maintenance/Cleanup/Quotas/AdminDashboard/PlatformDashboard）都是 server_admin 专属功能
2. 防御性兜底——12 个页面已有此检查，5 个没有是"一致性缺口"
3. 可观测性——`Navigate to="/forbidden"` 比"渲染一半才报错"体验好

**否决理由**：
- B（isInstanceAdminOrAbove）：违背业务语义，instance_admin 不应有清理平台级日志/配额权限，引入越权风险
- C（逐页确认）：5 个页面业务语义一致，逐页确认是"假装精细"，实际结论会完全相同

---

### 决策点 2：AdminDashboard / PlatformDashboard 关系（B3.1）—— **裁决：X1 + 共享 hook**

**裁决**：X1（保持现状）+ B2.7 提炼 `usePlatformOverview` 共享 hook

**理由**：
1. "门户 + 报表"分层是成熟模式（苹果 Settings 概览 vs 详细报表、Linear Dashboard vs Insights、Vercel Project Overview vs Analytics）
2. AdminDashboard 是"5 秒扫一眼"的运营视角；PlatformDashboard 是"停留 2 分钟分析"的分析视角——服务不同心智模式
3. 真正的债务是"两处各写一遍数据获取"，通过 B2.7 共享 hook 消除，而非合并页面

**否决理由**：
- X2（合并）：7 接口并行首屏 LCP 退化 + 信息密度过高（滚动 3-4 屏）+ 移动端体验崩塌 + 破坏书签/外链
- X3（重新定位）：当前平台无"待办"概念（无工单系统），AdminDashboard 去重 KPI 后会空洞化；改动量大但收益不明确

---

### 决策点 3：全量加载分页改造范围（B3.2）—— **裁决：B + 监控告警**

**裁决**：B（暂不改造）+ B2.8 建立数据量监控告警

**理由**：
1. YAGNI——当前数据量下无性能问题
2. 9 个页面中 8 个是"天然有限增长"（PlayerBindings 按服务器维度、Webhooks 通常 <10、API Keys <50、SSL 单证书、Tunnel 单配置、SystemConfig KV 项固定、Packs 12 种、Profile 单用户）
3. 真正需要关注的是数据增长后何时触发改造——用监控告警驱动决策，而非预测性改造

**否决理由**：
- A（试点 2 页）：引入"分页/全量"风格分裂债——PlayerBindings 有分页器、API Keys 没有，用户认知混乱
- C（全部改造）：7 个页面数据量天然有限，分页器永远只有 1 页，是"为 0% 的场景做 100% 的设计"

---

## 十一、Subagent 调度台账

> 按 [rules-0 §四-11](.trae/rules/rules-0.md) 要求，本方案涉及 subagent 调度时记录于此。

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|----------|-------|---------------|----------|-----------------|----------|------------|------|
| B1.0 | — | general_purpose_task | MobileCardList 共享组件 + Users.tsx 重构 + 单测 | 待回填（启动后填入真实拉起ID） | docs/frontend/logs/2026-07-29.md | pre-polish-batch-1-0 | 待启动 |
| B1.1-B1.5 | [P] | general_purpose_task | 5 批次代码改动 + 单测 | 待回填 | docs/frontend/logs/2026-07-29.md | pre-polish-stage-1 | 待启动 |
| B2.1 | — | general_purpose_task | WithdrawApprovals 统一 + 后端审计 | 待回填 | docs/frontend/logs/2026-07-29.md | pre-polish-batch-2-1 | 待启动 |
| B2.2-B2.3 | [P] | general_purpose_task | 2 批次移动端降级 + 单测 | 待回填 | docs/frontend/logs/2026-07-29.md | pre-polish-batch-2-2 | 待启动 |
| B2.4-B2.6 | [P] | general_purpose_task | 3 页面 TanStack Query 迁移 + 单测 + E2E | 待回填 | docs/frontend/logs/2026-07-29.md | pre-polish-batch-2-4 | 待启动 |
| B2.7 | — | general_purpose_task | 共享 hook 验收检查 | 待回填 | docs/frontend/logs/2026-07-29.md | pre-polish-batch-2-4 | 待启动 |
| B2.8 | — | general_purpose_task | 监控告警接口 + SystemHealth 展示 | 待回填 | docs/frontend/logs/2026-07-29.md | pre-polish-batch-2-8 | 待启动 |

并行约束：单批并行上限 2，全局并行上限 3（rules-0 §四-4）。

---

## 十二、方案状态与下一步

- **当前状态**：approved（已按审批意见修订），待用户确认执行
- **决策记录**：§十 的 3 个决策点均已裁决
- **v2 修订摘要**：
  1. 新增 B1.0 提炼 `<MobileCardList>` 共享组件（修正遗漏 3）
  2. B2.4-B2.6 由"新建降级 hook"改为"迁移到 TanStack Query"（修正遗漏 1，避免重复造轮子）
  3. B2.1 补后端路由审计具体 grep 命令（修正遗漏 2）
  4. 新增 B2.7 提炼 `usePlatformOverview` 共享 hook（决策点 2 = X1 补充）
  5. 新增 B2.8 数据量监控告警（决策点 3 = B 补充）
  6. 取消阶段三，压缩为两阶段（B3.1 裁决不改动、B3.2 裁决不改造）
- **下一步**：
  1. 用户确认本方案 v2
  2. 按阶段一 → 二顺序执行，每阶段独立验证 + 打 tag
  3. 每批次完成后更新 [current-note.md](current-note.md) 七字段交接状态

---

> 方案 v2 完。已按审批意见修订，净技术债评估为**减少**（消除 WithdrawApprovals 孤立 + 消除 Promise.allSettled 手动管理 + 消除角色门控不一致 + 移动端卡片通过共享组件避免重复）。
