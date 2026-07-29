import { Outlet } from 'react-router-dom';
import Layout from '../components/Layout';

/**
 * v4.12.0 /admin 基座 = Platform Dashboard（系统管理员操作层）
 *
 * 职责：大盘数据监控、资源分配、全局模板管理、配额、节点、系统配置、审计日志、
 *       Webhooks、SSL/隧道/API Keys、平台总览、用户管理（系统级）。
 * 角色门控：server_admin / system_admin / admin。
 * 迁出：服主相关功能（commercial / instance-vip / operations）迁入 /store（GM Workbench）。
 *
 * 复用共享 Layout chrome（侧栏/面包屑/通知铃铛/命令面板/移动端导航），
 * 使迁入的系统管理页（/admin/users 等）无需改写即获得完整外壳能力。
 * 基座本身仅作为路由分组锚点 + 后续 base 专属上下文的挂载位。
 */
export default function AdminLayout() {
  return (
    <Layout variant="admin">
      <Outlet />
    </Layout>
  );
}
