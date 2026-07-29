# 方案：实例侧「游戏更新」Tab 改造为版本选择器（一次性落地）

> 状态：执行中
> 版本：v3.5.0

## 目标

「下载」归版本管理，「应用」归实例。两侧职责彻底分离。

## 改动清单

### 1. 公共契约 `public/schema/panel-api-types.ts`
- 新增 `ApplyUpdateRequest` union 类型（`version_id` | `download_path`，向兼容）
- `ApplyUpdateResponse.pack_id` → `server_id`
- `UpdatePhase.downloading` 保留值但前端不再使用

### 2. 接口存根 `public/interface_stub/panel-rest.ts`
- `applyUpdate(serverId, req: ApplyUpdateRequest)` → `ApplyUpdateResponse`

### 3. 后端 `panel/backend/src/services/updateService.ts`
- 新增 `applyVersionFromPool(serverId, versionId)`：校验 pack_id/node_id → 执行 install_command → 更新 servers.current_version/version_id
- 新增私有 `installCommandForPath()` 复用 install_command 渲染+执行逻辑
- 保留旧 `applyUpdate(downloadPath)` 作为 `installCommandForPath` 的别名
- `POST /update/download` 相关内部方法不动（前端移除调用后自然废弃）

### 4. 后端 `panel/backend/src/api/routes/updates.ts`
- `POST /:serverId/update/apply` body 改为 union，按字段二选一派发
- `POST /:serverId/update/download` 改为返回 410 Gone

### 5. 前端 `panel/frontend/src/pages/instance-detail/UpdateCheck.tsx` 整页重写
- 页面挂载并行 `checkUpdate` + `api.listVersions(packId)`
- 状态卡保留（当前版本/最新版本/更新可用）
- 新增已下载版本表格：版本号 / 节点 / 下载者 / 时间 / [应用/回滚]按钮
- 按钮语义：高于当前→"应用此版本"(蓝) / 低于当前→"回滚到此版本"(黄) / 等于→禁用"当前"
- 池中无版本→空状态 + 跳转 `/versions` 链接
- 移除：一键下载按钮、手动应用折叠区、downloadPath 输入框
- running 状态下所有按钮禁用

### 6. 前端 API 层 `panel/frontend/src/api/{client.ts, modules/servers.ts}`
- `applyUpdate(serverId, body: { version_id: string })` — 参数改对象
- 移除 `downloadUpdate(serverId)` 方法

### 7. 版本号更新
- version.json, package.json × 4 → 3.4.4 → 3.5.0
- version.md 新增 v3.5.0 条目

### 8. `panel/frontend/src/styles.css`
- 新增 `.version-pick-row.is-current` / `.version-pick-empty` 样式

## 部署
- 前端：`npm run build` 覆盖 dist，硬刷新
- 后端：重启
- 数据库：无迁移

## 验证
1. `tsc --noEmit` 前后端通过
2. curl: `POST /update/apply -d '{"version_id":"<v>"}'` → 200
3. curl: `POST /update/download` → 410
4. 浏览器：实例 Tab 显示版本列表，应用/回滚可用
