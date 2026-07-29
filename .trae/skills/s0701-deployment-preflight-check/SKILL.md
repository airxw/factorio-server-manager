---
name: "s0701-deployment-preflight-check"
description: "Pre-deploy automated checks: port consistency, existing deploy stopped, dist path, systemd file, SSH-disconnect persistence. Invoke before production deploy or deploy.sh modifications."
---

# s0701 部署前置自检

> 本 Skill 由 gsp 项目规范的实际部署教训沉淀而来，把 deploy.md 的硬约束产品化为可执行检查清单。

## 一、何时调用

- **强制触发**：任何生产部署前（执行 deploy.sh、rsync 到 /opt/、systemctl restart gameserver-*）
- **强制触发**：修改 deploy.sh / panel.env.template / .env / nginx 配置后
- **强制触发**：版本号升级后首次部署
- **建议触发**：本地开发 → 远端同步前

## 二、检查清单（7 项硬性闸门）

### 闸门 1：端口配置单一真相源

**经验源**：端口分裂定时炸弹——deploy.sh 默认 DAEMON_PORT=18432，但 .env 实际 PORT=8080，模板也写 18432，导致 daemon 启动在错误端口。

**检查项**：
- [ ] `deploy.sh` 中 `DAEMON_PORT` / `PANEL_PORT` / `HTTPS_PORT` 与 `.env` 中 `PORT` 完全一致
- [ ] `panel.env.template` 与实际 `.env` 端口一致
- [ ] `README.md` 中描述的端口与上述一致
- [ ] nginx 监听端口（3000 HTTP / 3001 HTTPS）与 Panel 后端端口（3002）分离

**当前正确状态**（v4.11.0+）：
- nginx: 0.0.0.0:3000 (HTTP, 301 跳转) / 0.0.0.0:3001 (HTTPS)
- Panel backend: 127.0.0.1:3002 (HTTP, 内部)
- Daemon: 8080

**执行命令**：
```bash
grep -E "DAEMON_PORT|PANEL_PORT|HTTPS_PORT" deploy.sh
grep -E "^PORT=" panel/backend/.env daemon/.env
grep -E "port.*3000|port.*3001|port.*3002" README.md
```

### 闸门 2：现有部署已停止

**经验源**：部署时未关闭现有部署，导致端口占用、文件锁、systemd 重启失败。

**检查项**：
- [ ] `systemctl stop gameserver-panel gameserver-daemon` 已执行
- [ ] 端口 3002 / 8080 无监听（`ss -tlnp | grep -E '3002|8080'` 应为空）
- [ ] nginx 仍运行（不重启 nginx，只重启 Panel/Daemon）
- [ ] 无残留 node 进程（`pgrep -f "panel/backend|daemon/src"`）

### 闸门 3：dist 部署目标路径正确性

**经验源**：dist 部署路径陷阱——Panel backend 的 cwd 是 `/opt/gameserver-panel/panel/backend/`，通过 `path.resolve(process.cwd(), '../frontend/dist')` 提供静态文件。部署到 `/opt/gameserver-panel/dist/` 是无效的。

**检查项**：
- [ ] 前端构建产物部署到 `/opt/gameserver-panel/panel/frontend/dist/`
- [ ] **不是** `/opt/gameserver-panel/dist/`（此路径无效）
- [ ] rsync 命令目标路径含 `panel/frontend/dist/` 完整子路径

**执行命令**：
```bash
ls -la /opt/gameserver-panel/panel/frontend/dist/index.html
# 若不存在，部署失败
```

### 闸门 4：systemd service 文件存在性

**经验源**：/opt/ 存在不代表服务在跑——deploy.sh create_user 跑过（属主是 gameserver）但 create_systemd_services 未跑（无 /etc/systemd/system/gameserver-*.service），daemon 自然没启动。

