# Task 4 输出 — 前端 GuildDock 合并展示

> 来源：[tasks.md Task 4](./tasks.md)
> 阶段：S4 并行开发
> 执行者：general_purpose_task subagent
> 日期：2026-07-30

## 一、工程过程（已完成）

按 tasks.md Task 4 步骤，仅修改 [GuildDock.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/guild/GuildDock.tsx)：

1. **删除两个独立 section**：原 L553-L659 的「账户级绑定」section + 「游戏角色绑定」section 已删除。
2. **删除两个局部卡片组件**：`AccountBindingCard`（局部）+ `PlayerBindingCard`（局部）已删除，替换为新的 `UnifiedBindingCard`。
   - 注意：`panel/frontend/src/pages/guild/components/AccountBindingCard.tsx` 是独立的共享组件（供 GuildBind / ServerDetailCore 复用），**未被触碰**，与本次删除的 GuildDock 局部函数同名但无关。
3. **新增 `aggregated` useMemo**（位于 serverMap 之后）：按 `server_id` 聚合 `accountBindings`（MyBinding，camelCase，字段 `serverId`/`vipLevel`）+ `playerBindings`（Binding，snake_case，字段 `scope_ref`=server_id）。
   - 相比 spec 提供代码做了类型安全增强：`server` 字段类型为 `ServerSummary | undefined`（spec 原代码用 `serverMap.get(sid)!` 非空断言，存在 serverMap 缺项时运行时崩溃风险），并在 `UnifiedBindingCard` 内 `if (!server) return null` 防御。
4. **新增 `UnifiedBindingCard` 组件**：
   - 头部：实例名（`server.name`）+ 游戏类型（`server.game_type`）
   - 徽章：VIP 等级（来自 `account.vipLevel`，>0 显示金色 VIP 徽章，否则「未开通 VIP」蓝色徽章）+ 角色验证状态（players 中 verified 数量，>0 显示绿色「已验证 N 角色」徽章，否则「未验证角色」灰徽章）
   - 操作：「进入实例」（→ `/guild/servers/${server.id}`）+「管理绑定」（→ `/guild/bind`）
   - 保留 v4.17.0 pending 验证码首页直接展示（不跳转 Profile），每个 pending player 展示验证码 + 复制按钮
5. **空状态**：保留「立即绑定游戏角色」主 CTA（→ `/guild/bind`）+ 次要「浏览服务器」（→ `/guild/servers`，保留 `UsersRound` 图标复用）。
6. **移动端视口守卫（rules-0 §3.1.6）**：根容器已是 `minHeight: '100dvh'`（非 `height: 100vh`），允许自然滚动，无溢出风险，未引入全屏 height 强制，合规。
7. **头部注释更新**：v4.17.0 注释第 2 项更新为「合并为单一『我的绑定』分区」。

## 二、交接状态

| 闭合判据 | 状态 | 证据 |
|----------|------|------|
| tsc --noEmit 通过 | ✅ 已完成 | exit 0，无错误输出 |
| vite build 通过 | ✅ 已完成 | exit 0，`✓ built in 6.74s`，GuildDock chunk 16.27 kB |
| 两个独立 section 已删除 | ✅ 已完成 | 见 diff |
| 新增 aggregated useMemo | ✅ 已完成 | GuildDock.tsx serverMap 之后 |
| UnifiedBindingCard 展示 VIP + 角色验证徽章 | ✅ 已完成 | 组件内徽章行 |
| 空状态保留「立即绑定游戏角色」主 CTA | ✅ 已完成 | 空态分支 |
| 移动端视口无溢出 | ✅ 已完成 | 根容器 minHeight:100dvh，无 height:100vh |

## 三、最终结果

### 产出物
- 修改文件：`panel/frontend/src/pages/guild/GuildDock.tsx`（仅此一个）
- 第二落点：本文件

### 验证命令结果
```bash
cd /home/airxw/gsp/panel/frontend
npx tsc --noEmit   # exit 0
npx vite build     # exit 0，✓ built in 6.74s
```

### 关键发现 / 待办交接

1. **e2e 测试需 Task 8 更新**（阻断 e2e，不阻断本 Task 闭合）：
   - `panel/frontend/e2e/guild-portal.spec.ts:28` 断言 `page.getByText('游戏角色绑定')` 可见 → **现已失效**（section 标题改为「我的绑定」）。
   - `guild-portal.spec.ts:76-80` 测试名引用「游戏角色绑定」分区，但断言的是 `button name:'管理'`（合并 section 仍保留该按钮），逻辑上可过，但测试名/注释需 Task 8 同步更新。
   - Task 8 步骤 5「GuildDock 首页单卡展示断言更新」覆盖此点。
2. **未触碰范围**：GuildBind.tsx（Task 5）、ServerDetailCore.tsx（Task 6）、后端代码、`public/` 契约、版本号文件。
3. **未引入任何 URL**：navigate 调用均为相对路径（`/guild/bind`、`/guild/servers`、`/guild/servers/${id}`），无 localhost/127.0.0.1 违规（rules 0.md §一/§四）。

### s0402 前端三重闸门状态：当前不可判定（subagent 限制）

- **Test1（单元测试）**：无 GuildDock 专属单测；e2e 断言更新属 Task 8。subagent 不编写 Task 8 的测试。
- **Test2（内置浏览器核对）**：subagent 工具集不含 `browser_*` / 内置浏览器工具，**无法执行**。tasks.md Task 4 闭合判据「内置浏览器核对首页单卡展示」需主线程用内置浏览器执行。
- **Test3（Mock 回归）**：本次改动为 UI 聚合展示，无 Mock 路径变更，不适用。
- **提醒主线程**：请主线程在合流前用内置浏览器对 `/guild` 首页做单卡展示核对（有绑定 / 空态两种场景），并确认 Task 8 已更新 e2e 断言。
