---
name: "s0703-runtime-wiring-verification"
description: "Verifies runtime wiring: route registration, event bus subscription, WS subscription, upstream caller reference, scheduler registration, child error handler, path absolutization. Invoke after module development before marking task closed."
---

# s0703 运行时接入校验

> 本 Skill 由 v3.5~v4.11 的多次"假闭合"教训沉淀而来——代码存在+单测通过+build 通过，但实际未接入运行时，导致死代码、事件丢失、状态不同步。与 rules-0 §四-13、rules-6 §六-5 联动，把"孤岛代码"判据产品化为可执行检查。

## 一、何时调用

- **强制触发**：任何模块标记 task 已闭合前（与 rules-0 §四-13 联动）
- **强制触发**：新增 service / router / event handler / scheduled task / child process spawn
- **强制触发**：交付前独立审查（与 s0701 部署前置自检联动）
- **建议触发**：重构现有模块的入口接入点

## 二、检查清单（7 项运行时接入判据）

> rules-0 §四-13 要求：任何模块的闭合判据必须包含"运行时接入校验"，四者至少满足其一。本 Skill 把四者扩展为七项，更精细地覆盖常见孤岛模式。

### 判据 1：路由注册（HTTP API 模块）

**经验源**：模块开发完成后 router 文件存在，但未在 `app.ts` / `index.ts` 中 mount，导致 API 不可达。

**检查项**：
- [ ] 新增 router 文件在入口（`panel/backend/src/index.ts` 或 `app.ts`）被 `app.use('/api/xxx', xxxRouter)` mount
- [ ] router 文件导出 `createXxxRouter` 函数（项目约定），入口处正确调用
- [ ] 路由路径不与其他 router 冲突
- [ ] ownership 校验中间件已挂载（如 `requireOwnership(serverId)`）

**执行命令**：
```bash
# 检查 router 是否被 mount
grep -r "xxxRouter" panel/backend/src/index.ts panel/backend/src/app.ts
# 检查 router 文件导出
grep -E "export (function|const) create" panel/backend/src/api/routes/xxx.ts
```

### 判据 2：事件总线订阅（事件驱动模块）

**经验源**：模块定义了事件处理函数，但未 `emitter.on` / `eventBus.subscribe` 注册监听，事件触发后无人响应。

**检查项**：
- [ ] 新增 event handler 在模块初始化时通过 `eventBus.on(event, handler)` 注册
- [ ] 注册代码在模块入口（非仅定义在 utils 中等待调用）
- [ ] 事件名与 emit 端完全一致（大小写敏感）

### 判据 3：WS 订阅（实时状态同步模块）

**经验源**：v3.5.3 Daemon WS 事件订阅缺失——daemon WS 协议要求 panel 显式发送 `{type:'subscribe',instance_id}` 才推送 `state.change` 事件，panel 的 `DaemonEventStream` 从未发送 subscribe，导致实例状态不同步（daemon=running, panel DB=starting）。

**检查项**：
- [ ] 新增实例状态监听通过 `daemonEventStream.subscribe(instanceId)` 显式订阅
- [ ] `onConnect` 回调中全量同步后对所有实例发送 subscribe
- [ ] 实例启动成功后 `onInstanceStart` 回调立即订阅该实例
- [ ] WS 重连后重新订阅所有实例

**正确范式**（参考 v3.5.3 修复）：
```typescript
// panel/backend/src/daemonClient/eventStream.ts
class DaemonEventStream {
  subscribe(instanceId: string) {
    this.ws.send(JSON.stringify({ type: 'subscribe', instance_id: instanceId }));
  }
}

// panel/backend/src/index.ts onConnect 回调
daemonEventStream.onConnect(async () => {
  const instances = await getAllInstances();
  for (const inst of instances) {
    daemonEventStream.subscribe(inst.id);
  }
});

// createServersRouter onInstanceStart 回调
onInstanceStart: (instanceId) => {
  daemonEventStream.subscribe(instanceId);
}
```

### 判据 4：被上游调用方引用（工具/服务模块）

**经验源**：模块开发完成后文件存在，但无任何上游 import，成为孤岛代码。

**检查项**：
- [ ] 新增 service / util 文件被至少一个 router / handler / 上游 service import
- [ ] import 链可达入口（router → service → util，无断链）
- [ ] **不是**仅被自身测试文件 import（测试 import 不算运行时接入）

**执行命令**：
```bash
# 检查新增文件是否被其他文件 import
grep -r "from.*xxxService\|require.*xxxService" --include="*.ts" panel/backend/src/ | grep -v "xxxService.ts" | grep -v ".test.ts"
```

### 判据 5：定时任务注册（清理/调度模块）

**经验源**：v4.11.0 chatLogService.cleanupOldLogs 是死代码——函数存在但从未注册为定时任务，导致 chat_logs 表永久增长。

**检查项**：
- [ ] 新增 cleanup / scheduled 函数在模块初始化时通过 `node-cron` / `setInterval` / 调度器注册
- [ ] 注册代码在模块入口（非仅函数定义）
- [ ] 调度频率合理（cleanup 类建议每日，非每分钟）

