# 模块2_系统诊断 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须 100% 符合本文件要求，违反规则的内容必须自动修正后再输出。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

---

## 模块信息

- **模块名**：模块2_系统诊断
- **物理路径**：`modules/模块2_系统诊断/`
- **职责**：静态诊断规则检查 + 白名单脚本修复执行
- **依赖**：public/（公共契约）
- **Wave**：S4 Batch2（与模块3并行）

---

## 可修改文件范围

```
modules/模块2_系统诊断/
├── systemDiagnosticService.ts
├── systemDiagnosticRoute.ts
├── config/
│   ├── diagnostic-rules.json            # 静态诊断规则
│   └── diagnostic-fixes.json           # 修复脚本白名单
├── scripts/
│   ├── fix-disk-full.sh                # 示例：磁盘满修复
│   ├── fix-permission.sh               # 示例：权限修复
│   └── fix-stale-lock.sh               # 示例：僵尸锁清理
└── AGENTS.md
```

**允许修改（装配时）**：`panel/backend/src/index.ts`（仅新增 import + app.use + app.locals.systemDiagnosticService）

**禁止修改**：`public/` 下任何文件、`panel/backend/src/services/` 既有文件、`panel/frontend/`

---

## gsp 项目规范通用约束（含禁止操作清单）

> 🚨 **public/ 目录保护**：`public/` 目录是契约的物理载体，不是代码库的可变部分。任何删除、修改、覆盖、移动 `public/` 下文件的操作必须先经人类显式授权。契约变更必须走 s0601 流程，不得直接编辑 public/ 文件。

```yaml
prohibitions:
  - 禁止删除、修改、覆盖、移动 public/ 目录下的任何内容
  - 禁止在模块间直接导入其他模块的内部实现代码
  - 禁止 import panel/backend/src/services/ 或 panel/backend/src/api/routes/ 内部实现
  - 禁止写入不符合数据契约的数据
  - 禁止创建不符合命名规范的模块目录
  - 禁止使用相对路径跨目录引用（必须用 TS path alias @public/* 或 @modules/*）

binding_rules:
  - 模块间仅允许依赖 public/ 下的契约（schema/、interface_stub/）
  - 所有数据读写必须通过公共契约校验（zod schema）
  - 所有对外接口必须严格匹配契约定义的签名、参数、返回值、异常
  - 共享基础设施（db knex connection、daemonClient、app.locals 注入）通过构造函数注入，不视为模块内部依赖
```

---

## 模块专属约束

1. **诊断规则来源**：`config/diagnostic-rules.json`（静态配置，不硬编码到 service）
2. **修复脚本白名单**：`config/diagnostic-fixes.json`（fixId → script 路径映射）
3. **脚本目录限制**：所有修复脚本必须位于 `modules/模块2_系统诊断/scripts/` 目录内
4. **路径校验**：执行前用 `path.resolve` 校验脚本路径在 `scripts/` 内，防止路径遍历
5. **执行方式**：`child_process.execFile`（非 `exec`，避免 shell 注入），timeout 30s
6. **权限降级**：脚本以非 root 用户执行（若 panel 进程为 root，降级到 `NODE_USER` 或 `nobody`）
7. **诊断规则结构**：`{id, title, check_type, check_params, severity, fixable, fix_id}`
   - `check_type`: `disk_usage`, `file_exists`, `process_running`, `port_listening`, `db_connectivity`
8. **修复映射结构**：`{fixId, script, args, timeout_ms, description}`
9. **不存在的 fixId 抛 `SystemFixInvalidError`**（404）
10. **诊断结果不缓存**（每次实时检查）

---

## 依赖的契约入口

- `public/interface_stub/system-diagnostic-service.d.ts` → 接口签名（@version 1.0.0）
- `public/interface_stub/shared-types.d.ts` → `DiagnosticProblem`, `DiagnosticsResult`, `ApplyFixResponse`
- `public/schema/error-codes-schema.json` → `SYSTEM_FIX_001`
- `public/config_template/panel-config.schema.json` → `diagnostic_rules_path`, `diagnostic_fixes_path`

---

## 测试要求

- `runDiagnostics()` 返回 `problems[]`，每个 problem 包含 `id`/`title`/`description`/`severity`/`fixable`/`fixSuggestion`
- `applyFix(validFixId)` 返回 `{fixId, success, message}`
- `applyFix(invalidFixId)` 抛 `SystemFixInvalidError`（404）
- **路径遍历攻击**（`fixId='../../../etc/passwd'`）被 `path.resolve` 拒绝
- 脚本执行超时（>30s）返回 `success=false, message='timeout'`
- 端点经 `authenticateToken` + `requireAdmin`

---

## 失败回退

- **回退点 R3**：删除 `modules/模块2_系统诊断/` 目录，不注册路由
- 无 migration，无 DB 副作用
- 诊断失败不影响 panel 运行（仅返回错误结果）

---

## 闭合判据

- [x] `tsc --noEmit` 通过（v4.19.3 npm run check 验证）
- [x] `diagnostic-rules.json` + `diagnostic-fixes.json` schema 校验通过（services-init.ts L246-L250 加载配置文件）
- [x] 2 个端点返回正确响应格式（路由已挂载于 routes-registry.ts L101 `createSystemDiagnosticRouter`）
- [x] 至少 1 个诊断规则 + 1 个修复脚本通过端到端验证（v4.15.0 部署验证）
- [x] 路径遍历攻击被拒绝（`path.resolve` + DEPLOY_ROOT 边界校验已实施）

> **闭合状态**：v4.19.3 已闭合。运行时接入证据：
> - 路由注册：`panel/backend/src/routes-registry.ts#L101`（`createSystemDiagnosticRouter`）
> - 服务注入：`panel/backend/src/services-init.ts#L67-L254`（`createSystemDiagnosticService` → `app.locals.systemDiagnosticService`）
