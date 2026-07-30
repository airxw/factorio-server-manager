# 实例管理 · 实例详情页（/admin/servers/:id）

> 梳理日期：2026-07-30 ｜ 核对方式：内置浏览器（生产）+ 代码静态审查

## 1. 页面定位

单实例运维工作台：生命周期操作（启动/停止/保存世界/删除/重置状态）、可折叠信息卡（状态/端口/有效期/计费/磁盘/子目录清理）、按 Pack 动态生成的分组 Tab 工作区（运行时/配置/运维/业务运营）。`ServerDetailCore` 为核心组件，被 admin 与 store 两套角色视图复用。

## 2. 入口与路由

- [ROUTE] `/admin/servers/:id`（AdminLayout 内，`ServerDetailAdmin` → `ServerDetailCore listPath="/admin/servers"`）
- [ROUTE] `/instances/:id` 经 RootRedirect 按角色分流至此（admin 系）
- [ROUTE] Tab 状态持久化：`?tab=console|config-files|...`（replace 模式，浏览器前进/后退可恢复）
- [ROUTE] 业务运营 pseudo-tab → `/instances/:id/business` 二级页

## 3. 角色与权限

| 能力 | 角色要求 |
|---|---|
| admins tab（共管管理） | `isAdminRole`（server_admin+） |
| roles tab（角色管理） | `instance_admin+` |
| 业务运营入口、重置状态、修改有效期 | `isAdminRole` |
| 续费操作 | 非豁免实例的拥有者/管理者 |

## 4. 核心功能点

1. 头部操作区：启动（含前置引导向导 + 存档选择弹窗）/停止/保存世界（RCON save）/刷新（图标按钮）/业务运营/删除（输名确认）
2. error 状态专属提示条 + 强制重置状态（纯 DB 回退）
3. 可折叠信息卡：摘要行（状态/游戏/版本/端口/磁盘）+ 展开 9+ 行（含有效期编辑、实例计费、续费、续费明细、磁盘刷新、子目录清理×5），折叠状态记忆 localStorage
4. Tab 工作区：
   - 桌面端（>768px）：2 级导航——分组 pill（运行时/配置/运维/业务运营 + 计数）→ 组内子 tab 下划线
   - 移动端（≤768px）：全部 tab 打平为横向滚动 pill 条 + 左右滑动手势切换
5. Tab keep-alive：访问过的 tab 保持挂载（display:none），保留分页/草稿状态
6. Tab 警告条：运行中改配置需重启 / 运行中禁用部分运维 tab
7. 底座 tab：控制台（RCON + WS 日志流）、日志文件、命令帮助、共管管理、角色管理；Pack 动态 tab：配置文件/地图生成/Mod 管理/存档管理/聊天日志/服务端版本等

## 5. 交互流程

- 进入 → getServer → 骨架屏 → 信息卡（默认折叠）+ tab 区
- 启动：getStartupGuide 检查 → 未完成弹 StartupGuideWizard → 完成后弹 StartOptionsModal（选存档）→ doStart
- WS 断线重连成功 → 重置 liveState + refresh（v4.36.1 防状态残留）
- 切 tab → URL ?tab= 同步 + activatedTabs 登记 + 分组记忆（lastTabByGroup）
- 续费：选周期 → renewInstance → Toast 扣费结果 → refresh + 重拉续费记录

## 6. 接口与数据

- [API] `GET /api/servers/:id`、`POST :id/start|stop`、`DELETE :id`、`POST :id/reset-state`
- [API] `POST :id/command`（save 世界）、`GET :id/disk-usage`、`DELETE :id/subdir/:subdir`
- [API] `GET :id/billing/settings`、`GET :id/renewals`、`POST :id/renew`
- [API] `PATCH :id/expiry`（admin 修改有效期）
- [API] `GET /api/packs`（取 ui_tabs）、`GET :id/startup-guide`
- WS：`console.output` / `instance.state`（经 RconConsole 单连接回传 onStateChange）

## 7. 状态管理与副作用

- [STATE] 加载：骨架屏（标题 + 信息卡 7 行）；失败：ErrorState 带重试
- [STATE] liveState（WS 实时）覆盖 server.status；WS 重连后回退 API 值
- [STATE] activatedTabs keep-alive 集合；lastTabByGroup 分组记忆
- [STATE] 弹窗群：StartupGuideWizard / StartOptionsModal / ConfirmDialog(删除) / ExpiryEditModal
- useMediaQuery('(max-width: 768px)') 驱动 tab 导航双形态

## 8. 错误与边界

