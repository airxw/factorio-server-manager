# Test2 — 内置浏览器核对 — Forbidden Page Fix v4.37.1

**执行时间**: 2026-07-30 12:33 (Asia/Shanghai)
**执行工具**: 内置浏览器（browser_use subagent）— 非 Playwright
**目标地址**: http://127.0.0.1:5173/ （vite dev server，proxy → 127.0.0.1:3002 本地 panel backend）

## 验证目标

1. 修复新注册用户被重定向到 /forbidden 的 bug（Register.tsx /dashboard → /）
2. /forbidden 页新设计（Apple 浅色风格卡片）正确渲染
3. "返回首页"按钮按角色路由到正确基座

## 执行步骤与证据

### STEP 1 — 注册页加载
- 导航到 http://127.0.0.1:5173/register
- 页面标题: 「注册 - GameServer Panel」
- 邮箱/用户名/密码/确认密码输入框 + 「注册」按钮均可见
- 控制台无报错
- 截图: 已保存
- 状态: PASS

### STEP 2 — 注册表单提交
- 邮箱: test-forbidden-fix-1753878000@test.local
- 用户名: testfix1753878000
- 密码: TestFix1234
- 提交成功
- 截图: 已保存
- 状态: PASS

### STEP 3 — 关键验证：注册后跳转 URL
- **实际 URL**: http://127.0.0.1:5173/guild （玩家门户）
- **预期 URL**: http://127.0.0.1:5173/guild
- **未出现** /forbidden — bug 已修复
- 截图: 已保存（玩家门户正常显示）
- 状态: PASS — bug fix verified

### STEP 4 — Forbidden 新设计渲染
- 直接访问 http://127.0.0.1:5173/admin/users （admin-only 路由）
- 被重定向到 http://127.0.0.1:5173/forbidden
- **新设计元素全部呈现**:
  - 居中圆角卡片（带阴影 box-shadow: var(--shadow-md)）
  - 顶部蓝色圆形盾牌图标（ShieldAlert，背景 var(--color-primary-bg)）
  - 眉标: 「403 · 访问受限」（uppercase, letter-spacing 0.08em）
  - 标题: 「抱歉，您没有权限访问该页面」
  - 提示文案: 「当前身份无权查看此内容。如果您拥有多个身份，可切换后继续；或返回首页查看可用功能。」
  - 「返回首页」按钮（btn-primary）
- 非纯文本 403 页面，符合 Apple 浅色设计语言
- 截图: 已保存
- 状态: PASS — new design verified

### STEP 5 — 返回首页按钮
- 点击「返回首页」按钮
- 导航到 http://127.0.0.1:5173/guild （user 角色对应基座）
- 玩家门户正常显示
- 截图: 已保存
- 状态: PASS — role-based home routing verified

## 浏览器控制台日志
- 无 error / warning
- 无未捕获的 Promise rejection

## 结论
Test2 PASS — 端到端验证：新注册用户不再被重定向到 /forbidden（落在 /guild）；/forbidden 新设计正确渲染；返回首页按钮按角色路由到 /guild。

## 注意
- 邮箱输入框因 type=email 类型限制，subagent 通过 evaluate 脚本设置 value 补全表单（不影响表单提交与后端注册流程的真实性）
- 本次测试在本机 dev backend (127.0.0.1:3002) 创建了测试账号 testfix1753878000，未触碰生产数据库
