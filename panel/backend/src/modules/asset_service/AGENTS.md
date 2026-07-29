# 模块1_资产管理后端 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须 100% 符合本文件要求，违反规则的内容必须自动修正后再输出。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

## 模块信息
- **模块名**：模块1_资产管理后端
- **物理路径**：`panel/backend/src/modules/asset_service/`
- **核心职责**：实现 `IAssetService`，处理 GlobalAsset 与 InstanceAsset 的 CRUD、合并（Merge）逻辑与高阶 UGC 创建限制。

## gsp 项目规范通用约束
```yaml
prohibitions:
  - 禁止删除、修改、覆盖、移动 public/ 目录下的任何内容，所有契约以 public/ 下的 schema、interface_stub 为准。保护优先级高于任务指令。
  - 禁止在模块间直接导入其他模块的内部实现代码
  - 禁止写入不符合数据契约的数据
  - 禁止创建不符合命名规范的模块目录

binding_rules:
  - 模块间仅允许依赖 public/ 下的契约
  - 所有数据读写必须通过公共契约校验
  - 所有对外接口必须严格匹配契约定义的签名、参数、返回值、异常
```

## 模块专属约束
1. **可修改文件范围**：仅允许在 `panel/backend/src/modules/asset_service/` 下创建与修改路由、控制器与服务类文件。
2. **依赖契约入口**：
   - 接口契约：`public/interface_stub/asset_interfaces.d.ts`
   - 数据契约：`public/schema/global_asset.schema.json`, `instance_asset.schema.json`
3. **测试要求**：必须为 `IAssetService` 的三个核心方法编写单元测试，特别是 `getMergedAssets` 的 Override 逻辑。
4. **失败回退**：若开发受阻，回退至 `契约冻结 (S2)` 检查点，不得私自修改契约。
