# 故障 Runbook (v3.9.0-D4)

> 本文档整理 GameServer Panel 常见故障的诊断步骤与处置方案。
> 适用对象：运维人员 / 值班人员。
> 配套工具：`/admin/system-health` 仪表盘 + 一键诊断。

## 一、故障分类速查表

| 故障类型 | 严重程度 | 用户感知 | 优先级 | 对应章节 |
|---------|---------|---------|--------|---------|
| Panel 服务不可用 | Critical | 全站无法访问 | P0 | §2.1 |
| Daemon 服务不可用 | Critical | 无法启动/停止实例 | P0 | §2.2 |
| 数据库损坏 | Critical | 全站报 500 | P0 | §2.3 |
| 实例状态卡死 | High | 实例显示 starting/stopping 不结束 | P1 | §3.1 |
| 僵尸实例 | High | 实例显示 running 但实际无进程 | P1 | §3.2 |
| 磁盘空间告警 | High | 备份失败 / 实例无法启动 | P1 | §4.1 |
| 端口冲突 | Medium | 实例启动失败 | P2 | §3.3 |
| WebSocket 断连 | Medium | 控制台日志不刷新 | P2 | §5.1 |
| 邮件发送失败 | Low | 密码找回 / 邮箱验证收不到邮件 | P3 | §6.1 |

## 二、Critical 故障处置

### 2.1 Panel 服务不可用

**症状**：
- 浏览器访问 `http://192.168.5.14:3000` 无响应或连接拒绝
- `curl http://localhost:3000/api/health` 失败

**诊断步骤**：

```bash
# 1. 检查 systemd 服务状态
sudo systemctl status gameserver-panel.service
# 关注：Active: active (running) / inactive (dead) / failed

# 2. 查看最近日志
sudo journalctl -u gameserver-panel.service -n 100 --no-pager
# 关注：未捕获的异常 / 端口占用 / migration 失败

# 3. 检查端口监听
sudo ss -tlnp | grep :3000
# 应看到 node 进程监听 3000 端口

# 4. 检查磁盘空间
df -h /opt/gameserver-panel
# 磁盘满会导致 SQLite 写入失败

# 5. 检查 DB 文件
ls -lh /opt/gameserver-panel/panel/backend/data/panel.db
sqlite3 /opt/gameserver-panel/panel/backend/data/panel.db "PRAGMA integrity_check;"
```

**处置方案**：

| 故障原因 | 处置 |
|---------|------|
| 服务未启动 | `sudo systemctl start gameserver-panel.service` |
| 端口被占用 | `sudo ss -tlnp \| grep :3000` 找占用进程，`sudo kill <pid>` 后重启 |
| 磁盘满 | 见 §4.1 |
| DB 损坏 | 见 §2.3 |
| migration 失败 | 查看日志中 migration 错误，手动 `npx knex migrate:rollback` 后重试 |
| JWT_SECRET 未配置 | 检查 `.env` 文件，确保 `JWT_SECRET=<32位随机字符串>` |

### 2.2 Daemon 服务不可用

**症状**：
- Panel 可访问但实例操作报 "fetch failed" 或 "无法连接 Daemon"
- 实例启动 / 停止 / 控制台命令全部失败

**诊断步骤**：

```bash
# 1. 检查 Daemon 服务状态
sudo systemctl status gameserver-daemon.service

# 2. 查看 Daemon 日志
sudo journalctl -u gameserver-daemon.service -n 100 --no-pager

# 3. 检查 Daemon 端口
sudo ss -tlnp | grep :8080

# 4. 从 Panel 测试连通性
curl http://localhost:8080/api/health
# 注意：8080 端口对外禁用，仅本机可访问

# 5. 检查 DAEMON_TOKEN 配置
grep DAEMON_TOKEN /opt/gameserver-panel/panel/backend/.env
grep DAEMON_TOKEN /opt/gameserver-panel/daemon/.env
# 两端 TOKEN 必须一致
```

**处置方案**：

| 故障原因 | 处置 |
|---------|------|
| 服务未启动 | `sudo systemctl start gameserver-daemon.service` |
| TOKEN 不一致 | 同步两端 `.env` 中的 `DAEMON_TOKEN` 后重启双方服务 |
| SteamCMD 缺失 | `sudo apt install lib32gcc-s1 lib32stdc++6` + `/opt/steamcmd/steamcmd.sh +quit` 初始化 |
| 32位依赖缺失 | 同上 |
| 实例 PID 失效 | Panel→Daemon WS 重连后会自动重订阅，无需干预 |

### 2.3 数据库损坏

