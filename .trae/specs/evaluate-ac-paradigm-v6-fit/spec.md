# AC范式v6 适用性评估 Spec

> 本 spec 为**分析评估型** spec，不包含任何代码变更需求（ADDED/MODIFIED/REMOVED Requirements 均为空）。
> 用户明确限定："本次讨论仅限于分析与评估层面，不涉及具体实施决策。" 故本 spec 不进入实现阶段。

## Why
项目已全量引入 AC范式v6 规则集（rules-0~6 + 0.md/1.md/bb.md/deploy.md），并在 `public/` 落地了三层契约、部署了 15 个 AGENTS.md、维护 `current-note.md` 三段交接。但在 v4.11.0 出现"假闭合"事件（模块单测+build 通过却未接入运行时），暴露出范式闭合判据与可用工具链之间的落差。需系统评估范式的实际价值、与 TS/Express/React 技术栈的契合度、规则字面需调整的条目、以及技能/工具匹配差距，为后续是否调整提供判断依据。

## What Changes
- **无代码变更**。本 spec 仅产出分析结论。
- 评估覆盖用户提出的 4 个维度：(1) 实际应用价值与潜在帮助；(2) 与架构/业务/技术栈契合度；(3) 需基于 TS 语言环境调整的规则条目；(4) 技术技能匹配度与差距。

## Impact
- Affected specs: 无（纯评估，不改契约）
- Affected code: 无
- 下游可能影响：若人类据此决定调整规则文本或工具链策略，将另立 change-id 走 s0601/rules 变更流程，不在本 spec 范围内。

## 评估证据基线（已核实）
1. 规则文件全在：`.trae/rules/{rules-0..6,0,1,bb,deploy}.md`，均声明"最高优先级 + 上下文保留"。
2. 三层契约已 TS 化落地于 `public/`：
   - 数据契约：`public/schema/*.json`（JSON Schema）+ `*.ts`（panel-api-types/daemon-api-types/ws-events/pack-schema）+ `CHANGELOG.md`
   - 接口契约：`public/interface_stub/*.d.ts`（daemon-rest/panel-rest/command-protocol/各 service）+ `.ts`/`.js`
   - 配置契约：`public/config_template/*.template` + `*.schema.json`
   - 预生成 Mock：`public/pre_generated_mock/*.ts`（rcon-mock-server/mock_asset_service/mock_execution_engine）+ `MOCK_STRATEGY.md`
   - 契约测试：`public/test_cases/verify_contracts.ts`
3. 15 个 AGENTS.md：根 + public + panel/backend + panel/frontend + daemon + 5 个子模块（api/daemonClient/asset_service/protocol/instances）+ packs/minecraft-vanilla + modules/模块0~3。
4. `current-note.md` 已实现三段交接（工程过程/交接状态/最终结果）+ 诊断草稿分区。
5. 技术栈：根 package.json（workspaces: panel/backend, panel/frontend, daemon；zod+ajv）；daemon（Express+ws+pino+rcon-client+zod+vitest+tsx）；AGENTS.md 声明 Express+Knex+SQLite→PostgreSQL、React 19+Vite+shadcn/ui+Tailwind、JWT+Bearer。
6. 假闭合证据（current-note.md）：v4.11.0 的 asset_service/execution_engine/commercial 三模块"单测+build 通过"但未接入运行时路由/事件总线，GN-004/s0602 未校验"接入运行时"。
7. 工具链：当前 IDE 的 Task 工具仅提供 `search`/`general_purpose_task`/`browser_use` 三种 subagent_type；`GN-004`、`parallel-sub-agent` 不可用。Skill 工具的 available_skills 含 s0101/s0102/s0103/s0201/s0202/s0203/s0301/s0401/s0402/s0601/s0602，但**不含 s302**（rules-6 §五引用）。

---

## 分析结论

### 维度一：实际应用价值与潜在帮助

