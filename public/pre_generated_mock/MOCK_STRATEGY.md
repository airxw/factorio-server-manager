# 商业化模块 Mock 策略与替换边界

## 一、 Mock 策略说明
为了支撑 v4.11.0 商业化模块的前后端并行开发，我们基于 `asset_interfaces.d.ts` 生成了以下稳定依赖替身：
1. `MockAssetService`: 模拟系统管理员的“全局资产库”以及实例管理员的“重写与 UGC 资产”管理。自带内存状态，支持增删改查以供前端调用调试。
2. `MockExecutionEngine`: 模拟 Daemon 侧的 RCON 执行沙箱，支持指令正则校验和变量替换日志输出。

## 二、 `pre_generated_mock` 与 `global_mock` 分工
- **`public/pre_generated_mock/` (当前)**：**默认稳定依赖**。所有下游并行开发分支（如前端面板开发、后端 Controller 开发）应默认导入此处的类。它严格遵守了 `error_codes.json` 与 `.d.ts` 契约。
- **`public/global_mock/`**：**特殊场景覆盖区**。仅当开发者需要测试极端场景（如：模拟网络超时、模拟数据库锁死）时，才允许在 `global_mock` 下创建继承类并覆盖对应方法。禁止直接修改 `pre_generated_mock`。

## 三、 替换边界与切换指引
当后端真实实现（如 `DatabaseAssetService`, `DaemonExecutionEngine`）就位后：
1. 在依赖注入层（IoC）或模块入口处，将导入路径从 `public/pre_generated_mock/mock_asset_service` 切换为真实的实现路径。
2. 调用方代码（如 React 组件、Express Controllers）**无需进行任何改动**，因为 Mock 和真实实现都严格遵循了 `IAssetService` 接口契约。

## 四、 契约一致性声明
- 方法签名：与 `asset_interfaces.d.ts` 100% 匹配。
- 异常抛出：已内建 `ERR_OVERRIDE_FORBIDDEN`, `ERR_RCON_INJECTION`, `ERR_UGC_LIMIT_EXCEEDED` 等异常的触发逻辑。
- 业务逻辑：已实现“继承与覆盖 (Override)”的核心合并逻辑。