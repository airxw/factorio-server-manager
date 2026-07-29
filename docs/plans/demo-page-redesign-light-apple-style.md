---
type: plan
title: GSP 主页重设计——浅色苹果风自动模拟演示（v3 视觉吸引力补强版）
date: 2026-07-25
status: deployed
deployed_in: v4.16.x
related: [docs/前端样式问题分析.md, panel/frontend/src/pages/IdentitySelector.tsx, panel/frontend/src/styles/identity-selector.css]
tags: [frontend, design, demo, apple-style, mobile, research-driven, visual-impact, unicorn]
---

# GSP 主页重设计——浅色苹果风自动模拟演示（v3 视觉吸引力补强版）

> **本版增量**：在 v2（12 家新兴 SaaS + 10 家游戏服务器面板）基础上，追加 2025-2026 新兴独角兽/AI 独角兽官网调研（OpenAI / Anthropic / Runway ML / Mistral / Cursor / Linear / Vercel / Apple Liquid Glass / Wix 2026 / Figma 2026 等 10+ 家），新增 22 项视觉冲击力趋势识别、12 项当前主页新增不足、视觉冲击力补强策略（§4.11）与最小可行补强包（§8）。v2 §1-§7 内容保留作为基线。

---

## 0. 核心结论

**GSP 最大差异化机会在"运营中台"叙事空白区**——竞品要么只讲运维（Pterodactyl/Pelican/PufferPanel/Crafty），要么只讲变现（Tebex/CraftingStore），没有一家做到"运维 + 变现 + 社区"一体化。配合浅色苹果风（10 家竞品 8 家深色，浅色即代际差）+ 产品 UI 即 Hero + 自动模拟演示，可形成代际视觉差。

### 0.1 v3 视觉冲击力补强核心结论

在 v2 基线上，v3 调研发现当前主页仍存在 **视觉吸引力代际差距**——即便落实 v2 的 6 层结构，仍缺以下视觉冲击力要素：

1. **文字即 Hero 的张力**：当前标题 `clamp(32px, 5vw, 52px)` 远低于 2026 主流 `clamp(2.5rem, 8vw+1rem, 7.5rem)`；无渐变文字、无负字距系统，缺"machined typography"质感
2. **Bento Box Hero 非对称分区**：v2 双栏 Hero 仍属 2018-2025 默认模板，2026 已被 Bento Box 非对称网格替代（Apple/Linear/Bolt/Vercel 已迁移）
3. **Apple 设计 DNA 未完整落地**：v2 仅取色彩，未取 Apple 真正 DNA——二元章节节奏（黑↔浅灰交替）、字体光学尺寸规则（>20px Display / ≤19px Text）、负字距系统、980px Pill CTA、单一 diffuse shadow
4. **缺乏新兴独角兽"克制可信度"信号**：OpenAI/Anthropic/Cursor 通过"少即是多"传达 VC 级可信度，GSP 当前信息密度过高反而稀释信任
5. **缺现代动态材质语言**：Apple Liquid Glass（2025 WWDC）已成为新基准，需用 CSS 模拟（非 backdrop-filter blur，用 radial-gradient + box-shadow 复合）

v3 补强策略见 §4.11，最小可行补强包见 §8。

---

## 1.4 新兴独角兽/AI 独角兽官网调研补充（v3 新增）

### 1.4.1 2026 视觉冲击力 10 大趋势（新增 22 项细分）

| # | 趋势 | 代表企业 | 与 GSP 关联度 |
|---|------|---------|--------------|
| T1 | **Barely-There UI（极简界面）** | OpenAI / Anthropic / Cursor / Perplexity | ★★★ GSP 当前信息密度过高，需克制 |
| T2 | **Text-as-Hero（文字即 Hero）** | Mistral / Anthropic / Linear | ★★ GSP 当前缺大字标题张力 |
| T3 | **Bento Box Hero（非对称网格 Hero）** | Apple / Linear / Bolt / Vercel | ★★★ GSP 双栏 Hero 已过时 |
| T4 | **Mesh Gradient / Aurora 背景** | Vercel / Linear / Resend | ★★ GSP 浅色场景需谨慎使用 |
| T5 | **Glow CTA Button（多层 box-shadow 光晕）** | Linear / Raycast / Cursor | ★★★ GSP 按钮 CTA 视觉重量不足 |
| T6 | **CSS Scroll-Driven Animations（零 JS 滚动叙事）** | Apple / Stripe / Resend | ★★★ GSP 当前完全静态 |
| T7 | **Customer/Scene Logo Bar（折线上下）** | Stripe / Vercel / Resend | ★★ GSP 当前 footer 文字罗列 |
| T8 | **ICP 命名定位（场景化角色）** | Resend / Linear / Cursor | ★★★ "服主/玩家/Demo"过于宽泛 |
| T9 | **Apple 二元章节节奏（黑↔浅灰交替）** | Apple.com | ★★★ GSP 当前单一深色背景 |
| T10 | **Apple 字体光学尺寸规则** | Apple.com | ★★ GSP 单一字号策略 |
| T11 | **Negative Letter-spacing 系统** | Apple.com | ★★ GSP 仅标题 -0.02em |
| T12 | **Pill CTA radius 980px** | Apple.com | ★★ GSP 按钮 14px 圆角 |
| T13 | **单一 Diffuse Shadow 系统** | Apple.com | ★★★ GSP 阴影无层级 |
| T14 | **Story-Driven Motion（叙事驱动动画）** | Stripe / Resend / Apple | ★★★ GSP 动画无叙事 |
| T15 | **数据可视化作为信任锚** | OpenAI / Anthropic / Stripe | ★★ GSP 当前无图表 |
| T16 | **Anthropic 式价值观驱动信息** | Anthropic | ★★ GSP 当前仅功能描述 |
| T17 | **Runway 式视频/动态预览** | Runway ML / Loom | ★★ GSP 仅静态卡片 |
| T18 | **OpenAI 式信任页脚（Blog/Security/Policy）** | OpenAI / Anthropic | ★★ GSP footer 三行文字 |
| T19 | **Soft Maximalism（受控极繁主义）** | Wix 2026 / Figma 2026 | ★ GSP 过度克制 |
| T20 | **Asymmetrical Balance（结构化不完美）** | Elementor 2026 | ★ GSP 严格对称三栏 |
| T21 | **Content-First Layouts（设计退后）** | GraphicDesignJunction 2026 | ★★ GSP UI 主导 |
| T22 | **Tool-Influenced Design（工具感）** | Cursor / Linear / Vercel | ★★ GSP 通用 dashboard 风 |

### 1.4.2 五大独角兽设计哲学提炼

| 企业 | 设计哲学 | GSP 借鉴点 |
|------|---------|-----------|
| **OpenAI** | 平衡导航（Research/API 清晰分离）+ 极简排版 + 信任提示（Blog/Security/Policy） | 顶部导航结构 + 信任页脚分区 |
| **Anthropic** | 清晰价值观驱动 + 友好语调 + 包容 UI + 强调安全/可理解 | 用价值观叙事替代功能罗列 |
| **Runway ML** | 视频优先产品演示 + 色块设计 + 强 CTA + 实时用例社区 | 自动演示区色块叙事 |
| **Mistral AI** | 开源+欧洲主权定位 + 多语言能力 + 模型矩阵清晰展示 | Pack 矩阵视觉锤对标 |
| **Cursor** | 产品 UI 即 Hero（编辑器截图直接做首屏） + ICP 命名（Hobby/Pro/Business） | Hero mockup + 角色场景化命名 |

