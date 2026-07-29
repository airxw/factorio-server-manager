# 主页性能优化方案 (Homepage Performance Plan)

> 本文件是 `spec.md` 中"主页性能优化方案文档化"需求的产出物之一，覆盖代码分割、Vite 构建优化、资源加载、**动画与视觉效果增强**、性能评估标准、`vite.config.ts` 改动边界共 6 个维度。**本阶段只制定方案，不修改任何代码文件**（Home.tsx / landing2.css / vite.config.ts 均不动）。
>
> **方向声明**：性能优化的目标不是"牺牲视觉换性能"或"减少动画/降级效果"，而是**让页面更丝滑、更流畅、行云流水**——在保证性能预算的前提下，**增加**粒子、增强动画、增加微交互，让首页呈现"高质感、灵动感、沉浸感"的视觉体验。降级只在两种情况下出现：① 无障碍辅助路径（prefers-reduced-motion 用户）；② 极低端设备的能力兜底。主流用户体验是**增强**，不是降级。

---

## 工程过程（三段交接 · 段一）

| # | 步骤 | 结论 |
|---|------|------|
| 1 | 阅读 `frontend/src/pages/Home.tsx`（1424 行） | 摸清 13 个区块、ParticleBackground（PC 默认 90 粒子 + O(n²) 连线 + 鼠标排斥，L493-614）、Typewriter、3D 透视（perspective 1200px + rotateX 6deg）、40s 轨道动画、6 个 IntersectionObserver / 1 个 MutationObserver（60ms 防抖） |
| 2 | 阅读 `frontend/vite.config.ts` | 仅 `server.proxy` + `server.port`，无任何 `build` 配置，无 `manualChunks`，无 `cssMinify`，无 `modulePreload` |
| 3 | 阅读 `frontend/package.json` | 关键依赖：react 19.0.0、react-dom 19.0.0、react-router-dom 7.1.5、lucide-react 1.21.0、vite 6.1.0、@vitejs/plugin-react 4.3.4、typescript 5.7.3；**无粒子/动画/3D 库**（无 three.js / pixi.js / gsap / framer-motion），所有动效为原生 Canvas + CSS |
| 4 | 阅读 `spec.md` | 原需求"性能预算不影响视觉表达关键要素"——粒子背景/3D 透视/轨道动画有降级路径但不在默认配置中移除。**本轮方向调整后**：进一步要求**增强**而非降级，spec 中"有降级路径"被重新理解为"含无障碍辅助路径与极低端兜底"，主流方向是让页面更丝滑、增加粒子与动画 |
| 5 | 阅读 `landing2.css` 关键片段 | 6 个 keyframes（landing2Blink/Bounce/Marquee/Shimmer/OrbitSpin/GlowPulse）；大量 `transition: ... var(--ease-out)` 已统一使用 CSS 变量；3D 透视 `perspective: 1200px` + `rotateX(6deg)`；轨道 `landing2OrbitSpin 40s linear infinite`；marquee `28s linear infinite`；bounce `1.6s ease-in-out infinite`；shimmer `3.5s infinite`（无缓动）；glow pulse `8s ease-in-out infinite`。所有动画均使用 transform/opacity，未触发 layout，已具备 GPU 合成层基础 |
| 6 | 阅读 `frontend/index.html` | 无自定义 webfont（无 Google Fonts、无 `@font-face`），全站使用系统字体栈；无 `<img>` 元素，所有装饰由 CSS / inline SVG 渲染 |
| 7 | s0401 写前闸门判定 | 目标路径属工程交接锚点，命名合规、目录已存在、任务显式授权、单文件覆盖、不修改 spec 三件套本身 → **ALLOWED** |

---

## 交接状态（三段交接 · 段二）

- **当前状态**：`已闭合`（本方案文档已完整产出 6 个章节，方向已从"降级"调整为"增强丝滑度"）
- **本任务**：仅产出方案文档，不动代码
- **下游接续**：`/apply` 阶段按本方案修改 `vite.config.ts`、`Home.tsx`、`landing2.css` 时，需对照本文件逐条实施。重点关注第 4 章——增强而非降级。GN-004 交付前审查时按本文件第 5 章"性能评估标准"逐项测量，目标值已上调
- **未闭合项**：基线性能指标值（当前未部署优化后版本，无法实测，已标注"需部署后测量"）

---

## 最终结果（三段交接 · 段三）

- **产出物清单**：本文件 `performance-plan.md`（单文件产出，未修改任何代码文件，未修改 spec 三件套与其他扩展产出物）
- **验证结论**：6 章节齐全；首屏/非首屏边界明确；`manualChunks` 拆分粒度合理；第 4 章方向已全面转为"增强丝滑度"，包含 4.1-4.6 共 6 个子章节（GPU 合成层 / 粒子增强 / 微交互 / 渲染路径 / 高刷新率适配 / 无障碍辅助）；性能指标目标值已调高（LCP ≤ 2.0s、TBT ≤ 150ms、CLS ≤ 0.05、FID ≤ 80ms、INP ≤ 150ms、FCP ≤ 1.5s、TTI ≤ 3.0s、粒子帧率 ≥ 58fps、滚动帧率 ≥ 55fps、交互响应 ≤ 50ms）；`vite.config.ts` 改动边界明确（仅新增 build 项，保留 server.proxy / port）
- **未闭合项**：基线性能指标值（当前未部署优化后版本，无法实测，已标注"需部署后测量"）

---

## 1. 代码分割策略

### 1.1 当前现状

`Home.tsx` 单文件 1424 行，13 个区块组件全部在主入口同步导入：

```
Navbar → Hero → LogoCloud → Stats → PainPoints → FeatureShowcase →
LiveDemo → ChatJourney → Comparison → UseCases → TechStack →
VersionTimeline → DeployCTA → Footer
```

首屏渲染需要解析全部 1424 行 JS + 全部 2529 行 CSS，导致 TBT（Total Blocking Time）偏高、LCP 推迟，**让首屏无法尽快呈现丝滑体验**。

### 1.2 首屏 vs 非首屏边界

| 分类 | 区块 | 加载方式 | 理由 |
|------|------|---------|------|
| **首屏（同步）** | Navbar | 直接 import | LCP 前必须可见（导航是用户第一视觉锚点） |
| **首屏（同步）** | Hero（含 ParticleBackground + Typewriter + useVersionInfo） | 直接 import | LCP 主元素所在，粒子背景是品牌识别关键 |
| **首屏（同步）** | Footer | 直接 import | spec 明确要求 Footer 列入首屏；同时作为页面尾部骨架避免 CLS |
| **非首屏（lazy）** | LogoCloud | `React.lazy` | 滚动到首屏底部才可见 |
| **非首屏（lazy）** | Stats | `React.lazy` | 同上 |
| **非首屏（lazy）** | PainPoints | `React.lazy` | id=pain，第二屏 |
| **非首屏（lazy）** | FeatureShowcase | `React.lazy` | id=features，第三屏，含 6 个 tab |
| **非首屏（lazy）** | LiveDemo | `React.lazy` | id=demo，第四屏 |
| **非首屏（lazy）** | ChatJourney | `React.lazy` | id=chat，第五屏 |
| **非首屏（lazy）** | Comparison | `React.lazy` | id=compare，第六屏 |
| **非首屏（lazy）** | UseCases | `React.lazy` | 第七屏 |
| **非首屏（lazy）** | TechStack | `React.lazy` | id=stack，第八屏（含 40s 轨道动画） |
| **非首屏（lazy）** | VersionTimeline | `React.lazy` | id=versions，第九屏 |
| **非首屏（lazy）** | DeployCTA | `React.lazy` | id=deploy，第十屏 |

**关键说明**：
- 数据常量（`NAV_SECTIONS` / `LOGOS` / `STATS` / `PAIN_POINTS` / `FEATURE_TABS` / `CHAT_PHASES` / `COMPARISON_ROWS` / `USE_CASES` / `TECH_STACK` / `VERSION_TIMELINE` / `DEPLOY_COMMAND`）应跟随各使用区块进入对应 lazy chunk，避免数据常量被打入首屏 chunk
- 共享 hooks（`useScrollReveal` / `useCountUp` / `useVersionInfo` / `useActiveSection` / `useNavScrolled`）应抽到独立 `hooks` 模块，由各 lazy chunk 按需引用，被打入共享 chunk
- `Navbar` 中的 `useActiveSection` 需 observe 全部 8 个 `NAV_SECTIONS` 对应 DOM 节点——这些节点由 lazy chunk 渲染，因此 `useActiveSection` 需在 lazy chunk 加载完成后重试 observe（详见 1.5）

### 1.3 React.lazy + Suspense 实施方案（仅方案描述，不写代码）

**入口文件结构方案**：

```
frontend/src/pages/Home.tsx               # 仅保留 Home 函数体 + 同步导入 Navbar/Hero/Footer
frontend/src/pages/home/Navbar.tsx        # 首屏组件
frontend/src/pages/home/Hero.tsx          # 首屏组件（含 ParticleBackground、Typewriter、useVersionInfo）
frontend/src/pages/home/Footer.tsx        # 首屏组件
frontend/src/pages/home/sections/         # 非首屏区块目录
  LogoCloud.tsx
  Stats.tsx
  PainPoints.tsx
  FeatureShowcase.tsx
  LiveDemo.tsx
  ChatJourney.tsx
  Comparison.tsx
  UseCases.tsx
  TechStack.tsx
  VersionTimeline.tsx
  DeployCTA.tsx
frontend/src/pages/home/hooks.ts          # 共享 hooks 集中导出
frontend/src/pages/home/data.ts          # 共享数据常量（如 NAV_SECTIONS）
```

**`Home.tsx` 入口方案**（伪代码，仅描述结构）：

```
- 同步导入：Navbar、Hero、Footer、共享 LazySection 包装器
- React.lazy 异步导入：LogoCloud、Stats、PainPoints、FeatureShowcase、LiveDemo、ChatJourney、Comparison、UseCases、TechStack、VersionTimeline、DeployCTA
- 单一 Suspense 边界 + fallback 占位骨架（高度等于真实区块高度，避免 CLS）
- 每个懒加载区块外层包 <LazySection> 包装器，包装器内部用 IntersectionObserver 触发实际 import()
```

**Suspense fallback 设计**：
- 高度需与真实区块匹配（如 PainPoints 高度约 720px、FeatureShowcase 约 900px、LiveDemo 约 800px），避免内容加载完成后产生 CLS
- fallback 内容：与区块背景色一致的占位 + 中央 spinner（用 CSS 旋转，不引第三方库）
- fallback CSS 应放入首屏 critical CSS（保证 fallback 自身渲染不阻塞）

