
# 详细工作流程

> 📌 本文件是 SKILL.md「Core Loop」和「Workflow」的详细执行版本。建议先读 SKILL.md 了解整体框架，再按需深入本文件。各阶段（A~F）与 SKILL.md Workflow 的 7 个步骤一一对应。

## 核心原则

### 1. 强制主动二次确认
即使用户任务描述看似清晰，也必须主动向用户再次确认理解是否正确。

### 2. Github / skills.sh 调研前置（等价）
- 在向用户澄清问题之前，优先搜索 Github 或 skills.sh 上相关 skill
- 两者等价、同等优先级；默认两边都查，至少覆盖其一
- 记录调研结果（是否参考、参考了什么）

**决策规则：**
- 完全一致且优质 → 深度参考
- 思路相关但不完全一致 → 仅参考思路
- 不一致或劣质 → 放弃参考

### 3. 三种模式统一行为
- **常规模式**（用户直接给需求）→ 生成 skill-canvas.md（简化版，填不满的字段标注「降级处理」）
- **Plan模式** → skill-canvas.md + plan.md + NotifyUser 请求确认
- **Spec模式** → skill-canvas.md + spec三件套（spec/tasks/checklist）+ NotifyUser 请求确认
- **所有模式共通**：Github调研 → 澄清确认 → skill-canvas.md → 后续流程

### 4. Skill Canvas 独立文档
- **硬规则：先填 Canvas 再动手**：任何新Skill/重构Skill，第一产物必须是 `skill-canvas.md`（Canvas 填不满，先别写 Skill）。
- `skill-canvas.md` 与 spec、tasks、checklist、plan 文档平级（同一工作目录/同一批交付物里可追踪）。
- Canvas 模板必须与“思想架构”一致：Trigger / Context / Action / Guardrail 四格表 + “填不满说明什么”规则；不得另起炉灶、不得虚构补全。以 [skill-creator/SKILL.md](file:///d:/2024备份和迁移/2024备份和迁移/f复旭文件/h彗星计划相关/彗星计划/Sammyinercase/skill-learning/06_彩蛋_学以致用_优化技能制作器技能/skill-creator/1/skill-creator/SKILL.md) 中的模板为准。
- Canvas 写完后，必须让用户确认再进入下一步（Plan/Spec 另有确认流程）。

### 5. 强化对照检验
**重要原则：** 除非是极度主观或高度复杂、无法稳定自动执行的skill，否则优先使用现有脚本完成"召回/触发评测 + 输出留痕 + 可视化评审"；复杂真实任务链路允许以人工评审为主，不强求脚本全自动闭环。

**检验手段：** 充分利用eval-viewer、generate_review.py等工具，让用户能看到HTML界面展示skill效果。

**感知进步：** 通过with/without对比、版本迭代对比，让用户清晰感知到skill的进步过程。

### 6. 可运行资产最小试运行（Smoke Test）优先
**适用场景：** skill包内存在可执行脚本（`scripts/*.py`）、可直接打开的HTML模板（`assets/*.html`）、或可解析的schema/样例文件（如`references/schemas.md`、`evals/*.json`）。

**原则：** 在进入"批量评测/优化闭环"之前，先完成最小可用性验证（能运行/能生成最小输出/无明显异常），把环境问题与逻辑问题分开。

**典型最小验证项（按需）：**
- `quick_validate` 能跑通并提示frontmatter/结构问题
- `eval-viewer/generate_review.py` 能以静态模式生成HTML或以服务模式启动
- `schemas.md` 中定义的关键JSON结构能被现有脚本正确读取/产出

---

## 标准流程

### 阶段A：需求与调研
1. 读取现有skill文件（如适用）
2. Github/skills.sh调研
3. 本地优先：先用本地搜索/Read/Grep/搜索agent把仓库内相关内容摸清（避免重复造轮子）
4. 外部信息（按需）：只有在“需要最新/外部事实/官方文档细节”等场景才做网页搜索
   - 首选：WebSearch
   - 若 WebSearch 不可用/报错：降级用 Playwright 做网页检索/抓取（导航后提取可见文本）
   - 若仍不可用：放弃外部搜索，继续推进，但必须在本次产出文档的“调研记录/环境限制”里明确记录：当前环境无法执行外部搜索（以及因此未覆盖的风险点）
5. 理解用户意图并澄清
6. 主动二次确认

### 阶段B：规划
1. 创建Skill Canvas（skill-canvas.md，模板见 SKILL.md；填不满就停）
2. 生成Plan（如适用）
3. 生成Spec（如适用）
4. 向用户确认

### 阶段C：实现
1. 写入SKILL.md
2. 按需添加scripts/references/assets
3. Smoke Test验证

### 阶段D：评测与迭代
1. 创建测试用例
2. 运行评测（触发评测/代理触发评测）
3. viewer可视化展示
4. 用户反馈
5. 迭代改进

### 阶段E：描述优化（可选）
1. 创建trigger evals
2. 用户确认eval set
3. 运行优化循环
4. 应用结果

### 阶段F：打包交付
1. 运行package_skill（如可用）
2. 交付最终skill

---

## 并行策略与降级策略

### 并行策略

**原则：** 尽可能并行执行无依赖的任务，以最大化效率。

**适用场景：**
- 多个独立文档的创建/修改
- 多个独立模块的实现
- 搜索调研与其他准备工作

**实现方式：** 使用单个消息中的多个Task工具调用来并发启动多个agents。

### 降级策略（重要）

**三级降级机制：**

1. **Level 1（优先）**
   - `subagent_type=parallel-sub-agent`
   - `response_language="中文"`

2. **Level 2（降级）**
   - 若Level 1报错 → 尝试 `subagent_type=可用但非search的subagent`
   - `response_language="English"`

3. **Level 3（最终降级）**
   - 若Level 2仍报错 → 直接子任务串行处理
   - 不使用任何subagent，由主agent顺序执行


