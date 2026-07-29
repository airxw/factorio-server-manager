# GameServer Panel 真正生产环境部署方案

> 适用版本：v3.x
> 与 [deployment-experience.md](./deployment-experience.md) 互补：
> - 那篇描述**当前**"开发目录直跑 + 公网映射"的轻量模式
> - 本篇描述**真正生产环境**应该是什么样、差异在哪、一键拉起步骤

## 一、当前模式 vs 生产模式 核心差异

| 维度 | 当前（开发目录直跑） | 真正生产 | 差异原因 |
|------|---------------------|----------|---------|
| 进程托管 | nohup + `.pids/` | systemd unit | 服务器重启/OOM 后自动拉起，无需人工 |
| 目录 | `/home/airxw/Documents/gsp/...` | `/opt/gameserver-panel` | 跟开发目录隔离，避免 `git pull` 误覆盖运行时 |
| 用户 | `airxw`（个人） | 独立 `gameserver` 系统用户 | 最小权限原则，进程被攻破不会拿到开发者 shell |
| 端口 | 3000 / 8080 全 `0.0.0.0` | 3000 由 Nginx 反代到 443；daemon 绑 `127.0.0.1` | 8080 永不对公网；HTTPS 终止在反代 |
| 鉴权 token | `.env` 写死 `dev-daemon-token-2026` | 启动时 `openssl rand -hex 32` 生成，写入 600 权限文件 | 防 token 泄漏后被批量爆破 |
| JWT_SECRET | `dev-jwt-secret-2026-...` | 启动时随机生成，**首次部署后必须备份** | 旧 token 全部失效是预期行为，丢失意味着所有用户重登 |
| 数据库 | SQLite 单文件 `./data/panel.db` | 同 SQLite，但**每日定时备份到独立目录** | 单点故障，无 PITR 能力 |
| 前端构建 | `panel/frontend/dist/` 在源码目录 | 同样在 `/opt/...`，但 `.gitignore` 隔离 | `git pull` 不会触发覆盖 |
| 依赖 | `node_modules` 跟开发共享 | 独立 `npm ci --production` 安装 | 防 devDependencies 进生产 |
| 日志 | `logs/*.log` 无限增长 | `journalctl` 接管 + `logrotate` 兜底 | 磁盘不被日志撑爆 |
| 监控 | 无 | `curl /api/health` 接入外部监控；`daemon` 进程存活探测 | 故障发现从"用户报修"变成"自动告警" |
| 升级 | 手动 4 步 | 一条 `update` 命令，含备份→停服→更新→迁移→回滚全流程 | 出错自动回滚到上一版本 |
| 防火墙 | 用户做公网映射 | UFW / iptables：只放行 80/443/22；8080 仅 127.0.0.1 | daemon 永不被外网扫到 |
| 配置 | `.env` 散落两处 | 集中在 `/etc/gameserver-panel/` 单一目录 | 配置管理可审计 |
| TLS | 裸 HTTP 3000 | Nginx 终止 TLS，后端仍 HTTP（仅本机） | 防 token / cookie 明文传输 |

## 二、生产模式关键差异详解

### 2.1 进程托管：systemd

```ini
# /etc/systemd/system/gameserver-daemon.service
[Unit]
Description=GameServer Panel Daemon
After=network.target

[Service]
Type=simple
User=gameserver
Group=gameserver
WorkingDirectory=/opt/gameserver-panel/daemon
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/gameserver-panel/data /opt/gameserver-panel/instances /opt/gameserver-panel/logs

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/gameserver-panel.service
[Unit]
Description=GameServer Panel Backend
After=network.target gameserver-daemon.service

[Service]
Type=simple
User=gameserver
Group=gameserver
WorkingDirectory=/opt/gameserver-panel/panel/backend
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/gameserver-panel/data /opt/gameserver-panel/instances /opt/gameserver-panel/logs

[Install]
WantedBy=multi-user.target
```

