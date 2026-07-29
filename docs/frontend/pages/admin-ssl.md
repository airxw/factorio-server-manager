# SSL 证书管理

## 1. 页面定位
> 系统管理员在 Panel 内查看 nginx TLS 证书状态、热重载 nginx、上传第三方证书或生成自签证书的运维页面（v4.4.0-L1，I1 优化项）。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/ssl`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/ssl`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/ssl`
- 进入方式：登录后从 `/admin` 侧边栏「SSL 证书管理」入口进入；或直接输入 URL。
- 退出方式：点击侧边栏其他菜单；浏览器返回；点击退出登录。

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（路由级 `RequireRole` + 组件内 `isAdminRole` 双重门控）
- 守卫组件：
  - 路由级：`RequireRole allow={['server_admin', 'system_admin', 'admin']}`（外层 `/admin` 基座 + 内层系统管理子路由双层套用）
  - 组件级：`isAdminRole(user?.role)` 不通过 → `<Navigate to="/forbidden" replace />`
- 未登录行为：被 `RequireRole` 上游的 `RequireAuth` 拦截，重定向到 `/login?redirect=/admin/ssl`
- 越权行为：路由级 401/403 由后端 `authenticateToken + requireAdmin` 中间件拒绝；组件级本地校验后跳 `/forbidden`

## 4. 核心功能点
- **当前证书信息卡**：展示 CN / 签发者 CN / SAN 域名 / 有效期起止 / SHA-256 指纹 / 证书路径 / 密钥路径；剩余天数徽章（>30 绿 / <30 黄 / <7 红 / 已过期 红）；自签名徽章。
- **热重载 nginx**：触发 `nginx -s reload`，不替换证书文件；二次确认 Modal 提示「HTTPS 服务可能短暂中断」。
- **上传新证书**：textarea 收集 PEM（fullchain）+ KEY 内容 → 暂存到 staging 目录（不直接覆盖 nginx 路径）。
- **生成自签证书**：CN + SAN（逗号/空格分隔）+ 有效天数（1-3650）+ 可选组织名 O，生成到 staging 目录。
- **暂存证书区**：展示最后一次 stage/self-signed 的 cert_path/key_path + 来源标识；支持「部署到 nginx」或「丢弃暂存」。
- **部署暂存证书**：将 staging 路径证书部署到 nginx 实际路径 + 触发热重载；二次确认 Modal 明确「此操作不可逆」。

## 5. 交互流程
1. 页面挂载 → `useEffect` 触发 `loadCertInfo()` → 调用 `GET /api/system/ssl` → 渲染证书信息卡。
2. 用户点击「热重载 nginx」→ 弹出确认 Modal → 确认后 `POST /api/system/ssl/reload` → toast 反馈成功/失败。
3. 用户填写 PEM/KEY → 点击「暂存证书」→ 前端校验非空 → `POST /api/system/ssl/stage` → 暂存区出现条目。
4. 用户填写 CN/SAN/days/O → 点击「生成自签证书」→ 前端校验 → `POST /api/system/ssl/self-signed` → 暂存区出现条目。
5. 暂存区「部署到 nginx」→ 弹出确认 Modal（含路径预览 + 不可逆提示）→ 确认后 `POST /api/system/ssl/deploy` → 成功后清空 staged + 刷新 certInfo。
6. 任意错误 → `setError` 渲染顶部 alert + toast；按钮 disabled 防重复提交。

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/system/ssl` | GET | JWT + requireAdmin | 获取当前证书信息（subject/issuer/SAN/有效期/指纹/路径/days_remaining/self_signed/available） | 401 PANEL_UNAUTHORIZED / 403 PANEL_FORBIDDEN / 500 SSL_INTERNAL |
| `/api/system/ssl/reload` | POST | JWT + requireAdmin | 触发 `nginx -s reload`，返回 `{ success, message }` | 500 SSL_RELOAD_FAILED |
| `/api/system/ssl/stage` | POST | JWT + requireAdmin | 暂存 PEM+KEY 到 staging 目录，返回 `{ cert_path, key_path }` | 400 SSL_INVALID_PEM / 400 SSL_INVALID_KEY |
| `/api/system/ssl/deploy` | POST | JWT + requireAdmin | 部署 staging 证书到 nginx 路径 + 热重载 | 400 SSL_STAGING_NOT_FOUND / 500 SSL_DEPLOY_FAILED |
| `/api/system/ssl/self-signed` | POST | JWT + requireAdmin | 生成自签证书到 staging 目录 | 400 SSL_SAN_REQUIRED / 500 SSL_OPENSSL_FAILED |

