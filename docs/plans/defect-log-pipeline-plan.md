---
type: plan
title: 隐患库全闭环转化管道方案（defect-log → 转化 → 门禁挂载）
date: 2026-07-24
status: deployed
deployed_in: v4.17.x
related:
  - docs/Vibe_对话内容.txt
  - .trae/rules/rules-0.md
  - .trae/rules/0.md
  - scripts/check-all.ts
  - deploy.sh
  - project_memory.md（Lessons Learned）
tags: [defect-log, deploy-preflight, gate, pipeline, gsp-spec]
---

# 隐患库全闭环转化管道方案

## 目标

建立"录入 → 分级 → 转化 → 门禁挂载"的完整闭环，让每个踩过的坑只踩一次。核心解决：部署问题、代码问题、全栈问题在项目中重复发生而无机制拦截。

## 现状 gap

| 环节 | 现状 | gap |
|------|------|-----|
| 记录端 | project_memory.md(Lessons Learned ~20条) + docs/bugfix/ + docs/archive/deployment-experience.md + rules-0 §3.1(6条) | 四处分散，无统一入口，无结构化字段 |
| 检查端 | check-all.ts(5项) + deploy.sh check_env(内联) | 无部署预检独立脚本，无 localhost 合规检查，无 defect 完整性校验 |
| 转化管道 | rules-0 §3.1 手工沉淀6条 | 完全缺失——记录了但没变成可执行约束 |
| 门禁挂载 | check-all.ts + deploy.sh | 不消费 defect-log 内容，门禁与隐患库脱节 |

## 整体架构

隐患库是**可检索仓库**而非全量加载文档。AI 在执行任务前按需查询相关隐患，在错误解决后自动录入新条目，形成"查→做→错→修→记"动态闭环。

```
                    ┌──────────────────────────────────────┐
                    │   docs/defect-log.md                 │
                    │   （可检索仓库，结构化，不全量加载）    │
                    │   分级: P0/P1/P2   类别: 5类          │
                    └──────┬────────────────────┬──────────┘
                           │ 查询（按需）         │ 录入（自动）
                           ▼                     ▼
        ┌───────────────────────┐    ┌───────────────────────┐
        │ scripts/defect-query   │    │ scripts/defect-record │
        │   .ts                  │    │   .ts                 │
        │ 按任务/错误/类别/关键词 │    │ 错误详情+解决过程+结果 │
        │ 检索，仅返回匹配条目    │    │ 自动分配ID+写入+同步  │
        └──────────┬────────────┘    └──────────┬────────────┘
                   │                            │
    AI 任务前查询 ←┘                └→ AI 解决错误后录入
                   │
                   ▼
        ┌───────────────────────┐
        │ scripts/defect-sync    │
        │   .ts（转化管道）       │
        │ ├─→ deploy-preflight.sh（部署预检骨架）
        │ ├─→ rules-0 §3.1       （代码审查清单）
        │ ├─→ tests/defect-regression/（回归测试）
        │ ├─→ negative-constraints.md（负面清单）
        │ └─→ defect-checklist.md（转化状态总览）
        └──────────┬────────────┘
                   ▼
        门禁挂载
        ├─ check-all.ts   新增：defect完整性校验 + localhost合规 + 部署预检(本地子集)
        ├─ deploy.sh      新增：preflight阶段调用 deploy-preflight.sh
        └─ CI（如有）     消费 check-all.ts 全量
```

**三个核心工具**：
- `defect-query.ts` — 检索接口，不全量加载，仅返回匹配条目
- `defect-record.ts` — 录入接口，错误解决后自动记录并分配 ID
- `defect-sync.ts` — 转化管道，半自动：脚本校验完整性+生成骨架，具体约束代码人工编写

---

## 执行步骤

### 一、建立 defect-log.md 录入端

- [ ] 创建 `docs/defect-log.md`，包含以下结构化条目格式：

