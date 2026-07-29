# 标准化部署说明与操作规则

本规范文档基于 GameServer Panel 的 gsp 项目规范与 Panel-Daemon 双层架构编写，旨在规范每次代码更新与生产部署的执行流程，规避部署失败、数据丢失及服务中断的风险。

## 1. 部署前的核查清单

在任何生产部署或代码更新执行之前，必须逐项确认以下状态：

- [ ] **分支与代码状态**：确保待部署代码已合并至 `master` 分支，本地工作区无未跟踪或未提交的修改（`git status` 为 clear 状态）。
- [ ] **文档闭环校验**：确认 `.trae/documents/`、`current-note.md` 和 `README.md` 等相关锚点文档已同步更新，体现本次修改的意图。
- [ ] **磁盘空间核查**：运行 `df -h` 确认部署目录（如 `/opt` 或当前工作区上层目录）可用空间不低于 1GB。
- [ ] **端口占用检查**：确认 Daemon (8080) 与 Panel Backend (3002) 端口正常或预期可用，未被无关服务占用。

## 2. 备份触发条件与执行规则

**核心原则：绝不将运行时数据与项目代码混合备份。**

### 2.1 触发条件
- **大版本更新**：包含新功能（MINOR）或不兼容修改（MAJOR）。
- **架构或依赖调整**：如新增 `package.json` 依赖、调整 `knex` 数据表字段结构。
- **涉及核心模块修改**：前端核心路由、后端 `core/` 及 `db/` 模块的改动。

### 2.2 备份内容规范
执行全量备份时，必须**排除**以下目录，以避免体积爆炸：
- `node_modules/` (可重装)
- `dist/` (可重建)
- `instances/` (用户数据，必须依赖单独的数据冷备)
- `Steam/`, `downloads/`, `_versions/`, `.cache/` (缓存)

### 2.3 备份执行命令参考
```bash
# 生成时间戳归档（推荐在项目上层目录执行）
tar -czvf ../gameserver-panel-backup-$(date +%Y%m%d%H%M%S).tar.gz \
  --exclude=node_modules --exclude=dist --exclude=.git \
  --exclude=instances --exclude=Steam --exclude=downloads .
```

## 3. 生产发布流程

生产环境部署需严格按照以下顺序执行。**绝对禁止在服务运行期间覆盖代码。**

1. **依赖更新**：
   ```bash
   cd panel/backend && npm install
   cd ../frontend && npm install
   cd ../../daemon && npm install
   ```

2. **数据库前置迁移**：
   必须在停止旧服务或更新旧代码前，运行兼容的数据迁移脚本。
   ```bash
   cd panel/backend && npm run migrate
   ```

3. **静态产物构建**：
   ```bash
   cd panel/frontend && npm run build
   cd ../backend && npm run build
   cd ../../daemon && npm run build
   ```

4. **停止现有服务**：
   ```bash
   sudo systemctl stop gameserver-panel || true
   sudo systemctl stop gameserver-daemon || true
   ```

5. **执行同步与启动**（若使用官方 `deploy.sh`）：
   ```bash
   sudo bash deploy.sh update
   ```
   *注意：使用脚本时会自动包含上述构建、数据库迁移与备份操作。*

## 4. 预发布验证要点与部署后校验

部署完成后，必须在 30 秒内完成基础健康状态检查，确认服务已成功接管。

- **守护进程检查**：
  ```bash
  curl -s http://localhost:8080/health
  # 预期返回 {"status":"ok", "version": "..."}
  ```
- **Panel 业务检测**：
  ```bash
  curl -s http://localhost:3002/api/health
  # 预期返回 {"status":"ok"}
  ```
- **核心功能回归**：
  - 登录前端页面，确认控制台无跨域或连接被拒报错。
  - 检查 WebSocket 是否能够成功建立，确认 Daemon 连接就绪。

## 5. 异常回滚机制

如果健康检查超时，或部署后出现严重业务报错（如 500 Internal Server Error），应立即触发回滚：

1. **自动回滚（脚本环境）**：
   若使用 `deploy.sh` 脚本更新失败，内部陷阱（trap）会自动恢复上一版 `pre-update-*` 目录。
   ```bash
   sudo bash deploy.sh update --rollback
   ```
2. **手动回滚**：
   - 停止服务：`pkill -f node` 或 `systemctl stop gameserver-*`
   - 恢复代码：解压最近一次的 `.tar.gz` 备份覆盖当前目录。
   - 回退数据库迁移：`cd panel/backend && npm run migrate:rollback`（视实际失败情况而定）。
   - 重新启动旧版服务。

## 6. 修改规模对应的部署策略

- **Hotfix (微小修复)**：可仅对相关子目录（如仅前端）执行 `npm run build`，重启单侧服务（如 `systemctl restart gameserver-panel`），无需中断 Daemon 实例运行。
- **Minor Update (普通更新)**：要求执行全量备份与数据库结构迁移，按标准流程整体重启双端服务。
- **Major Update (重大重构)**：在执行部署前必须输出规划文档 (`docs/plans/`)，提前准备预发布分支，在非营业时段内执行冷停机更新。
