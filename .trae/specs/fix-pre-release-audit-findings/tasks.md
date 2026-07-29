# Tasks

> **状态说明（2026-07-17）**：本 spec 的 38 个问题散布在 v3.3-v3.5 中被陆续修复——WebSocket 重连死循环（v3.3.4-3.3.5）、通知轮询退避+缓存策略（v3.3.6）、系统健康字段对齐（v3.4.2）、配送方式样式（v3.4.4）、商城品质动态（v3.4.5）、前端全面 UI 打磨、资源管理等均已在后续版本中实现。剩余未修复项为低/中优先级碎片（如 `-webkit-backdrop-filter` 前缀、部分 confirm 弹窗），可在下一个前端优化迭代中并入。**本 spec 不再作为独立整体追踪。**

本方案共拆分为 10 个可并行任务，建议使用 10 个代理同步执行。任务间依赖在末尾标注。

- [ ] Task 1: 修复前端 API 客户端层（client.ts）
  - [ ] SubTask 1.1: `getSyncStatus` 响应增加 `camelToSnake` 转换（C-03）
  - [ ] SubTask 1.2: `setVipPermission` 响应增加 `camelToSnake` 转换（C-04）
  - [ ] SubTask 1.3: `updateUserAdmin` 移除错误的 `snakeToCamel` 调用，保留 `camelToSnake` 输出（C-05）
  - [ ] SubTask 1.4: `checkoutShop` 返回值结构修正——后端返回扁平 `{ id, status, claimCode, items, ... }`，前端 `OrderResult` 类型与 `Shop.tsx` 中读取 `result.claimCode`/`result.items` 的逻辑同步调整（C-02）
  - [ ] SubTask 1.5: `getSnapshotDownloadUrl` 追加 `?token=${token}` 参数（I-06）
  - [ ] SubTask 1.6: `camelToSnake` 正则强化为 `/([A-Z]+)([A-Z][a-z])/g` 以支持连续大写字母（D-05）
  - [ ] SubTask 1.7: 同步修改 `frontend/src/pages/Shop.tsx` 中 `handleCheckout` 对结算结果的读取，改为扁平字段；为购物车结算增加 `window.confirm` 二次确认
  - 验证：`cd frontend && npx tsc --noEmit` 通过

- [ ] Task 2: 修复 Logs.tsx WebSocket 重连死循环与状态提示
  - [ ] SubTask 2.1: 区分 `CloseEvent.code`：1008（policy violation，token 失效）→ 停止重连并触发 `authErrorHandler`；1006/1011 等可重连错误→进入重试流程（R-01）
  - [ ] SubTask 2.2: 引入 `retryCountRef`，最大重试 5 次，超过则停止重连并提示"连接失败，请刷新页面"
  - [ ] SubTask 2.3: 重试间隔指数退避：3s → 6s → 12s → 24s → 48s
  - [ ] SubTask 2.4: 顶部增加状态横幅：连接中(黄)、已连接(绿)、断开重连中(红)、永久失败(红)（U-01）
  - [ ] SubTask 2.5: 组件卸载时清理 `reconnectTimerRef` 与 `wsRef`
  - 验证：手动断网→重试 5 次后停止；token 过期→立即停止并登出

- [ ] Task 3: 前端 UX 全局修复（Players / Instances / UserAdmin / ShopAdmin）
  - [ ] SubTask 3.1: Players.tsx 踢人/封禁按钮增加 `window.confirm`（U-02）
  - [ ] SubTask 3.2: Instances.tsx 停止/重启/删除实例操作增加 `window.confirm`（U-03）
  - [ ] SubTask 3.3: UserAdmin.tsx 角色/状态下拉变更增加 `window.confirm`，取消则回滚 select 值（U-04）
  - [ ] SubTask 3.4: Players/Instances/ShopAdmin 状态徽章中文化：running→运行中、stopped→已停止、starting→启动中、stopping→停止中、error→错误、pending→待处理、claimed→已提取、expired→已过期、completed→已完成、failed→失败（U-05）
  - [ ] SubTask 3.5: 全局成功消息 3 秒后自动消失——在上述 4 个页面 + Shop.tsx 中为 `message` state 增加 `useEffect(setTimeout(() => setMessage(null), 3000), [message])`（U-06）
  - [ ] SubTask 3.6: 检查并补齐按钮 `btn-*` 类：危险操作 `btn-danger`、确认操作 `btn-success`、警告操作 `btn-warning`（U-07）
  - 验证：手动点击各操作触发 confirm；切换角色后取消能回滚；成功消息 3 秒后消失