### 1.4 IntersectionObserver 触发加载时机策略

**核心策略**：在区块进入视口前 200px 触发加载，避免用户滚到区块时才看到 fallback。

**触发方案**（伪代码描述）：

```
LazySection 包装器：
  - 初始：渲染 <section> 占位骨架（高度等于真实区块高度）
  - 监听：IntersectionObserver({ rootMargin: '0px 0px 200px 0px', threshold: 0 })
  - 触发：当占位 section 顶部进入视口下方 200px 范围时，触发 React.lazy import()
  - 加载完成：React.Suspense 自动替换 fallback 为真实组件
  - 取消监听：加载完成后 unobserve（避免重复触发）
```

**为什么是 200px**：
- 桌面端用户滚动速度约 600-1200 px/s
- 200px 距离对应 160-330ms 提前量
- 加上一个 chunk 下载耗时约 100-300ms（首屏后已预热 HTTP 连接）
- 总提前量约 260-630ms，恰好覆盖 chunk 下载 + 解析时间
- 不取 500px+：避免一次性触发太多 chunk 并发加载，反而挤占首屏带宽

**预加载兜底**：在 `Hero` 完成首次渲染后（即 LCP 触发后），用 `requestIdleCallback` 主动 prefetch 紧邻的下一个区块（LogoCloud）的 chunk，避免 IntersectionObserver 触发不及时。

### 1.5 Navbar 中 useActiveSection 的兼容方案

**问题**：`useActiveSection` 在首屏挂载时即 `getElementById('pain')` 等 8 个 section，但这些 section 由 lazy chunk 渲染，首屏挂载时 DOM 不存在。

**方案**：
- `useActiveSection` 内部改用 MutationObserver 监听 `document.body` 的 `childList` 变更，当检测到 NAV_SECTIONS 对应 id 的 section 出现时再 `observer.observe(el)`
- 复用现有 60ms 防抖模式（与 `useScrollReveal` 一致），避免 DOM 频繁变动触发全量扫描
- 该改动属于实施期工作，本方案仅声明需求

### 1.6 预期 Bundle 大小变化

**估算依据**：基于源码行数按比例估算，行数 → 字节粗略换算（含压缩前后）

| Chunk | 内容 | 估算原始大小 | 估算 Gzip 大小 |
|-------|------|------------|---------------|
| `index`（首屏入口） | Home 主入口 + LazySection 包装器 + Suspense | ~6 KB | ~2 KB |
| `home-navbar` | Navbar + useNavScrolled + useActiveSection + GithubIcon | ~5 KB | ~1.8 KB |
| `home-hero` | Hero + ParticleBackground + Typewriter + useVersionInfo + useScrollReveal + useCountUp | ~14 KB | ~4.5 KB |
| `home-footer` | Footer + GithubIcon | ~4 KB | ~1.5 KB |
| `vendor-react` | react + react-dom | ~140 KB | ~45 KB |
| `vendor-router` | react-router-dom | ~50 KB | ~18 KB |
| `vendor-icons` | lucide-react（按需引入约 35 个图标） | ~17 KB | ~5.5 KB |
| `home-logo-cloud` | LogoCloud | ~2 KB | ~0.8 KB |
| `home-stats` | Stats + StatNumber | ~3 KB | ~1 KB |
| `home-pain` | PainPoints | ~5 KB | ~1.7 KB |
| `home-features` | FeatureShowcase | ~9 KB | ~3 KB |
| `home-demo` | LiveDemo | ~7 KB | ~2.3 KB |
| `home-chat` | ChatJourney | ~3.5 KB | ~1.2 KB |
| `home-compare` | Comparison | ~5 KB | ~1.7 KB |
| `home-usecases` | UseCases | ~3 KB | ~1 KB |
| `home-stack` | TechStack | ~6 KB | ~2 KB |
| `home-versions` | VersionTimeline | ~4 KB | ~1.4 KB |
| `home-deploy` | DeployCTA | ~5 KB | ~1.7 KB |
| `home-css-critical` | 首屏 CSS（page shell + nav + hero + footer + reveal + btn） | ~12 KB | ~3 KB |
| `home-css-async` | 非首屏 CSS（logos/stats/pain/features/demo/chat/compare/usecases/stack/versions/deploy） | ~50 KB | ~10 KB |

**对比当前（未优化）**：

| 指标 | 当前（未优化） | 优化后 |
|------|--------------|--------|
| 首屏需要下载的 JS | 单 chunk ~225 KB（gzipped ~75 KB） | 首屏 4 chunk ~165 KB（gzipped ~53 KB） |
| 首屏需要下载的 CSS | 单文件 ~62 KB（gzipped ~13 KB） | critical ~12 KB（gzipped ~3 KB）+ async ~50 KB（gzipped ~10 KB） |
| 非首屏 JS | 已包含在首屏 chunk 中 | 按需懒加载，每个 1-3 KB gzipped |
| 首屏总传输（JS+CSS） | ~88 KB gzipped | ~56 KB gzipped（**-36%**） |

**关键收益**：
- 首屏下载量减少约 36%
- 非首屏区块延后加载，不再阻塞 LCP，**让首屏更快呈现丝滑体验**
- vendor 单独成 chunk，长期缓存命中率提升（业务变更不影响 vendor 缓存）

---

## 2. Vite 构建优化配置方案

### 2.1 当前 vite.config.ts 现状

```ts
// 当前配置（仅 server，无 build）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

缺失项：
- 无 `build.target`（默认 `'modules'`，仍包含部分兼容性 polyfill）
- 无 `build.cssMinify`（默认 `esbuild`，未启用 `lightningcss`）
- 无 `build.assetsInlineLimit` 调整
- 无 `build.modulePreload` 配置
- 无 `rollupOptions.output.manualChunks`，导致全部依赖打入单个 vendor chunk

### 2.2 manualChunks 配置方案

**拆分原则**：
1. **稳定依赖单独成 chunk**：react / react-dom / react-router-dom / lucide-react 升级频率低，单独成 chunk 可命中浏览器长期缓存
2. **业务代码按首屏 / 非首屏拆分**：通过 React.lazy 自动拆分业务代码，无需在 manualChunks 中重复配置
3. **不细分过碎**：避免 chunk 数量 > 20，否则 HTTP/2 调度开销反而上升

**`manualChunks` 函数实现方案**（仅描述策略，不写实施代码）：

```
function manualChunks(id) {
  if (id.includes('node_modules')) {
    if (id.includes('react/') || id.includes('react-dom/') || id.includes('scheduler/')) {
      return 'vendor-react';        // react 核心
    }
    if (id.includes('react-router') || id.includes('@remix-run/router') || id.includes('@remix-run/')) {
      return 'vendor-router';       // react-router 7 内部依赖 @remix-run/router
    }
    if (id.includes('lucide-react')) {
      return 'vendor-icons';        // 图标库
    }
    return 'vendor-misc';           // 其他第三方库（如 axios）
  }
  // 业务代码由 React.lazy 自动拆分，不在此处手动分组
  return undefined;
}
```

**预期各 chunk 大小**（详见 1.6 表格）：
- `vendor-react`：~140 KB（gzipped ~45 KB）
- `vendor-router`：~50 KB（gzipped ~18 KB）
- `vendor-icons`：~17 KB（gzipped ~5.5 KB）
- `vendor-misc`（axios 等其他依赖，仅 Home 页未直接使用但被全局入口引用）：~15 KB（gzipped ~5 KB）

### 2.3 CSS 优化方案

**`cssMinify` 配置**：
- 推荐使用 `'lightningcss'`（Vite 6 内置支持，无需额外安装）
- 对比默认 `esbuild`：lightningcss 在压缩率上提升约 5-10%，且能自动移除未使用的 CSS 规则（需配合 `lightningcss` 浏览器目标设置）
- 降级方案：如遇兼容性问题，回退为 `esbuild`

**CSS 拆分**：
- Vite 默认行为：所有 CSS 打包为单个文件
- 本方案需求：首屏 critical CSS 内联到 HTML，非首屏 CSS 异步加载
- 实施方式：使用 `vite-plugin-critical` 或类似插件（需在实施期评估依赖）；或手动拆分 `landing2.css` 为 `landing2-critical.css`（首屏必需）+ `landing2-async.css`（非首屏），通过 `<link rel="preload" as="style" onload="this.rel='stylesheet'">` 异步加载

### 2.4 build.target 配置

- 推荐 `target: 'es2020'`
- 理由：
  - 现代浏览器（Chrome 80+ / Firefox 80+ / Safari 14+）覆盖率 > 96%
  - ES2020 支持 `??` / `?.` / `BigInt` / `Promise.allSettled`，无需向下转译
  - 不支持 IE 11（与项目 PWA 定位一致，IE 不支持 service worker）
- 同时配置 `build.cssTarget: 'es2020'`（如使用 lightningcss，会按此目标移除不必要的 CSS 兼容前缀）

### 2.5 modulePreload 配置

- 默认行为：Vite 自动为入口 chunk 注入 `<link rel="modulepreload">`，预加载所有依赖 chunk
- 本方案需求：仅预加载首屏必需 chunk（vendor-react / vendor-router / vendor-icons / home-hero / home-navbar / home-footer）
- 配置方案：
  - `modulePreload: { polyfill: false }` —— 关闭 polyfill（现代浏览器原生支持 modulepreload，polyfill 仅增加体积）
  - `modulePreload.resolveDependencies` —— 自定义依赖解析，仅返回首屏 chunk 的 preload 列表，非首屏 chunk 不预加载（避免抢占首屏带宽）

### 2.6 assetsInlineLimit 配置

- 推荐 `assetsInlineLimit: 4096`（4 KB）
- 理由：
  - 小于 4 KB 的资源（如 favicon SVG、小图标、PWA manifest 引用的小尺寸 icon）转 base64 内联到 JS / CSS，减少 HTTP 请求数
  - 大于 4 KB 的资源（如 icon-192.png / icon-512.png）保持独立文件，避免 base64 膨胀
- 当前项目资源现状：
  - `icon.svg`（favicon）：预估 < 1 KB，会内联
  - `icon-192.png` / `icon-512.png`：预估各 5-15 KB，保持独立文件
  - `manifest.json`：不参与 assetsInlineLimit（它是 link 引用而非 import）

### 2.7 完整 build 配置方案示意（仅方案，非实施代码）

```
build: {
  target: 'es2020',
  cssTarget: 'es2020',
  cssMinify: 'lightningcss',           // 如不兼容则降级为 'esbuild'
  assetsInlineLimit: 4096,
  modulePreload: {
    polyfill: false,
    resolveDependencies: (filename, deps, { hostId, hostType }) => {
      // 仅首屏入口及其依赖 chunk 需要 modulepreload
      // 非首屏 lazy chunk 不预加载
      if (hostId.includes('/Home.tsx') || hostId.includes('home-navbar') || hostId.includes('home-hero') || hostId.includes('home-footer')) {
        return deps;
      }
      return [];   // 其他 lazy chunk 不预加载
    },
  },
  rollupOptions: {
    output: {
      manualChunks: (id) => {
        if (id.includes('node_modules')) {
          if (id.includes('react/') || id.includes('react-dom/') || id.includes('scheduler/')) return 'vendor-react';
          if (id.includes('react-router') || id.includes('@remix-run/')) return 'vendor-router';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return 'vendor-misc';
        }
        return undefined;
      },
      chunkFileNames: 'assets/[name]-[hash].js',
      entryFileNames: 'assets/[name]-[hash].js',
      assetFileNames: 'assets/[name]-[hash].[ext]',
    },
  },
}
```

---

## 3. 资源加载策略

### 3.1 字体策略

**当前现状**：
- 项目**无自定义 webfont**（无 `@font-face`、无 Google Fonts、无自托管字体文件）
- 全站使用系统字体栈：
  - 等宽：`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
  - 正文：通过 CSS 变量 `--font-sans` / `--font-mono`（继承自全局设计系统）
