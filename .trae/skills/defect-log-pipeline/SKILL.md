---
name: "defect-log-pipeline"
description: "Manages defect-log repository: query hazards before tasks, auto-record after bug fixes, sync to deploy-preflight/checklists. Invoke before tasks, after fixes, or pre-deploy."
---

# 隐患库全闭环管理（Defect Log Pipeline）

> 📌 本 Skill 是 gsp 项目隐患库的**唯一操作入口**。隐患库是可检索仓库而非全量加载文档，AI 通过本 Skill 的三个核心工具按需查询、自动录入、转化同步。

## 触发条件

| 场景 | 触发动作 |
|------|---------|
| 执行任何任务/操作前 | 调用 `defect:query` 检索相关隐患 |
| 遇到错误/报错时 | 调用 `defect:query --error` 查询是否已有诊断 |
| 错误诊断并成功修复后 | 调用 `defect:record` 自动录入新条目 |
| 修复 bug 后需要转化 | 调用 `defect:sync` 校验完整性+生成检查清单 |
| 部署前 | 调用 `deploy-preflight.sh` 运行部署预检 |
| 定期技术债扫描 | 调用 `defect:query` 无参数获取统计摘要 |

## 核心工具

### 1. 检索接口 `scripts/defect-query.ts`

**用途**：按需查询隐患库，不全量加载 defect-log.md，仅返回匹配条目。

```bash
# 按任务描述匹配
npm run defect:query -- --task "部署前端到服务器"

# 按错误信息匹配
npm run defect:query -- --error "fetch failed 4ms"

# 按类别+等级过滤
npm run defect:query -- --category deploy --level P0

# 全文关键词搜索
npm run defect:query -- --keyword "steamcmd"

# 按 ID 精确查询
npm run defect:query -- --id DEF-001

# 无参数返回统计摘要（总数/P0/P1/P2/未转化数）
npm run defect:query
```

**输出**：JSON（供程序化消费）或 `--human` 人类可读表格。仅返回匹配条目的完整字段。

### 2. 自动录入接口 `scripts/defect-record.ts`

**用途**：错误解决后自动记录到隐患库，分配 ID，触发同步。

```bash
# 标准录入
npm run defect:record -- \
  --error "fetch failed 4ms" \
  --solution "目标端口无进程监听，启动 daemon 服务" \
  --root-cause "端口分裂：deploy.sh DAEMON_PORT=18432 vs .env PORT=8080" \
  --category deploy \
  --level P0

# 交互式录入（无 --error 参数时）
npm run defect:record
```

**校验规则**：
- `--error` 和 `--solution` 必填，不允许录入无解决方案的隐患
- `--category` 必须为合法类别（deploy/code/fullstack/config/security）
- 录入后自动标注 `转化状态: 未转化`，P0/P1 触发 sync 告警
- 录入后自动调用 `defect-sync.ts` 同步

### 3. 转化管道 `scripts/defect-sync.ts`

**用途**：校验隐患库完整性，生成转化状态总览和检查清单骨架。

```bash
npm run defect:sync
```

**校验规则**（任一失败则 exit 1）：
- 所有 P0/P1 隐患的 `转化状态` 必须为 `已转化`
- 所有 P0/P1 隐患的 `转化产物` 必须非空且指向真实存在的文件/规则
- DEF-ID 必须唯一且连续递增

**产出**：
- `docs/defect-checklist.md`：转化状态总览
- `scripts/deploy-preflight.sh` 检查项注释块骨架（deploy 类 P0/P1 条目）

## 工作流：查→做→错→修→记

```
查 ── 任务前调用 defect:query --task 检索相关隐患
       遇到报错时调用 defect:query --error 查已有诊断
       查询结果作为施工卡上下文，不全量读取 defect-log.md
│
做 ── 遵守查询返回的预防措施和转化产物约束
       P0/P1 未转化的，npm run check 阻断
│
错 ── 操作中遇到错误，先查询隐患库是否已有诊断
       已有诊断 → 按预防措施执行修复
       无诊断 → 进入修→记流程
│
修 ── 原文件基础上极限修正（rules-0 §一-3 极力挽救原则）
       修复后运行测试/预检验证问题已解决
│
记 ── 修复成功后立即调用 defect:record 自动录入
       录入后自动触发 defect-sync 同步
       P0/P1 新隐患需在下次门禁前完成转化
```

## defect-log.md 条目格式

隐患库数据源：`docs/defect-log.md`，结构化 markdown。

