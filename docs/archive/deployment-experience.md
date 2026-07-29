# GameServer Panel 部署经验总结

> 适用版本：v3.x（基于 dev.sh / serve.sh / deploy.sh 三个脚本的分工模式）
> 服务器：gsp.ecsrz.com（公网） / 192.168.5.14（内网），同一台机器
> SSH 用户：airxw

## 一、三种启动模式

项目根目录下有**三个职责清晰的启动脚本**，不要混用：

| 脚本 | 模式 | 端口 | 适用场景 |
|------|------|------|---------|
| `dev.sh` | 开发模式 | 5173（Vite HMR）+ 3000（backend）+ 8080（daemon） | 本地改代码、热更新调试 |
| `serve.sh` | 生产模式（开发目录直跑） | 3000（backend 托管 dist）+ 8080（daemon） | 服务器上跑、公网已做端口映射 |
| `deploy.sh` | 全量生产安装 | 3000 + 18432（注意：deploy 改了 daemon 端口，但当前 .env 仍是 8080） | 不建议使用——本项目不依赖此模式 |

**结论**：服务器上用 `serve.sh`，不要再用 `deploy.sh`。

## 二、端口规划

| 端口 | 服务 | 监听地址 | 对公网 |
|------|------|---------|--------|
| 3000 | Panel Backend（Express + 静态托管 `panel/frontend/dist/`） | `0.0.0.0` | ✅ 必须可达 |
| 8080 | Daemon（节点代理，Bearer Token 鉴权） | `0.0.0.0`（**规则禁止公网访问**） | ❌ 仅本机 |
| 5173 | Vite dev server | `0.0.0.0` | ❌ 仅 dev 模式 |

**`8080` 不对公网开放的硬性原因**：daemon 是节点代理，鉴权靠 `DAEMON_TOKEN`，一旦被外网扫到就是 RCE 入口。Panel backend 通过 `DAEMON_URL=http://localhost:8080` 本机调用即可，公网映射到 3000 即可访问全部 UI。

## 三、关键配置

### Panel Backend（`panel/backend/.env`）

```env
PORT=3000
DATABASE_URL=./data/panel.db        # SQLite，零配置
DAEMON_URL=http://localhost:8080    # 本机调 daemon
DAEMON_TOKEN=dev-daemon-token-2026  # 与 daemon/.env 一致
PACKS_DIR=../../packs               # 相对 panel/backend 工作目录
INSTANCES_DIR=./instances
JWT_SECRET=...                      # 生产环境必须替换
LOG_LEVEL=info
```

### Daemon（`daemon/.env`）

```env
PORT=8080
DAEMON_TOKEN=dev-daemon-token-2026  # 必须与 panel 一致
INSTANCES_DIR=./instances
LOG_LEVEL=info
```

**`DAEMON_TOKEN` 必须两端一致**，否则 panel 所有写操作会 401。

## 四、公网访问拓扑

```
[用户浏览器]
    ↓ http://gsp.ecsrz.com:3000
[公网映射/反向代理]（用户已配置好）
    ↓
[服务器 192.168.5.14:3000]
    ↓ Panel Backend (tsx src/index.ts)
    ├─→ 静态托管 panel/frontend/dist/   (React SPA)
    ├─→ /api/* → SQLite (data/panel.db)
    └─→ http://localhost:8080/* → Daemon (Bearer Token)
                                       ↓
                                  游戏进程（instances/）
```

**前端**：`dist/index.html` + assets，由 backend 静态托管。
**后端**：`tsx src/index.ts`，无打包步骤（TypeScript 源码直跑）。
**数据库**：SQLite 文件，路径 `./data/panel.db`，**必须先做迁移再起服务**。

## 五、进程管理

### 目录约定

```
.pids/                  ← 进程 PID 文件
  ├── panel.pid
  └── daemon.pid
logs/                   ← nohup 输出日志
  ├── panel.log
  └── daemon.log
```

### 日常命令

```bash
./serve.sh start      # 启动 daemon + panel，含 30s 健康检查
./serve.sh stop       # 停
./serve.sh restart    # 重启
./serve.sh status     # 看进程是否在
./serve.sh health     # 单独跑健康检查
./serve.sh logs panel # tail -f logs/panel.log
```

### 状态验证

```bash
# 1. 端口监听
ss -tlnp | grep -E ":(3000|8080) "

# 2. 健康检查接口
curl http://localhost:3000/api/health     # → {"status":"ok"}
curl http://localhost:8080/health

# 3. 公网可达
curl -I http://gsp.ecsrz.com:3000/
```

## 六、常见陷阱

### 1. 服务"突然访问不到"——其实是后台进程死了

**症状**：公网能 ping 通服务器，浏览器访问 3000 超时。
**根因**：SSH 终端里前台起的 `npm run dev`，关掉终端进程就没了。`.pids/` 里的 PID 失效但文件残留，`./serve.sh start` 会自动清理。

**正确做法**：用 `./serve.sh start`，nohup + disown，进程脱离终端。

### 2. 改了前端代码但页面没更新

**症状**：dist 没重新 build，浏览器拿到的还是旧 bundle。
**正确做法**：
```bash
cd panel/frontend
npm run build
./serve.sh restart   # 让 backend 重新加载 dist 静态资源（不重启也行，但要清浏览器缓存）
```

