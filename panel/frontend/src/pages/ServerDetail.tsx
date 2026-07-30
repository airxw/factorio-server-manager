// ============================================================================
// ServerDetail — 兼容再导出层（v4.36.0 B6 拆分）
// 实现已迁移至 instance-detail/ServerDetailCore；本文件仅保持既有 import 路径
// （pages/ServerDetail）不变，避免破坏路由与测试的消费方。
// 新代码请直接 import instance-detail/ServerDetailCore。
// ============================================================================

export { default } from './instance-detail/ServerDetailCore';
export type { ServerDetailCoreProps as ServerDetailProps } from './instance-detail/ServerDetailCore';