**正确范式**：
```typescript
// ❌ 错误：仅定义函数，未注册
export function cleanupOldLogs() { /* ... */ }

// ✅ 正确：定义 + 注册
export function cleanupOldLogs() { /* ... */ }
cron.schedule('0 3 * * *', cleanupOldLogs); // 每日 3 点执行
```

### 判据 6：子进程错误处理器立即注册（spawn 模块）

**经验源**：v3.5.2 commandRunner.ts 中 `child.on('error')` 未在 spawn 后立即注册，ENOENT 错误导致 daemon 进程崩溃（表现为 `fetch failed` 4ms = ECONNREFUSED）。

**检查项**：
- [ ] `child_process.spawn` 后**立即**注册 `child.on('error', handler)`
- [ ] **不是**在 `child.on('exit')` 之后注册（错误事件可能先触发）
- [ ] error handler 含日志记录 + 进程状态更新

**正确范式**：
```typescript
// ❌ 错误：error handler 注册太晚
const child = spawn(cmd, args);
child.stdout.on('data', ...);
child.on('exit', ...);
child.on('error', ...); // ENOENT 可能已触发，未捕获 → daemon 崩溃

// ✅ 正确：error handler 立即注册
const child = spawn(cmd, args);
child.on('error', (err) => {  // 立即注册，第一行
  logger.error('spawn error', err);
  updateInstanceStatus(instanceId, 'error');
});
child.stdout.on('data', ...);
child.on('exit', ...);
```

### 判据 7：路径绝对化（文件系统操作模块）

**经验源**：
- v3.5.x updateService.ts 中 `instance_root` 设为 `./instances/<id>` 造成双重嵌套 `instances/<id>/instances/<id>`
- 游戏版本下载路径存为相对路径，安装时工作目录不匹配导致文件找不到
- SteamCMD 脚本内部 `cd /opt/steamcmd`，使相对路径解析到错误目录

**检查项**：
- [ ] 文件系统操作路径通过 `path.resolve()` 转绝对路径
- [ ] `instance_root` / `instance_root_abs` 使用绝对路径
- [ ] daemon exec `pwd` 解析实例根目录为绝对路径（不依赖 cwd）
- [ ] 不依赖 `process.cwd()` 解析用户数据路径（cwd 可能在测试/生产环境不同）

## 三、执行流程

```python
def run_wiring_verification(module_path):
    criteria = [
        ("判据1 路由注册", check_route_registration),
        ("判据2 事件总线订阅", check_event_bus_subscription),
        ("判据3 WS订阅", check_ws_subscription),
        ("判据4 被上游调用方引用", check_upstream_reference),
        ("判据5 定时任务注册", check_scheduler_registration),
        ("判据6 子进程错误处理立即注册", check_child_error_handler),
        ("判据7 路径绝对化", check_path_absolutization),
    ]
    results = []
    for name, check in criteria:
        applicable, passed, evidence = check(module_path)
        if applicable and not passed:
            results.append((name, False, evidence))
            return results, "BLOCKED: 孤岛代码"
        elif applicable and passed:
            results.append((name, True, evidence))
        # 不适用的判据跳过
    # rules-0 §四-13 要求：四者至少满足其一
    core_criteria = [r for r in results if r[0] in ("判据1", "判据2", "判据3", "判据4")]
    if not core_criteria:
        return results, "BLOCKED: 未满足任一核心运行时接入条件"
    return results, "PASS"
```

## 四、阻断处理

任一适用判据失败：
1. 立即标记 task 为"孤岛代码"，不得标记已闭合
2. 输出失败判据 + 证据 + 修复建议
3. 禁止合流（与 rules-6 §六-5 联动）

**孤岛判定**：仅有"文件存在 + 单测通过 + build 通过"而未满足任一运行时接入条件者，判定为孤岛代码，不得标记已闭合，禁止合流。

## 五、与现有规则的关系

- **直接落地** `rules-0 §四-13`（运行时接入闭合判据）
- **直接落地** `rules-6 §六-5`（运行时接入校验条款）
- 与 `s0701-deployment-preflight-check` 联动——部署前验证服务确实接入运行时
- 与 `s0702-game-pack-adaptation-review` 闸门 7 联动——验证 bootstrap 接入运行时

## 六、降级路径

若本 Skill 检查项无法自动执行（如静态分析脚本缺失）：
1. L1：可执行项自动跑，缺失项输出手动检查清单
2. L2：通过 L2 信号（NotifyUser）告知人类"部分判据需手动执行"，附完整清单
3. L3：记录"运行时接入校验降级"到 `.trae/documents/`，下次校验前重试

不得伪装所有判据已通过。**孤岛代码判定为阻断级，不得降级放行**——这是 rules-0 §四-13 的硬性约束。

## 七、历史教训索引

| 版本 | 教训 | 对应判据 |
|------|------|---------|
| v3.5.2 | commandRunner child.on('error') 未立即注册 → daemon 崩溃 | 判据 6 |
| v3.5.3 | DaemonEventStream 未 subscribe → 实例状态不同步 | 判据 3 |
| v3.5.x | updateService instance_root 双重嵌套 | 判据 7 |
| v4.11.0 | chatLogService.cleanupOldLogs 死代码 | 判据 5 |
| v4.11.0 | 假闭合补强——运行时接入判据加入 rules-0 | 全部 |