### 1.4.3 Apple 设计 DNA 深度提取（v2 未覆盖）

v2 仅取 Apple 色彩，v3 补全 Apple 真正 DNA 的 7 个维度：

```yaml
Apple_DNA:
  二元章节节奏:
    规则: 纯黑 #000000 hero 段 ↔ 浅灰 #f5f5f7 编辑段交替
    GSP 适配: 浅色苹果风场景下,改为 #FBFBFD 白 ↔ #F5F5F7 浅灰交替(非黑↔灰),保留节奏感
    
  字体光学尺寸:
    规则: >20px 使用 SF Pro Display, ≤19px 使用 SF Pro Text
    GSP 适配: 字体栈声明 SF Pro Display + SF Pro Text,按尺寸切换
    
  负字距系统:
    规则: 所有尺寸负字距,56px→-0.28px,17px→-0.374px,10px→-0.08px
    GSP 适配: 标题 -0.02em ~ -0.03em,正文 -0.01em,小字 -0.005em
    
  Pill CTA 980px radius:
    规则: 主 CTA 按钮圆角 980px(实际表现为胶囊形),呼应 980px 最大内容宽度
    GSP 适配: 主 CTA 改为胶囊形 border-radius: 999px,次级按钮保留 12px
    
  单一 Diffuse Shadow:
    规则: 全系统仅一个阴影 rgba(0,0,0,0.22) 3px 5px 30px 0px,摄影感、柔和、稀有
    GSP 适配: 定义 --shadow-apple 单一变量,所有浮层/卡片共用
    
  Product-as-Hero 摄影:
    规则: 产品图仅放在纯色背景,不放渐变/纹理/竞争背景
    GSP 适配: GSP 仪表盘 mockup 放在纯白 #FFFFFF 舞台,周围 96px 留白
    
  Liquid Glass 材质 (2025 WWDC 新增):
    规则: 折射/反射玻璃材质,real-time rendering,specular highlights
    GSP 适配: 用 radial-gradient + box-shadow 复合模拟,禁用 backdrop-filter blur(历史黑屏教训)
```

---

## 1. 调研发现汇总

### 1.1 新兴 SaaS 官网 10 大趋势（Linear/Vercel/Stripe/Figma/Notion/Retool/Supabase/Clerk/Resend/Tailwind/shadcn/Cal.com）

| # | 趋势 | 代表 |
|---|------|------|
| 1 | **产品 UI 即 Hero**：真实产品界面做首屏主角，非插画 | Linear/shadcn/Cal.com/Notion |
| 2 | **AI Agent 叙事化**：AI 能力做成动态工作流演示 | Linear/Vercel/Notion |
| 3 | **Bento Grid 布局**：多能力网格卡片，每卡截图+标题+链接 | Clerk/Retool/shadcn/Notion |
| 4 | **代码↔渲染对照**：开发者向产品双栏对照 | Tailwind/Resend/Supabase |
| 5 | **真实数据/高精度数字**：具体数字建权威感 | Stripe(1.68064353%)/Figma(95% F500) |
| 6 | **事件流/时间线动画**：HTTP 响应/状态变化流式呈现 | Resend/Linear |
| 7 | **多语言/多场景切换演示** | Stripe/Tailwind |
| 8 | **章节编号+精致排版**：FIG 0.x 营造产品手册质感 | Linear/Cal.com |
| 9 | **客户案例+KOL 引言**：CEO/CTO 级引言替代纯 logo 墙 | Supabase/Cal.com |
| 10 | **顶部公告条**：融资/版本/重大事件细横条 | Clerk/Cal.com/Vercel |

### 1.2 游戏服务器面板官网 6 大共性短板

1. **视觉语言集体停留在 2018 年**：深青蓝+六宫格+静态截图轮播，无记忆点
2. **能力展示停留在"功能清单"，无"运营叙事"**：Security/Docker/Scalable 同质化，无一讲清"部署→监控→变现→社区"闭环
3. **游戏支持展示普遍敷衍**：不列或文字罗列，仅 Pelican 做到 logo+名称卡片化
4. **缺乏在线 Demo 入口**：10 家仅 1 家（Pelican）提供在线试用
5. **信任锚单一**：多数只有"开源+免费"，缺量化运行证据
6. **变现/运营能力几乎缺席**：开源面板不讲变现，商业面板只讲 mods store，"运维+变现+社区"一体化是空白

### 1.3 GSP 5 大差异化突破点

| 突破点 | 对标 | 差异化逻辑 |
|--------|------|-----------|
| **「运营中台」双段叙事** | PlayFab 建连+运营 / Tebex Extend Your X | 竞品无一家做到运维+变现一体化 |
| **浅色苹果风代际差** | PlayFab 浅色蓝调 | 10 家竞品 8 家深色，浅色即代际差 |
| **游戏矩阵可视化视觉锤** | Pelican 游戏卡片升级 | 11+ Pack 是被低估的视觉资产 |
| **在线 Demo+量化证据双信任锚** | Pelican demo + Crafty 安装数 + AWS 案例 | 10 家仅 1 家有 demo |
| **运营能力模块化展示** | AMP 十宫格 + CraftingStore 定价分层 | 让"运营中台"抽象定位落地为可视清单 |

---

## 2. 当前主页不足分析（IdentitySelector）

| # | 不足 | 现状代码 | 影响 |
|---|------|---------|------|
| 1 | 深色背景与定位冲突 | `background: linear-gradient(180deg, #000000 0%, #1C1C1E 100%)` | 与浅色苹果风完全相反，无代际差 |
| 2 | 无产品 UI 即 Hero | 仅三张身份卡 | 访客首屏感知不到产品形态 |
| 3 | 无自动模拟演示 | /demo 是入口聚合 | 用户需进后台才能理解产品 |
| 4 | 无 Bento Grid 能力矩阵 | 仅 3 张身份卡 | 多模块能力无法感知 |
| 5 | 无运营叙事 | 无链路展示 | "运营中台"定位无支撑 |
| 6 | 无游戏矩阵可视化 | footer 一行文字 | 11+ Pack 资产被浪费 |
| 7 | 无量化信任锚 | "开源免费"文字 | 信任强度不足 |
| 8 | 无顶部公告条 | BUILD ID 固定小字 | 版本/更新无突出承载 |
| 9 | backdrop-filter blur 残留 | `.id-back-btn { backdrop-filter: blur(8px) }` | 黑屏历史教训隐患 |
| 10 | 信息层级单一 | 标题→卡片→footer | 缺乏现代 SaaS 多层叙事 |
| 11 | 无章节编号系统 | 无 | 缺产品手册质感 |
| 12 | 无事件流时间线 | 无 | 服务器状态展示缺最佳形式 |

### 2.1 v3 新增不足（基于 22 项视觉冲击力趋势对照）

