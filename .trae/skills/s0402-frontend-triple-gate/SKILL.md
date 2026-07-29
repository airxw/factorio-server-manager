---
name: s0402-frontend-triple-gate
description: "当任务触碰 UI、前端渲染、页面交互、终端展示或 Mock 交互路径，而你又不能只凭\"我看起来点过了\"就宣告完成时，先调用这个 Skill 运行前端三重测试闸门；它的召回动机不是\"顺手跑几个测试\"，而是\"把单测、内置浏览器核对、Mock 回归和证据落盘绑成一个阻断式质量闸门，防止高风险界面改动绕过独立验证\"。"
---

# s0402 前端三重测试闸门

## 作用
- 对 UI / 前端 / 渲染类改动执行 Test1 → Test2 → Test3 的顺序化质量闸门。
- 把前端高风险改动的"是否可汇报、可审查、可继续合流"建立在独立证据链上，而不是执行者口头确认。
- 统一沉淀前端测试证据目录、失败输出契约与重跑入口，减少 UI 改动的假闭合。

## Trigger
- 用户显式要求测 UI、测前端、跑三重闸、跑内置浏览器核对、做 Mock 回归。
- 当前变更涉及前端页面、Tab、渲染逻辑、终端输出渲染、状态代理或 Mock 模式路径。
- 前端 / 界面类改动准备汇报、请求审查或进入后续交付前检查。

## Preconditions
- 当前任务确实存在 UI / 前端 / 渲染路径改动，或用户显式要求执行该闸门。
- 已能识别 Test1、Test2、Test3 各自的执行入口或缺失情况；若连入口是否存在都无法判断，先保持 `当前不可判定`。
- 证据落盘目录 `.trae/documents/test_reports/frontend_gate_YYYYMMDD_HHMMSS/` 可用，至少能承接 summary 与原始日志。
- 若前端进程、测试环境、Mock 数据或关键依赖尚未准备好，不得跳过闸门直接宣告完成。

## TRAE 特化命令
- 若用户没有明确要跑全量还是单门禁、当前改动是否触发三重闸存在歧义，必须先调用 `AskUserQuestion` 做结构化确认。
- 若本 Skill 已完成一次闸门执行或产生阻断结果，应调用 `TodoWrite` 回填真实状态，不把失败闸门伪装为"待后续再看"。
- 本 Skill 的入口发现与结果核对依赖本地检索与已有测试资产完成；优先使用 `Read` / `Grep` / `Glob` / `SearchCodebase`，必要时再配合测试工具执行。

## Context
- 三重闸顺序固定为 Test1 单元测试 → Test2 内置浏览器核对 → Test3 Mock 回归，不能为赶进度任意跳关。
- 任一闸门失败、缺失或无法运行，默认不能宣告前端改动已完成，除非得到显式豁免。
- 证据链必须落到 `.trae/documents/test_reports/frontend_gate_YYYYMMDD_HHMMSS/`，缺一项就不能视为完整执行。
- 本 Skill 负责的是执行闸门与客观报告，不替代人工价值判断，也不替代编写测试用例本身。
- UI / 渲染改动若同时触发更高层交付流程，本 Skill 只负责前端质量闸门，不直接承担交付准入裁定。
- 浏览器类验证默认且仅允许使用内置浏览器工具（`browser_*` / integrated browser）；不得把 Playwright 作为 Test2 的替代入口。

## Inputs
- 当前 UI / 前端改动范围与相关文件路径。
- Test1 / Test2 / Test3 的执行入口、配置与可选 Mock 数据目录。
- 前端进程启动方式、必要环境变量与关键验证场景。
- 内置浏览器可访问的目标地址、预期页面元素、关键交互路径与截图/快照取证点。
- 可选的既有截图、基线日志与历史测试报告。

## Outputs
- 闸门总结果：`PASSED / FAILED / 当前不可判定`。
- Test1 / Test2 / Test3 各自状态与原始证据路径。
- 固定证据目录与四个必需证据文件：
  - `test1_streamlit.log`
  - `test2_browser_check.md`
  - `test3_mock_checklist.md`
  - `summary.json`
