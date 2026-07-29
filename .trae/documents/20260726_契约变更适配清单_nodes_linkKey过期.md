# 契约变更适配清单 — nodes linkKey 过期机制

> 本文档由 s0601-adapting-contract-changes 生成，记录对 `public/schema/panel-api-types.ts` 的契约变更影响面识别与适配接续清单。

## 一、变更摘要

### 变更 1：CreateNodeInviteResponse 新增 expires_at 字段

**旧契约**（[panel-api-types.ts:193-199](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L193-L199)）：

```ts
export interface CreateNodeInviteResponse {
  node_id: string;
  link_key: string;
  slave_command: string;
}
```

**新契约**：

```ts
export interface CreateNodeInviteResponse {
  node_id: string;
  link_key: string;
  slave_command: string;
  /** linkKey 过期时间（ISO 8601），超时后 slave 无法用此 linkKey 注册 */
  expires_at: string;
}
```

**变更级别**：MINOR（新增必填字段，但通过迁移脚本为历史 pending 节点回填保证兼容）

### 变更 2：新增错误码 NODE_LINK_KEY_EXPIRED

**旧契约**（[panel-api-types.ts:452-457](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L452-L457)）：无此错误码

**新契约**：

```ts
// v5.0.0 新增错误码（L2 Daemon 集群化管理）
NODE_LINK_KEY_INVALID: 'NODE_LINK_KEY_INVALID',
NODE_ALREADY_LINKED: 'NODE_ALREADY_LINKED',
NODE_HAS_ACTIVE_INSTANCES: 'NODE_HAS_ACTIVE_INSTANCES',
NODE_COMMS_KEY_INVALID: 'NODE_COMMS_KEY_INVALID',
NODE_MASTER_NOT_DELETABLE: 'NODE_MASTER_NOT_DELETABLE',
NODE_LINK_KEY_EXPIRED: 'NODE_LINK_KEY_EXPIRED',  // 新增
```

**变更级别**：MINOR（新增枚举值，不破坏现有契约）

## 二、影响面分级

### 2.1 必须立即阻断

无。本次变更为新增字段 + 新增错误码，不破坏现有功能，无需阻断其他并行分支。

### 2.2 必须同步更新

| # | 资产路径 | 影响说明 | 同步动作 |
|---|---------|---------|---------|
| 1 | `public/schema/panel-api-types.ts` | 契约本身 | 新增 `expires_at` 字段 + `NODE_LINK_KEY_EXPIRED` 错误码 |
| 2 | `panel/backend/src/services/nodeService.ts` | createInvite / regenerateInvite / linkSlave 实现 | createInvite / regenerateInvite 返回 expiresAt；linkSlave 增加过期校验，过期抛 NODE_LINK_KEY_EXPIRED |
| 3 | `panel/backend/src/api/routes/nodes.ts` | POST / 和 POST /:id/regenerate-invite 路由 | 返回值透传 expires_at 字段；新增 GET /invite/:linkKey/bootstrap-script 端点（步骤 1） |
| 4 | `panel/backend/src/services/nodeService.test.ts` | 测试覆盖 | 新增 createInvite 过期时间断言 / linkSlave 过期拒绝测试 |
| 5 | `panel/frontend/src/api/modules/servers.ts` | API 客户端 | 新增 regenerateNodeInvite 方法（类型从 public 导入自动同步） |
| 6 | `panel/frontend/src/api/client.ts` | 引用 CreateNodeInviteResponse | 类型自动同步，无需手动改 |
| 7 | `panel/frontend/src/pages/admin/Nodes.tsx` | 页面展示 | 邀请结果弹窗展示 expires_at；pending 节点行展示过期提示 |
| 8 | `panel/backend/src/db/migrations/` | 数据库迁移 | 新增 `link_key_expires_at` 列到 nodes 表；为 status='pending' 的历史节点回填 `now + 24h` |

### 2.3 可延后复核

| # | 资产路径 | 影响说明 | 延后理由 |
|---|---------|---------|---------|
| 9 | `docs/api/02-server-instance.md` | API 文档 | 文档更新可在功能闭合后统一补 |
| 10 | `version.md` | 版本记录 | 部署前更新即可 |
| 11 | `README.md` | 版本号 | 部署前更新即可 |

### 2.4 Mock 影响

- `public/pre_generated_mock/` 下**无 nodes 相关 Mock**（仅有 permission-service / auth-service / bindings / webhook-receiver / mock_execution_engine / mock_asset_service / rcon-mock-server）
- **无需重新生成 Mock**

### 2.5 接口存根影响

- `public/interface_stub/` 下**无 nodes 相关 .d.ts 存根**（nodes 契约仅存在于 `panel-api-types.ts`）
- **无需更新接口存根**

### 2.6 测试入口影响

- `public/test_cases/` 下**无 nodes 相关测试用例**
- 仅需在 `panel/backend/src/services/nodeService.test.ts` 中新增测试
- **无需新增 public/test_cases 下的契约测试**

## 三、同步顺序

```
1. 契约冻结：public/schema/panel-api-types.ts
        ↓ （契约一旦落位，下游可并行）
2a. 后端实现：nodeService.ts + nodes.ts 路由
2b. 数据库迁移：新增 link_key_expires_at 列
        ↓ （后端实现依赖迁移）
3. 后端测试：nodeService.test.ts
        ↓ （前端可基于新契约并行）
4. 前端消费：servers.ts API 客户端 + Nodes.tsx 页面
        ↓
5. 文档更新：docs/api + version.md + README.md
```

## 四、回退锚点

- **契约回退点**：`public/schema/panel-api-types.ts` 修改前的 git HEAD（可通过 `git diff` 查看原始内容）
- **后端回退点**：`nodeService.ts` / `nodes.ts` 修改前的 git HEAD
- **数据库回退点**：迁移前备份 `data/panel.db`；回退时执行 down migration（`ALTER TABLE nodes DROP COLUMN link_key_expires_at`，SQLite 3.35+ 支持）
- **前端回退点**：`Nodes.tsx` / `servers.ts` 修改前的 git HEAD

若契约变更导致下游编译失败：
1. 先回退 `public/schema/panel-api-types.ts` 到修改前
2. 再回退后端实现到修改前
3. 数据库迁移若已执行，执行 down migration
4. 前端因类型从 public 导入，回退契约后会自动同步

## 五、未闭合项

- 无未闭合项。变更已被人类授权（用户选择走 s0601 流程），差异已识别，影响面已分级，同步顺序已明确，回退锚点已锁定。

## 六、接续入口

- 本适配清单闭合后，进入局部适配执行
- 执行顺序按"二、执行步骤"中的 7 个步骤推进（见 [docs/plans/nodes-add-node-fix-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/nodes-add-node-fix-plan.md)）
- 每步执行后需通过 `tsc --noEmit` + 对应单测验证
- 全部完成后需提醒主线程拉起独立审查（GN-004）对本适配结论进行独立审查

## 七、状态

- **三值状态**：已闭合
- **变更批准状态**：已批准（人类选择走 s0601 流程）
- **差异真实性**：已确认（读取旧契约对比）
- **影响面完整性**：已覆盖 Mock / 规则模板 / 模块拆分 / 测试入口 / 实现分支五类
- **同步顺序**：已明确
- **回退锚点**：已锁定
