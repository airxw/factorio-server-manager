# 强制游戏角色绑定才能获得 VIP — Spec

## Why

当前架构存在 VIP 语义断链问题：

1. **根因**：[getVipLevelByGamePlayerName](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.ts#L641-L674) 通过 `bindings(binding_type='player', scope_type='instance')` 反查 `user_id`，再委托 [getUserVipLevel](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.ts#L262-L298) 查 `bindings(binding_type='account')` 拿 `vip_level`。链路要求 player 绑定 + account 绑定**同时存在**才能反查到 VIP。

2. **现状漏洞**：[bindInstance](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.ts#L133-L212) 允许用户仅创建账户级绑定即获 VIP1，无需游戏角色验证。这部分 VIP 在面板内有效（[walletService](file:///home/airxw/gsp/panel/backend/src/services/walletService.ts#L111) / [shopService](file:///home/airxw/gsp/panel/backend/src/services/shopService.ts#L198) 按 userId 查），但游戏内反查路径（[voteService](file:///home/airxw/gsp/panel/backend/src/services/voteService.ts#L823) 按 player_name 查）无法识别。

3. **业务后果**：服务器端发起 VIP 欢迎消息（`player_join_settings.vip_welcome_messages`）时，仅有 player_name，若该 player 未绑定角色则查不到 VIP 等级，欢迎消息无法触发。

## What Changes

### 决策 1：bindInstance 保留但 `vip_level=0`

**文件**：[instanceBindingService.ts#L133-L212](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.ts#L133-L212) `bindInstance`

**变更**：
- 保留 API 签名与路由 `POST /api/instances/:serverId/bindings`
- INSERT 时 `vip_level` 从 `DEFAULT_BOUND_VIP_LEVEL(1)` 改为 `0`
- 复活已解绑记录时同理：`vip_level=0`
- 注释更新：`bindInstance` 创建的是"无 VIP 的账户级绑定"，VIP 仅由 `verifyBindingByCode` 路径赋予

**契约影响**：[bindings-schema.json](file:///home/airxw/gsp/public/schema/bindings-schema.json) `vip_level` 字段描述更新（PATCH 级别，仅文档修正，不改字段定义）

### 决策 2：历史仅账户绑定记录软删除

**新增迁移脚本**：`panel/backend/src/db/migrations/20260801000000_revoke_account_only_bindings.ts`

**逻辑**：
```sql
-- 扫描所有 verified 账户级绑定，无对应 verified player 绑定的记录 → verify_status='revoked'
UPDATE bindings
SET verify_status = 'revoked',
    metadata = json_patch(metadata, '{"unbound_at": "<now>", "source": "migration_revoke_account_only"}'),
    updated_at = '<now>'
WHERE binding_type = 'account'
  AND scope_type = 'instance'
  AND verify_status = 'verified'
  AND NOT EXISTS (
    SELECT 1 FROM bindings p
    WHERE p.user_id = bindings.user_id
      AND p.binding_type = 'player'
      AND p.scope_type = 'instance'
      AND p.scope_ref = bindings.scope_ref
      AND p.verify_status = 'verified'
  );
```

**幂等性**：迁移脚本可重复执行，已 revoked 的记录不重复处理

**回滚**：提供 down 脚本（恢复 verify_status='verified' + vip_level=1），但需人工确认

### 决策 3：UI 整合（方向 2 + 方向 3 组合）

#### 3.1 GuildDock 首页合并展示

**文件**：[GuildDock.tsx#L553-L659](file:///home/airxw/gsp/panel/frontend/src/pages/guild/GuildDock.tsx#L553-L659)

**变更**：
- 删除两个独立 section（"账户级绑定" + "游戏角色绑定"）
- 新增单一 section "我的绑定"，按 server_id 聚合展示
- 聚合逻辑：
  ```ts
  const aggregated = useMemo(() => {
    const map = new Map<string, { server: ServerSummary; account?: MyBinding; players: Binding[] }>();
    // 1. 以 account binding 为基础填充
    for (const b of accountBindings) {
      map.set(b.serverId, { server: serverMap.get(b.serverId)!, account: b, players: [] });
    }
    // 2. 以 player binding 补充（可能存在无 account 的 server）
    for (const p of playerBindings) {
      const sid = p.scope_ref ?? '';
      if (!map.has(sid)) {
        map.set(sid, { server: serverMap.get(sid)!, account: undefined, players: [] });
      }
      map.get(sid)!.players.push(p);
    }
    return Array.from(map.values());
  }, [accountBindings, playerBindings, serverMap]);
  ```
- 单卡组件 `UnifiedBindingCard`：实例名 + VIP徽章（来自 account.vipLevel）+ 角色验证徽章（players 中是否有 verified）+ 进入按钮
- 空状态：保留"立即绑定游戏角色"主 CTA

#### 3.2 GuildBind 管理页简化为单向导

**文件**：[GuildBind.tsx#L545-L609](file:///home/airxw/gsp/panel/frontend/src/pages/guild/GuildBind.tsx#L545-L609)

**变更**：
- 删除顶部 SegmentedControl（player / account 切换）
- 默认进入"游戏角色绑定向导"（步骤1选实例+填角色名 → 步骤2展示验证码 → 步骤3验证）
- 账户级解绑入口迁移到服务器详情页（[ServerDetail.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx)）
- 已绑定角色列表展示在向导下方
- URL query `?type=account` 不再支持（向后兼容：自动重定向到 `?type=player`）

### 决策 4：verify 成功立即广播 VIP 欢迎消息（Panel 端直接驱动）

> **架构说明（GN-004 审查修正）**：原方案"daemon 端订阅 eventBus 事件"不可行——eventBus.ts 是 Panel 进程内 EventEmitter，daemon 作为独立进程无法订阅。改为 **Panel 端直接驱动 RCON 调用**，复用已有 `playerService.getVipWelcomeMessage` + `daemonClient.sendCommand` 能力。`player.binding_verified` 仅作 Panel 内部 eventBus 事件（日志/审计用），**不进 public/schema/ws-events.ts 跨进程契约**。

#### 4.1 Panel 内部事件总线事件（不进 public/ 契约）

**文件**：[eventBus.ts](file:///home/airxw/gsp/panel/backend/src/services/eventBus.ts)（仅 Panel 内部，不修改 public/schema/ws-events.ts）

**新事件**：`player.binding_verified`（Panel 进程内 EventEmitter 事件，仅供 Panel 内部审计/日志订阅）
```ts
interface PlayerBindingVerifiedEvent {
  type: 'player.binding_verified';
  server_id: string;
  user_id: string;
  player_name: string;
  vip_level: number;  // 验证后获得的 VIP 等级（1）
  verified_at: string;  // ISO 8601
}
```

**契约影响**：无跨进程契约变更。`player.binding_verified` 不进 [ws-events.ts](file:///home/airxw/gsp/public/schema/ws-events.ts)，避免混淆 DaemonToPanelEvent / PanelToDaemonCommand / PanelToFrontendEvent 三类既有契约。

#### 4.2 verifyBindingByCode 触发广播（Panel 端直接 RCON 调用）

**文件**：
- [instanceBindingService.ts#L501-L625](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.ts#L501-L625) `verifyBindingByCode`
- 新增依赖注入：`playerService.getVipWelcomeMessage` + `daemonClient.sendCommand`

**变更**：
1. 事务提交后（非事务内，避免事务回滚导致假广播）：
   - emit Panel 内部 `player.binding_verified` 事件（审计/日志用）
   - 调用 `playerService.getVipWelcomeMessage(serverId, vipLevel)` 获取欢迎语（复用 [playerService.ts#L841](file:///home/airxw/gsp/panel/backend/src/services/playerService.ts#L841) 已有方法）
   - 模板变量替换：`{player_name}` / `{vip_level}`
   - 调用 `daemonClient.sendCommand(nodeId, serverId, 'say ' + 欢迎语)` 发送 RCON 命令（复用 [backupService.ts#L577](file:///home/airxw/gsp/panel/backend/src/services/backupService.ts#L577) / [commandDispatcher.ts#L213](file:///home/airxw/gsp/panel/backend/src/services/commandDispatcher.ts#L213) 已有通道）
2. 仅当 `existingAccountBinding.verify_status !== 'verified'`（首次绑定或复活）时广播，避免重复广播
3. 错误处理：
   - `getVipWelcomeMessage` 返回空（vip_welcome_messages 未配置）→ 静默跳过，不报错
   - `daemonClient.sendCommand` 失败 → 记录 warning 日志，不抛错（verify 已成功，不阻塞主流程）
   - 查询 `servers.node_id` 失败 → 记录 error 日志，不抛错

**node_id 获取**：verifyBindingByCode 已有 serverId，需 JOIN servers 表查 node_id（或复用已有 serverService.getServerById）

## Impact

### 受影响文件清单

**后端**：
- [instanceBindingService.ts](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.ts) — bindInstance/verifyBindingByCode 改造 + 新增 RCON 广播逻辑
- [eventBus.ts](file:///home/airxw/gsp/panel/backend/src/services/eventBus.ts) — 新增 Panel 内部事件类型（不进 public/ 契约）
- 新增迁移脚本 `20260801000000_revoke_account_only_bindings.ts`
- 复用 [playerService.ts#L841](file:///home/airxw/gsp/panel/backend/src/services/playerService.ts#L841) `getVipWelcomeMessage`（已有方法，在 verify 路径中新增运行时接入点）
- 复用 [daemonClient.sendCommand](file:///home/airxw/gsp/panel/backend/src/services/backupService.ts#L577)（已有 RCON 通道，实际签名 4 参数：`(nodeId, serverId, command, requestId)`）

**契约（走 s0601 流程）**：
- [bindings-schema.json](file:///home/airxw/gsp/public/schema/bindings-schema.json) — vip_level 字段描述更新（PATCH，仅文档修正）
- **不修改** [ws-events.ts](file:///home/airxw/gsp/public/schema/ws-events.ts) — `player.binding_verified` 是 Panel 内部事件，不进跨进程契约

**前端**：
- [GuildDock.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/guild/GuildDock.tsx) — 合并展示
- [GuildBind.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/guild/GuildBind.tsx) — 去掉 SegmentedControl
- [ServerDetailCore.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx) — 接收账户级解绑入口

**测试**：
- [instanceBindingService.test.ts](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.test.ts) — 新逻辑单测
- [guild-portal.spec.ts](file:///home/airxw/gsp/panel/frontend/e2e/guild-portal.spec.ts) — E2E 更新
- [role-switching.spec.ts](file:///home/airxw/gsp/panel/frontend/e2e/role-switching.spec.ts) — E2E 更新

### 版本影响
- 中版本号 +1（新功能 + 行为变更）
- BUILD_ID 按部署日期生成

## Non-Goals (Out of Scope)

- 不删除 `bindInstance` API（保留兼容路径，仅改语义）
- 不修改 `getUserVipLevel` 的查询逻辑（仍查 account binding，但 account binding 的 vip_level 来源变了）
- 不修改 `getVipLevelByGamePlayerName` 的反查链路（已正确：player → user → account → vip_level）
- 不调整 VIP 等级体系（仍为 0-5）
- 不修改 voteService / shopService / walletService 的调用方式（接口不变）
- 不实现"verify 失败时给出更详细错误"等增强（保持现有错误码）

## Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| 历史数据迁移误删 | 仅账户绑定用户失去 VIP（**预期行为**：这些用户本就不该有 VIP，因决策 1 已修正语义） | 迁移前备份；down 脚本可恢复；迁移脚本幂等 |
| `bindInstance` 调用方依赖 VIP1 | 创建后无 VIP 可能影响下游 | 检查所有调用方（已识别：bindInstance 仅在 GuildBind/GuildDock 调用，下游 getUserVipLevel 已兼容 vip_level=0） |
| RCON 广播失败 | verify 成功但游戏内无欢迎消息 | 错误处理：sendCommand 失败仅记 warning 日志，不阻塞 verify 主流程 |
| E2E 测试断言失效 | SegmentedControl 删除后断言找不到元素 | 同步更新 guild-portal.spec.ts |
| 老用户认知断崖 | "我的绑定"列表中账户级绑定消失 | 仅账户绑定的记录已 revoked，UI 不展示；用户需重新走角色验证 |

### 决策 2 对现有调用方的影响归类

迁移脚本 revoke"仅账户绑定"记录后，`getUserVipLevel` 返回值从 1 变 0，影响 voteService/shopService/walletService 实际行为（接口签名不变，但返回值变了）。**这是预期行为而非回归**——这些用户在游戏内反查路径本就查不到 VIP（决策 1 已修正语义），迁移脚本只是把面板内的"虚高 VIP"也同步降级，使两条路径一致。

## Verification

- 单测：`instanceBindingService.test.ts` 覆盖 bindInstance(vip=0) + verifyBindingByCode(广播事件)
- 单测：迁移脚本测试（插入仅账户绑定 → 运行迁移 → 验证 revoked）
- 内置浏览器核对：GuildDock 首页单卡展示 + GuildBind 单向导
- 单测覆盖：verify 成功后 RCON 调用链（mock daemonClient.sendCommand 验证 say 命令发送 + 模板变量替换）
- 契约校验：bindings-schema.json 通过 zod/ajv 校验（ws-events.ts 不修改）
