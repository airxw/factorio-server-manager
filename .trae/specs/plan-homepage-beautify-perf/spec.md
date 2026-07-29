# 主页美化与性能优化方案 (Homepage Beautify & Performance Plan) Spec

## Why

当前项目主页（[Home.tsx](file:///home/air/Desktop/factorio/frontend/src/pages/Home.tsx) 1424 行 + [landing2.css](file:///home/air/Desktop/factorio/frontend/src/landing2.css) 2529 行）已具备完整的工业风视觉骨架（共 13 个区块：Navbar / Hero / LogoCloud / Stats / PainPoints / FeatureShowcase / LiveDemo / ChatJourney / Comparison / UseCases / TechStack / VersionTimeline / DeployCTA / Footer），但在三个维度存在系统性缺口：

1. **文案策略未对齐项目真实定位**——"让腐竹从命令行解放"的核心价值主张未在首屏被高密度传达；部分文案（"10x 效率提升""90% 管理成本降低""100% 开源免费"）缺乏可验证依据，存在夸张承诺风险；缺少统一的文案风格指南，导致各区块语调不一致。
2. **视觉设计与全局设计系统割裂**——[Home.tsx](file:///home/air/Desktop/factorio/frontend/src/pages/Home.tsx) 与 [landing2.css](file:///home/air/Desktop/factorio/frontend/src/landing2.css) 中存在大量硬编码颜色（`rgba(249,115,22,…)`、各 `#xxxxxx` 内联色如 `#22c55e`/`#06b6d4`/`#8b5cf6`/`#ec4899`/`#ef4444`），未走全局 CSS 变量；13 个区块的留白节奏、卡片变体、装饰元素缺乏统一规范。
3. **性能未做优化**——[Home.tsx](file:///home/air/Desktop/factorio/frontend/src/pages/Home.tsx) 单文件 1424 行未做代码分割，[vite.config.ts](file:///home/air/Desktop/factorio/frontend/vite.config.ts) 仅基础配置无 manualChunks；ParticleBackground 默认 90 个粒子 + O(n²) 连线计算，3D 透视/轨道动画对低端设备不友好；缺少 prefers-reduced-motion 降级路径。

本方案在不动业务逻辑与后端 API 的前提下，从**文案、视觉、性能**三个维度对主页做一次系统性的"方案制定"，为后续 `/apply` 阶段提供可执行的依据。**当前阶段只产出方案文档，不修改任何代码。**

## What Changes

- **文案策略**：
  - 重新梳理项目定位与核心价值主张（一句话定位 + 三段式描述）
  - 提炼核心竞争力与差异化卖点矩阵（vs 命令行 / vs 其他 Factorio 管理工具）
  - 制定信息架构与叙事逻辑（13 个区块的递进关系论证，而非简单罗列）
  - 设计文案风格指南（语调、人称、句长、禁用词清单）
  - 产出各区块关键文案要点表（不写代码，只产出要点）
- **视觉设计**：
  - 建立主页专属设计令牌层（继承全局橙 `#f97316` + 青 `#06b6d4` 双主色，补充主页特有的渐变/光晕/玻璃态变量）
  - 输出硬编码颜色 → CSS 变量映射表
  - 制定 13 个区块的信息层级与留白规范
  - 制定统一视觉元素系统规范（卡片变体、标签、徽章、按钮、装饰线条）
  - 制定响应式断点策略（1024/768/480）与移动端简化方案
- **性能优化方案**：
  - 制定代码分割策略（Hero + Navbar 首屏优先；非首屏区块 lazy import；IntersectionObserver 触发加载）
  - 制定 Vite 构建优化配置方案（manualChunks 拆分 vendor、CSS 压缩、target 现代浏览器）
  - 制定资源加载策略（字体子集化、关键 CSS 内联、图片懒加载、prefetch/preload 时机）
  - 制定动画性能预算与降级策略（粒子数量按设备分级、连线距离阈值、prefers-reduced-motion 降级、3D 透视降级）
  - 制定性能评估标准（LCP/TBT/CLS/FID 目标值 + 测量方法）
- **BREAKING**：无（仅方案制定，不动代码）

## Impact

- **Affected specs**：
  - `frontend-comprehensive-ui-polish`（全局设计系统，本方案在主页层面继承而不冲突，边界已在 Task 4.3 标注）
  - `build-factorio-server-manager`（项目主架构）
- **Affected code**（仅在 `/apply` 阶段修改，本阶段不动）：
  - [frontend/src/pages/Home.tsx](file:///home/air/Desktop/factorio/frontend/src/pages/Home.tsx)（1424 行，文案与结构）
  - [frontend/src/landing2.css](file:///home/air/Desktop/factorio/frontend/src/landing2.css)（2529 行，视觉与动画）
  - [frontend/vite.config.ts](file:///home/air/Desktop/factorio/frontend/vite.config.ts)（构建优化）
  - [backend/config/version.json](file:///home/air/Desktop/factorio/backend/config/version.json)（版本元信息，仅用于核对文案中的版本号引用）
- **不影响**：后端 API、数据库、认证、WebSocket、SSE、已登录的 Dashboard / 控制台页面

## ADDED Requirements

### Requirement: 主页文案策略文档化

The system SHALL 提供一份文档化的主页文案策略，明确项目定位、核心价值主张、目标用户画像、信息架构与叙事逻辑、文案风格指南。

#### Scenario: 文案策略可指导后续实施
- **WHEN** 开发者在 `/apply` 阶段阅读文案策略文档
- **THEN** 文档明确回答四个问题：项目是什么、为谁服务、解决什么问题、为什么选我们；并给出每个区块的文案要点与禁用词清单
- **Verification**: `human-judgment`

#### Scenario: 禁用词清单覆盖所有不可验证的夸张词
- **WHEN** 文案策略文档完成
- **THEN** 禁用词清单覆盖"最强""绝对""100%""10x 提升"等不可验证或可能引发争议的词汇，并提供合规替代写法
- **Verification**: `human-judgment`

### Requirement: 主页视觉设计方案文档化

The system SHALL 提供一份文档化的主页视觉设计方案，包含配色系统（基于全局令牌的主页专属变量）、布局信息层级、统一视觉元素规范。

#### Scenario: 视觉方案可指导实施
- **WHEN** 开发者在 `/apply` 阶段按方案修改 landing2.css
- **THEN** 方案明确列出所有需替换的硬编码颜色 → CSS 变量映射表、所有区块的留白/圆角/阴影规范、动画性能预算
- **Verification**: `human-judgment`

#### Scenario: 视觉方案不与全局设计系统冲突
- **WHEN** 视觉方案完成
- **THEN** 主页专属令牌层明确继承自全局令牌（不重新定义主色），仅在主页特有的渐变/光晕/玻璃态等场景补充变量；与 `frontend-comprehensive-ui-polish` 的边界清晰
- **Verification**: `human-judgment`

### Requirement: 主页性能优化方案文档化

The system SHALL 提供一份文档化的主页性能优化方案，包含代码分割策略、资源加载策略、动画性能预算、可量化的评估指标（LCP/TBT/CLS/FID 目标值）。

#### Scenario: 性能方案可指导实施
- **WHEN** 开发者在 `/apply` 阶段按方案修改 vite.config.ts 与 Home.tsx
- **THEN** 方案明确列出：懒加载边界、manualChunks 配置、关键 CSS 范围、粒子动画降级策略、各指标目标值与测量方法
- **Verification**: `human-judgment`

#### Scenario: 性能预算不影响视觉表达的关键要素
- **WHEN** 性能方案完成
- **THEN** 粒子背景、3D 透视、轨道动画等关键视觉元素有明确的降级路径（如低端设备减少粒子数量、关闭连线、关闭 3D 透视），但不在默认配置中移除
- **Verification**: `human-judgment`

## MODIFIED Requirements

（无——本方案只新增方案文档，不修改现有 spec）

## REMOVED Requirements

（无）
