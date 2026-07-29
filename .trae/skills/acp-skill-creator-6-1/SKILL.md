---
name: acp-skill-creator-6-1
description: "创建新技能、修改和改进现有技能，并测量技能性能。当用户想要从零开始创建技能、编辑或优化现有技能、运行评估测试技能、使用方差分析对技能性能进行基准测试，或优化技能描述以获得更好的触发精度时使用。Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy."
---

# Skill Creator

创建、改进和评测 Skill 的工程化流程——判断用户处于哪一步，推进到下一步，而不是直接跳到"写一堆 SKILL.md"。

## Hard Rules / 硬规则

1. **禁止使用 search subagent**：任何时候不允许 `subagent_type="search"`。检索用 Grep/Glob/Read/SearchCodebase；并行仅用 `parallel-sub-agent`。
2. **澄清/调研/二次确认必须结构化**：必须用 AskUserQuestion；禁止自然语言闲聊式推进关键决策点。
3. **必须优先复用仓库资产**：先读 `references/` 与 `agents/` 目录里已有规则与产物；禁止重复造轮子。

## Core Loop / 核心闭环（不可跳步）

1. **Search**：先找现成的相关 skill（GitHub + skills.sh + 本地）。严禁 `subagent_type="search"`。
2. **Research**：需外部资料时做网页搜索。先 AskUserQuestion（本地优先/允许外部/仅用提供的材料）。
3. **Clarify + Second-confirm**：澄清边界与成功标准，强制 AskUserQuestion 二次确认。
4. **Skill Canvas**：先写 `skill-canvas.md`。Canvas 填不满，先别写 Skill。
5. **Plan → User confirm**：Plan/Spec 模式用 NotifyUser 请求确认；未确认不执行。
6. **Implement**：按计划改 SKILL.md / references / scripts。先 Smoke Test 再进评测。
7. **Evaluate → Iterate**：最小测试用例跑通，viewer 展示，收反馈，迭代。

---

## Skill Canvas / 先填Canvas再动手（硬规则）

> 任何新 Skill / 重构 Skill 的第一产物必须是此画布。Canvas 填不满，先别写 Skill。不得改字段，不得虚构补全。

| 画布字段 / Canvas Field | 你的答案 | 填不满说明什么？ |
| -------------------- | ----- | ------------ |
| **Trigger / 触发器** | 解决什么特定场景的痛点？写具体输入边界 | 就是个普通 Prompt，不是 Skill |
| **Context / 上下文约束** | 锁死了哪些前提/边界？ | AI 会瞎跑 |
| **Action / 动作执行流** | 哪几个绝对不可跳过的步骤？ | 不是工程化产物 |
| **Guardrail / 防幻觉护栏** | 报错/找不到信息时兜底策略？ | 出问题就死机 |

**English version for bilingual workspace:**

| Canvas Field | Your Answer | What "unable to fill" means |
|---|---|---|
| **Trigger** | What specific scenario pain point? Define concrete input boundaries | It's just a normal prompt, not a Skill |
| **Context** | What preconditions/boundaries are locked? | AI will wander off-track |
| **Action** | What are the absolutely non-skippable steps? | Not an engineered artifact |
| **Guardrail** | What's the fallback when errors/missing info? | Dies on first problem |

Canvas 写完后向用户确认再进下一步。

---

## Workflow / 完整流程

### 1. 需求与调研

- 资产盘点（强制）：先读 `references/` 与 `agents/`；本地搜索优先
- 外部搜索按 WebSearch → Playwright → 记录降级的顺序
- 澄清后用 AskUserQuestion **强制主动二次确认**

> 详细步骤与调研降级策略：[references/workflow-details.md](references/workflow-details.md)（阶段A）｜ 工具使用方法：[references/tool-usage-guide.md](references/tool-usage-guide.md)

### 2. 规划

- 先写 `skill-canvas.md`（使用上方 Canvas 四格表）→ Plan/Spec → 用户确认

> 详细步骤：[references/workflow-details.md](references/workflow-details.md)（阶段B）

### 3. 实现

- 写入 SKILL.md（控制在 500 行以内）→ Smoke Test（最小可用性验证）→ 按需添加 scripts/references/assets

> 详细步骤：[references/workflow-details.md](references/workflow-details.md)（阶段C）

### 4. 评测与迭代

- 创建 2-3 个测试用例 → 运行触发评测或代理触发评测（详见 [references/eval-layers.md](references/eval-layers.md)）→ viewer 展示：`python eval-viewer/generate_review.py <workspace> --skill-name <name>`
- **系统性压测（按需）**：多 Skill 交叉验证或 Rules 行为验证时，参照 [references/stress-test-environment-guide.md](references/stress-test-environment-guide.md)（含冻结范例 `frozen-examples/任务01_需求梳理/` 和 `frozen-examples/任务09_界面验证/`）。非必须。

