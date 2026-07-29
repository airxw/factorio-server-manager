# 实例多版本共存 & 权限调整方案

## 一、问题描述

当前模式下，游戏更新（下载/安装新版本）仅允许 **实例所有者（instance_admin + owner 匹配）** 操作，其他 instance_admin 或普通 user 无法触发更新。这与实际场景矛盾——同一个 Pack（如 Minecraft）应允许多人下载和使用不同版本，不应将"版本下载"与"实例所有权"强绑定。

此外，长期未被调用的老旧实例缺乏自动清理机制，浪费存储和端口资源。

## 二、目标模式

1. **版本池**：每个 Pack 可同时存在多个已下载的游戏版本，存放在节点本地存储中。
2. **下载权限开放**：任何已认证用户均可触发版本下载（不限于实例所有者）。
3. **实例版本自选**：创建/启动实例时，用户可选择使用版本池中任意已有版本。
4. **实例自动清理**：实例超过 90 天未被调用，且该 Pack 存在至少 2 个更新的版本时，允许删除该实例。

---

## 三、开发事项

### 3.1 数据库变更

#### 3.1.1 新增表 `game_versions` — 版本池

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string (UUID, PK) | 版本记录 ID |
| `pack_id` | string (FK→packs.id) | 所属 Pack |
| `version` | string | 版本号（如 "1.21.4"） |
| `node_id` | string (FK→nodes.id) | 存放节点 |
| `download_path` | text | 节点上的文件路径 |
| `file_size_bytes` | integer | 文件大小（可选） |
| `downloaded_by` | string (FK→users.id) | 下载触发者 |
| `downloaded_at` | text (ISO 8601) | 下载完成时间 |
| `created_at` | text (ISO 8601) | 记录创建时间 |

#### 3.1.2 `servers` 表新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `current_version` | string | 实例当前使用的版本号（取自 game_versions.version） |
| `version_id` | string (FK→game_versions.id, nullable) | 关联的版本记录 |
| `last_activity_at` | text (ISO 8601) | 最后一次被调用的时间（启动/停止/命令执行/RCON 交互） |
| `marked_for_deletion` | boolean, default false | 是否已标记待删除 |

#### 3.1.3 版本号字段迁移（已有数据兼容）

对现存的 `servers` 行，`current_version` 初始为 null（旧实例未记录版本），`last_activity_at` 取 `updated_at` 作为初始值。

---

### 3.2 后端 API 变更

#### 3.2.1 版本下载权限放宽

**现状**：`POST /api/servers/:serverId/update/download` 使用 `requireInstanceAdmin()` 中间件，仅实例所有者可触发。

**变更**：新增独立端点，不绑定具体实例，仅绑定 Pack：

- `POST /api/packs/:packId/versions/download` — **任意已认证用户** 触发版本下载
  - Body: `{ version: string }`（可选，不传则下载最新版）
  - 后台异步执行：check → curl 下载 → 写入 game_versions 表
  - 返回: `{ task_id: string, message: "下载已启动" }`

- `GET /api/packs/:packId/versions/download/progress?task_id=xxx` — 查询下载进度

- `GET /api/packs/:packId/versions` — 列出该 Pack 所有已下载版本

- `DELETE /api/packs/:packId/versions/:versionId` — 删除指定版本（仅 server_admin，且需校验无实例引用）

**中间件**：上述端点使用 `authenticateToken` + `requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN, Role.USER)` 即可（即任意已认证用户），无实例所有权校验。

**旧端点兼容**：保留现有 `POST /api/servers/:serverId/update/download` 作为兼容路径，内部改为调用新版本池下载逻辑，下载完成后更新该实例的 version_id。

#### 3.2.2 实例创建/启动时选择版本

- `POST /api/servers` 创建实例时，新增可选参数 `version_id`（取自 game_versions.id）。不传则默认使用最新版本。

- 实例启动时，按照 `servers.version_id` 对应的 `game_versions.download_path` 部署二进制文件。

#### 3.2.3 `last_activity_at` 更新时机

在以下操作中更新 `servers.last_activity_at = now()`：

- 实例启动（`POST /:id/start`）
- 实例停止（`POST /:id/stop`）
- 执行远程命令（`POST /:id/command`）
- RCON 交互（WebSocket 消息）
- 版本更新（download/apply 完成时）

建议在服务层封装 `touchInstance(serverId)` 方法统一调用。

#### 3.2.4 实例自动清理任务

新增 `INSTANCE_CLEANUP` 定时任务（建议每天执行一次），逻辑：

1. 查询所有 `servers` 中 `status = 'stopped'` 且 `marked_for_deletion = false` 的实例
2. 对每个实例：
   a. 检查 `last_activity_at` 距今是否超过 90 天（可配置）
   b. 查询该 Pack（`servers.pack_id`）在 `game_versions` 中比 `servers.current_version` 更新的版本数量
   c. 若更新版本数 >= 2，则标记 `marked_for_deletion = true`，写入审计日志
3. server_admin 可在面板中查看待删除列表，手动确认删除或设置自动删除策略

