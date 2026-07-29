# Home 页面优化方案 v1.0

> 基于游戏特色调研结果，对 `https://gsp.ecsrz.com:3001/home` 页面进行重构

## 一、背景与现状

### 1.1 问题
- Home 页面展示了10款游戏，但其中5款（CS2/GTA5/Terraria/DST/Stardew Valley）是虚构的，与项目实际支持的游戏不符
- 项目实际支持12款游戏（见 admin/packs），但 Home 只展示了5款真实的 + 5款虚构的
- `#minecraft` 锚点切换功能仅支持 minecraft/factorio 两个游戏
- 现有动画效果质量差，用户反馈"渲染出来的效果实在太差了"
- 点击切换动效不符合对应游戏风格

### 1.2 实际支持的游戏（来自 admin/packs）
1. Minecraft（我的世界）- `minecraft-vanilla`
2. Factorio（异星工厂）- `factorio-vanilla`
3. Palworld（幻兽帕鲁）- `palworld-vanilla`
4. ARK（方舟：生存进化）- `ark-vanilla`
5. RUST（腐蚀）- `rust-vanilla`
6. DST（饥荒联机版）- `dst-vanilla`
7. Dyson Sphere Program（戴森球计划）- `dyson-vanilla`
8. Enshrouded（雾锁王国）- `enshrouded-vanilla`
9. Satisfactory（幸福工厂）- `satisfactory-vanilla`
10. Terraria（泰拉瑞亚）- `terraria-vanilla`
11. Valheim（英灵神殿）- `valheim-vanilla`
12. Project Zomboid（僵尸毁灭工程）- `zomboid-vanilla`

## 二、设计原则

1. **真实对齐**：Home 页面展示的12款游戏必须与 admin/packs 完全一致
2. **风格统一**：每款游戏有独立的主题色系和视觉风格
3. **锚点可访问**：支持 `#minecraft`、`#factorio` 等所有12款游戏的锚点切换
4. **动效游戏化**：点击切换时，粒子动效采用对应游戏的视觉元素
5. **渐进增强**：保留现有 MinecraftLanding/FactorioLanding 专题页，其他游戏使用详情模态框

## 三、技术架构

### 3.1 GameThemeContext 扩展

将 `GameThemeId` 从 `'default' | 'minecraft' | 'factorio'` 扩展为支持12种游戏主题：

```typescript
export type GameThemeId =
  | 'default'
  | 'minecraft'
  | 'factorio'
  | 'palworld'
  | 'ark'
  | 'rust'
  | 'dst'
  | 'dyson'
  | 'enshrouded'
  | 'satisfactory'
  | 'terraria'
  | 'valheim'
  | 'zomboid';
```

### 3.2 12种游戏主题色系

| 游戏 | 主色 | 辅色 | 强调色 | 粒子形状 | 视觉风格 |
|------|------|------|--------|---------|---------|
| Minecraft | `#22c55e` 草绿 | `#16a34a` 深绿 | `#4ade80` 亮绿 | square | 像素方块 |
| Factorio | `#f97316` 橙 | `#ea580c` 深橙 | `#fb923c` 亮橙 | circle | 工业齿轮 |
| Palworld | `#06b6d4` 青 | `#0891b2` 深青 | `#22d3ee` 亮青 | circle | 明亮可爱 |
| ARK | `#a855f7` 紫 | `#9333ea` 深紫 | `#c084fc` 亮紫 | circle | 恐龙丛林 |
| RUST | `#ef4444` 红 | `#dc2626` 深红 | `#f87171` 亮红 | square | 荒野废土 |
| DST | `#f97316` 暗橙 | `#7c2d12` 棕 | `#fbbf24` 黄 | circle | 哥特暗黑 |
| Dyson | `#3b82f6` 蓝 | `#1e40af` 深蓝 | `#60a5fa` 亮蓝 | circle | 科幻太空 |
| Enshrouded | `#8b5cf6` 紫雾 | `#6d28d9` 深紫 | `#a78bfa` 亮紫 | circle | 奇幻迷雾 |
| Satisfactory | `#eab308` 黄 | `#ca8a04` 深黄 | `#facc15` 亮黄 | square | 工业未来 |
| Terraria | `#10b981` 绿 | `#059669` 深绿 | `#34d399` 亮绿 | square | 多彩像素 |
| Valheim | `#64748b` 青灰 | `#475569` 深灰 | `#94a3b8` 亮灰 | circle | 北欧薄暮 |
| Zomboid | `#84cc16` 灰绿 | `#65a30d` 深绿 | `#a3e635` 亮绿 | square | 末日灰暗 |

