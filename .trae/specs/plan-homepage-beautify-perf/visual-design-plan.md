# 主页视觉设计方案 (Homepage Visual Design Plan)

> 本文件是 `plan-homepage-beautify-perf` 的视觉设计子方案，仅产出规范，不修改任何代码。
> 继承自全局设计系统 `frontend-comprehensive-ui-polish`，全局令牌定义在 `frontend/src/index.css :root`。

## 工程过程

- 已完整阅读：`Home.tsx`(1424 行)、`landing2.css`(2529 行)、`index.css`(:root 令牌)、`frontend-comprehensive-ui-polish/spec.md`、`plan-homepage-beautify-perf/spec.md`。
- 已用全量扫描（`#[0-9a-fA-F]{3,8}` + `rgba?\(`）覆盖 Home.tsx 与 landing2.css 的所有硬编码颜色，共定位 33 行 hex + 67 行 rgba。
- 产出本方案 7 章节，未修改任何代码文件。

## 交接状态

- 当前 task：视觉设计方案文档化。状态：**已闭合**。
- 后续接续入口：进入 `/apply` 阶段时，按本方案 §2 映射表替换硬编码颜色、按 §3 留白规范调整区块、按 §4 统一视觉元素、按 §5 响应式断点策略、按 §6 内联 style 迁移建议处理。

## 最终结果

- 产出物：本文件 `visual-design-plan.md`。
- 验证结论：7 章节齐备且数值具体；令牌层继承全局不重定义主色；映射表覆盖 Home.tsx 与 landing2.css 全部硬编码颜色；与 `frontend-comprehensive-ui-polish` 边界清晰（§7）。

---

## 1. 主页专属设计令牌层

### 1.1 继承声明

主页令牌层**不重新定义**全局主色 `#f97316` 与辅助色 `#06b6d4`。以下全局令牌直接引用、不在本层重写：

| 全局令牌 | 值（index.css :root） | 主页用途 |
|----------|----------------------|---------|
| `--primary` / `--primary-hover` / `--primary-light` / `--primary-dark` | `#f97316` / `#ea580c` / `#fb923c` / `#c2410c` | 橙色主色、按钮、强调 |
| `--primary-dim` / `--primary-glow` / `--primary-glow-strong` | `rgba(249,115,22,0.12/0.2/0.45)` | 暗底背景、光晕 |
| `--info` / `--info-hover` / `--info-light` | `#06b6d4` / `#0891b2` / `#22d3ee` | 青色辅助、信息类 |
| `--info-dim` / `--info-glow` / `--info-bg` / `--info-border` | `rgba(6,182,212,0.15/0.2/0.12/0.35)` | 信息类背景/边框 |
| `--success` / `--success-bg` / `--success-border` | `#22c55e` / `rgba(34,197,94,0.12/0.35)` | 运行态、绿色模块 |
| `--danger` / `--danger-bg` / `--danger-border` | `#ef4444` / `rgba(239,68,68,0.12/0.35)` | 痛点、监控、红色模块 |
| `--warning` / `--warning-bg` / `--warning-border` | `#f59e0b` / `rgba(245,158,11,0.12/0.35)` | 黄色装饰点 |
| `--purple` / `--purple-bg` / `--purple-border` | `#a855f7` / `rgba(168,85,247,0.12/0.35)` | 紫色模块（聊天/社区服） |
| `--bg-base` / `--bg-surface` / `--bg-surface-elevated` / `--bg-overlay` / `--bg-hover` | `#0f1117` / `#1a1d27` / `#242836` / `#2e3348` / `#2a2f3e` | 背景三级层次 |
| `--border` / `--border-strong` / `--border-subtle` | `#2e3348` / `#3e4458` / `rgba(255,255,255,0.06)` | 边框三级 |
| `--text-primary` / `--text-secondary` / `--text-muted` | `#e8eaed` / `#9ca3b8` / `#6b7280` | 文字三级 |
| `--radius-sm/md/lg/xl/2xl/full` | `6/8/12/16/20/9999px` | 圆角系统 |
| `--shadow-xs ~ 2xl` / `--shadow-glow` 系列 | 见 index.css | 阴影系统 |
| `--ease-out` / `--transition-fast/base/slow` | `cubic-bezier(0.16,1,0.3,1)` / `0.12s/0.2s/0.3s` | 过渡 |

### 1.2 主页特有变量

作用域限定在 `.landing2-page` 选择器下，避免污染后台/dashboard 样式（与 landing2.css 现有 `landing2-*` 前缀隔离策略一致）。

