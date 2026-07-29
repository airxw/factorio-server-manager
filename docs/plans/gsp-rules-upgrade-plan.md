---
type: plan
title: gsp 项目规范整体升级方案（去 AC 范式缝合）
date: 2026-07-24
status: deployed
deployed_in: v4.17.0
related:
  - .trae/specs/evaluate-ac-paradigm-v6-fit/spec.md
  - .trae/rules/
tags: [rules, governance, refactor, gsp-spec]
---

# gsp 项目规范整体升级方案

## 目标
将现有 `.trae/rules/` 下的 AC范式v6 规则集整体升级为 **gsp 项目规范**，服务本项目（TS/Express/Knex/React 19/Vite/zod+ajv 双层架构），而非强行缝合。原则：**补强的补足、拖后腿的清理**。

## 决策基线（已由人类裁决）
1. 文件组织：**就地升级保结构**——保留 rules-0~6 + 0/1/bb/deploy 文件名与编号，逐文件改写；身份转换通过各文件顶部声明实现。
2. 语言风味：**就地改写为 TS 等价**——os.path/Streamlit/jsonschema/asyncio/d:/*.py 等替换为 TS/React/path alias/zod+ajv 表达。
3. 工具耦合：**去工具耦合**——GN-004/parallel-sub-agent 改为"独立审查能力""并行任务调度能力"的能力要求，不绑定具体 subagent_type，写明用 general_purpose_task + 人工 checklist 落地。
4. 闭合判据：**补到 rules-0/rules-6 内**——新增"运行时接入校验"条款。

## 不变性约束
- 不改文件名、不改编号，15 个 AGENTS.md 的 rules 引用不失效。
- 保留所有"最高优先级 + 上下文保留"声明。
- 保留 public/ 保护、ec7_action_gate、[V] 双重闸门、阶段不可逆、变更追踪等核心治理机制。
- 0.md 仍为浏览器端服务器地址最高规则，端口真相源以 0.md 为准。

---

## 执行步骤

### 一、统一身份转换（全部 11 个规则文件）

对 `.trae/rules/` 下全部文件（0.md、1.md、bb.md、rules-0~6.md、deploy.md）执行：
- [ ] 在文件首行标题处将"AC范式v6"措辞替换为"gsp 项目规范"，保留"最高优先级规则"语义。
- [ ] 保留原 `📌 【上下文保留规则】` 声明不变。
- [ ] 凡正文出现"AC范式v6""AC 范式"字样，统一替换为"gsp 项目规范"（含 rules-0 §四 各伪代码注释 `# 继承自: AC范式v6` → `# 继承自: gsp项目规范`）。

### 二、rules-0.md（核心行为规则）——改动最大

- [ ] **§三 file_pathing.resolver**：`os.path.dirname(os.path.abspath(__file__))` → `path.dirname(fileURLToPath(import.meta.url))` 或 tsconfig paths alias（标注：项目已用 alias）。
- [ ] **§三 streamlit 全段**：整段替换为"前端（React 19 + Vite）"等价约束——
  - `fixed_keys/state_store/init/refresh` → `state: React Context + hooks；初始化用 lazy init；刷新用 setState 触发重渲染；API 超时 300s`
  - `button_llm_separation` → 保留语义"按钮触发与 LLM 调用分离"
  - `thread.prohibit 直接读写 st.session_state` → `禁止在 Web Worker/子进程直接读写 React state，须用消息传递/状态代理`
- [ ] **§三 async.prohibit**：`子线程asyncio+aiohttp` → `禁止请求处理中混用 callback 与 Promise 反模式；禁止未捕获的 Promise rejection；长任务用 setImmediate/queueMicrotask 让出`
- [ ] **§三 output.health_check**：端口表述与 0.md 对齐——`curl http://localhost:3002/api/health`（Panel 内部端口，仅本机）；补充 nginx 3000/3001 跳转入口说明，与 0.md 一致。
- [ ] **§三 auto_init**：`config补全/data补全` → 保留语义，改为"zod default 自动补全缺失字段；data 目录自动创建"。
- [ ] **§四-4 parallel-sub-agent**：去工具耦合——
  - 伪代码 `launch(subagent_type="parallel-sub-agent", task=task)` → `launch(subagent_type="general_purpose_task", task=task, isolate=task.needs_isolated_ctx)`
  - 保留 `MAX_PARALLEL_PER_BATCH=2`、`MAX_PARALLEL_GLOBAL=3`、`[P]` 标记、`rollback_branch_only` 语义
  - 注释说明：当前环境无 parallel-sub-agent 专用类型，用 general_purpose_task 近似承载
- [ ] **§四-5 [V] 节点**：`launch(subagent_type="GN-004")` → `launch独立审查（subagent_type="general_purpose_task"，prompt 中要求其仅做审查、不写代码）`；保留"GN-004 独立审查"作为**能力名**（非 subagent_type），双重闸门语义不变。
- [ ] **§四-7.2 ec7_action_gate**：伪代码语言中性化（Python 语法可保留作伪代码，但变量名/字符串保留）；PROTECTED_PATTERNS 保留 `public/*`、`.trae/rules/*`。
- [ ] **§四-8 GN-004 独立审查**：去工具耦合——
  - 全文 `subagent_type='GN-004'` → `subagent_type='general_purpose_task'`（prompt 注入审查 rubric）
  - `handle_gn004()` 循环保留（阻断→fix→rerun；警示放行→ask_user/note；通过→proceed）
  - §四-8 降级路径：保留，但"不可用"定义从"subagent_type 缺失"改为"审查能力无法承载时"
  - §四-8.0 Spec/Plan 闸门：同上去耦合
- [ ] **§四-9 Skill 强制调用**：保留（Skill 工具可用，s0101-s0602 在 available_skills）。
- [ ] **§四-10 public/ 保护**：保留不变。
- [ ] **§四-11 subagent 调度台账**：`actual agent id` 字段说明改为"实际调度标识——subagent 启动后回填其任务标识；当前环境用 general_purpose_task 时填其任务 id；因不可抗力缺失须注明原因；主线程内联执行填'主线程（非subagent）'"。`subagent_type` 列允许值改为 `parallel-sub-agent | general_purpose_task | GN-004` → `general_purpose_task（承载并行/审查两类能力，prompt 区分）`。
- [ ] **§四-12 受保护/未保护上下文调度矩阵**：`subagent_type` 引用统一去耦合；`isolate` 语义保留。
- [ ] **[新增] §四-13 运行时接入闭合判据**（闭合判据补强）——新增条款：
  - 任何模块闭合判据须包含"运行时接入校验"：模块须接入运行时路由注册 / 事件总线订阅 / WS 订阅 / 被上游调用方引用，四者至少满足其一。
  - 仅有"文件存在 + 单测通过 + build 通过"而未接入运行时者，判定为**孤岛代码**，不得标记已闭合，禁止合流。
  - GN-004 替代审查 checklist 须逐项核验"接入运行时"证据（路由表/事件订阅清单/调用方引用）。
  - 直接回溯 v4.11.0 假闭合根因，写入本条目作为判据升级依据。

### 三、rules-1.md（阶段识别指南）

- [ ] 标题身份转换。
- [ ] 阶段状态机 / triggers / irreversible：保留不变。
- [ ] 阶段→Skill 映射表：保留 s0101/s0102/s0103/s0201/s0202/s0203/s0301/s0401/s0402/s0601/s0602；**s302 标注"已并入 s0401，不单独调用"**（rules-6 §八已说明，本表对齐）。
- [ ] `[V]` 标注与双重闸门说明：保留，"GN-004 独立审查"作为能力名保留。

### 四、rules-2.md（目录架构与命名规范）

- [ ] 标题身份转换。
- [ ] **§1.1 `modules/` 注释**：`独立于主业务之外的运维/外挂脚本/非核心挂载模块` → `独立运维/系统级挂载模块（系统自更新/监控/诊断/用户安全等核心运维能力），按「模块N_模块中文名」命名`。
- [ ] 其余目录架构（panel/daemon/public/docs 等）：已与项目实际一致，保留。
- [ ] 交叉引用表：保留。

### 五、rules-3.md（三层契约定义）

- [ ] 标题身份转换。
- [ ] **§一 data_contract.validation**：`所有数据读写通过 jsonschema 库自动校验` → `所有数据读写通过 zod schema（运行时）+ ajv（JSON Schema 元校验）双轨自动校验，不符合契约的数据禁止入库`。
- [ ] §一 error_codes / location：保留。
- [ ] §二 接口契约 `.pyi`：字面已写"TypeScript .d.ts 声明文件（或 .pyi）"，改为"TypeScript .d.ts 声明文件"（删除 .pyi 并列，本项目纯 TS）。
- [ ] **§四 Mock 切换路径**：`调用方只需修改导入路径` → 补充"`pre_generated_mock/*.ts` 与真实实现通过 tsconfig paths alias 切换，调用方零改动`"。
- [ ] §五 契约可验证性：保留（`public/test_cases/verify_contracts.ts` 已落地）。
- [ ] §六 版本化：保留。
- [ ] §七 Skill 指引：保留。

### 六、rules-4.md（AGENTS.md 模板与上下文保留）

- [ ] 标题身份转换。
- [ ] §4.3 禁止操作清单：保留；其中 `os.path.dirname(os.path.abspath(__file__))` 引用 → `TS path alias / fileURLToPath(import.meta.url)`。
- [ ] public/ 保护段：保留不变。
- [ ] §4.4 层级专属约束、§五 上下文压缩规则：保留。
- [ ] §六 Skill 指引：保留。

### 七、rules-5.md（锚点与双文档体系）

- [ ] 标题身份转换。
- [ ] §一 锚点全景表：保留。
- [ ] §二 三段交接结构、§2.4 不可判定升级规则：伪代码保留（语言中性的判定逻辑）。
- [ ] §三 note 写作元原则：保留。
- [ ] §四 锚点联动：`GN-004` 引用作为**能力名**保留，去 subagent_type 耦合（"GN-004 独立审查"=用 general_purpose_task 承载的审查能力）。
- [ ] §五 双文档体系：保留。

### 八、rules-6.md（变更追踪闸门）

- [ ] 标题身份转换。
- [ ] **§5.1 元数据示例**：`"d:/absolute/path/to/file1.py"` → `"/home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/xxx.ts"`（Linux 绝对路径 + .ts 后缀）。
- [ ] §5.2-5.3 模板与状态机：保留。
- [ ] **§六 GN-004 交付前审查对接**：去工具耦合——`gn004_document_check` 伪代码保留逻辑，注释说明"由 general_purpose_task 承载审查能力"。
- [ ] **[新增] §六 运行时接入校验条款**（闭合判据补强）——在 `gn004_document_check` 中追加检查项：
  - 对每个代码变更，校验"模块是否接入运行时路由/事件总线/WS 订阅/被上游引用"
  - 未接入运行时的模块代码变更 → 标记 `{"level": "阻断", "msg": "孤岛代码，未接入运行时，禁止合流"}`
- [ ] §七 合流校验：保留并追加"孤岛代码禁止合流"。
- [ ] §八 Skill 指引：s302 标注"已并入 s0401"。

### 九、deploy.md（部署硬约束）

- [ ] 顶部身份转换（保留 `alwaysApply: false`）。
- [ ] 内容：已 Linux/TS 化，保留不变。

### 十、0.md / 1.md / bb.md（项目最高规则与基本约束）

- [ ] 0.md：顶部身份转换；内容为端口/地址最高规则，保留不变（仍是端口真相源）。
- [ ] 1.md：顶部身份转换；内容（linux/前后分离/部署/版本/8080禁外网/root密码）保留。
- [ ] bb.md：顶部身份转换；版本号规则保留。

### 十一、锚点文件同步

- [ ] **根 AGENTS.md**：§二 标题"AC 范式通用约束" → "gsp 项目规范通用约束"；技术栈表述已是 TS，无需改；模块边界速查保留。
- [ ] **15 个模块 AGENTS.md**：凡"AC 范式"措辞统一改为"gsp 项目规范"（机械替换，不改语义）；引用的 rules 编号不变。
- [ ] **current-note.md**：不因规则升级改动（它是状态交接锚点，非规则文件）；但可在诊断草稿追加一条"规则体系已升级为 gsp 项目规范"的备注。
- [ ] **README.md**：若存在"AC 范式"措辞，统一改为"gsp 项目规范"。

### 十二、验证步骤

- [ ] `grep -rn "AC范式\|AC 范式" .trae/rules/` → 应为 0（身份转换完成）。
- [ ] `grep -rn "os.path\|st.session_state\|asyncio\|aiohttp\|jsonschema 库\|\.pyi\|d:/" .trae/rules/` → 应为 0（Python 风味清除）。
- [ ] `grep -rn "subagent_type=\"GN-004\"\|subagent_type=\"parallel-sub-agent\"\|subagent_type='GN-004'\|subagent_type='parallel-sub-agent'" .trae/rules/` → 应为 0（去工具耦合完成；"GN-004 独立审查"作为能力名可保留）。
- [ ] `grep -rln "gsp 项目规范" .trae/rules/` → 应为 11（全部文件身份声明）。
- [ ] 抽查 15 个 AGENTS.md 引用的 rules 编号仍存在且有效。
- [ ] 确认 rules-0 §四-13、rules-6 §六 运行时接入条款已新增。
- [ ] 确认 0.md 端口表述与 rules-0 §三 health_check 一致。

---

## 不做的事（清理边界）
- 不改 public/ 下任何契约文件（受保护，本次仅改规则文本）。
- 不改任何业务代码（panel/daemon/frontend）——本次纯规则治理。
- 不改文件名/编号——保结构。
- 不删除任何规则文件——只改写、不删文件（避免引用悬空）。
- 不重新评估已批准的 `evaluate-ac-paradigm-v6-fit` spec（保留作决策依据）。

## 风险与建议
- **建议**：升级完成后，在下一次代码变更任务中首次启用新规则时，做一次"规则可执行性"实测（如拉起 general_purpose_task 承载审查能力、验证运行时接入判据是否真正拦截孤岛），把实测结果写入 `.trae/documents/` 作为规则升级的闭合证据。
- **风险**：去工具耦合后，"独立审查能力"的实际力度取决于 general_purpose_task 的 prompt 注入质量——规则文本无法保证执行力度，需在首次实测中校准 prompt 模板。
- **风险**：运行时接入判据的"接入运行时"边界（何谓路由/事件总线/WS/被引用）需在首次实操中细化，否则易被绕过。
