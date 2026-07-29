---
alwaysApply: false
description: 
---
# 部署硬约束（与 1.md / bb.md 同级生效）

1. 生产环境禁止使用"开发模式"启动服务：禁用 `npm run dev` / `tsx watch` / SSH 终端前台启动作为生产入口。
2. 所有生产服务必须由 systemd 托管，service 文件位于 /etc/systemd/system/gameserver-{daemon,panel}.service，必须 Restart=always + WantedBy=multi-user.target + enable。
3. 唯一部署目录是 /opt/gameserver-panel/（属主 gameserver:gameserver），/home/<user>/.../gameserver-panel/ 只能作为开发副本，不得在生产服务器上启动该目录下的服务。
4. 部署前必须先停掉现有部署的所有进程（`pkill -u <user>` 旧的 dev 进程 + `systemctl stop` 旧的服务），再启动新服务，避免端口冲突。
5. 服务必须能在 SSH 断开、电脑关机、服务器重启后持续可达。任何"依赖开发者会话存活"的设计都不允许。
6. 禁止用本机（开发者个人电脑）做网络转发/代理/隧道把外部请求转到内网服务；外部请求必须由服务器直接处理。
7. 端口配置单一真相源：daemon 端口 = 8080（3.4.x 起统一），panel DAEMON_URL = http://localhost:8080；deploy.sh / panel.env.template / README.md 三处必须保持一致，修改任一处必须同步另外两处。
8. 部署后必须立即执行健康检查：systemctl is-active gameserver-{daemon,panel} = active；curl http://gsp.ecsrz.com:3000/api/health = 200；curl http://192.168.5.23:8080/health = 200；/api/system/health 中 panel-daemon.status = healthy。
9. 部署后必须验证持久化：断开 SSH、关闭本机网络或重启服务器后，gsp.ecsrz.com:3000 仍能正常返回 200。仅"启动成功"不构成闭合判据。
10. 任何停止 / 启动 / 重启服务、修改 systemd 单元文件、修改 .env 中的 JWT_SECRET/DAEMON_TOKEN 的操作，必须在执行前确认是否有在线用户或挂起的请求，避免覆盖已签发的 JWT 导致全员掉登录。
11. 前端 dist 部署路径单一真相源：Panel backend 的 cwd 是 /opt/gameserver-panel/panel/backend/（systemd WorkingDirectory），静态文件通过 `path.resolve(process.cwd(), '../frontend/dist')` 提供。因此前端构建产物必须部署到 /opt/gameserver-panel/panel/frontend/dist/，禁止部署到 /opt/gameserver-panel/dist/（该路径不会被 serve）。部署后必须构造 dist 索引文件进行内容校验：`curl -s http://localhost:3000/assets/index-*.js | grep <关键字符串>` 确认前端确已更新。