**关键保护**：
- `NoNewPrivileges`：禁止 setuid 提权
- `ProtectSystem=strict`：进程只能写白名单目录
- `ProtectHome=true`：完全看不到 `/home`
- `Restart=always` + `RestartSec=5`：崩了 5 秒后自动重启

### 2.2 daemon 绑定 127.0.0.1

在 `daemon/src/index.ts` 或 daemon 的 `.env` 中加：

```env
BIND_ADDRESS=127.0.0.1
```

让 daemon 只监听 loopback。即使公网防火墙漏配，也不会被外网访问到。

### 2.3 HTTPS 反代：Nginx

```nginx
# /etc/nginx/sites-available/gameserver-panel
server {
    listen 80;
    server_name gsp.ecsrz.com;

    # Let's Encrypt 自动证书（certbot --nginx -d gsp.ecsrz.com）
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（panel 的实时通知用）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**优势**：
- 公网 80/443 是唯一入口，所有 8080 风险被屏蔽
- Let's Encrypt 证书自动续期
- WebSocket 透传保留实时通知能力

### 2.4 配置生成：首次部署强制重置 token

**绝对不能**用 `.env` 里的 `dev-daemon-token-2026` 进生产。

**首次部署时必须**：
```bash
JWT_SECRET=$(openssl rand -hex 32)
DAEMON_TOKEN=$(openssl rand -hex 32)
```

写入 `/etc/gameserver-panel/panel.env` 和 `/etc/gameserver-panel/daemon.env`，权限 600，属主 `gameserver:gameserver`。

**Systemd unit 引用配置**（用 `EnvironmentFile=`）：
```ini
[Service]
EnvironmentFile=/etc/gameserver-panel/panel.env
```

### 2.5 数据库备份

```bash
# /etc/cron.daily/gameserver-panel-backup
#!/bin/bash
set -e
BACKUP_DIR=/var/backups/gameserver-panel
mkdir -p "$BACKUP_DIR"
sqlite3 /opt/gameserver-panel/data/panel.db ".backup '$BACKUP_DIR/panel-$(date +%Y%m%d).db'"
# 保留 30 天
find "$BACKUP_DIR" -name "panel-*.db" -mtime +30 -delete
```

**注意**：SQLite 用 `.backup` 命令（不是 `cp`），能保证一致性。

### 2.6 防火墙规则

```bash
# UFW 示例
sudo ufw default deny incoming
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80/tcp        # HTTP（certbot + 重定向到 443）
sudo ufw allow 443/tcp       # HTTPS
sudo ufw enable

# 8080 不出现在 allow 列表中，daemon 自然只走 127.0.0.1
```

### 2.7 外部健康监控

`/api/health` 已有（无需鉴权），但**生产必须接入外部**：

- **方案 A**：UptimeRobot / 阿里云云监控 定时 GET `https://gsp.ecsrz.com/api/health`
- **方案 B**：自建 `cron` + `curl`，失败发邮件/钉钉
- **方案 C**：systemd timer 跑外部 watchdog，挂了发 webhook

**Daemon 健康检查**（更难，因为不暴露公网）：
- 由 panel backend 定时调 `http://127.0.0.1:8080/health` 写状态到 `daemon_status` 表
- 外部监控只检查 panel，panel 健康但 daemon 异常时由 panel 自己告警

## 三、快速拉起步骤

### 3.1 一次性部署（首次）

