<!--
PR 模板 — 请在提交 PR 前填写以下声明
未填写自检清单的 PR 将被拒绝合并
-->

## 变更类型

请勾选本次 PR 涉及的变更类型（可多选）：

- [ ] 新功能（feature）
- [ ] Bug 修复（bugfix）
- [ ] 重构（refactor，不改变外部行为）
- [ ] 测试（test，新增或修改测试用例）
- [ ] 文档（docs）
- [ ] CI/CD 或工程基建（ci）

## 变更说明

<!-- 简要描述本次变更的目的、动机、影响范围。如有 issue，请关联：Closes #xxx -->

## 测试覆盖声明

- [ ] 已新增/修改单元测试覆盖本次变更的核心逻辑
- [ ] 已本地运行 `npm run test` 通过（前端 / 后端 / daemon 任一涉及项）
- [ ] 本次变更不涉及可测试逻辑（仅文档/配置/CI 等改动），无需新增测试

## 数据库迁移声明

<!-- 数据库字段变更必须配套迁移脚本，便于热更新（参见 .trae/rules/1.md） -->

- [ ] 本次变更**不涉及**数据库字段变更
- [ ] 本次变更**涉及**数据库字段变更，已新增 migration 文件（路径：`panel/backend/src/db/migrations/XXXXXXXXXX_xxx.ts`）
  - 迁移已包含 `up()` 与 `down()` 回滚逻辑
  - 已在 version.md 中记录字段变更说明

## 自检清单

提交前请确认以下检查项已通过（在 `[ ]` 中填入 `x` 标记完成）：

- [ ] `npm run typecheck` 通过（涉及的项目）
- [ ] `npm run test` 通过（涉及的项目）
- [ ] `npm run build` 通过（涉及的项目）
- [ ] 前端构建产物中无 `localhost:3000` / `127.0.0.1:3000` 违规地址（详见 `.trae/rules/0.md`）
- [ ] 版本号已同步：`version.json` / `panel/frontend/package.json` / `panel/backend/package.json` / `daemon/package.json` / `version.md` / `README.md` / `deploy.sh`（如本次变更涉及版本号）
- [ ] 已更新 `version.md` changelog（如本次变更涉及功能/bugfix）
- [ ] 已更新 `README.md`（如本次变更涉及重大功能或文件结构调整）
- [ ] 未修改 `public/` 目录下任何文件（如已修改，请在下方说明并附人类授权依据）
- [ ] 未修改 `.trae/rules/` 下任何规则文件（如已修改，请在下方说明并附人类授权依据）

## 补充说明

<!-- 如有特殊说明、风险评估、回滚方案、需 Reviewer 特别关注的点，请填写 -->