- 优势：零字体下载开销，零 FOIT/FOUT 风险

**结论**：
- **不需要做字体子集化**（无 webfont 可子集化）
- **不需要 `font-display: swap`**（系统字体栈即时可用）
- **不需要 preload 字体文件**（无字体文件可 preload）
- **保留现状**即可，无需在 `index.html` 添加字体相关 `<link>`

**未来扩展建议**（不在本方案范围内）：如未来引入品牌字体，应：
1. 仅子集化中文字符（按使用频率取 top 3000 字符 + ASCII + 标点）
2. 使用 `font-display: swap` 避免 FOIT
3. 通过 `<link rel="preload" as="font" type="font/woff2" crossorigin>` 预加载
4. 字体文件 ≤ 100 KB（woff2 子集后）

### 3.2 关键 CSS 内联策略

**必须内联到 HTML 的 CSS（首屏 critical CSS）**：

| CSS 范围 | 涉及 landing2.css 行号 | 理由 |
|---------|----------------------|------|
| `.main-content-public` | L7-10 | 公开路由容器样式，影响首屏布局 |
| `.landing2-page` | L13-22 | 页面 shell，定义背景、overflow、min-height |
| `.landing2-container` | L24-30 | 内容容器宽度限制 |
| `[data-reveal]` + `.revealed` + `@media (prefers-reduced-motion)` | L32-50 | scroll reveal 动画基础，影响首屏可见性 |
| `.landing2-gradient-text` + `.landing2-text-*` | L53-65 | 标题渐变文字样式 |
| `.landing2-btn*` 全部按钮变体 | L67-120+ | Hero CTA 按钮 |
| `.landing2-nav*` 全部导航样式 | （nav 相关行） | Navbar 必须首屏可见 |
| `.landing2-hero*` 全部 hero 样式 | L500-760+ | LCP 主元素 |
| `.landing2-particle-canvas` | （粒子 canvas 样式） | ParticleBackground canvas 定位 |
| `.landing2-typewriter` + `.landing2-cursor` + `@keyframes landing2Blink` | L488 / L492-498 | Typewriter 动画 |
| `.landing2-footer*` 基础布局 | L2150+ | Footer 骨架 |
| Suspense fallback 样式 | （新增） | fallback 占位骨架样式 |

**可异步加载的 CSS（非首屏 CSS）**：
- `.landing2-logos*`（LogoCloud）
- `.landing2-stats*`（Stats）
- `.landing2-pain*`（PainPoints）
- `.landing2-features*`（FeatureShowcase）
- `.landing2-demo*`（LiveDemo）
- `.landing2-chat*`（ChatJourney）
- `.landing2-compare*`（Comparison）
- `.landing2-usecases*`（UseCases）
- `.landing2-stack*`（TechStack，含 orbit 动画）
- `.landing2-versions*`（VersionTimeline）
- `.landing2-deploy*`（DeployCTA）
- `@keyframes landing2Bounce / landing2Marquee / landing2Shimmer / landing2OrbitSpin / landing2GlowPulse`（非首屏动画）
- `@media (max-width: 1024px) / 768px / 480px` 中仅影响非首屏区块的规则

**异步加载方式**：
- 推荐 `<link rel="preload" as="style" href="/assets/landing2-async-[hash].css" onload="this.rel='stylesheet'">`
- 配合 `<noscript><link rel="stylesheet" href="..."></noscript>` 兜底
- 或使用 `media="print" onload="this.media='all'"` trick（兼容性更好，但语义稍弱）

### 3.3 图片 / 装饰元素懒加载

**当前现状**：
- Home.tsx 中**无任何 `<img>` 元素**
- 所有图标通过 `lucide-react`（inline SVG，随 JS chunk 打包）
- 所有装饰元素（preview-chart-bar / preview-card / demo-chart-bar / visual-monitor-bar 等）通过 CSS 渲染
- GithubIcon 是 inline SVG 组件

**结论**：
- **无图片需要懒加载**（无 `<img>` / `<picture>` / `background-image: url(...)` 引用外部图片）
- **装饰元素懒加载策略**：随各 lazy chunk 自然懒加载
  - Hero 区的 preview-chart-bar（32 个 div）：在首屏 chunk 中，不懒加载（属于首屏 LCP 一部分）
  - FeatureShowcase 的 visual-monitor-bar（20 个 div）：随 `home-features` chunk 懒加载
  - LiveDemo 的 demo-chart-bar（40 个 div）：随 `home-demo` chunk 懒加载
  - 各 lucide-react 图标：随使用它的 chunk 自动打包

**未来注意**：
- 如未来在 Home 引入 `<img>`，应使用 `loading="lazy"` + `decoding="async"`
- 装饰性图片应使用 CSS `content-visibility: auto` + `contain-intrinsic-size` 延迟渲染

### 3.4 prefetch / preload 时机

**必须 preload 的资源（首屏 critical path）**：

| 资源 | preload 方式 | 理由 |
|------|------------|------|
| `vendor-react` chunk | Vite 自动 `modulepreload`（已通过 2.5 配置） | React 运行时是首屏一切前提 |
| `vendor-router` chunk | Vite 自动 `modulepreload` | Navbar 中 `<Link>` 依赖 |
| `vendor-icons` chunk | Vite 自动 `modulepreload` | Navbar / Hero 大量 lucide 图标 |
| `home-hero` chunk | Vite 自动 `modulepreload` | LCP 主元素 |
| `home-navbar` chunk | Vite 自动 `modulepreload` | 首屏第一视觉锚点 |
| `home-footer` chunk | Vite 自动 `modulepreload` | spec 要求首屏 |
| `landing2-critical.css` | `<link rel="preload" as="style">` | LCP 前必须可用 |

**可 prefetch 的资源（非首屏，浏览器空闲时）**：

| 资源 | prefetch 时机 | 理由 |
|------|------------|------|
| `home-logo-cloud` chunk | LCP 触发后 `requestIdleCallback` | 紧邻首屏下方，最可能下一可见 |
| `home-stats` chunk | LCP 触发后 `requestIdleCallback` | 同上 |
| `landing2-async.css` | LCP 触发后 `requestIdleCallback` | 非首屏 CSS 提前加载，避免滚动时 FOUT |
| `home-pain` chunk | 用户开始向下滚动时（scrollY > 200） | 第二屏可见前预热 |
| 其他非首屏 chunk | **不 prefetch** | 避免过度占用带宽，依赖 1.4 节 IntersectionObserver 200px 提前触发 |

**prefetch 实施方式**：
- 动态创建 `<link rel="prefetch" href="...">`（仅对支持 prefetch 的浏览器生效）
- 或通过 `import(/* webpackPrefetch: true */ '...')` 风格的 magic comment（Vite 支持有限，建议用动态 `<link>`）

### 3.5 HTTP/2 资源推送评估

**当前 demo 服务器现状**：
- 部署 URL：`https://trae.ecsrz.com:3000`（HTTPS）
- 后端 Express 直接 serve 静态资源（推测，需确认 nginx / 前置代理配置）
- 未明确确认是否启用 HTTP/2

**评估结论**：
- **不推荐主动启用 HTTP/2 Server Push**：
  1. Chrome 已在 2022 年开始移除 HTTP/2 Server Push 支持（基于过度推送导致缓存失效的实测）
  2. Server Push 对多 chunk 场景收益有限，且实施复杂
  3. 已有 `modulepreload` + `prefetch` 足以覆盖首屏预热需求
- **建议确认 HTTP/2 是否启用**：
  - 若服务器仅支持 HTTP/1.1，多 chunk 场景下浏览器并发连接数限制（6 个 / 域名）可能成为瓶颈
  - 若确认是 HTTP/1.1，建议合并部分非首屏 chunk（如将 11 个非首屏 chunk 合并为 3-4 个稍大 chunk），避免 HTTP/1.1 队头阻塞
  - 若已启用 HTTP/2，多 chunk 拆分可发挥最大收益
- **验证方式**：实施期通过 Chrome DevTools Network 面板查看 Protocol 列（`h2` 表示 HTTP/2，`http/1.1` 表示 HTTP/1.1）

---

## 4. 动画与视觉效果增强策略

> **方向声明**：本章不是"性能预算与降级策略"，而是"**让页面更丝滑、更流畅、行云流水**"。核心目标是**增强**：增加粒子、增强动画、增加微交互、提升视觉质感。性能优化的使命是让这些增强在 60fps 预算内可承受，而不是为了帧率牺牲视觉。
>
> **降级只在两种边缘场景出现**：① 4.6 节 prefers-reduced-motion 无障碍辅助路径（为前庭功能障碍/眩晕症用户提供更安静体验）；② 极低端设备（deviceMemory < 4 且 hardwareConcurrency < 4）的能力兜底。这两条不是主流方向。

### 4.1 GPU 加速与合成层优化

**目标**：把现有动画从 CPU 渲染路径（layout / paint 频繁触发）迁移到 GPU 合成层，让每一帧只走 Composite 步骤，达到丝滑无卡顿。

**4.1.1 合成层提示技术**：