```markdown
### DEF-001: {一句话标题}

| 字段 | 值 |
|------|-----|
| ID | DEF-001 |
| 等级 | P0致命 / P1严重 / P2一般 |
| 类别 | deploy / code / fullstack / config / security |
| 首次发生版本 | x.x.x |
| 现象 | { observable symptom } |
| 根因 | { root cause } |
| 预防措施 | { prevention } |
| 转化状态 | 未转化 / 已转化 |
| 转化产物 | deploy-preflight:#PORT_CHECK / test:defect-regression/DEF-001.test.ts / lint:no-localhost-3000 / checklist:rules-0§3.1.x / negative:prompts/negative-constraints.md#x |
```

- [ ] 定义分级标准：
  - **P0致命**：服务无法启动 / 数据丢失 / 安全漏洞 / 部署后不可用。必须转化且门禁阻断。
  - **P1严重**：功能异常 / 性能退化 / 用户体验严重受损。必须转化且门禁阻断。
  - **P2一般**：边界情况 / 代码异味 / 文档缺失。建议转化，不阻断门禁。

- [ ] 定义类别标准：
  - **deploy**：部署、端口、路径、systemd、nginx、SSL、环境变量
  - **code**：代码逻辑、框架用法、路由结构、状态管理
  - **fullstack**：前后端契约、数据模型、API 一致性
  - **config**：配置文件、.env、模板、默认值
  - **security**：鉴权、输入校验、敏感信息暴露、路径穿越

### 二、建立检索接口 scripts/defect-query.ts（按需查询，不全量加载）

- [ ] 创建 `scripts/defect-query.ts`，作为隐患库的**唯一查询入口**，AI 执行任务前调用此工具获取相关隐患，而非全量读取 defect-log.md
- [ ] 支持以下查询模式：
  - `--task "部署前端到服务器"` — 按任务描述匹配，返回 deploy 类相关隐患
  - `--error "fetch failed 4ms"` — 按错误信息/报错文本匹配，返回诊断过的同类隐患
  - `--category deploy --level P0` — 按类别+等级过滤
  - `--keyword "steamcmd"` — 全文关键词搜索（现象/根因/预防措施字段）
  - `--id DEF-001` — 按 ID 精确查询单条
  - 无参数时返回统计摘要（总数/P0/P1/P2/未转化数），不返回全部条目
- [ ] 查询逻辑：解析 defect-log.md，按匹配度排序，仅返回匹配条目的完整字段（ID/等级/类别/现象/根因/预防措施/转化产物）
- [ ] 输出格式：JSON（供 AI 程序化消费）+ 人类可读表格（`--human` 参数）
- [ ] 在 `package.json` 根目录 scripts 中新增：`"defect:query": "tsx scripts/defect-query.ts"`

### 三、建立自动录入接口 scripts/defect-record.ts（错误解决后自动记录）

- [ ] 创建 `scripts/defect-record.ts`，作为隐患库的**唯一录入入口**，AI 在错误诊断并成功修复后调用此工具自动记录
- [ ] 录入流程：
  - 接收参数：`--error "错误详情"` `--solution "解决过程"` `--category deploy` `--root-cause "根因分析"` `--level P2`（默认 P2 待人工确认）
  - 自动分配 DEF-ID（读取现有最大 ID +1）
  - 自动生成结构化条目，追加到 `docs/defect-log.md` 末尾
  - 自动触发 `defect-sync.ts` 同步检查清单
  - 输出新分配的 DEF-ID，供后续回填转化产物
- [ ] 录入校验：
  - `--error` 和 `--solution` 必填，不允许录入无解决方案的隐患
  - `--category` 必须为合法类别（deploy/code/fullstack/config/security）
  - 录入后自动标注 `转化状态: 未转化`，P0/P1 会触发 `defect-sync` 告警
- [ ] 支持交互模式（无 `--error` 参数时）：引导式录入，逐步提示输入错误详情/根因/解决方案/类别/等级
- [ ] 在 `package.json` 根目录 scripts 中新增：`"defect:record": "tsx scripts/defect-record.ts"`

### 四、建立转化管道 scripts/defect-sync.ts

