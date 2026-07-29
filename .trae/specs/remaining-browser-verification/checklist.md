# 剩余验证项浏览器端到端验证 - 验证清单

## 登录与认证
- [x] 登录页正常加载，表单与 demo 按钮正确渲染
- [x] demo 管理员一键登录成功，/api/auth/login 返回 200
- [x] 登录后 JWT token 存入 localStorage（key: panel_token）
- [x] 登录后跳转至正确页面（/dashboard）

## 实例列表
- [x] /api/servers 返回 200，列表包含 owner_username 字段（11 个实例）
- [x] 实例列表展示归属者列、版本号列、状态徽章
- [x] 表格/卡片布局正常，无横向溢出

## 实例详情 Tab（Factorio Pack）
- [x] Tab 列表包含 Factorio 特有 Tab（配置文件/世界生成/Mod/存档/聊天日志/玩家历史/更新）
- [x] 配置文件 Tab：编辑器正常渲染，保存按钮存在
- [x] 世界生成 Tab：页面正常加载，再生按钮存在
- [x] Mod Tab：列表结构正确，开关/添加/删除按钮可用
- [x] 存档 Tab：列表结构正确，创建/激活/删除按钮存在
- [x] 聊天日志 Tab：时间/玩家/消息列展示正常
- [x] 玩家历史 Tab：进出记录列表正确渲染
- [x] 切换所有 Tab 无控制台 error

## 实例详情 Tab（Minecraft Pack）
- [x] Tab 数量少于 Factorio（无世界生成等），与 Pack.ui_tabs 匹配
- [x] 各 Tab 页面加载正常

## 聊天命令相关
- [x] 玩家绑定页：验证码展示区、绑定说明、绑定状态正确显示
- [x] 聊天触发器 Tab：列表含 mode 和 cooldown 列
- [x] 聊天触发器：新建/编辑表单有 mode 和 cooldown 输入项
- [x] 玩家加入设置：表单含欢迎消息和离开消息两个输入框
- [x] Profile 页：玩家绑定入口卡片存在

## 管理后台
- [x] 用户管理页：用户列表含角色列，编辑/删除操作可用
- [x] Pack 管理页：5 款 Pack 信息展示，重载按钮可用
- [x] /api/packs 返回 200 且包含至少 5 个 pack
- [x] 系统健康页：CPU/内存/磁盘资源卡 + 服务状态列表
- [x] /api/system/metrics 返回 200
- [x] /api/system/health 返回 200
- [x] 诊断页：点击执行后返回结构化结果
- [x] /api/system/diagnostics POST 返回 200
- [x] 实例清理页：全量实例概览 + 待清理列表
- [x] /api/admin/cleanup-instances 返回 200

## 版本管理与商城
- [x] 版本管理页：5 款 Pack 版本列表展示
- [x] /api/packs/:id/versions 对 5 款 Pack 均返回 200
- [x] Factorio 商城：商品表含"品质"列
- [x] /api/packs/factorio-vanilla/items-config 返回 quality_tiers > 0 且 support_quality = true
- [x] Minecraft 商城：商品表不含"品质"列
- [x] /api/packs/minecraft-vanilla/items-config 返回 quality_tiers = 0 或 support_quality = false

## 控制台与移动端
- [x] 全部页面控制台 error 数为 0（仅有 1 条 MaxListenersExceededWarning warn，来自自动化环境）
- [x] 移动端 375px 视口：实例列表卡片布局正常
- [x] 移动端无横向溢出
- [x] 移动端侧边栏可正常展开收起
