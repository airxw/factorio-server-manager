# Test2 — 内置浏览器核对（s0402 三重闸 Test2）

**执行时间**: 2026-07-30 14:15 CST
**状态**: **当前不可判定**（DEFERRED — 环境不满足，用户裁决跳过并记录未闭合）

## 环境状态

| 项 | 状态 | 说明 |
|----|------|------|
| Vite dev server (localhost:5173) | 已启动 | 前端改动可访问 |
| 生产后端 (127.0.0.1:3002) | 运行中 (v4.36.0) | API 代理目标，但不含本次后端改动 |
| 认证凭据 | 不可用 | dev 数据库空，生产数据库不可读（gameserver 用户所有） |

## 阻断原因

1. **dev 服务器代理到生产后端**：Vite dev server 的 `/api` 代理目标是 `http://127.0.0.1:3002`（生产后端 v4.36.0），不含本次后端改动（bindInstance vip_level=0、迁移脚本、RCON 广播）。仅能验证前端 UI 渲染，无法验证端到端 VIP 强制流程。

2. **认证凭据不可用**：
   - dev 数据库 (`panel/backend/data/panel.db`) 无用户记录
   - 生产数据库 (`/opt/gameserver-panel/data/panel.db`) 属于 `gameserver` 用户，`airxw` 无读取权限
   - `sudo` / `su` 读取生产数据库失败（凭据不匹配）

## 用户裁决

用户选择「跳过 Test2 记录未闭合」——部署到生产后在 https://gsp.ecsrz.com:3001 补做内置浏览器核对。

## 待验证场景（部署后补做）

| 场景 | 验证点 | 预期 |
|------|--------|------|
| GuildDock 首页 | 合并展示"我的绑定"单 section | 不再有独立的"账户级绑定"+"游戏角色绑定"两个 section |
| GuildBind 管理页 | 单向导（无 SegmentedControl） | 默认进入游戏角色绑定向导 |
| ServerDetail | 账户级解绑入口 | 详情页展示 AccountBindingRow |
| bindInstance API | 创建账户绑定后 vip_level=0 | 账户绑定不赋予 VIP |
| verifyBindingByCode | 验证成功后 vip_level=1 + RCON 广播 | 游戏内收到 VIP 欢迎消息 |
| 迁移脚本 | 仅账户绑定记录被 revoked | 无对应 verified player 绑定的账户记录 verify_status='revoked' |

## 重跑入口

```bash
# 部署后在内置浏览器访问
https://gsp.ecsrz.com:3001/guild/servers        # GuildServers
https://gsp.ecsrz.com:3001/guild/bind            # GuildBind
https://gsp.ecsrz.com:3001/admin/servers/:id     # ServerDetail
```

## 结论

Test2 状态: **当前不可判定** — 环境不满足（无认证凭据 + 后端改动未部署），用户裁决跳过并记录未闭合，部署后补做。
