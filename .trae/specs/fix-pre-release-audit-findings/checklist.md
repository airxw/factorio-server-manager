# Checklist

## 前端 API 客户端层
- [x] `getSyncStatus` 响应经过 `camelToSnake` 转换，前端能读取 `last_sync_at` 等字段
- [x] `setVipPermission` 响应经过 `camelToSnake` 转换，VIP 权限列表能正确显示
- [x] `updateUserAdmin` 不再调用 `snakeToCamel`，用户显示名更新后能正确保存
- [x] `checkoutShop` 返回值结构为扁平字段，Shop.tsx 结算成功后能显示提取码
- [x] `getSnapshotDownloadUrl` 返回的 URL 包含 token 参数
- [x] `camelToSnake` 正则能正确处理 `userID` → `user_id`（连续大写）

## 前端 Logs 与 WebSocket
- [x] token 失效（CloseEvent.code === 1008）时停止重连并触发登出
- [x] 网络断开时最大重试 5 次，超过后停止并提示"连接失败"
- [x] 重试间隔指数退避：3s → 6s → 12s → 24s → 48s
- [x] 顶部状态横幅显示当前连接状态（连接中/已连接/断开重连中/永久失败）
- [x] 组件卸载时清理所有 timer 与 WebSocket 句柄

## 前端 UX
- [x] Players 踢人/封禁操作前弹出 `window.confirm`
- [x] Instances 停止/重启/删除操作前弹出 `window.confirm`
- [x] UserAdmin 角色/状态下拉变更前弹出 `window.confirm`，取消能回滚 select 值
- [x] Players/Instances/ShopAdmin 状态徽章全部中文化（无英文残留）
- [x] Shop.tsx 购物车结算前弹出 `window.confirm`
- [x] 上述页面成功消息 3 秒后自动消失
- [x] 所有按钮按语义使用 `btn-success`/`btn-danger`/`btn-warning`/`btn-secondary`

## 前端 Dashboard
- [x] getSaves 不再参与轮询，仅在切换存档选择器时调用
- [x] running 状态轮询频率为 5 秒
- [x] stopped/error/starting/stopping 状态轮询频率为 15 秒
- [x] 首次加载有 loading 占位
- [x] stopped 状态徽章用 `badge-warning`、error 用 `badge-danger` 区分

## 前端 CSS
- [x] index.css 中 6 处 `backdrop-filter` 每处上方均有 `-webkit-backdrop-filter`
- [x] 旧版 Safari 下玻璃态效果正常显示

## 后端 shopService 并发与性能
- [x] `claimOrder` 包裹在 `db.transaction` 中
- [x] 事务内使用 `WHERE claim_code=? AND status='pending'` 乐观锁更新，affected rows === 0 时返回失败（claim_code 为唯一键，等价于 id 校验）
- [x] 每日限额校验 `getDailyUsageMap` 在事务内调用
- [x] 并发调用同一提取码两次，仅一次返回 success
- [x] `getDailyUsage` 仅执行 1 次聚合 SQL（而非 N 次循环）
- [x] `getAllOrders`/`getOrders` 仅执行 2 次 SQL（orders + 一次批量 items）
- [x] 用户列表 VIP 查询通过单次 SQL 完成（`getEffectiveVipLevels` 批量查询）
- [x] `createOrder` JSDoc 注释更新为品质级校验逻辑

## 后端 downloader / factorioProcess / server
- [x] axios 请求配置了 `timeout: 5*60*1000`
- [x] 流式数据 60 秒无活动时触发 abort 并标记任务为 error
- [x] `downloadTasks` Map 中超过 1 小时的已完成任务被定期清理
- [x] factorioProcess.ts 所有定时器句柄在 stopProcess 中被清理（含 restartAttemptsResetTimer）
- [x] server.ts SSE 客户端列表在模块顶部声明，无 TDZ 风险
- [x] SIGTERM/SIGINT 触发优雅关闭：停 Factorio → 关 HTTP → 关 DB → exit

## 后端路由层
- [x] `POST /api/bindings/admin/users/:id/unbind` 接口存在且仅 admin 可调用
- [x] 普通用户调用上述接口返回 403
- [x] 前端 `unbindPlayer` 改调用新接口，管理员能解绑其他用户
- [x] `POST /api/shop-admin/sync` 接收并透传 `source` 参数
- [x] `validateSaveFile` 兼容 Factorio 2.0（`level.dat` 或 `level.dat0` 任一存在即可）
- [x] `authenticateToken` 实时查询数据库 role，与 JWT 不一致时以数据库为准
- [x] 存档上传文件名经过 `path.basename` + 正则净化，拒绝含路径分隔符的名称
- [x] `GET /api/config` 在 JSON 损坏时返回 422 + 错误位置
- [x] `POST /api/config/reset` 接口存在且能恢复默认配置
- [x] `POST /api/config` 返回的 `backupPath` 与实际备份文件名一致
- [x] `validateServerSettings` 对 `max_players`、`autosave_interval` 等数值字段进行范围校验
- [x] `ShopItem.vipLevelRequired` 字段标注 `@deprecated`

## 数据库迁移
- [x] 迁移文件 `add_index_shop_order_items_item_name` 存在
- [x] `item_name` 索引通过 schema.ts 幂等创建（项目不使用 knex 迁移系统，CREATE INDEX IF NOT EXISTS 内嵌于建表流程）
- [x] `EXPLAIN QUERY PLAN` 显示 `item_name` 查询使用索引（已验证：USING INDEX idx_shop_order_items_item_name）

## 文档同步
- [x] `itemSyncService` JSDoc 注释中 enabled 默认值为 true
- [x] README "待实现功能"章节与实际功能状态一致
- [x] 前后端 ShopItem 接口 `displayName`/`display_name` 类型统一为 `string | null`
- [x] 前后端 ShopItem 接口 `category` 类型统一为 `string | null`

## 编译与运行时验证
- [x] `cd backend && npx tsc --noEmit` 通过
- [x] `cd frontend && npx tsc --noEmit` 通过
- [x] 后端 dev server 启动无报错（HTTP 200）
- [x] 前端 dev server 启动无报错（HTTP 200）
