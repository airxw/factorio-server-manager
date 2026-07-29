# 备份恢复指南 (v3.9.0-D3)

> 本文档说明 GameServer Panel 的备份与恢复机制，覆盖：
>   - 数据库自动备份（v3.9.0-D1 引入）
>   - 实例自动备份（v3.8.0-S9/S10 引入）
>   - 手动备份与恢复操作
>   - 灾难恢复流程

## 一、备份范围

| 备份类型 | 备份对象 | 频率 | 保留期 | 存储位置 |
|---------|---------|------|--------|---------|
| DB 自动备份 | `panel.db` 全量文件 | 每 24h | `backup.db_retention_days`（默认 7 天） | `<backup.path>/.db-backup/` |
| 实例自动备份 | 单个实例的存档目录 | 每 24h | `backup.max_count`（默认 7 份） | `<backup.path>/<server_id>/` |
| 实例手动备份 | 单个实例的存档目录 | 手动触发 | 同自动备份 | 同上 |
| 系统配置备份 | `system_config` 表（含设置 schema） | 随 DB 备份 | 同 DB 备份 | DB 备份内含 |

## 二、DB 自动备份

### 2.1 配置

通过 `/admin/settings` 面板配置以下键：

| 设置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `backup.db_enabled` | boolean | `true` | 是否启用 DB 自动备份 |
| `backup.db_retention_days` | number | `7` | DB 备份保留天数（1-365） |
| `backup.path` | string | `/opt/gameserver-panel/backups` | 备份根目录 |

### 2.2 备份文件命名

```
<backup.path>/.db-backup/panel-YYYYMMDD-HHmmss.db
```

例：`panel-20260718-153000.db`

### 2.3 备份机制

1. Scheduler 每 24h 触发 `DB_BACKUP` 任务
2. 执行 `PRAGMA wal_checkpoint(FULL)` 确保 WAL 内容写回主 DB
3. 使用 `fs.copyFile`（含 `COPYFILE_FICLONE` 优化）复制 `.db` 文件
4. 清理超过 `db_retention_days` 的旧备份文件

### 2.4 手动触发

DB 备份目前不提供独立的 API 端点手动触发。如需立即备份，可：

```bash
# 1. SSH 到服务器
ssh airxw@gsp.ecsrz.com

# 2. 进入部署目录
cd /opt/gameserver-panel/panel/backend

# 3. 复制 DB 文件
cp data/panel.db /opt/gameserver-panel/backups/.db-backup/panel-manual-$(date +%Y%m%d-%H%M%S).db
```

## 三、实例自动备份

### 3.1 配置

| 设置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `backup.auto_enabled` | boolean | `false` | 是否启用实例自动备份 |
| `backup.max_count` | number | `7` | 每实例保留备份份数 |
| `backup.path` | string | `/opt/gameserver-panel/backups` | 备份根目录 |

### 3.2 备份内容

实例备份通过 `backupService.createBackup(serverId, 'system')` 触发：
- 调用 Daemon 把 `<instances_root>/<server_id>/saves/` 打包成 tar.gz
- 存储到 `<backup.path>/<server_id>/<timestamp>.tar.gz`
- 超过 `max_count` 的旧备份自动清理

### 3.3 手动触发

通过 Web 面板的实例详情页 → 备份 Tab → "立即备份"按钮触发。

## 四、恢复流程

### 4.1 DB 恢复（灾难恢复）

适用场景：`panel.db` 损坏 / 误删数据 / 升级失败回滚。

**前置条件**：服务已停止。

```bash
# 1. 停止 Panel 服务
sudo systemctl stop gameserver-panel.service

# 2. 备份当前损坏的 DB（如有空间）
cd /opt/gameserver-panel/panel/backend
mv data/panel.db data/panel.db.broken-$(date +%Y%m%d-%H%M%S)

# 3. 选择恢复点
ls -lh /opt/gameserver-panel/backups/.db-backup/
# 选择最近的有效备份，例如 panel-20260718-030000.db

# 4. 恢复 DB
cp /opt/gameserver-panel/backups/.db-backup/panel-20260718-030000.db data/panel.db

# 5. 校验文件完整性
sqlite3 data/panel.db "PRAGMA integrity_check;"
# 期望输出：ok

# 6. 重启服务
sudo systemctl start gameserver-panel.service

# 7. 验证服务正常
sudo systemctl status gameserver-panel.service
curl http://localhost:3000/api/health
# 期望输出：{"status":"ok"}
```

