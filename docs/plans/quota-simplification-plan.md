---
type: plan
title: 配额管理简化方案（仅保留磁盘配额）
date: 2026-07-29
status: deployed（v4.29.13 上线，见 version.md）
related:
  - panel/backend/src/services/quotaService.ts
  - panel/frontend/src/pages/admin/Quotas.tsx
  - panel/backend/src/api/routes/servers.ts
  - panel/backend/src/api/routes/files.ts
  - docs/plans/universal-role-switching-plan.md
  - docs/plans/instance-billing-rules-plan.md
tags: [quota, simplification, billing, role-switching]
---

# gsp 配额管理简化方案（仅保留磁盘配额）

> 遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。

---

## 0. 背景与裁决

### 0.1 用户裁决（2026-07-29）

> 实际上当实例管理员和普通用户能快速切换后，这个也没有什么意义了。实例现在也是需要花钱才能新建，再管理配额好像并没有作用了。
>
> **最终裁决**：只保留磁盘空间用量，其余禁用了，相关信息写入到注释中，以后用以后再说。

### 0.2 裁决依据

| 触发因素 | 来源 | 影响 |
|---------|------|------|
| 角色免密切换上线 | [universal-role-switching-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/universal-role-switching-plan.md) §1.2 | 注册即得 `roles=['user','instance_admin']`，同级免密切换 → **role 级配额失效**（切换 active_role 即可挑选更宽松档位） |
| VPS 式预付费计费 | [instance-billing-rules-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/instance-billing-rules-plan.md) §0.2 | 实例按类型月费预付费，付费成为创建实例的经济门槛 → `max_instances` 作用下降 |
| 磁盘是真实物理资源 | — | 付费机制不管磁盘用量（`disk_limit_gb` 仅展示参考，见计费方案 §3.1），磁盘配额仍是平台防滥用兜底 → **必须保留** |
| 玩家总数与付费无关 | 计费方案 §0.2 | 计费按类型不按人数，但 `max_players_total` 当前 `getUsage` 简化返回 0，实际未强制 → 禁用影响可忽略 |

### 0.3 互补关系澄清

付费机制与配额并非替代关系，而是互补关系：

| 机制 | 性质 | 限制对象 |
|------|------|---------|
| VPS 预付费 | 经济门槛 | "愿不愿意付钱"——筛选有付费能力/意愿的人 |
| 配额（quotaService） | 资源硬上限 | "允不允许占用资源"——平台防滥用兜底 |

本次裁决保留磁盘配额，正是认可了这种互补关系——磁盘是真实物理资源，付费不管磁盘，必须有硬上限兜底。

---

## 1. 方案概述

### 1.1 核心思路

**最小侵入式禁用**：不删除字段、不破坏契约、不删表，仅在服务层与前端 UI 层禁用 `max_instances` 与 `max_players_total` 的校验逻辑与展示，相关代码以注释形式保留"以后用以后再说"的恢复路径。

### 1.2 设计原则

1. **契约层不动**：`public/schema/panel-api-types.ts`、`public/config_template/system-config-extension.schema.json`、`public/schema/error-codes-schema.json` 中的 `max_instances` / `max_players_total` 字段定义保持原样（受 rules-0 §四-10 / rules-4 §4.3 保护，且保留字段方便未来恢复）
2. **数据库不动**：`resource_quotas` 表结构不变，存量数据不迁移、不删除（避免不可逆操作）
3. **服务层禁用校验**：`checkInstanceQuota` 直接放行，`getUsage` 不再计算 `players_online`
4. **前端隐藏 UI**：角色配额卡片与编辑 Modal 仅展示磁盘配额字段
5. **注释保留恢复路径**：所有禁用点写清楚禁用原因、裁决日期、未来恢复条件

### 1.3 不在本次范围

- 不删除 `resource_quotas` 表
- 不删除 `quotaService` 类（`checkDiskQuota` 与 `getEffectiveQuota` 仍在使用）
- 不修改 public/ 契约层
- 不调整 `games.max_instances_per_user` 系统配置（该配置属于系统设置层，与本次配额管理页面调整是两条独立防线，保留不动）

