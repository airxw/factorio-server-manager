# 实例删除入口修复 与 有效期功能补齐 方案

> 编制日期：2026-07-29
> 背景：服主反馈"看不到删除实例的入口"且"看不到实例有效期"。经调查，前者为 UX 设计缺陷（按钮存在但禁用无提示），后者为跨四层功能缺失（契约/DB/服务/UI 均无 expires_at）。

---

## 一、问题定位摘要

| 问题 | 性质 | 根因 |
|------|------|------|
| 删除入口"看不见" | UX 设计缺陷 | 按钮存在但仅在 `stopped`/`error` 状态启用，禁用时无任何提示，服主误以为"没有入口" |
| 有效期"看不见" | 跨四层功能缺失 | `ServerSummary` 契约、`servers` 表、`serverService`、前端 UI 均无 `expires_at`；`instance_renewals.new_expires_at` 仅有表结构无服务逻辑 |

---

## 二、第一部分：删除入口修复

### 2.1 问题复现

- **列表页**：[Servers.tsx#L764-L770](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx#L764-L770)（桌面端）、[Servers.tsx#L844-L850](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx#L844-L850)（移动端）
  - `disabled={busy || s.status !== 'stopped'}`
- **详情页**：[ServerDetail.tsx#L774-L780](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L774-L780)
  - `canDelete = displayState === 'stopped' || displayState === 'error'`

当实例处于 `running`/`starting`/`stopping` 时，删除按钮变灰，但用户看不到"为什么不能点"。

### 2.2 修复方案

**方案 A（推荐）：禁用按钮加 tooltip + 行内提示**

1. 桌面端表格：删除按钮 `disabled` 时，鼠标悬停显示 `title="需先停止实例才能删除"`
2. 移动端卡片：删除按钮 `disabled` 时，按钮下方显示小字提示"需先停止实例"
3. 详情页头部：删除按钮 `disabled` 时，按钮旁显示小字提示"仅 stopped/error 状态可删除"

**方案 B：隐藏禁用按钮，改用状态提示**

- 运行中不显示删除按钮，原位置显示"需先停止"文字标签
- 缺点：按钮位置跳动，移动端体验差，不推荐

### 2.3 执行步骤

1. 修改 [Servers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx)：
   - 桌面端删除按钮（L764-L770）：增加 `title` 属性，`disabled` 时为 `"需先停止实例才能删除"`，启用时为 `"删除实例"`
   - 移动端删除按钮（L844-L850）：同上增加 `title`；并在 `disabled` 时于按钮下方渲染 `<span className="form-hint">需先停止</span>`
2. 修改 [ServerDetail.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx)：
   - 删除按钮（L774-L780）：增加 `title` 属性；`disabled` 时于按钮旁渲染小字提示
3. 验证：`running` 状态下悬停/查看删除按钮，应看到明确提示

### 2.4 开发事项

- 仅前端改动，无契约/DB/后端变更
- 无需迁移脚本
- 不影响现有删除逻辑（`INVALID_SERVER_STATE` 错误处理保留）
- 测试：手动验证 `running`/`stopped`/`error` 三种状态下按钮提示正确

---

## 三、第二部分：有效期功能补齐

> ⚠️ 本部分涉及跨四层变更（契约/DB/服务/UI），且存在多个架构决策点。下方先列决策选项与建议，后续执行步骤基于"推荐方案"展开。**决策点需人类裁决后冻结。**

### 3.1 关键决策点（需人类选择）

#### 决策点 1：有效期语义

| 选项 | 含义 | 适用场景 | 建议 |
|------|------|---------|------|
| A. 强制性 | 到期自动停止/删除实例 | 付费制、试用制 | **推荐**（与 `instance_renewals` 续费表设计意图一致，VPS 式月费模型） |
| B. 展示性 | 仅显示到期时间，不自动处理 | 内部记录、提醒 | 不推荐（建表无意义） |
| C. 混合 | 到期前提醒，到期后自动停止但保留数据 | 保守付费制 | 可作为 A 的宽限期子策略 |

#### 决策点 2：有效期设置时机

| 选项 | 含义 | 建议 |
|------|------|------|
| A. 创建实例时指定 | `CreateServer` 流程携带 `expires_at` | **推荐**（与配额/计费一并校验） |
| B. 创建后通过"续费"操作设置/延长 | 复用 `instance_renewals` 表 | **推荐**（与 A 组合，创建时给初始有效期，续费延长） |
| C. 仅续费设置 | 创建时无有效期，首次续费后才有 | 不推荐（新建实例无有效期，语义混乱） |

**建议组合：A + B**——创建时给初始有效期（可由 Pack/配额决定默认天数），续费时延长。

#### 决策点 3：到期处理动作（若决策点 1 选 A 或 C）

| 选项 | 动作 | 建议 |
|------|------|------|
| A. 仅通知 | 到期前 N 天通知服主 + 管理员 | **必选**（无论其他动作如何，通知都应有） |
| B. 自动停止 | 到期时调用 `stopServer`，保留数据 | **推荐**（与决策点 1-C 对应） |
| C. 宽限期后删除 | 停止后 M 天未续费，标记 `marked_for_deletion` 走清理流程 | 可选（保守策略，避免误删） |

**建议组合：A + B + C(可选)**——到期前通知 → 到期自动停止 → 宽限期后可选删除。

#### 决策点 4：与 `instance_renewals` 表的关系

| 选项 | 含义 | 建议 |
|------|------|------|
| A. `servers` 表新增 `expires_at` 字段，`instance_renewals` 作为审计记录 | 查询直接读 `servers.expires_at`，续费时更新该字段并写一条审计 | **推荐**（查询简单，审计完整） |
| B. 仅从 `instance_renewals` 最新记录推算有效期 | 每次 JOIN 查询最新 `new_expires_at` | 不推荐（查询复杂，且首次创建无续费记录） |

### 3.2 推荐方案设计（基于上述建议组合）

**架构决策**：
- `servers` 表新增 `expires_at TEXT NULL`（NULL = 永不过期，兼容内部实例）
- `instance_renewals` 表保留为审计记录，续费时同步更新 `servers.expires_at`
- 创建实例时根据 Pack 配置或请求参数设置初始 `expires_at`
- `scheduler` 新增定时任务：每日检查到期，执行"通知 → 停止 → 标记清理"

### 3.3 执行步骤

#### 步骤 1：DB 层——新增 `servers.expires_at` 字段

1. 新建迁移文件 `panel/backend/src/db/migrations/20260729000001_add_expires_at_to_servers.ts`
2. `up`：`ALTER TABLE servers ADD COLUMN expires_at TEXT NULL`
3. `down`：`ALTER TABLE servers DROP COLUMN expires_at`
4. 索引：`CREATE INDEX IF NOT EXISTS idx_servers_expires_at ON servers(expires_at)`（供 scheduler 查询）
5. 兼容：现有实例 `expires_at` 为 NULL，视为永不过期，不触发到期处理

#### 步骤 2：契约层——`ServerSummary` 新增 `expires_at`

1. 修改 [public/schema/panel-api-types.ts](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L135-L158) 的 `ServerSummary` 接口：
   ```typescript
   /** 实例有效期截止时间（ISO 8601），null 表示永不过期 */
   expires_at: string | null;
   ```
2. 修改 `CreateServerRequest`（如存在）：新增可选字段 `expires_at?: string | null`
3. 更新 `public/schema/CHANGELOG.md`（MINOR 版本：新增可选字段）
4. 更新预生成 Mock：`public/pre_generated_mock/` 中 ServerSummary 相关 mock 增加 `expires_at` 字段

> ⚠️ 此步骤触及 `public/` 目录。按 rules-0 §四-10 与 rules-4 §4.3，`public/` 修改需人类显式授权。本方案文档作为授权依据，执行时仍需在 Edit 前确认。

#### 步骤 3：后端服务层——读写 `expires_at`

1. 修改 [serverService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/serverService.ts)：
   - `listServers` / `getServer` 返回结果增加 `expires_at` 字段
   - `createServer` 接收 `expires_at` 参数（若未提供，按 Pack 默认有效期或 NULL）
   - 新增 `renewServer(instanceId, durationDays, ...)` 方法：更新 `servers.expires_at` + 写 `instance_renewals` 审计记录
2. 修改 [api/routes/servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts)：
   - `POST /servers` 请求体增加 `expires_at` 可选字段
   - 新增 `POST /servers/:id/renew` 续费接口（接收 `duration_days` 等）
3. 权限：续费接口仅 `owner` 或 `admin` 可调用

#### 步骤 4：后端 scheduler——到期处理定时任务

1. 修改 [scheduler.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/scheduler.ts) 或 [scheduler-init.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/scheduler-init.ts)：
   - 新增任务 `checkInstanceExpiry`，每日 00:30 执行
   - 逻辑：
     - 查询 `expires_at <= now()` 的实例
     - 到期前 3 天：通知服主（WS 推送 + 站内消息）
     - 到期当天：调用 `stopServer`（仅 stopped 状态跳过）
     - 到期后 7 天（宽限期）：标记 `marked_for_deletion = 1`，走现有清理流程
2. 配置项：宽限期天数、提前通知天数，通过 `public/config_template/` 配置契约管理

#### 步骤 5：前端展示层——列表页 + 详情页 + 续费入口

1. 修改 [Servers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx)：
   - 表格新增"有效期"列（桌面端），显示 `expires_at` 格式化日期
   - `expires_at` 为 NULL 显示"永久"
   - 临近到期（≤3 天）显示橙色警示，已到期显示红色
   - 移动端卡片 meta 区增加有效期行
2. 修改 [ServerDetail.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx)：
   - 信息卡（L866-L970）新增"有效期"行
   - 临近到期时显示"续费"按钮，跳转续费流程
3. 新增续费页面/弹窗：
   - 展示当前有效期、续费方案（时长 + 价格）、扣款预览
   - 调用 `POST /servers/:id/renew`
4. 修改 [CreateServer.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/CreateServer.tsx)：
   - 创建表单增加"有效期"选择（若 Pack 配置了计费周期）

### 3.4 开发事项

- **契约变更**：`ServerSummary` 新增字段，按 rules-3 §六 为 MINOR 版本，通知依赖模块不阻断
- **DB 迁移**：新增字段为 NULL 默认，兼容现有数据，无需前置数据迁移
- **孤岛代码**：`instance_renewals` 表当前无服务逻辑，本方案将其接入续费流程，消除孤岛
- **配置契约**：宽限期/通知天数通过 `public/config_template/` 管理，禁止硬编码
- **测试**：
  - 单测：`renewServer` 正确更新 `expires_at` + 写审计
  - 单测：scheduler 到期判断逻辑（mock 时间）
  - E2E：创建带有效期的实例 → 到期 → 自动停止（mock scheduler 触发）
  - 前端 Mock 回归：列表/详情正确显示有效期

---

## 六、建议

1. **删除入口修复**与**有效期功能补齐**可独立推进，前者仅前端改动可先行合流。
2. 有效期功能涉及计费/扣款逻辑（`instance_renewals` 表已有 `amount_paid`/`wallet_source` 等字段），建议与现有钱包/CDK/VIP 计费体系对齐，避免重复造轮子。
3. 有效期功能落地前，建议先冻结决策点 1-4，再进入 S2 契约冻结流程（按 rules-1 阶段状态机）。
4. `instance_renewals` 表当前为孤岛（建表无逻辑），本方案将其接入续费流程，符合 rules-0 §四-13 运行时接入闭合判据。

---

## 五、待人类裁决事项

| 决策点 | 选项 | 推荐 |
|--------|------|------|
| 1. 有效期语义 | A 强制 / B 展示 / C 混合 | A（或 C） |
| 2. 设置时机 | A 创建时 / B 续费时 / C 仅续费 | A + B |
| 3. 到期动作 | A 通知 / B 自动停止 / C 宽限期删除 | A + B + C(可选) |
| 4. 与续费表关系 | A servers 加字段 / B 仅从续费表推算 | A |

> 以上决策点冻结后，方可进入 S2 契约冻结（修改 `public/schema/panel-api-types.ts`）。