- 结构化失败输出契约或成功输出契约。
- 后续动作建议、重跑入口与阻断说明。

## Action Flow
1. 读取当前变更范围，判断是否命中三重闸触发条件，并识别是强触发还是弱触发。
2. 发现 Test1 / Test2 / Test3 的执行入口、依赖与证据落盘目录；若入口缺失，也要把"缺失"作为闸门结果的一部分记录下来。
3. 按固定顺序执行 Test1、Test2、Test3；前一关未通过时，不把后一关成功假装成整体通过。
4. 把每一关证据固定落盘到 `.trae/documents/test_reports/frontend_gate_YYYYMMDD_HHMMSS/`，且四个文件缺一不可：
   - `test1_streamlit.log`
   - `test2_browser_check.md`
   - `test3_mock_checklist.md`
   - `summary.json`
5. Test2 必须使用内置浏览器完成，至少覆盖：打开目标页面、抓取快照、必要交互、结果核对；证据写入 `test2_browser_check.md`，并在需要时补截图文件路径、控制台日志、网络请求摘要。
6. 生成 `summary.json`，至少包含：执行时间戳、三个测试的执行状态（PASS/FAIL）、失败用例清单（如有）、总体结论。
7. 若任一关失败，必须输出结构化失败契约，至少包含：`skill`、`status`、`failed_test_type`、`timestamp`、`evidence_path`、`failed_cases`、`failure_summary`、`next_actions`、`rerun_entry`。
8. 若三关全部通过，必须输出结构化成功契约，至少包含：`skill`、`status`、`timestamp`、`evidence_path`、`summary`、`tests`。
9. 若任一闸门失败、缺失或环境不满足，阻断"完成 / 审查 / 合流"宣告，并调用 `TodoWrite` 回填状态。

## hc_sc_ec_mapping
- 主映射：`HC-1` `SC-2` `EC-3`
- 次映射：`EC-2` `SC-3` `EC-6` `EC-7`
- 说明：
  - `HC-1`：先回答当前前端改动是否真的达到可汇报闭合，而不是只看局部能跑。
  - `SC-2`：三重闸存在明确顺序依赖，不能把后置验证前移替代前置验证。
  - `EC-3`：闸门结论必须来自独立证据链，而不是执行者主观判断。
  - `EC-2`：通过闸门隔离前端高风险改动，不让问题直接扩散到交付阶段。
  - `SC-3`：缺测试、缺证据、缺入口时必须显式标出未闭合或失败。
  - `EC-6/EC-7`：无法执行或需要豁免时必须解释并请示。

## State Protocol
- `已闭合`：三重闸全部通过，证据落盘完整，可客观支持前端改动进入后续汇报或审查。
- `未闭合`：任一闸门失败、缺失、无法运行或证据链不完整，当前不能宣告前端改动完成。
- `当前不可判定`：当前无法确认是否命中触发条件、是否具备执行入口，或环境状态不足以形成可靠结论。
- 状态映射：`PASSED -> 已闭合`，`FAILED -> 未闭合`，`当前不可判定 -> 当前不可判定`；后续回填 `TodoWrite`、`current-note.md` 与 独立审查 记录时必须使用该映射，不得自行换词。

## Closure Signals
- 存在 `.trae/documents/test_reports/frontend_gate_YYYYMMDD_HHMMSS/` 证据目录。
- 必须同时包含四个固定证据文件：`test1_streamlit.log`、`test2_browser_check.md`、`test3_mock_checklist.md`、`summary.json`。
- `summary.json` 至少包含执行时间戳、三个测试状态、失败用例清单（如有）与总体结论。
- 明确给出 Test1 / Test2 / Test3 各自状态、总体结论与失败类型。
- 若失败，必须存在结构化失败输出契约；若通过，必须存在结构化成功输出契约。
- 若失败或未闭合，必须给出 `next_actions` 与 `rerun_entry`。
- 明确给出三值状态，而不是只说"测过了"。

