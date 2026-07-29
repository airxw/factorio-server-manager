# 玩家门户：CDK 兑换（GuildCdk）

- [ROUTE] `/guild/cdk`（入口：`https://gsp.ecsrz.com:3001/guild/cdk`、`https://192.168.5.14:3001/guild/cdk`）
- 状态：已完成（2026-07-26 复核，确认与 v4.16.0 实现一致；仅修正 API 行号与类型契约）
- BUILD：`20260726-XXX`

## 1. 页面定位

玩家门户的“CDK 兑换”页面，用于让任意已登录用户输入兑换码（CDK），并将奖励直接发放到指定游戏角色。

该页采用“全局兑换”模式：用户无需选择实例，后端会通过 code 自动识别归属实例，并在兑换成功后自动关注对应服务器（便于用户在「我的服务器」中看到该实例）。

## 2. 入口与路由

- [ROUTE] `/guild/cdk` 为 `/guild` 基座下子路由（写法：`<Route path="/guild">` 下的 `path="cdk"`）
- 页面受登录保护：未登录访问会被重定向到 `/login`，并携带 `from=/guild/cdk`
- 该路径在 Layout 的底部导航激活映射中归属 `/guild` 首页 tab（底部 tab 激活态保持一致）
- 玩家门户首页（`/guild`）的快捷入口包含“CDK兑换”

浏览器侧核对（无登录态）：
- 直接访问 `https://gsp.ecsrz.com:3001/guild/cdk` 会跳转到“登录玩家门户”页面（可见 BUILD：`20260725-010`）

## 3. 角色与权限

- 访问权限：任意已登录用户（player portal）
- 鉴权方式：
  - 前端路由：`ProtectedRoute` 基于 `useAuth()` 的 `user` 判定是否跳转 `/login`
  - 后端接口：`/api/cdk/*`、`/api/player-bindings` 挂载时统一套 `authenticateToken(JWT_SECRET)`
- 速率限制：
  - `GET /api/cdk/lookup` 与 `POST /api/cdk/redeem` 都套了 `createCdkRedeemLimiter()`（避免暴力枚举）

## 4. 核心功能点

- 输入卡密
  - 输入框会自动将输入转换为大写（`toUpperCase()`），并使用等宽字体 + 居中显示
  - 输入后触发 500ms 防抖预览查询（lookup），用于展示礼包/物品预览
- 预览奖励
  - 预览卡片展示礼包名/描述与物品列表（items），无 items 时回退单物品字段（item_name/count）
  - 预览加载时展示 skeleton
- 选择/填写游戏角色名
  - 有绑定角色（且状态 verified）时：展示下拉选择
  - 无绑定角色时：展示自由输入，并提供“去绑定”快捷跳转到 `/guild/bind`
- 兑换
  - 兑换按钮在 `preview` 存在且 `playerName` 非空时才可用
  - 成功后展示“兑换成功”结果卡片：奖励明细 + 自动关注提示 + “继续兑换”按钮

## 5. 交互流程

**未登录访问**

1. 访问 `/guild/cdk`
2. 路由守卫判定未登录 → 跳转 `/login`（携带 `from=/guild/cdk`）

**已登录兑换（有绑定角色）**

1. 输入 CDK（等待 500ms 防抖）
2. 成功获取预览后，自动填充绑定列表的第一个角色名（如果 `playerName` 为空）
3. 点击“立即兑换”
4. 成功 → 展示“兑换成功”卡片，并提示“已自动关注该服务器”

**已登录兑换（无绑定角色）**

1. 输入 CDK → 预览成功后出现“游戏角色名”输入框
2. 用户手动输入角色名，或点击“去绑定”跳转 `/guild/bind`
3. 点击“立即兑换”完成兑换

## 6. 接口与数据

- [API] `GET /api/cdk/lookup?code=xxx`
  - 用途：预览奖励（不兑换）
  - 失败：
    - 400：缺少 code 参数（`PANEL_VALIDATION_ERROR`）
    - 404：兑换码不存在或已失效（`CDK_NOT_FOUND`）