| # | 新增不足 | 对照趋势 | 现状 | 影响 |
|---|---------|---------|------|------|
| 13 | 标题张力不足 | T2 Text-as-Hero | `clamp(32px, 5vw, 52px)` 远低于主流 `clamp(2.5rem, 8vw+1rem, 7.5rem)` | 首屏视觉冲击力代际差距 |
| 14 | Hero 仍用双栏布局 | T3 Bento Box Hero | v2 方案仍是"左文案+右 mockup"双栏 | 双栏已被 Bento Box 替代为 2026 默认 |
| 15 | 无渐变文字 Hero | T2 | `.id-accent-text` 仅单色 #0A84FF | 缺现代感与品牌识别 |
| 16 | 无 Glow CTA 多层光晕 | T5 | `.id-card-btn` 仅纯色背景 | CTA 视觉重量不足，点击诱惑低 |
| 17 | 完全静态无 Scroll-Driven 动画 | T6 | 仅 hover transform | 缺滚动叙事感，访客停留时间短 |
| 18 | 字体光学尺寸规则未应用 | T10 Apple DNA | 单一 font-family 字号策略 | 缺 Apple 排版质感 |
| 19 | 负字距系统不完整 | T11 Apple DNA | 仅标题 -0.02em，正文无 | 排版密度与权威感不足 |
| 20 | 主 CTA 圆角过小 | T12 Apple DNA | 按钮 14px 圆角 | 缺 Apple 标志性 Pill CTA 细节 |
| 21 | 阴影系统无层级 | T13 Apple DNA | `.id-card` 无 box-shadow | 缺摄影感深度与浮层关系 |
| 22 | 动画无叙事性 | T14 Story-Driven Motion | 仅 hover 单次过渡 | 动画不服务产品故事 |
| 23 | 无数据可视化信任锚 | T15 | 无任何图表/曲线 | 缺 VC 级可信度信号 |
| 24 | 信息密度过高稀释信任 | T1 Barely-There UI | 三卡 × 5 字段 = 15 信息块 | 缺 OpenAI/Anthropic 式克制 |

---

## 3. 借鉴矩阵

### ✅ 强烈推荐（高匹配度）

| 设计手法 | 借鉴来源 | GSP 应用 |
|---------|---------|---------|
| **产品 UI 即 Hero** | shadcn/Cal.com/Linear | 首屏直接展示 GSP 仪表盘 mockup（服务器状态+在线玩家+CPU曲线+任务队列） |
| **Bento Grid 能力矩阵** | Clerk/Retool/Notion | 浅色卡片网格展示 6-8 模块（部署/监控/商城/CDK/社区/调度） |
| **自动模拟演示** | Stripe 支付流/Resend 事件流 | 页面自己模拟 5 场景操作（开服/礼包/商城/投票/跨游戏） |
| **事件流时间线** | Resend/Linear | 服务器状态/任务日志流式时间线 |
| **顶部公告条** | Clerk/Cal.com | BUILD 序列+版本更新+维护通知 |
| **章节编号系统** | Linear FIG 0.x | 01/02/03 编号营造产品手册质感 |
| **双段运营叙事** | PlayFab Build+Operate | 「部署与运维」+「运营与变现」双段 |
| **游戏矩阵视觉锤** | Pelican 升级 | logo 网格+分类筛选 |
| **三步流程引导** | Cal.com | 接入服务器→配置监控→上线运营 |
| **量化信任锚** | Stripe/Crafty | 已管理服务器数/累计在线时长/支持游戏数 |

### ⚠️ 谨慎借鉴

| 设计手法 | 调整建议 |
|---------|---------|
| 真实数据高精度数字 | 用于"已管理服务器数/累计在线时长"，避免堆砌 |
| 客户案例+KOL 引言 | GSP 阶段用"使用场景"替代知名客户 |
| 代码↔渲染对照 | 配置文件↔服务器行为对照，开发者向可放次屏 |

### ❌ 不借鉴

| 设计手法 | 原因 |
|---------|------|
| 深色 hero 背景 | 与浅色苹果风冲突 |
| 碎片化文字动画 | 偏科技酷炫，非苹果清新 |
| 3D 粒子/光效 | 偏电竞风，违反规则 |
| AI Agent 实时对话 | 避免过度承诺 |
| Minecraft 方块化视觉 | 过度游戏感，偏离中台定位 |

### 3.1 v3 新增借鉴矩阵（基于新兴独角兽调研）

#### ✅ v3 强烈推荐新增

| 设计手法 | 借鉴来源 | GSP 应用 | 优先级 |
|---------|---------|---------|--------|
| **Bento Box Hero 非对称网格** | Apple/Linear/Bolt/Vercel | Hero 区改 4-6 块非对称分区（主标题块 + mockup 块 + 数据徽章块 + 场景块），打破双栏 | P0 |
| **Text-as-Hero 流体大字** | Mistral/Anthropic/Linear | 主标题 `clamp(2.5rem, 8vw+1rem, 7.5rem)` + 渐变文字 + 负字距 | P0 |
| **Glow CTA 多层光晕** | Linear/Raycast/Cursor | 主 CTA `box-shadow: 0 0 20px rgba(0,122,255,0.4), 0 0 60px rgba(0,122,255,0.2)` | P0 |
| **CSS Scroll-Driven 动画** | Apple/Stripe/Resend | 章节编号随滚动揭示、信任锚数字 count-up、Bento 卡片 stagger 入场 | P0 |
| **Apple Pill CTA 999px radius** | Apple.com | 主 CTA `border-radius: 999px`，次级按钮保留 12px | P0 |
| **Apple 单一 Diffuse Shadow** | Apple.com | 定义 `--shadow-apple: 0 3px 5px 30px rgba(0,0,0,0.22)`，所有浮层共用 | P0 |
| **Apple 负字距系统** | Apple.com | 标题 -0.022em、副标题 -0.015em、正文 -0.01em、小字 -0.005em | P1 |
| **Apple 字体光学尺寸** | Apple.com | 字体栈 `SF Pro Display >20px, SF Pro Text ≤19px`，按尺寸切换 | P1 |
| **Mesh Gradient 浅色版背景** | Vercel/Linear/Resend | Hero 背景 `radial-gradient` 多层叠加（非 blur），低饱和度 | P1 |
| **数据可视化信任锚** | OpenAI/Anthropic/Stripe | 信任锚数字配 mini sparkline SVG 曲线 | P1 |
| **场景化 ICP 命名** | Resend/Linear/Cursor | 三入口重命名："社区服主/玩家公会/Demo 演示"（替代"服主/玩家/先看看"） | P1 |
| **OpenAI 式信任页脚分区** | OpenAI/Anthropic | Footer 分 4 区：产品/资源/合规/开源，每区 3-5 链接 | P1 |
| **Anthropic 式价值观叙事段** | Anthropic | Bento Grid 后追加"我们的信念"段（3 行价值观 + 1 段叙事） | P2 |
| **Apple 二元章节节奏（浅色版）** | Apple.com | #FBFBFD 白 ↔ #F5F5F7 浅灰交替，保留节奏感 | P2 |
| **Story-Driven Motion** | Stripe/Resend | 演示区动画服务"获客→内容→秩序→赞助"叙事，非装饰 | P2 |

#### ⚠️ v3 谨慎借鉴新增