### 3.3 锚点路由实现

- URL hash 变化触发主题切换：`#minecraft` → minecraft 主题
- 浏览器前进/后退支持
- localStorage 持久化用户最后选择的主题
- 所有12款游戏均支持锚点切换

### 3.4 PackCloud 卡片交互

- 卡片悬停：展示游戏详细特性列表（基于调研结果）
- 卡片点击：
  - Minecraft/Factorio：切换到专题页（保留现有 MinecraftLanding/FactorioLanding）
  - 其他10款游戏：打开详情模态框（展示游戏特色、配置、视觉风格）
- 卡片动效：悬停时主题色光晕、缩放、阴影增强

### 3.5 粒子转场动画优化

优化 `ParticleTransition` 组件：
- 粒子数量从默认值调整为更具视觉冲击力的数量
- 粒子颜色采用目标游戏主题色
- 粒子形状根据游戏风格切换（square/circle）
- 转场时长优化，减少卡顿感
- 添加模糊和发光效果

## 四、执行步骤

### 步骤1：扩展 GameThemeContext（核心基础）
- 修改 `GameThemeId` 类型，支持12种游戏
- 扩展 `GAME_THEMES` 配置，为每个游戏定义独立的色系
- 更新 `getInitialTheme()` 支持所有12种 hash 值
- 更新 hashchange 监听器
- 更新 `switchGame()` 方法

### 步骤2：修正 PACKS 数据（真实对齐）
- 将 PACKS 数组替换为12款真实游戏数据
- 每款游戏包含基于调研结果的详细说明：
  - 完整游戏名称（中文+英文）
  - 游戏分类（沙盒/生存/工业/射击等）
  - 端口配置（来自 pack.yaml）
  - 5项核心特色功能（来自调研）
  - 视觉风格描述
  - 服务器管理特色

### 步骤3：优化 PackCloud 组件
- 卡片悬停动效：主题色光晕、缩放、阴影
- 卡片点击逻辑：所有12款游戏均可点击
- 详情模态框：展示游戏完整信息
- 卡片网格布局优化

### 步骤4：优化粒子转场动画
- 优化 ParticleTransition 组件
- 粒子形状根据目标游戏切换
- 粒子颜色采用目标游戏主题色
- 添加模糊和发光效果
- 优化转场时长和缓动函数

### 步骤5：优化 landing.css 动画效果
- 优化卡片悬停动画（更平滑的过渡）
- 优化模态框动画（更优雅的进入/退出）
- 优化粒子转场视觉效果
- 添加游戏风格化的视觉元素

### 步骤6：构建与部署
- 构建前端
- 验证无 localhost:3000 违规
- 部署到生产服务器
- 浏览器测试验证

## 五、验证清单

- [ ] PACKS 数据包含12款真实游戏（与 admin/packs 一致）
- [ ] GameThemeContext 支持12种游戏主题
- [ ] 锚点路由 `#minecraft` 等所有12款游戏均可访问
- [ ] 卡片悬停展示详细特性列表
- [ ] 卡片点击切换主题或显示详情
- [ ] 粒子转场动画流畅无卡顿
- [ ] 粒子颜色和形状匹配目标游戏风格
- [ ] 模态框动画优雅流畅
- [ ] 构建验证通过（无 localhost:3000）
- [ ] 生产环境部署成功
- [ ] 主流浏览器测试通过

## 六、注意事项

1. **保留现有专题页**：MinecraftLanding 和 FactorioLanding 专题页保持不变，继续作为这两个游戏的深度展示页
2. **渐进增强**：其他10款游戏暂不制作专题页，仅通过卡片+模态框展示
3. **性能考虑**：粒子数量适中，避免过度渲染导致卡顿
4. **向后兼容**：现有 `#minecraft` 和 `#factorio` 锚点继续可用
5. **localStorage 持久化**：用户选择的游戏主题会被记住