```css
.landing2-page {
  /* ===== 渐变变量 ===== */
  --home-gradient-text: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 40%, var(--info) 100%);
  --home-gradient-page-bg: radial-gradient(ellipse at 20% 0%, rgba(249,115,22,0.08), transparent 45%),
                           radial-gradient(ellipse at 80% 100%, rgba(6,182,212,0.06), transparent 45%);
  --home-gradient-section-accent: linear-gradient(135deg, var(--primary), var(--info));
  --home-gradient-stat-topbar: linear-gradient(90deg, var(--primary), var(--info));
  --home-gradient-chart-orange: linear-gradient(180deg, var(--primary), rgba(249,115,22,0.25));
  --home-gradient-chart-cyan: linear-gradient(180deg, var(--info), rgba(6,182,212,0.2));
  --home-gradient-timeline-rail: linear-gradient(180deg, var(--primary), var(--info));
  --home-gradient-big-number: linear-gradient(135deg, var(--primary), var(--info));
  --home-gradient-btn-primary: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
  --home-gradient-connector: linear-gradient(90deg, var(--border-strong), var(--primary));
  --home-gradient-grid-line: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px);
  --home-gradient-shimmer: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.04) 50%, transparent 60%);
  --home-gradient-deploy-card: linear-gradient(145deg, var(--bg-surface), var(--bg-surface-elevated));

  /* ===== 光晕变量 ===== */
  --home-glow-hero: radial-gradient(circle, rgba(249,115,22,0.14), transparent 65%);
  --home-glow-stats-left: radial-gradient(ellipse at 20% 50%, rgba(249,115,22,0.05), transparent 50%);
  --home-glow-stats-right: radial-gradient(ellipse at 80% 50%, rgba(6,182,212,0.05), transparent 50%);
  --home-glow-features-top: radial-gradient(ellipse, rgba(249,115,22,0.06), transparent 70%);
  --home-glow-demo-center: radial-gradient(ellipse, rgba(6,182,212,0.08), transparent 60%);
  --home-glow-deploy: radial-gradient(ellipse, rgba(249,115,22,0.12), rgba(6,182,212,0.06), transparent 65%);
  --home-glow-preview-window: 0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04), 0 0 80px rgba(249,115,22,0.08);
  --home-glow-card-orange: 0 16px 40px rgba(0,0,0,0.35), 0 0 24px var(--primary-glow);
  --home-glow-card-red: 0 14px 36px rgba(0,0,0,0.35), 0 0 24px rgba(239,68,68,0.1);
  --home-glow-card-uc: 0 18px 42px rgba(0,0,0,0.35), 0 0 30px color-mix(in srgb, var(--uc-color, var(--primary)) 15%, transparent);

  /* 粒子专用（canvas fillStyle/strokeStyle 无法直接读 CSS 变量，需 JS 读取 getComputedStyle 或硬编码此处集中管理） */
  --home-particle-fill: rgba(249,115,22,0.5);
  --home-particle-line-base: rgba(249,115,22,0.12);

  /* ===== 玻璃态变量 ===== */
  --home-glass-navbar: rgba(15,17,23,0.55);
  --home-glass-navbar-scrolled: rgba(15,17,23,0.92);
  --home-glass-mobile-overlay: rgba(15,17,23,0.97);
  --home-blur-navbar: 14px;
  --home-blur-mobile: 20px;

  /* ===== 装饰色变量（6 种功能模块色，统一映射） =====
     映射关系：
       橙 = 实例 / P1 / 个人私服 / CPU
       绿 = 存档 / P2 / 运行中 / 内存
       青 = Mod / P3 / 多实例 / 在线玩家
       紫 = 聊天 / P4 / 社区服 / 运行时长
       红 = 监控 / 痛点
       粉 = 商城
     ⚠ 关键修正：Home.tsx 中 #8b5cf6 与 landing2.css 中 #a855f7 存在漂移，
        本方案统一为全局 --purple (#a855f7)，消除漂移。 */
  --home-mod-orange: var(--primary);
  --home-mod-green: var(--success);
  --home-mod-cyan: var(--info);
  --home-mod-purple: var(--purple);          /* 统一：原 #8b5cf6 → #a855f7 */
  --home-mod-red: var(--danger);
  --home-mod-pink: #ec4899;                  /* 全局无 pink，主页新增 */

  /* light 变体（暗底文字用，保证 WCAG AA 对比度 ≥ 4.5:1） */
  --home-mod-orange-light: var(--primary-light);  /* #fb923c */
  --home-mod-green-light: #4ade80;
  --home-mod-cyan-light: var(--info-light);        /* #22d3ee */
  --home-mod-purple-light: #c084fc;
  --home-mod-red-light: #f87171;
  --home-mod-pink-light: #f472b6;

  /* dim 背景变体（tag / icon 容器背景） */
  --home-mod-orange-dim: var(--primary-dim);
  --home-mod-green-dim: var(--success-bg);
  --home-mod-cyan-dim: var(--info-bg);
  --home-mod-purple-dim: var(--purple-bg);
  --home-mod-red-dim: var(--danger-bg);
  --home-mod-pink-dim: rgba(236,72,153,0.12);

  /* border 变体（hover / active 边框） */
  --home-mod-orange-border: rgba(249,115,22,0.35);
  --home-mod-green-border: var(--success-border);
  --home-mod-cyan-border: var(--info-border);
  --home-mod-purple-border: var(--purple-border);
  --home-mod-red-border: var(--danger-border);
  --home-mod-pink-border: rgba(236,72,153,0.35);

  /* ===== 文字/遮罩变量 ===== */
  --home-text-on-accent: #000;              /* 主色按钮、chat-phase-badge 上的文字 */
  --home-overlay-white-2: rgba(255,255,255,0.02);
  --home-overlay-white-3: rgba(255,255,255,0.03);
  --home-overlay-white-4: rgba(255,255,255,0.04);
  --home-overlay-white-5: rgba(255,255,255,0.05);
  --home-shadow-window-lg: 0 20px 50px rgba(0,0,0,0.35);
  --home-shadow-window-xl: 0 28px 60px rgba(0,0,0,0.45);
  --home-shadow-window-2xl: 0 24px 48px rgba(0,0,0,0.4);
  --home-shadow-window-mega: 0 32px 64px rgba(0,0,0,0.5);
}
```

---

## 2. 硬编码颜色 → CSS 变量映射表

### 2.1 Home.tsx 硬编码颜色

| 位置（文件:行） | 当前硬编码值 | 替换为的 CSS 变量 | 备注 |
|----|----|----|----|
| Home.tsx:111 (FEATURE_TABS instances) | `#f97316` | `var(--home-mod-orange)` | 数据常量色，建议改为 CSS 变量名引用 |
| Home.tsx:123 (FEATURE_TABS saves) | `#22c55e` | `var(--home-mod-green)` | 同上 |
| Home.tsx:135 (FEATURE_TABS mods) | `#06b6d4` | `var(--home-mod-cyan)` | 同上 |
| Home.tsx:147 (FEATURE_TABS chat) | `#8b5cf6` | `var(--home-mod-purple)` | ⚠ 漂移修正：#8b5cf6 → #a855f7 |
| Home.tsx:160 (FEATURE_TABS monitor) | `#ef4444` | `var(--home-mod-red)` | 同上 |
| Home.tsx:172 (FEATURE_TABS shop) | `#ec4899` | `var(--home-mod-pink)` | 同上 |
| Home.tsx:189 (CHAT_PHASES P1) | `#f97316` | `var(--home-mod-orange)` | 同上 |
| Home.tsx:197 (CHAT_PHASES P2) | `#22c55e` | `var(--home-mod-green)` | 同上 |
| Home.tsx:205 (CHAT_PHASES P3) | `#06b6d4` | `var(--home-mod-cyan)` | 同上 |
| Home.tsx:213 (CHAT_PHASES P4) | `#8b5cf6` | `var(--home-mod-purple)` | ⚠ 漂移修正 |
| Home.tsx:235 (USE_CASES 个人私服) | `#f97316` | `var(--home-mod-orange)` | 同上 |
| Home.tsx:241 (USE_CASES 社区服) | `#8b5cf6` | `var(--home-mod-purple)` | ⚠ 漂移修正 |
| Home.tsx:247 (USE_CASES 多实例) | `#06b6d4` | `var(--home-mod-cyan)` | 同上 |
| Home.tsx:725 (Hero preview cards 第1个) | `#f97316` | `var(--home-mod-orange)` | 内联 `${c}22` 用 color-mix 或 rgba 变量 |
| Home.tsx:725 (Hero preview cards 第2个) | `#22c55e` | `var(--home-mod-green)` | 同上 |
| Home.tsx:725 (Hero preview cards 第3个) | `#06b6d4` | `var(--home-mod-cyan)` | 同上 |
| Home.tsx:727 (preview-card-icon bg) | `${c}22`（动态拼接） | `color-mix(in srgb, var(--card-color) 13%, transparent)` | 迁移到 className，color 由 `--card-color` 注入 |
| Home.tsx:727 (preview-card-icon color) | `c`（动态） | `var(--card-color)` | 同上 |
| Home.tsx:939 (instance-dot active) | `#22c55e` | `var(--home-mod-green)` | 改为 className 修饰符 |
| Home.tsx:939 (instance-dot inactive) | `#6b7280` | `var(--text-muted)` | 已与全局令牌值一致 |
| Home.tsx:1035 (LiveDemo CPU) | `#f97316` | `var(--home-mod-orange)` | 数据常量色 |
| Home.tsx:1036 (LiveDemo 内存) | `#22c55e` | `var(--home-mod-green)` | 同上 |
| Home.tsx:1037 (LiveDemo 在线玩家) | `#06b6d4` | `var(--home-mod-cyan)` | 同上 |
| Home.tsx:1038 (LiveDemo 运行时长) | `#8b5cf6` | `var(--home-mod-purple)` | ⚠ 漂移修正 |
| Home.tsx:548 (ParticleBackground fillStyle) | `rgba(249,115,22,0.5)` | `var(--home-particle-fill)` | canvas 需 JS 读 getComputedStyle |
| Home.tsx:564 (ParticleBackground strokeStyle) | `rgba(249,115,22,${0.12*(1-d/140)})` | 基于 `var(--home-particle-line-base)` 用 JS 计算 alpha | 保留 JS 动态 alpha，base 色走变量 |