**检查项**：
- [ ] `/etc/systemd/system/gameserver-panel.service` 存在
- [ ] `/etc/systemd/system/gameserver-daemon.service` 存在
- [ ] `systemctl daemon-reload` 已执行（若 service 文件刚创建/修改）
- [ ] `systemctl enable gameserver-panel gameserver-daemon` 已执行

**执行命令**：
```bash
ls /etc/systemd/system/gameserver-*.service
systemctl is-enabled gameserver-panel gameserver-daemon
```

### 闸门 5：SSH 断开后持续可达性

**经验源**：服务的"开发模式"（npm run dev / tsx watch / SSH 终端前台启动）= 服务跟随 SSH 会话存活，SSH 断/电脑关/终端关 → 进程 SIGHUP → 全挂。生产环境绝对不能用开发模式。

**检查项**：
- [ ] Panel/Daemon 通过 systemd 启动（非 npm run dev / tsx watch）
- [ ] service 文件含 `Restart=always` + `WantedBy=multi-user.target`
- [ ] 服务 user 为 `gameserver`（非 root / airxw）
- [ ] 工作目录为 `/opt/gameserver-panel/`（非 /home/airxw/ 开发副本）

**验证方法**：部署后断开 SSH，等 30 秒重连，`systemctl status` 应仍 active。

### 闸门 6：远端目录分离

**经验源**：远端同时存在两套目录——/opt/gameserver-panel/（gameserver 属主，部署目标）与 /home/airxw/Documents/gsp/gameserver-panel/（airxw 属主，开发副本），生产只能跑前者。

**检查项**：
- [ ] systemd service 的 `WorkingDirectory` 指向 `/opt/gameserver-panel/panel/backend` 或 `/opt/gameserver-panel/daemon`
- [ ] **不是** `/home/airxw/Documents/gsp/gameserver-panel/`
- [ ] rsync 目标为 `/opt/gameserver-panel/`

### 闸门 7：健康检查通过

**检查项**：
- [ ] `curl http://localhost:3002/api/health` 返回 200（Panel 内部端口，仅本机）
- [ ] `curl -k https://localhost:3001/api/health` 返回 200（HTTPS 入口）
- [ ] `curl http://localhost:3000/api/health` 返回 301（HTTP 跳转）
- [ ] Daemon WS 连接：Panel 日志含 `daemon connected`

**禁止**：健康检查不得耗时生成内容（仅轻量连通性）。

## 三、执行流程

```python
def run_preflight():
    gates = [
        ("闸门1 端口单一真相源", check_port_consistency),
        ("闸门2 现有部署已停止", check_existing_stopped),
        ("闸门3 dist 目标路径", check_dist_path),
        ("闸门4 systemd 文件存在", check_systemd_files),
        ("闸门5 SSH 断开持久化", check_systemd_persistence),
        ("闸门6 远端目录分离", check_dir_separation),
        ("闸门7 健康检查", check_health),
    ]
    results = []
    for name, check in gates:
        passed, evidence = check()
        results.append((name, passed, evidence))
        if not passed:
            return results, "BLOCKED"
    return results, "PASS"
```

## 四、阻断处理

任一闸门失败：
1. 立即停止部署流程
2. 输出失败闸门 + 证据 + 修复建议
3. 通过 L3 信号（AskUserQuestion）向人类报告，等待裁决

## 五、与现有规则的关系

- 补强 `deploy.md`（部署硬约束，无可执行检查）
- 与 `rules-0 §四-13`（运行时接入判据）联动——部署前验证服务确实接入运行时
- 与 `rules-6`（变更追踪闸门）联动——部署前验证文档完整性

## 六、降级路径

若本 Skill 检查项无法自动执行（如远端 SSH 不可达）：
1. L1：本机可执行项自动跑，远端项输出手动检查清单
2. L2：通过 L2 信号（NotifyUser）告知人类"远端检查项需手动执行"，附完整清单
3. L3：记录"部署前置自检降级"到 `.trae/documents/`，下次部署前重试

不得伪装所有闸门已通过。
