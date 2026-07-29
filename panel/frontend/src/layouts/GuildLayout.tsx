import { Outlet } from 'react-router-dom';
import Layout from '../components/Layout';

/**
 * v4.12.0 /guild 基座 = Player Portal（玩家门户操作层）
 *
 * 职责：服主店铺浏览（自定义 Banner/商品列表，按实例/服主维度）、商品消费（shop/卡密兑换/直充）、
 *       我的资产（me）、账号绑定（Steam ID 等游戏身份绑定卡片）、
 *       玩家社交（friends / profile / verify / alerts）、服务器发现（discover）。
 * 角色门控：user 及以上（所有已登录用户，信息架构按玩家视角组织）。
 * 迁入：shop / me / versions / discover / players/:userId。
 * UI 风格：移动端优先 C 端电商体验，服主店铺化呈现，屏蔽所有服务器运维信息。
 *
 * 复用共享 Layout chrome，承载迁入页。
 */
export default function GuildLayout() {
  return (
    <Layout variant="player">
      <Outlet />
    </Layout>
  );
}