### 2.2 landing2.css 硬编码 hex 颜色

| 位置（行） | 当前硬编码值 | 替换为的 CSS 变量 | 备注 |
|----|----|----|----|
| :61 (.landing2-text-red) | `#ef4444` | `var(--danger)` | 文本辅助色 |
| :62 (.landing2-text-cyan) | `#06b6d4` | `var(--info)` | 同上 |
| :63 (.landing2-text-green) | `#22c55e` | `var(--success)` | 同上 |
| :65 (.landing2-text-purple) | `#a855f7` | `var(--purple)` | 已与全局一致，补变量引用 |
| :100, :106 (btn-primary color) | `#000` | `var(--home-text-on-accent)` | 主色按钮文字 |
| :326, :332 (nav-btn-primary color) | `#000` | `var(--home-text-on-accent)` | 同上 |
| :1550 (chat-phase-badge color) | `#000` | `var(--home-text-on-accent)` | 同上 |
| :166 (section-tag-red color) | `#f87171` | `var(--home-mod-red-light)` | 暗底文字 light 变体 |
| :172 (section-tag-cyan color) | `#22d3ee` | `var(--home-mod-cyan-light)` | = --info-light |
| :178 (section-tag-green color) | `#4ade80` | `var(--home-mod-green-light)` | 暗底文字 light 变体 |
| :184 (section-tag-purple color) | `#c084fc` | `var(--home-mod-purple-light)` | 暗底文字 light 变体 |
| :601 (preview-dot-red) | `#ef4444` | `var(--danger)` | 装饰点 |
| :602 (preview-dot-yellow) | `#f59e0b` | `var(--warning)` | 装饰点 |
| :603 (preview-dot-green) | `#22c55e` | `var(--success)` | 装饰点 |
| :963 (pain-card-glow bg) | `#ef4444` | `var(--danger)` | 光晕模糊源 |
| :983 (pain-icon color) | `#f87171` | `var(--home-mod-red-light)` | 暗底文字 |
| :1050 (terminal-dot 1) | `#ef4444` | `var(--danger)` | 装饰点 |
| :1051 (terminal-dot 2) | `#f59e0b` | `var(--warning)` | 装饰点 |
| :1052 (terminal-dot 3) | `#22c55e` | `var(--success)` | 装饰点 |
| :1074 (terminal-error color) | `#f87171` | `var(--home-mod-red-light)` | 暗底文字 |
| :1398 (demo-badge-running color) | `#4ade80` | `var(--home-mod-green-light)` | 暗底文字 |
| :1491 (demo-log-chat color) | `#c084fc` | `var(--home-mod-purple-light)` | 暗底文字 |
| :1496 (demo-log-join color) | `#4ade80` | `var(--home-mod-green-light)` | 暗底文字 |
| :1657 (compare-th-bad color) | `#f87171` | `var(--home-mod-red-light)` | 暗底文字 |
| :1663 (compare-th-good color) | `#4ade80` | `var(--home-mod-green-light)` | 暗底文字 |
| :1702 (compare-td-bad color) | `#f87171` | `var(--home-mod-red-light)` | 暗底文字 |
| :1708 (compare-td-good color) | `#4ade80` | `var(--home-mod-green-light)` | 暗底文字 |
| :2000 (version-type-feature color) | `#4ade80` | `var(--home-mod-green-light)` | 暗底文字 |
| :2005 (version-type-bugfix color) | `#22d3ee` | `var(--home-mod-cyan-light)` | 暗底文字 |
| :2456 (移动端 td-bad::before) | `#f87171` | `var(--home-mod-red-light)` | 暗底文字 |
| :2462 (移动端 td-good::before) | `#4ade80` | `var(--home-mod-green-light)` | 暗底文字 |

### 2.3 landing2.css 硬编码 rgba 颜色