| 技术 | 作用 | 适用选择器 |
|------|------|-----------|
| `will-change: transform, opacity` | 显式提示浏览器提前为元素创建合成层，避免首帧创建延迟 | 所有持续动画元素（`[data-reveal]`、`.landing2-preview-window`、`.landing2-stack-orbit`、`.landing2-logos-track`、`.landing2-hero-glow`、`.landing2-hero-scroll-bounce`、`.landing2-preview-shimmer`、`.landing2-demo-shimmer`） |
| `transform: translate3d(0,0,0)` 或 `translateZ(0)` | 强制提升到合成层（hack 但有效，对老版本 Chrome / Safari 兼容性好） | 仅对 will-change 不足以触发的旧浏览器兜底，新项目优先用 will-change |
| `backface-visibility: hidden` + `perspective: 1000px` | 配合 3D 变换元素强制合成层 | 已有 perspective 的 `.landing2-hero-preview` 上下文 |

**4.1.2 强制使用合成层属性（硬性规则）**：

| 允许的动画属性 | 禁止的动画属性（触发 layout / paint） |
|--------------|----------------------------------|
| `transform: translate / rotate / scale` | `top` / `left` / `right` / `bottom` |
| `opacity` | `width` / `height` |
| `filter`（慎用，部分浏览器触发 paint） | `margin` / `padding` |
| `clip-path`（部分浏览器仍触发 paint） | `border-width` |
|  | `box-shadow`（动画时触发 paint，建议改为 `filter: drop-shadow` 或伪元素叠加） |
|  | `background-position`（动画时触发 paint） |

**4.1.3 landing2.css 现有 keyframes 审查**：

| keyframes 名称 | 当前属性 | 是否合成层友好 | 改造建议 |
|---------------|---------|--------------|---------|
| `landing2Blink`（L492） | `opacity` | ✅ 已合成层友好 | 保留，无需改造 |
| `landing2Bounce`（L799） | `transform: translateY` + `opacity` | ✅ 已合成层友好 | 保留 |
| `landing2Marquee`（L842） | `transform: translateX` | ✅ 已合成层友好 | 保留 |
| `landing2Shimmer`（L1325） | （需实施期核查具体属性，常见实现为 `background-position` 或 `transform`） | ⚠️ 若为 `background-position` 则触发 paint | 改造为 `transform: translateX` 移动伪元素覆盖层（保持渐变背景不动，仅移动高光遮罩），让动画走合成层 |
| `landing2OrbitSpin`（L1811） | `transform: rotate` | ✅ 已合成层友好 | 保留，建议在 `.landing2-stack-orbit` 上加 `will-change: transform` |
| `landing2GlowPulse`（L2251） | `opacity` + `transform: scale` | ✅ 已合成层友好 | 保留，建议加 `will-change: transform, opacity` |

**4.1.4 现有 transition 审查**：

landing2.css 中有约 18 处 `transition: ... var(--ease-out)`（L36 / L79 / L217 / L278 / L291 / L321 / L344 / L562 / L875 / L946 / L1125 / L1519 / L1733 / L1856 / L1939 / L2186 / L2328），以及少量直接缓动（L135 `transition: all 0.15s`、L966 `transition: opacity 0.4s`、L1677 `transition: background 0.15s`、L1963 `transition: all 0.2s`、L2109 `transition: all 0.15s`、L2213 `transition: color 0.15s`）。

**改造建议**：
- 所有 `transition: all ...` 改为 `transition: transform ..., opacity ...`（明确属性，避免 all 触发非合成层动画）
- 已使用 `var(--ease-out)` 的统一在第 4.3.1 节升级该变量为 cubic-bezier
- L1677 `transition: background 0.15s` 改为伪元素叠加 + `opacity` 过渡（背景色动画必触发 paint）
- L2213 `transition: color 0.15s` 保留（color 动画虽触发 paint，但 0.15s 短时长视觉影响小）

**4.1.5 CSS 改造建议汇总**（仅方案，不写最终代码）：
- 在所有持续动画元素上添加 `will-change: transform, opacity`（或对应属性）
- 在 6 处 `transition: all` 上明确列出具体属性
- 改造 shimmer 动画为 transform 驱动（如确认其当前为 background-position）
- box-shadow 动画场景改为伪元素 + opacity 切换

### 4.2 粒子动画增强（增加粒子 + 算法优化）

**核心目标**：让粒子背景**更丰富、更有层次、更自然**——粒子数从 90 增加到 150（PC 高端）/ 80（touch），同时通过算法优化保证不卡顿。

**4.2.1 算法优化（让 O(n²) 连线降为 O(n·k)）**：

**当前算法**：双层 for 循环遍历所有粒子对，计算 `Math.sqrt(dx*dx + dy*dy)` 并比较 `< 140`。90 粒子时每帧 C(90,2) = 4005 次开方计算。

**优化方案 A — 空间分区（网格法）**：

| 项 | 说明 |
|---|------|
| 网格尺寸 | 每格 140px（等于连线距离阈值，保证任一粒子的相邻粒子必在自身所在格 + 周围 8 格内） |
| 数据结构 | `Map<string, Particle[]>`，key 为 `"${gx},${gy}"`（网格坐标），value 为该格内粒子数组 |
| 增量更新 | 每帧粒子位置更新后，仅重算自身所在格（粒子 vx/vy 较小，跨格频率低；可加入"格变更检测"避免每帧重建整个网格） |
| 连线计算复杂度 | 从 O(n²) 降为 O(n·k)，k 为相邻 9 格内的粒子数总和。实际场景 k ≤ 9-15，n=150 时总计算量约 150×15 = 2250 次，比原 4005 次少 44%；n=200 时仅 3000 次 vs 原 19900 次，**少 85%** |
| 视觉一致性 | 与原算法结果完全一致（连线判定仍基于距离 < 140px），仅计算顺序优化 |

**优化方案 B — 距离平方比较（省去开方）**：

| 项 | 说明 |
|---|------|
| 当前 | `Math.sqrt(dx*dx + dy*dy) < 140`（每对粒子一次开方） |
| 优化后 | `dx*dx + dy*dy < 140*140`（即 `< 19600`，无开方） |
| 收益 | JS 引擎中 `Math.sqrt` 约 50-100ns/次，省去后每帧节省 0.2-0.4ms（90 粒子场景）至 1-2ms（200 粒子场景） |
| 同步影响 | 鼠标排斥力计算 `force = (120 - dist) / 120` 中的 `dist` 仍需开方（用于归一化方向向量），可保留一次开方但仅对进入排斥半径的粒子执行（已通过平方比较预筛） |

**优化方案 C — Path2D 批量绘制**：

| 项 | 说明 |
|---|------|
| 当前 | 每条连线 `beginPath` → `moveTo` → `lineTo` → `stroke` 一次，每帧约 200-500 次状态切换 + 200-500 次 stroke 调用 |
| 优化后 | 累积所有连线段到一个 `Path2D` 对象（`path.moveTo` + `path.lineTo`），最后 `ctx.stroke(path)` 一次提交 |
| 收益 | Canvas 2D 状态切换是主要开销，批量绘制可减少 80-90% 的 stroke 调用，预计每帧节省 2-4ms |
| 限制 | 同一 Path2D 内所有线段共用一个 strokeStyle，无法逐线设置不同颜色——可通过"按 alpha 分桶（如分 5 个 alpha 桶）"折中，每桶一个 Path2D，5 次 stroke 即可 |

**4.2.2 渲染优化（让粒子计算脱离主线程）**：

**方案 D — OffscreenCanvas + Web Worker**（主推方案）：

| 维度 | 说明 |
|------|------|
| 架构 | 主线程创建 `OffscreenCanvas`，通过 `canvas.transferControlToOffscreen()` 转交 Worker；Worker 内运行粒子更新 + 绘制循环；主线程通过 `postMessage` 传递鼠标位置 / 尺寸变化 / 暂停信号 |
| 收益 | 粒子计算 + Canvas 绘制完全脱离主线程，React 渲染、滚动、交互零阻塞；高粒子数（200+）时主线程仍可保持 60fps |
| 兼容性 | Chrome / Edge 全支持；Safari 16.4+ 支持；Firefox 105+ 支持。当前覆盖率约 92% |
| 降级路径 | 不支持 OffscreenCanvas 的浏览器（旧 Safari / Firefox）回退到主线程 Canvas + 方案 A/B/C 优化，粒子数保持原 90/40 |
| 通信成本 | Worker ↔ 主线程通过 `postMessage`，鼠标位置可节流到 30Hz 传递（人眼对鼠标响应延迟 30ms 不敏感），避免频繁消息开销 |
| 实施期评估点 | Worker 加载体积（粒子逻辑通常 < 5KB）、Transferable 对象优化（OffscreenCanvas 本身是 transferable） |

**方案 E — WebGL 渲染（可选增强）**：

| 维度 | 说明 |
|------|------|
| 适用场景 | 极致性能需求（如 500+ 粒子）或未来扩展为粒子物理效果（碰撞 / 流场 / 引力） |
| 备选实现 | 原生 WebGL（复杂但零依赖）/ pixi.js（API 友好但增加 ~200KB gzipped 依赖）/ regl（轻量约 30KB） |
| 性能提升 | GPU 并行渲染，相比 Canvas 2D 性能提升 10-100x；1000 粒子场景下仍可保持 120fps |
| **本方案建议** | **本轮不引入 WebGL**。原因：① 增加 ~30-200KB 依赖与 package.json 复杂度；② Canvas 2D + 方案 A/B/C/D 已足够支撑 150-200 粒子 60fps；③ 实施期如评估发现 OffscreenCanvas 仍不足，再启动 WebGL 方案作为 P1 增强 |
| 标注 | 可选增强，不在本轮交付范围内 |

**4.2.3 粒子增强效果（视觉质感提升）**：

| 增强项 | 当前 | 增强后 | 收益 |
|-------|------|--------|------|
| 粒子数量 | 90（PC）/ 40（touch） | **150（PC 高端）/ 80（touch）/ 90（PC 中端）** | 背景更丰富，密集感更强，呼应"行云流水" |
| 粒子大小 | 0.5-2.0（`Math.random() * 1.5 + 0.5`） | **0.5-3.0**（`Math.random() * 2.5 + 0.5`） | 大小变化更明显，增加深度层次感 |
| 粒子颜色 | 单色橙 `rgba(249,115,22,0.5)` | **橙→青双色渐变**：根据粒子在画布的 x 位置 / 速度 / 随机种子，在橙 `#f97316` 与青 `#06b6d4` 之间插值（呼应设计系统双主色） | 色彩更丰富，呼应品牌双主色，提升视觉质感 |
| 粒子速度 | 固定 0.4（`(Math.random() - 0.5) * 0.4`） | **0.2-0.6 随机**（`(Math.random() - 0.5) * (0.4 + Math.random() * 0.4)`） | 速度差异化，部分粒子缓慢漂浮、部分粒子灵动游走，增加自然感 |
| 连线颜色 | 单色 alpha 渐变 `rgba(249,115,22, 0.12 * (1 - d/140))` | **alpha + 色相微变**：连线两端粒子的颜色插值（如一端橙、一端青时，连线中段呈渐变色），alpha 仍按距离衰减 | 连线呈色彩渐变，呼应粒子双色方案，整体更精致 |
| 连线距离阈值 | 固定 140px | 保持 140px（与原一致），但通过网格法优化性能 | 视觉一致，性能提升 |
| 鼠标排斥 | 120px，强度系数 1.5 | 保持 120px，强度系数提升到 **2.0**，加入"回弹缓动"（粒子被排斥后用弹性回归原位） | 鼠标交互更灵动、更有"灵气"，体现"行云流水" |

