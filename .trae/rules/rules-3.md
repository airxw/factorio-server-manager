---
description: gsp项目规范——三层契约定义，数据Schema/接口存根(.d.ts)/配置Schema的强制规范，含Mock机制、契约可验证性要求与版本化规则（由AC范式v6升级，jsonschema→zod+ajv双轨）
alwaysApply: true
condition_mapping: HC-1/EC-3/EC-4
---
# gsp 项目规范——三层契约定义

> 🚨 【最高优先级规则】本文件为三层契约定义的强制约束

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

> 本文件优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须100%符合本文件要求，违反规则的内容必须自动修正后再输出。

## 一、数据契约

### 1.1 定义规范

```yaml
format: JSON Schema (draft-07+)
scope: 所有核心数据结构
required_fields: [type, 取值范围, 必填性, 默认值, 字段描述]
```

用标准 JSON Schema 定义所有核心数据结构，字段描述必须无歧义，禁止以注释替代 Schema 约束。

### 1.2 强制要求

```yaml
data_contract:
  schema_description: "字段描述无歧义"
  validation: "所有数据读写通过 zod schema（运行时）+ ajv（JSON Schema 元校验）双轨自动校验，不符合契约的数据禁止入库"
  error_codes: "必须包含错误码与异常契约，统一定义全局错误码，避免模块间异常拦截歧义"
  location: "public/schema/"
```

## 二、接口契约

### 2.1 定义规范

```yaml
format: TypeScript .d.ts 声明文件
scope: 所有对外接口
required_fields: [方法名, 参数类型, 返回值类型, 抛出异常]
implementation: "零实现逻辑，仅声明签名"
```

### 2.2 强制要求

```yaml
interface_contract:
  exception_doc: "接口契约必须包含异常说明，调用方必须处理约定的异常"
  signature_match: "模块实现必须严格匹配存根定义的签名，否则契约测试不通过"
  location: "public/interface_stub/"
```

## 三、配置契约

### 3.1 定义规范

```yaml
format: JSON Schema
scope: 所有配置文件结构
required_fields: [参数取值范围, 默认值]
prohibition: "禁止业务代码硬编码配置参数"
```

### 3.2 强制要求

```yaml
config_contract:
  defaults: "配置契约必须包含默认值"
  auto_fill: "配置加载时自动补充缺失字段（zod default）"
  location: "public/config_template/"
```

## 四、Mock 机制（并行开发适配）

> 从 rules-2 侧吸收并单边保留。Mock 是契约冻结后并行开发的核心适配层。

```python
# Mock 机制三原则
MOCK_RULES = {
    "预生成": "契约冻结后，工具自动根据接口存根生成所有模块的默认Mock实现，返回符合数据契约的模拟值",
    "零等待": "开发阶段所有模块默认导入 pre_generated_mock/ 下的Mock，无需等待其他模块开发完成即可联调",
    "可覆盖": "开发者可自定义 global_mock/ 下的Mock实现覆盖默认值，适配特殊测试场景",
}

# 切换路径：Mock → 真实实现
# 模块B开发完成后，pre_generated_mock/*.ts 与真实实现通过 tsconfig paths alias 切换，
# 调用方零改动（仅切 alias 指向），代码无需其他改动
```

## 五、契约可验证性要求

> 契约不是文本声明，而是可自动执行的约束。

```yaml
contract_verifiability:
  test_suite:
    requirement: "每层契约必须附带可自主执行的测试套件"
    scope: [数据契约校验用例, 接口契约签名匹配用例, 配置契约默认值填充用例]
  rubric:
    requirement: "每层契约必须附带合规 rubric（通过/失败判据清单）"
    usage: "独立审查交付前审查验证其通过状态，rubric 全部通过方视为契约有效"
  self_test:
    requirement: "LLM 在契约产出后必须自主运行测试套件，结果记录于 note"
```

独立审查对契约的审查限于外部行为接口：拉起 `subagent_type='general_purpose_task'`（prompt 注入审查 rubric，要求仅审查不写代码），验证测试套件是否全部通过、rubric 是否全覆盖契约字段。主 agent 按 [rules-0 §四-8](rules-0.md) 的 `handle_gn004()` 循环响应（阻断/警示放行/通过）。

## 六、契约版本化规则

```yaml
contract_versioning:
  mandatory_fields: [版本号, 变更内容, 变更原因, 影响范围]
  format: "语义版本号（MAJOR.MINOR.PATCH）"
  location: "public/schema/CHANGELOG.md 或各契约文件头部 @version 注释"
  trigger:
    MAJOR: "字段删除、类型变更、必填性反转 → 所有依赖模块TODO清单自动生成适配提示"
    MINOR: "新增可选字段、新增接口方法 → 通知依赖模块，不阻断"
    PATCH: "字段描述修正、默认值调整 → 记录即可"
```

## 七、Skill 调用指引

| 场景 | Skill |
|------|----------|
| 生成三层契约（数据/接口/配置） | s0201 |
| 基于接口契约生成预生成Mock | s0202 |
