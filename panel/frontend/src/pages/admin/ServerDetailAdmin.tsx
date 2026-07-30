// ============================================================================
// ServerDetailAdmin — v4.13.0 系统管理员视图（Platform Dashboard 子页）
// 路由：/admin/servers/:id
// 门控：server_admin+（已在 App.tsx 路由层上提）
// 承载：实例配置、Daemon 状态、部署命令、系统监控、玩家历史、审计日志
// 信息架构：系统监控导向，强调资源占用、日志、配置变更历史
//
// 实现：复用 instance-detail/ServerDetailCore 组件（内部已按角色渲染 tab），
//       系统管理员角色下自然展示所有 admin/ops tab。
// v4.36.0-B6: 改为直接消费 ServerDetailCore（pages/ServerDetail 降为兼容再导出层）。
// ============================================================================

import { lazy, Suspense } from 'react';
import { Skeleton } from '../../components/ui';

const ServerDetailCore = lazy(() => import('../instance-detail/ServerDetailCore'));

export default function ServerDetailAdmin() {
  return (
    <Suspense fallback={<Skeleton lines={6} lineHeight={16} />}>
      <ServerDetailCore listPath="/admin/servers" />
    </Suspense>
  );
}