**4.2.4 设备分级（在增强基础上保留能力兜底）**：

| 等级 | 触发条件 | 粒子数 | 算法路径 | 鼠标排斥 | 帧率预期 |
|------|---------|--------|---------|---------|---------|
| **L1 高端** | `deviceMemory ≥ 8` 且 `hardwareConcurrency ≥ 8` | **150（touch: 80）** | OffscreenCanvas + 网格 + 距离平方 + Path2D | 开启（强度 2.0） | ≥ 58fps，目标 60fps 稳定 |
| **L2 中端** | `deviceMemory ≥ 4` 或 `hardwareConcurrency ≥ 4`（不满足 L1） | **90（touch: 50）** | 主线程 Canvas + 网格 + 距离平方 + Path2D | 开启（强度 2.0） | ≥ 55fps |
| **L3 低端兜底** | 上述均不满足，或 `deviceMemory < 4` 且 `hardwareConcurrency < 4` | **50（touch: 30）** | 主线程 Canvas + 网格（关闭连线绘制） | 关闭 | ≥ 30fps |
| **L4 fallback** | `deviceMemory` 与 `hardwareConcurrency` 均不可用 | 90（touch: 50） | 主线程 Canvas + 网格 + 距离平方 + Path2D | 开启（强度 2.0） | 60fps |

**关键说明**：
- L1 默认粒子数从原方案的 90 增加到 **150**，是本轮"增强"方向的核心体现
- L3 仍保留 50 粒子（不归零），只是关闭连线绘制——这是兜底而非降级主流
- 设备检测兼容性说明（与原方案一致）：`navigator.deviceMemory` 仅 Chrome / Edge 支持，Firefox / Safari 不支持时仅依赖 `hardwareConcurrency`；两者均不可用时回退到 L4

**4.2.5 visibilitychange / IntersectionObserver 暂停（保留原方案）**：

- 当前已实现：IntersectionObserver 监听 canvas 可见性，不可见时 `cancelAnimationFrame` + `isVisible = false`
- **需补充**：`document.visibilitychange` 监听，用户切换浏览器标签页时暂停粒子动画（节省后台 CPU + 笔记本续航 + 风扇噪音）
- 可选补充：`window.blur` / `focus` 监听（窗口失焦时降帧到 30fps），实施期评估收益
- 实施伪代码方案（仅描述逻辑）：

```
const onVisibilityChange = () => {
  if (document.hidden) {
    cancelAnimationFrame(raf);
    isVisible = false;        // 复用现有 isVisible 标志
  } else if (canvasInViewport) {
    isVisible = true;
    draw();
  }
};
document.addEventListener('visibilitychange', onVisibilityChange);
// cleanup 中 removeEventListener
```

### 4.3 动画流畅度增强（cubic-bezier + 微交互）

**目标**：通过缓动函数升级与微交互增强，让每一个动画都有"质感"和"灵气"，达成"行云流水"的整体感受。

**4.3.1 缓动函数统一升级**：

| 缓动 | cubic-bezier | 适用场景 |
|------|------------|---------|
| **ease-out-expo** | `cubic-bezier(0.16, 1, 0.3, 1)` | 主推：快速进入、缓慢减速，几乎所有"出现"类动画（reveal、popup、slide-in） |
| **ease-out-back** | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 带弹性的回弹：按钮 active 回弹、卡片入场、磁吸按钮释放 |
| **ease-in-out-cubic** | `cubic-bezier(0.65, 0, 0.35, 1)` | 对称缓动：循环型动画（如 glow pulse、bounce） |

**landing2.css 现有 transition / animation 审查**：

| 选择器（行号） | 当前缓动 | 改造建议 |
|--------------|---------|---------|
| `[data-reveal]` transition（L36） | `var(--ease-out)` | 将 `--ease-out` 变量升级为 `cubic-bezier(0.16, 1, 0.3, 1)`（ease-out-expo） |
| 按钮系列 `transition: all 0.2s var(--ease-out)`（L79 / L321 / L344 / L1125 / L1856 / L2186） | `var(--ease-out)` | 同上，统一升级 `--ease-out` |
| 卡片 hover `transition: all 0.3s var(--ease-out)`（L217 / L875 / L946 / L1519 / L1733 / L1939） | `var(--ease-out)` | 升级为 `cubic-bezier(0.34, 1.56, 0.64, 1)`（ease-out-back，带弹性入场） |
| `transition: color 0.15s`（L278 / L2213） | 默认 ease | 改为 `cubic-bezier(0.16, 1, 0.3, 1)` |
| `transition: width 0.25s`（L291） | `var(--ease-out)` | 升级为 ease-out-expo |
| `.landing2-preview-window` transition（L562） | `var(--ease-out)` | 升级为 ease-out-back（hover 时带弹性） |
| `transition: opacity 0.3s`（L135） | 默认 ease | 改为 ease-out-expo |
| `transition: opacity 0.4s`（L966 / L1752） | 默认 ease | 改为 ease-out-expo |
| `transition: all 0.15s`（L1352 / L1677 / L2109） | 默认 ease | 改为 ease-out-expo，且明确属性（避免 all） |
| `transition: all 0.2s`（L1963） | 默认 ease | 改为 ease-out-expo |
| `@keyframes landing2Bounce`（L799） | `ease-in-out` | 改为 `cubic-bezier(0.65, 0, 0.35, 1)` |
| `@keyframes landing2GlowPulse`（L2251） animation（L427） | `ease-in-out` | 改为 `cubic-bezier(0.65, 0, 0.35, 1)` |
| `@keyframes landing2Shimmer`（L574 / L1320） | 无缓动（infinite linear 默认） | 改为 `cubic-bezier(0.65, 0, 0.35, 1)` infinite |
| `@keyframes landing2Marquee`（L828） | `linear infinite` | 保留 linear（跑马灯匀速符合预期，改为 cubic-bezier 会显得"卡顿加速"） |
| `@keyframes landing2OrbitSpin`（L1808 / L1826） | `linear infinite` | 保留 linear（轨道匀速旋转符合物理直觉） |
| `@keyframes landing2Blink`（L488） | `step-end` | 保留 step-end（光标闪烁符合直觉） |

**4.3.2 微交互增强清单**：

| # | 增强效果 | 实施方向 | 视觉收益 |
|---|---------|---------|---------|
| 1 | **按钮按压弹性** | `:active` 状态 `transform: scale(0.96)` + `transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)`，释放时弹性回弹 | 点击瞬间反馈"按下感"，提升点击满足感 |
| 2 | **卡片 hover 视差** | 卡片 hover 时根据鼠标在卡片内的位置，计算偏移量并应用 `transform: perspective(800px) rotateX(${ry}deg) rotateY(${rx}deg)`（rx/ry 范围 ±5deg），mousemove 节流到 rAF | 卡片随鼠标倾斜，呈现 3D 深度感，呼应 Hero 区的 3D 透视语言 |
| 3 | **数字滚动增强（useCountUp）** | 当前线性 `count += step`，改为 ease-out-expo 缓动：`progress = easeOutExpo(elapsed / duration); count = start + (end - start) * progress`，让数字加速后减速停止 | 数字加速冲到接近目标后缓慢停在目标值，"冲刺-刹车"质感 |
| 4 | **滚动视差（parallax）** | Hero 区背景（`ParticleBackground` canvas）与 Hero 内容（标题、副标题、CTA）按不同速度滚动：内容 `transform: translateY(scrollY * 0.2)`（向下偏移），背景 `transform: translateY(scrollY * -0.1)`（向上偏移），形成视差 | Hero 滚动时背景与内容分离移动，增加深度感，避免"整块"上滑 |
| 5 | **鼠标跟随光晕** | Hero 区添加一个 fixed 定位的 div，背景为 `radial-gradient(circle at center, rgba(249,115,22,0.15), transparent 60%)`，JS 监听 mousemove 更新其 `transform: translate(${x}px, ${y}px)`（节流到 rAF）；只在 Hero 区可见时启用 | Hero 区出现跟随鼠标的柔和光晕，增加沉浸感与"被注视"的灵动感 |
| 6 | **磁吸按钮** | 主 CTA 按钮（Hero "立即开始" / Deploy CTA）监听 mousemove，当鼠标在按钮周围 80px 范围内时，按钮 `transform: translate(${dx*0.3}px, ${dy*0.3}px)` 偏移向鼠标方向（最大偏移 4px），鼠标离开时弹性回弹 | 按钮在鼠标靠近时"被吸引"微微偏移，体现"灵气"和"行云流水" |

**4.3.3 微交互实施原则**：
- 所有微交互必须基于 `transform` 和 `opacity`（合成层属性），禁止使用 layout 属性
- 所有 mousemove 监听必须 `requestAnimationFrame` 节流（避免每帧多次触发）
- 视差与磁吸的位移幅度应保守（视差 ≤ 0.3 倍滚动距离、磁吸 ≤ 4px），避免视觉过度
- 触屏设备（`pointer: coarse`）关闭视差、磁吸、鼠标光晕（无鼠标交互场景）

### 4.4 渲染路径优化（减少卡顿，让滚动丝滑）

**目标**：通过 CSS Containment 与 content-visibility 让浏览器跳过非可见区块的渲染工作，让滚动按需渲染、零卡顿。

**4.4.1 `content-visibility: auto`**：