## hc3_handoff
- 做到哪里：已执行三重闸、已在某一关阻断，或已说明当前为什么无法执行。
- 为什么做到这里：因为 UI / 渲染改动的风险不能仅凭人工点看，需要独立证据链做闸门。
- 哪些已闭合：已通过的关卡、已落盘的证据、已形成的失败报告或成功 summary。
- 哪些未闭合：失败用例、缺失入口、环境问题、未完成的 Mock 回归或待补证据。
- 下一步从哪接：
  - 若 `已闭合`，进入后续汇报、审查或更高层准入动作
  - 若非 `已闭合`，先修复失败项、补齐入口或申请明确豁免后再重跑

## ec7_trigger_gate
- 无法确认当前改动是否命中 UI / 前端闸门。
- Test1 / Test2 / Test3 缺执行入口、缺环境或缺关键依赖。
- 用户要求跳过失败闸门直接汇报或合流。

## ec6_minimum_explanation
- 当前为什么需要或不能完成三重闸。
- 哪些关卡已跑通，哪些关卡失败、缺失或不可运行。
- 已落盘哪些证据，哪些证据仍缺。
- 建议下一步修什么、补什么，或需要谁批准豁免。

## gn004_touchpoints
- 三件套阶段：检查该 Skill 是否被定义为阻断式质量闸门，而不是普通测试命令清单。
- 关键审查点阶段：检查三关顺序、失败阻断、证据目录与结构化输出契约是否齐备。
- 执行阶段：检查执行者是否真的按顺序执行并落盘证据，而不是只口头汇报"测试通过"。
- 交付前审查：检查前端改动相关声称闭合项是否都有对应闸门证据可复核。
- 所有 gn004_touchpoints 段落中的审查动作均为主线程拉起 独立审查，不得暗示 subagent 可自行拉取。

## installability_validation
- `frontmatter` 存在且字段可读。
- `description` 能命中"前端 / UI / 内置浏览器 / browser_* / Mock 回归 / 三重闸"类触发语义。
- 首步动作明确为"识别当前变更是否命中三重闸并发现三关入口"，主执行者可独立执行。
- 若当前环境无法验证触发命中，则状态记为 `当前不可判定`。

## validation_record_format
- `验证对象`：`s0402-frontend-triple-gate`
- `验证时间`：记录实际执行时间戳。
- `frontmatter 合规`：`通过 / 失败 / 当前不可判定`
- `description 触发命中`：记录命中的触发语义、未命中原因或 `当前不可判定` 理由。
- `首步独立执行`：记录是否能直接从"识别变更命中 + 发现三关入口"启动，以及阻断点。
- `三重闸覆盖`：记录 Test1、Test2、Test3、证据目录，以及 `test1_streamlit.log`、`test2_browser_check.md`、`test3_mock_checklist.md`、`summary.json` 是否齐备。
- `输出契约核对`：记录失败输出契约的 `skill/status/failed_test_type/timestamp/evidence_path/failed_cases/failure_summary/next_actions/rerun_entry` 与成功输出契约的 `skill/status/timestamp/evidence_path/summary/tests` 是否齐备。
- `总体结论`：只能填写 `已闭合 / 未闭合 / 当前不可判定` 之一。
- `证据与备注`：记录失败用例、证据路径、豁免情况、未闭合项与后续接续入口。

## fallback_and_escalation
- 若测试入口缺失，不把"缺测试"解释成"自动通过"；直接保持 `未闭合` 并输出补齐入口建议。
- 若环境无法运行，保留失败或不可判定说明，并提供可复现重跑入口，不跳过闸门。
- 若只完成部分关卡，不能拿部分成功冒充整体通过。
- 若四个固定证据文件缺任意一个，直接保持 `未闭合`，不能用"等价证据"替代。
- 若 Test2 尝试改用 Playwright、外部浏览器插件或纯口头描述替代内置浏览器核对，直接保持 `未闭合`。
- 若 `summary.json` 缺最低字段，或成功/失败输出契约字段不齐，直接判为证据链不完整。
- `EC-4` 间接补偿：由 独立审查、前端三重闸规则与主 agent 复核防止执行者绕过失败信号。
- `EC-5` 间接补偿：若当前能力不足以建立测试入口、Mock 环境或证据链，应升级请示，而不是宣告"测试已完成"。
