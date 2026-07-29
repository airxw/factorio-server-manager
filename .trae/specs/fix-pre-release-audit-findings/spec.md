# 发布前审查发现修复 Spec

## Why
发布前最终测试阶段使用 10 个并行子代理对系统全维度审查，共发现 38 个非安全类问题，其中 13 个高优先级问题直接影响核心业务流程（如购物结算、管理员解绑、并发物品发放），18 个中优先级问题影响性能与体验，7 个低优先级问题涉及文档与潜在缺陷。需在发布前系统性修复，确保功能正确、性能合理、体验完善。

## What Changes
### 前端 API 客户端层（client.ts）
- 修复 `getSyncStatus` 缺少 `camelToSnake` 转换（C-03 / D-01 / I-02）
- 修复 `setVipPermission` 响应缺少 `camelToSnake` 转换（C-04 / D-02 / I-05）
- 移除 `updateUserAdmin` 错误的 `snakeToCamel` 调用（C-05 / I-04）
- 统一 `checkoutShop` 返回值结构，前端读取扁平字段（C-02）
- `getSnapshotDownloadUrl` 追加 token 参数（I-06）

### 后端绑定与权限路由
- 新增管理员代解绑接口 `POST /api/admin/users/:id/unbind`，修复 `unbindPlayer` 解绑对象错误（C-01 / I-01）
- `POST /api/shop-admin/sync` 接收 `source` 参数并透传（I-03）

### 后端商店服务并发与性能（shopService.ts）
- `claimOrder` 改造为事务 + 乐观锁，防止并发重复发放（B-01）
- 每日限额校验移入事务内，消除 TOCTOU 竞态（B-02）
- `getDailyUsage` 改为单条聚合 SQL，消除 N+1 查询（P-01）
- `getAllOrders`/`getOrders` 批量查询 items，消除 N+1（P-03）
- 用户列表 VIP 批量查询（P-04）
- 新增迁移：`shop_order_items.item_name` 索引（P-05）
- 更新 `createOrder` JSDoc 注释为品质级校验逻辑（DOC-01 / L-04）

### 后端下载器与服务进程（downloader.ts / factorioProcess.ts / server.ts）
- axios 配置 timeout + 流式数据无活动超时（B-03）
- `downloadTasks` Map 定时清理已完成任务（R-02）
- factorioProcess.ts 定时器句柄显式管理，清理时 clearInterval（R-04）
- server.ts SSE 客户端列表顶部声明，消除 TDZ（R-03）
- 监听 SIGTERM/SIGINT 实现优雅关闭（R-05）

### 后端其他逻辑
- 存档校验兼容 Factorio 2.0 `level.dat0`（L-01）
- `authenticateToken` 增加用户 role 实时校验（L-02）
- 存档上传文件名净化（B-04）
- `GET /api/config` JSON 损坏时返回 422 + 错误位置（B-05）
- `POST /api/config` 返回真实 backupPath（D-03）
- `validateServerSettings` 增加数值字段范围校验（D-04）
- `vip_level_required` 字段废弃处理：保留列但 createOrder 不再读取，加 `@deprecated` 注释（L-03 / DOC-05）
- `camelToSnake` 正则强化，支持连续大写字母（D-05）

### 前端 UX
- Logs 页面 WebSocket 重连死循环修复：区分错误类型 + 最大重试 5 次 + token 失效触发登出（R-01）
- Logs 页面增加断连/重连状态横幅（U-01）
- Players 踢人/封禁加 `window.confirm`（U-02）
- Instances 停止操作加 `window.confirm`（U-03）
- UserAdmin 角色/状态下拉变更加 `window.confirm`（U-04）
- Players/Instances/ShopAdmin 状态徽章中文化（U-05）
- 全局成功消息 3 秒自动消失（U-06）
- 按钮补齐 `btn-*` 类（U-07）
- Dashboard 轮询频率动态调整（status 稳定时 10 秒），getSaves 改为切换时调用（P-02）

### CSS 兼容性
- 5 处 `backdrop-filter` 补 `-webkit-` 前缀（C-06）

### 文档同步
- `itemSyncService` JSDoc 注释 enabled 值统一为 true（DOC-02）
- README "待实现功能" 全面更新状态（DOC-03）
- 前后端 ShopItem 接口可空性统一为 `string | null`（DOC-04）

### 不在本次范围
- F-01 聊天管理前端缺失：工作量较大且非阻塞发布，列入下一迭代
- F-02 孤立端点 UI 补全：列入下一迭代

## Impact
- **Affected specs**: `fix-remaining-route-and-contract-gaps`（部分字段命名约定扩展）、`restore-vip-shop-and-redesign-sidebar`（品质逻辑相关字段废弃）
- **Affected code**:
  - 前端：`frontend/src/api/client.ts`、`frontend/src/pages/{Logs,Players,Instances,UserAdmin,ShopAdmin,Shop,Dashboard}.tsx`、`frontend/src/index.css`
  - 后端：`backend/src/services/{shopService,downloader,factorioProcess}.ts`、`backend/src/routes/{bindings,shopAdmin,shop,server,config,saves,auth}.ts`、`backend/src/middleware/auth.ts`、`backend/src/db/migrations/*`
  - 文档：`README.md`、相关 JSDoc 注释

## ADDED Requirements

### Requirement: 管理员代解绑玩家
系统 SHALL 提供 `POST /api/admin/users/:id/unbind` 接口，仅 admin 角色可调用，解绑指定用户的玩家绑定。

#### Scenario: 管理员解绑其他用户
- **WHEN** 管理员调用 `POST /api/admin/users/123/unbind`
- **THEN** 用户 123 的 factorio_player_name 被清空，返回 200

#### Scenario: 普通用户调用被拒绝
- **WHEN** 普通用户调用该接口
- **THEN** 返回 403

### Requirement: 订单提取原子性
系统 SHALL 保证同一提取码并发提取时只成功一次。

#### Scenario: 并发提取
- **WHEN** 同一提取码被并发调用两次
- **THEN** 仅一次返回 success，另一次返回"订单已被提取"

### Requirement: 每日限额事务内校验
系统 SHALL 在事务内查询用户当日已购数量，防止并发超限。

### Requirement: WebSocket 重连上限
系统 SHALL 限制 Logs 页面 WebSocket 最大重连次数为 5，token 失效时立即停止重连并触发登出。

## MODIFIED Requirements

### Requirement: 商店结算返回结构
前端 `checkoutShop` SHALL 读取扁平字段（`claimCode`、`items`、`id`），不再期望嵌套 `order` 属性。后端返回保持 `{ data: order, message }` 不变。

### Requirement: Dashboard 轮询
Dashboard SHALL 根据 server 状态动态调整轮询频率：running 状态 5 秒、stopped/error 状态 15 秒。`getSaves` 仅在切换存档选择器时调用，不参与轮询。

### Requirement: 商品级 vip_level_required 字段
`ShopItem.vipLevelRequired` 字段 SHALL 标记为 `@deprecated`，createOrder 不再读取该字段，仅由品质级 VIP 校验控制访问。

## REMOVED Requirements
无（所有修复均为增强与纠正，不删除现有功能）。