- [ ] Task 4: Dashboard.tsx 轮询频率与 getSaves 调用优化
  - [ ] SubTask 4.1: 移除 setInterval 中 `getSaves()` 调用，改为存档选择器展开时按需调用（P-02）
  - [ ] SubTask 4.2: 轮询频率根据状态动态调整：running 状态 5 秒、stopped/error/starting/stopping 状态 15 秒——通过 `useEffect` 监听 `serverStatus.state` 变化重建 interval
  - [ ] SubTask 4.3: 首次加载增加 loading 占位（spinner + "加载中..."）防止空白闪烁
  - [ ] SubTask 4.4: stopped 与 error 状态徽章颜色区分：stopped 用 `badge-warning`、error 用 `badge-danger`
  - 验证：观察网络面板，running 时 5 秒一次 status 请求，stopped 时 15 秒一次；切换存档时触发 getSaves

- [ ] Task 5: index.css 补齐 `-webkit-backdrop-filter` 前缀
  - [ ] SubTask 5.1: 行 182 `.sidebar-toggle` 补前缀
  - [ ] SubTask 5.2: 行 287 `.logout-btn` 补前缀
  - [ ] SubTask 5.3: 行 406 `button.btn-secondary:hover` 补前缀
  - [ ] SubTask 5.4: 行 444 输入框相关补前缀
  - [ ] SubTask 5.5: 行 752 通用卡片补前缀
  - 验证：搜索 `backdrop-filter` 应有 6 处（含原有 1 处），每处上方均有 `-webkit-backdrop-filter`

- [ ] Task 6: 后端 shopService.ts 并发原子性与性能优化
  - [ ] SubTask 6.1: `claimOrder` 改造为事务 + 乐观锁：`db.transaction(async trx => { const updated = await trx('shop_orders').where({ id, status: 'pending' }).update({ status: 'claiming' }); if (updated === 0) throw new Error('订单已被提取或已过期'); ... 发放物品 ... await trx('shop_orders').where({id}).update({status:'claimed', claimed_at: new Date()}) })`（B-01）
  - [ ] SubTask 6.2: 每日限额校验移入事务内：在事务内调用 `getDailyItemCount`（需将 `getDb()` 改为 `trx`），并使用 `SELECT ... FOR UPDATE`（SQLite 不支持时改用串行化隔离级别，knex `transaction({isolationLevel: 'serializable'})`）（B-02）
  - [ ] SubTask 6.3: `getDailyUsage` 改为单条聚合 SQL：`SELECT item_name, COALESCE(SUM(quantity),0) as used FROM shop_order_items JOIN shop_orders ... WHERE user_id=? AND created_at>=? AND status IN ('pending','claimed') GROUP BY item_name`，再与 `shop_items` 表内存合并计算 remaining（P-01）
  - [ ] SubTask 6.4: `getAllOrders`/`getOrders` 批量查询 items：先查所有 order ids，再 `WHERE order_id IN (...)` 一次查全部 items，内存按 order_id 分组（P-03）
  - [ ] SubTask 6.5: 用户列表 VIP 批量查询：新增 `getEffectiveVipLevels(userIds: number[])` 一次查所有用户，内存合并（P-04）
  - [ ] SubTask 6.6: 更新 `createOrder` JSDoc 注释为"品质级校验：VIP N 可选 0~N 级品质；admin 不受限制"（DOC-01 / L-04）
  - 验证：`cd backend && npx tsc --noEmit` 通过；并发场景模拟（手动两个 fetch 同时 claim 同一 code）只成功一次

- [ ] Task 7: 后端 downloader.ts / factorioProcess.ts / server.ts 资源与生命周期修复
  - [ ] SubTask 7.1: `downloadFactorio` 中 axios 配置增加 `timeout: 5*60*1000`；增加流式数据无活动超时（60 秒无 data 事件则 abort）（B-03）
  - [ ] SubTask 7.2: 新增 `cleanupOldTasks()` 函数：清理 `completedAt < Date.now() - 3600_000` 的任务；在 server.ts 启动时 `setInterval(cleanupOldTasks, 600_000)`（R-02）
  - [ ] SubTask 7.3: factorioProcess.ts 所有 `setInterval`/`setTimeout` 赋值给模块级变量，在 `stopProcess` 清理函数中 `clearInterval`/`clearTimeout`（R-04）
  - [ ] SubTask 7.4: server.ts SSE 客户端列表 `const clients = new Set<...>()` 顶部模块级声明，消除 TDZ（R-03）
  - [ ] SubTask 7.5: server.ts 注册 `process.on('SIGTERM', gracefulShutdown)` 与 `process.on('SIGINT', gracefulShutdown)`：依次停止 Factorio 进程→关闭 HTTP server→关闭数据库连接→`process.exit(0)`（R-05）
  - 验证：`cd backend && npx tsc --noEmit` 通过；下载超时场景能正确转为 error 状态

