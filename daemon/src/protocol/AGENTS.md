# 模块5_Daemon协议层 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块5_Daemon协议层
- **物理路径**：`daemon/src/protocol/`
- **职责**：RconClient + stdinClient(stub) + ProtocolFactory + CommandProtocol 接口
- **依赖**：模块0（protocol schema）、模块2（Daemon 骨架）
- **Wave**：Wave 2 P-G3 批1（与模块6并行）

---

## 可修改文件范围

```
daemon/src/protocol/
├── rconClient.ts                   # 基于 rcon-client 封装
├── stdinClient.ts                  # stdin 写入（Factorio 预留，P0 stub）
├── factory.ts                      # ProtocolFactory.create(pack, instance)
├── types.ts                        # CommandProtocol 接口本地定义（实现 public 接口）
└── rconClient.test.ts              # 单元测试
```

## gsp 项目规范通用约束

- 禁止 import `panel/` 内部代码
- 必须实现 `public/interface_stub/command-protocol.ts` 接口
- 仅允许 import `public/schema/` 下的契约类型

## 模块专属约束

1. **RCON 库**：使用 `rcon-client@^4.2.4`（非 rcon-node，PoC 已验证）
2. **CommandProtocol 接口**：`send(command: string): Promise<string | null>`
   - rcon/webrcon 返回响应字符串
   - stdin 返回 null（单向通信，无响应）
3. **ProtocolFactory**：根据 `pack.protocol.type` 创建对应客户端
   - `stdin` → StdinClient
   - `rcon` → RconClient
   - `webrcon` → WebRconClient（P0 可与 RconClient 复用）
4. **stdinClient**：P0 为 stub 实现（Factorio Pack 推迟 P2.1），仅接口声明
5. **连接管理**：RconClient 支持连接/断开/重连，错误密码抛异常
6. **Source RCON 协议**：TCP，`[Size:4LE][ID:4LE][Type:4LE][Body][NullTerm:2]`（PoC 已验证）

## 依赖的契约入口

- `public/schema/pack-schema.ts` → protocol discriminatedUnion 类型
- `public/interface_stub/command-protocol.ts` → CommandProtocol 接口
- `public/pre_generated_mock/rcon-mock-server.ts` → 测试用 mock RCON server

## 测试要求

- 连接 PoC mock RCON server，发送 `list` 收到响应
- 错误密码抛异常
- 断线重连
- 单元测试 PASS

## 失败回退

- 回退点：PoC `poc/rcon-client/`（已验证 8 命令全成功）
- 策略：回退到 PoC 版本 rcon-client 封装

## 闭合判据

- 连接 mock RCON server 成功
- `list` 命令收到正确响应
- 错误密码被拒绝
- ProtocolFactory 根据 protocol.type 正确创建客户端
