---
description: gsp项目规范——变更追踪闸门规则，定义问题文档强制先写后改原则、命名规范、结构化模板及交付前文档完整性审查闸门（由AC范式v6升级，s302模板已并入s0401）
alwaysApply: true
condition_mapping: HC-3/SC-3/EC-3
---
# gsp 项目规范——变更追踪闸门规则

> 🚨 【最高优先级规则】本文件为变更追踪闸门的强制约束，优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须 100% 符合本文件要求，违反规则的内容必须自动修正后再输出。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

> 🔴 【核心强制规则】所有问题修复、功能优化、小调整，必须先写文档再改代码，禁止任何无文档记录的修改。

## 一、问题追踪目录结构

```
.trae/
└── documents/
    ├── 20260501_模块1_修复登录超时异常.md
    ├── 20260503_模块2_优化搜索响应延迟.md
    ├── 20260505_模块0_调整进度刷新间隔.md
    └── ...
```

## 二、文档命名规范

所有变更文档必须遵循以下命名格式：

```
YYYYMMDD_模块N_变更简述.md
```

| 组成部分 | 说明 | 示例 |
|---------|------|------|
| YYYYMMDD | 创建日期，8 位数字，无分隔符 | 20260515 |
| 模块N | 模块编号，格式为「模块」+ 阿拉伯数字 | 模块1 |
| 变更简述 | 中文简短描述，10 字以内为佳，不含标点 | 修复登录超时异常 |

- 完整示例：`20260515_模块1_修复登录超时异常.md`
- 不规范命名在交付前审查时直接标记为不合规

## 三、问题追踪管理强制规范

| 规则 | 说明 | 强制级别 |
|------|------|---------|
| 修复前必写 | 所有问题修复、功能优化、小调整，必须先在 `.trae/documents/` 下写分析文档，**禁止直接修改代码** | 🔴 强制 |
| 版本归档 | 问题修复完成后，文档必须保留作为历史记录，不得删除 | 🔴 强制 |
| 关联代码 | 在文档中明确列出修改的文件清单（绝对路径） | 🔴 强制 |
| 结果填写 | 修复完成后必须记录实际修改、测试结果、经验教训 | 🔴 强制 |

## 四、文档记录触发场景

**以下场景必须主动写文档记录：**

- Bug 修复
- 功能优化
- 小调整 / 微调
- 终端输出改进
- UI 中间状态补充
- 日志格式调整
- 问题解决后经验沉淀

## 五、问题文档模板（s302 附录）

> s302 模板已并入 s0401（安全文件写入 Skill），由 s0401 承载文档创建与安全写入。以下模板为结构化问题分析的标准格式，所有 `.trae/documents/` 下的文档必须包含全部必填章节。

### 5.1 元数据（必填）

以 YAML frontmatter 方式嵌入每个 `.trae/documents/` 文档头部：

```yaml
timestamp: "YYYY-MM-DD HH:MM:SS"
issue_id: "模块N-YYYYMMDD-NN"        # 格式：模块编号-日期-当日序号
status: "待分析 | 分析中 | 修复中 | 已完成 | 已关闭"
related_files:
  - "/home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/xxx.ts"
  - "/home/airxw/Documents/gsp/gameserver-panel/daemon/src/instances/yyy.ts"
affected_modules: ["模块N"]
```

### 5.2 必填章节

#### 第一章：问题分析

- **问题现象**：具体描述发生了什么（包含可复现步骤、截图/日志等可验证证据）
- **影响范围**：受影响的模块、功能、用户
- **根因分析**：定位到的根本原因（代码位置、逻辑缺陷、边界条件等）

#### 第二章：修复方案

- **方案描述**：具体修改策略
- **替代方案**：考虑过的其他方案及否决理由
- **风险评估**：修复引入的副作用可能性及缓解措施

#### 第三章：实现步骤

- **步骤清单**：修改的顺序（每步一行，可勾选 `- [ ]`）
- 每个步骤标注修改的文件和行范围

#### 第四章：预期效果

- **验证方式**：如何确认修复生效（测试用例/手动验证步骤）
- **回滚方案**：修复失败时的回退路径

### 5.3 状态机规则

```python
# 继承自: gsp项目规范 rules-6 §5.3
STATUS_TRANSITIONS = {
    "待分析": ["分析中"],                    # 创建时默认状态
    "分析中": ["修复中", "待分析"],           # 可回退重新分析
    "修复中": ["已完成", "分析中"],           # 可回退重新分析
    "已完成": ["已关闭"],                     # 仅允许向已关闭推进
    "已关闭": [],                             # 终态，不可再变更
}
assert status != "已完成" or result_section.complete  # 结果未填则禁止标记已完成
assert status != "已关闭" or gn004_reviewed           # 未经独立审查禁止关闭
```

## 六、交付前审查对接（独立审查能力）