- [API] `POST /api/cdk/redeem`
  - 用途：全局兑换（无需 serverId；成功后可自动关注实例）
  - Body：`{ code: string; player_name?: string }`
  - 响应：`{ code: CdkCodeSummary; delivered: boolean; followed: boolean }`
  - 失败：
    - 401：未认证（`PANEL_UNAUTHORIZED`）
    - 400：缺少 code（`PANEL_VALIDATION_ERROR`）
    - 404：兑换码不存在（`CDK_NOT_FOUND`）或 pack 不存在（`PACK_NOT_FOUND`）
    - 409：已被领取（`CDK_ALREADY_CLAIMED`）
    - 410：已过期（`CDK_EXPIRED`）
    - 400：奖励命令渲染失败（`COMMAND_RENDER_FAILED`）
    - 503：命令队列满（`COMMAND_QUEUE_FULL`）
- [API] `GET /api/player-bindings`
  - 用途：获取玩家绑定的游戏角色列表（前端仅使用 `verify_status === 'verified'` 的绑定）

数据类型（来自 `@public/schema/panel-api-types`）：
- `CdkCodeSummary`：CDK 摘要（含 `server_id` / `gift_name` / `gift_description` / `items` / `status` / `expires_at` 等）
- `Binding`（v4.17.0 起的统一绑定类型，替代旧 `PlayerBindingSummary`）：响应字段为 `player_name` / `scope_ref`（游戏类型）/ `verify_status: 'pending' | 'verified' | 'expired' | 'revoked'`
  - 注：旧 `PlayerBindingSummary` 在公共契约中标记为 `@deprecated`（v4.18.0 删除）

## 7. 状态管理与副作用

- 状态
  - `bindings`、`loadingBindings`：绑定角色列表与加载状态
  - `code`：输入的 CDK（UI 展示为大写）
  - `playerName`：要发放奖励的游戏角色名
  - `preview`、`previewLoading`：兑换码预览与加载状态
  - `redeeming`：兑换请求中（用于禁用按钮与文案“兑换中…”）
  - `success`：兑换成功后渲染结果卡片（SuccessCard）
- 副作用
  - mount 时 `loadBindings()` 拉取绑定列表，失败回退空列表
  - `useEffect([code])` 做 500ms 防抖：触发 `lookupCdk()` 拉取预览
  - 兑换成功后会：
    - 清空 `code/playerName/preview`
    - `loadBindings()` 重新拉绑定（用于覆盖“自动关注后新增的服务器/绑定变化”等场景）

## 8. 错误与边界

- [EDGE] 未登录访问：`ProtectedRoute` 直接重定向 `/login`（携带来源路径）
- [EDGE] 预览 lookup 的 404 不 toast：兑换码不存在/已失效时保持静默（避免“输错一个字就炸提示”的体验）
- [EDGE] 非 404 的预览错误会 toast：例如 401/429/500（以 `PanelApiError` 为准）
- [EDGE] 兑换按钮禁用条件：`!preview || !playerName.trim() || redeeming`
- [EDGE] Enter 键触发：只有 `preview` 存在时，输入框按 Enter 才会触发兑换
- [EDGE] 绑定列表仅取 verified：未验证绑定不会出现在下拉中；此时用户仍可手工输入角色名兑换
- [EDGE] 速率限制：lookup 与 redeem 都套 limiter，触发后用户侧可能表现为 toast “请求过于频繁”（依赖后端错误文案）

## 9. 体验与一致性检查

- [UX] Apple 浅色视觉：页面使用 `gp-*` 组件样式 + 轻量渐变强调（成功态/提示态），符合玩家门户主题
- [UX] 渐进呈现：只有在预览成功后才显示“游戏角色”步骤，降低初次进入的认知负担
- [UX] 明确的成功反馈：成功卡片展示奖励明细，并提示“自动关注服务器”
- [RISK] `toUpperCase()` 会强制把输入改为大写：若未来存在区分大小写的兑换码（通常不应有），会导致误判；需要在契约侧明确“code 必须大写”或取消强制转换
- [TODO] 预览未展示 `expires_at/status`：当前 UI 只展示奖励内容，不展示是否已过期/已被领取；若要减少“点了才知道失败”，可在预览区增加状态提示（需产品确认）