**症状**：
- Panel 日志大量 `SQLITE_CORRUPT` / `database disk image is malformed`
- API 返回 500 + `PANEL_INTERNAL_ERROR`
- `PRAGMA integrity_check` 返回非 `ok`

**处置步骤**：

1. 立即停止 Panel 服务：`sudo systemctl stop gameserver-panel.service`
2. 备份当前损坏的 DB：`cp data/panel.db data/panel.db.corrupt-$(date +%Y%m%d)`
3. 尝试修复：`sqlite3 data/panel.db ".recover" > recovered.sql`
4. 如修复失败，从备份恢复（参考 `docs/backup-recovery.md` §4.1）
5. 重启服务并验证：`curl http://localhost:3000/api/health`

## 三、实例故障处置

### 3.1 实例状态卡死

**症状**：
- 实例显示 `starting` 或 `stopping` 超过 5 分钟
- 实际进程已退出但 DB 状态未更新

**诊断**：

```bash
# 通过 SystemHealth 仪表盘的 diagnostics Tab 查看 "实例状态卡死检测" 结果
# 或手动查询
sqlite3 /opt/gameserver-panel/panel/backend/data/panel.db \
  "SELECT id, name, status, updated_at FROM servers WHERE status IN ('starting', 'stopping') AND updated_at < datetime('now', '-5 minutes');"
```

**处置**：

1. 通过 Web 面板的实例详情页 → 控制台，发送停止命令
2. 如无响应，SSH 到服务器：
   ```bash
   # 找到实例进程
   ps aux | grep <instance_id>
   # 强制结束
   sudo kill -9 <pid>
   ```
3. 在 Web 面板将实例状态手动改为 `stopped`（如有该入口）
4. 或直接改 DB：`UPDATE servers SET status='stopped' WHERE id='<instance_id>';`
5. 重启该实例验证

### 3.2 僵尸实例

**症状**：
- 实例显示 `running` 但控制台无新日志
- 玩家无法连接
- `zombie_instance_check` 诊断规则报错

**诊断**：

```bash
# 查询超过 6 小时未更新的 running 实例
sqlite3 /opt/gameserver-panel/panel/backend/data/panel.db \
  "SELECT id, name, updated_at FROM servers WHERE status='running' AND updated_at < datetime('now', '-6 hours');"

# 检查实例进程是否真实存在
ps aux | grep <server_id>
```

**处置**：

1. 如进程已不存在 → 将 DB 状态改为 `stopped`：`UPDATE servers SET status='stopped' WHERE id='<id>';`
2. 如进程存在但无响应 → 通过 RCON 发送 `/stop` 命令
3. 如 RCON 无响应 → `sudo kill <pid>` 后改 DB 状态
4. 检查 Panel→Daemon WebSocket 是否断连（见 §5.1）

### 3.3 端口冲突

**症状**：
- 实例启动失败，日志显示 `Address already in use`
- `port_conflict_game` 或 `port_conflict_rcon` 诊断规则报错

**诊断**：

```bash
# 查询冲突端口
sqlite3 /opt/gameserver-panel/panel/backend/data/panel.db \
  "SELECT port, COUNT(*) as cnt, GROUP_CONCAT(name) FROM servers WHERE status != 'deleted' GROUP BY port HAVING cnt > 1;"
```

**处置**：

1. 在 Web 面板修改冲突实例的端口配置
2. 或停止其中一个实例
3. 重启实例验证

## 四、资源告警处置

### 4.1 磁盘空间告警

**症状**：
- 收到磁盘告警通知
- `disk_usage_root` 或 `disk_usage_deploy` 诊断规则报错
- 备份失败 / 实例写入失败

**诊断**：

```bash
# 1. 查看各分区使用率
df -h

# 2. 找出大文件
sudo du -h /opt/gameserver-panel --max-depth=2 | sort -rh | head -20

# 3. 检查日志文件大小
sudo journalctl --disk-usage

# 4. 检查备份目录
du -sh /opt/gameserver-panel/backups/*

# 5. 检查实例目录
du -sh /opt/gameserver-panel/instances/*
```

**处置**：

| 占用源 | 处置 |
|--------|------|
| 旧版本池文件 | `/admin/versions` 删除未使用的版本 |
| 旧实例残留 | `/admin/cleanup` 清理已删除实例的残留目录 |
| 旧备份文件 | 降低 `backup.db_retention_days` / `backup.max_count`，或手动清理 |
| 系统日志 | `sudo journalctl --vacuum-time=7d` |
| 实例日志 | 通过实例详情页控制台 Tab 清空历史日志 |

## 五、网络与连接故障

### 5.1 WebSocket 断连

**症状**：
- 控制台日志不刷新
- 实例状态不实时更新
- 浏览器控制台报 WS 连接错误

