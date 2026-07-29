---
description: gsp项目规范——目录架构与命名规范，定义标准目录树、模块命名强制规则（由AC范式v6升级而来）
alwaysApply: true
condition_mapping: EC-2/EC-3
---
# gsp 项目规范——目录架构与命名规范

> 🚨 【最高优先级规则】本文件为项目全局架构的强制约束

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

## 一、标准目录架构（双进程集群特化版）

### 1.1 根目录结构

```yaml
Project_Root:
  panel/:                 # Panel 控制端业务线（含 frontend 与 backend，核心架构线之一）
  daemon/:                # Daemon 节点端业务线（受控服务端，核心架构线之二）
  public/:                # 全局公共资源区（契约优先，定义 schema、interface 等，仅项目负责人可修改）
  modules/:               # 独立运维/系统级挂载模块（系统自更新/监控/诊断/用户安全等核心运维能力），按「模块N_模块中文名」命名
  docs/:                  # 文档目录（含 research/ plans/ guides/ archive/）
  README.md:              # 用户向入口锚点
  current-note.md:        # 工程跨断面状态交接锚点
```

### 1.2 公共资源区结构

```yaml
public/:
  schema/:                # 数据契约（不变，见 rules-3）
  interface_stub/:        # 接口契约（.d.ts 存根，见 rules-3）
  pre_generated_mock/:    # 全量预生成Mock（Mock规则见 rules-3§四）
  global_mock/:           # 全局可自定义Mock
  config_template/:       # 配置模板（不变）
  dependencies/:          # 依赖锁定
  test_cases/:            # 通用测试用例
```

## 二、模块命名强制规则

```yaml
naming:
  pattern: "模块{N}_{中文名}"    # N为阿拉伯数字，从0开始递增
  rationale:
    - "数字前缀保证IDE中按依赖顺序排序"
    - "中文名称明确模块核心职责"
    - "模块数量不做固定限制，按需拆分"
```

## 三、交叉引用

| 规则域 | 指向 |
|--------|------|
| Mock机制（预生成Mock、导入切换、自定义覆盖） | [rules-3](rules-3.md) §四 |
| 禁止操作清单（禁改public/、禁跨模块导入、禁违约数据写入、禁违规命名） | [rules-4](rules-4.md) §gsp项目规范通用约束 |