| 设计手法 | 调整建议 |
|---------|---------|
| Barely-There UI（极简界面） | GSP 演示页需展示产品形态，不能完全 OpenAI/Anthropic 式留白；改为"分段克制"——Hero 极简、Bento 信息密度适中、演示区高密度 |
| Liquid Glass 材质（2025 WWDC） | 历史黑屏教训禁用 backdrop-filter blur；用 radial-gradient + box-shadow 复合模拟玻璃感 |
| Soft Maximalism（受控极繁） | GSP 浅色基调不适配极繁，仅借鉴"大胆字号 + 强对比"维度 |
| Asymmetrical Balance（不完美结构） | 仅在 Bento Box Hero 应用非对称，其他段落保留对称 |
| Tool-Influenced Design | 仅在 Bento 卡片截图带"工具感"（YAML/命令行/控制台），不全页工具化 |

#### ❌ v3 不借鉴新增

| 设计手法 | 原因 |
|---------|------|
| Dark Premium + Jewel Tones（深色版） | 与浅色苹果风冲突，10 家竞品 8 家深色已是红海 |
| Vibrant/Maximalist 色彩 | 与苹果清新风冲突 |
| Retro-Futurism / 80s Excess | 偏怀旧风，与运营中台定位不符 |
| Museumcore / Dial-up Design | 偏小众艺术，不服务转化 |
| Voice UI / Chatbot | 演示页是被动观看，不需要交互对话 |
| Gamified Design Features | 已有 Demo 自动演示，避免双重游戏化 |

---

## 4. 优化后设计方案

### 4.1 定位

**主页即产品演示秀——浅色苹果风，首屏直接展示 GSP 仪表盘 mockup，页面自动模拟"开服→运营→变现"全链路操作，访客 30-60 秒看懂运营中台价值。**

- `/` 未登录 → 渲染演示主页
- `/` 已登录 → 跳转对应基座（/admin、/store、/guild）
- IdentitySelector 降级为已登录用户的基座切换器（或移除，待确认）

### 4.2 视觉语言（浅色苹果风）

```yaml
色彩:
  主背景: "#FBFBFD"        # 苹果近白
  次背景: "#F5F5F7"        # 浅灰（卡片/分区）
  演示舞台: "#FFFFFF"      # 纯白
  primary: "#007AFF"       # iOS 蓝
  primary_hover: "#0A84FF"
  accent: "#5AC8FA"        # 浅蓝点缀
  text_primary: "#1D1D1F"
  text_secondary: "#6E6E73"
  text_tertiary: "#86868B"
  success: "#34C759"
  warning: "#FF9500"
  danger: "#FF3B30"
  禁止: [霓虹紫, 粉色, 电竞橙, 深色黑底]

排版:
  字体栈: -apple-system, 'SF Pro Display', 'Inter', 'PingFang SC'
  大标题: clamp(40px, 6vw, 64px), weight 700, letter-spacing -0.02em
  副标题: clamp(20px, 3vw, 28px), weight 600
  正文: 17px, line-height 1.6
  等宽: 'SF Mono', 'JetBrains Mono'（BUILD/代码）
  留白: 章节间距 96px（桌面）/ 64px（移动）

形态:
  圆角: 卡片 20px / 按钮 12px / 徽章 999px
  阴影: 0 4px 20px rgba(0,0,0,0.04) / hover 0 8px 32px
  演示舞台: 0 20px 60px rgba(0,0,0,0.06)
  禁止: backdrop-filter blur / 大半径 blur 持续动画

动画:
  曲线: cubic-bezier(0.16, 1, 0.3, 1)
  微交互: 0.2s / 入场: 0.65s / 场景切换: 0.5s
  允许: transform/opacity 单次过渡
  禁止: Canvas RAF 无限循环 / blur 持续动画 / 100vh 强制无 overflow
  无障碍: prefers-reduced-motion: reduce 禁用所有动画
```

### 4.3 页面架构（6 层，对标新兴 SaaS）

```
┌─────────────────────────────────────────────┐
│ 顶部公告条（BUILD 序列 + 版本更新）           │  ← 借鉴 Clerk/Cal.com
├─────────────────────────────────────────────┤
│ 导航条（Logo · 能力/游戏/文档 · 体验按钮）   │
├─────────────────────────────────────────────┤
│                                             │
│  01 · Hero 区                               │  ← 章节编号借鉴 Linear
│  电梯演讲标题 + 副标题（获客→内容→秩序→赞助）│
│  [观看演示] [立即体验]                       │
│  ★ 产品 UI 即 Hero：GSP 仪表盘 mockup       │  ← 借鉴 shadcn/Cal.com
│  （服务器状态卡 + 在线玩家 + CPU 曲线 + 任务）│
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  02 · 自动模拟演示区（核心）                 │
│  左：场景导航（5 场景，章节编号）            │
│  右：演示舞台（自动播放模拟操作 + 事件流）   │  ← 借鉴 Stripe/Resend
│  底：进度条 + 场景指示点                     │
│                                             │
├─────────────────────────────────────────────┤
│  03 · Bento Grid 能力矩阵                    │  ← 借鉴 Clerk/Notion
│  部署运维 · 商城变现 · 社区秩序 · 数据看板  │
│  （双段叙事：运维段 + 运营段）               │  ← 借鉴 PlayFab/Tebex
├─────────────────────────────────────────────┤
│  04 · 游戏矩阵视觉锤                         │  ← 借鉴 Pelican 升级
│  11+ 游戏 logo 网格 + 分类筛选              │
├─────────────────────────────────────────────┤
│  05 · 信任锚数据墙                           │  ← 借鉴 Stripe/Crafty
│  已管理服务器数 / 累计在线时长 / 支持游戏数  │
│  + 使用场景案例                              │
├─────────────────────────────────────────────┤
│  06 · CTA 区                                 │
│  "5 分钟开服，0 代码运营"                   │
│  [免费开始] [查看文档] + 三步流程图          │  ← 借鉴 Cal.com
├─────────────────────────────────────────────┤
│  Footer（开源协议 / 链接）                   │
└─────────────────────────────────────────────┘
```

### 4.4 核心：产品 UI 即 Hero + 自动模拟演示

#### Hero 区（01）

```yaml
布局:
  左半: 文案区（标题+副标题+CTA+章节编号 01）
  右半: GSP 仪表盘 mockup（浅色卡片，高密度但秩序井然）

仪表盘 mockup 内容（借鉴 shadcn 完整仪表盘思路）:
  - 顶部：服务器状态卡（3 台，在线/启动中/离线状态徽章）
  - 中部：CPU/内存迷你曲线（静态 SVG，非实时）
  - 右侧：在线玩家列表（3-5 名，头像+时长）
  - 底部：任务队列（部署中/备份中/已完成）
  - 角标：实时事件流条（借鉴 Resend，1 行滚动）

文案:
  主标题: "把开游戏服务器，从「技术活」变成「运营活」"
  副标题: "GSP 是游戏服务器的通用运营中台——获客 → 内容 → 秩序 → 赞助，一条玩家运营链路，做成可插拔的标准件"
  CTA: [观看演示 ↓] [立即体验 →]
```

#### 自动模拟演示区（02，核心）

**页面自己模拟操作，访客只看不动。**

5 场景对应"获客→内容→秩序→赞助"链路，每场景 8-12 秒自动轮播：