| 项 | 说明 |
|---|------|
| 适用区块 | 非首屏区块：PainPoints / FeatureShowcase / LiveDemo / ChatJourney / Comparison / UseCases / TechStack / VersionTimeline / DeployCTA |
| 配置 | `content-visibility: auto` + `contain-intrinsic-size: 800px 900px`（高度按各区块实际预估：PainPoints ~720px / Features ~900px / Demo ~800px 等，避免滚动条跳动） |
| 收益 | 浏览器跳过非可见区块的 layout / paint / composite，初次渲染只渲染首屏 + 当前可见区块；滚动到该区块时按需渲染 |
| 兼容性 | Chrome 85+ / Edge 85+ / Firefox 125+ / Safari 18+；不支持的浏览器会忽略该属性，无功能影响 |
| **与 `[data-reveal]` 动画的兼容性** | content-visibility 会让非可见区块的子树完全不渲染，IntersectionObserver 无法 observe 到未渲染的 `[data-reveal]` 元素。**解决方案**：将 IntersectionObserver 的 `rootMargin` 扩展为 `'0px 0px 400px 0px'`（提前 400px 触发 reveal 监听），并在区块进入视口前 400px 时临时移除 `content-visibility`（或改为 `content-visibility: visible`），让区块进入渲染并触发 reveal 动画。配合 4.3 节 ease-out-expo 缓动，reveal 动画进入更丝滑 |

**4.4.2 `contain: layout paint style`**：

| 适用选择器 | contain 值 | 收益 |
|----------|----------|------|
| `.landing2-card` / `.landing2-pain-card` / `.landing2-feature-card` 等 | `layout paint style` | 卡片内部布局变化不影响外部，重绘限定在卡片内 |
| `.landing2-modal` / `.landing2-overlay` | `layout paint style` | 模态/遮罩内部重绘不影响下方内容 |
| `.landing2-timeline` / `.landing2-stack-orbit` | `layout paint style` | 滚动容器/动画容器内部独立 |
| `.landing2-particle-canvas` | `layout paint style` | 粒子 canvas 重绘限定在 canvas 边界内 |
| `.landing2-hero-preview` | `layout paint style` | Hero preview 区内部 3D 变换不影响外部 |

**4.4.3 避免 layout thrashing**：

| 风险点 | 评估 | 缓解方案 |
|-------|------|---------|
| `useCountUp`（Home.tsx） | 每帧读 `ref.current` + 写 `style.transform`，但写的是 transform（不触发 layout），**无 thrashing 风险** | 保留现状 |
| `useScrollReveal` 中 `getBoundingClientRect` | 在 scroll 事件中读 layout 属性，可能触发强制重排 | 用 `requestAnimationFrame` 包裹 scroll 回调，并在 rAF 内批量读取 |
| `useActiveSection` 中 `getBoundingClientRect` | 同上 | 同上 |
| ParticleBackground 中 `canvas.width = window.innerWidth` | resize 事件中触发 canvas 尺寸变更（这是必要的），但应节流（rAF + 防抖 100ms） | resize 回调 rAF 节流 |
| 卡片 hover 视差中读鼠标位置 | mousemove 中读 `e.clientX/Y`（不触发 layout），但若同时读 `el.getBoundingClientRect()` 会触发 layout | 缓存 rect 在 mouseenter 时读取一次，mousemove 仅用 clientX/Y 减去缓存的 rect |

**4.4.4 滚动优化**：

| 项 | 方案 |
|---|------|
| 滚动容器 `will-change` | `.landing2-page` 添加 `will-change: scroll-position`（提示浏览器优化滚动合成） |
| 长列表虚拟化评估 | VersionTimeline 当前 12 条，无需虚拟化；ChatJourney 7 个 phase，无需虚拟化；UseCases 6 项，无需虚拟化。结论：**本轮不引入虚拟化**，未来如条目数 > 50 再评估 react-window / @tanstack/react-virtual |
| `overscroll-behavior: contain` | 在 `.landing2-page` 上添加，避免滚动到边界时触发父级滚动（如 body 滚动），让滚动"贴住"页面 |
| `scroll-behavior: smooth` | 不主动设置（用户 prefers-reduced-motion 时浏览器自动禁用 smooth；非 reduced-motion 用户通过 anchor 跳转也无需强制 smooth，避免与自定义动画冲突） |

### 4.5 帧率提升与高刷新率适配

**目标**：在 60Hz 屏幕上稳定 60fps；在 120Hz / 144Hz / 240Hz 高刷新率屏幕上自动适配高帧率，让动画更丝滑。

**4.5.1 rAF 自然适配**：

- 当前代码（ParticleBackground、useCountUp、Typewriter、scroll callbacks）已使用 `requestAnimationFrame`，rAF 自动匹配显示器刷新率
- 60Hz 屏幕：rAF 约 16.67ms 触发一次；120Hz 屏幕：rAF 约 8.33ms 触发一次；144Hz 屏幕：约 6.94ms 触发一次
- **保持现状即可**，无需手动节流

**4.5.2 高刷新率检测**：

| API | 用法 | 兼容性 |
|-----|------|--------|
| `window.matchMedia('(update: fast)').matches` | 检测高刷新率屏幕（update: fast 表示 refresh rate > 60Hz） | Chrome 89+ / Edge 89+ / Firefox 84+ / Safari 14+ |
| `screen.isExtended`（较新 API） | 检测多屏（不直接反映刷新率，但可辅助判断） | 较新，兼容性较差 |
| Fallback | 通过 rAF 时间戳测量：连续两次 rAF 间隔 < 12ms 则推测为高刷新率 | 全平台支持 |

**实施方向**：在 ParticleBackground 与 useCountUp 中检测高刷新率，仅用于"动画时长适配"，不改变粒子数（粒子数按 4.2.4 设备分级决定）。

**4.5.3 动画时长适配（基于帧数而非固定时长）**：

- 当前 `useCountUp` 时长固定（如 2000ms）；高刷新率屏幕上 120Hz 下会渲染 240 帧，比 60Hz 下 120 帧多一倍，但视觉时长一致（仍是 2s），所以"基于时长"的动画在高刷新率下不会更快，只是更丝滑
- **结论**：基于时长的动画（如 useCountUp、Typewriter）无需改造，高刷新率下自动更丝滑
- **可选增强**：基于帧数的动画（如 ParticleBackground 的粒子位置更新）在高刷新率下会"更快"（每帧 vx/vy 位移一致，但帧数更多 → 单位时间位移更大）。**解决方案**：在 rAF 回调中根据 `deltaTime`（`timestamp - lastTimestamp`）按比例缩放位移：`p.x += p.vx * (deltaTime / 16.67)`，保证不同刷新率下粒子速度一致

**4.5.4 CSS 动画适配**：

- 通过 `@media (update: fast)` 媒体查询，在高刷新率屏幕下可：
  - 缩短循环动画时长（如 bounce 从 1.6s 缩短到 0.8s，让 bounce 在高刷新率下更活泼）—— 但需谨慎，缩短时长可能改变视觉节奏
  - 提升动画细节（如增加 shimmer 的细节密度）
- **本方案建议**：高刷新率下保持原时长不变，仅享受帧率提升带来的丝滑感即可；缩短时长属于"视觉风格调整"，不在性能方案范围内

### 4.6 prefers-reduced-motion 无障碍辅助

> **重新定位**：本节不是"降级"，而是为有前庭功能障碍 / 眩晕症 / 光敏性癫痫用户的**无障碍辅助路径**。主流用户体验是 4.1-4.5 节的增强丝滑动画；少数用户可声明 `prefers-reduced-motion: reduce` 获得更安静的体验。这是无障碍辅助，不是性能优化的主基调。

**4.6.1 当前现状**：

- landing2.css L44-50 已有 `@media (prefers-reduced-motion: reduce)`，但**仅作用于 `[data-reveal]`**（取消 reveal 动画，直接 opacity:1 + transform:none + transition:none）
- 粒子动画、3D 透视、轨道动画、shimmer 等均未响应 `prefers-reduced-motion`

**4.6.2 完整无障碍辅助方案**：

| 视觉元素 | 默认行为（增强后） | `prefers-reduced-motion: reduce` 下行为 | 实施位置 |
|---------|------------------|--------------------------------------|---------|
| `[data-reveal]` scroll reveal | opacity 0→1 + translateY 28px→0（ease-out-expo 缓动） | opacity:1 + transform:none + transition:none（**已实现**） | landing2.css |
| ParticleBackground 粒子动画 | 150 粒子 + 双色渐变 + 鼠标排斥 | **粒子数减半**（75 粒子） + **关闭连线**（distance=0） + **关闭鼠标排斥** + 关闭双色（回退单色橙） | Home.tsx（JS 检测 `matchMedia('(prefers-reduced-motion: reduce)')`） |
| Hero preview 3D 透视 | `perspective: 1200px` + `rotateX(6deg)` + 卡片 hover 视差 | **关闭 perspective** + `transform: none` + 关闭视差 | landing2.css（新增 `@media` 块） |
| Hero preview shimmer | `landing2Shimmer 3.5s infinite`（ease-in-out-cubic） | **关闭 animation** | landing2.css |
| TechStack 轨道动画 | `landing2OrbitSpin 40s linear infinite` + 反向旋转 | **关闭 animation**（改为静态网格展示） | landing2.css |
| LogoCloud 跑马灯 | `landing2Marquee 28s linear infinite` | **关闭 animation** | landing2.css |
| Hero scroll bounce | `landing2Bounce 1.6s ease-in-out-cubic infinite` | **关闭 animation** | landing2.css |
| Glow pulse 光晕 | `landing2GlowPulse 8s ease-in-out-cubic infinite` | **关闭 animation** | landing2.css |
| 鼠标跟随光晕（4.3.2 #5） | 跟随鼠标的径向光晕 | **关闭**（无光晕） | Home.tsx（JS 检测） |
| 磁吸按钮（4.3.2 #6） | 按钮跟随鼠标偏移 | **关闭**（按钮无偏移） | Home.tsx（JS 检测） |
| 视差滚动（4.3.2 #4） | Hero 内容与背景按不同速度滚动 | **关闭**（背景与内容同速滚动） | Home.tsx（JS 检测） |
| Typewriter 打字机 | 字符逐个显示 | **直接显示完整第一句**，关闭打字/删除循环 | Home.tsx（JS 检测 + props 控制） |
| useCountUp 数字滚动 | 数字 0→目标值 2s（ease-out-expo） | **直接显示目标值** | Home.tsx（JS 检测 + 短路） |

**4.6.3 CSS 实施伪代码方案**（仅描述新增 `@media` 块结构，不写最终代码）：

```
@media (prefers-reduced-motion: reduce) {
  /* 已有：[data-reveal] 辅助 */

  /* 新增：3D 透视辅助 */
  .landing2-hero-preview { perspective: none; }
  .landing2-preview-window { transform: none; }
  .landing2-preview-window:hover { transform: none; }

  /* 新增：关闭 shimmer */
  .landing2-preview-shimmer { animation: none; }
  .landing2-demo-shimmer { animation: none; }

  /* 新增：关闭轨道动画 */
  .landing2-stack-orbit { animation: none; }
  .landing2-stack-orbit-center { animation: none; }

  /* 新增：关闭跑马灯 */
  .landing2-logos-track { animation: none; }

  /* 新增：关闭 bounce */
  .landing2-hero-scroll-bounce { animation: none; }

  /* 新增：关闭 glow pulse */
  .landing2-hero-glow { animation: none; }
  .landing2-demo-glow { animation: none; }
  .landing2-deploy-glow { animation: none; }
}
```

