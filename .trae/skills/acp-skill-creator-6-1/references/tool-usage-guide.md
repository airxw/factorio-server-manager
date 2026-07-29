
# 工具使用指南

## AskUserQuestion

**使用场景：**
- 澄清用户需求
- 收集用户偏好
- 确认理解是否正确
- 提供选项让用户选择

**禁止使用场景：**
- ❌ Plan/Spec模式下请求确认（应使用NotifyUser）
- ❌ 已明确的需求重复确认

**使用示例：**
- "我理解你的需求是XXX，对吗？"
- "你希望使用A方案还是B方案？"

---

## NotifyUser

**使用场景：**
- Plan模式下请求计划确认
- Spec模式下请求规范确认
- 展示结果并等待用户确认

**禁止使用场景：**
- ❌ 一般需求澄清（应使用AskUserQuestion）

---

## TodoWrite

**使用场景：**
- 复杂多步骤任务管理
- 跟踪进度
- 确保不遗漏步骤

**建议：**
- 每个任务有清晰的验收标准
- 及时更新状态（pending → in_progress → completed）

---

## Task（Subagent）

**使用场景：**
- 并行任务分配
- 搜索调研
- 独立模块处理

**参数说明：**
- `description`: A short (3-5 words) description of the task
- `query`: The task for the agent to perform (&lt;= 30 words). Provide reasonable and clear requirements and fabrication is prohibited.
- `subagent_type`: The type of specialized agent to use for this task
  - `parallel-sub-agent`: 优先使用，适合并行任务
  - `search`: 仅用于纯搜索任务（高level、跨模块或模糊查询）
- `response_language`: The language to use for the response

**调用格式示例：**
```json
{
  "name": "Task",
  "params": {
    "description": "文档重构",
    "query": "重构SKILL.md到500行以内",
    "subagent_type": "parallel-sub-agent",
    "response_language": "中文"
  }
}
```

**并行策略与降级策略：**
1. 优先尝试：`subagent_type=parallel-sub-agent`, `response_language="中文"`
2. 若报错降级：`subagent_type=可用但非search的subagent`, `response_language="English"`
3. 若仍报错：直接子任务串行处理

**注意：**
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses.
- 仅在可用且任务受益于并行时使用
- 不可用时则串行执行
- search subagent仅用于纯搜索任务，无法编辑/写入文件

---

## WebSearch

**功能 / What it does：**
- 用于联网搜索（谨慎使用：频繁搜索成本高、体验差）。

**使用场景 / When to use：**
- 需要**实时信息**（例如“最新文档/最新公告/当前版本差异”）
- 需要**外部知识**且本地仓库无法提供
- 用户指出你之前的回答不准确，需要外部核验

**不使用场景 / When not to use：**
- 能通过本地仓库搜索、Read/Grep/搜索agent解决的问题
- 只是“补充链接”但不影响当前交付

**参数 / Params：**
- `query`: The search query to be executed
- `num`: Maximum number of search results to return (default: 5)
- `lr`: Language restriction for search results (e.g., 'lang_en')

**失败降级 / Fallback：**
1. 先尝试 WebSearch
2. 若 WebSearch 不可用/报错 → 用 Playwright 做网页检索/抓取（导航页面后提取可见文本）
3. 若仍不可用 → 放弃外部搜索，继续推进，但必须在产出文档的“调研记录/环境限制”里明确写明：当前环境无法执行外部搜索

---

## WebFetch

**功能 / What it does：**
- 直接抓取指定URL内容（HTML会被转换成可读文本/Markdown）。

**使用场景 / When to use：**
- 已经有明确URL，需要读取页面正文（而不是搜索）

**参数 / Params：**
- `url`: The URL to fetch content from

**失败降级 / Fallback：**
- 同 WebSearch：WebFetch 失败 → Playwright → 记录不可用并继续推进