- [ ] 创建 `scripts/defect-sync.ts`，功能：
  - 解析 `docs/defect-log.md` 全部条目（按 `### DEF-xxx:` 标题分割，解析表格字段）
  - 生成 `docs/defect-checklist.md`：按等级+类别分组，列出每条隐患的转化状态和转化产物，标记未转化的 P0/P1 为 ⚠️
  - 校验规则（任一失败则 exit 1）：
    - 所有 P0/P1 隐患的 `转化状态` 必须为 `已转化`
    - 所有 P0/P1 隐患的 `转化产物` 必须非空且指向真实存在的文件/规则
    - DEF-ID 必须唯一且连续递增
  - 生成部署预检骨架：提取所有 `类别=deploy` 且 `等级=P0/P1` 的条目，输出为 `scripts/deploy-preflight.sh` 的检查项注释块（人工填充检查逻辑）
- [ ] defect-record.ts 录入后自动调用 defect-sync.ts，确保新条目立即纳入完整性校验
- [ ] 在 `package.json` 根目录 scripts 中新增：`"defect:sync": "tsx scripts/defect-sync.ts"`

### 五、建立独立部署预检 scripts/deploy-preflight.sh

- [ ] 创建 `scripts/deploy-preflight.sh`，包含以下检查项（每项对应 defect-log 中的 deploy 类隐患）：

  - **PORT_CONSISTENCY**：校验 `deploy.sh` 的 `DAEMON_PORT` / `PANEL_PORT` 与 `panel/backend/.env` 的 `PORT`、`daemon/.env` 的 `PORT` 一致
  - **DIST_PATH**：校验前端构建产物部署到 `/opt/gameserver-panel/panel/frontend/dist/`（非 `/opt/gameserver-panel/dist/`）
  - **SYSTEMD_SERVICES**：校验 `/etc/systemd/system/gameserver-panel.service` 和 `gameserver-daemon.service` 存在且 `enabled`
  - **NO_DEV_MODE**：校验 systemd 服务 ExecStart 不含 `npm run dev` / `tsx watch` / `nodemon`
  - **SSH_PERSISTENCE**：校验服务以 systemd 托管而非 SSH 前台进程（`systemctl is-active` 返回 active）
  - **NO_LOCALHOST_3000**：校验 `panel/frontend/dist/` 中无 `localhost:3000` / `127.0.0.1:3000` 字符串（对齐 0.md §四）
  - **NO_LOCALHOST_127_3000**：校验 `panel/frontend/dist/` 中无 `127.0.0.1:3000` 字符串（对齐 0.md §一-2）
  - **PANEL_BIND_127**：校验 Panel 后端绑定 `127.0.0.1` 而非 `0.0.0.0`（v4.0.1 起 Panel 内部端口 3002 不对外暴露）
  - **DAEMON_8080_NOT_PUBLIC**：校验 8080 端口不对公网开放（iptables/ufw 检查或 nginx 无 8080 监听）
  - **SSL_CERT_EXISTS**：校验 `/etc/nginx/ssl/gsp.ecsrz.com.fullchain.pem` 和 `privkey.key` 存在
  - **NGINX_SITE_CONFIG**：校验 `/etc/nginx/sites-available/gameserver-panel` 存在且已 `symlink` 到 `sites-enabled`
  - **ENV_REQUIRED_FIELDS**：从 deploy.sh check_env 抽取，校验 panel/backend/.env 和 daemon/.env 必需字段齐全
  - **JWT_SECRET_LENGTH**：校验 JWT_SECRET 长度 ≥ 16
  - **MIGRATION_NO_GUARD_CLAUSE**：校验 migrations 目录下无 `if (hasTable) return` 式 guard clause（会导致已存在表缺列）
  - **BUILD_ID_PRESENT**：校验前端构建产物包含 BUILD 标识（对齐 project_memory 部署编码要求）

- [ ] 每个检查项输出格式：`[PASS]/[FAIL] CHECK_NAME — 描述`，FAIL 时附带修复建议
- [ ] 支持 `--fix` 参数：对可自动修复的项（如补全 .env 字段）执行修复
- [ ] 支持 `--deploy-dir` 参数：指定部署目录（默认 `/opt/gameserver-panel`），用于在开发目录预检

### 六、挂载到 check-all.ts

