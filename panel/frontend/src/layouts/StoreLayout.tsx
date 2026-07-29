import { Outlet } from 'react-router-dom';
import Layout from '../components/Layout';

/**
 * v4.12.0 /store 基座 = GM Workbench（服主工作台操作层）
 *
 * 职责：商城管理（商品上架/改价 Override/上下架，接入 AssetService）、
 *       玩家列表（CRM：发放补偿/封禁/调整时长）、数据报表（流水/时长/账单）、
 *       实例运营（instance-vip / operations）、自定义商品与 RCON 指令（UGC，接入 ExecutionEngine 沙箱）。
 * 角色门控：instance_admin / server_admin / system_admin / admin（服主视角，server_admin 可越级）。
 * 迁出：消费侧页面（shop / me / versions）迁入 /guild（Player Portal）。
 * UI 风格：店铺后台风格，弱化终端命令行，强化商城/玩家/报表三块主导航。
 *
 * 注：/store URL 保留以避免破坏向后兼容，导航标题显示"服主工作台"而非"Store"。
 * 复用共享 Layout chrome，承载迁入页。
 */
export default function StoreLayout() {
  return (
    <Layout variant="store">
      <Outlet />
    </Layout>
  );
}