---

## 2. 执行步骤

### 2.1 后端：quotaService.ts 禁用实例/玩家配额校验

**文件**：[panel/backend/src/services/quotaService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/quotaService.ts)

**修改点**：

1. **`checkInstanceQuota`（约 L228-L243）**：方法体改为直接返回 `{ allowed: true }`，原校验逻辑以注释保留。注释说明：
   - 禁用日期：2026-07-29
   - 禁用原因：role 级配额因角色免密切换失效；`max_instances` 因 VPS 预付费上线作用下降
   - 恢复条件：未来若需要按用户硬限实例数（如防有钱人开 100 个实例占调度槽位），取消注释恢复校验
   - 裁决来源：本方案 §0.1

2. **`getUsage`（约 L189-L221）**：`players_online` 字段保持返回 0（已是现状），新增注释说明"玩家总数配额已禁用，不查询 daemon"。`instances_used` 与 `disk_used_mb` 仍正常计算（磁盘配额校验依赖 `disk_used_mb`）。

3. **类头注释更新**：在文件头部 `// 用途` 段落标注 `max_instances` / `max_players_total` 已于 v4.29.13 禁用。

**不改**：
- `checkDiskQuota` 完全保留（磁盘配额仍生效）
- `getEffectiveQuota` 完全保留（user 级磁盘配额仍需 fallback 查询）
- `setQuota` 完全保留（前端仍可设置磁盘配额；`max_instances` / `max_players_total` 字段可传入但不生效）

### 2.2 前端：Quotas.tsx 隐藏实例/玩家配额 UI

**文件**：[panel/frontend/src/pages/admin/Quotas.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Quotas.tsx)

**修改点**：

1. **角色配额卡片（约 L245-L256）**：删除"实例配额"与"玩家总数"两个 `info-row`，仅保留"磁盘配额"行。
2. **编辑 Modal（L359 之后）**：删除"最大实例数"与"最大玩家总数"两个输入框，仅保留"最大磁盘配额（MB）"输入框。
3. **`handleSave`（约 L166-L199）**：`req` 载荷中 `max_instances` 与 `max_players_total` 固定传 `null`（保持后端契约兼容，不触发校验失败），仅 `max_disk_mb` 取用户输入。注释说明原因。
4. **`openEditRole` / `openEditUser` / `closeEdit`**：保留 `editMaxInstances` / `editMaxPlayersTotal` state 与赋值逻辑不动（避免大规模重构），仅 UI 层不展示。注释说明 state 保留原因。
5. **页面副标题（约 L207）**：更新文案为"管理角色默认磁盘配额与用户个性化磁盘配额（留空 = 不限）"。

**不改**：
- `ROLES` 常量保留三项（未来恢复时无需重构）
- `api.getRoleQuota` / `api.updateRoleQuota` 调用不变（契约层仍返回三字段，前端仅不展示）

### 2.3 文档与版本

1. **version.md**：新增 `v4.29.13` 条目，说明本次禁用的范围、原因、恢复路径
2. **current-note.md**：更新交接状态，记录本次配额简化裁决
3. **不更新 README.md**：本次属功能修改非重大结构调整

---

## 3. 开发事项与建议

### 3.1 关键开发事项

1. **契约层零改动**：public/ 目录所有文件不动，避免触发 s0601 契约变更流程
2. **注释规范**：所有禁用点注释统一格式——`// [v4.29.13 DISABLED] 原因 / 恢复条件 / 裁决来源`
3. **后端兼容性**：`setQuota` 仍接受 `max_instances` / `max_players_total` 参数并写入 DB（不破坏 API 契约），但 `checkInstanceQuota` 不再读取
4. **前端 state 保留**：`editMaxInstances` / `editMaxPlayersTotal` state 保留不动，仅 UI 层隐藏，降低改动风险

### 3.2 建议