**诊断**：

```bash
# 1. 检查 Panel→Daemon WS 连接状态
sudo journalctl -u gameserver-panel.service | grep "DaemonEventStream"
# 应看到 "connected" 日志

# 2. 检查 Panel→Frontend WS 连接
# 浏览器开发者工具 → Network → WS 标签
# 应看到 /api/ws 连接处于 101 状态

# 3. 检查 Nginx/反向代理 WS 配置（如使用）
# 必须配置 Upgrade / Connection 头
```

**处置**：

1. 浏览器刷新页面（自动重连）
2. 重启 Panel 服务：`sudo systemctl restart gameserver-panel.service`
3. 检查反向代理 WS 配置

## 六、辅助功能故障

### 6.1 邮件发送失败

**症状**：
- 密码找回 / 邮箱验证邮件未送达
- Panel 日志报 `mailService.sendMail 失败`

**诊断**：

```bash
# 1. 检查邮件设置
sqlite3 /opt/gameserver-panel/panel/backend/data/panel.db \
  "SELECT key, value FROM system_config WHERE key LIKE 'mail.%';"

# 2. 查看 Panel 日志
sudo journalctl -u gameserver-panel.service | grep -i "mail\|smtp"
```

**处置**：

| 故障原因 | 处置 |
|---------|------|
| `mail.enabled = false` | `/admin/settings` 开启邮件发送 |
| SMTP 主机 / 端口错误 | 检查 `mail.smtp_host` / `mail.smtp_port` |
| 认证失败 | 检查 `mail.smtp_user` / `mail.smtp_pass` |
| 发件人地址不匹配 | `mail.from_address` 应与 SMTP 用户名一致或同域名 |
| 邮件被拒收 | 检查发件域名 SPF / DKIM / DMARC 记录 |

### 6.2 维护模式无法关闭

**症状**：
- 全站跳转到 `/maintenance` 页面
- 管理员无法登录关闭维护模式

**诊断**：

```bash
# 检查维护模式状态
sqlite3 /opt/gameserver-panel/panel/backend/data/panel.db \
  "SELECT value FROM system_config WHERE key='maintenance.enabled';"
```

**处置**：

```bash
# 直接改 DB 关闭维护模式
sqlite3 /opt/gameserver-panel/panel/backend/data/panel.db \
  "UPDATE system_config SET value='false' WHERE key='maintenance.enabled';"

# 重启 Panel 服务使设置缓存失效
sudo systemctl restart gameserver-panel.service
```

## 七、应急联系

| 角色 | 职责 | 联系方式 |
|------|------|---------|
| 系统管理员 | 服务器 / 网络 / 数据库 | （由部署方填写） |
| Panel 运维 | 应用层故障 / 配置 | （由部署方填写） |
| 游戏运营 | 实例业务问题 | （由部署方填写） |

## 八、附录

### 8.1 关键路径速查

| 路径 | 说明 |
|------|------|
| `/opt/gameserver-panel/panel/backend/` | Panel 后端部署目录 |
| `/opt/gameserver-panel/panel/backend/data/panel.db` | 主数据库 |
| `/opt/gameserver-panel/panel/backend/.env` | Panel 环境变量 |
| `/opt/gameserver-panel/daemon/` | Daemon 部署目录 |
| `/opt/gameserver-panel/daemon/.env` | Daemon 环境变量 |
| `/opt/gameserver-panel/instances/<server_id>/` | 实例数据目录 |
| `/opt/gameserver-panel/versions/<pack_id>/` | 版本池目录 |
| `/opt/gameserver-panel/backups/` | 备份根目录 |
| `/opt/gameserver-panel/packs/<pack_id>/` | Pack 配置目录 |

### 8.2 常用命令

```bash
# 重启 Panel
sudo systemctl restart gameserver-panel.service

# 重启 Daemon
sudo systemctl restart gameserver-daemon.service

# 查看服务状态
sudo systemctl status gameserver-panel.service gameserver-daemon.service

# 查看实时日志
sudo journalctl -u gameserver-panel.service -f

# 健康检查
curl http://localhost:3000/api/health
curl http://localhost:8080/api/health

# 检查 DB 完整性
sqlite3 /opt/gameserver-panel/panel/backend/data/panel.db "PRAGMA integrity_check;"

# 备份 DB
cp /opt/gameserver-panel/panel/backend/data/panel.db \
   /opt/gameserver-panel/backups/.db-backup/panel-manual-$(date +%Y%m%d-%H%M%S).db
```

### 8.3 版本历史

- v3.9.0-D4: 初始版本（覆盖 Panel/Daemon/DB/实例/磁盘/WS/邮件/维护模式 8 类故障）
