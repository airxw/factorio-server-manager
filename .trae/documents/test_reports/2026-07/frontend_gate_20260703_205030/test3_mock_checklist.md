# Test3 Mock 回归测试清单

## 执行时间
2026-07-03 20:50:30 (Asia/Shanghai)

## 测试目标
UI 层 Mock 模式回归验证：
- API client 在 Mock 数据下的渲染正确性
- 各页面在空数据 / 单条数据 / 多条数据 / 错误状态下的展示
- 表单提交 / 列表加载 / 删除确认等交互

## Mock 资产检查
- 检查 public/pre_generated_mock/：仅存在 schema 文件，无前端 Mock 实现
- 检查 panel/frontend/src/mocks 或类似目录：不存在
- 检查 MSW (Mock Service Worker) 配置：不存在
- 检查 vite.config.ts 中的 mock 插件：不存在

## Mock 回归清单（应当覆盖的场景）

### P1 用户/系统配置
- [ ] 用户列表空数据
- [ ] 用户列表多条数据
- [ ] 系统配置编辑表单
- [ ] VIP 等级权限 CRUD

### P2 商店/CDK
- [ ] 商品列表渲染
- [ ] 创建订单表单
- [ ] CDK 码列表
- [ ] 兑换流程

### P3 聊天/投票/玩家
- [ ] 聊天设置表单
- [ ] 聊天触发器 CRUD
- [ ] 投票创建/投票/取消
- [ ] 玩家绑定审批
- [ ] 定时消息 CRUD

### P4 Mods/存档/备份/监控/列表
- [ ] Mods CRUD
- [ ] 存档激活
- [ ] 备份状态切换
- [ ] 监控快照时序图
- [ ] 白名单/黑名单 CRUD

### P5 Webhooks/审计日志
- [ ] Webhook CRUD
- [ ] Webhook 测试投递
- [ ] 审计日志筛选/分页

## 执行结果
- 状态：MISSING
- 原因：Mock 资产完全缺失，无法执行 Test3
- 影响：所有前端页面均无 Mock 模式回归验证

## 失败契约字段
- skill: s0402-frontend-triple-gate
- status: FAILED (入口缺失)
- failed_test_type: Test3_mock
- timestamp: 2026-07-03T20:50:30+08:00
- evidence_path: .trae/documents/test_reports/frontend_gate_20260703_205030/test3_mock_checklist.md
- failed_cases: N/A（无 Mock 资产）
- failure_summary: 前端项目无 MSW / vite-plugin-mock 等 Mock 基础设施，未编写任何 Mock 数据
- next_actions:
  1. 安装 msw 或 vite-plugin-mock
  2. 基于 public/schema 生成 Mock 数据
  3. 配置 dev 环境 Mock 模式开关
  4. 编写各页面 Mock 回归场景
  5. 重跑 Test3
- rerun_entry: 在 panel/frontend 目录执行 `MOCK=true npx vite`，手动验证各页面

## 三值状态
- 状态：未闭合
