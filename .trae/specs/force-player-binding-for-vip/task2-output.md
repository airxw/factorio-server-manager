# Task 2 输出落点 — 迁移脚本 + 测试（软删除仅账户绑定记录）

> 来源 spec：[spec.md](./spec.md) 决策 2
> 来源 tasks：[tasks.md](./tasks.md) Task 2
> 阶段：S4 并行开发
> subagent_type：general_purpose_task（subagent 上下文，独立审查由主线程在合流前拉起）

## 工程过程

1. 读取 spec.md（决策 2）/ tasks.md（Task 2）/ rules-0 §三 代码级规范
2. 调研现有迁移脚本风格：baseline_v4_post_demo（DDL + hasTable 容错）、20260727100000（bindings 物理删除 + hasTable 跳过）、20260727200000（SELECT + 循环 UPDATE 幂等模式 + 配套测试）、20260822000000（hasTable 跳过 + 日志风格）
3. 调研 bindings 表结构（baseline_v4_post_demo L769-L790）：含 `metadata` 字段（TEXT NOT NULL DEFAULT '{}'），可用 JS 合并 JSON
4. 调研测试惯例：`panel/backend/src/db/__tests__/{migration_name}.test.ts`，内存 SQLite (`knex({client:'sqlite3',connection:{filename:':memory:'}})`)，import up/down from `../migrations/{name}.js`
5. 编写迁移脚本（up + down + 幂等 + 容错）
6. 编写测试（11 个场景，覆盖 3 类核心数据 + 幂等 + down + 跨实例 + 容错）
7. tsc 首轮报 3 个错误：
   - 迁移脚本 `knex<CandidateRow>('bindings').where({...})` 泛型使 where 对象形式的键必须属于 `CandidateRow`，但 `binding_type/scope_type/verify_status` 不在 select 子集中 → 移除泛型，改用 `as CandidateRow[]` 断言（对齐项目现有迁移不用泛型的风格）
   - 测试 `InsertBindingOpts` 缺 `verify_code` 字段 → 补字段
8. tsc 第二轮通过（exit 0）
9. vitest 11/11 PASS（exit 0）

## 交接状态

Task 2 **已完成**。闭合判据全部满足：
- [x] 迁移脚本 up/down 均可执行
- [x] 单测覆盖 3 种数据场景（仅账户绑定 / 账户+玩家绑定 / 已 revoked）
- [x] 幂等性测试 PASS（运行两次 up，第二次不改变已 revoked 记录）
- [x] `tsc --noEmit` 通过

## 最终结果

### 产出物清单

| 文件 | 路径 | 说明 |
|------|------|------|
| 迁移脚本 | `/home/airxw/gsp/panel/backend/src/db/migrations/20260801000000_revoke_account_only_bindings.ts` | up/down + 幂等 + 容错 |
| 迁移测试 | `/home/airxw/gsp/panel/backend/src/db/__tests__/20260801000000_revoke_account_only_bindings.test.ts` | 11 个测试场景 |

### 迁移脚本设计要点

- **up**：用 `whereNotExists` 子查询一次性选出"仅账户级绑定、无对应 verified player 绑定"的 verified 记录（与 spec SQL 语义等价），循环 UPDATE：`verify_status='revoked'` + `metadata.{unbound_at, source='migration_revoke_account_only'}` + `updated_at`
- **down**：仅恢复 `metadata.source='migration_revoke_account_only'` 标记的 revoked 记录（不误改其他来源的 revoked，如手动解绑），恢复 `verify_status='verified'` + `vip_level=1`，清除迁移标记字段
- **幂等性**：up 仅选 verified 记录，已 revoked 不重复处理；down 仅处理本迁移标记的记录
- **容错**：bindings 表不存在时跳过（对齐 20260727100000 / 20260822000000 的 hasTable 模式，干净安装场景）；坏 JSON metadata 回退为空对象后追加迁移标记
- **metadata 合并**：在 JS 中 parse → 追加字段 → stringify，规避跨数据库 json 函数差异（SQLite json_patch / PG jsonb_merge）

### 验证证据

```
# tsc --noEmit
$ npx tsc --noEmit
---EXIT:0---   （无错误输出）

# vitest
$ npx vitest run src/db/__tests__/20260801000000_revoke_account_only_bindings.test.ts
 ✓ src/db/__tests__/20260801000000_revoke_account_only_bindings.test.ts (11 tests) 180ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration  882ms
```

### 11 个测试场景

| # | 场景 | 验证点 |
|---|------|--------|
| 1 | 仅账户绑定（无 player） | → revoked + metadata.unbound_at/source + 旧字段保留 |
| 2 | 账户+玩家绑定（有 verified player） | 账户绑定不变（仍 verified） |
| 3 | 已 revoked 记录 | 不重复处理，metadata 不被覆盖 |
| 4 | 幂等：连续两次 up() | 第二次不改变已 revoked 记录（metadata/updated_at 不变） |
| 5 | down() 恢复 | verified + vip_level=1 + 清除迁移标记 + 旧字段保留 |
| 6 | down() 不误改其他来源 revoked | 仅恢复本迁移标记的记录 |
| 7 | 跨实例（同用户 A 仅账户 / B 有 player） | 仅 A 被 revoke，B 保留 |
| 8 | bindings 表不存在 up() | 跳过不抛错（全新部署） |
| 9 | bindings 表不存在 down() | 跳过不抛错（全新部署） |
| 10 | 坏 JSON metadata 容错 | 回退空对象后追加迁移标记 |
| 11 | pending 状态账户绑定 | 不受影响（仅处理 verified） |

### 未触碰文件

- 未修改任何其他文件（仅新增 2 个文件）
- 未修改 `public/schema/bindings-schema.json`（契约描述更新由 Task 7 走 s0601 流程）
- 未修改 `instanceBindingService.ts`（由 Task 1 / Task 3 负责）

## 独立审查提醒

> 当前 subagent 上下文无法拉起独立审查。请主线程在合流前对本 subagent 产出执行独立审查或人工替代审查，重点核查：
> 1. `whereNotExists` + `whereRaw('p.scope_ref = bindings.scope_ref')` 的 SQL NULL=NULL 不匹配语义是否与 spec 意图一致（spec SQL 同样用 `=`，故等价；但若未来 scope_ref 可能为 NULL 需重新评估）
> 2. down 恢复 `vip_level=1` 是否符合"人工确认后执行"的语义（当前实现幂等，可重复执行）
> 3. 迁移脚本时间戳 `20260801000000` 早于 baseline `20260808000000`，在干净安装时依赖 hasTable 守卫跳过——与 20260727100000 同模式，已验证 PASS