- [ ] Task 8: 后端路由层综合修复（bindings / shopAdmin / auth / config / saves）
  - [ ] SubTask 8.1: 新增 `POST /api/admin/users/:id/unbind` 管理员路由（requireAdmin 中间件），调用 `deleteBinding(userId)`；前端 `unbindPlayer` 改调用此接口（C-01 / I-01）
  - [ ] SubTask 8.2: `POST /api/shop-admin/sync` 读取 `req.body.source` 并透传给 `syncItems(source)`（I-03）
  - [ ] SubTask 8.3: 存档校验 `validateSaveFile` 兼容 Factorio 2.0：允许 `level.dat` 或 `level.dat0` 任一存在（L-01）
  - [ ] SubTask 8.4: `authenticateToken` 中间件增加 `users` 表 role 查询：若 JWT role 与数据库 role 不一致，以数据库为准；可在 token 中嵌入 role 版本号或缩短 TTL（L-02）
  - [ ] SubTask 8.5: 存档上传路由文件名净化：`const safeName = path.basename(filename); if (!/^[A-Za-z0-9_.-]+$/.test(safeName)) return res.status(400)...`（B-04）
  - [ ] SubTask 8.6: `GET /api/config` 捕获 `JSON.parse` 异常返回 422 + 错误位置；新增 `POST /api/config/reset` 恢复默认配置（B-05）
  - [ ] SubTask 8.7: `POST /api/config` 备份时记录真实文件名（含时间戳），返回 `backupPath` 为真实路径（D-03）
  - [ ] SubTask 8.8: `validateServerSettings` 增加数值范围校验：`max_players` 1-65535、`autosave_interval` 1-10080 等（D-04）
  - [ ] SubTask 8.9: `ShopItem.vipLevelRequired` 接口字段加 `@deprecated` 注释；`createItem`/`updateItem` 仍允许设置但写入日志"已废弃"（L-03 / DOC-05）
  - 验证：`cd backend && npx tsc --noEmit` 通过；管理员能解绑其他用户；存档校验通过 Factorio 2.0 存档

- [ ] Task 9: 数据库迁移——添加 shop_order_items.item_name 索引
  - [ ] SubTask 9.1: 新增迁移文件 `backend/src/db/migrations/XXXX_add_index_shop_order_items_item_name.ts`，`up` 中 `CREATE INDEX idx_shop_order_items_item_name ON shop_order_items(item_name)`，`down` 中 `DROP INDEX`
  - [ ] SubTask 9.2: 验证迁移可正常执行：`npm run migrate:up -w backend`
  - 验证：迁移成功；`EXPLAIN QUERY PLAN` 显示使用索引

- [ ] Task 10: 文档同步与接口可空性统一
  - [ ] SubTask 10.1: 修正 `itemSyncService` JSDoc 注释：enabled 默认值改为 true（DOC-02）
  - [ ] SubTask 10.2: README.md "待实现功能"章节全面更新：标记 VIP、商店、绑定、自动重启为已完成；孤立端点（Lists/Monitor/ChatAdmin）标记为下一迭代（DOC-03）
  - [ ] SubTask 10.3: 前后端 ShopItem 接口可空性统一：后端 `displayName: string | null`，前端 `display_name: string | null`（移除 `?` 可选标记）（DOC-04）
  - 验证：grep `enabled.*false.*待启用` 应无匹配；README 状态与实际功能一致

# Task Dependencies
- Task 1（client.ts checkoutShop 结构修正）与 Task 6（shopService 后端）需保持接口契约一致：后端返回扁平 `{ id, status, claimCode, items, ... }`，前端读取扁平字段。**建议先由 Task 6 完成后端返回结构确认，再由 Task 1 修改前端读取逻辑**——若并行执行则需在 spec 中明确字段清单（已在 spec.md MODIFIED Requirements 中明确）。
- Task 9（迁移）与 Task 6（性能优化）涉及同一表，但 Task 6 不依赖索引存在即可工作，可并行。
- Task 8 SubTask 8.1 修改前端 `unbindPlayer` 调用，与 Task 1 修改同一文件 client.ts——**Task 8 仅修改后端 bindings 路由与 shopAdmin 路由，client.ts 中 `unbindPlayer` 函数体修改由 Task 1 承担**。
- Task 1 SubTask 1.7 修改 Shop.tsx，与 Task 3 SubTask 3.5（Shop.tsx 消息自动消失）同一文件——**Task 3 不修改 Shop.tsx，Shop.tsx 全部修改归 Task 1**。
- 其余任务（2、4、5、7、10）相互独立，可完全并行。

# 并行执行建议
推荐分两波执行以减少冲突：

**第一波（7 个代理并行）**：Task 2、Task 4、Task 5、Task 6、Task 7、Task 9、Task 10
- 这 7 个任务修改的文件完全不重叠

**第二波（3 个代理并行）**：Task 1、Task 3、Task 8
- Task 1 修改 client.ts 与 Shop.tsx
- Task 3 修改 Players/Instances/UserAdmin/ShopAdmin（不含 Shop.tsx）
- Task 8 修改后端 bindings/shopAdmin/auth/config/saves 路由
- 第二波依赖第一波 Task 6 完成后端返回结构确认

或者一次性 10 个代理并行，由各代理严格遵守上述文件边界约束。
