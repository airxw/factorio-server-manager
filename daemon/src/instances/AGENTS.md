# 模块4_Daemon实例管理 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块4_Daemon实例管理
- **物理路径**：`daemon/src/instances/`
- **职责**：ProcessDriver(spawn) + 状态机 + 就绪检测 + 事件触发
- **依赖**：模块0（类型）、模块2（Daemon 骨架）、模块3（Pack ready_pattern）
- **Wave**：Wave 2 批2（G3批1完成后启动）

---

## 可修改文件范围

```
daemon/src/instances/
├── manager.ts                      # InstanceManager
├── processDriver.ts                # child_process.spawn 封装
├── readiness.ts                    # 按 ready_pattern 正则匹配 stdout
└── stateMachine.ts                 # 状态机：stopped↔starting↔running↔stopping + error
```

## gsp 项目规范通用约束

- 禁止 import `panel/` 内部代码
- 仅允许 import `public/schema/` 和 `public/interface_stub/` 下的契约
- 状态变更必须触发 WS 事件（通过模块2的 ws 实例）

## 模块专属约束

1. **ProcessDriver**：使用 `child_process.spawn`，P0 无 Docker
2. **状态机**：`stopped → starting → running → stopping → stopped`，任意状态可转 `error`
3. **就绪检测**：按 Pack 的 `ready_pattern` 正则匹配 stdout，命中后转 `running`
4. **停止超时**：`stop_timeout`（默认 30s）后强杀进程
5. **僵尸进程**：使用 `process.kill` + 超时强杀，防止子进程未退出
6. **事件触发**：状态变更触发 `instance.started` / `instance.stopped` / `state.change` 事件
7. **stdout/stderr 转发**：进程输出通过 `console.output` 事件转发

## 依赖的契约入口

- `public/schema/ws-events.ts` → 事件类型
- `public/schema/pack-schema.ts` → Pack startup/ready_pattern 结构
- `public/interface_stub/command-protocol.ts` → 命令协议接口（停止命令发送）

## 测试要求

- spawn 一个 mock 进程（echo 日志），状态流转正确
- 就绪检测命中 ready_pattern
- 停止超时后强杀
- 单元测试 PASS

## 失败回退

- 回退点：PoC 验证通过检查点
- 策略：回退到 mock 进程测试，ProcessDriver 用 echo 脚本验证状态流转

## 闭合判据

- mock 进程状态流转 stopped→starting→running→stopping→stopped 闭环
- 就绪检测命中
- 无死锁状态
