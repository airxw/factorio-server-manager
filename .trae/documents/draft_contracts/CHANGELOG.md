# 契约变更记录 (Changelog)

## [v4.11.0] - 商业化重构契约基线
- **版本号**: v4.11.0
- **变更内容**:
  1. 新增 `GlobalAsset` 与 `InstanceAsset` 数据结构契约。
  2. 新增 `asset_interfaces.d.ts` 接口存根。
  3. 新增 `commercial_config.schema.json` 商业化配置契约。
  4. 新增 `error_codes.json` 全局商业化错误码。
- **变更原因**: 从“运维管理面板”向“B2B2C游戏私服商业化 SaaS 平台”转型，建立全局模板与局部重写（Template & Override）的数据与接口基础边界。
- **影响范围**:
  - Panel 后端：需新增 AssetService 和相应的路由/中间件。
  - Panel 前端：需新增商城管理面板及渲染层合并逻辑。
  - Daemon 节点端：需引入沙箱机制执行 `executeLogic`。