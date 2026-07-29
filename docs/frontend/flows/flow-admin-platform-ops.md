# 流程：系统平台运维

## 目标

系统管理员通过 `/admin/nodes` → `/admin/ssl` → `/admin/tunnel` → `/admin/api-keys` → `/admin/quotas` → `/admin/system-health` 完成平台级资源部署、安全凭证下发、容量治理与监控。

## 前置条件

- 角色为 `server_admin` / `system_admin` / `admin`。
- 节点列表中至少有一个 `linked_at` 不为空的节点（主节点 + N 个 slave 节点）。
- SSL 证书工厂目录 `/home/airxw/Documents/gsp/gameserver-panel/factory/` 含可用证书。
- 配额基线已通过 `/admin/quotas` 配置。

## 主流程

```
[/admin/nodes]  ← 节点列表 + 添加节点 + bootstrap-script 下载
        │
        │ POST /api/nodes  → 生成 linkKey
        │ GET  /api/nodes/invite/:linkKey/bootstrap-script  →  slave 节点接入脚本
        │ WS   node.status  → 节点状态实时同步
        ▼
[/admin/ssl]  ← 证书列表 + 申请 + 上传 + 配置 + 到期提醒
        │
        │ POST /api/admin/ssl/certificates  → 上传新证书
        │ POST /api/admin/ssl/deploy         → 部署到 nginx（不可逆）
        ▼
[/admin/tunnel]  ← 隧道列表 + 创建 + 配置 + 状态 + 日志
        │
        │ POST /api/admin/tunnel  → 创建隧道（生成 token）
        │ POST /api/admin/tunnel/:id/refresh-token  → 刷新 token
        ▼
[/admin/api-keys]  ← API Key 列表 + 创建 + 权限 + 有效期 + 复制/撤销
        │
        │ POST /api/admin/api-keys  → 创建（明文 key 仅展示一次）
        │ DELETE /api/admin/api-keys/:id  → 撤销
        ▼
[/admin/quotas]  ← 角色/用户/实例/资源/全局配额 + 配额规则
        │
        │ GET /api/admin/quotas  → 拉取全量
        │ PUT /api/admin/quotas/:scope  → 更新某层配额
        ▼
[/admin/system-health]  ← 实时指标 + 一键诊断 + 磁盘概览
        │
        │ GET /api/system/metrics     → CPU/内存/磁盘
        │ GET /api/system/health      → 服务/实例概览
        │ GET /api/system/diagnostics → 一键诊断
        │ WS  system_monitor          → 实时推送
        ▼
[完成]
```

## 失败与回退

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---------------|---------|------|
| 节点离线 | 节点行状态红色 + WS 断开图标 | 见 `nodeStatusStore` |
| SSL 部署失败 | Toast 红色 + 证书状态保持「未部署」 | 不可逆操作前应有强确认 |
| Tunnel token 泄露 | input 明文显示，肩窥风险 | 见 [admin-tunnel.md](../pages/admin-tunnel.md) |
| API Key 创建后丢失 | 明文 key 仅创建时展示一次，关闭 Modal 后不可再获取 | 见 [admin-api-keys.md](../pages/admin-api-keys.md) |
| 配额超限 | 实例创建/启动返回 403 + Toast「配额已满」 | 见 `quotas.ts` |
| 诊断接口超时 | 30s 超时 + Toast「诊断超时，请重试」 | 见 `SystemHealth.tsx` |

## 关键接口

| `[API]` 接口 | 方法 | 鉴权 | 用途 |
|--------------|------|------|------|
| `/api/nodes` | GET/POST | JWT+admin | 节点列表/添加 |
| `/api/nodes/invite/:linkKey/bootstrap-script` | GET | linkKey 自鉴权 | slave 接入脚本 |
| `/api/admin/ssl/certificates` | GET/POST | JWT+admin | 证书列表/上传 |
| `/api/admin/ssl/deploy` | POST | JWT+admin | 部署证书到 nginx |
| `/api/admin/tunnel` | GET/POST | JWT+admin | 隧道列表/创建 |
| `/api/admin/tunnel/:id/refresh-token` | POST | JWT+admin | 刷新 token |
| `/api/admin/api-keys` | GET/POST | JWT+admin | API Key 列表/创建 |
| `/api/admin/api-keys/:id` | DELETE | JWT+admin | 撤销 Key |
| `/api/admin/quotas` | GET/PUT | JWT+admin | 配额读取/更新 |
| `/api/system/metrics` | GET | JWT | 系统指标 |
| `/api/system/health` | GET | JWT | 服务健康 |
| `/api/system/diagnostics` | GET | JWT+admin | 一键诊断 |
| `/ws system_monitor` | WS | JWT | 实时监控 |

## 页面引用

- [admin-nodes.md](../pages/admin-nodes.md)
- [admin-ssl.md](../pages/admin-ssl.md)
- [admin-tunnel.md](../pages/admin-tunnel.md)
- [admin-api-keys.md](../pages/admin-api-keys.md)
- [admin-quotas.md](../pages/admin-quotas.md)
- [admin-system-health.md](../pages/admin-system-health.md)
- [admin-platform.md](../pages/admin-platform.md)

## 风险与待办

- `[RISK]` SSL `deploy` 不可逆 + 无回滚，部署错证书 HTTPS 立即全站失效；建议加 dry-run 校验 + 备份当前证书。
- `[RISK]` Tunnel token 与 API Key 明文展示，建议改为 `<input type="password">` + 一次性「显示」按钮 + 复制按钮。
- `[RISK]` `Packs.tsx` 直接读 `localStorage.getItem('panel_token')` 绕过统一鉴权 client，不享受 token 刷新逻辑。
- `[RISK]` `/api/system/*` 后端仅 `authenticateToken`，普通用户可直接调用获取系统资源信息；建议后端补 `requireAdmin`。
- `[RISK]` `nodes` WS 状态无 UI 提示，断开时用户无感知。
- `[TODO]` `PlatformDashboard` 与 `SystemHealth` 自研 SVG 图表在窄屏下 `preserveAspectRatio="none"` 拉伸失真，建议引入图表库或改 `preserveAspectRatio="xMidYMid meet"`。
- `[TODO]` 配额管理四层（角色/用户/实例/资源）+ 全局，UI 信息密度过高，建议改为左导航 + 右详情布局。