- [ ] 在 `scripts/check-all.ts` 新增检查项：

  - **defect-log 完整性校验**：调用 `npm run defect:sync`，校验所有 P0/P1 隐患已转化
  - **localhost 合规校验**：grep `panel/frontend/dist/` 中无 `localhost:3000` / `127.0.0.1:3000`（仅在 dist 存在时执行）
  - **部署预检（本地子集）**：调用 `scripts/deploy-preflight.sh --deploy-dir .`，仅跑不依赖远程服务器的检查项（PORT_CONSISTENCY / NO_LOCALHOST_3000 / MIGRATION_NO_GUARD_CLAUSE / BUILD_ID_PRESENT）

- [ ] 更新 check-all.ts 的汇总报告，包含新增检查项

### 七、挂载到 deploy.sh

- [ ] 在 deploy.sh 的 `install` / `update` / `one-click` 命令前，新增 preflight 阶段：
  - 调用 `bash scripts/deploy-preflight.sh --deploy-dir $INSTALL_DIR`
  - 任一检查项 FAIL 则中止部署，输出修复建议
  - `--force` 参数可跳过 preflight（仅用于紧急恢复，输出警告日志）

- [ ] 从 deploy.sh 的 `check_env` 函数中抽取通用逻辑到 `deploy-preflight.sh`，deploy.sh 改为调用预检脚本，避免逻辑重复

### 八、扩展 rules-0 §3.1 代码审查清单

- [ ] 从 defect-log 中提取所有 `类别=code` 且 `等级=P0/P1` 的隐患，转化为 rules-0 §3.1 的新增审查项
- [ ] 每个审查项格式对齐现有 §3.1.1~3.1.6 结构（rule / fix / violation 三字段 YAML 块）
- [ ] 预期新增条目（基于 project_memory Lessons Learned 已知坑）：
  - **Knex migration guard clause 禁令**：migration 禁止 `if (hasTable) return`，必须用 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 等幂等操作
  - **SteamCMD install_command 顺序约束**：`+force_install_dir` 必须在 `+login` 之前
  - **installCommandForPath 必须含 mkdir -p**：预创建实例根目录
  - **version/instance 删除必须先清磁盘**：DELETE 操作先清文件再删数据库记录
  - **chatLogService.cleanupOldLogs 必须注册定时任务**：禁止死代码调度器
  - **E2E token 文件禁止放 test-results**：Playwright 会清理该目录导致登录失败
  - **IdentitySelector 禁止连续 GPU 渲染**：禁用 Canvas rAF 循环 / 大 blur / 无限动画，用静态 CSS 替代
  - **commandRunner 必须 child.on('error') 即时注册**：防止 ENOENT 崩溃 daemon
  - **updateService instance_root 必须绝对路径**：用 path.resolve() 避免双嵌套目录

### 九、建立回归测试目录 tests/defect-regression/

- [ ] 创建 `tests/defect-regression/` 目录
- [ ] 为每条 P0/P1 的 `code` / `fullstack` 类隐患编写回归测试，文件名格式 `DEF-xxx.test.ts`
- [ ] 测试内容：复现隐患场景，断言修复行为正确（如 migration 不含 guard clause、删除操作先清磁盘等）
- [ ] 在 check-all.ts 的后端/前端 verify 中引入 defect-regression 测试目录

### 十、建立负面清单 prompts/negative-constraints.md

- [ ] 创建 `prompts/negative-constraints.md`，从 defect-log 提取禁止行为，按类别组织：
  - **通用**：禁止硬编码密钥、禁止提交真实 .env、禁止引入未批准依赖、禁止跳过测试、禁止把失败解释为可忽略、禁止改测试迎合错误实现
  - **前端**：禁止忽略 loading/empty/error 状态、禁止硬编码文案、禁止未处理 dangerouslySetInnerHTML、禁止列表缺 key、禁止直接操作 DOM、禁止 IdentitySelector 连续 GPU 渲染、禁止 100vh 强制无 overflow-y
  - **后端**：禁止忽略事务边界、禁止不校验输入、禁止返回敏感字段、禁止无鉴权访问私有数据、禁止 migration guard clause、禁止 child.on('error') 延迟注册
  - **部署**：禁止 npm run dev 当生产入口、禁止 SSH 前台启动生产进程、禁止 dist 部署到错误路径、禁止 8080 对公网开放、禁止 Panel 绑定 0.0.0.0、禁止构建产物含 localhost:3000