| 位置（行） | 当前硬编码值 | 替换为的 CSS 变量 | 备注 |
|----|----|----|----|
| :16, :858, :1091, :1139, :1140, :1367, :1450, :2027, :2051 | `rgba(249,115,22,0.05~0.35)` | `var(--primary-dim)` / `var(--primary-glow)` / `--home-mod-orange-border` | 按透明度归并到现有橙系变量；非标透明度新增 `--home-mod-orange-border` 等 |
| :17, :859, :1282, :1299, :1450 | `rgba(6,182,212,0.05~0.2)` | `var(--info-dim)` / `var(--info-glow)` / `var(--info-bg)` | 按透明度归并到青系变量 |
| :101, :105, :327, :333 | `rgba(249,115,22,0.28/0.3/0.38/0.45)` | `var(--primary-glow)` / `var(--primary-glow-strong)` | 按钮光晕 |
| :164, :165, :952, :953, :978, :979, :1005, :1006, :1658, :1703, :1709 | `rgba(239,68,68,0.03~0.5)` | `var(--danger-bg)` / `var(--danger-border)` / 新增 `--home-danger-line: rgba(239,68,68,0.5)` | 痛点专用，0.5 透明度新增变量 |
| :170, :171, :1282 | `rgba(6,182,212,0.12/0.2/0.35)` | `var(--info-bg)` / `var(--info-border)` | 标签/图表 |
| :176, :177, :699, :1398 | `rgba(34,197,94,0.12/0.35/0.5)` | `var(--success-bg)` / `var(--success-border)` / 新增 `--home-success-glow-dot: rgba(34,197,94,0.5)` | 0.5 用于状态点光晕 |
| :182, :183, :1490 | `rgba(168,85,247,0.12/0.15/0.35)` | `var(--purple-bg)` / `var(--purple-border)` | 紫系 |
| :189 | `rgba(249,115,22,0.35)` | `var(--home-mod-orange-border)` | section-tag-orange 边框 |
| :218, :226, :2323 | `rgba(15,17,23,0.55/0.92/0.97)` | `var(--home-glass-navbar)` / `var(--home-glass-navbar-scrolled)` / `var(--home-glass-mobile-overlay)` | 玻璃态背景 |
| :119, :557, :883, :953, :1024, :1103, :1311, :1525, :1739 | `rgba(0,0,0,0.3~0.5)` | `var(--shadow-lg)` ~ `var(--shadow-2xl)` / `--home-shadow-window-*` | 阴影系统归并 |
| :424, :424 | `rgba(249,115,22,0.14)` | `var(--home-glow-hero)` | hero 光晕 |
| :436, :437, :572, :809, :1163, :1318, :1361, :1558, :1685, :1767 | `rgba(255,255,255,0.015~0.05)` | `var(--home-overlay-white-2/3/4/5)` | 白色遮罩归并到 4 档 |
| :558 | `rgba(255,255,255,0.04)` | `var(--home-overlay-white-4)` | 预览窗外发光边 |
| :699 | `rgba(34,197,94,0.5)` | `var(--home-success-glow-dot)` | 状态点光晕（新增） |
| :758 | `rgba(249,115,22,0.25)` | `var(--home-gradient-chart-orange)` | 图表渐变 |
| :1006 | `rgba(239,68,68,0.5)` | `var(--home-danger-line)` | 痛点左侧装饰线（新增） |

> **新增变量汇总**（未在 §1.2 列出的补充项）：
> - `--home-success-glow-dot: rgba(34,197,94,0.5)`（状态点光晕专用）
> - `--home-danger-line: rgba(239,68,68,0.5)`（痛点装饰左边框专用）

---

## 3. 13 个区块的信息层级与留白规范

> 数值均来自 landing2.css 现状或在本方案中明确给定；区块顺序按 Home.tsx 渲染顺序。

| # | 区块名 | 标题字号/行高/字重 | 副标题字号/行高 | 正文字号/行高 | 装饰元素 | 间距（内/外/区块间距） | 圆角 | 阴影 |
|----|----|----|----|----|----|----|----|----|
| 1 | Navbar | 17px / 1.2 / 700（brand-title） | — | 链接 14px/1.4/500；按钮 14px/1.4/600 | logo 30px + drop-shadow 12px | 内：16px 0；外：固定 top:0；滚动后 padding 10px 0 | 按钮 md(8px) | — |
| 2 | Hero | 主标题 clamp(38px,7vw,72px) / 1.08 / 800；badge 13px/1.4/600 | subtitle clamp(18px,2.5vw,26px) / 1.6 / 500 | desc 16px/1.7；trust 13px/1.5 | hero-glow blur 60px；hero-grid 70×70px；粒子 90个；预览窗 rotateX(6deg) | 内：140px 24px 100px；actions gap 16px；trust gap 18px；预览 margin-top 64px | 预览 xl(16px) | 预览 `--home-glow-preview-window` |
| 3 | LogoCloud | label 12px/1.4/600 | — | logo 14px/1.4/600 | marquee 28s linear | 内：50px 0；track gap 40px；item padding 8px 18px | item full(9999px) | — |
| 4 | Stats | stat-value 38px/1.1/800；label 14px/1.4/500 | — | — | ::before 双色径向光晕；卡片顶部 3px 渐变条 | 内：100px 0；grid gap 20px；卡片 32px 20px；icon margin-bottom 16px | 卡片 xl(16px)；icon lg(12px) | hover `--home-glow-card-orange` |
| 5 | PainPoints | section-title clamp(30px,5vw,46px)/1.15/800；tag 12px/1.4/700 | section-desc 16px/1.7 | pain-title 18px/1.3/700；pain-desc 14px/1.6；pain-detail 12px/1.6 斜体 | card-glow blur 80px（hover opacity 0.1）；terminal 窗口 | 内：120px 0；grid gap 20px；grid margin-bottom 48px；卡片 28px 24px 24px；icon 52px margin-bottom 18px | 卡片 xl(16px)；icon lg(12px)；terminal xl(16px) | hover `--home-glow-card-red`；terminal `--home-shadow-window-2xl` |
| 6 | FeatureShowcase | section-title clamp(30px,5vw,46px)/1.15/800；tab 14px/1.4/500；panel-title 26px/1.3/700 | — | panel-desc 15px/1.7；list 14px/1.6 | showcase ::before 顶部径向光晕；面板图标 56px | 内：120px 0；showcase grid 260px 1fr gap 24px；showcase padding 24px；panel grid 1fr 1fr gap 28px min-h 360px；tab gap 8px padding 12px 14px；list gap 10px | showcase xl(16px)；tab md(8px)；panel-icon lg(12px)；visual lg(12px) | showcase `--home-shadow-window-lg` |
| 7 | LiveDemo | section-title clamp(30px,5vw,46px)/1.15/800；topbar h3 18px/1.3/700；metric-value 24px/1.1/800 | — | metric-label 12px/1.4；chart-title 12px；log 12px/1.6 | demo-glow blur 40px；shimmer 4s；chart 40 柱 | 内：120px 0；window grid 180px 1fr；main padding 24px gap 20px；metrics grid 4 gap 14px；metric padding 16px | window xl(16px)；metric lg(12px)；chart lg(12px)；log lg(12px)；tag 4px | window `--home-shadow-window-xl` |
| 8 | ChatJourney | section-title clamp(30px,5vw,46px)/1.15/800；phase-title 17px/1.3/700；badge 11px/1.2/800 | — | phase-desc 13px/1.6；version 11px 等宽 | connector 20×2px 渐变；phase-icon 52px；badge 绝对定位 top -12px | 内：120px 0；timeline grid 4 gap 20px；卡片 28px 22px；icon margin 12px auto 16px | 卡片 xl(16px)；badge full(9999px)；icon lg(12px) | hover translateY(-6px) + `--home-shadow-window-lg` |
| 9 | Comparison | section-title clamp(30px,5vw,46px)/1.15/800；big-number 52px/1.1/800；th 14px/1.4/700；td 14px/1.5 | — | big-label 14px/1.4 | big-number 渐变文字；表格行 hover | 内：120px 0；big grid 3 gap 20px margin-bottom 48px；big-item 36px 20px；th/td padding 18px 20px / 14px 20px | table-wrap xl(16px)；big-item xl(16px) | — |
| 10 | UseCases | section-title clamp(30px,5vw,46px)/1.15/800；uc-title 20px/1.3/700 | — | uc-desc 14px/1.7 | usecase-glow blur 80px（hover 0.12）；icon 56px | 内：120px 0；grid 3 gap 20px；卡片 32px 26px；icon margin-bottom 18px | 卡片 xl(16px)；icon lg(12px) | hover translateY(-6px) + `--home-glow-card-uc` |
| 11 | TechStack | section-title clamp(30px,5vw,46px)/1.15/800；layer-name 14px/1.4/700 | — | feature 13px/1.5；chip 12px/1.4 等宽 | orbit 260px 圆环 40s 旋转；中心 80px 反向旋转；9 个轨道项 | 内：120px 0；content grid 280px 1fr gap 40px margin-bottom 40px；layers gap 14px；layer 18px 22px；features grid 4 gap 16px；feature padding 16px | orbit full；layer lg(12px)；chip md(8px)；feature lg(12px) | orbit 中心 `--shadow-glow` |
| 12 | VersionTimeline | section-title clamp(30px,5vw,46px)/1.15/800；version-title 15px/1.4/600；number 15px 等宽 700 | — | date 12px/1.4；type 11px/1.2/700 | 时间轴 left:18px 2px 渐变轨；dot 16px + glow；卡片左 padding 54px | 内：120px 0；timeline max-w 800px；item padding-left 54px padding-bottom 28px；content 18px 20px；meta gap 10px | content lg(12px)；dot full；type full | dot `--shadow-glow` |
| 13 | DeployCTA | deploy-title clamp(26px,4vw,38px)/1.2/800 | — | deploy-desc 15px/1.7；command code 12px 等宽 | deploy-glow blur 50px；icon 72px 圆形 | 内：120px 0；content max-w 720px padding 56px 40px；icon margin-bottom 20px；desc margin-bottom 28px；command padding 14px 16px margin-bottom 12px；actions gap 14px | content 2xl(20px)；icon full；command lg(12px)；copy md(8px) | content `--shadow-2xl` |
| 14 | Footer | footer-logo 18px/1.3/700；h4 13px/0.08em/700 大写 | — | desc 14px/1.7；link 14px/1.5；bottom 13px/1.5 | logo drop-shadow 8px；social 36×36 | 内：64px 0 28px；grid 2fr 1fr 1fr 1fr gap 40px margin-bottom 48px；column link margin-bottom 10px；bottom padding-top 24px | social md(8px) | — |