1. **未来恢复路径**：若后续需要恢复实例配额（如防止有钱人开 100 个实例占调度槽位），仅需取消 `checkInstanceQuota` 注释即可，契约与 DB 字段均未破坏
2. **`games.max_instances_per_user` 保留**：系统配置层的实例数上限（见 [universal-role-switching-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/universal-role-switching-plan.md) §五-1）仍是独立防线，本次不动
3. **磁盘配额默认值复核**：禁用实例/玩家配额后，磁盘配额成为唯一硬上限，建议复核 `resource_quotas` 表中现有 user 级磁盘配额是否合理
4. **腐竹等级体系对接**：未来若启用腐竹等级折扣（见 [instance-billing-rules-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/instance-billing-rules-plan.md) §10-4），腐竹等级派生配额可重新引入 `getEffectiveQuota` 优先级链

### 3.3 风险提示

1. **实例数无硬上限**：禁用后，理论上付费用户可创建任意数量实例（受 `games.max_instances_per_user` 系统配置兜底，但仍建议监控）
2. **玩家总数无硬上限**：禁用后，玩家总数完全靠服务器配置 `max-players=N` 限制（计费方案 §0.5 已规划走配置层）
3. **存量配额数据残留**：`resource_quotas` 表中已有的 `max_instances` / `max_players_total` 记录不再生效但不删除，未来恢复时自动生效

---

## 4. 未闭合项

| 编号 | 问题 | 状态 | 说明 |
|------|------|------|------|
| 1 | 是否需要清理 `resource_quotas` 表中存量 `max_instances` / `max_players_total` 数据 | 已决：不清理 | 保留存量数据方便未来恢复，且不删除符合"不可逆操作需谨慎"原则 |
| 2 | `docs/api/04-game-ops.md` 与 `docs/frontend/pages/admin-quotas.md` 文档是否同步更新 | 暂缓 | 文档描述与代码实现会有短期不一致，建议下个文档批次统一更新 |
| 3 | `games.max_instances_per_user` 系统配置是否同步调整 | 已决：不动 | 该配置是系统设置层独立防线，与配额管理页面调整无关 |

---

## 5. 工程过程交接

### 5.1 工程过程

- [x] 信息收集：读取 quotaService.ts、Quotas.tsx、universal-role-switching-plan.md、instance-billing-rules-plan.md
- [x] 影响面分析：识别 public/ 契约层、后端调用点、前端 UI、当前版本号
- [x] 方案文档编写：本文件
- [x] 后端修改：quotaService.ts 禁用 checkInstanceQuota 校验 + getUsage/类头加注释
- [x] 前端修改：Quotas.tsx 隐藏实例配额/玩家总数 UI + handleSave 固定传 null
- [x] TypeScript 编译验证：后端 quotaService.ts 无错误 + 前端 Quotas.tsx 无错误
- [x] 版本与文档更新：version.md v4.29.13 + current-note.md

### 5.2 交接状态

- **当前 task**：全部完成
- **状态**：本地已闭合，待部署
- **下一步**：待用户决定部署时执行 rsync + systemctl restart + 浏览器实测

### 5.3 最终结果

**产出物清单**：
- `docs/plans/quota-simplification-plan.md`（本方案文档）
- `panel/backend/src/services/quotaService.ts`（禁用 checkInstanceQuota + 注释）
- `panel/frontend/src/pages/admin/Quotas.tsx`（隐藏实例/玩家配额 UI）
- `version.md`（新增 v4.29.13 条目）
- `current-note.md`（新增 v4.29.13 版本线记录）

**验证结论**：
- 后端 `tsc --noEmit`：quotaService.ts exit 0 无错误
- 前端 `tsc --noEmit`：Quotas.tsx exit 0 无错误
- 预先存在的 nodes.ts / nodeService.ts 错误与本次修改无关

**未部署**：待用户决定部署时执行 rsync + systemctl restart + 浏览器实测（配额管理页仅显示磁盘配额、编辑 Modal 仅磁盘输入框、创建实例不再受 max_instances 拦截）。
