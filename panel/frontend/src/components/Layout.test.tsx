// ============================================================================
// Layout 组件单测 — v4.28.0 全员服主菜单切换项显隐
// 覆盖：
//   1. /guild 头像下拉：玩家显「切换为服主」、服主显「切换为玩家」、点击触发免密切换
//   2. 3 角色账号显「切换角色…」弹窗入口
//   3. 单角色账号无任何切换项
//   4. /store 侧边栏用户菜单同样提供切换项
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserInfo } from '@public/schema/panel-api-types';
import { render, screen, userEvent, waitFor } from '../test/utils';
import Layout from './Layout';

const switchActiveRoleMock = vi.fn<(role: string) => Promise<void>>();
const logoutMock = vi.fn();
// vitest.config restoreMocks:true 会在每个用例前抹掉 vi.fn() 实现，
// 工厂内定义的实现不可靠——hoist 后在 beforeEach 中重设
const { getVersionMock } = vi.hoisted(() => ({ getVersionMock: vi.fn() }));

let mockUser: UserInfo | null;

vi.mock('../api/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: logoutMock,
    api: {},
    sessionKey: 0,
    switchActiveRole: switchActiveRoleMock,
  }),
}));

vi.mock('../api/client', () => ({
  getVersion: getVersionMock,
}));

// chrome 组件与 hooks 打桩——本测试只关注用户菜单切换项
vi.mock('./CommandPalette', () => ({ default: () => null }));
vi.mock('./ShortcutsHelp', () => ({ default: () => null }));
vi.mock('./HelpModal', () => ({ default: () => null }));
vi.mock('./VersionInfoModal', () => ({ default: () => null }));
vi.mock('./NodeStatusWidget', () => ({ default: () => null }));
vi.mock('./RoleSwitcherModal', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="role-switcher-modal" /> : null,
}));
vi.mock('./ui', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('../stores/notificationStore', () => ({
  notificationStore: {
    onUnreadCountChange: () => () => {},
    onConnectionChange: () => () => {},
  },
}));
vi.mock('../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }));
vi.mock('../hooks/useRecentPages', () => ({ useRecentPages: () => {} }));

function makeUser(overrides: Partial<UserInfo> = {}): UserInfo {
  return {
    id: 'u1',
    email: 'air@example.com',
    username: 'air',
    role: 'user',
    roles: ['user', 'instance_admin'],
    active_role: 'user',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as UserInfo;
}

function renderLayout(variant: 'player' | 'store', entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Layout variant={variant} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getVersionMock.mockResolvedValue({ version: '4.28.0' });
  mockUser = makeUser();
});

describe('Layout — /guild 头像下拉切换项', () => {
  it('玩家身份：显示「切换为服主」，点击触发免密切换', async () => {
    switchActiveRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLayout('player', '/guild');

    await user.click(screen.getByRole('button', { name: '用户菜单' }));
    const switchItem = screen.getByRole('button', { name: /切换为服主/ });
    expect(switchItem).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /切换角色…/ })).not.toBeInTheDocument();

    await user.click(switchItem);
    await waitFor(() => {
      expect(switchActiveRoleMock).toHaveBeenCalledWith('instance_admin');
    });
  });

  it('服主身份：显示「切换为玩家」', async () => {
    mockUser = makeUser({ role: 'instance_admin', active_role: 'instance_admin' });
    const user = userEvent.setup();
    renderLayout('player', '/guild');

    await user.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(screen.getByRole('button', { name: /切换为玩家/ })).toBeInTheDocument();
  });

  it('3 角色管理员账号：显示「切换角色…」，点击打开弹窗', async () => {
    mockUser = makeUser({
      role: 'server_admin',
      active_role: 'server_admin',
      roles: ['server_admin', 'instance_admin', 'user'],
    });
    const user = userEvent.setup();
    renderLayout('player', '/guild');

    await user.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(screen.queryByRole('button', { name: /切换为服主/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /切换角色…/ }));
    expect(screen.getByTestId('role-switcher-modal')).toBeInTheDocument();
  });

  it('单角色账号：不显示任何切换项', async () => {
    mockUser = makeUser({ roles: ['user'] });
    const user = userEvent.setup();
    renderLayout('player', '/guild');

    await user.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(screen.queryByRole('button', { name: /切换为/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /切换角色…/ })).not.toBeInTheDocument();
    // 既有菜单项不受影响
    expect(screen.getByRole('button', { name: /个人设置/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /退出登录/ })).toBeInTheDocument();
  });
});

describe('Layout — /store 侧边栏用户菜单切换项', () => {
  // 侧边栏下拉项带 role="menuitem"（覆盖隐式 button 角色），查询须用 menuitem
  it('服主身份：侧边栏菜单显示「切换为玩家」，点击触发免密切换', async () => {
    mockUser = makeUser({ role: 'instance_admin', active_role: 'instance_admin' });
    switchActiveRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLayout('store', '/store');

    await user.click(screen.getByRole('button', { name: '用户菜单' }));
    const switchItem = screen.getByRole('menuitem', { name: /切换为玩家/ });
    expect(switchItem).toBeInTheDocument();

    await user.click(switchItem);
    await waitFor(() => {
      expect(switchActiveRoleMock).toHaveBeenCalledWith('user');
    });
  });

  it('玩家身份：侧边栏菜单显示「切换为服主」', async () => {
    const user = userEvent.setup();
    renderLayout('store', '/store');

    await user.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(screen.getByRole('menuitem', { name: /切换为服主/ })).toBeInTheDocument();
  });
});

describe('Layout — /store 激活态判定', () => {
  it('实例详情页高亮“我的实例”而不是“工作台首页”', () => {
    renderLayout('store', '/store/servers/server-1');
    const sidebar = screen.getByRole('complementary', { name: '主导航' });

    expect(within(sidebar).getByRole('button', { name: '我的实例' })).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar).getByRole('button', { name: '工作台首页' })).not.toHaveAttribute('aria-current');
  });

  it('创建实例页归属“我的实例”分组', () => {
    renderLayout('store', '/store/servers/new');
    const sidebar = screen.getByRole('complementary', { name: '主导航' });

    expect(within(sidebar).getByRole('button', { name: '我的实例' })).toHaveAttribute('aria-current', 'page');
  });
});