**已兑现的价值（强证据）：**
1. **契约优先防止双层架构穿透**：Panel↔Daemon 物理分离，禁止跨模块 import 内部实现、仅依赖 `public/` 契约——在本项目双层架构中价值最高，直接支撑了 Panel/Daemon 独立部署与版本演进。
2. **public/ 物理保护**：rules-0 §四-10 + rules-4 §4.3 + ec7_action_gate 三重声明，使契约不被随意篡改，是"唯一真相源"的物理保障。
3. **变更追踪闭环**：rules-6 强制"先文档后代码"+ `.trae/documents/YYYYMMDD_模块N_*.md` 命名规范 + 状态机 + 合流校验，为热更新与数据迁移（本项目核心运维场景）提供可回溯链路。
4. **锚点跨断面续接**：current-note.md 三段交接使新会话能判定"从哪继续"，对长周期项目实效显著。
5. **版本治理闸门**：`check-version-sync` + version.md/README/DEPLOY_VERSION 联动，已写入 project_memory 作为硬约束。

**潜在帮助（尚未充分兑现）：**
- **强化闭合判据可防假闭合**：v4.11.0 假闭合的根因是判据停留在"单测+build"，若 GN-004 rubric 增加"模块接入运行时路由/事件总线"校验，孤岛代码本可被拦截。范式方向正确，判据颗粒度需上调。
- **s0602 技术债扫描若定期化**可早发现孤岛/死代码（如 project_memory 记录的 chatLogService.cleanupOldLogs 死代码、port 18432 vs 8080 分裂）。

### 维度二：与架构/业务/技术栈契合度

**高契合：**
- **架构**：双层 Panel+Daemon ↔ rules-2 模块0-9 拆分，模块边界天然对应部署边界；多游戏 pack ↔ pack.yaml 契约 + PackRegistry，契合度高。
- **业务**：游戏服务器管理的长期演进/热更新/数据迁移 ↔ rules-1 阶段不可逆 + rules-6 变更追踪，契合；多角色（服主/玩家/管理员）↔ 模块边界 + AGENTS.md。
- **契约层**：zod（运行时）+ ajv（JSON Schema 元校验）+ `.d.ts`（编译期）三轨，比范式原生的 jsonschema 单轨更强。

**主要摩擦（技术栈）：**
- 范式原生倾向 **Python/Streamlit**（rules-0 §三 streamlit 块、`os.path.dirname(os.path.abspath(__file__))`、`子线程asyncio+aiohttp`、rules-3 §一 `jsonschema 库`、rules-6 §5.1 `d:/.../*.py` 示例）。
- 本项目是 **TypeScript/Express/React/Vite**。项目已做适配（.pyi→.d.ts、jsonschema→zod/ajv、os.path→path alias、Streamlit→React），但**规则文本本身仍是 Python 风味**，造成"规则字面与实现语言不一致"的认知噪音，新读者易误以为规则过时。

### 维度三：需基于 TS/Node 语言环境调整的规则条目

> 以下为"规则字面需校准"的条目清单，属评估输出，不在本 spec 内执行修改。