> **字号系统总结**（对齐 frontend-comprehensive-ui-polish AC-2 六级层级）：
> - L1 巨型数字：52px（compare-big-number）
> - L2 Hero 主标题：clamp(38~72px)
> - L3 区块标题：clamp(30~46px) / 800
> - L4 卡片标题：17~26px / 700
> - L5 正文/数值：14~15px
> - L6 辅助/标签：11~13px
>
> **行高系统**：标题 1.08~1.2；正文 1.6~1.7；标签 1.2~1.4。
>
> **间距节奏**：区块垂直内边距统一 120px（LogoCloud 50px、Hero 140/100、Footer 64/28 例外）；卡片内边距 18~32px；grid gap 主流 20px（特例：demo-metrics 14px、stack-features 16px、footer 40px）。

---

## 4. 统一视觉元素系统规范

### 4.1 卡片变体

| 变体 | 圆角 | 边框 | 内边距 | hover 反馈 | 背景 | 代表 class |
|----|----|----|----|----|----|----|
| 普通卡片 | xl(16px) | 1px solid var(--border) | 18px 20px | border→var(--primary)；translateX(4px) | var(--bg-surface) | `.landing2-version-content` `.landing2-stack-layer` `.landing2-stack-feature` |
| 统计卡片 | xl(16px) | 1px solid var(--border) | 32px 20px | translateY(-5px)；border→var(--primary)；glow `--home-glow-card-orange`；顶部 3px 渐变条 | var(--bg-surface) | `.landing2-stat-card` |
| 痛点卡片 | xl(16px) | 1px solid var(--border) | 28px 24px 24px | translateY(-4px)；border→`var(--home-mod-red-border)`；glow `--home-glow-card-red`；右下角 glow blur 80px opacity 0→0.1 | var(--bg-surface) | `.landing2-pain-card` |
| 用例卡片 | xl(16px) | 1px solid var(--border) | 32px 26px | translateY(-6px)；border→`var(--uc-color)`；glow `--home-glow-card-uc`；右上角 glow blur 80px opacity 0→0.12 | var(--bg-surface) | `.landing2-usecase-card` |
| 功能面板卡片 | xl(16px) | 1px solid var(--border) | 24px（容器） | 容器无 hover；内部 tab 有 hover | var(--bg-surface)；内部 visual 用 var(--bg-base) | `.landing2-feature-showcase` |
| 聊天阶段卡片 | xl(16px) | 1px solid var(--border) | 28px 22px | translateY(-6px)；border→var(--border-strong)；glow `--home-shadow-window-lg`；顶部 badge 绝对定位 | var(--bg-surface) | `.landing2-chat-phase` |
| 大数字卡片 | xl(16px) | 1px solid var(--border) | 36px 20px | 无 hover | var(--bg-surface) | `.landing2-compare-big-item` |
| 部署卡片 | 2xl(20px) | 1px solid var(--border) | 56px 40px | 无 hover（终端卡片） | `--home-gradient-deploy-card` | `.landing2-deploy-content` |

### 4.2 标签/徽章

**section-tag（5 种颜色变体）**——统一规范：`padding: 6px 14px; border-radius: var(--radius-full); font-size: 12px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 18px;`

| 变体 | 背景 | 边框 | 文字色 | 用途 |
|----|----|----|----|----|
| 默认（青） | `var(--info-dim)` | `var(--info-border)` | `var(--info-light)` | 通用 |
| red | `var(--danger-bg)` | `var(--danger-border)` | `var(--home-mod-red-light)` | 痛点 |
| cyan | `var(--info-bg)` | `var(--info-border)` | `var(--home-mod-cyan-light)` | 演示/对比 |
| green | `var(--success-bg)` | `var(--success-border)` | `var(--home-mod-green-light)` | 适用场景 |
| purple | `var(--purple-bg)` | `var(--purple-border)` | `var(--home-mod-purple-light)` | 聊天增强 |
| orange | `var(--primary-dim)` | `var(--home-mod-orange-border)` | `var(--primary-light)` | 版本历程 |