| 场景 | 链路环节 | 模拟操作流程 | 借鉴 |
|------|---------|-------------|------|
| 01 5分钟开服 | 获客 | 选 Pack→部署→进度环→上线→玩家加入 | Stripe 支付流 |
| 02 新手礼包自动发放 | 内容 | 进服检测→规则触发→礼包飞入→MC聊天框 | Resend 事件流 |
| 03 VIP商城配置购买 | 赞助 | 服主上架→玩家浏览→下单→权限激活→流水+¥98 | Stripe checkout |
| 04 社区投票踢挂 | 秩序 | 发起投票→实时计票→通过→踢人通知 | Linear 状态流 |
| 05 跨游戏统一管理 | 平台 | MC→Palworld→ARK Tab切换+YAML闪现 | Tailwind 对照 |

```yaml
演示区交互:
  自动播放: 10s/场景，循环
  手动控制: 场景点点击跳转 + 暂停/继续 + 键盘左右
  视线引导: 当前操作元素 box-shadow 呼吸脉冲（非 blur）
  事件流: 每场景底部 1 行事件时间线（借鉴 Resend）
  场景字幕: 轻量旁白解释当前操作
  章节编号: 01-05 标注场景
  性能: transform/opacity 过渡 + visibilitychange 暂停 + 场景切换清定时器
```

### 4.5 Bento Grid 能力矩阵（03）

双段叙事（借鉴 PlayFab Build+Operate / Tebex Extend Your X）：

```
「部署与运维」段（上半）
┌──────────┐ ┌──────────┐ ┌──────────┐
│ ① 一键部署 │ │ ② 监控告警 │ │ ③ 多节点   │
│ 11+ Pack  │ │ CPU/内存   │ │ 扩缩容     │
│ 零代码    │ │ 实时曲线   │ │ 远程节点   │
└──────────┘ └──────────┘ └──────────┘

「运营与变现」段（下半）
┌──────────┐ ┌──────────┐ ┌──────────┐
│ ④ 商城CDK  │ │ ⑤ 社区秩序 │ │ ⑥ 数据看板 │
│ VIP/礼包  │ │ 投票/审计  │ │ 流水/时长  │
│ 自动发放   │ │ 黑白名单   │ │ 运营报表   │
└──────────┘ └──────────┘ └──────────┘
```

每卡：浅色背景 + 圆角 20px + 微缩产品截图 + 标题 + 1 行描述 + 章节编号。

### 4.6 游戏矩阵视觉锤（04）

```yaml
形式: logo 网格 + 分类筛选 chips
分类: 全部 / Minecraft 系 / SteamCMD / 独立游戏 / 语音服务
展示: 11+ 游戏 logo 卡片（圆角 16px，hover 微抬升）
交互: 点击 chip 筛选，卡片 opacity 过渡
标语: "一份 YAML，零代码接入新游戏"
```

### 4.7 信任锚数据墙（05）

```yaml
形式: 3-4 个大数字横排 + 使用场景卡片
数字示例（需真实数据）:
  - 已支持 11+ 款游戏
  - 12 个 Pack 模板
  - B2B2C 三级权限
  - AGPL-3.0 开源
使用场景: "某 MC 服主 30 节点管理" / "某社区服 CDK 自动发放"（替代知名客户）
```

### 4.8 CTA 区（06）

```yaml
标题: "5 分钟开服，0 代码运营"
按钮: [免费开始 →] [查看文档]
三步流程图（借鉴 Cal.com）:
  ① 接入服务器 → ② 配置监控 → ③ 上线运营
每步配微缩截图 + 章节编号
```

### 4.9 移动端适配

```yaml
断点: 768px / 1024px
Hero: 单列堆叠（文案上，mockup 下），标题 clamp(28px, 8vw, 40px)
演示区: 上下排列（舞台 60vh，场景导航横向 chips）
Bento Grid: 单列堆叠
游戏矩阵: 横向滚动 snap
CTA: sticky 底部按钮（56px）
触摸: 最小目标 44×44px，按钮 52px
视口: min-height + dvh（非 100vh 强制，参考 rules-0 §3.1.6）
性能: 移动端降帧，opacity 为主
```

### 4.10 技术红线（继承历史教训）

```yaml
GPU 安全:
  禁止: backdrop-filter: blur（当前 .id-back-btn 残留，必须移除）
  禁止: Canvas requestAnimationFrame 无限循环
  禁止: filter: blur > 20px 持续动画
  禁止: 100vh 强制 + overflow 缺失
  允许: transform/opacity 单次过渡 / 静态 CSS 渐变 / SVG 动画
性能:
  首屏 LCP < 2s
  演示区 JS < 30KB gzip
  visibilitychange 暂停演示
无障碍:
  prefers-reduced-motion: reduce 禁用动画
  演示区 aria-live: polite
  场景导航键盘可达
  颜色对比度 WCAG AA
命名隔离:
  演示页独立 CSS 命名空间（demo- 前缀）
  不污染 admin/store 浅色主题
```

### 4.11 v3 视觉冲击力补强策略（核心新增）

v2 §4.1-§4.10 已搭好骨架，v3 在此基础上补强 **视觉冲击力** 与 **品牌识别度**。补强策略分 5 个维度：

#### 4.11.1 排版张力补强（对标 Mistral/Anthropic/Linear/Apple）

```yaml
策略:
  主标题:
    字号: clamp(2.5rem, 8vw + 1rem, 7.5rem)   # 40px → 120px 流体
    字重: 700
    字距: -0.022em                              # Apple 负字距
    字体: 'SF Pro Display', -apple-system       # >20px 用 Display
    行高: 1.05                                  # 紧凑如 Apple 56px→1.07
    效果: 渐变文字(可选) -webkit-background-clip: text
           linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)
    
  副标题:
    字号: clamp(1.25rem, 2vw + 0.5rem, 1.75rem)  # 20-28px
    字重: 600
    字距: -0.015em
    字体: 'SF Pro Display', -apple-system         # 仍 >20px
    行高: 1.3
    颜色: #6E6E73                                # Apple secondary
    
  正文:
    字号: 17px                                    # Apple body 标准
    字重: 400
    字距: -0.01em
    字体: 'SF Pro Text', -apple-system            # ≤19px 用 Text
    行高: 1.47                                    # Apple body 标准
    
  小字:
    字号: 11-13px
    字距: -0.005em
    字体: 'SF Pro Text', -apple-system

落地:
  - 升级 .id-main-title 至 Text-as-Hero 规格
  - 升级 .id-main-desc 至 Apple 副标题规格
  - 全页应用负字距系统(标题/副标题/正文/小字)
  - 字体栈声明: font-family: 'SF Pro Display', 'SF Pro Text', -apple-system, ...
  - 按尺寸切换 Display/Text(用 CSS @media + font-family 不可行,改用语义化 class)
```

#### 4.11.2 Bento Box Hero 替代双栏（对标 Apple/Linear/Bolt）

v2 双栏 Hero 升级为 Bento Box 非对称 6 块网格：