**4.6.4 JS 实施伪代码方案**（仅描述检测逻辑，不写最终代码）：

```
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ParticleBackground 中
const tier = detectTier();
const count = prefersReducedMotion ? Math.floor(tier.count / 2) : tier.count;
const linkDistance = prefersReducedMotion ? 0 : 140;
const mouseRepel = !prefersReducedMotion && tier.mouseRepel;
const dualColor = !prefersReducedMotion;

// Typewriter 中
if (prefersReducedMotion) {
  return <span>{texts[0]}</span>;   // 直接显示第一句，无光标
}

// useCountUp 中
if (prefersReducedMotion) {
  return { count: end, ref };   // 直接返回目标值
}

// 磁吸按钮 / 鼠标光晕 / 视差滚动 中
if (prefersReducedMotion) { return null; }  // 不挂载监听
```

**4.6.5 关键约束**：
- 主流用户体验是 4.1-4.5 节的增强丝滑动画（粒子 150、3D 透视、视差、磁吸、双色渐变等）
- 仅当用户主动声明 `prefers-reduced-motion: reduce` 时进入本节辅助路径
- 辅助路径不删除元素，只关闭动画或降低强度，保证信息完整性
- L3 低端设备即使未声明 reduced-motion，也走粒子数兜底（50 粒子 + 关闭连线），但保留 3D 透视与轨道动画（除非同时声明 reduced-motion）

### 4.7 MutationObserver 防抖评估

**当前现状**（Home.tsx L304-311）：
- `useScrollReveal` 中 MutationObserver 防抖时间：60ms
- 触发场景：DOM 子树变更（如 `/api/version` 返回后 VersionTimeline 渲染新节点）
- 防抖后动作：`scan()` —— 扫描所有 `[data-reveal]:not(.revealed)` 节点并 observe

**评估结论**：
- **60ms 合理，不建议调整**
- 理由：
  1. MutationObserver 触发频率不高（仅异步数据返回或 lazy chunk 加载时触发）
  2. 60ms 防抖能合并 100ms 内的多次 DOM 变更（人眼感知阈值约 100ms）
  3. 缩短到 30ms 会导致 `scan()` 在 lazy chunk 加载时频繁触发（多个 lazy chunk 接连挂载会触发多次 mutation）
  4. 拉长到 200ms 会导致新节点长时间停留 `opacity:0`（视觉延迟明显）
- **可选优化**（与 4.4.1 content-visibility 配合）：
  - 在 lazy chunk 加载完成后主动调用 `scan()`，而非依赖 MutationObserver 60ms 防抖延迟
  - 但这需要在 LazySection 包装器中暴露 scan 方法，增加复杂度，**实施期评估是否值得**

---

## 5. 性能评估标准

### 5.1 量化指标（必须可测量，目标值已上调）

| 指标 | 全称 | 目标值 | 测量工具 | 说明 |
|------|------|--------|---------|------|
| **LCP** | Largest Contentful Paint | **≤ 2.0s** | Lighthouse / Web Vitals API | Hero 区为 LCP 元素 |
| **TBT** | Total Blocking Time | **≤ 150ms** | Lighthouse / Performance 面板 | 主线程长任务总阻塞时间 |
| **CLS** | Cumulative Layout Shift | **≤ 0.05** | Lighthouse / Web Vitals API | lazy chunk 加载不应导致布局抖动 |
| **FID** | First Input Delay | **≤ 80ms** | Lighthouse（实验室模拟）/ Web Vitals API（实测） | 首次交互响应延迟 |
| **INP** | Interaction to Next Paint | **≤ 150ms** | Web Vitals API（实测） | 替代 FID 的更严格指标（v6 推荐） |
| **FCP** | First Contentful Paint | **≤ 1.5s** | Lighthouse / Web Vitals API | 首次内容绘制 |
| **TTI** | Time to Interactive | **≤ 3.0s** | Lighthouse | 主线程可稳定响应交互的时刻 |
| **Speed Index** | Speed Index | **≤ 3.0s** | Lighthouse | 视觉完成度速度 |
| **JS Bundle Gzipped** | 首屏 JS gzipped 总大小 | **≤ 60 KB** | Build 产物统计 | 含 vendor + 首屏 chunk |
| **CSS Gzipped** | 首屏 CSS gzipped | **≤ 5 KB** | Build 产物统计 | critical CSS |
| **粒子动画帧率（L1）** | Particle FPS | **≥ 58fps** | Performance 面板 Frames | 增强后 150 粒子，L1 设备实测，目标 60fps 稳定 |
| **粒子动画帧率（L2 中端）** | Mid-range FPS | **≥ 55fps** | Performance 面板 Frames | L2 设备 90 粒子 |
| **粒子动画帧率（L3 低端）** | Low-end FPS | **≥ 30fps** | Performance 面板 Frames | L3 设备兜底（50 粒子 + 关闭连线） |
| **滚动流畅度** | Scroll FPS | **≥ 55fps** | Performance 面板 Frames（滚动时录制） | 滚动 Hero → Footer 全程帧率 |
| **交互响应延迟** | Interaction Latency | **≤ 50ms** | Performance 面板 / Web Vitals API | 按钮点击到视觉反馈（按压 scale 生效）的时间 |

### 5.2 测量方法

| 工具 | 用途 | 操作方式 |
|------|------|---------|
| **Lighthouse**（Chrome DevTools 集成） | LCP / TBT / CLS / FCP / TTI / Speed Index | DevTools → Lighthouse → Performance → Mobile/Desktop 模式 → Generate report |
| **Chrome DevTools Performance 面板** | 粒子帧率 / 滚动帧率 / 长任务 / 主线程火焰图 / 交互延迟 | DevTools → Performance → Record → 滚动页面 / 点击按钮 → Stop → 查看 Frames / Main thread / Interactions |
| **Web Vitals Chrome 扩展** | 实测 LCP / CLS / INP（真实用户场景） | 安装扩展后访问页面，查看右上角指标 |
| **web-vitals npm 库**（可选） | 程序化上报 RUM 数据 | 在 main.tsx 注入 `onCLS` / `onLCP` / `onINP` 回调，上报到后端 |
| **Build 产物统计** | JS / CSS chunk 大小 | `vite build` 后查看 `dist/assets/` 目录大小，或使用 `rollup-plugin-visualizer` |
| **Network 面板** | HTTP/2 状态 / 资源加载瀑布图 | DevTools → Network → 刷新页面 → 查看 Protocol 列 + Waterfall |
| **Rendering 面板** | 检查 layout thrashing / paint 区域 | DevTools → Rendering → 勾选 "Paint flashing" / "Layout Shift Regions" |

### 5.3 测量环境

| 维度 | 配置 |
|------|------|
| **测试 URL** | `https://trae.ecsrz.com:3000/home` |
| **桌面端设备** | M1 Mac（Chrome 120+），网络：4G 模拟（Fast 3G 不再使用，过于严苛） |
| **移动端设备** | Chrome DevTools 设备模拟：Pixel 5（393×851）+ **CPU 4x 节流** + 网络：Slow 4G |
| **冷加载场景** | 无缓存（DevTools → Network → Disable cache + Application → Clear storage） |
| **暖加载场景** | 有缓存（首次访问后再访问，cache 命中） |
| **测试次数** | 每个场景 ≥ 5 次取中位数（去除最高/最低异常值） |
| **测试时段** | 工作日 10:00-18:00（避免服务器负载波动影响） |
| **测试隔离** | 关闭其他标签页 + 关闭扩展程序（避免扩展干扰测量） |
| **高刷新率验证**（可选） | 在 120Hz / 144Hz 屏幕上额外验证粒子帧率（≥ 100fps）与动画丝滑度 |

### 5.4 基线测量（当前未优化版本 · 干瘪状态）

| 指标 | 估算基线值 | 数据来源 | 备注 |
|------|----------|---------|------|
| LCP | ~3.5-4.5s | 代码分析推断 | 1424 行 JS + 2529 行 CSS 同步加载，Hero 含 ParticleBackground 阻塞；当前为"干瘪状态"基线，优化后期望"丝滑状态" |
| TBT | ~300-500ms | 代码分析推断 | 粒子动画 + 大量 IntersectionObserver 初始化 + CSS 解析 |
| CLS | ~0.05-0.15 | 代码分析推断 | `[data-reveal]` 初始 opacity:0，可能触发 CLS；lazy 加载后需观察 |
| FCP | ~1.5-2.5s | 代码分析推断 | CSS 解析 + JS 执行阻塞 |
| TTI | ~4-6s | 代码分析推断 | 受 TBT 影响显著 |
| 首屏 JS gzipped | ~75 KB | 代码行数估算 | 单 chunk 含全部 vendor + 业务 |
| 首屏 CSS gzipped | ~13 KB | 代码行数估算 | 单文件 2529 行 |
| 粒子动画帧率（L1，当前 90 粒子） | ~55-60fps | 代码分析推断 | 当前粒子数 90，O(n²) 连线计算 |
| 滚动流畅度 | ~45-55fps | 代码分析推断 | 滚动时同步触发多个 IntersectionObserver + reveal 动画 |
| 交互响应延迟 | ~60-100ms | 代码分析推断 | 按钮 transition 0.2s ease，反馈时长偏长 |

**重要说明**：
- 以上基线值为**代码分析推断**，非实测数据
- 实施前应在 `https://trae.ecsrz.com:3000/home` 实测一组真实基线值（"干瘪状态"基线），作为优化前后对比依据
- 标注：`需部署后测量` 的指标项必须在实施前完成实测
- 优化后对照"丝滑状态"目标值逐项验证

### 5.5 优化后预期改善（干瘪 → 丝滑）

