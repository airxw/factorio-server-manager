---
type: plan
title: 首页质感升级 — 从模板站到产品站
date: 2026-07-26
status: in_progress
related: homepage-visual-upgrade-plan
tags: [homepage, premium, typography, icons, seo]
---

# 首页质感升级方案

## 诊断

访问 `https://gsp.ecsrz.com:3001/` 未登录首页不够高大上，四类问题如下：

### A. emoji 做图标 — 质感第一杀手

| 位置 | 文件:行 | emoji |
|------|---------|-------|
| Logo | `LandingV6.tsx#L16` | 🎮 |
| 功能卡片 | `LandingV6.tsx#L288-L293` | ⚙️💎🎫💬🗳📊 |
| 游戏网格 | `LandingV6.tsx#L310-L321` | ⛏🌲🧟🦖🔫🌍🔥⚙️🌳🏰🏭 |

emoji 由系统字体渲染，跨平台字形不一致、彩色饱和度失控。项目已装 `lucide-react` v1.24.0 完全未用。

### B. 中文排版被西文参数硬套

- `--font` (CSS L19) 没引用已加载的 Inter 变体，中文全落到系统默认
- Hero 标题 `font-weight:900` (CSS L67) — 中文字体无 900 字重，浏览器合成假粗体导致糊边
- `letter-spacing:-0.05em` — 负字距挤压方块字，笔画粘连
- `font-size:7.5rem` — 在 1440px 屏上撑成三行 120px 大字，比例失控

### C. 内容可信度崩塌

- 假域名 `panel.gsp.ecsrz.com` (L62) 和 `play.gsp.ecsrz.com`
- 假流水 ¥328、"0 代码接入" 是 96px 渐变巨字
- section 编号从 `02` 开始，缺 `01`
- AGPL 开源项目编了"企业版/联系商务"定价

### D. CSS 全局泄漏

- `.hero h1` / `.hero-fade` / `.vcursor` / `.nav` 等约 15 条规则未加 `.landing-v6` 作用域
- 全部 media query 内的选择器也缺作用域

### E. SEO 白板

`index.html` title="GameServer Panel"，无 description、无 favicon、无 OG 标签。

---

## 执行事项

### 1. emoji → lucide-react 图标（LandingV6.tsx）

每个 emoji 替换为对应 lucide 组件：

| emoji | lucide 组件 | 用途 |
|-------|------------|------|
| 🎮 → Gamepad2 | logo 图标 |
| ⚙️ → Settings | 一键部署 |
| 💎 → Gem | VIP/商城 |
| 🎫 → Ticket | CDK |
| 💬 → MessageSquare | 聊天触发 |
| 🗳 → Vote | 投票踢人 |
| 📊 → BarChart3 | 数据看板 |
| ⛏ → Pickaxe | Minecraft |
| 🌲 → Trees | Valheim |
| 🧟 → Skull | P Zomboid |
| 🦖 → Swords | ARK |
| 🔫 → Crosshair | Rust |
| 🌍 → Globe | Palworld |
| 🔥 → Flame | DST |
| ⚙️ → Cog | Factorio |
| 🌳 → TreePine | Terraria |
| 🏰 → Castle | Enshrouded |
| 🏭 → Factory | Satisfactory |
| 📖 → BookOpen | 文档 |
| 🔌 → Plug | API 参考 |
| 🌐 → Globe | 社区 |
| 👥 → Users | 团队 |
| ✍️ → PenLine | 博客 |
| 🔒 → Shield | 隐私 |
| 📋 → ScrollText | 更新日志 |
| 💎 → Gem (reuse) | 商城 icon |
| 🛒 → ShoppingCart | 商城头部 |
| 📱 → Smartphone | 支付 |
| 🎁 → Gift | 礼包 |
| 👑 → Crown | VIP/SVIP |
| ⚡ → Zap | 飞行权限 |
| 🗡 → Sword | 神装礼包 |
| 👤 → User | 玩家视角 |
| 💰 → DollarSign | 流水 |
| 🖥 → Monitor | 服务器 |
| 📈 → TrendingUp | 趋势图 |
| ✨ → Sparkles | CTA 按钮 |

导航下拉和 CTA 区域的 emoji 同样替换。

### 2. 中文排版修复（landing-v6.css）

- `--font` 首位放 Inter variable，确保中西文分轨
- Hero 标题 `font-weight:800`（中文字体的实际最大可用粗度）
- `letter-spacing:-0.02em`（中文只能用极小负值）
- `font-size` 上限从 7.5rem → 5rem
- `line-height:1.1`

### 3. 内容修正（LandingV6.tsx）

- 预览域名 → `gsp.ecsrz.com`
- 删除假流水数值，替换为真实状态标签
- section 编号补 `01` 起始
- 删除定价区（AGPL 开源项目不宜列商业定价）
- "0 代码接入"不放大为 96px 渐变，改为 14px 普通文字

### 4. CSS 作用域修复（landing-v6.css）

所有未加 `.landing-v6` 前缀的顶级选择器补作用域。

### 5. index.html SEO 补充

添加 description、favicon 引用、OG 标签。

---

## 变更文件

- `panel/frontend/src/pages/LandingV6.tsx` — emoji → lucide、内容修正
- `panel/frontend/src/landing-v6.css` — 排版修复、作用域修复
- `panel/frontend/index.html` — SEO 元信息