### 3. 数据库变更没生效

**症状**：新加的列/表在 API 返回里是 `undefined`。
**根因**：版本更新时没跑迁移。`/home/airxw/.trae-cn/memory` 里有教训——"迁移 guard clause 导致老表缺列"。
**正确做法**：每次改 `panel/backend/src/db/` 下的 migration，部署后必须跑：
```bash
cd panel/backend
npx knex migrate:latest --knexfile src/db/knexfile.ts
```
**也可以加进 `serve.sh start` 里**，自动跑。

### 4. `.env` 不一致导致 401

**症状**：panel 能起来，但调 daemon 的接口全部 401。
**根因**：`panel/backend/.env` 和 `daemon/.env` 里 `DAEMON_TOKEN` 不一致。
**正确做法**：两端必须完全一样（直接复制粘贴）。

### 5. 端口冲突

**症状**：`EADDRINUSE :::3000`。
**根因**：之前的进程没杀干净。`./serve.sh start` 会用 `is_running` 检查，但若 PID 文件丢了，得手动：
```bash
lsof -i :3000   # 找到占用进程
kill <PID>
```

### 6. 公网访问 3000 通了但 8080 也被扫到

**症状**：安全扫描发现 8080 暴露。
**根因**：daemon 默认 `0.0.0.0` 监听。
**正确做法**：不要把 8080 加入公网映射规则；公网防火墙/Nginx 只放行 3000。daemon 必须保持 127.0.0.1 ↔ panel 的内部调用，外部不可达。

## 七、可选升级：systemd 自动拉起

**当前短板**：`serve.sh` 进程不在 systemd 管辖区，**服务器重启或 OOM 后要手动 `./serve.sh start`**。

**轻量升级方案**（不复制到 `/opt`、不建独立用户）：

```ini
# /etc/systemd/system/gameserver-panel.service
[Unit]
Description=GameServer Panel (dev-mode production)
After=network.target

[Service]
Type=simple
User=airxw
WorkingDirectory=/home/airxw/Documents/gsp/gameserver-panel/panel/backend
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/gameserver-daemon.service
[Unit]
Description=GameServer Daemon
After=network.target

[Service]
Type=simple
User=airxw
WorkingDirectory=/home/airxw/Documents/gsp/gameserver-panel/daemon
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

启用：
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gameserver-panel gameserver-daemon
```

**注意**：`./serve.sh` 和 systemd 二选一，不要同时管同一个进程（会冲突）。

## 八、更新流程

代码修改后，公网生效的标准流程：

```bash
# 1. 前端改了 → 重新 build
cd /home/airxw/Documents/gsp/gameserver-panel/panel/frontend && npm run build

# 2. 数据库 schema 改了 → 跑迁移
cd /home/airxw/Documents/gsp/gameserver-panel/panel/backend
npx knex migrate:latest --knexfile src/db/knexfile.ts

# 3. 后端/daemon 代码改了 → 重启进程
cd /home/airxw/Documents/gsp/gameserver-panel
./serve.sh restart

# 4. 验证
./serve.sh health
curl -I http://gsp.ecsrz.com:3000/
```

**版本号更新规则**（来自 `.trae/rules/bb.md`）：
- bug 修复 / 小改动 → 小版本号 +1（前两位重置 0）
- 新增功能 → 中版本号 +1（小版本重置 0）
- 大版本号 → 由用户决定，不主动改

改完版本号必须同步 `version.md`，主目录 `README.md` 在重大功能/结构调整时也要更新。

## 九、备份与回滚

### 数据备份

```bash
# 关键数据
data/panel.db             # SQLite 主库
instances/                # 游戏实例运行数据（每个实例一个子目录）
packs/                    # 服务端包定义（一般是代码，不备份）
panel/backend/.env        # 配置（含 JWT_SECRET、DAEMON_TOKEN）
daemon/.env               # 配置
```

**建议**：每天 cron 备份 `data/panel.db` 到独立目录（不要放在项目内，避免被 `cp` 覆盖）。

### 回滚

`serve.sh` 没有自动备份机制（不像 `deploy.sh update` 会做 `panel.db.bak.<timestamp>`）。**手动回滚步骤**：
1. `cd` 到代码 commit：`git checkout <commit>`
2. 重新 build 前端（如果改过）
3. 回滚数据库：拷贝备份 `cp data/panel.db.bak.<ts> data/panel.db`
4. `./serve.sh restart`

**建议**：把 `deploy.sh update` 里的备份逻辑提取到 `serve.sh` 的 `update` 子命令里。

## 十、检查清单（部署后必跑）

- [ ] `./serve.sh status` 显示 panel + daemon 都运行
- [ ] `curl http://localhost:3000/api/health` 返回 `{"status":"ok"}`
- [ ] `curl http://localhost:8080/health` 返回正常
- [ ] `curl -I http://gsp.ecsrz.com:3000/` 返回 200
- [ ] 浏览器能打开登录页（http://gsp.ecsrz.com:3000/）
- [ ] 用 admin 账号登录成功
- [ ] `ss -tlnp | grep 8080` 确认 8080 仅本机或确认防火墙拦截
- [ ] `logs/` 下没有 ERROR 级别日志
