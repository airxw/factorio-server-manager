// ============================================================================
// ServerDetailStore — v4.13.0 服主视图（GM Workbench 子页）
// 路由：/store/servers/:id
// 门控：instance_admin+（已在 App.tsx 路由层上提）
// 承载：商业化控制台（business）、VIP 管理、运营数据、店铺外观配置（Banner/描述/主题色）
// 信息架构：店铺后台导向，强调商品管理、玩家 CRM、收入数据
//
// 实现：复用现有 ServerDetail 组件（内部已按角色渲染 tab），
//       服主角色下自然展示 business/shop-admin tab，屏蔽系统监控 tab。
//       店铺外观配置入口通过子页签集成（/store/servers/:id/shop-config）。
//       实例经济配置（用户中心经济系统：VIP定价/点券/积分/消费上限）以折叠卡片
//       挂载于顶部（instance_admin+ 可直接编辑，无需进入 platform-admin 业务台）。
// v4.x：迁入 Workbench DS 壳层，统一 /store 视觉语言。
// ============================================================================

import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Skeleton } from '../../components/ui';
import { WorkbenchShell } from './components/WorkbenchUI';
import InstanceEconomyConfig from './components/InstanceEconomyConfig';

const ServerDetail = lazy(() => import('../ServerDetail'));

export default function ServerDetailStore() {
  const { id } = useParams<{ id: string }>();

  return (
    <WorkbenchShell>
      {/* 实例经济配置入口（折叠卡片，懒加载定价数据） */}
      {id && <InstanceEconomyConfig serverId={id} />}

      <Suspense fallback={<Skeleton lines={6} lineHeight={16} />}>
        <ServerDetail
          viewMode="store"
          listPath="/store/servers"
          businessPathForServer={(serverId) => `/store/commercial/${serverId}`}
        />
      </Suspense>
    </WorkbenchShell>
  );
}
