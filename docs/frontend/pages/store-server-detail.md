# 实例详情 - 服主视图（Store Server Detail）

## 1. 页面定位
> `instance_admin+` 视角的实例详情页，路由位于 `/store/servers/:id`。它试图把“GM Workbench 壳层”和“旧实例详情运维面板”拼成一个复合工作台：顶部负责店铺/经济配置语义，主体承载实例运行、配置文件、日志、存档、版本、角色管理等操作。

本次核对的线上页面为：
- `[ROUTE]` `https://gsp.ecsrz.com:3001/store/servers/73baf630-6b56-4f1d-acee-9d5050980c9f`

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/store/servers/:id`
- 直接上游入口：
  - `/store/servers` 实例列表页点击实例进入
  - `/instances/:id` 经角色分流重定向到本页（`instance_admin -> /store/servers/:id`）
- 当前页内部实际存在两套“返回”语义：
  - 外层 Workbench 壳层返回 `/store/servers`
  - 内层复用的旧 `ServerDetail` 返回 `/instances`
- 路由配置：
  - [App.tsx:L271-L297](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L271-L297)
  - [App.tsx:L436-L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L436-L456)

## 3. 角色与权限
- 允许角色：`instance_admin`、`server_admin`、`system_admin`、`admin`
- 对 `instance_admin`，实例详情会落在 `/store/servers/:id`
- 对普通 `user`，同一个 `/instances/:id` 会被分流到 `/guild/servers/:id`
- 关键逻辑：
  - 角色分流：[App.tsx:L271-L285](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L271-L285)
  - `/store` 基座门控：[App.tsx:L436-L470](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L436-L470)

## 4. 核心功能点
1. 顶部 Workbench 壳层标题、面包屑与“返回列表”操作
2. 实例经济配置折叠卡：VIP 买断/订阅、点券比例、积分比例、单日消费上限
3. 实例基础信息卡：状态、游戏、端口、Pack、节点、归属者、磁盘占用、子目录清理
4. 分组 Tab 工作区：
   - `运行时`：控制台、日志文件、聊天日志、命令帮助
   - `配置`：配置文件
   - `运维`：存档管理、Mod 管理、服务端版本、角色管理
5. 底部固定操作：启动、停止、刷新
6. 顶部危险操作：删除

对应实现：
- 外层页壳：[ServerDetailStore.tsx:L33-L55](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/ServerDetailStore.tsx#L33-L55)
- 经济配置：[InstanceEconomyConfig.tsx:L159-L358](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/InstanceEconomyConfig.tsx#L159-L358)
- 内层详情主体：[ServerDetail.tsx:L592-L977](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L592-L977)

## 5. 交互流程
1. 进入 `/store/servers/:id`
2. 外层 `ServerDetailStore` 渲染 WorkbenchHeader 和 `InstanceEconomyConfig`
3. 懒加载内层 `ServerDetail`
4. `ServerDetail` 请求 `/api/servers/:id` 读取实例详情，再请求 `/api/packs` 组装可见 tabs
5. `RconConsole` 额外拉取 `/api/servers/:id/logs?limit=500`，并通过 WS 建立实时状态/日志通道
6. 用户可：
   - 在顶部修改经济配置
   - 在中部查看实例摘要/基础信息
   - 在下半区切换运行、配置、运维 tabs
   - 在底部执行启动/停止/刷新

优点：
- tab 状态同步到 URL `?tab=`，便于刷新与分享：[ServerDetail.tsx:L364-L402](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L364-L402)
- RCON 在实例停止时会禁用发送输入，避免误操作：[RconConsole.tsx:L315-L335](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RconConsole.tsx#L315-L335)
- 经济配置使用懒加载，避免首屏无意义请求：[InstanceEconomyConfig.tsx:L95-L100](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/InstanceEconomyConfig.tsx#L95-L100)

## 6. 接口与数据
- `[API]` `GET /api/servers/:id`
  - 用途：读取实例详情、状态、端口、归属者、磁盘占用
- `[API]` `GET /api/packs`
  - 用途：读取 `pack.ui_tabs`，拼装当前实例可见 tabs
- `[API]` `GET /api/servers/:id/logs?limit=500`
  - 用途：RCON 控制台预填充历史日志
- `[API]` `POST /api/servers/:id/start`
  - 用途：启动实例
- `[API]` `POST /api/servers/:id/stop`
  - 用途：停止实例
- `[API]` `DELETE /api/servers/:id`
  - 用途：删除实例
- `[API]` `GET /api/servers/:id/disk-usage`
  - 用途：刷新磁盘占用
- `[API]` `DELETE /api/servers/:id/subdir/:subdir`
  - 用途：清理 `backups/saves/mods/logs/cache`
- `[API]` `GET /api/servers/:id/pricing`
  - 用途：读取实例经济配置
- `[API]` `PUT /api/servers/:id/pricing`
  - 用途：保存实例经济配置

代码入口：
- [ServerDetail.tsx:L191-L242](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L191-L242)
- [ServerDetail.tsx:L433-L556](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L433-L556)
- [InstanceEconomyConfig.tsx:L78-L148](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/InstanceEconomyConfig.tsx#L78-L148)
- [RconConsole.tsx:L77-L112](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RconConsole.tsx#L77-L112)

## 7. 状态管理与副作用
- `[STATE]` 页面主状态：
  - `server` / `liveState` / `loading` / `error` / `actioning`
  - `uiTabs` / `activeTab` / `activatedTabs` / `expandedGroups`
  - `infoExpanded` 记忆信息卡展开态
- `[STATE]` 经济配置状态：
  - `expanded` / `loaded` / `loading` / `saving`
  - 多个表单字段使用字符串态保存，提交时再转 number/null
- `[STATE]` RCON 状态：
  - `connected` / `displayLines` / `input` / `sending`
- 关键副作用：
  - `ServerDetail` 挂载后请求实例信息
  - `server` 加载完成后请求 packs
  - `RconConsole` 挂载后拉历史日志并建立 WS
  - 切换 tab 同步 URL 查询参数

关键代码：
- [ServerDetail.tsx:L156-L185](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L156-L185)
- [ServerDetail.tsx:L244-L341](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L244-L341)
- [RconConsole.tsx:L39-L166](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RconConsole.tsx#L39-L166)

## 8. 错误与边界
- `[EDGE]` 实例停止时：
  - 控制台输入框禁用，发送按钮禁用
  - 停止按钮禁用，启动按钮可用
- `[EDGE]` 删除仅允许 `stopped` 状态
- `[EDGE]` 子目录清理在 `running/starting` 时前端直接拦截
- `[EDGE]` 经济配置字段支持 `null` 语义：
  - VIP 价格可“不开放”
  - 单日消费上限可“平台默认”
- `[EDGE]` 如果当前激活 tab 因状态或权限被移除，会回退到 `console`

但线上核对发现几个体验边界处理不足：
- `[UX]` “WS 已连接 + 状态: stopped” 的组合会误导用户，容易被理解为“服务器在线”
- `[UX]` 危险操作删除与普通返回/查看动作挤在同一屏上半部，注意力分区不够清楚
- `[UX]` 子目录清理按钮直接展示 `backups/saves/mods/logs/cache` 英文目录名，面向服主不够产品化

## 9. 体验与一致性检查
- `[UX]` 优点
  - `/store` 壳层视觉语言是统一的，卡片、圆角、阴影与其他 GM Workbench 页面一致
  - 信息卡默认折叠，能把首屏优先让给操作面板
  - 控制台、启动/停止、刷新这些高频动作有清晰位置

- `[UX]` 主要问题
  - 页面发生了“壳层标题 + 旧详情标题”双重叠加：线上 DOM 中出现两个 `H1`“实例详情”，并且同屏存在两个“返回列表”按钮
  - 页面是“店铺工作台语义”与“底层运维语义”硬拼，导致用户在同一页里同时面对经济配置、Pack/Node/Owner、磁盘清理、RCON 等多层概念
  - 桌面端、移动端两套 tab 导航结构都保留在 DOM 中，语义上出现重复 tab 文案，增加测试噪音与可访问性复杂度
  - 信息卡里直接暴露 `pack_id`、`node_id`、英文目录名，更像内部工具，而不是面向服主的精炼工作台

证据定位：
- 外层 `H1`：[WorkbenchUI.tsx:L80-L92](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/WorkbenchUI.tsx#L80-L92)
- Layout 的移动端 `H1`：[Layout.tsx:L1388-L1395](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L1388-L1395)
- 内层旧详情头部与返回按钮：[ServerDetail.tsx:L593-L620](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L593-L620)
- 三套 tab 导航并存：[ServerDetail.tsx:L790-L921](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L790-L921)
- 信息卡底层字段与目录清理：[ServerDetail.tsx:L688-L776](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L688-L776)

## 10. 关键实现定位（代码引用）
- 路由分流：[App.tsx:L271-L297](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L271-L297)
- `/store` 路由挂载：[App.tsx:L436-L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L436-L456)
- 页面壳层：[ServerDetailStore.tsx:L29-L57](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/ServerDetailStore.tsx#L29-L57)
- 经济配置表单：[InstanceEconomyConfig.tsx:L47-L148](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/InstanceEconomyConfig.tsx#L47-L148)
- 经济配置 UI：[InstanceEconomyConfig.tsx:L159-L358](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/InstanceEconomyConfig.tsx#L159-L358)
- 旧实例详情主体：[ServerDetail.tsx:L130-L556](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L130-L556)
- 分组 tab 导航：[ServerDetail.tsx:L790-L921](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L790-L921)
- RCON 控制台：[RconConsole.tsx:L39-L337](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RconConsole.tsx#L39-L337)

## 11. 待办与风险
- `[TODO]` 给 `ServerDetail` 增加 `embeddedInStore` 模式，嵌入 `/store/servers/:id` 时移除内层旧页头、旧返回按钮和旧壳层语义
- `[TODO]` 将内层所有跳转统一改为 `/store/servers` 体系，避免在 store 基座中再跳回 `/instances`
  - 典型问题：
    - 删除成功跳 `/instances`：[ServerDetail.tsx:L535-L543](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L535-L543)
    - 返回列表跳 `/instances`：[ServerDetail.tsx:L596-L598](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L596-L598)
    - 业务运营跳 `/instances/:id/business`：[ServerDetail.tsx:L602-L610](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L602-L610)
- `[TODO]` 重做信息架构，建议拆成 3 区：
  - 页头摘要与安全操作
  - 商业化配置区（经济配置、店铺配置）
  - 实例运维区（运行时、配置、运维）
- `[TODO]` 信息卡字段产品化：
  - `pack_id` -> “游戏模板”
  - `node_id` -> “部署节点”
  - `backups/logs/...` -> 中文标签 + 危险说明
- `[TODO]` 桌面/移动 tab 导航只保留一套活跃语义，隐藏方案应 `aria-hidden` 且不可聚焦
- `[TODO]` 调整 RCON 顶部状态表达，将“WS 连接状态”和“实例运行状态”视觉分离，避免绿态误判

- `[RISK]` 当前页面复用了旧 `ServerDetail`，任何对 `/instances/:id` 的改动都可能连带影响 `/store/servers/:id`
- `[RISK]` `/store` 壳层与旧详情页都在输出标题/导航，后续继续叠功能时，重复导航和语义冲突会越来越重
- `[RISK]` 三套 tab 导航同时保留在 DOM，会持续干扰自动化测试、无障碍朗读和语义层级

## 梳理元数据
- 梳理日期：2026-07-28
- 梳理方式：线上真实页面核对 + 浏览器 DOM/网络检查 + 对应源码定位
