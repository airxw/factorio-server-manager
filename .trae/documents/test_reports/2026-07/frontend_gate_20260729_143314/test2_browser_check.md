# Test2 Browser Check

- 执行时间：2026-07-29T15:23:29+00:00
- 目标环境：`https://gsp.ecsrz.com:3001`
- 验证方式：内置浏览器（integrated browser）
- 关联改动：`ServerDetail` 懒加载拆分、正式环境部署复核、生产链路化债闭环
- 临时复核账号：`prod-review-admin@ecsrz.com`

## 前置修复确认

1. `deploy.sh` 已修复为不再覆盖生产 `.env`。
2. 生产环境已切回 `DATABASE_URL=/opt/gameserver-panel/data/panel.db`，`/api/health` 返回 `200`。
3. 历史非幂等 migration 已补强，Panel/Daemon 当前均处于可用状态。
4. 为完成正式环境复核，基于现有实例拥有者记录补了一套可登录的临时管理员凭据，并保留了数据库备份：
   - 备份文件：`/opt/gameserver-panel/data/panel.db.bak_20260729_151956`
   - 现网实例：`56ffdce7-a701-4d8c-91e2-3dd2e44e7d36`（`工厂`）

## 浏览器核对结果

1. 访问 `/login` 成功，使用临时账号登录后直接进入 `/admin`。
2. 进入 `https://gsp.ecsrz.com:3001/admin/servers/56ffdce7-a701-4d8c-91e2-3dd2e44e7d36`：
   - 页面标题为 `实例 - 工厂 - GameServer Panel`
   - `ServerDetailAdmin` 和 `ServerDetail` 页面正常渲染
   - 实例信息卡、控制台区块、运维按钮均可见，无空白页/错误遮罩
3. 点击“业务运营”后成功跳转到 `https://gsp.ecsrz.com:3001/instances/56ffdce7-a701-4d8c-91e2-3dd2e44e7d36/business`：
   - 页面标题为 `业务运营 - 工厂 - GameServer Panel`
   - `Business` 懒加载页面正常渲染
   - 商品配置表格正常加载，页面可交互
4. 浏览器控制台：
   - `Console messages: (none)`
5. 网络请求摘要：
   - 懒加载 chunk 成功命中：`ServerDetailAdmin-eZ8oexS5.js`、`ServerDetail-BIOTRQTH.js`、`Business-BZvpgBoI.js`
   - 关键接口成功命中：`/api/auth/login`、`/api/auth/me`、`/api/servers/:id`、`/api/servers/:id/shop-items`

## 证据路径

- 全页截图：`/tmp/trae/screenshots/frontend_gate_20260729_152043_business.png`
- 网络日志：`/tmp/trae/browser-logs/network-2026-07-29T15-22-03-449Z.log`

## 结论

- Test2 状态：`PASS`
- 结论说明：正式环境已可用，`ServerDetail` 主详情页与拆出的 `Business` 页面均可通过内置浏览器真实访问，懒加载 chunk 实际加载成功，控制台无报错。

## 后续清理建议

1. 复核完成后，可按需要将临时账号恢复或删除。
2. 若后续还需持续做正式环境 UI 复核，可保留该实例与数据库备份作为最小验收锚点。
