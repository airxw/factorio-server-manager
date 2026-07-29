toolName: no_need_execute
            
status: no_need_execute
          
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role
          

        
            
toolName: search_by_regex
            
status: failed
          
query: active_role|activeRole
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role
          

        
            
toolName: search_by_regex
            
status: failed
          
query: active_role|activeRole
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/schemas.ts
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Forbidden.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/MyAssets.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RoleSwitcherModal.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/mocks/handlers.ts
          
Now let me look at the public type definitions and the Layout.tsx where `user.role` is used in the route/sidebar context:
        
            
toolName: search_by_regex
            
status: failed
          
query: role.*UserRole|UserRole
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx
          

        
            
toolName: search_by_regex
            
status: failed
          
query: isServerAdmin|isInstanceAdminOrHigher
          
Let me verify there are no other files I might have missed and check the Layout.tsx for how `isServerAdmin`/`isInstanceAdminOrHigher` are used for sidebar rendering:
        
            
toolName: search_by_regex
            
status: failed
          
query: \brole\b.*===|===\s*['\"]server_admin|===\s*['\"]instance_admin|===\s*['\"]user['\"]
          

        
            
toolName: search_by_regex
            
status: failed
          
query: getEffectiveRole
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role|const role\s*=
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role|const role\s*=
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role|const role\s*=
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role|const role\s*=
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role|const role\s*=
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role|const role\s*=
          

        
            
toolName: search_by_regex
            
status: failed
          
query: role
          

        
            
toolName: search_by_regex
            
status: failed
          
query: role|user\.
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role|const\s+\w*[Rr]ole\w*\s*=
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role
          

        
            
toolName: search_by_regex
            
status: failed
          
query: user\.role|user\?\.role
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/NodeStatusWidget.tsx
          

        
            
toolName: search_by_regex
            
status: failed
          
query: \.role
          

        
            
toolName: view_files
            
status: failed
          
            
filePath: /home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/Servers.tsx
          
Now I have all the data needed. Let me compile the comprehensive analysis.

---

# `user.role` vs `active_role` 前端使用分析报告

## 一、语义差异

### `user.role` (UserInfo.role)
- **类型**: `UserRole` (`'server_admin' | 'instance_admin' | 'user'`)
- **来源**: 后端 JWT/数据库中 `users.role` 字段，随 `/auth/me`、`/auth/login` 等响应返回
- **含义**: 账户的**原始注册角色** (registered role)。在单角色时代是唯一身份标识
- **状态**: `public/schema/panel-api-types.ts` 第 53 行已标注 `@deprecated v4.17.0 过渡期保留，等同 active_role；v4.18.0 删除。新代码用 active_role`

### `active_role` (UserInfo.active_role)
- **类型**: `UserRole` (可选，optional)
- **来源**: 后端 JWT 中编码的当前活动角色，随登录/角色切换响应返回
- **含义**: **当前会话级活动角色** (current active role for this session)。多角色账号 (`roles.length > 1`) 在登录或切换后，`active_role` 反映本次会话真正生效的角色
- **语义**: 一个 `server_admin` 用户可能将 `active_role` 切换为 `user`，此时所有守卫/重定向/权限判断都应以此 `user` 身份为准

### 工具函数 `getEffectiveRole()` (`utils/role.ts`)
```ts
// line 7-9
export function getEffectiveRole(user: Pick<UserInfo, 'role' | 'active_role'> | null | undefined): string | null {
  if (!user) return null;
  return user.active_role ?? user.role ?? null;
}
```
优先取 `active_role`，缺失时回退到 `role`。这是多角色体系下统一获取"当前有效角色"的推荐方式。

---

## 二、分类汇总

---

### 类别 A: 已正确使用 `active_role` / `getEffectiveRole()` 的位置

| # | 文件 | 行号 | 代码片段 | 说明 |
|---|------|------|---------|------|
| A1 | `panel/frontend/src/components/RequireRole.tsx` | 19 | `const effectiveRole = getEffectiveRole(user);` | 路由守卫，正确使用 `getEffectiveRole` |
| A2 | `panel/frontend/src/pages/Forbidden.tsx` | 23 | `const effectiveRole = getEffectiveRole(user);` | 403 页面角色判断，正确 |
| A3 | `panel/frontend/src/App.tsx` | 172 | `const effectiveRole = getEffectiveRole(user);` | 登录后重定向判角色，正确 |
| A4 | `panel/frontend/src/App.tsx` | 275 | `const effectiveRole = getEffectiveRole(user);` | 实例详情页重定向判角色，正确 |
| A5 | `panel/frontend/src/App.tsx` | 287 | `const effectiveRole = getEffectiveRole(user);` | 实例列表页重定向判角色，正确 |
| A6 | `panel/frontend/src/pages/SelectIdentity.tsx` | 37 | `const effectiveRole = getEffectiveRole(user);` | 身份选择页判断，正确 |
| A7 | `panel/frontend/src/components/Layout.tsx` | 744-751 | `activeRole = (user?.active_role ?? user?.role)` + quickSwitch logic | 快捷切换逻辑，正确使用 active_role |
| A8 | `panel/frontend/src/components/RoleSwitcherModal.tsx` | 72 | `const currentActiveRole = (user.active_role ?? user.role)` | 角色切换弹窗，正确 |
| A9 | `panel/frontend/src/pages/guild/GuildDock.tsx` | 472-473 | `userRoles = (user?.roles ?? (user ? [user.role] : []))` + `currentActiveRole = (user?.active_role ?? user?.role ?? 'user')` | 公会页面多角色判定，正确使用 active_role |
| A10 | `panel/frontend/src/utils/role.ts` | 7-9 | `getEffectiveRole()` 定义 | 工具函数本身，正确 |
| A11 | `panel/frontend/src/mocks/handlers.ts` | 21-52 | `active_role` 在 mock 数据中定义 | Mock 数据，正确 |
| A12 | `panel/frontend/src/api/auth.tsx` | 213-277 | `selectRole` / `switchActiveRole` 实现 | API 层角色切换，正确 |

---

### 类别 B: 使用了 `user.role` 且**应该改用 `active_role`** 的位置（守卫/权限/重定向/侧边栏决策场景）

#### B1. `panel/frontend/src/components/Layout.tsx`

| 子编号 | 行号 | 代码片段 | 上下文 | 影响 |
|--------|------|---------|--------|------|
| **B1a** | 738-740 | `const role = user?.role as string \| undefined; const isServerAdmin = ...; const isInstanceAdminOrHigher = ...;` | 核心角色判断变量，控制**整个侧边栏菜单的可见性分组**（玩家区 / 实例管理区 / 系统管理区 / admin 区） | **高影响**：`server_admin` 切换为 `active_role: 'user'` 后仍看到管理员侧边栏 |
| **B1b** | 987 | `{isServerAdmin && (` | 公会页用户下拉菜单中"平台大盘"入口的显示判断 | 同上：切到 user 后仍可见 |
| **B1c** | 1000 | `{isInstanceAdminOrHigher && (` | 公会页用户下拉菜单中"GM 工作台"入口的显示判断 | 同上 |
| **B1d** | 1186 | `{variant === 'default' && isInstanceAdminOrHigher && !isServerAdmin && (` | 侧边栏"实例管理"分组可见性 | 由 B1a 的 `isInstanceAdminOrHigher` 决定，连锁错误 |
| **B1e** | 1196 | `{(variant === 'admin' \|\| (variant === 'default' && isServerAdmin)) && (` | 侧边栏"系统管理"分组可见性 | 由 B1a 的 `isServerAdmin` 决定，连锁错误 |
| **B1f** | 1257-1263 | `{user.role === 'server_admin' ? '服务器管理员' : user.role === 'instance_admin' ? '实例管理员' : ...}` | 侧边栏底部用户区域**显示的角色中文标签** | 显示的是原始注册角色而非当前活动角色，多角色切换后不一致 |
| **B1g** | 944 | `{ROLE_LABEL_ZH[user.role] ?? user.role}` | 公会风格顶部栏用户下拉菜单中**显示的角色中文标签** | 同上，显示不一致 |

#### B2. `panel/frontend/src/components/CommandPalette.tsx`

| 子编号 | 行号 | 代码片段 | 上下文 | 影响 |
|--------|------|---------|--------|------|
| **B2a** | 116-118 | `const role = user?.role as string \| undefined; const isServerAdmin = ...; const isInstanceAdminOrHigher = ...;` | 命令面板中决定哪些命令可搜索/执行 | 切到 user 后仍可搜索管理员命令 |

#### B3. `panel/frontend/src/components/NodeStatusWidget.tsx`

| 子编号 | 行号 | 代码片段 | 上下文 | 影响 |
|--------|------|---------|--------|------|
| **B3a** | 16 | `const isAdmin = user?.role === 'server_admin' \|\| user?.role === 'instance_admin';` | 节点状态 Widget 仅对管理员显示 | 切到 user 后仍可见节点状态 |

#### B4. `panel/frontend/src/pages/CreateServer.tsx`

| 子编号 | 行号 | 代码片段 | 上下文 | 影响 |
|--------|------|---------|--------|------|
| **B4a** | 38-39 | `const role = user?.role as string \| undefined; const isServerAdmin = ...;` | 控制创建实例页是否显示"强制创建"等管理员操作 | 切到 user 后仍可使用管理员功能 |

#### B5. `panel/frontend/src/pages/Servers.tsx`（顶级）

| 子编号 | 行号 | 代码片段 | 上下文 | 影响 |
|--------|------|---------|--------|------|
| **B5a** | 67-69 | `const role = user?.role as string \| undefined; const isServerAdmin = ...; const isInstanceAdminOrHigher = ...;` | 旧版服务器列表页角色判断 | 切到 user 后产生错误显示 |

#### B6. `panel/frontend/src/pages/Discover.tsx`

| 子编号 | 行号 | 代码片段 | 上下文 | 影响 |
|--------|------|---------|--------|------|
| **B6a** | 60-61 | `const role = user?.role as string \| undefined; const isServerAdmin = ...;` | 发现页角色判断，控制管理员专属功能 | 切到 user 后仍可见管理员功能 |

#### B7. `panel/frontend/src/pages/store/Servers.tsx`

| 子编号 | 行号 | 代码片段 | 上下文 | 影响 |
|--------|------|---------|--------|------|
| **B7a** | 39 | `const isAdmin = (user?.role ?? '').toLowerCase() === 'server_admin';` | GM 工作台实例列表：控制是否"显示全部实例" | 切到 user 后仍能查看全部实例 |

#### B8. `panel/frontend/src/pages/admin/Users.tsx`

| 子编号 | 行号 | 代码片段 | 上下文 | 影响 |
|--------|------|---------|--------|------|
| **B8a** | 351 | `if (!isAdminRole(user?.role)) { return <Navigate to="/forbidden" replace />; }` | 管理员用户管理页的**硬守卫**（使用 `utils/role.ts` 的 `isAdminRole` 函数） | `server_admin` 切到 `instance_admin` 后会被弹到 403 |
| **B8b** | 355 | `const isServerAdmin = user?.role === 'server_admin';` | 决定是否显示批量操作等超管功能 | 用原始 role 判断 |

---

### 类别 C: 使用了 `user.role` 但**属于回退/兼容用途**（可以保留）

| # | 文件 | 行号 | 代码片段 | 理由 |
|---|------|------|---------|------|
| C1 | `panel/frontend/src/components/Layout.tsx` | 744 | `const userRoles = (user?.roles ?? (user?.role ? [user.role] : []))` | 构造 `userRoles` 数组的回退逻辑：当 `roles` 缺失时，用单值 `role` 构造单元素数组。这是兼容旧后端数据的必要回退，**不涉及"当前身份"判断**，保留合理 |
| C2 | `panel/frontend/src/components/RoleSwitcherModal.tsx` | 71 | `const userRoles = (user.roles ?? [user.role])` | 同上：构造角色集合的回退 |
| C3 | `panel/frontend/src/pages/guild/GuildDock.tsx` | 472 | `const userRoles = (user?.roles ?? (user ? [user.role] : []))` | 同上：构造角色集合的回退 |
| C4 | `panel/frontend/src/mocks/handlers.ts` | 231 | `const userRoles = user.roles ?? [user.role];` | Mock 数据处理，回退逻辑 |
| C5 | `panel/frontend/src/utils/role.ts` | 9 | `user.active_role ?? user.role ?? null` | `getEffectiveRole()` 自身的 fallback 逻辑，正确的设计 |

---

### 类别 D: 使用了 `user.role` 但属于**纯展示用途**（数据展示，非决策判断）

| # | 文件 | 行号 | 代码片段 | 理由 |
|---|------|------|---------|------|
| D1 | `panel/frontend/src/pages/MyAssets.tsx` | 147-148 | `roleBadgeClass(data.user.role ?? user?.role)` + `roleLabel(data.user.role ?? user?.role)` | 资产页展示后端返回的 `data.user.role`（从 API 响应来），展示的是"资产所有者的角色"，非当前用户. 但 `data.user.role` 是 API 返回数据，`user?.role` 是当前用户. 此处展示的是 API 返回的角色 badge。**建议**：如果 `data.user` 是当前用户自身，应优先展示 `active_role` |
| D2 | `panel/frontend/src/pages/Profile.tsx` | 432 | `roleBadgeClass(user?.role)` + `roleLabel(user?.role)` | 个人设置页展示角色标签。用户看到的应该是当前活动角色，**建议改用 `active_role`** |

---

## 三、影响严重性排序

| 优先级 | 文件 | 子编号 | 场景 | 严重性 |
|--------|------|--------|------|--------|
| **P0-致命** | `Layout.tsx` | B1a | 侧边栏菜单分组决策（`isServerAdmin`/`isInstanceAdminOrHigher`） | 高：多角色切换后侧边栏完全不正确 |
| **P0-致命** | `admin/Users.tsx` | B8a | 管理员页面的硬守卫（`isAdminRole(user?.role)`） | 高：`server_admin` 切到其他角色会被误 403 |
| **P1-严重** | `Layout.tsx` | B1f, B1g | 侧边栏/顶部栏角色中文标签显示 | 中：UI 不一致，用户困惑 |
| **P1-严重** | `CommandPalette.tsx` | B2a | 命令面板角色过滤 | 中：切到 user 后仍能搜到管理员命令 |
| **P1-严重** | `CreateServer.tsx` | B4a | 创建实例页管理员功能 | 中：切到 user 后仍可绕过配额 |
| **P1-严重** | `store/Servers.tsx` | B7a | GM 工作台"查看全部实例" | 中：权限泄漏 |
| **P2-一般** | `NodeStatusWidget.tsx` | B3a | 节点状态 Widget | 低：仅 UI 组件控制 |
| **P2-一般** | `Servers.tsx` | B5a | 旧版服务器列表判断 | 低：旧代码路径 |
| **P2-一般** | `Discover.tsx` | B6a | 发现页角色判断 | 低 |
| **P2-一般** | `Profile.tsx` | D2 | 个人页角色标签 | 低：纯展示 |
| **P2-一般** | `MyAssets.tsx` | D1 | 资产页角色标签 | 低：展示 API 返回数据 |

---

## 四、关键发现

1. **`RequireRole` 路由守卫已经正确使用 `getEffectiveRole()`**（类别 A1），这意味着路由级权限已经正确适配多角色。核心问题在于 `Layout.tsx` 中控制侧边栏的 `isServerAdmin`/`isInstanceAdminOrHigher` 仍用裸 `user.role`，导致侧边栏与路由守卫产生**断崖式不一致**：路由守卫基于 `active_role` 正确重定向到 `/forbidden`，但侧边栏仍然显示管理员菜单。

2. **所有 6 个页面/组件采用了相同的反模式**：
   ```tsx
   const role = user?.role as string | undefined;
   const isServerAdmin = role === 'server_admin' || role === 'system_admin' || role === 'admin';
   ```
   出现于 `Layout.tsx`、`CommandPalette.tsx`、`CreateServer.tsx`、`Servers.tsx`、`Discover.tsx`、`NodeStatusWidget.tsx`。应该统一替换为：
   ```tsx
   const effectiveRole = getEffectiveRole(user);
   const isServerAdmin = isAdminRole(effectiveRole);       // from utils/role.ts
   const isInstanceAdminOrHigher = isInstanceAdminOrAbove(effectiveRole);
   ```

3. **`admin/Users.tsx` 第 351 行的守卫**使用了 `isAdminRole(user?.role)` 而非基于 `active_role`，这是唯一一个除了 `RequireRole` 外有自己硬守卫的管理页面。应改为 `isAdminRole(effectiveRole)`。

4. **`Layout.tsx` 第 738-740 行的模式**是影响面最大的——几乎所有其他 `user.role` 误用都是复制了同一段角色判断代码。

5. **B8b** (`admin/Users.tsx` line 355 `isServerAdmin = user?.role === 'server_admin'`) 有一个微妙之处：在用户管理页面中，判断当前操作者是否为 `server_admin`（以展示批量操作等超管功能），此时应基于 `active_role` 判断（因为用户已经选了当前身份来操作），而非原始 `role`。

---

## 五、修复建议模式

所有"应该改用 `active_role`"的位置（类别 B + D2），统一推荐以下替换：

```tsx
// 旧代码（反模式）
const role = user?.role as string | undefined;
const isServerAdmin = role === 'server_admin' || role === 'system_admin' || role === 'admin';
const isInstanceAdminOrHigher = isServerAdmin || role === 'instance_admin';

// 新代码（推荐）
import { getEffectiveRole, isAdminRole, isInstanceAdminOrAbove } from '../utils/role';
const effectiveRole = getEffectiveRole(user);
const isServerAdmin = isAdminRole(effectiveRole);
const isInstanceAdminOrHigher = isInstanceAdminOrAbove(effectiveRole);
```

对于仅显示角色标签的位置（如 B1f、B1g、D2），使用 `effectiveRole` 替代 `user.role`。

共计 **15 个使用点**需要评估修改（类别 B 中的 12 个 + 类别 D 中的 2 个建议改），涉及 **9 个文件**。
        
          
## `user.role` vs `active_role` 使用分析

### 一、语义差异

| | `user.role` | `active_role` |
|---|---|---|
| **含义** | 账户**原始注册角色**（`users.role` 字段） | 当前**会话级活动角色**（本次登录/切换后的实际身份） |
| **来源** | 后端 `/auth/me` 响应 | 后端 `/auth/me` 响应（v4.17.0+） |
| **变化性** | 固定不变（注册时确定） | 可切换（多角色账号切换后变） |
| **状态** | 已在 `public/schema/panel-api-types.ts` 标记 `@deprecated` | 多角色体系的正确答案 |

工具函数 [getEffectiveRole()](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts#L7-L9) 优先取 `active_role`，缺失时回退 `role`——这是推荐用法。

---

### 二、分类总览

#### 类别 A：已正确使用 `active_role` / `getEffectiveRole()`（12 处）

| 文件 | 行号 | 场景 |
|------|------|------|
| [RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx#L19) | 19 | 路由守卫 |
| [Forbidden.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Forbidden.tsx#L23) | 23 | 403 页角色判定 |
| [App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L172) | 172 | 登录后重定向 |
| [App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L275) | 275 | 实例详情重定向 |
| [App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L287) | 287 | 实例列表重定向 |
| [SelectIdentity.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SelectIdentity.tsx#L37) | 37 | 身份选择页 |
| [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L744) | 744 | 快捷切换逻辑 |
| [RoleSwitcherModal.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RoleSwitcherModal.tsx#L72) | 72 | 角色切换弹窗 |
| [GuildDock.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L472) | 472 | 公会多角色判定 |
| [role.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts#L7) | 7-9 | `getEffectiveRole()` 定义 |
| [handlers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/mocks/handlers.ts#L21) | 21-52 | Mock 数据 |
| [auth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx#L213) | 213-277 | API 层 switch |

---

#### 类别 B：使用 `user.role` 且**应改用 `active_role`**（12 处，6 文件）

**B1. [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx) — 影响最大**

| 子编号 | 行号 | 代码 | 影响 |
|--------|------|------|------|
| B1a | 738-740 | `const role = user?.role; const isServerAdmin = ...` | **侧边栏菜单分组决策**：`server_admin` 切到 `user` 后仍见管理员菜单 |
| B1b | 987 | `{isServerAdmin && (` | 公会页下拉菜单"平台大盘"入口 |
| B1c | 1000 | `{isInstanceAdminOrHigher && (` | 公会页下拉菜单"GM 工作台"入口 |
| B1d | 1186 | `{isInstanceAdminOrHigher && !isServerAdmin && (` | 侧边栏"实例管理"分组 |
| B1e | 1196 | `{(isServerAdmin) && (` | 侧边栏"系统管理"分组 |
| B1f | 1257-1263 | `{user.role === 'server_admin' ? ...}` | 侧边栏角色**中文标签显示** |
| B1g | 944 | `{ROLE_LABEL_ZH[user.role]}` | 顶部栏角色**中文标签显示** |

**B2. [CommandPalette.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/CommandPalette.tsx#L116-L118)**

| 子编号 | 行号 | 影响 |
|--------|------|------|
| B2a | 116-118 | 命令面板角色过滤：切到 user 后仍可搜管理员命令 |

**B3. [NodeStatusWidget.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/NodeStatusWidget.tsx#L16)**

| 子编号 | 行号 | 影响 |
|--------|------|------|
| B3a | 16 | 节点状态 Widget：切到 user 后仍可见 |

**B4. [CreateServer.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/CreateServer.tsx#L38-L39)**

| 子编号 | 行号 | 影响 |
|--------|------|------|
| B4a | 38-39 | 创建实例页管理员功能：切到 user 后可用 |

**B5. [store/Servers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/Servers.tsx#L39)**

| 子编号 | 行号 | 影响 |
|--------|------|------|
| B5a | 39 | GM 工作台"显示全部实例"：切到 user 后仍可见全部实例 |

**B6. [admin/Users.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx#L351)**

| 子编号 | 行号 | 影响 |
|--------|------|------|
| B6a | 351 | `isAdminRole(user?.role)` 硬守卫：`server_admin` 切到 `instance_admin` 后被弹 403 |
| B6b | 355 | `user?.role === 'server_admin'`：批量操作等超管功能 |

---

#### 类别 C：使用 `user.role` 但属于兼容回退（保留合理，5 处）

| 文件 | 行号 | 代码 | 理由 |
|------|------|------|------|
| [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L744) | 744 | `user?.roles ?? [user.role]` | 构造多角色数组的 fallback，不涉及"当前身份"决策 |
| [RoleSwitcherModal.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RoleSwitcherModal.tsx#L71) | 71 | `user.roles ?? [user.role]` | 同上 |
| [GuildDock.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L472) | 472 | `user?.roles ?? [user.role]` | 同上 |
| [handlers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/mocks/handlers.ts#L231) | 231 | `user.roles ?? [user.role]` | Mock 数据兼容 |
| [role.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts#L9) | 9 | `active_role ?? role` | `getEffectiveRole()` 自身的 fallback，设计正确 |

---

#### 类别 D：使用 `user.role` 纯展示用途（2 处，建议改）

| 文件 | 行号 | 代码 | 理由 |
|------|------|------|------|
| [Profile.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Profile.tsx#L432) | 432 | `roleBadgeClass(user?.role)` | 个人页角色标签：应展示当前活动角色 |
| [MyAssets.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/MyAssets.tsx#L147) | 147 | `roleBadgeClass(data.user.role)` | 资产页展示 API 返回的角色，取决于 `data.user` 是否为当前用户 |

---

### 三、关键发现

1. **断崖式不一致**：[RequireRole](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx) 路由守卫已正确用 `getEffectiveRole()`，但 [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L738) 侧边栏仍用裸 `user.role`。结果是：路由正确重定向到 `/forbidden`，但侧边栏仍显示管理员菜单。

2. **同一反模式被复制 6 次**：
   ```tsx
   const role = user?.role as string | undefined;
   const isServerAdmin = role === 'server_admin' || role === 'system_admin' || role === 'admin';
   ```
   出现在 `Layout.tsx`、`CommandPalette.tsx`、`CreateServer.tsx`、`Servers.tsx`、`Discover.tsx`、`NodeStatusWidget.tsx`，应统一替换为 `getEffectiveRole(user)` + `utils/role.ts` 中的 `isAdminRole()` / `isInstanceAdminOrAbove()`。

3. **[admin/Users.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx#L351) 第 351 行**有一个独立的硬守卫 `isAdminRole(user?.role)`，是多角色切换后的致命缺陷：`server_admin` 切到 `instance_admin` 即被弹 403。

4. **影响面最大的是 [Layout.tsx 第 738 行](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L738)** 的 `B1a`——其 `isServerAdmin` / `isInstanceAdminOrHigher` 变量被后续 6 处（B1b~B1g）消费，是全站侧边栏的不正确根源。