```bash
# 0. 前置：SSH 登录到服务器
ssh airxw@192.168.5.14

# 1. 安装系统依赖
sudo apt update
sudo apt install -y curl wget git unzip sqlite3 nginx certbot python3-certbot-nginx

# 2. 安装 Node.js 20（项目要求 >=18）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. 创建独立系统用户
sudo useradd -r -s /usr/sbin/nologin -d /opt/gameserver-panel gameserver
sudo mkdir -p /opt/gameserver-panel
sudo chown gameserver:gameserver /opt/gameserver-panel

# 4. 复制项目代码到 /opt
#    （本项目推荐 rsync，排除 node_modules 和 dist）
sudo rsync -av --exclude=node_modules --exclude=dist --exclude=.pids --exclude=logs \
    /home/airxw/Documents/gsp/gameserver-panel/ \
    /opt/gameserver-panel/

# 5. 安装生产依赖
cd /opt/gameserver-panel
sudo -u gameserver npm install --production
cd panel/backend && sudo -u gameserver npm install --production && cd ../..
cd daemon && sudo -u gameserver npm install --production && cd ..

# 6. 构建前端
cd panel/frontend
sudo -u gameserver npm install
sudo -u gameserver npm run build
cd ../..

# 7. 生成配置（含强随机 token）
sudo mkdir -p /etc/gameserver-panel
JWT_SECRET=$(openssl rand -hex 32)
DAEMON_TOKEN=$(openssl rand -hex 32)

sudo tee /etc/gameserver-panel/panel.env > /dev/null <<EOF
PORT=3000
BIND_ADDRESS=127.0.0.1
DATABASE_URL=/opt/gameserver-panel/data/panel.db
JWT_SECRET=$JWT_SECRET
DAEMON_URL=http://127.0.0.1:8080
DAEMON_TOKEN=$DAEMON_TOKEN
PACKS_DIR=/opt/gameserver-panel/packs
INSTANCES_DIR=/opt/gameserver-panel/instances
LOG_LEVEL=info
EOF

sudo tee /etc/gameserver-panel/daemon.env > /dev/null <<EOF
PORT=8080
BIND_ADDRESS=127.0.0.1
DAEMON_TOKEN=$DAEMON_TOKEN
INSTANCES_DIR=/opt/gameserver-panel/instances
LOG_LEVEL=info
EOF

sudo chmod 600 /etc/gameserver-panel/*.env
sudo chown -R gameserver:gameserver /etc/gameserver-panel

# 8. 写入 systemd unit（见 §2.1）
sudo tee /etc/systemd/system/gameserver-daemon.service > /dev/null <<'EOF'
...（贴 §2.1 完整内容）...
EOF
sudo tee /etc/systemd/system/gameserver-panel.service > /dev/null <<'EOF'
...（贴 §2.1 完整内容）...
EOF

# 9. 初始化数据目录 + 跑迁移
sudo -u gameserver mkdir -p /opt/gameserver-panel/{data,instances,logs}
cd /opt/gameserver-panel/panel/backend
sudo -u gameserver npx knex migrate:latest --knexfile src/db/knexfile.ts
cd /opt/gameserver-panel

# 10. 配置 Nginx + TLS（见 §2.3）
sudo tee /etc/nginx/sites-available/gameserver-panel > /dev/null <<'EOF'
...（贴 §2.3 完整内容）...
EOF
sudo ln -sf /etc/nginx/sites-available/gameserver-panel /etc/nginx/sites-enabled/
sudo nginx -t
sudo certbot --nginx -d gsp.ecsrz.com

# 11. 启动服务
sudo systemctl daemon-reload
sudo systemctl enable --now gameserver-daemon gameserver-panel nginx

# 12. 防火墙（见 §2.6）
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 13. 验证
sleep 3
curl -sf http://127.0.0.1:8080/health
curl -sf http://127.0.0.1:3000/api/health
curl -sf https://gsp.ecsrz.com/api/health
```

**预计步骤数**：13 步，~10 分钟。后续日常运维只需 1 条命令（见 §3.2）。

### 3.2 日常运维（一键脚本）

把以下脚本保存为 `/opt/gameserver-panel/bin/manage`（生产目录下的运维入口，跟 `serve.sh` 类似的思路但更严格）：

