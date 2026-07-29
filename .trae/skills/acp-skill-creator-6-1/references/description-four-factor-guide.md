# Description 设计技巧 — 使能四因子 / Four-Factor Enablement Model

> 提炼自 AC范式V6 压测中唯一双层级 100% 通过的 s0402 与 4 个全失败 Skill 的对照分析。

## 四因子速览 / Four-Factor Overview

| 因子 / Factor | 核心问题 / Core Question | 一句话定义 / One-Liner |
|------|---------|-----------|
| F1 场景具体性 / Scene Specificity | LLM能认出"这个场景我见过"吗？ | 用技术栈名/动作结果/多维锚点替代抽象概念 |
| F2 用户语言贴合度 / User Language Fit | 你说的话用户自然而然会说吗？ | description词汇必须与用户自然语言重叠 |
| F3 任务边界清晰度 / Task Boundary Clarity | LLM知道"现在该不该用"吗？ | 一句话说清触发条件和产出 |
| F4 阻塞性提醒 / Blocking Reminder | LLM感知到"不用会怎样"吗？ | 制造紧迫感，暗示缺失代价 |

---

## F1：场景具体性 / Scene Specificity

用 1-2 个具象名词短语锚定适用场景，让 LLM 产生"这个场景我认识"的匹配感。

### 反例 / Anti-pattern
> "用于模块拆分与编排"

概念太抽象，覆盖太宽，LLM 无法将具体任务与之匹配。

### 正例 / Correct pattern（s0402）
> "前端/UI/Streamlit/Playwright/Mock回归/三重闸"

技术栈名即任务中的具体信号，三个词从不同维度锚定同一场景。

### 写作技法 / Techniques
- **用技术栈名替代抽象概念**：`Streamlit` 优于 `"Web框架"`，`Playwright` 优于 `"自动化测试工具"`。技术栈名是 LLM 可观测的信号。
- **一次给出 2-3 个不同维度的锚点**：`前端 + 测试工具 + 测试类型` 从不同角度覆盖同一场景，降低单点匹配失败概率。

---

## F2：用户语言贴合度 / User Language Fit（最关键因子 / Most Critical）

词汇必须与用户自然语言重叠。LLM 通过词汇重叠判断是否匹配。

### 反例 / Anti-pattern
> "稳定替身" / "拓扑化拆分" / "技术债扫描" / "规则模板宏"

用户会说 "Mock/假数据" 而非 "稳定替身"，会说 "模块划分/依赖分组" 而非 "拓扑化拆分"。核心词用户永远不会说 → LLM 永远匹配不上。

### 正例 / Correct pattern（s0402）
> "显示""测试""回归""通过""失败"

全是用户日常会话词，用户说"前端显示不对，测一下"即可匹配。

### 核心原则 / Core Principle
> **designer词汇 ≠ 用户词汇**。Description 是给 LLM 做语义匹配用的，不是给设计者做概念建模用的。

### 自检方法 / Self-Check
> 写完 description 后，想象用户最可能说的 3 句话。这些关键词是否出现在 description 中？

### 写作技法 / Techniques
- **用日常动词替代专业名词**：`"检查""扫描""修复"` 优于 `"质量保障""技术治理"`。
- **做替换实验**：把每个关键词逐一替换为用户的自然说法，看是否还能保持语义——不能则用的是设计者术语。

---

## F3：任务边界清晰度 / Task Boundary Clarity

一句话说清"什么时候该用"（准入条件）和"用完后产出什么"。

### 反例 / Anti-pattern
> description 只讲 Skill 做什么，没讲触发条件。

LLM 知道"能做什么"但不知道"现在应不应该用"——写成了功能说明书而非触发指南。

### 正例 / Correct pattern（s0402）
> "当改动触碰UI时 -> 运行三重测试闸门"

触发条件（"触碰UI"）和产出（"测试结果"）同时声明，LLM 可立即判定。

### 写作技法 / Techniques
- **用"当...时 -> 做..."结构**：天然包含触发条件和产出，LLM 无需额外推理。
- **准入条件要可观测**：`"前端文件被修改"` 可观测；`"需要质量保障"` 不可观测。

---

## F4：阻塞性提醒 / Blocking Reminder

让 LLM 感知"不调用会有什么后果"——制造紧迫感，暗示缺失代价。

### 反例 / Anti-pattern
> description 只正面描述价值，没说明缺失代价。

"提供质量保障"像锦上添花而非必须执行，LLM 倾向于跳过。

### 正例 / Correct pattern（s0402）
> "不能伪装通过"

暗示"不走这个 Skill，测试结果可能是假的"——制造 LLM 不愿承担的后果。

### 写作技法 / Techniques
- **暗示而非威胁**：`"不能伪装通过"` 优于 `"必须使用否则后果严重"`。前者让 LLM 自己推理后果。
- **用否定式表达**：`"不能跳过测试直接交付"` 比 `"建议在交付前使用"` 更有驱动力。

---

## 四因子诊断矩阵 / Diagnostic Matrix

| Skill | F1 Scene | F2 Language | F3 Boundary | F4 Blocking | Diagnosis |
|-------|:---:|:---:|:---:|:---:|------|
| s0402（标杆） | Pass | Pass | Pass | Pass | 全通过，唯一双层级100% |
| s0202 | Missing | Missing | Missing | Missing | 全缺，需从零重写 |
| s0203 | Partial | Missing | Missing | Missing | "拓扑化"用户永远不会说 |
| s0602 | Partial | Missing | Missing | Missing | 诊断用语不等于行动用语 |
| s0301 | Missing | Missing | Missing | Missing | 极简描述，全缺 |

**矩阵解读**：s0203 的"拓扑化"是教科书级 F2 反例——一个词毁掉召回。s0602 密度高但方向错——分析术语 ≠ 行动词汇。s0402 成功在于四个因子同时满足，F2 做对了最关键的事。

---

## 后记 / Afterword

> Observation, not verified conclusion. Based on controlled analysis of 5 Skills in AC范式V6 stress test; A/B testing not yet performed. Recommend follow-up verification.

本四因子模型来自压测数据对照分析，未经 A/B 验证，标注为**观察**。建议后续纳入对照验证。

## 相关文件 / Related Files

- `SKILL.md` → "描述优化"章节
- `scripts/improve_description.py` → prompt 模板
- 源文件：`番外_description技巧_使能四因子.md`