```
┌─────────────────────────────────────────────────────┐
│  ┌────────────────────────┐  ┌──────────────────┐  │
│  │                        │  │                  │  │
│  │  Tier 1 主标题块        │  │  Tier 2 数据徽章  │  │
│  │  (4col × 2row)         │  │  (2col × 1row)   │  │
│  │  Text-as-Hero          │  │  "11+ 游戏"      │  │
│  │  + Glow CTA            │  │  mini sparkline  │  │
│  │                        │  ├──────────────────┤  │
│  │                        │  │  Tier 2 场景块    │  │
│  │                        │  │  (2col × 1row)   │  │
│  │                        │  │  "5 分钟开服"    │  │
│  ├────────────────────────┴──┴──────────────────┤  │
│  │  Tier 1 mockup 块 (6col × 2row)              │  │
│  │  GSP 仪表盘 mockup + 事件流条                  │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

```yaml
Bento_Hero_规格:
  网格: grid-template-columns: repeat(6, 1fr); grid-auto-rows: minmax(120px, auto)
  主标题块: grid-column: 1/5; grid-row: 1/3    # 占 4 列 2 行
  数据徽章块: grid-column: 5/7; grid-row: 1/2  # 占 2 列 1 行
  场景块: grid-column: 5/7; grid-row: 2/3      # 占 2 列 1 行
  mockup 块: grid-column: 1/7; grid-row: 3/5   # 占 6 列 2 行
  间距: gap: 16px
  圆角: border-radius: 24px
  背景: #FFFFFF 纯白卡片
  阴影: var(--shadow-apple) 单一 diffuse
  hover: transform: translateY(-2px), 不破坏非对称

  Tier 分配原则:
    Tier 1 (1-2 块): 主标题 + mockup, 占最大空间
    Tier 2 (2-3 块): 数据徽章 + 场景, 中等空间
    Tier 3 (可选): 无, Bento Hero 不超过 5 块避免认知过载

  移动端:
    单列堆叠,顺序: 主标题 → 数据徽章 → 场景 → mockup
    Tier 1 块宽度 100%, Tier 2 块宽度 100%
```

#### 4.11.3 Glow CTA + Apple Pill 形态（对标 Linear/Raycast/Apple）

```yaml
主 CTA (Pill 形):
  background: linear-gradient(135deg, #007AFF 0%, #0A84FF 100%)
  color: #FFFFFF
  border: none
  border-radius: 999px                          # Apple Pill CTA
  padding: 14px 32px
  font: 600 16px 'SF Pro Display', sans-serif
  letter-spacing: -0.01em
  box-shadow:
    - 0 0 20px rgba(0, 122, 255, 0.4)           # 近距离光晕
    - 0 0 60px rgba(0, 122, 255, 0.2)           # 远距离光晕
    - 0 4px 12px rgba(0, 0, 0, 0.1)             # 基础阴影
  transition: box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1)
  hover:
    box-shadow:
      - 0 0 30px rgba(0, 122, 255, 0.6)
      - 0 0 80px rgba(0, 122, 255, 0.3)
      - 0 8px 24px rgba(0, 0, 0, 0.15)
    transform: translateY(-1px)
  active:
    transform: translateY(0)

次级 CTA (Ghost 形):
  background: transparent
  color: #007AFF
  border: 1px solid rgba(0, 122, 255, 0.3)
  border-radius: 999px                          # 同样 Pill
  padding: 13px 31px                            # -1px 补偿 border
  hover:
    background: rgba(0, 122, 255, 0.06)
    border-color: rgba(0, 122, 255, 0.5)