> 独立审查（GN-004 能力名）由 `general_purpose_task` 承载（prompt 注入审查 rubric，要求仅审查不写代码）。以下 `gn004_document_check` 伪代码描述审查逻辑，实际由 general_purpose_task 执行。

交付前审查时强制执行以下文档完整性检查：

```python
# 继承自: gsp项目规范 rules-6 §六
def gn004_document_check(module_id):
    """交付前自动执行的文档完整性审查（由 general_purpose_task 承载）"""
    issues = []

    # 1. 检查 .trae/documents/ 目录是否为空
    docs = list_documents()
    if not docs:
        issues.append({"level": "警示", "msg": ".trae/documents/ 为空，该项目无任何变更记录"})

    # 2. 对每个代码变更，检查是否有对应的文档
    for commit in get_code_changes(since=last_review):
        doc = find_corresponding_doc(commit)
        if not doc:
            issues.append({"level": "阻断", "msg": f"代码变更 {commit.file} 无对应文档，禁止合流"})

    # 3. 检查文档完整性
    for doc in docs:
        if not doc.has_complete_metadata():
            issues.append({"level": "阻断", "msg": f"{doc.name} 元数据不完整"})
        if doc.status == "已完成" and not doc.has_result_section():
            issues.append({"level": "阻断", "msg": f"{doc.name} 标记已完成但缺少最终结果"})
        if not doc.has_related_files():
            issues.append({"level": "警示", "msg": f"{doc.name} 未列出关联代码文件"})

    # 4. 检查命名规范性
    for doc in docs:
        if not re.match(r'^\d{8}_模块\d+_.+\.md$', doc.name):
            issues.append({"level": "阻断", "msg": f"{doc.name} 命名不符合 YYYYMMDD_模块N_变更简述.md 规范"})

    # 5. 运行时接入校验（v4.11.0 假闭合补强，与 rules-0 §四-13 联动）
    for commit in get_code_changes(since=last_review):
        if is_module_code(commit) and not is_wired_into_runtime(commit):
            issues.append({"level": "阻断", "msg": f"代码变更 {commit.file} 为孤岛代码（未接入运行时路由/事件总线/WS/被上游引用），禁止合流"})

    return issues

# 无对应文档的代码提交 → 禁止合流
# 文档未记录最终结果的 → 禁止合流
# 文档命名不规范的 → 禁止合流
# 元数据不完整的 → 禁止合流
# 孤岛代码（未接入运行时） → 禁止合流（v4.11.0 假闭合补强）
```

### 6.1 运行时接入校验条款（v4.11.0 假闭合补强）

与 [rules-0 §四-13](rules-0.md) 联动。交付前审查须对每个模块代码变更核验运行时接入证据，四者至少满足其一：

1. **路由注册**：模块 REST 路由已被路由聚合器挂载（`grep -rn "router.use\|app.use" panel/backend/src/api/index.ts` 等可查）
2. **事件总线订阅**：模块已订阅 event-bus 事件，或其产出事件被上游订阅
3. **WS 订阅**：模块已注册 WS 事件类型于 `public/schema/ws-events.ts` 且被消费
4. **被上游调用方引用**：模块导出符号被至少一个上游模块 import 并在主路径调用（`grep -rn "from.*modules/xxx"` 排除测试目录）

未满足任一者判定为孤岛代码，禁止合流。回溯依据：v4.11.0 假闭合（asset_service/execution_engine/commercial 三模块未接入运行时即被宣告闭合）。

## 七、合流时文档强制校验规则

- 合流时必须检查代码提交是否关联了对应的 `.trae/documents/` 下的文档
- 没有对应文档的代码提交 **禁止合流**
- 文档未记录最终结果的 **禁止合流**
- 文档元数据不完整的 **禁止合流**（v6 新增）
- 文档命名不符合 `YYYYMMDD_模块N_变更简述.md` 规范的 **禁止合流**（v6 新增）
- **孤岛代码（未接入运行时）禁止合流**（gsp 项目规范新增，v4.11.0 假闭合补强）

## 八、触发场景与 Skill 调用指引

### 8.1 触发场景

- 触发条件：需要修复 bug、优化功能、调整代码、记录问题、或合流前做文档校验时
- 触发关键字：修复、bug、问题、优化、调整、.trae/documents、变更追踪、问题文档
- 项目状态：全阶段（任何阶段都可能出现问题）

### 8.2 Skill 调用指引

| 场景 | 对应 Skill |
|------|-----------|
| 创建/更新变更追踪文档（按模板写入 `.trae/documents/`） | s0401 |

- 说明：s0401 负责按本文件定义的模板、命名规范和状态机规则创建/更新变更追踪文档，并执行安全写入。原 s302 模板已并入 s0401。合流前文档完整性校验由独立审查（GN-004 能力，general_purpose_task 承载）自动执行，不再由独立 Skill 承载。