**version-type（2 种变体）**——统一规范：`font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: var(--radius-full);`

| 变体 | 背景 | 文字色 | 用途 |
|----|----|----|----|
| feature | `var(--success-bg)` | `var(--home-mod-green-light)` | 新功能 |
| bugfix | `var(--info-bg)` | `var(--home-mod-cyan-light)` | Bug 修复 |

**demo-log-tag（3 种变体）**——统一规范：`padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;`

| 变体 | 背景 | 文字色 |
|----|----|----|
| info | `var(--info-dim)` | `var(--info-light)` |
| chat | `var(--purple-bg)` | `var(--home-mod-purple-light)` |
| join | `var(--success-bg)` | `var(--home-mod-green-light)` |

### 4.3 按钮

**基础规范**（`.landing2-btn`）：`display: inline-flex; gap: 8px; height: 44px; padding: 0 22px; font-size: 14px; font-weight: 600; border-radius: var(--radius-lg); transition: all 0.2s var(--ease-out);` hover 统一 `transform: translateY(-2px)`。

| 变体 | 高度 | padding | 字号 | 圆角 | 背景 | 文字 | 边框 | hover |
|----|----|----|----|----|----|----|----|----|
| primary | 44px | 0 22px | 14px | lg(12px) | `--home-gradient-btn-primary` | `var(--home-text-on-accent)` | none | shadow 0→`rgba(249,115,22,0.45)` |
| secondary | 44px | 0 22px | 14px | lg(12px) | `var(--bg-surface)` | `var(--text-primary)` | 1px solid var(--border) | bg→elevated；border→strong；shadow `rgba(0,0,0,0.3)` |
| glow（修饰符） | 同基础 | — | — | inherit | 同基础 | 同基础 | — | `::before` opacity 0→0.45 blur 12px 渐变发光 |
| lg（尺寸修饰符） | 52px | 0 28px | 15px | xl(16px) | — | — | — | — |
| sm（建议新增） | 36px | 0 14px | 13px | md(8px) | — | — | — | — |
| nav-btn-primary | 38px | 0 16px | 14px | md(8px) | `var(--primary)` | `var(--home-text-on-accent)` | none | bg→hover；shadow `rgba(249,115,22,0.38)` |
| deploy-copy | 36px | 0 12px | 13px | md(8px) | `var(--bg-surface-elevated)` | `var(--text-primary)` | 1px solid var(--primary) | bg→dim；color→light |

### 4.4 装饰线条

| 装饰 | 位置 | 尺寸/形态 | 颜色/渐变 | 动画 |
|----|----|----|----|----|
| hero scroll bounce | Hero 底部 ChevronDown | 18px 图标 | `var(--text-muted)` | `landing2Bounce` 1.6s ease-in-out infinite；Y 偏移 0→6px；opacity 1→0.5 |
| chat connector | ChatJourney 卡片右侧 | 20×2px 横线 | `--home-gradient-connector`（border-strong→primary） | 无；最后一张隐藏 |
| version dot | VersionTimeline 节点 | 16×16px 圆 | bg `var(--bg-base)`；border 2px solid var(--primary)；shadow `--shadow-glow` | 无 |
| version timeline rail | 时间轴轨道 | 2px 宽竖线 | `--home-gradient-timeline-rail`；opacity 0.3 | 无 |
| stat card top bar | Stats 卡片顶部 | 3px 高横条 | `--home-gradient-stat-topbar`；opacity 0.8 | 无 |
| hero grid | Hero 背景 | 70×70px 网格 | `--home-gradient-grid-line`；mask radial | 无 |
| hero glow | Hero 左上 | 70vw 圆 blur 60px | `--home-glow-hero` | `landing2GlowPulse` 8s；opacity 0.35→0.65；scale 1→1.05 |
| preview shimmer | 预览窗/演示窗 | 全覆盖斜线 | `--home-gradient-shimmer` | `landing2Shimmer` 3.5s/4s |
| cursor blink | Typewriter 光标 | 行内 `|` | `var(--primary)` | `landing2Blink` 1s step-end |
| marquee | LogoCloud | track 平移 | — | `landing2Marquee` 28s linear（768px 降为 20s） |
| orbit spin | TechStack 轨道 | 260px 圆环 | border 1px dashed var(--border) | `landing2OrbitSpin` 40s linear；中心反向 40s |

---

## 5. 响应式断点策略

三级断点：1024 / 768 / 480（与 frontend-comprehensive-ui-polish NFR-4 一致）。

### 5.1 断点 1024px（平板横屏 / 小桌面）

**动画降级**：
- ParticleBackground 粒子数维持 90（桌面）但 mouse repulsion 距离 120→100（减轻 O(n²) 计算）。
- 3D 透视保留（rotateX 6deg）。

**布局变化**：
- `feature-showcase`：260px 1fr → 1fr（tabs 横向 flex-wrap）。
- `feature-panel`：1fr 1fr → 1fr（内容与 visual 上下堆叠）。
- `demo-window`：180px 1fr → 1fr（sidebar 横向变顶部条）。
- `chat-timeline`：repeat(4) → repeat(2)；`chat-connector` 隐藏。
- `stack-content`：280px 1fr → 1fr；`stack-features`：repeat(4) → repeat(2)。
- `footer-grid`：2fr 1fr 1fr 1fr → 1fr 1fr；brand 跨列。

**建议 @media 规则**（已有，保留并补变量化）：
```css
@media (max-width: 1024px) {
  .landing2-feature-showcase { grid-template-columns: 1fr; }
  .landing2-feature-panel { grid-template-columns: 1fr; }
  .landing2-demo-window { grid-template-columns: 1fr; }
  .landing2-demo-sidebar { flex-direction: row; flex-wrap: wrap; border-right: none; border-bottom: 1px solid var(--border); }
  .landing2-chat-timeline { grid-template-columns: repeat(2, 1fr); }
  .landing2-chat-connector { display: none; }
  .landing2-stack-content { grid-template-columns: 1fr; }
  .landing2-stack-features { grid-template-columns: repeat(2, 1fr); }
  .landing2-footer-grid { grid-template-columns: 1fr 1fr; }
  .landing2-footer-brand { grid-column: 1 / -1; max-width: 100%; }
}
```