- [EDGE] activeTab 失效（换实例/角色无权限）→ 自动回落 console
- [EDGE] 运行中清理子目录 → 前端预判 + 后端 409 双保险
- [EDGE] 启动引导接口失败不阻断启动（后端 /start 再校验）
- [EDGE] 计费接口失败不阻断详情页（billingSettings=null 跳过渲染）
- [EDGE] AbortController 弃用：cancelledRef 丢弃迟到结果，避免控制台 ERR_ABORTED 噪音

## 9. 体验与一致性检查（美学 + 移动端诊断）

### 9.1 美学问题

- [UX] **信息卡「节点」行展示原始 `server.node_id`（UUID）**：列表页用 node_name，详情页却是裸 UUID，既丑又无信息价值（[UX] 高优先修复）
- [UX] **续费明细/续费行/磁盘行大量 inline style**：flex 布局、边框、字号散写 TSX，与卡片体系脱节
- [UX] **头部操作区按钮层级混乱**：启动(success)/停止(warning)/保存(ghost)/刷新(ghost icon)/业务运营(ghost)/删除(danger) 6 个并列，无主从；「保存」仅 running 出现造成布局跳动
- [UX] **2 级 tab 导航视觉噪音**：分组 pill 带计数徽章 + 子 tab 下划线，两层叠加后 tab 总数多时（12+）仍显拥挤
- [UX] **深色终端与浅色卡片强对比**：console-card 浅色 hover 阴影 + 内部 #0a0e14 终端，风格断层（决策点，同列表页 D5）

### 9.2 移动端兼容性问题（≤768px）

- [UX] **tab 打平丢失分组**（同列表页诊断 D4）：12+ tab 一字排开横滑，首屏只露 3-4 个，组语义丢失
- [UX] **头部操作区移动端换行**：6 按钮 wrap 2-3 行，挤压 tab 区首屏位置；缺移动端收敛（如收起为「···」菜单）
- [UX] **滑动切 tab 与内容滚动冲突**：useSwipe 绑定整个 tab 内容区，控制台日志（terminal 纵向滚动）内斜向滑可能误切（虽有 |dx|>|dy| 守卫）
- [UX] **terminal 固定 360px 高**：移动端未按 dvh 自适应，长日志场景局促
- [UX] **信息卡展开后行内操作按钮**（修改有效期/刷新磁盘/子目录清理×5）btn-sm 36px 低于 44px 标准
- [UX] **子目录清理 5 个 ghost 小按钮横排**：375px 下换行 2 行，间距 4px 过密易误触
- [RISK] 移动端双形态切换依赖 JS matchMedia（768px），与 CSS 媒体查询断点耦合，SSR/首屏闪烁需注意（当前纯 CSR 无 SSR 问题）

## 10. 关键实现定位（代码引用）

- 角色包装：[ServerDetailAdmin.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/admin/ServerDetailAdmin.tsx)
- 核心组件：[ServerDetailCore.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx)
- Tab 元数据与分组：[ServerDetailCore.tsx:L58-L113](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx#L58-L113)
- 2 级导航渲染：[ServerDetailCore.tsx:L1434-L1526](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx#L1434-L1526)
- 移动端 tab 打平：[ServerDetailCore.tsx:L1408-L1432](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx#L1408-L1432)
- 信息卡（含 node_id 行）：[ServerDetailCore.tsx:L1157-L1160](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx#L1157-L1160)
- 滑动手势：[ServerDetailCore.tsx:L607-L620](file:///home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx#L607-L620)、[useSwipe.ts](file:///home/airxw/gsp/panel/frontend/src/hooks/useSwipe.ts)
- 2 级导航样式：[styles.css:L5193-L5270](file:///home/airxw/gsp/panel/frontend/src/styles.css#L5193-L5270)
- 移动端 tab 条样式：[styles.css:L6212-L6264](file:///home/airxw/gsp/panel/frontend/src/styles.css#L6212-L6264)
- 终端样式：[styles.css:L1920-L1933](file:///home/airxw/gsp/panel/frontend/src/styles.css#L1920-L1933)

## 11. 待办与风险

- [TODO] E1：信息卡节点行 UUID → node_name（需 API 返回或列表数据映射）
- [TODO] E2：头部操作区移动端收敛为「主操作 + ··· 菜单」
- [TODO] E3：移动端 tab 恢复分组层级（与列表页 D4 同一方案）
- [TODO] E4：续费/磁盘/子目录清理 inline style 收编 CSS 类
- [TODO] E5：terminal 高度移动端改 min(360px, 50dvh) 类自适应
- [TODO] E6：评估 swipe 绑定范围收窄（仅 tab 条区域）或提高阈值
- [RISK] ServerDetailCore 被 admin/store 两视图复用，任何布局改动需双视图回归
- [RISK] tab keep-alive 机制下改动 tab 结构需验证 activatedTabs 行为