> 三层评测定义与取舍策略：[references/eval-layers.md](references/eval-layers.md) ｜ 评测数据格式：[references/schemas.md](references/schemas.md)

### 5. 描述优化（可选）

- **前置**：先读 [references/description-four-factor-guide.md](references/description-four-factor-guide.md)（F1 场景具体性 / F2 用户语言贴合度 / F3 任务边界清晰度 / F4 阻塞性提醒，提炼自 AC 范式 V6 压测）
- 创建 20 个 trigger evals（should-trigger 8-10 + should-not 8-10，中英混合）→ `python -m scripts.run_loop --eval-set <path> --skill-path <path> --max-iterations 5`

> 详细步骤：[references/workflow-details.md](references/workflow-details.md)（阶段E）

### 6. 独立审查

描述优化后、打包前执行。

- **当前环境统一调度**：拉起 `subagent_type='general_purpose_task'` + prompt 注入独立审查 rubric + "仅审查不写代码" 硬约束，审查 description 评测 + SKILL.md + Canvas + evals/，按 [rules-0 §四-8](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-0.md) 的 `handle_gn004()` 循环响应（阻断 → 修正 → 复审直至通过或警示放行）。
- **不可用时三级降级**（每次降级必须留痕，不得伪装独立审查已执行）：
  - L1：`subagent_type='general_purpose_task'` + 独立审查 prompt → 尝试以通用 subagent 执行审查
  - L2：主 agent 人工 checklist 自检 → 结果写入 `.trae/documents/` 标注"独立审查不可用，已人工替代"
  - L3：通过 L3 信号（AskUserQuestion）向人类报告不可用情况，由人类裁决是否跳过或等待独立审查恢复
- 用户可选择跳过此步。

### 7. 打包交付

`python -m scripts.package_skill <skill_path> <output_dir>`（需要包含 evals/ 时加 `--include-evals`）

---

## Communicating With The User / 沟通

- 用户不熟悉术语：用"测试/验收/对比"，不强塞"benchmark/assertion"
- 工程用户：可直接用技术术语，但仍给一句话定义
- AskUserQuestion：每次 1-4 问 x 2-4 选项（必要时 multiSelect），推荐项置首标注 "(Recommended)"
- Plan/Spec 模式请求确认使用 NotifyUser（非 AskUserQuestion）

---

## 能力索引表 / Capability Index

| 我需要... | 读这个文件 | 会得到... |
|-----------|-----------|-----------|
| 完整工作流步骤（阶段 A~F） | [references/workflow-details.md](references/workflow-details.md) | 全流程详细步骤 + 并行策略 + 降级策略 |
| 工具怎么用（AskUserQuestion / NotifyUser / Task / WebSearch 等） | [references/tool-usage-guide.md](references/tool-usage-guide.md) | 使用场景 + 参数说明 + 失败降级 |
| 评测怎么做（触发评测 / 代理评测 / 输出质量评审） | [references/eval-layers.md](references/eval-layers.md) | 三层评测定义 + 取舍策略 + Windows 兼容性说明 |
| description 怎么写 | [references/description-four-factor-guide.md](references/description-four-factor-guide.md) | F1-F4 四因子 + 反例正例 + 诊断矩阵 + 自检方法 |
| 系统性压测怎么做 | [references/stress-test-environment-guide.md](references/stress-test-environment-guide.md) | 构筑方法论 + 防泄露四层 + task.md 公式 + 观察记录模板 |
| 真实压测案例 | [frozen-examples/任务01_需求梳理/](frozen-examples/任务01_需求梳理/) / [frozen-examples/任务09_界面验证/](frozen-examples/任务09_界面验证/) | 实战验证过的完整压测任务（task.md + context），来自 `能力锁测试构筑冻结` 包 |
| 压测汇总报告怎么写 | [frozen-examples/_汇总反馈报告模板.md](frozen-examples/_汇总反馈报告模板.md) | 含 7 章模板：召回统计 + 行为偏差 + 独立审查结论 + 调优优先级矩阵 + KF/KU 清单 |
| 数据格式定义 | [references/schemas.md](references/schemas.md) | evals.json / grading.json / benchmark.json 等 JSON 结构规范 |
| 独立审查怎么做 | 本文件 §6 + [rules-0 §四-8](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-0.md) | 独立审查协议 + 三级降级路径 |
| 评分 / 比较 / 分析 | [agents/grader.md](agents/grader.md) / [agents/comparator.md](agents/comparator.md) / [agents/analyzer.md](agents/analyzer.md) | 三级评估 agent 定义（grading / blind comparison / post-hoc analysis） |
| 非 Claude Code 环境适配 | [config/README.md](config/README.md) | OpenAI-compatible 后端配置方式 |
