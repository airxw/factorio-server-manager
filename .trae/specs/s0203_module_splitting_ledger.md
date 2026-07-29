# 模块拆分与并行执行编排台账 (S3 阶段)

## 模块拆分与命名方案
遵循 AC 范式 `rules-2`，前端路由与视图将拆分为以下独立模块：
- `模块0_前端路由基建`：承载 `App.tsx` 改造、旧页面清理、`React Router` 设置、权限守卫。
- `模块1_Store视图`：纯粹面向小白玩家的应用商店模式重构 (`/store`)。
- `模块2_Guild视图`：纯粹面向公会服主的 SaaS 沉浸式视图 (`/guild`)。
- `模块3_Admin视图`：纯粹面向硬核运维的云厂商控制台视图 (`/admin`)。

## 跨模块协作与边界约束 (public/ 边界)
1. **API 统一**：所有视图的数据获取，必须严格依赖 `public/interface_stub/unified_api.d.ts` 和 `public/schema/server_instance.schema.json` 定义的契约接口。
2. **禁止跨模块直连**：Store 视图禁止引入 Admin 视图的复杂数据表格组件，Guild 视图禁止引入 Store 视图的发现游戏卡片。
3. **共享 UI**：仅允许从 `src/components/ui/` 引入基础原子组件 (如 Button, Input)。

## 依赖 DAG 与并行分组 (编排台账)

根据依赖关系：所有视图的开发强依赖于前端路由基建和共享 API 的就绪。且受限于 AC 范式（单批最大并行数 2，全局不超过 3），将采取以下串并行混合策略：

| 阶段标签 | `[P]`组 | `subagent_type` | 预期产物 | `actual agent id` | 第二落点 | 失败回退点 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| S4-1 | — | `general_purpose_task` (由主线程直接执行) | 删除旧页面资产；重构 `App.tsx` 实现多路由入口；准备基础 Mock | 主线程 (非subagent) | `.trae/documents/doc_001_routing.md` | S2 契约冻结结束点 | `待启动` |
| S4-2 | [P1] | `parallel-sub-agent` | Store 视图 (`src/pages/store/`) 页面与组件的重构实现 | 待回填 | `.trae/documents/doc_002_store.md` | S4-1 完成点 | `待启动` |
| S4-2 | [P1] | `parallel-sub-agent` | Guild 视图 (`src/pages/guild/`) 页面与组件的重构实现 | 待回填 | `.trae/documents/doc_003_guild.md` | S4-1 完成点 | `待启动` |
| S4-3 | — | `general_purpose_task` (独立串行) | Admin 视图 (`src/pages/admin/`) 高密度监控控制台实现 | 待回填 | `.trae/documents/doc_004_admin.md` | S4-2 完成点 | `待启动` |

## 失败回退策略
- 若 S4-1 基建失败：直接回退到 S2 契约冻结结束点，不启动并行代理。
- 若 S4-2 中的任一子代理失败（如 Store 视图因为 Mock 数据不通卡死）：**仅回退失败的该代理分支**，清理该分支创建的文件，并保持 S4-1 基建不动。
- S4-3 必须等待 S4-2 的 `[P1]` 并行组安全闭合后才能启动。

---

*注：本台账由 `s0203` 节点生成，将在实际 S4 并行开发阶段由主线程负责调度与更新 `actual agent id`。*