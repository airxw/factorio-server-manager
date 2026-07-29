# 模块0_共享契约层 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须 100% 符合本文件要求，违反规则的内容必须自动修正后再输出。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块0_共享契约层
- **物理路径**：`public/`
- **职责**：Pack zod schema、API 契约类型、WS 事件类型、Mock 资源、配置模板
- **依赖**：无（基础层，所有其他模块依赖本模块）
- **Wave**：Wave 0（最先开发）

---

## 可修改文件范围

```
public/
├── schema/
│   ├── pack-schema.ts              # Pack zod schema（从 PoC 迁移）
│   ├── daemon-api-types.ts         # Panel↔Daemon REST 类型
│   ├── panel-api-types.ts          # Panel↔Frontend REST 类型
│   └── ws-events.ts                # WS 事件类型
├── interface_stub/
│   ├── daemon-rest.ts              # Daemon REST 接口签名
│   ├── panel-rest.ts               # Panel REST 接口签名
│   └── command-protocol.ts         # CommandProtocol 接口
├── pre_generated_mock/
│   └── rcon-mock-server.ts         # PoC mock RCON server
├── config_template/
│   ├── panel.env.template
│   └── daemon.env.template
└── test_cases/
    └── pack-fixtures/              # Pack 校验测试数据
```

## gsp 项目规范通用约束

- 禁止跨模块直接导入其他模块内部实现
- 所有类型定义必须用 zod 或 TypeScript interface/type
- schema 文件零实现逻辑，仅声明类型与校验规则
- interface_stub 文件零实现，仅声明接口签名

## 模块专属约束

1. **PoC 迁移**：`pack-schema.ts` 从 `poc/pack-yaml/schema.ts` 直接迁移，保留 `zod.discriminatedUnion` 协议层设计
2. **Mock 资源**：`rcon-mock-server.ts` 从 `poc/rcon-client/mock-server.ts` 迁移，供 Daemon 单元测试和 E2E 测试共用
3. **TS 适配**：rules-3 的 `.pyi` 存根格式适配为 TypeScript `.ts` 类型声明文件（interface/type 仅声明，零实现）
4. **配置模板**：`.env.template` 包含所有必需环境变量及默认值

## 测试要求

- `pack-schema.ts` 必须有单元测试：加载 valid pack 成功 + invalid pack 抛出明确错误
- 测试数据放在 `test_cases/pack-fixtures/`（valid + invalid YAML）

## 失败回退

- 回退点：PoC `poc/pack-yaml/schema.ts`（已验证通过）
- 策略：直接回退到 PoC 版本，重新迁移

## 闭合判据

- schema/类型/Mock 可被 Panel/Daemon/Frontend 导入
- `tsc --noEmit` 通过，无 TS 编译错误
- Pack schema 单元测试 PASS
