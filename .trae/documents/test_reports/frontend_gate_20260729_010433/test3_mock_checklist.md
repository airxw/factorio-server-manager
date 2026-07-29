# Test3 — Mock 回归检查清单

**执行时间**: 2026-07-29 01:04:33
**验证对象**: 启动向导（StartupGuideWizard）在不同 Pack 下的渲染回归

## 检查项

### 1. Mock 测试入口存在性
- [x] **入口存在性核查**：无
  - `public/pre_generated_mock/` 下无 `*startup*` Mock 文件
  - `panel/frontend/src/` 下无 `*mock*startup*` 测试文件
  - StartupGuideWizard 组件无对应 Mock 渲染测试
- [ ] **多 Pack 向导渲染回归**：未执行（入口缺失）

### 2. 受测组件
- `panel/frontend/src/components/StartupGuideWizard.tsx`（v1.1.0 新增，分步向导 + 动态字段）
- `panel/frontend/src/pages/ServerDetail.tsx`（集成向导，handleStart 调用 getStartupGuide）

### 3. Mock 回归预期覆盖（待补齐）
- [ ] ARK Pack：map-selection 步骤渲染（地图卡片单选）
- [ ] Minecraft Pack：world-setup 步骤渲染（世界名+种子）
- [ ] 字段类型渲染：map / text / select / number / boolean
- [ ] 草稿自动保存与恢复
- [ ] 必填校验与提交

## 结论

**Test3 状态**: `未闭合`（测试入口缺失）

依据 s0402 fallback 规则：「若测试入口缺失，不把"缺测试"解释成"自动通过"；直接保持 `未闭合` 并输出补齐入口建议。」

## 补齐建议
1. 在 `panel/frontend/src/components/__tests__/` 下新增 `StartupGuideWizard.test.tsx`，使用 vitest + @testing-library/react 渲染向导
2. 构造不同 Pack 的 `StartupGuide` mock 数据（含 map/text/select 字段），验证字段渲染与交互
3. 复用 `public/schema/pack-schema.ts` 的 `StartupGuideSchema` 生成合规 mock

## 重跑入口
```bash
cd panel/frontend && npx vitest run src/components/__tests__/StartupGuideWizard.test.tsx
```
（待测试文件创建后可用）