```markdown
### DEF-001: {一句话标题}

| 字段 | 值 |
|------|-----|
| ID | DEF-001 |
| 等级 | P0致命 / P1严重 / P2一般 |
| 类别 | deploy / code / fullstack / config / security |
| 首次发生版本 | x.x.x |
| 现象 | { 可观测症状 } |
| 根因 | { 根本原因 } |
| 预防措施 | { 预防方法 } |
| 转化状态 | 未转化 / 已转化 |
| 转化产物 | deploy-preflight:#CHECK / test:defect-regression/DEF-001.test.ts / lint:rule-name / checklist:rules-0§3.1.x / negative:prompts/negative-constraints.md#x |
```

### 分级标准

- **P0致命**：服务无法启动 / 数据丢失 / 安全漏洞 / 部署后不可用。必须转化且门禁阻断。
- **P1严重**：功能异常 / 性能退化 / 用户体验严重受损。必须转化且门禁阻断。
- **P2一般**：边界情况 / 代码异味 / 文档缺失。建议转化，不阻断门禁。

### 类别标准

- **deploy**：部署、端口、路径、systemd、nginx、SSL、环境变量
- **code**：代码逻辑、框架用法、路由结构、状态管理
- **fullstack**：前后端契约、数据模型、API 一致性
- **config**：配置文件、.env、模板、默认值
- **security**：鉴权、输入校验、敏感信息暴露、路径穿越

## 转化产物类型

每条 P0/P1 隐患必须至少有一个转化产物：

| 类型前缀 | 含义 | 挂载位置 |
|----------|------|---------|
| `deploy-preflight:#CHECK` | 部署预检检查项 | `scripts/deploy-preflight.sh` |
| `test:DEF-xxx.test.ts` | 回归测试 | `tests/defect-regression/` |
| `lint:rule-name` | lint 规则 | eslint 自定义规则 |
| `checklist:rules-0§3.1.x` | 代码审查清单项 | `.trae/rules/rules-0.md §3.1` |
| `negative:prompts/negative-constraints.md#x` | 负面清单条目 | `prompts/negative-constraints.md` |

## 门禁集成

| 门禁点 | 消费内容 | 阻断条件 |
|--------|---------|---------|
| `npm run check`（check-all.ts） | defect:sync 完整性校验 + localhost 合规 + 部署预检本地子集 | P0/P1 未转化 → 阻断 |
| `deploy.sh` preflight | deploy-preflight.sh 全量 | 任一检查项 FAIL → 阻断（`--force` 可跳过） |
| CI（如有） | check-all.ts 全量 | 同 npm run check |

## 部署预检检查项（deploy-preflight.sh）

以下检查项对应 defect-log 中的 deploy 类隐患，每项 FAIL 时附带修复建议：

- **PORT_CONSISTENCY**：deploy.sh 端口 vs .env 端口一致性
- **DIST_PATH**：前端 dist 部署到 `panel/frontend/dist/`（非根 dist/）
- **SYSTEMD_SERVICES**：gameserver-panel.service + gameserver-daemon.service 存在且 enabled
- **NO_DEV_MODE**：ExecStart 不含 `npm run dev` / `tsx watch` / `nodemon`
- **SSH_PERSISTENCE**：systemd 托管而非 SSH 前台进程
- **NO_LOCALHOST_3000**：dist 中无 `localhost:3000` / `127.0.0.1:3000`（对齐 0.md §四）
- **NO_LOCALHOST_127_3000**：dist 中无 `127.0.0.1:3000`（对齐 0.md §一-2）
- **PANEL_BIND_127**：Panel 绑定 `127.0.0.1` 而非 `0.0.0.0`
- **DAEMON_8080_NOT_PUBLIC**：8080 不对公网开放
- **SSL_CERT_EXISTS**：SSL 证书存在
- **NGINX_SITE_CONFIG**：nginx 站点配置存在且 symlink 到 sites-enabled
- **ENV_REQUIRED_FIELDS**：.env 必需字段齐全
- **JWT_SECRET_LENGTH**：JWT_SECRET 长度 ≥ 16
- **MIGRATION_NO_GUARD_CLAUSE**：migrations 无 `if (hasTable) return`
- **BUILD_ID_PRESENT**：构建产物含 BUILD 标识

支持参数：`--fix`（自动修复可修复项）、`--deploy-dir`（指定部署目录）。

## 参考文档

- 方案文档：`docs/plans/defect-log-pipeline-plan.md`（完整执行步骤）
- 浏览器端服务器地址规则：`.trae/rules/0.md`（端口合规性最高规则）
- 核心行为规则：`.trae/rules/rules-0.md` §3.1（代码审查清单）§四-3（可验证证据链）