| 指标 | 基线（估算·干瘪） | 目标值（丝滑） | 预期改善幅度 |
|------|-----------------|--------------|------------|
| LCP | ~3.5-4.5s | ≤ 2.0s | **-43% ~ -56%** |
| TBT | ~300-500ms | ≤ 150ms | **-50% ~ -70%** |
| CLS | ~0.05-0.15 | ≤ 0.05 | **降低至 1/3**（高度匹配 fallback + content-visibility） |
| FID | ~60-100ms | ≤ 80ms | **-20% ~ -20%**（主线程减负） |
| INP | ~150-250ms | ≤ 150ms | **-40%** |
| FCP | ~1.5-2.5s | ≤ 1.5s | **0% ~ -40%** |
| TTI | ~4-6s | ≤ 3.0s | **-25% ~ -50%** |
| 首屏 JS gzipped | ~75 KB | ≤ 60 KB | **-20%** |
| 首屏 CSS gzipped | ~13 KB | ≤ 5 KB | **-62%**（critical CSS 内联 + async 拆分） |
| 粒子帧率（L1，粒子数 90→150） | ~55-60fps | ≥ 58fps | **粒子数 +67% 同时帧率持平或上升**（算法优化兑现） |
| 滚动流畅度 | ~45-55fps | ≥ 55fps | **+10% ~ +22%**（content-visibility + contain 兑现） |
| 交互响应延迟 | ~60-100ms | ≤ 50ms | **-50%**（按钮 :active 即时反馈 + transition 缩短） |

---

## 6. vite.config.ts 改动边界

### 6.1 改动原则

- **仅新增 `build` 优化项**
- **不改 `server.proxy` 配置**（保留 `/api` 和 `/ws` 代理）
- **不改 `server.port`**（保留 5173）
- **不改 `plugins`**（保留 `react()`，不新增插件）
- **不新增依赖**（`lightningcss` 如不可用则降级为 `esbuild`，不强制安装）

### 6.2 改动前后对比表

| 配置项 | 改动前 | 改动后 | 变更类型 |
|--------|--------|--------|---------|
| `plugins` | `[react()]` | `[react()]`（不变） | 保持 |
| `server.port` | `5173` | `5173`（不变） | 保持 |
| `server.proxy['/api']` | `http://localhost:3000` | 不变 | 保持 |
| `server.proxy['/ws']` | `ws://localhost:3000` | 不变 | 保持 |
| `build.target` | 未配置（默认 `'modules'`） | `'es2020'` | **新增** |
| `build.cssTarget` | 未配置 | `'es2020'` | **新增** |
| `build.cssMinify` | 未配置（默认 `esbuild`） | `'lightningcss'`（降级 `esbuild`） | **新增** |
| `build.assetsInlineLimit` | 未配置（默认 4096） | `4096`（显式声明） | **新增**（显式） |
| `build.modulePreload` | 未配置（默认开启 + polyfill） | `{ polyfill: false, resolveDependencies: ... }` | **新增** |
| `build.rollupOptions.output.manualChunks` | 未配置 | 函数实现（见 2.2） | **新增** |
| `build.rollupOptions.output.chunkFileNames` | 未配置 | `'assets/[name]-[hash].js'` | **新增** |
| `build.rollupOptions.output.entryFileNames` | 未配置 | `'assets/[name]-[hash].js'` | **新增** |
| `build.rollupOptions.output.assetFileNames` | 未配置 | `'assets/[name]-[hash].[ext]'` | **新增** |

### 6.3 改动前后伪代码对比（仅方案示意，非实施代码）

**改动前**（当前 vite.config.ts 完整内容）：

```
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

**改动后**（方案示意，非实施代码——`/apply` 阶段按此结构落地）：

```
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    target: 'es2020',
    cssTarget: 'es2020',
    cssMinify: 'lightningcss',     // 如不可用则降级为 'esbuild'
    assetsInlineLimit: 4096,
    modulePreload: {
      polyfill: false,
      resolveDependencies: (filename, deps, { hostId }) => {
        // 仅首屏入口及其依赖 chunk 需要 modulepreload
        const firstScreenHosts = ['Home.tsx', 'home-navbar', 'home-hero', 'home-footer'];
        if (firstScreenHosts.some(h => hostId.includes(h))) {
          return deps;
        }
        return [];
      },
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react/') || id.includes('react-dom/') || id.includes('scheduler/')) {
              return 'vendor-react';
            }
            if (id.includes('react-router') || id.includes('@remix-run/')) {
              return 'vendor-router';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            return 'vendor-misc';
          }
          return undefined;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
```

### 6.4 改动边界自查清单

- [x] 仅新增 `build` 配置块，不修改 `plugins` / `server` / `server.proxy` / `server.port`
- [x] 不新增第三方依赖（`lightningcss` 是 Vite 6 内置可选，无需 npm install；如降级则用 `esbuild`，零依赖）
- [x] 不修改 `index.html`（preload / prefetch 通过 Vite 自动注入，无需手改 HTML）
- [x] 不修改 `package.json` scripts（`build` 命令保持 `tsc && vite build`）
- [x] 不修改后端 / 数据库 / WebSocket / SSE / 认证相关任何代码

---

## 附录 A：与 spec.md 需求的对照

| spec.md 需求 | 本方案对应章节 | 满足情况 |
|------------|--------------|---------|
| 代码分割策略（Hero + Navbar 首屏优先；非首屏区块 lazy import；IntersectionObserver 触发加载） | 第 1 章 | ✅ 1.2 边界 / 1.3 lazy+Suspense / 1.4 IO 200px 触发 |
| Vite 构建优化配置方案（manualChunks 拆分 vendor、CSS 压缩、target 现代浏览器） | 第 2 章 | ✅ 2.2 manualChunks / 2.3 cssMinify / 2.4 target |
| 资源加载策略（字体子集化、关键 CSS 内联、图片懒加载、prefetch/preload 时机） | 第 3 章 | ✅ 3.1 字体（无 webfont）/ 3.2 critical CSS / 3.3 无 img / 3.4 preload 时机 |
| ~~动画性能预算与降级策略~~ → **动画与视觉效果增强策略**（spec 原条款"性能预算不影响视觉表达关键要素"被重新理解为"含无障碍辅助与极低端兜底，主流方向是增强"，本轮方向调整由用户明确指示） | 第 4 章 | ✅ 4.1 GPU 合成层 / 4.2 粒子增强（150 粒子 + 算法优化）/ 4.3 cubic-bezier + 微交互 / 4.4 渲染路径 / 4.5 高刷新率适配 / 4.6 无障碍辅助路径（原"降级"重新定位） |
| 性能评估标准（LCP/TBT/CLS/FID 目标值 + 测量方法） | 第 5 章 | ✅ 5.1 指标量化（已上调）/ 5.2 方法 / 5.3 环境 |

## 附录 B：与"增强丝滑度"目标的对照

| 视觉元素 | 默认行为（增强后） | 无障碍辅助 / 极低端兜底 | 满足情况 |
|---------|-----------------|---------------------|---------|
| **粒子背景** | 粒子数从 90 增加到 **150（PC 高端）/ 80（touch）/ 90（PC 中端）**；通过空间分区（网格法）+ 距离平方比较 + Path2D 批量绘制 + OffscreenCanvas + Web Worker，在增强粒子数同时保证 ≥ 58fps | prefers-reduced-motion 用户：粒子数减半（75）+ 关闭连线 + 关闭双色；L3 极低端设备：50 粒子 + 关闭连线 | ✅ 增强 + 兜底 |
| **3D 透视** | 保留 `perspective: 1200px` + `rotateX(6deg)`，**新增卡片 hover 视差**（鼠标位置驱动 `rotateX/Y` ±5deg），增加 3D 深度感 | prefers-reduced-motion 用户：关闭 perspective + 关闭视差 | ✅ 保留并增强 |
| **轨道动画** | 保留 `landing2OrbitSpin 40s linear infinite`，通过 `will-change: transform` 提示 GPU 合成层 | prefers-reduced-motion 用户：关闭动画改为静态网格展示 | ✅ 保留并优化 |
| **粒子色彩**（新增） | 从单色橙升级为**橙→青双色渐变**（呼应设计系统双主色），粒子大小 0.5-3.0（原 0.5-2.0），速度 0.2-0.6 随机（原固定 0.4） | prefers-reduced-motion 用户：回退单色橙 | ✅ 新增增强 |
| **连线色彩**（新增） | 连线颜色随两端粒子颜色插值，alpha 仍按距离衰减 | prefers-reduced-motion 用户：关闭连线 | ✅ 新增增强 |
| **缓动函数**（新增） | 所有 transition 从默认 ease / linear 升级为 `cubic-bezier(0.16, 1, 0.3, 1)`（ease-out-expo）或 `cubic-bezier(0.34, 1.56, 0.64, 1)`（ease-out-back） | 不变（reduced-motion 已 transition:none） | ✅ 全面升级 |
| **按钮按压弹性**（新增） | `:active` 时 `transform: scale(0.96)` + 弹性回弹（200ms cubic-bezier-back） | 不变 | ✅ 新增微交互 |
| **卡片 hover 视差**（新增） | hover 时根据鼠标位置 `perspective(800px) rotateX/Y` ±5deg | prefers-reduced-motion 用户：关闭视差 | ✅ 新增微交互 |
| **数字滚动增强**（新增） | useCountUp 从线性改为 ease-out-expo 缓动，"冲刺-刹车"质感 | prefers-reduced-motion 用户：直接显示目标值 | ✅ 新增微交互 |
| **滚动视差**（新增） | Hero 内容与背景按不同速度滚动（0.2x / -0.1x），增加深度感 | prefers-reduced-motion 用户：关闭视差 | ✅ 新增微交互 |
| **鼠标跟随光晕**（新增） | Hero 区跟随鼠标的径向光晕（radial-gradient + transform 更新） | prefers-reduced-motion 用户：关闭 | ✅ 新增微交互 |
| **磁吸按钮**（新增） | 主 CTA 按钮在鼠标靠近时微位移（≤4px），增加灵动感 | prefers-reduced-motion 用户：关闭 | ✅ 新增微交互 |
| **渲染路径**（新增） | content-visibility: auto + contain: layout paint style，让滚动按需渲染 | 不变 | ✅ 新增渲染优化 |
| **高刷新率适配**（新增） | rAF 自然适配 120Hz/144Hz；基于 deltaTime 缩放粒子位移保证速度一致 | 不变 | ✅ 新增帧率适配 |

## 附录 C：未修改代码文件自查

- [x] `frontend/src/pages/Home.tsx` —— **未修改**
- [x] `frontend/src/landing2.css` —— **未修改**
- [x] `frontend/vite.config.ts` —— **未修改**
- [x] `frontend/package.json` —— **未修改**
- [x] `frontend/index.html` —— **未修改**
- [x] `backend/**` —— **未修改**
- [x] `spec.md` / `tasks.md` / `checklist.md` / `summary.md` / `copywriting-strategy.md` / `visual-design-plan.md` —— **均未修改**
- [x] 本方案唯一产出文件：`/home/air/Desktop/factorio/.trae/specs/plan-homepage-beautify-perf/performance-plan.md`