### 5.2 断点 768px（平板竖屏 / 大手机）

**动画降级**：
- ParticleBackground 粒子数 90→40（已有 `isTouch` 判定，触屏 40）。
- 关闭 mouse repulsion（触屏不监听 mousemove）。
- `prefers-reduced-motion` 下完全停止粒子动画、scroll reveal 改为即时显示。

**区块折叠**：
- Navbar 桌面链接隐藏，启用 `.landing2-nav-mobile-overlay` 全屏遮罩（blur 20px）。

**布局变化**：
- `hero-actions`：横向 flex → 纵向 column，max-width 320px 居中。
- `hero-preview`：margin-top 64px→40px；`preview-body` 高 320→220；`preview-chart` 隐藏。
- `stats-grid` / `pain-grid` / `usecases-grid` / `compare-big` / `stack-features`：→ 1 列。
- `demo-metrics`：4 → 2 列。
- `compare-table`：thead 隐藏，行改卡片式纵向布局；`td-bad/good::before` 加"传统：/现代："前缀。
- `footer-grid`：→ 1 列。
- `deploy-content`：padding 56px 40px → 40px 24px。

**建议 @media 规则**（已有，保留）：
```css
@media (max-width: 768px) {
  .landing2-nav-links { display: none; }
  .landing2-nav-mobile-overlay { display: block; position: fixed; inset: 0; background: var(--home-glass-mobile-overlay); backdrop-filter: blur(var(--home-blur-mobile)); opacity: 0; pointer-events: none; transition: opacity 0.3s var(--ease-out); z-index: 100; }
  .landing2-nav-mobile-overlay-open { opacity: 1; pointer-events: all; }
  .landing2-nav-mobile-toggle { display: flex; z-index: 101; }
  .landing2-hero { padding: 120px 20px 80px; }
  .landing2-hero-actions { flex-direction: column; width: 100%; max-width: 320px; margin: 0 auto; }
  .landing2-preview-body { height: 220px; }
  .landing2-preview-chart { display: none; }
  .landing2-stats-grid, .landing2-pain-grid, .landing2-usecases-grid, .landing2-compare-big, .landing2-stack-features { grid-template-columns: 1fr; }
  .landing2-demo-metrics { grid-template-columns: repeat(2, 1fr); }
  .landing2-compare-thead { display: none; }
  .landing2-compare-row { display: flex; flex-direction: column; padding: 12px 14px; margin-bottom: 8px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); }
  .landing2-deploy-content { padding: 40px 24px; }
  .landing2-footer-grid { grid-template-columns: 1fr; gap: 28px; }
}
```

### 5.3 断点 480px（手机）

**动画降级**：
- ParticleBackground 粒子数 40→20（建议新增）。
- 关闭 3D 透视（`preview-window` rotateX 改为 0）。
- `orbit` 圆环 260→220px，旋转动画保留但 item 缩小（font 12→10px）。

**区块折叠**：
- **LogoCloud 建议隐藏**（装饰性 marquee 在窄屏消耗性能且信息密度低）：`display: none`。

**布局变化**：
- `container` padding 24→16px。
- `hero-title` 字号 clamp 下限 38→34px。
- `preview-body` 220→190px；`preview-sidebar` 56→42px。
- `demo-metrics` 2→2 列但 gap 14→8px，metric padding 16→12px，value 字号 24→18px。
- `chat-timeline` 2→1 列。

**建议 @media 规则**（部分已有，新增 LogoCloud 隐藏与粒子降级）：
```css
@media (max-width: 480px) {
  .landing2-container { padding: 0 16px; }
  .landing2-hero-title { font-size: 34px; }
  .landing2-preview-body { height: 190px; }
  .landing2-preview-sidebar { width: 42px; padding: 10px 4px; }
  .landing2-preview-nav-item { width: 22px; height: 22px; }
  .landing2-demo-main { padding: 16px; }
  .landing2-demo-metrics { grid-template-columns: 1fr 1fr; gap: 8px; }
  .landing2-demo-metric { padding: 12px; }
  .landing2-demo-metric-value { font-size: 18px; }
  .landing2-chat-timeline { grid-template-columns: 1fr; }
  .landing2-stack-orbit { width: 220px; height: 220px; }
  .landing2-stack-orbit-item { font-size: 10px; padding: 4px 8px; }
  /* 新增建议 */
  .landing2-logos { display: none; }              /* 装饰性 marquee 窄屏隐藏 */
  .landing2-preview-window { transform: none; }    /* 关闭 3D 透视 */
}
```

> **粒子数降级建议**（JS 侧，需配合 Home.tsx ParticleBackground）：
> - 默认桌面：90；触屏（pointer:coarse）：40；≤480px：20。
> - `prefers-reduced-motion: reduce`：粒子数 0 或完全停止 raf。

---

## 6. 内联 style 处理边界

### 6.1 Home.tsx 全部 `style={{}}` 位置清单