```bash
#!/bin/bash
# /opt/gameserver-panel/bin/manage
# 用法: manage {start|stop|restart|status|update|backup|logs}

set -e
INSTALL_DIR=/opt/gameserver-panel
BACKUP_DIR=/var/backups/gameserver-panel
LOG=/var/log/gameserver-panel-manage.log

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

start()   { sudo systemctl start gameserver-daemon gameserver-panel; }
stop()    { sudo systemctl stop gameserver-panel gameserver-daemon; }
restart() { sudo systemctl restart gameserver-daemon gameserver-panel; }
status()  { sudo systemctl status gameserver-daemon gameserver-panel --no-pager; }

backup() {
    mkdir -p "$BACKUP_DIR"
    sudo -u gameserver sqlite3 "$INSTALL_DIR/data/panel.db" \
        ".backup '$BACKUP_DIR/panel-$(date +%Y%m%d-%H%M%S).db'"
    log "备份完成: $BACKUP_DIR"
    find "$BACKUP_DIR" -name "panel-*.db" -mtime +30 -delete
}

update() {
    log "===== 更新开始 ====="
    backup
    sudo systemctl stop gameserver-panel gameserver-daemon

    # 同步代码（假设 git 仓库在 /opt/gameserver-panel）
    cd "$INSTALL_DIR"
    sudo -u gameserver git pull

    # 安装依赖
    sudo -u gameserver npm install --production
    cd panel/backend && sudo -u gameserver npm install --production && cd ../..
    cd daemon && sudo -u gameserver npm install --production && cd ..

    # 构建前端
    cd panel/frontend
    sudo -u gameserver npm install
    sudo -u gameserver npm run build
    cd ../..

    # 跑迁移
    cd panel/backend
    sudo -u gameserver npx knex migrate:latest --knexfile src/db/knexfile.ts
    cd ../..

    # 启动 + 健康检查
    sudo systemctl start gameserver-daemon
    sleep 2
    sudo systemctl start gameserver-panel
    sleep 5
    if curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
        log "更新成功"
    else
        log "更新失败，回滚中..."
        # 简单回滚：git checkout HEAD~1，重 build，重启
        sudo -u gameserver git checkout HEAD~1
        cd panel/frontend && sudo -u gameserver npm run build
        sudo systemctl restart gameserver-daemon gameserver-panel
        log "已回滚到上一版本"
    fi
}

logs() {
    sudo journalctl -u gameserver-panel -u gameserver-daemon -f "$@"
}

case "$1" in
    start|stop|restart|status|backup|update|logs) "$1" "${@:2}" ;;
    *) echo "用法: $0 {start|stop|restart|status|backup|update|logs}" ;;
esac
```

```bash
sudo chmod +x /opt/gameserver-panel/bin/manage

# 日常使用
manage status               # 看进程
manage logs --since today   # 看今天日志
manage backup               # 手动备份
manage update               # 升级（自动备份+自动回滚）
```

### 3.3 故障恢复（应急）

```bash
# 服务挂了
sudo systemctl restart gameserver-daemon gameserver-panel
manage status
manage logs --since "5 min ago"

# 数据库坏了
ls -lt /var/backups/gameserver-panel/ | head -3
# 选最近一个有效的备份
sudo systemctl stop gameserver-panel gameserver-daemon
sudo -u gameserver cp /var/backups/gameserver-panel/panel-20260717-120000.db \
                     /opt/gameserver-panel/data/panel.db
sudo systemctl start gameserver-daemon gameserver-panel

# 磁盘满了
sudo journalctl --vacuum-time=7d           # 清理 7 天前 journal
sudo find /opt/gameserver-panel/logs -mtime +30 -delete
df -h /opt /var                            # 确认释放
```

## 四、验收清单

部署完成后逐项确认：