> 后端挂载点：`routes-registry.ts#L877` `app.use('/api/system/ssl', authenticateToken(JWT_SECRET), requireAdmin, createSslRouter(...))`。

## 7. 状态管理与副作用
- Context / Store：`useAuth()`（提供 `api`、`user`）、`useToast()`（全局 toast）
- Local state：
  - `[STATE]` `certInfo` / `loading` / `error`：证书信息加载三态
  - `[STATE]` `staged`：暂存证书（cert_path / key_path / source），仅记录最后一次操作
  - `[STATE]` `reloadConfirmOpen` / `reloadBusy`：热重载确认 Modal + 提交中
  - `[STATE]` `uploadForm`（pem_content / key_content） / `uploadBusy`
  - `[STATE]` `selfSignedForm`（common_name / sanInput / days / organization） / `selfSignedBusy`
  - `[STATE]` `deployConfirmOpen` / `deployBusy`：部署确认 Modal + 提交中
- 副作用：仅 `useEffect` 触发首屏 `loadCertInfo()`；无定时器 / WS 订阅。

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 证书文件不可读 / 不存在 | 顶部 alert-warning「证书文件不可读或不存在」 | `certInfo.available === false` 分支 |
| 剩余天数 < 7 / 已过期 | 徽章红色 | `daysRemainingBadge()` 计算 |
| PEM/KEY 内容为空 | toast.warning「请填写 PEM 证书与私钥内容」 | 不发请求 |
| CN 为空 / SAN 为空 | toast.warning 阻断 | 不发请求 |
| 部署中途失败 | toast.error + Modal 不关闭（保留 staged 数据） | 用户可重试 |
| 部署成功 | 清空 staged + 刷新 certInfo | 防止重复部署 |
| 网络错误 / PanelApiError | 顶部 alert-error + toast.error | 通用错误兜底 |
| `isAdminRole` 不通过 | `<Navigate to="/forbidden" replace />` | 组件级守卫 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 lucide-react 图标（ShieldCheck / Zap / FileUp / ShieldAlert / Coffee / Upload / RefreshCw）；section 卡片 + page-header 模式，与 admin 其他页面一致；符合「苹果清新设计语言、非电竞风」要求；配色基于 CSS 变量 `--color-border` / `--color-bg-primary`。
- `[UX]` 移动端适配：操作区使用 `grid-template-columns: repeat(auto-fit, minmax(360px, 1fr))`，移动端自动堆叠；textarea 最小高度 80px；按钮无固定宽度。
- `[UX]` 与其他页面一致性：与 `/admin/tunnel`、`/admin/api-keys` 同属 I1-I4 优化项，共用 `sectionStyle` / `sectionTitleStyle` / `inputStyle` 内联样式风格；使用相同 `Modal` / `useToast` 组件。

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`/admin` 基座 + 系统管理子路由套 `RequireRole`）
- 页面组件：[SslManagement.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SslManagement.tsx)
- 关键 hook：[useAuth](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.ts) / [useToast](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ui/index.ts)
- API client：[client.ts#L1808-L1834](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1808-L1834)（SSL 5 个方法）
- 类型定义：[api/modules/system.ts#L314-L322](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/system.ts#L314-L322)
- 后端路由：[api/routes/ssl.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/ssl.ts)
- 后端挂载：[routes-registry.ts#L877](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L877)
- 角色守卫：[utils/role.ts#L5-L7](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts#L5-L7)（`isAdminRole`）

## 11. 待办与风险
- `[TODO]` 暂存证书区仅展示「最后一次」stage/self-signed 结果，无列表持久化；如果用户连续上传多份证书，前一份数据会丢失。可考虑增加 staging 列表接口（当前后端 `/stage` 不返回列表）。
- `[TODO]` 当前无证书过期预警机制（仅在剩余 < 7 天时徽章变红）。可考虑接入告警系统，到期前自动触发 Webhook/邮件。
- `[RISK]` PEM/KEY 通过 textarea 明文输入，浏览器自动填充历史可能记录私钥内容；建议改用 `<input type="file">` 文件上传 + `FileReader` 读取，避免私钥进入 DOM 输入历史。
- `[RISK]` 部署操作不可逆——`/deploy` 直接覆盖 nginx 路径下证书文件并触发热重载；若上传错误证书（如域名不匹配），HTTPS 立即对所有用户失效。前端虽有二次确认，但无「回滚到上一份证书」能力。
- `[RISK]` 热重载期间 HTTPS 服务可能短暂中断（Modal 已提示），但若 nginx 配置语法错误，`nginx -s reload` 会失败且不影响现有连接；后端需保证错误正确返回（避免误报 success）。

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（组件 / API client / 后端路由 / 路由注册表）