| # | 条目位置 | 字面问题 | 建议方向（评估，不实施） |
|---|---------|---------|----------------------|
| 1 | rules-0 §三 `file_pathing.resolver` | `os.path.dirname(os.path.abspath(__file__))` 为 Python API | TS 应为 `path.dirname(fileURLToPath(import.meta.url))` 或 tsconfig paths alias（项目已用 alias） |
| 2 | rules-0 §三 `streamlit.*` 全段 | 本项目无 Streamlit | 替换为 React/Vite 等价约束（Context+hooks 状态、Suspense 懒加载、不可在子线程直接读写 state） |
| 3 | rules-0 §三 `async.prohibit` | `子线程asyncio+aiohttp` 为 Python 概念 | TS 应为"禁止请求处理中混用 callback 与 Promise 反模式 / 禁止未捕获的 reject" |
| 4 | rules-3 §一 `validation: jsonschema 库` | 与项目 zod+ajv 双轨不一致 | 明确"zod schema（运行时）+ ajv（JSON Schema 元校验）双轨" |
| 5 | rules-3 §四 Mock 切换"修改导入路径" | 未说明 TS alias 切换 | 补充 path alias 切换说明（项目已用 pre_generated_mock/*.ts） |
| 6 | rules-6 §5.1 `related_files: "d:/.../*.py"` | Windows 盘符 + .py 后缀 | 改为 Linux 绝对路径 + .ts 后缀（项目是 Linux，rules-1.md 已声明） |
| 7 | rules-2 §1.1 `modules/` 注释 | "运维/外挂脚本/非核心挂载"偏低 | 项目 modules/ 实际承载系统自更新/监控/诊断/用户安全等核心运维模块，描述需校准 |
| 8 | rules-0 §四-4/8、rules-1 阶段映射 | 引用 `parallel-sub-agent`/`GN-004` subagent_type | 当前环境不可用，需补"降级为 general_purpose_task + 人工 checklist"路径 |
| 9 | rules-0 §三 `output.health_check` | 字面仍写 `curl http://localhost:3002` | 需与 0.md 最高规则（nginx 3000/3001 + Panel 3002）交叉同步，避免端口表述分裂 |
| 10 | rules-6 §五 引用 s302 | s302 不在 available_skills | 标注 s302 不可用或并入 s0401（rules-6 §八已说明 s0401 承接） |

### 维度四：技术技能匹配度与差距

**已匹配（可用）：**
- s0101/s0102/s0103/s0201/s0202/s0203/s0301/s0401/s0402/s0601/s0602 均在 Skill 工具 available_skills 中，可经 `Skill` 工具显式调用，满足 rules-0 §四-9 强制调用硬约束的"工具存在"前提。
- 契约可验证性：`public/test_cases/verify_contracts.ts` 满足 rules-3 §五 测试套件要求。
- 三重测试：vitest（单测）+ playwright（E2E）+ MSW（Mock 回归）齐备，覆盖率报告存在。
- 数据契约双轨：zod + ajv。

**差距（关键）：**
1. **GN-004 subagent_type 不可用（最大差距）**：rules-0 §四-5/8/8.0 反复强制 GN-004 独立审查为硬闸门，但 Task 工具不提供该 subagent_type。降级路径（§四-8 降级 5 步）在每个关键检查点重复，单人开发场景成本高、易被简化——**v4.11.0 假闭合即为降级被弱化的直接证据**。
2. **parallel-sub-agent subagent_type 不可用**：rules-0 §四-4 并行编排核心机制（MAX_PARALLEL_PER_BATCH=2）无对应 subagent_type，只能退化为串行或用 `general_purpose_task` 近似，[P] 并行组标记失去执行载体。
3. **s302 Skill 缺失**：rules-6 §五模板引用未落地。
4. **闭合判据设计缺口（非工具差距，是范式自身）**：GN-004/s0602 rubric 聚焦"文件存在 + 契约校验 + 测试 PASS"，缺少"模块接入运行时路由/事件总线/WS 订阅"校验。假闭合证明此缺口会实际放行孤岛代码。
5. **ec7_action_gate / public_protection 无程序级拦截**：规则用伪 Python 描述拦截逻辑，实际依赖 LLM 自觉 + Edit/Write 人工授权弹窗，非工具链硬拦截。
6. **subagent 调度台账 actual agent id 回填难闭合**：§四-11 要求填真实拉起 ID，但 Task 工具不返回可稳定引用的 agent id，台账字段长期处于"待回填"。
7. **Skill 语义召回→工具调用双层闭环易断**：§四-9 要求"识别即调用"，但长上下文中 LLM 易在回复提及 Skill 名称却未实际调用 Skill 工具。

---

## 综合评估

AC范式v6 在本项目的**契约优先、模块边界、变更追踪、锚点续接**四方面已产生明确价值，与双层架构高度契合。主要落差集中在两处：
- **语言层**：规则文本 Python/Streamlit 风味 vs 项目 TS/React 实际（维度三，可通过规则文本校准解决，低风险）。
- **工具层**：GN-004 / parallel-sub-agent subagent_type 不可用 + 闭合判据未覆盖"运行时接入"（维度四，是假闭合根因，需补判据或补工具）。

本 spec 到此为止，不进入实施。是否就规则文本校准或工具链补强另立 change，由人类裁决。

## ADDED Requirements
无（分析评估型 spec，无新需求）。

## MODIFIED Requirements
无。

## REMOVED Requirements
无。