- [ ] 在施工卡（AI 生成阶段的上下文包）中，从该清单按需选取 5~8 条贴入 prompt

### 十一、历史隐患全量灌入

- [ ] 从 `project_memory.md` 的 Lessons Learned 提取全部条目，逐条转为 defect-log.md 结构化条目
- [ ] 从 `docs/archive/deployment-experience.md` 提取部署经验（注意版本差异，标注首次发生版本）
- [ ] 从 `docs/archive/daemon-fetch-failed-rootcause-and-fix.md` 提取根因分析
- [ ] 从 `docs/bugfix/bug1.md`、`bug2.md` 提取 bug 记录
- [ ] 从 `docs/Vibe_对话内容.txt` 的负面清单 15 条提取通用/前端/后端禁止项
- [ ] 每条隐患标注转化产物：
  - deploy 类 → `deploy-preflight.sh:#CHECK_NAME`
  - code 类 → `rules-0§3.1.x` + `tests/defect-regression/DEF-xxx.test.ts`
  - fullstack 类 → `rules-0§3.1.x` + `negative-constraints.md#x`
  - config 类 → `deploy-preflight.sh:#CHECK_NAME`
  - security 类 → `negative-constraints.md#x` + `rules-0§3.1.x`

### 十二、闭环验证

- [ ] 执行 `npm run defect:sync`，确认 defect-checklist.md 生成且无未转化的 P0/P1
- [ ] 执行 `npm run check`，确认新增的 defect 完整性校验 + localhost 合规 + 部署预检（本地子集）全绿
- [ ] 在开发目录执行 `bash scripts/deploy-preflight.sh --deploy-dir .`，确认本地可跑的检查项全绿
- [ ] 在服务器执行 `sudo bash deploy.sh update`，确认 preflight 阶段拦截问题、全绿后继续部署
- [ ] 验证检索：执行 `npm run defect:query -- --task "部署前端"`，确认返回相关 deploy 类隐患且不全量加载
- [ ] 验证录入：执行 `npm run defect:record -- --error "测试错误" --solution "测试方案" --category code`，确认新条目写入并触发 sync
- [ ] 验证拦截：人为制造一个已知隐患（如在 dist 中注入 localhost:3000），确认 preflight 拦截
- [ ] 验证阻断：新增一条 P0 隐患但不标注转化产物，确认 `npm run defect:sync` 报错阻断

### 十三、闭环维护规则（查→做→错→修→记）

**查（任务前查询）**：
- [ ] AI 执行任何任务前，必须先调用 `npm run defect:query -- --task "任务描述"` 检索相关隐患
- [ ] 遇到报错时，调用 `npm run defect:query -- --error "错误信息"` 查询是否已有同类隐患的诊断记录
- [ ] 查询结果作为施工卡的上下文输入，不全量读取 defect-log.md

**做（按约束执行）**：
- [ ] 执行中遵守查询返回的预防措施和对应转化产物（lint规则/测试/预检项/负面清单）
- [ ] P0/P1 隐患未转化的，`npm run check` 阻断，不允许合并

**错（遇到错误）**：
- [ ] 操作中遇到错误时，先查询隐患库是否已有诊断
- [ ] 若已有诊断，按预防措施执行修复
- [ ] 若无诊断，进入"修→记"流程

**修（实施修复）**：
- [ ] 在原文件基础上极限修正（对齐 rules-0 §一-3 极力挽救原则），不擅自重写新文件
- [ ] 修复后验证问题已解决（运行测试/预检确认）

**记（自动录入）**：
- [ ] 修复成功后，立即调用 `npm run defect:record -- --error "错误详情" --solution "解决过程" --category "类别" --root-cause "根因" --level "等级"` 自动录入
- [ ] 录入后 defect-record 自动触发 defect-sync，新条目纳入完整性校验
- [ ] P0/P1 新隐患需在下次门禁前完成转化（编写预检项/测试/lint规则），否则 `npm run check` 阻断
- [ ] 部署前 deploy-preflight.sh 必须全绿（或 `--force` 显式跳过并记录警告）
- [ ] 定期（每次版本发布前）运行 s0602 技术债扫描 Skill，核对 defect-log 中 P2 隐患是否需升级为 P1 并转化
