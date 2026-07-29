# SQLite → PostgreSQL 迁移指南

> 本文档对应优化升级方案 §五.L3（SQLite → PostgreSQL 迁移预备）。
> 当前阶段为**迁移预备**：后端已支持双数据库切换，迁移脚本尚未做完整 PostgreSQL 适配验证。

## 一、迁移预备概览

### 1.1 已完成的预备工作

| 项目 | 位置 | 说明 |
|------|------|------|
| 双数据库连接 | `panel/backend/src/db/connection.ts` | 检测 `DATABASE_URL` 前缀，`postgres://` / `postgresql://` → pg client，否则 → sqlite3 |
| PostgreSQL knexfile | `panel/backend/src/db/knexfile.pg.ts` | PostgreSQL 专用 Knex CLI 配置，共用同一套 migrations |
| Service 层 SQLite 特有语法替换 | `dbBackupService.ts` / `operationsService.ts` / `platform-stats.ts` 等 | `PRAGMA` / `date()` / 唯一约束错误检测等改为 dialect 感知 |
| CI 兼容性测试 | `.github/workflows/ci.yml` 的 `database-compat` job | PostgreSQL 16 container + SQLite :memory: 双向迁移验证 |

### 1.2 不修改的内容

- **迁移文件**（`panel/backend/src/db/migrations/*.ts`）：迁移文件是历史记录，修改会破坏已部署数据库的迁移状态。迁移文件中的 SQLite 特有语法（如 `datetime('now')`）在正式迁移阶段需通过新增适配迁移处理，不改动历史文件。
- **`public/` 目录**：契约载体，不在本阶段修改。

## 二、环境变量配置

### 2.1 PostgreSQL（目标状态）

```bash
# .env 或环境变量
DATABASE_URL=postgres://用户名:密码@主机:5432/数据库名
# 示例
DATABASE_URL=postgres://panel:strong_password@127.0.0.1:5432/gameserver_panel
```

### 2.2 SQLite（当前默认，保持兼容）

```bash
# 文件路径
DATABASE_URL=./data/panel.db
# 内存数据库（仅测试）
DATABASE_URL=:memory:
```

### 2.3 切换规则

`connection.ts` 中 `isPostgresUrl()` 判定：
- 以 `postgres://` 开头 → PostgreSQL
- 以 `postgresql://` 开头 → PostgreSQL
- 其他（含 `:memory:`、相对路径、绝对路径）→ SQLite

切换数据库**只需修改 `DATABASE_URL` 环境变量**，无需改代码。

## 三、迁移步骤（正式迁移阶段执行）

> 以下步骤在正式从 SQLite 切换到 PostgreSQL 时执行，本预备阶段无需立即执行。

### 3.1 准备 PostgreSQL 实例

```bash
# 1. 安装 PostgreSQL 16+（略）

# 2. 创建数据库与用户
sudo -u postgres psql <<'SQL'
CREATE USER panel WITH PASSWORD 'strong_password';
CREATE DATABASE gameserver_panel OWNER panel;
GRANT ALL PRIVILEGES ON DATABASE gameserver_panel TO panel;
SQL

# 3. 验证连通性
psql -U panel -h 127.0.0.1 -d gameserver_panel -c "SELECT version();"
```

### 3.2 安装 pg 驱动

```bash
cd panel/backend
npm install pg
# 如需类型（开发期）
npm install -D @types/pg
```

> 当前 `package.json` 未将 `pg` 列为正式依赖（迁移预备阶段）。CI 的 `database-compat` job 中通过 `npm install pg` 临时安装。正式迁移时应将其加入 `dependencies`。

### 3.3 数据导出（SQLite）

```bash
# 使用 sqlite3 CLI 导出数据（排除迁移历史表）
sqlite3 ./data/panel.db .dump > /tmp/panel-sqlite-dump.sql

# 或用 node 脚本按表导出为 JSON（更可控，推荐）
# 需自行编写导出脚本，按表 SELECT * → 写 JSON 文件
```

### 3.4 运行迁移（PostgreSQL）

```bash
cd panel/backend
DATABASE_URL=postgres://panel:strong_password@127.0.0.1:5432/gameserver_panel \
  node --import tsx node_modules/.bin/knex migrate:latest --knexfile src/db/knexfile.pg.ts
```

### 3.5 数据导入（PostgreSQL）

```bash
# 按表导入 JSON 数据（需自行编写导入脚本）
# 注意：SQLite 的 0/1 布尔值在 PostgreSQL 中应转为 false/true
# 注意：SQLite 的 datetime text 在 PostgreSQL 中应转为 timestamp
```

### 3.6 切换应用配置

```bash
# 修改 .env
DATABASE_URL=postgres://panel:strong_password@127.0.0.1:5432/gameserver_panel

# 重启后端（先关闭旧实例再启动，避免端口冲突）
# 参考 deploy.md 的部署流程
```

### 3.7 验证

```bash
# 1. 健康检查
curl http://127.0.0.1:3002/api/health

# 2. 登录验证
curl -X POST http://127.0.0.1:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.dev","password":"admin123"}'

# 3. 关键功能抽查：用户列表 / 实例列表 / 商店 / 玩家记录
```

## 四、注意事项

### 4.1 类型差异

| 类型 | SQLite | PostgreSQL | 处理 |
|------|--------|------------|------|
| 布尔 | INTEGER 0/1 | BOOLEAN | 代码中 `number` 类型需评估是否改为 `boolean`；当前 Service 层用 `number` 兼容 |
| 时间 | TEXT (ISO 8601) | TIMESTAMP | Knex 双向兼容，无需改代码 |
| 自增 | INTEGER PRIMARY KEY AUTOINCREMENT | SERIAL / BIGSERIAL | 迁移文件中 Knex `increments()` 自动适配 |
| 返回值 | `insert().returning(*)` 在 SQLite 返回 rowid | PostgreSQL 原生支持 RETURNING | `commandDispatcher.ts` 已用 try-catch 兼容 |

