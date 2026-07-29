# 游戏卡片 3D 圆环环绕动效方案 v1.0

## 一、目标

将 Home 页 PackCloud 的 12 张游戏卡片从当前抽象 emoji 风改为：
1. 使用各游戏官方 Wiki 的真实像素/材质素材
2. 鼠标悬停时触发 3D 旋转圆环绕卡片的效果（类似 TRAE Work 的"小果果"环绕）

## 二、技术方案

### 2.1 3D 旋转圆环

纯 CSS 实现，无需 canvas：

```
卡片容器（perspective） 
  └─ 卡片正面（正常内容）
  └─ 3D 场景层（pointer-events: none）
       ├─ img1: rotateY(0deg) translateZ(120px)
       ├─ img2: rotateY(45deg) translateZ(120px)
       ├─ img3: rotateY(90deg) translateZ(120px)
       ├─ img4: rotateY(135deg) translateZ(120px)
       ├─ img5: rotateY(180deg) translateZ(120px)
       ├─ img6: rotateY(225deg) translateZ(120px)
       ├─ img7: rotateY(270deg) translateZ(120px)
       └─ img8: rotateY(315deg) translateZ(120px)
```

CSS 动画：
- 默认静止
- hover 时整个 3D 场景层绕 Y 轴旋转（`@keyframes ring-rotate`）
- 使用 `transform-style: preserve-3d` 保持子元素 3D 位置

### 2.2 游戏素材来源

| 游戏 | 素材 URL 来源 | 图片内容 |
|------|-------------|---------|
| Minecraft | minecraft.wiki/File:*.png | 苦力怕脸、草方块、钻石剑、钻石 |
| Factorio | wiki.factorio.com/File:*.png | 齿轮、组装机、机械臂、传送带 |
| Palworld | 官方 Press Kit / Steam 商店素材 | 帕鲁球、棉悠悠、帕鲁 icon |
| ARK | ark.wiki.gg 或 Steam 商店素材 | 霸王龙、迅猛龙、恐龙蛋 |
| RUST | Steam 商店素材 / Facepunch Press | AK47、齿轮、铁门 |
| DST | dontstarve.wiki.gg/File:*.png | 威尔逊头像、科学机器、暗影燃料 |
| Dyson | Steam 商店素材 | 戴森球、物流塔、机甲 |
| Enshrouded | Steam 商店素材 | 火焰祭坛、迷雾 icon |
| Satisfactory | satisfactory.wiki.gg/File:*.png | FICSIT logo、传送带、组装机 |
| Terraria | terraria.wiki.gg/File:*.png | 史莱姆、剑、矿镐、Boss 召唤物 |
| Valheim | valheim.wiki.gg/File:*.png | 维京盾、船、Boss 头 trophy |
| Zomboid | pzwiki.net/File:*.png | 丧尸 icon、棒球棍、急救包 |

**素材存储路径**：`panel/frontend/public/game-sprites/{game-id}/*.png`

### 2.3 每个游戏配 6 张图（8 张一圈 = 6 张图 + 2 张空白兜底）

图片大小：64x64 或 128x128 PNG，确保加载快。

## 三、实现步骤

### 步骤 1：下载游戏素材到 public/game-sprites/

每个游戏一个文件夹，每个游戏下载 6 张代表性素材。

### 步骤 2：扩展 GameCatalogEntry

在 `game-catalog.ts` 中为每个游戏添加 `sprites: string[]` 字段（指向 public/ 下的素材路径）。

### 步骤 3：新建 GameSpriteRing 组件

```tsx
// components/GameSpriteRing.tsx
// Props: sprites: string[], color: string, active: boolean
// 3D 旋转圆环 + hover 触发旋转动画
```

### 步骤 4：集成到 PackCloud 卡片

每张卡片嵌入 `GameSpriteRing`，hover 时触发旋转。

### 步骤 5：CSS 动画

- `@keyframes ring-spin`：Y 轴 360° 旋转
- 旋转速度：8s/圈
- ease-out 缓动
- 每个 sprite 微小的 Y 轴浮动（`translateY` 正弦波动）

## 四、注意事项

1. 素材版权：从官方 Wiki 下载的 sprite 图用作游戏服务器面板的游戏识别标识，属于描述性使用
2. 图片优化：统一 resize 为 64x64，压缩为 webp 减少体积
3. 性能：CSS 3D transform 走 GPU compositor，不影响主线程
4. 可访问性：`prefers-reduced-motion` 时禁用旋转动画，静态展示
5. 移动端：屏幕 < 768px 时隐藏 3D 环或降低复杂度
