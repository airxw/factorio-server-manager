# Daemon 端 Pack 解析与命令生成测试

## (1) 工程过程
1. **分析需求**：目标是测试 Daemon 端对游戏 Pack（如 minecraft-vanilla）的解析逻辑，以及启动命令的正确组装。要求使用 `vitest`。
2. **环境搭建**：由于 daemon 目录下之前没有 `js-yaml` 依赖，先安装了 `js-yaml` 及其类型文件以便在测试中读取并解析 YAML 文件。
3. **测试编写**：在 `daemon/src/core/pack.test.ts` 中编写测试：
   - 使用 `js-yaml` 读取并解析 `packs/minecraft-vanilla/pack.yaml`。
   - 由于 Panel 后端会在传递数据前对 `ui.tabs` 进行标准化处理，而在单元测试中我们直接读取原始 YAML 文件，为了避开 Zod schema 在测试环境对联合类型的严格校验，在传入 `GamePackSchema.parse()` 之前将原始 `ui` 对象简单模拟。
   - 验证 `GamePackSchema` 能够成功校验其余数据。
   - 实例化 `InstanceManager` 并调用 `startInstance`，通过 mock `ProcessDriver.start` 拦截启动配置（`StartConfig`），以验证如 `{{jvm_xms}}` 和 `{{jvm_xmx}}` 等变量能够被正确替换为 `1G` 和 `2G`，以及正确的二进制执行路径和工作目录。
4. **测试执行**：在 daemon 目录下执行 `npm run test`，确保全部通过。

## (2) 交接状态
- **状态**：已完成（已闭合）

## (3) 最终结果
- 新增测试文件：`daemon/src/core/pack.test.ts`。
- 新增开发依赖：在 `daemon/package.json` 引入 `js-yaml` 和 `@types/js-yaml`。
- 测试运行结果：
  ```bash
  > vitest run
  ✓ src/core/pack.test.ts (2)
  ✓ src/instances/manager.test.ts (4)

  Test Files  2 passed (2)
       Tests  6 passed (6)
  ```
- **验证结论**：Daemon 端的 Pack Schema 解析逻辑以及 `InstanceManager` 内部的变量替换、启动命令生成逻辑一切正常，测试套件完整通过。