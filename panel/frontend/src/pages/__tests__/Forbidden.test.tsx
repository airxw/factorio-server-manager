// ============================================================================
// Forbidden 页面单测 — v4.28.0 全员服主身份切换引导
// 覆盖：
//   1. 目标页允许 instance_admin 且账号角色集含该角色 → 显示「切换为服主身份继续」
//   2. 点击后免密切换并回跳原目标页
//   3. 仅 server_admin 可达页面 / 无导航 state / 已是服主身份 → 不显示切换按钮
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { UserInfo } from '@public/schema/panel-api-types';
import { render, screen, userEvent, waitFor } from '../../test/utils';
import Forbidden from '../Forbidden';

const switchActiveRoleMock = vi.fn<(role: string) => Promise<void>>();
const navigateMock = vi.fn();
const toastErrorMock = vi.fn();

let mockUser: UserInfo | null;

vi.mock('../../api/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    switchActiveRole: switchActiveRoleMock,
  }),
}));

vi.mock('../../components/ui', () => ({
  useToast: () => ({ error: toastErrorMock, success: vi.fn(), info: vi.fn() }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

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

function renderForbidden(state?: { from?: string; allow?: string[] }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/forbidden', state }]}>
      <Forbidden />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = makeUser();
});

describe('Forbidden — 身份切换引导', () => {
  it('目标页允许 instance_admin 且账号含该角色：显示免密切换按钮，点击后回跳原目标页', async () => {
    switchActiveRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderForbidden({ from: '/store/servers', allow: ['instance_admin', 'server_admin', 'admin'] });

    const switchBtn = screen.getByRole('button', { name: /切换为服主身份继续/ });
    expect(switchBtn).toBeInTheDocument();
    expect(screen.getByText(/您的账号已具备服主身份/)).toBeInTheDocument();

    await user.click(switchBtn);

    await waitFor(() => {
      expect(switchActiveRoleMock).toHaveBeenCalledWith('instance_admin');
    });
    expect(navigateMock).toHaveBeenCalledWith('/store/servers', { replace: true });
  });

  it('from 缺失时切换后落 /store 工作台', async () => {
    switchActiveRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderForbidden({ allow: ['instance_admin', 'server_admin', 'admin'] });

    await user.click(screen.getByRole('button', { name: /切换为服主身份继续/ }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/store', { replace: true });
    });
  });

  it('仅 server_admin 可达页面：不显示切换按钮（管理员提权须走密码通道）', () => {
    renderForbidden({ from: '/admin/users', allow: ['server_admin', 'system_admin', 'admin'] });

    expect(screen.queryByRole('button', { name: /切换为服主身份继续/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回首页' })).toBeInTheDocument();
  });

  it('无导航 state（直达 /forbidden）：不显示切换按钮', () => {
    renderForbidden();

    expect(screen.queryByRole('button', { name: /切换为服主身份继续/ })).not.toBeInTheDocument();
  });

  it('当前已是服主身份：不显示切换按钮', () => {
    mockUser = makeUser({ role: 'instance_admin', active_role: 'instance_admin' });
    renderForbidden({ from: '/store/servers', allow: ['instance_admin', 'server_admin', 'admin'] });

    expect(screen.queryByRole('button', { name: /切换为服主身份继续/ })).not.toBeInTheDocument();
  });

  it('切换失败：toast 报错且按钮恢复可用', async () => {
    switchActiveRoleMock.mockRejectedValue(new Error('切换失败'));
    const user = userEvent.setup();
    renderForbidden({ from: '/store/servers', allow: ['instance_admin', 'server_admin', 'admin'] });

    await user.click(screen.getByRole('button', { name: /切换为服主身份继续/ }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('切换失败');
    });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /切换为服主身份继续/ })).toBeEnabled();
  });
});
