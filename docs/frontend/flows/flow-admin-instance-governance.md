# 流程：系统管理员实例治理

## 目标

系统管理员通过 `/admin/servers` 列表 → `/admin/servers/:id` 详情 → `/admin/cleanup` 与 `/admin/maintenance` 清理，完成实例全生命周期治理。

## 前置条件

- 已登录且角色为 `server_admin` / `system_admin` / `admin`。
- 至少有一个 Game Pack 已安装（`/admin/packs`）。
- 至少有一个 Daemon 节点已链接（`/admin/nodes`）。

## 主流程

```
[/admin/servers]
        │
        │ GET /api/servers?include_owner=true
        ▼
[实例列表表格]  ← 搜索/状态筛选/排序/分页/CSV 导出
        │
        │ 点击某行实例
        ▼
[/admin/servers/:id]  ← ServerDetailAdmin
        │
        │ GET /api/servers/:id  +  GET /api/instances/:id/state
        ▼
[实例详情 Tab 体系]
   ├─ 控制台 Tab   → RCON 命令 + WS 实时日志
   ├─ 配置 Tab     → pack.yaml / config-files / player-join-settings
   ├─ 运维 Tab     → saves/backups/monitor/lists/mods
   └─ 业务运营 Tab → shop-admin / cdk / chat-triggers / votes / vip-permissions
        │
        │ 启动/停止/重启 → POST /api/servers/:id/{start|stop|restart}
        ▼
[实例停止后可清理]
        │
        ▼
[/admin/cleanup]   ← 待清理实例 + 全部实例概览
        │
        │ POST /api/admin/cleanup/:id  （先磁盘后数据库）
        ▼
[/admin/maintenance] ← 旧备份/日志/孤儿文件聚合清理
        │
        │ POST /api/admin/maintenance/cleanup-all
        ▼
[完成]
```

## 失败与回退

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---------------|---------|------|
| 实例正在运行无法删除 | 后端返回 409 → Toast「请先停止实例」 | 见 `ServerDetailAdmin` |
| 节点离线 | start 返回 503 → Toast「节点不可达」 | WS 状态同步 |
| RCON 连接失败 | Console Tab 显示红色错误行 | 不阻塞其他 Tab |
| 删除时磁盘清理失败 | DB 已删但文件残留 → 列入 `/admin/maintenance` 孤儿清单 | 见 `cleanup-service.ts` |
| `owner_user_id` 孤儿 | 列表显示 `owner_username='未知'` | 见 `LEFT JOIN` 处理 |

## 关键接口

| `[API]` 接口 | 方法 | 鉴权 | 用途 |
|--------------|------|------|------|
| `/api/servers` | GET | JWT+admin | 列表（含 owner_username） |
| `/api/servers/:id` | GET | JWT+admin | 详情 |
| `/api/servers/:id/state` | GET | JWT+admin | 实时状态 |
| `/api/servers/:id/{start,stop,restart}` | POST | JWT+admin | 生命周期控制 |
| `/api/admin/cleanup/:id` | DELETE | JWT+admin | 删除实例+磁盘 |
| `/api/admin/maintenance/cleanup-all` | POST | JWT+admin | 一键清理 |
| `/ws` `rcon` `instance.state` | WS | JWT | 实时日志与状态 |

## 页面引用

- [admin-servers.md](../pages/admin-servers.md)
- [admin-server-detail.md](../pages/admin-server-detail.md)
- [admin-cleanup.md](../pages/admin-cleanup.md)
- [admin-maintenance.md](../pages/admin-maintenance.md)
- [admin-packs.md](../pages/admin-packs.md)
- [admin-nodes.md](../pages/admin-nodes.md)

## 风险与待办

- `[RISK]` `/admin/servers` 列表点击实例跳 `/instances/:id`（玩家视图），非 `/admin/servers/:id`，管理员视图入口断裂。详见 [admin-servers.md](../pages/admin-servers.md) §11。
- `[RISK]` `ServerDetail` 被 `/instances/:id` 与 `/admin/servers/:id` 共享，两套视图无实质差异，未做角色化裁剪。
- `[RISK]` `cleanup` 与 `maintenance` 删除均为不可逆，无 dry-run 预览；`maintenance` 用 `useConfirm` 而 `cleanup` 用 `window.confirm`，确认风格不一致。
- `[TODO]` 实例详情页 Tab 数量 ≥10，移动端横向滚动体验差，建议改为折叠菜单。
- `[TODO]` `owner_username='未知'` 的孤儿实例应在 `/admin/cleanup` 主动标红提示。