| # | 行号 | 所在组件 | style 内容 | 分类 | 迁移建议 |
|----|----|----|----|----|----|
| 1 | 712 | Hero preview-card-icon | `{ background: ${c}22, color: c }` | 半动态（c 来自数据常量） | 数据常量改为 CSS 变量名；className 注入 `--card-color`；CSS 用 `color-mix` |
| 2 | 741 | Hero preview-chart-bar | `{ height: previewChartHeights[i] }` | 动态值（运行时计算） | **保留**（动态百分比高度） |
| 3 | 812 | Stats stat-card | `{ transitionDelay: ${i*0.08}s }` | 动态值（索引计算） | **保留**；或改用 CSS `:nth-child` 设定固定 delay |
| 4 | 845 | PainPoints pain-card | `{ transitionDelay: ${i*0.08}s }` | 动态值 | 同上，保留或 nth-child |
| 5 | 907 | FeatureShowcase feature-tab | `{ '--tab-color': tab.color }` | CSS 变量注入（值来自数据） | **保留注入模式**；但 `tab.color` 应改为 `var(--home-mod-xxx)` |
| 6 | 915 | FeatureShowcase feature-panel | `{ '--panel-color': current.color }` | CSS 变量注入 | 同上 |
| 7 | 917 | FeatureShowcase feature-panel-icon | `{ color: current.color }` | 动态颜色 | 改为 CSS `color: var(--panel-color)`，去掉内联 |
| 8 | 925 | FeatureShowcase list CheckCircle | `{ color: current.color }` | 动态颜色 | 同上，走 `--panel-color` |
| 9 | 939 | FeatureShowcase instance-dot | `{ background: i===0 ? '#22c55e' : '#6b7280' }` | 半静态（条件二选一） | 改为 className 修饰符：`.dot-active`/`.dot-inactive`，CSS 定义颜色 |
| 10 | 971 | FeatureShowcase monitor-bar | `{ height: monitorBarHeights[i] }` | 动态值 | **保留** |
| 11 | 1041 | LiveDemo metric-value | `{ color: m.color }` | 动态颜色 | 数据常量改 CSS 变量；className 注入 `--metric-color`；CSS `color: var(--metric-color)` |
| 12 | 1051 | LiveDemo chart-bar | `{ height: demoChartHeights[i] }` | 动态值 | **保留** |
| 13 | 1085 | ChatJourney chat-phase | `{ transitionDelay: ${i*0.15}s }` | 动态值 | 保留或 nth-child |
| 14 | 1087 | ChatJourney chat-phase-badge | `{ background: phase.color }` | 动态颜色 | 走 `--phase-color` CSS 变量 |
| 15 | 1088 | ChatJourney chat-phase-icon | `{ color: phase.color }` | 动态颜色 | 同上 |
| 16 | 1167 | UseCases usecase-card | `{ transitionDelay, '--uc-color': uc.color }` | 动态 delay + CSS 变量注入 | delay 保留；`uc.color` 改为 `var(--home-mod-xxx)` |
| 17 | 1207 | TechStack orbit-item | `{ left, top, animationDelay }` | 动态位置 + 动态 delay | **保留**（三角函数计算位置） |
| 18 | 1216 | TechStack stack-layer | `{ transitionDelay: ${i*0.1}s }` | 动态值 | 保留或 nth-child |
| 19 | 1236 | TechStack stack-feature | `{ transitionDelay: ${i*0.08}s }` | 动态值 | 保留或 nth-child |
| 20 | 1268 | VersionTimeline version-item | `{ transitionDelay: ${Math.min(i*0.04,0.32)}s }` | 动态值（含 min 截断） | **保留**（有 min 截断逻辑，nth-child 难以表达） |

### 6.2 分类汇总

- **动态值（保留，共 9 处）**：#2 #3 #4 #10 #12 #13 #16(delay部分) #17 #18 #19 #20 —— 运行时计算的高度/位置/delay，符合全局 AC-10"动态计算值保留"原则。
- **CSS 变量注入模式（保留模式，值需变量化，共 4 处）**：#5 #6 #14 #16(uc-color部分) —— `--tab-color`/`--panel-color`/`--phase-color`/`--uc-color` 注入是合理模式，但注入的值必须从硬编码 hex 改为 `var(--home-mod-xxx)`。
- **可迁出到 className/CSS（共 5 处）**：#1 #7 #8 #9 #11 #15 —— 这些是颜色绑定，应改为通过已注入的 CSS 变量在 CSS 中引用，或改为 className 修饰符。

### 6.3 迁移原则

1. **数据常量层**（FEATURE_TABS / CHAT_PHASES / USE_CASES / LiveDemo metrics）：把 `color: '#xxxxxx'` 改为 `color: 'var(--home-mod-xxx)'`，从源头消除硬编码。
2. **颜色注入层**：保留 `style={{ '--xxx-color': tab.color }}` 注入模式，但值已是变量引用。
3. **CSS 消费层**：CSS 中 `color: var(--xxx-color)` 消费，不再在 JSX 内联 `color: xxx`。
4. **条件静态色**（#9）：改为 className 修饰符，CSS 定义两种状态色。
5. **动态数值**（height/delay/position）：保留内联，符合 AC-10。

---

## 7. 与 frontend-comprehensive-ui-polish 的边界

### 7.1 职责边界

| 维度 | frontend-comprehensive-ui-polish | 本方案（plan-homepage-beautify-perf/视觉） |
|----|----|----|
| 作用范围 | 全局所有页面（dashboard、登录、控制台、Config、Logs、Saves 等 20 页） | 仅 `/home` 公开首页（landing page） |
| 令牌层 | 定义全局 `:root` 令牌（主色/青色/功能色/背景/圆角/阴影/过渡） | 仅定义 `.landing2-page` 作用域内的主页特有变量（渐变/光晕/玻璃态/6 模块装饰色） |
| 主色定义 | **唯一权威**：定义 `--primary` `--info` 等 | **不重新定义**，仅引用 |
| 组件覆盖 | 侧边栏、按钮、卡片、表格、表单、Modal、Tag、Badge 等通用组件 | landing2 前缀的首页专属组件（hero、particle、preview、terminal、version-timeline、deploy 等） |
| 文件 | `index.css` 及各页面 CSS | `landing2.css` + `Home.tsx` 内联样式 |

### 7.2 无冲突检查项

- [x] **主色不冲突**：本方案不重新定义 `--primary`/`--info`，所有橙青色引用全局令牌。
- [x] **圆角不冲突**：本方案沿用全局 `--radius-sm/md/lg/xl/2xl/full`，未引入新圆角值。
- [x] **阴影不冲突**：本方案引用全局 `--shadow-*`，仅新增 `--home-shadow-window-*` 用于首页特有的大窗口阴影（命名带 `--home-` 前缀，不污染全局）。
- [x] **作用域隔离**：主页变量限定在 `.landing2-page` 选择器下，class 前缀统一 `landing2-*`，与后台 dashboard 样式物理隔离（landing2.css 已声明"避免污染后台样式"）。
- [x] **紫色漂移修正**：本方案将 Home.tsx 的 `#8b5cf6` 统一为全局 `--purple`(#a855f7)，消除与 landing2.css 的 `#a855f7` 漂移，使全局紫色唯一。
- [x] **新增粉色不冲突**：`--home-mod-pink: #ec4899` 为首页商城模块新增，带 `--home-` 前缀，仅首页使用，不进入全局令牌。
- [x] **响应式断点一致**：本方案 1024/768/480 与全局 NFR-4 一致，未引入新断点。
- [x] **字号层级对齐**：本方案 §3 字号系统对齐 frontend-comprehensive-ui-polish AC-2 的六级层级（24/16/28/14/12/11px 基准），未引入冲突字号。
- [x] **内联 style 边界一致**：本方案 §6 迁移原则与全局 AC-10 一致——动态值保留、静态色迁出。

### 7.3 不可越界项

- 本方案**不得**修改 `index.css :root` 全局令牌（如需新增全局色，须走 frontend-comprehensive-ui-polish 流程）。
- 本方案**不得**修改 dashboard / 登录 / 控制台等其他页面的样式。
- 本方案**不得**重新定义 `--primary` `--info` `--success` `--danger` `--warning` `--purple` 等全局色值。
- 主页专属变量必须带 `--home-` 前缀，作用域限定 `.landing2-page`。
