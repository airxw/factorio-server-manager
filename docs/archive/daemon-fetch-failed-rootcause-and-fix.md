# panel-daemon 异常（fetch failed）系统性根因分析与根治方案

> 适用范围：当前线上环境 gsp.ecsrz.com（外网）/ 192.168.5.14（内网）= 同一台服务器
> 关联契约：`public/interface_stub/system-metrics-service.d.ts`、`public/config_template/panel.env.template`
> 关联模块：模块11_系统监控（健康检查）、模块0_全局调度（systemd 生命周期）

---

## 一、当前具体症状

1. 浏览器访问 `http://gsp.ecsrz.com:3000` 的系统健康页（或 `/api/system/health` 端点）显示：
   - `panel-backend`：healthy
   - `panel-database`：healthy
   - `panel-daemon`：**异常 / 4ms / fetch failed**
2. 后端日志（panel/backend）无相关错误（fetch 失败被 catch 静默转换为 `{status: 'unhealthy', message: 'fetch failed'}` 返回，参考 [systemMetricsService.ts#L322-L352](../../modules/%E6%A8%A1%E5%9D%9711_%E7%B3%BB%E7%BB%9F%E7%9B%91%E6%8E%A7/systemMetricsService.ts#L322-L352)）。
3. 关闭个人电脑后，gsp.ecsrz.com:3000 在数秒到数分钟内不可达，SSH 退出后服务随即消失。

## 二、根因分析（按因果链展开）

### 2.1 直接原因：daemon 进程根本不存在

经 SSH 到 192.168.5.14 实测：

```bash
# 远端 192.168.5.14 上 ss -tlnp 实际监听
LISTEN  *:3000  users:(("node",pid=3254327,fd=45))   # ← 只有 panel backend
# 期望的 daemon 端口 8080 / 18432 没有任何进程

# 远端 systemd 服务
Unit gameserver-daemon.service could not be found.
Unit gameserver-panel.service  could not be found.
```

- 健康检查代码以 2000ms 超时去 `fetch(http://localhost:8080/health)`，但 8080 没人监听。
- TCP 立即返回 RST，undici 抛出 `TypeError: fetch failed`（这是 Node.js undici 在 `ECONNREFUSED` 时的固定报错文本）。
- 4ms = 本机 TCP RST 往返耗时，**不是**网络慢、**不是**鉴权失败、**不是**鉴权 token 不一致。

### 2.2 间接原因：服务以"开发模式"在 SSH 会话中启动，未走 systemd 托管

远端 192.168.5.14 上观察到的运行进程（PID 3254304 / 3254327）：

```
airxw  3254304  npm exec tsx src/index.ts          # ← 这是 npm run dev 启动的
airxw  3254327  node .../tsx/loader.mjs src/index.ts
```

- 进程属主是 `airxw`（非 deploy.sh 创建的 `gameserver` 系统用户）。
- 工作目录是 `/home/airxw/Documents/gsp/gameserver-panel/`（非 deploy.sh 的 `/opt/gameserver-panel/`）。
- 没有 `nohup` / `tmux` / `screen` / `disown` 包裹，完全依赖 SSH 终端会话存活。
- 一旦 SSH 断开 → 父进程退出 → 子进程收到 SIGHUP → 全部死掉。

### 2.3 系统性根因：当前没有"独立于开发者会话的服务生命周期"

服务以"开发模式"运行，而开发模式的隐含假设是「开发者始终在线」。当服务需要 7×24 暴露给最终用户时，**不能用开发模式**。

满足以下任一即可视为"开发模式"：
- `npm run dev` / `tsx watch` 启动的进程；
- 通过 SSH 终端前台启动的进程；
- 没有 `Restart=always` 也没有开机自启的进程；
- 工作目录在 `/home/<user>/` 而非 `/opt/<service>/` 的部署。

### 2.4 二级根因：两套部署目录并存 + 端口配置分裂

远端存在两套独立的项目目录，互不感知：

| 位置 | 属主 | 用途 | 状态 |
|------|------|------|------|
| `/opt/gameserver-panel/` | `gameserver:gameserver` | deploy.sh 部署目标 | 文件已就位，但 systemd 服务**未注册**、daemon **未启动** |
| `/home/airxw/Documents/gsp/gameserver-panel/` | `airxw:airxw` | 开发工作区 | 仅 panel backend 在跑，daemon 缺失 |

两套目录的 `.env` 端口都指向 `8080`（panel.backend 的 `DAEMON_URL=http://localhost:8080`，daemon 的 `PORT=8080`），端口本身一致，但 `deploy.sh` 内置默认端口是 `18432`（[deploy.sh#L9](../../deploy.sh#L9)），未来如果重新跑 `deploy.sh install`，会生成 18432 的 .env，**形成新的端口错配**。这是定时炸弹。

### 2.5 三级根因：部署脚本（deploy.sh）的 systemd 安装步骤被跳过

`deploy.sh install` 末尾会执行 `create_systemd_services` → 写入 `/etc/systemd/system/gameserver-{daemon,panel}.service`（[deploy.sh#L215-L260](../../deploy.sh#L215-L260)），但该步骤在历史上未执行过。证据：

- `/etc/systemd/system/gameserver*` 不存在；
- daemon 没有运行；
- 部署目录是 `gameserver` 用户的（说明 `create_user` 跑过），但 systemd 服务没写出来——大概率是 `install` 中途失败被忽略，或后续手工误删。

## 三、根治方案

### 3.1 总体目标

| 约束 | 验收口径 |
|------|---------|
| ① 禁止本机做网络转发/代理 | `gsp.ecsrz.com:3000` 的请求**直接在服务器**被服务处理；本机与服务器之间除 SSH 运维通道外无任何业务流量 |
| ② 关电脑服务不中断 | 关闭个人 PC、断开 SSH → 5 分钟后 `curl http://gsp.ecsrz.com:3000/api/health` 仍返回 200；`curl http://192.168.5.14:8080/health`（仅内网）返回 200 |
| ③ 所有服务由 systemd 托管 | `systemctl status gameserver-{daemon,panel}` 显示 `active (running)`、`enabled`；`Restart=always` 生效 |
| ④ 端口配置单一真相源 | `/opt/gameserver-panel/{panel/backend,daemon}/.env` 之外的 `.env` 全部删除或标记为只读模板，避免误改 |

### 3.2 实施步骤

#### 步骤 A：停掉所有"开发模式"进程

```bash
# 1) 在 192.168.5.14 上杀掉所有由 airxw 启动的 tsx / npm 进程
ssh airxw@192.168.5.14
sudo pkill -u airxw -f "tsx.*src/index.ts"
sudo pkill -u airxw -f "npm exec"
sudo pkill -u airxw -f "node.*tsx"
# 确认
ps -ef | grep -E "tsx|gameserver" | grep -v grep
ss -tlnp | grep -E ':3000|:8080'
# 期望：两个端口都不再监听
```

#### 步骤 B：固化"唯一部署目录"为 /opt/gameserver-panel

```bash
# 在 192.168.5.14 上
sudo chown -R gameserver:gameserver /opt/gameserver-panel
sudo chmod 700 /opt/gameserver-panel/panel/backend/.env /opt/gameserver-panel/daemon/.env

# 把 home 下的开发副本标记为「只读开发沙盒」，禁止再被当作生产服务启动
mv /home/airxw/Documents/gsp/gameserver-panel \
   /home/airxw/Documents/gsp/gameserver-panel.dev-$(date +%Y%m%d)
# 或更激进：
# sudo rm -rf /home/airxw/Documents/gsp/gameserver-panel
```

> 说明：保留开发副本的好处是后续本地编码/调试仍可使用，但必须显式带 `.dev-` 后缀以避免再次误启。

#### 步骤 C：建立端口单一真相源

在 192.168.5.14 上统一 daemon 端口为 8080（保持现状，避免重跑 deploy.sh 切到 18432）：

```bash
# 1) 写 daemon 端口（已有，可跳过）
sudo tee /opt/gameserver-panel/daemon/.env >/dev/null <<'EOF'
PORT=8080
DAEMON_TOKEN=<与 panel 一致>
INSTANCES_DIR=/opt/gameserver-panel/instances
LOG_LEVEL=info
EOF

# 2) 写 panel 端口（已有，可跳过；只需确认）
sudo grep ^DAEMON_URL= /opt/gameserver-panel/panel/backend/.env
# 期望：DAEMON_URL=http://localhost:8080
```

同时把 [deploy.sh#L9](../../deploy.sh#L9) 的默认 `DAEMON_PORT=18432` 改为 `8080`（与现状对齐），并增加注释说明"曾用 18432，3.4.x 起统一为 8080"——后续 deploy.sh update 不会再次改写端口。

#### 步骤 D：注册并启用 systemd 服务

两种走法，二选一：

**走法 D1（推荐）：补跑 deploy.sh install 的最后一段**

```bash
ssh airxw@192.168.5.14
cd /opt/gameserver-panel
# 仅执行 create_systemd_services + set_permissions 段，不重跑 install 全流程
sudo bash -c '
set -e
PANEL_USER=gameserver
INSTALL_DIR=/opt/gameserver-panel

# 写 daemon service
cat > /etc/systemd/system/gameserver-daemon.service <<EOF
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
EnvironmentFile=/opt/gameserver-panel/daemon/.env

[Install]
WantedBy=multi-user.target
EOF

# 写 panel service
cat > /etc/systemd/system/gameserver-panel.service <<EOF
[Unit]
Description=GameServer Panel Backend
After=network.target gameserver-daemon.service
Wants=gameserver-daemon.service

[Service]
Type=simple
User=gameserver
Group=gameserver
WorkingDirectory=/opt/gameserver-panel/panel/backend
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/gameserver-panel/panel/backend/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gameserver-daemon gameserver-panel
'
```

**走法 D2：直接用 deploy.sh（会触发全量 install，包括 npm install + build，约 2-3 分钟）**

```bash
ssh airxw@192.168.5.14
cd /opt/gameserver-panel
sudo bash deploy.sh status          # 预演：当前应报 Unit not found
sudo bash deploy.sh install         # 走完整 install 流程
```

注意：走法 D2 会重新生成 `.env` 中的 `JWT_SECRET` 和 `DAEMON_TOKEN`（覆盖现有值），如果已有用户在使用系统，会把所有已签发 JWT 失效；**走法 D1 不动 .env，更安全**。

#### 步骤 E：启动并验证

```bash
sudo systemctl start gameserver-daemon
sudo systemctl start gameserver-panel
sudo systemctl status gameserver-daemon gameserver-panel
# 期望：两者 active (running)、enabled

# 等 3 秒后健康检查
sleep 3
curl -sf http://localhost:8080/health | jq .
curl -sf http://localhost:3000/api/health | jq .
curl -sf http://localhost:3000/api/system/health | jq '.services[] | select(.name=="panel-daemon")'
# 期望 panel-daemon.status == "healthy"
```

#### 步骤 F：验证"关电脑服务不中断"

```bash
# 在本机执行
ssh airxw@192.168.5.14 'sudo shutdown -r now' 2>&1 || true
# 或更稳妥：直接关闭本机的 SSH 客户端（不杀服务器进程）

# 等待 1 分钟后，在另一台机器/手机上
curl -sf http://gsp.ecsrz.com:3000/api/health
curl -sf http://192.168.5.14:3000/api/health
# 期望两者都返回 200
```

### 3.3 验证方案（自动化）

新增 `tests/deployment/persistence-check.sh`（一次性脚本，不入仓则放 docs/）：

```bash
#!/usr/bin/env bash
# 验证 systemd 托管的服务能在 SSH 断开、机器重启后保持可达
set -e
SERVER=192.168.5.14
SSH_USER=airxw

check() {
  local url=$1 expect_status=$2 label=$3
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" || echo 000)
  if [[ "$code" == "$expect_status" ]]; then
    echo "[OK]   $label: $url → $code"
  else
    echo "[FAIL] $label: $url → $code (expected $expect_status)"
    return 1
  fi
}

# 1) 内网健康检查
check "http://$SERVER:3000/api/health" 200 "panel-backend"
check "http://$SERVER:8080/health"     200 "panel-daemon"

# 2) 外网健康检查
check "http://gsp.ecsrz.com:3000/api/health" 200 "panel-backend (public)"
check "http://gsp.ecsrz.com:8080/health"     200 "panel-daemon (public)"
# 注：daemon 是否对外暴露取决于 8080 防火墙策略；如仅内网可达则跳过本行

# 3) 系统健康页中 daemon 状态
DAEMON_STATUS=$(curl -sf --max-time 5 "http://$SERVER:3000/api/system/health" \
  | jq -r '.services[] | select(.name=="panel-daemon") | .status')
if [[ "$DAEMON_STATUS" == "healthy" ]]; then
  echo "[OK]   panel-daemon in /api/system/health: healthy"
else
  echo "[FAIL] panel-daemon in /api/system/health: $DAEMON_STATUS"
  exit 1
fi
```

执行：

```bash
ssh airxw@192.168.5.14 'bash /opt/gameserver-panel/docs/persistence-check.sh'
```

### 3.4 防退化措施（防止再次出现相同问题）

#### 措施 1：禁止"开发模式"被当作生产入口

在 [panel/backend/src/index.ts](../../panel/backend/src/index.ts) 启动入口增加环境守卫：

```ts
if (process.env.NODE_ENV === 'production' && process.env.SUPERVISED !== 'systemd') {
  // 启动时检查父进程是否为 systemd（PID 1）
  // 或检查 /run/systemd/system 是否存在
  // 若都不满足，拒绝启动
  console.error('[FATAL] production 模式必须由 systemd 启动 (SUPERVISED=systemd)');
  process.exit(1);
}
```

并在 [daemon/src/index.ts](../../daemon/src/index.ts) 加同样的守卫。两边 service 文件都已经设了 `Environment=NODE_ENV=production`，再补 `Environment=SUPERVISED=systemd`。

#### 措施 2：每次 deploy 后强制验证服务存活

修改 [deploy.sh#L300-L312](../../deploy.sh#L300-L312) 的 `start()` 末尾，把 `health_check` 的超时从 30s 收紧到 10s，并增加 daemon 必须 healthy 的硬断言：

```bash
health_check() {
  # ... 现有 30s 循环 ...
  # 新增：daemon 必须 healthy，否则报错退出
  if [[ "$daemon_ok" != "true" ]]; then
    log_error "Daemon 未在 ${max_wait}s 内 healthy，部署失败"
    return 1
  fi
}
```

#### 措施 3：增加"会话孤儿进程"自检脚本

新增 `scripts/check-dev-leak.sh`，定期扫 `airxw` 用户下的 `tsx`/`npm exec`/`node` 进程，命中即报警：

```bash
#!/usr/bin/env bash
# 定期巡检：是否有"开发模式"进程在生产服务器上跑
LEAKS=$(ps -u airxw -o pid,cmd --no-headers | grep -E "tsx|npm exec" | grep -v grep)
if [[ -n "$LEAKS" ]]; then
  echo "[LEAK] 发现 airxw 用户下的开发模式进程："
  echo "$LEAKS"
  # 发送到告警通道（钉钉/webhook），本方案不实现
  exit 1
fi
```

加入 crontab（每天 8/14/20 点各跑一次）：

```cron
0 8,14,20 * * * /opt/gameserver-panel/scripts/check-dev-leak.sh || \
  /usr/bin/curl -X POST "https://alert-webhook.example.com/leak"
```

#### 措施 4：把 .env 模板里 18432 与 8080 的分歧彻底写死

修改 [public/config_template/panel.env.template](../../public/config_template/panel.env.template#L23)：

```diff
- DAEMON_URL=http://localhost:18432
+ # Daemon 端口：3.4.x 起统一为 8080（历史版本 18432 已废弃）
+ DAEMON_URL=http://localhost:8080
```

同步修改 [README.md](../../README.md#L230) 表格中的 `DAEMON_URL` 默认值。

[deploy.sh#L9](../../deploy.sh#L9) 同步：

```diff
- DAEMON_PORT=18432  # 使用不常见端口，避免冲突
+ DAEMON_PORT=8080   # 3.4.x 起统一为 8080（与 panel.env.template 对齐）
```

## 四、相关文件清单

| 文件 | 当前行为 | 调整方向 |
|------|---------|---------|
| [deploy.sh](../../deploy.sh) | 默认端口 18432，未被完整跑过 | 改默认 8080；start() 增加 daemon 硬断言 |
| [public/config_template/panel.env.template](../../public/config_template/panel.env.template) | 模板写 18432 | 改 8080 + 历史说明 |
| [README.md](../../README.md) | DAEMON_URL 表格写 18432 | 改 8080 |
| [panel/backend/src/index.ts](../../panel/backend/src/index.ts) | 无启动守卫 | 加 SUPERVISED=systemd 守卫 |
| [daemon/src/index.ts](../../daemon/src/index.ts) | 无启动守卫 | 加 SUPERVISED=systemd 守卫 |
| [modules/模块11_系统监控/systemMetricsService.ts](../../modules/%E6%A8%A1%E5%9D%9711_%E7%B3%BB%E7%BB%9F%E7%9B%91%E6%8E%A7/systemMetricsService.ts) | 把 fetch 错误原样写 message（"fetch failed"） | 优化 message：补充 ECONNREFUSED / EHOSTUNREACH 分类信息 |
| 远端 `/opt/gameserver-panel/` | 部署目标存在但 systemd 未注册 | 走步骤 D 注册服务 |
| 远端 `/home/airxw/Documents/gsp/gameserver-panel/` | 开发副本在生产服务器上被误用 | 重命名为 `.dev-<date>` 或删除 |

## 五、推荐落地顺序

1. **先执行步骤 A + C**（停 dev 进程、固化端口）—— 立即止血，杜绝 SSH 一断就挂
2. **再执行步骤 D1**（手工写两个 service 文件）—— 让 systemd 接管生命周期
3. **执行步骤 E**（start + 健康检查）—— 立即可观察修复效果
4. **执行步骤 F**（重启服务器验证）—— 验证 systemd 自启生效
5. **补全步骤 3.4 的防退化措施** —— 防止未来再次踩坑
6. **最后执行步骤 3.3 的 persistence-check.sh** —— 形成可重复验证的回归用例

完成第 4 步后，"fetch failed" 应当自然消失。
