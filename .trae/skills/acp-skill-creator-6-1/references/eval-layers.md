
# 评测分层定义

## 评测分层概述

评测分为三层，根据skill类型和可用工具选择合适的层次。

---

## 第一层：触发/召回评测（Trigger Eval）

**目标：** 检验skill的description是否能在正确场景下被模型判定为应触发。

**支持两种模式：**
1. **真实触发评测**：在IDE环境中测试真实触发行为（仅Claude Code可用）
2. **代理触发评测**：用分类/结构化输出评估should_invoke（OpenAI-compatible通用）

**何时使用：**
- 新创建skill的description优化
- 现有skill的description改进
- 需要验证触发准确性

---

## 第二层：代理触发评测（Proxy Trigger Eval）

**目标：** 在OpenAI-compatible等通用API下，用分类/结构化输出的方式评估"should_invoke"，作为对真实IDE召回的近似指标。

**实现方式：**
- 向模型提供查询和skill描述
- 要求模型判断是否应该触发该skill
- 用结构化输出（JSON）记录结果

**优势：**
- 不依赖特定IDE环境
- 可在任何OpenAI-compatible后端运行
- 结果可量化评估

---

## 第三层：输出质量评测（Output Review）

**目标：** 评估skill实际输出的质量。

**方法：**
- 对复杂skill，以"输出留痕 + viewer人工评审 + 必要时有限断言"作为主路径
- 不强求脚本全自动执行完整真实链路

**viewer展示：**
- 使用eval-viewer/generate_review.py
- 双Tab界面：Outputs（定性）+ Benchmark（定量）
- 支持with/without对比
- 支持版本迭代对比

---

## 评测取舍策略

| Skill类型 | 推荐评测层次 | 说明 |
|-----------|-------------|------|
| 客观可验证（文件转换、数据提取、代码生成） | 全部三层 | 优先脚本自动化 + viewer展示 |
| 主观输出（写作风格、艺术） | 第一层 + 第三层（人工评审） | 不强求脚本全自动闭环 |
| 极度复杂/不稳定 | 第一层 + 第三层（人工评审为主） | 接受不跑真实任务链路 |

---

## Windows兼容性策略

明确评测脚本并行实现的兼容策略：
- 优先确保Windows可运行
- 必要时改为线程池/串行
- 或将worker函数提升为顶层可序列化函数
- 避免多进程序列化问题导致评测不可用