### 4.2 实例存档恢复

适用场景：玩家存档损坏 / 回滚到历史版本。

通过 Web 面板的实例详情页 → 备份 Tab：
1. 选择要恢复的备份
2. 点击"恢复"按钮
3. 确认覆盖当前存档
4. 实例会自动重启以加载恢复的存档

**注意**：恢复操作会覆盖当前存档，建议先手动创建一份当前存档备份。

### 4.3 单实例灾难恢复

适用场景：实例目录完全丢失。

```bash
# 1. 找到该实例最近的备份
ls -lh /opt/gameserver-panel/backups/<server_id>/

# 2. 重建实例目录
mkdir -p /opt/gameserver-panel/instances/<server_id>/saves

# 3. 解压备份
tar -xzf /opt/gameserver-panel/backups/<server_id>/<timestamp>.tar.gz \
    -C /opt/gameserver-panel/instances/<server_id>/saves/

# 4. 在 Web 面板重启该实例
```

## 五、验证与监控

### 5.1 检查备份状态

```bash
# 1. 检查 DB 备份目录
ls -lh /opt/gameserver-panel/backups/.db-backup/
# 应看到最近 7 天的备份文件

# 2. 检查实例备份目录
ls -lh /opt/gameserver-panel/backups/
# 应看到每个启用了备份的实例的子目录

# 3. 验证 DB 备份可读
sqlite3 /opt/gameserver-panel/backups/.db-backup/panel-<latest>.db "PRAGMA integrity_check;"
```

### 5.2 日志检查

```bash
# 检查 DB 备份日志
sudo journalctl -u gameserver-panel.service | grep "DB_BACKUP"
# 应看到每日 "DB_BACKUP: 数据库备份完成" 日志

# 检查实例备份日志
sudo journalctl -u gameserver-panel.service | grep "AUTO_BACKUP"
```

### 5.3 磁盘空间监控

v3.9.0-D2 引入磁盘空间监控，每小时检查磁盘使用率：
- 超过 `disk.warning_threshold`（默认 85%）→ 发送警告通知
- 超过 `disk.critical_threshold`（默认 95%）→ 发送严重通知
- 通知通过站内消息推送给所有管理员

## 六、最佳实践

1. **首次部署后立即开启 DB 自动备份**：`/admin/settings` → `backup.db_enabled = true`
2. **生产环境开启实例自动备份**：`backup.auto_enabled = true`（按需评估磁盘占用）
3. **定期验证备份可恢复性**：每月至少执行一次 DB 恢复演练
4. **重大升级前手动备份**：升级 Panel 版本前先手动备份 DB
5. **监控磁盘空间**：开启 `disk.monitor_enabled`，确保备份目录所在分区充足
6. **不要将备份目录与实例目录放同一分区**：避免磁盘故障同时丢失数据与备份

## 七、常见问题

### Q1: DB 备份失败怎么办？

1. 检查 `/admin/settings` 中 `backup.db_enabled` 是否为 `true`
2. 检查 `backup.path` 目录是否存在且可写
3. 检查 Panel 服务日志：`journalctl -u gameserver-panel.service | grep "DB_BACKUP"`
4. 手动执行备份命令验证权限：`cp data/panel.db <backup.path>/.db-backup/test.db`

### Q2: 备份文件占用空间过大怎么办？

1. 降低 `backup.db_retention_days`（如 7 → 3）
2. 降低 `backup.max_count`（如 7 → 3）
3. 将备份目录挂载到独立磁盘
4. 定期清理过期备份（系统会自动清理，但也可手动 `rm` 旧文件）

### Q3: 恢复后数据丢失了怎么办？

1. 检查恢复的备份文件时间戳是否正确
2. 检查 `backup.db_retention_days` 是否过短导致旧备份被清理
3. 如有更早的备份，尝试恢复到更早的时间点
4. 联系运维检查是否有其他数据源（如系统快照、RAID）

### Q4: 实例备份只包含 saves 目录，如何完整恢复？

实例备份设计上只备份存档（saves），不备份：
- 服务端二进制（通过 Pack install_command 重新下载）
- 配置文件（通过 Pack config_files 重新生成）
- Mods（通过 Pack mods 列表重新同步）

完整恢复流程：
1. 在 Web 面板重新创建实例（选择相同 Pack）
2. 等待 install_command 完成
3. 通过备份 Tab 恢复存档
4. 通过配置 Tab 重新配置参数
5. 启动实例
