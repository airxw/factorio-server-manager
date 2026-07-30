# 强制游戏角色绑定才能获得 VIP — Tasks

> 来源：[spec.md](./spec.md)
> 阶段：S3 模块拆分 / S4 并行开发
> 并行上限：每批 ≤ 2（rules-0 §四-4）
> **GN-004 审查修正**：删除原 Task 4（daemon 端订阅），合并到 Task 3（Panel 端直接 RCON 调用）

## 任务依赖 DAG

```
Task 7 (契约 s0601) ──┐
                      ├─→ Task 2 (迁移) ──┐
Task 1 (bindInstance) ─→ Task 3 (eventBus + RCON 广播) ──┐
                      │                                  ├─→ Task 8 (测试) ─→ Task 9 (合流)
                      ├─→ Task 4 (前端 GuildDock)        │
                      │                                  │
                      └─→ Task 5 (前端 GuildBind) ─→ Task 6 (ServerDetail) ──┘
```

注：原 Task 4（daemon 订阅）已删除，Task 3 承担 Panel 端直接 RCON 调用。后续 Task 编号重排。

## 任务清单

### Task 1: 后端 — bindInstance 改造（vip_level=0）

**文件**：[instanceBindingService.ts#L133-L212](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.ts#L133-L212)

**步骤**：
1. `DEFAULT_BOUND_VIP_LEVEL` 常量保留（仍用于 verifyBindingByCode），新增 `BIND_INSTANCE_VIP_LEVEL = 0`
2. `bindInstance` 函数中 INSERT 与复活路径使用 `BIND_INSTANCE_VIP_LEVEL`
3. 更新函数注释：明确"bindInstance 创建无 VIP 的账户级绑定，VIP 由 verifyBindingByCode 赋予"
4. 单测：`bindInstance` 创建的记录 `vip_level === 0`
5. 单测：`bindInstance` 复活已 revoked 记录后 `vip_level === 0`

**闭合判据**：
- [ ] `tsc --noEmit` 通过
- [ ] 单测 PASS
- [ ] 注释明确说明新语义

---

### Task 2: 后端 — 迁移脚本 + 测试

**新增文件**：`panel/backend/src/db/migrations/20260801000000_revoke_account_only_bindings.ts`

**步骤**：
1. up 函数：扫描 `binding_type='account' AND verify_status='verified'` 且无对应 verified player 绑定的记录，更新为 `verify_status='revoked'` + metadata.unbound_at
2. down 函数：恢复 `verify_status='verified'` + `vip_level=1`（人工确认后执行）
3. 幂等性：已 revoked 的记录不重复处理
4. 单测：插入测试数据（仅账户绑定 / 账户+玩家绑定 / 已 revoked）→ 运行迁移 → 验证结果

**闭合判据**：
- [ ] 迁移脚本 up/down 均可执行
- [ ] 单测覆盖 3 种数据场景
- [ ] 幂等性测试 PASS

---

### Task 3: 后端 — eventBus + verifyBindingByCode 触发 RCON 广播（Panel 端直接驱动）

> **GN-004 审查修正**：原方案"daemon 端订阅事件"不可行（eventBus 是 Panel 进程内 EventEmitter，daemon 无法跨进程订阅）。改为 Panel 端事务提交后直接调用 `playerService.getVipWelcomeMessage` + `daemonClient.sendCommand`。

**文件**：
- [eventBus.ts](file:///home/airxw/gsp/panel/backend/src/services/eventBus.ts) — 新增 Panel 内部事件类型（不进 public/ 契约）
- [instanceBindingService.ts#L501-L625](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.ts#L501-L625) `verifyBindingByCode`
- 复用 [playerService.ts#L841](file:///home/airxw/gsp/panel/backend/src/services/playerService.ts#L841) `getVipWelcomeMessage`
- 复用 [daemonClient.sendCommand](file:///home/airxw/gsp/panel/backend/src/services/backupService.ts#L577)（已有 RCON 通道）

**步骤**：
1. eventBus 新增 Panel 内部事件类型 `player.binding_verified`（payload: server_id/user_id/player_name/vip_level/verified_at）— 仅供 Panel 内部审计/日志订阅，**不进 public/schema/ws-events.ts**
2. **依赖注入方式**（实现前决策）：`verifyBindingByCode` 当前是模块级导出函数（非类方法，无 DI 机制）。推荐选项 C：直接 `import playerService` + `import daemonClientService`（与 backupService.ts L577 / commandDispatcher.ts L213 现有调用方式一致）。若选工厂函数或 services-init 注入，需在步骤中说明。
3. `verifyBindingByCode` 事务提交后（非事务内）：
   - emit `player.binding_verified` 事件（审计用）
   - 查询 `servers.node_id`：实现前核查 `serverService.getServerById` 是否存在；若不存在则直接 JOIN servers 表（`SELECT node_id FROM servers WHERE id = ?`）
   - 调用 `playerService.getVipWelcomeMessage(serverId, vipLevel)` 获取欢迎语
   - 模板变量替换：`{player_name}` / `{vip_level}`
   - 调用 `daemonClient.sendCommand(nodeId, serverId, 'say ' + 欢迎语, requestId)` — **注意 4 参数签名**（参考 [backupService.ts#L576-L577](file:///home/airxw/gsp/panel/backend/src/services/backupService.ts#L576-L577) 的 requestId 生成模式：`${serverId}-verify-${Date.now()}-${Math.random()...}`）
4. 仅当 `existingAccountBinding.verify_status !== 'verified'`（首次绑定或复活）时广播，避免重复广播
5. 错误处理（不阻塞 verify 主流程）：
   - `getVipWelcomeMessage` 返回空 → 静默跳过
   - `daemonClient.sendCommand` 失败 → 记录 warning 日志
   - `servers.node_id` 查询失败 → 记录 error 日志
6. 单测：mock eventBus.emit + playerService.getVipWelcomeMessage + daemonClient.sendCommand，验证调用链 + payload
7. 单测：existingAccountBinding 已 verified 时不广播
8. 单测：getVipWelcomeMessage 返回空时不调用 sendCommand
9. 单测：sendCommand 失败时不抛错

**闭合判据**：
- [ ] Panel 内部事件类型定义（不进 public/）
- [ ] verifyBindingByCode 触发完整调用链
- [ ] 重复 verify 不广播
- [ ] 错误处理覆盖 3 种场景
- [ ] 单测 PASS
- [ ] `playerService.getVipWelcomeMessage` 被接入运行时（非孤岛，rules-0 §四-13）

---

### Task 4: 前端 — GuildDock 合并展示

**文件**：[GuildDock.tsx#L553-L659](file:///home/airxw/gsp/panel/frontend/src/pages/guild/GuildDock.tsx#L553-L659)

**步骤**：
1. 删除"账户级绑定" + "游戏角色绑定"两个独立 section
2. 新增 `aggregated` useMemo（按 server_id 聚合 account + players）
3. 新增 `UnifiedBindingCard` 组件：
   - 头部：实例名 + 游戏类型
   - 徽章：VIP 等级（来自 account.vipLevel）+ 角色验证状态（players 中 verified 数量）
   - 操作：进入实例 / 管理绑定
4. 空状态：保留"立即绑定游戏角色"主 CTA
5. 移动端视口守卫（rules-0 §3.1.6）：min-height: 100dvh + overflow-y: auto

**闭合判据**：
- [ ] tsc --noEmit 通过
- [ ] vite build 通过
- [ ] 内置浏览器核对首页单卡展示
- [ ] 移动端视口无溢出

---

### Task 5: 前端 — GuildBind 去掉 SegmentedControl

**文件**：[GuildBind.tsx#L545-L609](file:///home/airxw/gsp/panel/frontend/src/pages/guild/GuildBind.tsx#L545-L609)

**步骤**：
1. 删除 SegmentedControl（player / account 切换）
2. 删除 `bindType` state + `switchType` callback + URL query 处理
3. 默认渲染"游戏角色绑定向导"分支
4. URL `?type=account` 自动重定向到 `?type=player`（兼容老链接）
5. 删除账户级向导分支相关代码（AccountBindingRow 保留供 ServerDetailCore 复用）
6. 已绑定角色列表展示在向导下方

**闭合判据**：
- [ ] tsc --noEmit 通过
- [ ] vite build 通过
- [ ] 内置浏览器核对单向导流程
- [ ] URL `?type=account` 自动重定向

---

### Task 6: 前端 — ServerDetailCore 接收账户级解绑入口

**文件**：[ServerDetailCore.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx)

**步骤**：
1. 在实例详情页新增"账户级绑定"管理区块（仅对当前用户已绑定该实例时显示）
2. 展示 VIP 等级 + 绑定时间 + 解绑按钮
3. 复用 GuildBind 中 `AccountBindingRow` 组件（提取到 shared components）
4. 解绑 API 调用 `DELETE /api/instances/:serverId/bindings`

**闭合判据**：
- [ ] tsc --noEmit 通过
- [ ] 内置浏览器核对解绑流程

---

### Task 7: 契约 — bindings-schema 描述更新（走 s0601 流程）

**文件**：
- [bindings-schema.json](file:///home/airxw/gsp/public/schema/bindings-schema.json)
- [CHANGELOG.md](file:///home/airxw/gsp/public/schema/CHANGELOG.md)

**步骤**：
1. **走 s0601 契约变更适配流程**（rules-0 §四-10 + s0601）：
   - 识别变更影响面：bindings-schema.json `vip_level` 描述更新（PATCH 级别）
   - 依赖模块 TODO：无（PATCH 级别仅记录，不阻断）
2. bindings-schema.json: `vip_level` 字段 description 更新为"VIP 等级 0-5。仅 verify 角色后才有意义（vip_level 由 verifyBindingByCode 赋予）；bindInstance 创建时为 0。binding_type='player' 恒为 0"
3. CHANGELOG.md: 记录 PATCH 变更（vip_level 描述澄清）
4. **不修改** ws-events.ts（player.binding_verified 是 Panel 内部事件，不进跨进程契约）

**闭合判据**：
- [ ] s0601 流程已走（变更影响面识别 + 依赖模块通知）
- [ ] zod schema 校验通过
- [ ] ajv 元校验通过
- [ ] CHANGELOG 更新
- [ ] ws-events.ts 未被修改

---

### Task 8: 测试 — 单测 + E2E 更新

**文件**：
- [instanceBindingService.test.ts](file:///home/airxw/gsp/panel/backend/src/services/instanceBindingService.test.ts)
- [guild-portal.spec.ts](file:///home/airxw/gsp/panel/frontend/e2e/guild-portal.spec.ts)
- [role-switching.spec.ts](file:///home/airxw/gsp/panel/frontend/e2e/role-switching.spec.ts)

**步骤**：
1. 单测：bindInstance 创建 vip_level=0
2. 单测：verifyBindingByCode 触发完整调用链（emit 事件 + getVipWelcomeMessage + sendCommand）
3. 单测：迁移脚本 3 种数据场景
4. 单测：verifyBindingByCode 错误处理 3 种场景
5. E2E：GuildDock 首页单卡展示断言更新
6. E2E：GuildBind 无 SegmentedControl 断言
7. E2E：完整绑定流程（创建验证码 → 模拟 verify → 验证首页状态）

**闭合判据**：
- [ ] 后端 vitest 全部 PASS
- [ ] 前端 vitest 全部 PASS
- [ ] E2E 关键路径 PASS

---

### Task 9: 合流 — 版本号统一 + 部署验证

**步骤**：
1. 版本号统一：12 个版本源（version.json×4 + package.json×4 + deploy.sh + version.md + README.md + DAEMON_VERSION）
2. 中版本号 +1（新功能 + 行为变更）
3. BUILD_ID 按部署日期生成
4. version.md 添加本次变更说明
5. README.md 若有架构变更则更新
6. 部署前验证：tsc + vitest + vite build + 无 localhost 违规
7. 部署到生产（关闭现有部署 → deploy.sh update）

**闭合判据**：
- [ ] 12 个版本源全部统一
- [ ] check:version PASS
- [ ] 部署成功 + footer BUILD 序列正确
- [ ] 内置浏览器核对生产环境

## Subagent 调度台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|----------|-------|---------------|----------|-----------------|----------|------------|------|
| Task 1 | P1 | general_purpose_task | instanceBindingService.ts 改造 + 单测 | 待回填（启动后填入真实拉起ID） | .trae/specs/force-player-binding-for-vip/task1-output.md | Spec 闭合点 | 待启动 |
| Task 7 | P1 | general_purpose_task | bindings-schema 描述更新 + CHANGELOG | 待回填 | .trae/specs/force-player-binding-for-vip/task7-output.md | Spec 闭合点 | 待启动 |
| Task 2 | P2 | general_purpose_task | 迁移脚本 + 单测 | 待回填 | .trae/specs/force-player-binding-for-vip/task2-output.md | Task 1 完成 | 待启动 |
| Task 4 | P2 | general_purpose_task | GuildDock.tsx 合并展示 | 待回填 | .trae/specs/force-player-binding-for-vip/task4-output.md | Task 1 完成 | 待启动 |
| Task 3 | P3 | general_purpose_task | eventBus + verifyBindingByCode RCON 广播 | 待回填 | .trae/specs/force-player-binding-for-vip/task3-output.md | Task 1 完成 | 待启动 |
| Task 5 | P3 | general_purpose_task | GuildBind.tsx 单向导 | 待回填 | .trae/specs/force-player-binding-for-vip/task5-output.md | Task 7 完成 | 待启动 |
| Task 6 | 串行 | general_purpose_task | ServerDetailCore 解绑入口 | 待回填 | .trae/specs/force-player-binding-for-vip/task6-output.md | Task 5 完成 | 待启动 |
| Task 8 | 串行 | 主线程（非subagent） | 单测 + E2E 更新 | 主线程 | .trae/specs/force-player-binding-for-vip/task8-output.md | Task 1-7 完成 | 待启动 |
| Task 9 | 串行 | 主线程（非subagent） | 版本号统一 + 部署 | 主线程 | current-note.md | Task 8 完成 | 待启动 |

**降级路径**：若 `general_purpose_task` subagent 不可用，降级为主线程内联执行，台账 `actual agent id` 字段填"主线程（降级）"，并在第二落点文件记录降级原因。

## 上下文保护策略

按 rules-0 §四-12 受保护/未保护上下文调度矩阵：

- **受保护上下文**（可复用）：spec.md / tasks.md / 已闭合的 4 个决策 / 现有 bindings-schema.json
- **未保护上下文**（必须隔离）：测试中间态 / 调试信息 / 当前会话决策

每个 subagent 启动时仅传递：
1. spec.md 全文
2. 该 Task 的任务描述
3. 相关源文件路径（由 subagent 自行读取）
4. 闭合判据

不传递：当前会话的实时调试信息、未写入锚点的中间结论。