```sql
-- 伪 SQL：查找符合删除条件的实例
SELECT s.* FROM servers s
LEFT JOIN game_versions gv ON gv.pack_id = s.pack_id
WHERE s.status = 'stopped'
  AND s.marked_for_deletion = false
  AND s.last_activity_at < datetime('now', '-90 days')
  AND gv.version > s.current_version  -- 此处需语义版本比较
GROUP BY s.id
HAVING COUNT(gv.id) >= 2
```

**注意**：SQLite 不支持原生语义版本比较，需在应用层做版本排序，或存储可排序的版本号格式。

#### 3.2.5 版本清理任务

新增 `VERSION_CLEANUP` 定时任务（建议每天执行一次），逻辑：

1. 查询所有 `game_versions` 记录
2. 对每条记录：检查是否被任何 `servers` 引用（`servers.version_id`）
3. 对未被引用的版本，检查是否有 >= 2 个更新版本存在
4. 满足条件的版本：删除节点上的文件，删除 `game_versions` 记录

---

### 3.3 前端变更

#### 3.3.1 版本下载入口独立化

- 新增「版本管理」页面（或 Pack 详情中的版本 Tab），展示该 Pack 已下载的所有版本列表
- 提供「下载新版本」按钮，支持输入指定版本号或自动下载最新版
- 下载进度条（复用现有 UpdateCheck 组件的进度轮询逻辑）
- **不再校验用户是否为实例所有者**，只校验登录态

#### 3.3.2 实例创建/详情页版本选择

- 创建实例表单中，新增「选择版本」下拉框，列出该 Pack 所有已下载版本，默认选中最新
- 实例详情页展示当前使用的版本号
- 「切换版本」操作（需实例停止状态）：更换 `version_id`，下次启动使用新版本

#### 3.3.3 实例清理面板（server_admin 可见）

- 新增「待清理实例」列表页
- 展示：实例名、Pack、当前版本、最后活跃时间、闲置天数、更新版本数
- 操作：手动确认删除 / 批量删除 / 忽略（取消标记）

#### 3.3.4 现有 UpdateCheck 页面兼容

- 保持现有实例详情中的「更新检查」功能，但「一键下载」按钮改为调用新版本池接口
- 下载完成后自动关联到当前实例的 `version_id`

---

### 3.4 权限体系调整

#### 3.4.1 更新路由中间件变更

| 端点 | 当前中间件 | 变更后中间件 |
|------|-----------|-------------|
| `GET /:serverId/update/check` | `requireInstanceAccess()` | 不变 |
| `POST /:serverId/update/apply` | `requireInstanceAdmin()` | `requireInstanceAccess()` |
| `POST /:serverId/update/download` | `requireInstanceAdmin()` | `requireInstanceAccess()` |
| `GET /:serverId/update/progress` | `requireInstanceAccess()` | 不变 |

即：apply 和 download 从"实例管理员"降为"有实例访问权"即可。结合新增的 Pack 级别版本下载端点，普通 user 也可以通过 Pack 维度触发下载。

#### 3.4.2 新增权限维度

| 操作 | 所需权限 |
|------|---------|
| 查看版本列表 | 已认证用户 |
| 下载新版本 | 已认证用户 |
| 删除已下载版本 | server_admin |
| 查看待清理实例 | server_admin |
| 确认删除实例 | server_admin |

---

### 3.5 版本号语义比较

版本号格式为 `x.y.z`（如 `1.21.4`），需实现可靠的语义版本比较函数，用于：

- 判断"是否存在至少 2 个更新的版本"
- 版本列表排序
- `game_versions` 表建议增加 `version_major`、`version_minor`、`version_patch` 三个整数列，便于 SQL 直接排序和比较，避免应用层每次解析字符串。

---

### 3.6 节点文件管理

- 下载的游戏二进制文件存放在 `INSTANCES_DIR/_versions/{pack_id}/{version}/` 下
- 实例启动时，从版本目录软链接或复制到实例工作目录
- 版本清理时，删除版本目录
- 节点磁盘空间监控，下载前检查可用空间

---

### 3.7 数据迁移

1. 创建 `game_versions` 表
2. 为 `servers` 表新增 `current_version`、`version_id`、`last_activity_at`、`marked_for_deletion` 列
3. 对存量数据：`last_activity_at` 取 `updated_at`；`current_version` 和 `version_id` 置 null
4. 为 `game_versions` 添加可选整数版本列 `version_major`、`version_minor`、`version_patch`

---

## 四、建议

1. **90 天阈值可配置化**：将 90 天作为默认值写入配置文件，允许 server_admin 调整。

2. **清理前通知**：标记 `marked_for_deletion` 后，向实例所有者发送站内通知，给予 7 天宽限期后再由 server_admin 确认删除。

3. **磁盘空间保护**：下载前检查节点可用空间，低于阈值（如 5GB）时拒绝下载并提示。

4. **版本覆盖保护**：同一 Pack 同一版本号已存在时，提示用户"该版本已下载"，避免重复下载浪费带宽和存储。

5. **增量下载**：未来可考虑基于文件 diff 的增量更新，减少大文件（如 ARK 服务端 20GB+）的重复下载。

6. **审计日志**：所有下载、删除、清理操作写入 `audit_logs` 表，便于追溯。