```

#### 4.11.4 CSS Scroll-Driven 动画（零 JS，对标 Apple/Stripe）

```yaml
策略:
  章节编号揭示:
    触发: scrollIntoView
    效果: opacity 0→1 + translateY 20px→0
    曲线: cubic-bezier(0.16, 1, 0.3, 1)
    时长: 0.65s
    
  信任锚数字 count-up:
    触发: scrollIntoView
    效果: 数字从 0 滚动到目标值(用 requestAnimationFrame 一次性,非无限)
    时长: 1.5s
    曲线: ease-out
    
  Bento 卡片 stagger 入场:
    触发: scrollIntoView
    效果: 卡片依次 opacity 0→1 + translateY 30px→0
    stagger: 80ms
    时长: 0.5s
    
  演示区场景切换:
    触发: 自动轮播 + 手动点击
    效果: opacity + transform(translateX) 切换
    曲线: cubic-bezier(0.16, 1, 0.3, 1)
    时长: 0.5s
    
  滚动进度条:
    位置: fixed top: 0
    实现: 纯 CSS scroll-timeline (现代浏览器) + JS fallback
    颜色: linear-gradient(90deg, #007AFF, #5AC8FA)

实现原则:
  - 仅 IntersectionObserver + requestAnimationFrame(一次性)
  - 禁用 scroll-linked 无限动画(性能)
  - prefers-reduced-motion: reduce 禁用所有
  - 场景切换清定时器(避免重叠)
```

#### 4.11.5 信任锚 + 数据可视化（对标 OpenAI/Anthropic/Stripe）

```yaml
信任锚 4 数字(配 mini sparkline):
  - 已支持游戏: 11+ (sparkline: 上升曲线)
  - Pack 模板: 12 (sparkline: 阶梯上升)
  - 权限层级: 3 (B2B2C) (sparkline: 三段柱状)
  - 开源协议: AGPL-3.0 (无 sparkline,改为 GitHub star count)

mini sparkline 实现:
  - 静态 SVG path,无动画(避免性能)
  - 尺寸: 80×24px
  - 颜色: #007AFF 描边 + rgba(0,122,255,0.1) 填充
  - 放在数字下方,作为视觉佐证

数据徽章块(Bento Hero Tier 2):
  - 大数字: 60px 'SF Pro Display' 600 weight
  - 小标签: 13px 'SF Pro Text' -0.005em
  - sparkline: 80×24px SVG
  - 整块: #FFFFFF 卡片 + var(--shadow-apple)
```

#### 4.11.6 视觉冲击力补强总结表

| 维度 | v2 状态 | v3 补强 | 优先级 |
|------|---------|---------|--------|
| 排版张力 | clamp(32px,5vw,52px) | clamp(2.5rem,8vw+1rem,7.5rem) + 负字距系统 + Display/Text 切换 | P0 |
| Hero 布局 | 双栏 | Bento Box 6 块非对称网格 | P0 |
| CTA 形态 | 14px 圆角纯色 | 999px Pill + Glow 多层光晕 | P0 |
| 滚动动画 | 无 | CSS Scroll-Driven 5 类动画 | P0 |
| 阴影系统 | 无 | 单一 --shadow-apple diffuse | P0 |
| 信任锚 | 文字 | 4 数字 + mini sparkline SVG | P1 |
| ICP 命名 | 服主/玩家/Demo | 社区服主/玩家公会/Demo 演示 | P1 |
| 字体光学 | 单一字体栈 | Display >20px / Text ≤19px | P1 |
| Footer | 三行文字 | OpenAI 式 4 区分区 | P1 |
| 章节节奏 | 单一深色 | #FBFBFD ↔ #F5F5F7 交替 | P2 |
| 价值观叙事 | 无 | Anthropic 式"我们的信念"段 | P2 |

---

## 5. 执行步骤（开发事项，不区分优先级）

### 5.1 设计资产准备
- 浅色苹果风设计 token（色彩/排版/圆角/阴影/动画曲线）
- 组件形态规范（卡片/按钮/徽章/进度条/Tab/事件流条）
- 11+ 游戏 Pack SVG 图标资产（统一风格）
- GSP 仪表盘 mockup 设计稿

### 5.2 主页骨架重构
- 替换 IdentitySelector 深色样式为浅色苹果风
- 移除 `.id-back-btn` backdrop-filter blur
- 顶部公告条（BUILD 序列 + 版本）
- 导航条（Logo + 锚点 + 体验按钮）
- 6 层结构骨架

### 5.3 Hero 区（01）
- 左半文案区（章节编号 + 电梯演讲 + CTA）
- 右半 GSP 仪表盘 mockup（静态 SVG/CSS，非实时）
- 仪表盘内嵌 1 行事件流条（滚动）

### 5.4 自动模拟演示区（02，核心）
- 演示舞台容器（白底 + 柔和阴影）
- 5 场景组件（每场景独立，模拟真实 UI 操作）
- 场景轮播控制器（自动播放 + 进度条 + 暂停）
- 场景导航（章节编号 chips + 指示点 + 键盘）
- 视线引导脉冲（box-shadow 呼吸）
- 事件流时间线（每场景底部 1 行）
- 场景字幕组件

### 5.5 五场景模拟 UI
- 场景1：Pack 卡 + 部署按钮 + 进度环 + 状态徽章 + 玩家列表
- 场景2：系统通知 + 礼包物品卡 + MC 聊天框（§颜色解析）
- 场景3：商品配置 + 商城卡 + 支付成功 + VIP 权限 + 流水计数器
- 场景4：投票发起 + 实时计票 + 通过徽章 + 踢人通知
- 场景5：游戏 Tab 切换 + 统一面板 + YAML 片段

### 5.6 Bento Grid 能力矩阵（03）
- 双段叙事容器（运维段 + 运营段）
- 6 张能力卡（浅色 + 截图 + 章节编号）
- hover 微交互

### 5.7 游戏矩阵视觉锤（04）
- 11+ 游戏 logo 网格
- 分类筛选 chips
- 筛选过渡动画

### 5.8 信任锚数据墙（05）
- 3-4 大数字横排
- 使用场景卡片

### 5.9 CTA 区（06）
- 标题 + 双按钮
- 三步流程图（微缩截图 + 编号）

### 5.10 移动端适配
- 断点布局
- sticky 底部 CTA
- 触摸目标校验
- dvh 视口

### 5.11 路由与首页定位
- `/` 未登录 → 演示主页；已登录 → 基座跳转
- IdentitySelector 降级或移除（待确认）
- `/demo` 保留别名

### 5.12 性能与无障碍
- 移除所有 backdrop-filter blur
- prefers-reduced-motion 支持
- visibilitychange 暂停
- LCP 验证

### 5.13 版本与测试
- BUILD ID 升级
- 版本号同步（8 处来源）
- s0402 三重测试闸门
- 移动端 375px E2E

### 5.14 部署与验证
- 增量部署前端 dist
- 浏览器验证：浅色 + 自动演示 + 移动端 + 12s 无黑屏

---

## 6. 待确认事项

1. **首页定位**：`/` 完全替换为演示主页？IdentitySelector 移除还是降级？
2. **仪表盘 mockup 数据**：用真实截图还是 CSS 模拟？（建议 CSS 模拟，轻量且可控）
3. **信任锚数字**：当前真实可披露的量化数据有哪些？（已支持游戏数/Pack 数/权限层级/开源协议是确定的）
4. **使用场景案例**：是否有真实服主愿意出镜？（否则用虚拟场景）
5. **游戏 logo 资产**：是否有版权安全的游戏 logo 可用？（无则用 Pack 图标 + 文字）
6. **演示音效**：建议无音效（苹果风克制）
7. **是否保留三角色一键进入**：新定位下底部 CTA 统一引导，还是保留快速进入入口？

---

## 7. 风险与约束

| 风险 | 缓解 |
|------|------|
| GPU 黑屏复发 | 严禁 blur/Canvas 无限循环，移除当前残留 blur |
| 演示动画卡顿 | 场景切换清定时器，visibilitychange 暂停 |
| 移动端视口锁死 | min-height + dvh，非 100vh |
| 浅色主题污染后台 | 独立 CSS 命名空间（demo- 前缀） |
| mockup 过度复杂 | 静态 SVG/CSS，非实时数据 |
| 游戏 logo 版权 | 无版权安全资产时用 Pack 图标+文字 |
| 自动演示干扰阅读 | 支持暂停，场景导航可手动跳转 |

---

## 附：调研对象清单

**新兴 SaaS（12 家）**：Linear / Vercel / Stripe / Figma / Notion / Retool / Supabase / Clerk / Resend / Tailwind CSS / shadcn/ui / Cal.com

**游戏服务器面板（10 家）**：Pterodactyl / Pelican / PufferPanel / Crafty Controller / AMP / Tebex / CraftingStore / AWS GameLift / Azure PlayFab / Villager Bot

**关键参照系**：
- Tebex = 运营中台叙事最佳参照
- PlayFab = 双段结构+浅色配色最佳参照
- Pelican = 游戏展示+在线 Demo 最佳参照
- shadcn/Cal.com = 产品 UI 即 Hero 最佳参照
- Stripe/Resend = 自动模拟演示+事件流最佳参照

---

## 8. v3 最小可行补强包（MVP）

考虑到 v2 §5 执行步骤共 14 项工作量较大，v3 提供分级 MVP 路径，便于快速验证视觉冲击力补强效果后再展开全量重构。

### 8.1 P0 最小补强包（1-2 个工作日，立竿见影）

**目标**：在不动 v2 整体骨架的前提下，仅通过 CSS 变更补强视觉冲击力代际差距。

| # | 补强项 | 实施方式 | 验证标准 |
|---|--------|---------|---------|
| P0-1 | 标题张力升级 | `.id-main-title` 字号改为 `clamp(2.5rem, 8vw + 1rem, 7.5rem)`，字距 `-0.022em`，行高 `1.05` | 桌面 56px+ / 移动 40px+，首屏视觉冲击力显著提升 |
| P0-2 | Glow CTA + Pill | `.id-card-btn` 改为 `border-radius: 999px`，box-shadow 三层光晕 | CTA 视觉重量达 Linear/Raycast 级别 |
| P0-3 | 单一 Diffuse Shadow | 定义 `--shadow-apple: 0 3px 5px 30px rgba(0,0,0,0.22)`，应用到所有卡片 | 阴影层级统一，摄影感深度 |
| P0-4 | 负字距系统 | 标题/副标题/正文/小字均应用负字距 | 排版密度接近 Apple 质感 |
| P0-5 | 浅色背景替换 | `.id-page` 背景从 `linear-gradient(180deg, #000, #1C1C1E)` 改为 `#FBFBFD` | 与浅色苹果风定位一致 |
| P0-6 | 移除 backdrop-filter blur | `.id-back-btn` 移除 `backdrop-filter: blur(8px)`，改为 `background: rgba(255,255,255,0.8)` | GPU 黑屏隐患消除 |
| P0-7 | 渐变文字（可选） | `.id-accent-text` 改为 `linear-gradient(135deg, #007AFF, #5AC8FA) + -webkit-background-clip: text` | 现代感提升 |

### 8.2 P1 进阶补强包（3-5 个工作日，结构性升级）

**目标**：在 P0 基础上，落实 Bento Box Hero 与 Scroll-Driven 动画。

| # | 补强项 | 实施方式 | 依赖 |
|---|--------|---------|------|
| P1-1 | Bento Box Hero | Hero 区改 6 块非对称网格（主标题+mockup+数据徽章+场景） | P0 完成 |
| P1-2 | 数据徽章 + sparkline | 4 数字（11+ 游戏/12 Pack/3 权限/AGPL）+ mini SVG sparkline | P1-1 |
| P1-3 | Scroll-Driven 入场动画 | IntersectionObserver 触发章节编号/Bento 卡片 stagger 入场 | P0 完成 |
| P1-4 | 信任锚 count-up | 数字从 0 滚动到目标值，1.5s 一次性 | P1-2 |
| P1-5 | ICP 命名重命名 | "服主/玩家/先看看" → "社区服主/玩家公会/Demo 演示" | 无 |
| P1-6 | OpenAI 式信任页脚 | Footer 分 4 区（产品/资源/合规/开源） | 无 |
| P1-7 | 字体光学尺寸切换 | 按尺寸 class 切换 SF Pro Display / SF Pro Text | P0-4 |

### 8.3 P2 完整补强包（5-10 个工作日，全量 v3 落地）

**目标**：完成 v2 §5 + v3 §4.11 全部补强，达到 Apple/Linear 级视觉冲击力。

包含 v2 §5.1-§5.14 全部 14 项 + v3 P0 + P1 + 以下：

| # | 补强项 | 实施方式 |
|---|--------|---------|
| P2-1 | 章节二元节奏 | #FBFBFD ↔ #F5F5F7 章节交替 |
| P2-2 | Anthropic 式价值观叙事段 | Bento Grid 后追加"我们的信念"3 行价值观 + 1 段叙事 |
| P2-3 | Story-Driven Motion | 演示区动画服务"获客→内容→秩序→赞助"叙事链路 |
| P2-4 | Mesh Gradient 浅色背景 | Hero 背景 radial-gradient 多层叠加（非 blur） |
| P2-5 | 滚动进度条 | fixed top:0 渐变进度条 |

### 8.4 MVP 路径建议

```
推荐路径: P0 (1-2 日) → 浏览器验证 → 用户反馈
         ↓ 满意
         P1 (3-5 日) → 浏览器验证 → 用户反馈
         ↓ 满意
         P2 (5-10 日) → 全量 v3 落地
         ↓ 不满意
         回退到 P0 + 调整方向
```

**关键决策点**：P0 完成后必须做浏览器验证 + 用户反馈，再决定是否进入 P1。避免一次性投入 P2 全量重构后才发现方向偏差。

---

## 9. v3 调研对象清单补充

### 9.1 新兴独角兽/AI 独角兽（v3 新增 10 家）

| 企业 | 类型 | 调研维度 | 关键借鉴 |
|------|------|---------|---------|
| **OpenAI** | AI 独角兽 | 导航结构、信任页脚、极简排版 | 信任页脚分区、Research/API 分离 |
| **Anthropic** | AI 独角兽 | 价值观叙事、友好语调、安全信号 | "我们的信念"段、安全/可理解信号 |
| **Runway ML** | AI 独角兽 | 视频优先、色块设计、强 CTA | 自动演示区色块叙事 |
| **Mistral AI** | 欧洲 AI 独角兽 | 开源定位、多语言、模型矩阵 | Pack 矩阵视觉锤对标 |
| **Cursor (Anysphere)** | AI 编辑器独角兽 | 产品 UI 即 Hero、ICP 命名 | Hero mockup + 角色场景化命名 |
| **Linear** | 开发者 SaaS 标杆 | Bento Grid、Dark Premium、章节编号 | Bento Grid + 章节编号 |
| **Vercel** | 基础设施 SaaS | Mesh Gradient、交互演示 | 浅色版 Mesh Gradient |
| **Raycast** | 开发者工具 | Glow CTA、Dark Premium | Glow CTA 多层光晕 |
| **Loom** | 视频工具 SaaS | 产品在用中展示 | 演示区"产品在用"截图 |
| **Posthog** | 产品分析 SaaS | Dense product screens | Bento 卡片高密度截图 |

### 9.2 设计趋势资源（v3 新增）

| 资源 | 关键发现 |
|------|---------|
| **Apple Newsroom 2025-06-09** | Liquid Glass 材质（2025 WWDC），CSS 模拟方案 |
| **Apple.com Design System (soulcore-dev)** | Apple DNA 7 维度深度提取 |
| **Figma Resource Library 2026** | 13 大趋势 + 4 大 AI 趋势 |
| **Wix Blog 2026 Web Design Trends** | 11 大趋势（Nature distilled/Tactile maximalism/Exaggerated hierarchy 等） |
| **Elementor 2026 Inspiration** | 19 大灵感源（New Minimalism/Asymmetrical Grids/Dynamic Scrolling 等） |
| **GraphicDesignJunction 2026** | 15 大趋势（Barely-There UI/Soft Maximalism/Story-Driven Motion 等） |
| **Designkey Studio SaaS Patterns** | 12 大转化模式（Dense product screens/Logo bar/ICP pricing 等） |
| **Pravinkumar Bento Grids 2026** | Bento Box Hero 替代双栏的扫描行为学论证 |
| **Framiq 20+ SaaS Landing 2026** | 5 大模式（Product-first/Bento grid/Screenshots as proof/Dark default/Minimal nav） |

### 9.3 关键参照系升级（v2 → v3）

| 维度 | v2 参照 | v3 升级参照 |
|------|---------|------------|
| 产品 UI 即 Hero | shadcn/Cal.com | + Cursor（编辑器截图直接首屏） |
| Bento Grid | Clerk/Notion | + Apple/Linear/Bolt（非对称 Tier 分区） |
| 自动模拟演示 | Stripe/Resend | + Runway ML（色块+视频优先） |
| 信任锚 | Stripe/Crafty | + OpenAI/Anthropic（数据可视化+价值观叙事） |
| 视觉冲击力 | 无 | + Mistral/Anthropic（Text-as-Hero 大字） |
| Apple DNA | 仅色彩 | + 7 维度（二元节奏/光学尺寸/负字距/Pill CTA/diffuse shadow/Liquid Glass/Product-as-Hero） |
| 滚动叙事 | 无 | + Apple/Stripe（CSS Scroll-Driven） |
| ICP 命名 | 无 | + Resend/Linear/Cursor（场景化角色） |

---

## 10. v3 待确认事项（补充 v2 §6）

v2 §6 已列 7 项，v3 补充以下 5 项：

1. **Bento Box Hero 是否过度激进**：v2 双栏 Hero 已经过用户认可，是否冒险改为 Bento Box？建议先做 P0 补强（CSS 升级）验证，再决定是否进入 P1（Bento Box 结构性变更）
2. **Apple Liquid Glass 模拟深度**：用 radial-gradient + box-shadow 复合模拟，还是直接放弃玻璃材质？后者更安全但失去 2025 WWDC 现代感
3. **渐变文字 Hero 是否符合苹果风**：Apple.com 官方未用渐变文字，但 Mistral/Linear/Resend 都在用。GSP 是否采用？
4. **ICP 命名重命名是否影响现有用户认知**："服主/玩家/Demo"已被 v4.16.0 部署，重命名为"社区服主/玩家公会/Demo 演示"是否造成回访用户困惑？
5. **P0/P1/P2 分级路径是否接受**：用户是否接受先 P0 验证再 P1/P2 的渐进路径？还是要求一次性全量 v3 落地？

---
