# 强制游戏角色绑定才能获得 VIP — Checklist

> 独立审查（GN-004）交付前审查 rubric。逐项核查，全部通过方视为闭合。
> 来源：[spec.md](./spec.md) + [tasks.md](./tasks.md)

## 一、需求闭合核查

- [ ] 4 个核心决策已通过 AskUserQuestion 获得人类裁决（spec.md §What Changes）
- [ ] 决策 1（bindInstance 保留但 vip_level=0）在 spec 中明确
- [ ] 决策 2（历史仅账户绑定软删除）在 spec 中明确
- [ ] 决策 3（UI 方向 2+3 组合）在 spec 中明确
- [ ] 决策 4（verify 成功立即广播）在 spec 中明确

## 二、契约合规核查（含 s0601 流程）

- [ ] **s0601 契约变更适配流程已走**（rules-0 §四-10 + s0601）：
  - [ ] 变更影响面已识别：bindings-schema.json `vip_level` 描述更新（PATCH）
  - [ ] 依赖模块 TODO 已生成（PATCH 级别仅记录，不阻断下游）
  - [ ] 变更原因已记录（VIP 语义修正：仅 verify 角色后才有意义）
- [ ] [bindings-schema.json](file:///home/airxw/gsp/public/schema/bindings-schema.json) `vip_level` 字段描述已更新（PATCH 级别，仅文档修正）
- [ ] **ws-events.ts 未被修改**（`player.binding_verified` 是 Panel 内部 eventBus 事件，不进跨进程契约）
- [ ] zod schema 校验通过
- [ ] ajv 元校验通过
- [ ] CHANGELOG.md 已记录 PATCH 变更
- [ ] 未删除任何 public/ 下已有字段（仅描述更新）
- [ ] 未直接编辑 public/ 文件未经 s0601 流程（本次 bindings-schema.json 描述更新已走 s0601）

## 三、后端实现核查

### Task 1: bindInstance 改造

- [ ] `bindInstance` INSERT 时 `vip_level === 0`
- [ ] `bindInstance` 复活已 revoked 记录时 `vip_level === 0`
- [ ] `DEFAULT_BOUND_VIP_LEVEL` 常量保留（verifyBindingByCode 仍用）
- [ ] 函数注释明确新语义
- [ ] 单测覆盖：bindInstance 创建 vip_level=0
- [ ] 单测覆盖：bindInstance 复活后 vip_level=0

### Task 2: 迁移脚本

- [ ] 迁移脚本文件 `20260801000000_revoke_account_only_bindings.ts` 存在
- [ ] up 函数正确扫描仅账户绑定记录
- [ ] down 函数可恢复（verify_status='verified' + vip_level=1）
- [ ] 幂等性：已 revoked 记录不重复处理
- [ ] 单测覆盖 3 种场景：仅账户绑定 / 账户+玩家绑定 / 已 revoked

### Task 3: eventBus + verifyBindingByCode 触发 RCON 广播（Panel 端直接驱动）

- [ ] eventBus 新增 Panel 内部事件类型 `player.binding_verified`（不进 public/ 契约）
- [ ] `verifyBindingByCode` 事务提交后 emit 事件（非事务内）
- [ ] 仅首次绑定或复活时广播（existingAccountBinding.verify_status !== 'verified'）
- [ ] 事务提交后调用 `playerService.getVipWelcomeMessage(serverId, vipLevel)`（复用已有方法）
- [ ] 事务提交后调用 `daemonClient.sendCommand(nodeId, serverId, 'say ' + 欢迎语)`（复用已有通道）
- [ ] 模板变量替换：`{player_name}` / `{vip_level}`
- [ ] 查询 `servers.node_id` 成功
- [ ] 错误处理：getVipWelcomeMessage 返回空 → 静默跳过
- [ ] 错误处理：sendCommand 失败 → 记录 warning 日志，不抛错
- [ ] 错误处理：node_id 查询失败 → 记录 error 日志，不抛错
- [ ] 单测：mock eventBus.emit + playerService + daemonClient，验证调用链 + payload
- [ ] 单测：已 verified 时不广播
- [ ] 单测：getVipWelcomeMessage 返回空时不调用 sendCommand
- [ ] 单测：sendCommand 失败时不抛错
- [ ] `playerService.getVipWelcomeMessage` 被接入运行时（非孤岛，rules-0 §四-13）

## 四、前端实现核查

### Task 4: GuildDock 合并展示

- [ ] 删除"账户级绑定" + "游戏角色绑定"两个独立 section
- [ ] 新增 `aggregated` useMemo 按 server_id 聚合
- [ ] `UnifiedBindingCard` 组件展示 VIP 徽章 + 角色验证徽章
- [ ] 空状态保留"立即绑定游戏角色"主 CTA
- [ ] 移动端视口守卫（min-height: 100dvh + overflow-y: auto）
- [ ] tsc --noEmit 通过
- [ ] vite build 通过

### Task 5: GuildBind 单向导

- [ ] 删除 SegmentedControl
- [ ] 删除 bindType state + switchType + URL query 处理
- [ ] 默认渲染游戏角色绑定向导
- [ ] URL `?type=account` 自动重定向到 `?type=player`
- [ ] AccountBindingRow 组件保留（供 ServerDetailCore 复用）
- [ ] tsc --noEmit 通过
- [ ] vite build 通过

### Task 6: ServerDetailCore 解绑入口

- [ ] 实例详情页新增账户级绑定管理区块
- [ ] 仅当前用户已绑定时显示
- [ ] 展示 VIP 等级 + 绑定时间 + 解绑按钮
- [ ] 解绑 API 调用正确
- [ ] tsc --noEmit 通过

## 五、测试核查（三重闸门，s0402）

### 单测

- [ ] 后端 vitest 全部 PASS（含新增 bindInstance/verifyBindingByCode/迁移脚本测试）
- [ ] 前端 vitest 全部 PASS
- [ ] 测试覆盖率不下降

### 内置浏览器核对

- [ ] GuildDock 首页单卡展示（无两个独立 section）
- [ ] GuildBind 单向导（无 SegmentedControl）
- [ ] URL `?type=account` 自动重定向
- [ ] ServerDetailCore 解绑入口可见
- [ ] 移动端视口无溢出
- [ ] 完整绑定流程：创建验证码 → 模拟 verify → 验证首页状态

### Mock 回归

- [ ] Mock 模式下 GuildDock 渲染正确
- [ ] Mock 模式下 GuildBind 渲染正确

## 六、运行时接入核查（rules-0 §四-13）

- [ ] `verifyBindingByCode` 仍在路由表中（`POST /api/player-bindings/:id/verify`）
- [ ] `playerService.getVipWelcomeMessage` 被 `verifyBindingByCode` 调用（接入运行时，非孤岛）
- [ ] `daemonClient.sendCommand` 在 `verifyBindingByCode` 中被调用（复用已有通道）
- [ ] Panel 内部 `player.binding_verified` 事件被 emit（eventBus 注册可查）
- [ ] 前端 GuildDock/GuildBind 路由注册可查
- [ ] 前端 ServerDetailCore 解绑入口路由注册可查

## 七、版本与部署核查

- [ ] 中版本号 +1（新功能 + 行为变更）
- [ ] 12 个版本源全部统一（version.json×4 + package.json×4 + deploy.sh + version.md + README.md + DAEMON_VERSION）
- [ ] BUILD_ID 按部署日期生成
- [ ] version.md 添加本次变更说明
- [ ] README.md 若有架构变更则更新
- [ ] 构建产物无 `localhost:3000` 或 `127.0.0.1:3000`（rules 0.md 最高规则）
- [ ] .env.production 合规
- [ ] 部署前关闭现有部署
- [ ] 部署后 footer BUILD 序列正确
- [ ] 内置浏览器核对生产环境

## 八、回归核查

- [ ] voteService 调用 `getVipLevelByGamePlayerName` 行为不变（接口签名未变）
- [ ] shopService 调用 `getUserVipLevel` 行为不变
- [ ] walletService 调用 `getUserVipLevel` 行为不变
- [ ] CDK 兑换路径不受影响
- [ ] 已有 verified 用户（player + account 双绑定）的 VIP 等级不受影响
- [ ] instance_admin / server_admin 的 VIP5 路径不受影响

## 九、文档与锚点核查

- [ ] current-note.md 七字段交接状态已更新
- [ ] version.md 已更新
- [ ] README.md 已更新（若有架构变更）
- [ ] spec.md / tasks.md / checklist.md 三件套完整
- [ ] subagent 调度台账 actual agent id 已回填