### 4.2 已知的 SQLite 特有语法（审计结果）

以下用法在迁移预备阶段已做 dialect 感知处理，详见审计报告章节。

| 文件 | 用法 | 处理方式 |
|------|------|----------|
| `dbBackupService.ts` | `PRAGMA wal_checkpoint(FULL)` | 条件判断：仅 SQLite 执行（PostgreSQL 用 pg_dump 备份） |
| `operationsService.ts` | `date(created_at)` 按天聚合 | dialect 分支：SQLite 用 `date(col)`，PostgreSQL 用 `DATE(col)::text` |
| `platform-stats.ts` | `date(last_login_at)` 按天聚合 | 同上 |
| `playerService.ts` 等 5 个 Service | `SQLITE_CONSTRAINT` 错误检测 | 补充 PostgreSQL 错误码 `23505` 检测 |

### 4.3 迁移文件中的 SQLite 特有语法（未修改，需正式迁移阶段处理）

| 文件 | 行 | 用法 | 说明 |
|------|----|------|------|
| `20260802000001_create_instance_roles.ts` | 21 | `datetime('now')` 默认值 | PostgreSQL 应用 `now()` 或 `CURRENT_TIMESTAMP` |
| `20260803000002_create_friendships.ts` | 20 | `datetime('now')` 默认值 | 同上 |
| `20260729000001_create_instance_admins.ts` | 17 | `datetime('now')` 默认值 | 同上 |

> **正式迁移阶段建议**：不修改历史迁移文件，而是新增一个"PostgreSQL 适配"迁移，用 `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT now()` 修正默认值。或采用"从空库重建"策略——在 PostgreSQL 上 `migrate:latest` 全新建库后导入数据。

### 4.4 数据备份服务

`dbBackupService.ts` 的文件复制备份逻辑针对 SQLite 设计（复制 `.db` 文件 + WAL checkpoint）。切换到 PostgreSQL 后，备份策略应改为：
- `pg_dump` 逻辑备份
- PostgreSQL 流复制 / 基础备份（物理备份）

`dbBackupService.ts` 中已用 `if (knex.client.dialect === 'sqlite')` 条件保护 PRAGMA 调用，PostgreSQL 下会跳过 SQLite 专属逻辑。

## 五、回滚方案

### 5.1 切换前回滚（PostgreSQL 验证失败）

若 PostgreSQL 验证阶段发现问题，未切换应用配置前回滚：

```bash
# 应用配置未改，DATABASE_URL 仍指向 SQLite
# 直接重启旧实例即可（PostgreSQL 实例可保留或删除）
sudo systemctl restart gameserver-panel
```

### 5.2 切换后回滚（已切到 PostgreSQL，需退回 SQLite）

```bash
# 1. 停止后端
sudo systemctl stop gameserver-panel

# 2. 从最近一次 SQLite 备份恢复（dbBackupService 产生的 .db 文件）
cp /path/to/backup/panel-YYYYMMDD-HHmmss.db ./data/panel.db

# 3. 改回 DATABASE_URL
# .env: DATABASE_URL=./data/panel.db

# 4. 启动后端
sudo systemctl start gameserver-panel

# 5. 验证
curl http://127.0.0.1:3002/api/health
```

> ⚠️ 回滚后，从 SQLite 备份时间点到回滚时刻之间的数据会丢失。正式迁移前应确保 dbBackupService 在切换前刚执行过一次备份。

### 5.3 数据丢失风险点

- PostgreSQL 运行期间产生的数据，回滚到 SQLite 后丢失
- 若需保留，回滚前应从 PostgreSQL 导出数据再导入 SQLite（按表 JSON 互导）

## 六、CI 兼容性测试

`.github/workflows/ci.yml` 的 `database-compat` job 在每次 PR / push 时运行：

1. 启动 PostgreSQL 16 service container
2. 安装 `pg` 驱动
3. 在 PostgreSQL 上运行 `migrate:latest`（用 `knexfile.pg.ts`）
4. 验证 PostgreSQL 中表已创建
5. 在 SQLite `:memory:` 上运行 `migrate:latest`（用 `knexfile.ts`）

任一步骤失败将阻断合并，确保迁移脚本始终双数据库兼容。

## 七、相关文件清单

| 文件 | 角色 |
|------|------|
| `panel/backend/src/db/connection.ts` | 双数据库连接（dialect 自动切换） |
| `panel/backend/src/db/knexfile.ts` | SQLite Knex CLI 配置 |
| `panel/backend/src/db/knexfile.pg.ts` | PostgreSQL Knex CLI 配置 |
| `.github/workflows/ci.yml` | `database-compat` job |
| `panel/backend/src/services/dbBackupService.ts` | PRAGMA 条件保护 |
| `panel/backend/src/services/operationsService.ts` | `date()` dialect 分支 |
| `panel/backend/src/api/routes/platform-stats.ts` | `date()` dialect 分支 |
| `panel/backend/src/services/playerService.ts` | 唯一约束错误检测增强 |
| `panel/backend/src/services/saveService.ts` | 唯一约束错误检测增强 |
| `panel/backend/src/services/modService.ts` | 唯一约束错误检测增强 |
| `panel/backend/src/services/listService.ts` | 唯一约束错误检测增强 |
| `panel/backend/src/services/instanceBindingService.ts` | 唯一约束错误检测增强 |
