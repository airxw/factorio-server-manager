# Task 3 输出 — eventBus + verifyBindingByCode 触发 RCON 广播（Panel 端直接驱动）

## 工程过程

1. 读取 spec.md 决策 4 + tasks.md Task 3 全文，确认架构方向（Panel 端直接 RCON 调用，非 daemon 订阅）
2. 读取 eventBus.ts / instanceBindingService.ts / playerService.ts / backupService.ts / services-init.ts / daemonClientService.ts / event-bus.d.ts / db-helper.ts，确认现有事件类型定义方式、verifyBindingByCode 结构、sendCommand 4 参数签名、依赖注入架构
3. 架构决策：playerService / daemonClientService 在 services-init.ts 中通过工厂函数实例化（非 module-level singleton），无法直接 import。采用**模块级 setter 模式**（services-init 注入的一种形式，tasks.md 步骤 2 明确允许并要求说明）
4. eventBus.ts：新增 PLAYER_BINDING_VERIFIED 常量 + PlayerBindingVerifiedEvent 接口（Panel 内部，不进 public/schema/ws-events.ts）
5. instanceBindingService.ts：新增 InstanceBindingServiceDeps 接口 + setInstanceBindingServiceDeps setter + broadcastVipWelcome 辅助函数 + verifyBindingByCode 事务提交后广播逻辑
6. services-init.ts：创建 playerService 后调用 setInstanceBindingServiceDeps({ playerService, daemonClientService })，接入运行时（非孤岛）
7. instanceBindingService.test.ts：追加 5 个单测（首次绑定 / 已 verified 不广播 / getVipWelcomeMessage 返回空 / sendCommand 失败 / 复活 revoked 绑定）
8. 修复 tsc 错误：seedPendingVerifyCode 函数声明结尾误用 `});` → `}`；Knex `.where({ id })` 泛型推断冲突 → `.where('id', serverId)`
9. 验证通过：tsc --noEmit（仅 pre-existing nodes.ts 错误）+ vitest 9/9 PASS

## 交接状态

- **状态**：已完成
- **前置依赖**：Task 1（bindInstance 改造 vip_level=0 + BIND_INSTANCE_VIP_LEVEL 常量）已完成
- **下游依赖**：无（Task 8 测试可复用本任务的测试用例）

## 最终结果

### 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `panel/backend/src/services/eventBus.ts` | 修改 | 新增 PLAYER_BINDING_VERIFIED 常量 + PlayerBindingVerifiedEvent 接口（Panel 内部，不进 public/） |
| `panel/backend/src/services/instanceBindingService.ts` | 修改 | 新增 setInstanceBindingServiceDeps setter + broadcastVipWelcome 函数 + verifyBindingByCode 事务提交后广播逻辑 |
| `panel/backend/src/services-init.ts` | 修改 | 调用 setInstanceBindingServiceDeps 接入运行时（playerService + daemonClientService 注入） |
| `panel/backend/src/services/instanceBindingService.test.ts` | 修改（追加） | Task 3 单测 5 个场景 |

### 未修改文件（确认）

- `public/schema/ws-events.ts` — **未修改**（player.binding_verified 是 Panel 内部事件，不进跨进程契约）
- `panel/backend/src/services/playerService.ts` — 未修改（仅复用 getVipWelcomeMessage）
- `panel/backend/src/services/daemonClientService.ts` — 未修改（仅复用 sendCommand）

### 验证结果

- `npx tsc --noEmit`：通过（仅 pre-existing `src/api/routes/nodes.ts` ServerSummary 类型错误，与本任务无关）
- `npx vitest run src/services/instanceBindingService.test.ts`：9/9 PASS（Task 1 的 4 个 + Task 3 的 5 个）
- `ws-events.ts` 未被修改：已通过 `git status` 确认

### 闭合判据核对

- [x] Panel 内部事件类型定义（不进 public/）— PLAYER_BINDING_VERIFIED 在 eventBus.ts，不在 ws-events.ts
- [x] verifyBindingByCode 触发完整调用链（emit + getVipWelcomeMessage + sendCommand）
- [x] 重复 verify 不广播（existingAccountBinding.verify_status === 'verified' 时 shouldBroadcast=false）
- [x] 错误处理覆盖 3 种场景（getVipWelcomeMessage 空 / sendCommand 失败 / node_id 查询失败）
- [x] 单测 PASS
- [x] playerService.getVipWelcomeMessage 被接入运行时（非孤岛，rules-0 §四-13）— services-init.ts 调用 setInstanceBindingServiceDeps
- [x] tsc --noEmit 通过（仅 pre-existing 无关错误）
- [x] ws-events.ts 未被修改

### 依赖注入方式说明

tasks.md Task 3 步骤 2 推荐"选项 C：直接 import playerService + daemonClientService"。经核查，playerService / daemonClientService 在 services-init.ts 中通过 `createPlayerService(db)` / `createDaemonClient(db, registry, DAEMON_URL, DAEMON_TOKEN)` 工厂函数实例化并持有在 ServiceContainer 中，**非 module-level singleton**，无法直接 import。

采用**模块级 setter 模式**（services-init 注入的一种形式，tasks.md 明确允许"若选工厂函数或 services-init 注入，需在步骤中说明"）：
- `setInstanceBindingServiceDeps({ playerService, daemonClientService })` 由 services-init.ts 在创建两个服务后调用
- 测试通过 `setInstanceBindingServiceDeps({ mock... })` 注入 mock，`setInstanceBindingServiceDeps(null)` 重置
- 未注入时 `_deps=null`，verifyBindingByCode 静默跳过广播（不阻塞主流程）

### 运行时接入证据（rules-0 §四-13）

- `services-init.ts:208` 调用 `setInstanceBindingServiceDeps({ playerService, daemonClientService })`
- `instanceBindingService.ts` import `eventBus` + `PLAYER_BINDING_VERIFIED`（eventBus 是已有运行时单例）
- `verifyBindingByCode` 被 `inGameCommandService` 通过 `deps.verifyBindingByCode` 在运行时调用（services-init.ts:212）
- 调用链：游戏内 `!verify` → inGameCommandService → verifyBindingByCode → broadcastVipWelcome → eventBus.emit + playerService.getVipWelcomeMessage + daemonClient.sendCommand