- [ ] `systemctl status gameserver-panel gameserver-daemon` → `active (running)`
- [ ] `curl http://127.0.0.1:3000/api/health` → `{"status":"ok"}`
- [ ] `curl http://127.0.0.1:8080/health` → 200
- [ ] `curl https://gsp.ecsrz.com/api/health` → `{"status":"ok"}`（TLS 生效）
- [ ] `curl http://gsp.ecsrz.com:8080/health` → **超时/拒绝**（daemon 不应从域名访问）
- [ ] `ss -tlnp | grep 8080` → 看到 `127.0.0.1:8080`（不是 `0.0.0.0`）
- [ ] `ufw status` → 22/80/443 allowed，其他 deny
- [ ] `ls -la /etc/gameserver-panel/*.env` → `-rw------- gameserver gameserver`（权限 600）
- [ ] `cat /etc/gameserver-panel/panel.env | grep JWT_SECRET` → 64 字符 hex（不是 dev 值）
- [ ] `ls /var/backups/gameserver-panel/` → 至少一个备份
- [ ] 外部监控（UptimeRobot 等）已配置探测 `/api/health`
- [ ] `journalctl -u gameserver-panel --since today` → 无 ERROR 级别日志
- [ ] 浏览器打开 `https://gsp.ecsrz.com` → 证书锁为绿色（HTTPS 生效）

## 五、迁移路径（从当前到生产）

**不要一次性切**。建议三阶段：

### 阶段 1：补齐进程托管（最小改动）
- 写 systemd unit，`WorkingDirectory=/home/airxw/Documents/gsp/gameserver-panel/...`
- 启用：`systemctl enable --now gameserver-panel gameserver-daemon`
- 验证：服务器重启后服务自动起来
- **不动**：目录位置、token、端口、HTTPS

### 阶段 2：迁移到 `/opt/gameserver-panel`（目录解耦）
- `rsync` 复制（exclude node_modules/dist）
- 改 systemd `WorkingDirectory`
- 重新 build + 迁移
- 切换：先停旧服务（开发目录），再起新服务（/opt）
- **不动**：HTTPS、token（仍用 dev 值，但准备替换）

### 阶段 3：安全加固（生产级）
- 生成强随机 `JWT_SECRET` / `DAEMON_TOKEN`，写入 `/etc/gameserver-panel/`
- daemon 绑 `127.0.0.1`
- Nginx 反代 + Let's Encrypt
- 防火墙规则
- 外部监控接入
- 数据库每日备份 cron

**预计**：阶段 1 当天可完成，阶段 2 半天，阶段 3 一天。

## 六、回滚方案

生产模式下回滚必须能 5 分钟内完成：

```bash
# 1. 停服务
sudo systemctl stop gameserver-panel gameserver-daemon

# 2. 恢复代码（git 仓库在 /opt）
cd /opt/gameserver-panel
sudo -u gameserver git checkout <上一个稳定版 tag>

# 3. 重 build + 重装依赖
cd panel/frontend && sudo -u gameserver npm run build
cd ../backend && sudo -u gameserver npm install --production && cd ../..
cd daemon && sudo -u gameserver npm install --production && cd ..

# 4. 回滚数据库（如果迁移有破坏性变更）
sudo -u gameserver cp /var/backups/gameserver-panel/panel-<时间戳>.db \
                     data/panel.db

# 5. 启动
sudo systemctl start gameserver-daemon
sleep 2
sudo systemctl start gameserver-panel
curl http://127.0.0.1:3000/api/health
```

**前提条件**：
- 代码仓库是 git（不是 rsync 拉文件）
- 数据库每日备份有保留
- 上一版本 tag 已打（建议每次 `update` 成功后 `git tag v<version>`）

## 七、当前模式 → 生产模式决策点

不是所有项目都需要一步到位。建议按以下规则判断：

| 触发条件 | 应升级到的阶段 |
|---------|--------------|
| 服务器 1 周内重启过 1 次以上 | 阶段 1（systemd 托管） |
| 有非开发者用户使用 | 阶段 2（/opt 解耦） |
| 暴露过公网 1 个月以上 | 阶段 3（安全加固） |
| 出现 1 次安全事件或数据丢失 | 全部三个阶段立即执行 |
