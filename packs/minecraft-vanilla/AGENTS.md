# 模块3_Minecraft游戏包 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：模块3_Minecraft游戏包
- **物理路径**：`packs/minecraft-vanilla/`
- **职责**：完整 Pack YAML 定义（启动/命令/配置/版本/备份/EULA）
- **依赖**：模块0（public/schema/pack-schema.ts 用于校验）
- **Wave**：Wave 1 P-G2（G1完成后启动）

---

## 可修改文件范围

```
packs/minecraft-vanilla/
└── pack.yaml                       # 完整 Pack 定义
```

## gsp 项目规范通用约束

- Pack YAML 必须通过 `public/schema/pack-schema.ts` 的 zod 校验
- 禁止在 Pack 中硬编码服务器地址、密码等环境相关信息
- 命令模板变量使用 `{{var}}` 语法

## 模块专属约束

1. **协议类型**：`protocol.type: rcon`，`default_port: 25575`，`auth: password`
2. **启动命令**：`java -Xmx{{jvm_xmx}} -Xms{{jvm_xms}} -jar server.jar nogui`
3. **就绪检测**：`ready_pattern: 'Done \([\d.]+s\)! For help, type "help"'`
4. **停止命令**：`stop_command: "stop"`（通过 RCON 发送）
5. **配置格式**：`format: properties`，主文件 `server.properties`
6. **配置字段**：20+ 字段（server-port, max-players, motd, difficulty, enable-rcon 等）
7. **命令映射**：broadcast/give/kick/ban/list/save/op/deop/whitelist/time/weather
8. **版本源**：Mojang manifest `https://piston-meta.mojang.com/mc/game/version_manifest.json`
9. **EULA**：`eula_required: true`，`eula_file: eula.txt`
10. **备份**：`world_dir: world`，pre_backup: save-off/save-all，post_backup: save-on

## 依赖的契约入口

- `public/schema/pack-schema.ts` → Pack zod schema（校验 Pack 结构）

## 测试要求

- `pack.yaml` 通过 zod 校验
- 所有命令模板变量已声明
- `npm run packs:validate` PASS

## 失败回退

- 回退点：PoC `poc/pack-yaml/packs/minecraft-vanilla.yaml`（已通过校验）
- 策略：直接迁移 PoC 版本，补充完善配置字段

## 闭合判据

- `packs/minecraft-vanilla/pack.yaml` 通过 zod 校验
- 所有命令模板变量已声明
- 配置字段 20+ 完整