## 10. 关键实现定位（代码引用）

- 路由注册（/guild 基座子路由 cdk）：[App.tsx#L451-L460](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L460)
- 受保护路由实现（未登录跳 /login 并携带 from）：[ProtectedRoute](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)
- 基座 Layout（`variant="player"`，底部 5 tab）：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx) + [Layout.tsx#L818-L995](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L818-L995)
- 底部 tab 激活映射（`/guild/cdk` → `/guild`）：[Layout.tsx#L227](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L227)
- 页面实现（防抖预览/绑定角色/兑换成功卡片）：[GuildCdk.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildCdk.tsx#L1-L425)
  - 兑换成功卡片 `SuccessCard`：[GuildCdk.tsx#L42-L134](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildCdk.tsx#L42-L134)
  - 主组件（防抖 lookup + redeem + reset）：[GuildCdk.tsx#L136-L425](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildCdk.tsx#L136-L425)
- 玩家门户首页快捷入口（包含 /guild/cdk）：[GuildDock.tsx#L65-L70](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L65-L70)
- API 客户端（lookupCdk 内联类型 + redeemCdkGlobal）：[client.ts#L838-L848](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L838-L848)
- API 客户端（listPlayerBindings）：[client.ts#L934-L936](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L934-L936)
- 后端路由挂载（/api/cdk 套 JWT）：[routes-registry.ts#L825](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L825)
- 后端路由挂载（/api/player-bindings 套 JWT）：[routes-registry.ts#L905](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L905)
- 后端实现（全局 lookup + redeem，含 `createCdkRedeemLimiter()` 限流）：[cdk.ts#L216-L338](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/cdk.ts#L216-L338)
- 公共类型契约（`CdkCodeSummary`）：[panel-api-types.ts#L1010-L1030](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L1010-L1030)
- 公共类型契约（`Binding` 统一类型，v4.17.0 替代 `PlayerBindingSummary`）：[panel-api-types.ts#L3120-L3141](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L3120-L3141)

## 11. 待办与风险

- [TODO] 登录态浏览器回归：验证输入 CDK 后预览是否正确展示礼包名/物品列表；兑换成功后是否确实“自动关注”并在「我的服务器」可见
- [TODO] 失败态浏览器回归：验证 409/410/503 等错误码在 UI 侧的文案表现是否清晰（目前统一 toast，可能需要更友好的提示）
- [RISK] 兑换属于高价值操作：当前页面未显式展示"将发放到哪个实例/哪个服"的信息（API 返回 `code.server_id` 但 UI 未渲染服务器名）；若用户可能持有多个服的 CDK，建议在预览区补充服务器名（需产品确认与后端补字段或前端用 `listServers()` 反查）
- [RISK] `window.confirm` 风格弹窗在本页未使用（无破坏性操作），但解绑/重置等场景的"继续兑换"按钮无二次确认——成功兑换后立即清空 `code/playerName/preview`，用户误点"继续兑换"不会丢失已发放的奖励，但若网络抖动导致 `delivered: false` 走 toast 错误分支时，状态不被清空，需手动重置
- [RISK] `lookupCdk` 在 client.ts 中用内联类型 `{ code: {...} }` 而非引用 `CdkCodeSummary` 公共类型，存在类型契约漂移风险；建议改用 `LookupCdkResponse` 公共类型
- [RISK] 防抖 `setTimeout(500ms)` 在快速连续输入时可能产生竞态：若用户在 500ms 内修改 code 多次，最后只触发一次 lookup，但若第一次 lookup 比第二次先返回（网络抖动），会出现"旧预览覆盖新预览"——当前实现没有用 AbortController 取消旧请求
