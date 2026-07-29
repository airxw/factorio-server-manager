// ============================================================================
// RoleSwitcherModal 组件单测 — v4.28.0 分级免密
// 覆盖：
//   1. 免密分支（user ↔ instance_admin 点选即切，无需密码）
//   2. 密码分支（server_admin 目标进入二次校验表单，走 selectRole）
//   3. 失败错误展示 / 单角色不渲染
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserInfo } from '@public/schema/panel-api-types';
import { render, screen, userEvent, waitFor } from '../test/utils';
import RoleSwitcherModal from './RoleSwitcherModal';

const switchActiveRoleMock = vi.fn<(role: string) => Promise<void>>();
const selectRoleMock = vi.fn<(email: string, password: string, role: string) => Promise<void>>();
const navigateMock = vi.fn();
const onCloseMock = vi.fn();

let mockUser: UserInfo;

vi.mock('../api/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    selectRole: selectRoleMock,
    switchActiveRole: switchActiveRoleMock,
  }),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = makeUser();
});

describe('RoleSwitcherModal — 免密分支', () => {
  it('玩家→服主：点选角色卡片即免密切换，跳转 /store', async () => {
    switchActiveRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RoleSwitcherModal open onClose={onCloseMock} />);

    expect(screen.getByText('当前角色')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /服主/ }));

    await waitFor(() => {
      expect(switchActiveRoleMock).toHaveBeenCalledWith('instance_admin');
    });
    // 免密通道不触发密码链路，不进入密码表单
    expect(selectRoleMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('输入当前账号密码以确认')).not.toBeInTheDocument();
    expect(onCloseMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/store', { replace: true });
  });

  it('服主→玩家：免密切换回玩家身份，跳转 /guild', async () => {
    mockUser = makeUser({ role: 'instance_admin', active_role: 'instance_admin' });
    switchActiveRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RoleSwitcherModal open onClose={onCloseMock} />);

    await user.click(screen.getByRole('button', { name: /^玩家/ }));

    await waitFor(() => {
      expect(switchActiveRoleMock).toHaveBeenCalledWith('user');
    });
    expect(selectRoleMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/guild', { replace: true });
  });

  it('免密切换失败：展示错误信息且不关闭弹窗', async () => {
    switchActiveRoleMock.mockRejectedValue(new Error('网络错误'));
    const user = userEvent.setup();
    render(<RoleSwitcherModal open onClose={onCloseMock} />);

    await user.click(screen.getByRole('button', { name: /服主/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('网络错误');
    });
    expect(onCloseMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('RoleSwitcherModal — 密码分支（server_admin）', () => {
  it('切换平台管理员：进入密码二次校验表单，提交后调用 selectRole', async () => {
    mockUser = makeUser({ roles: ['user', 'instance_admin', 'server_admin'] });
    selectRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RoleSwitcherModal open onClose={onCloseMock} />);

    await user.click(screen.getByRole('button', { name: /平台管理员/ }));

    // 进入密码表单，此时尚未调用任何切换 API
    expect(screen.getByPlaceholderText('输入当前账号密码以确认')).toBeInTheDocument();
    expect(switchActiveRoleMock).not.toHaveBeenCalled();
    expect(selectRoleMock).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText('输入当前账号密码以确认'), 'secret');
    await user.click(screen.getByRole('button', { name: '确认切换' }));

    await waitFor(() => {
      expect(selectRoleMock).toHaveBeenCalledWith('air@example.com', 'secret', 'server_admin');
    });
    expect(switchActiveRoleMock).not.toHaveBeenCalled();
    expect(onCloseMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/admin', { replace: true });
  });

  it('密码为空时确认按钮禁用', async () => {
    mockUser = makeUser({ roles: ['user', 'instance_admin', 'server_admin'] });
    const user = userEvent.setup();
    render(<RoleSwitcherModal open onClose={onCloseMock} />);

    await user.click(screen.getByRole('button', { name: /平台管理员/ }));
    expect(screen.getByRole('button', { name: '确认切换' })).toBeDisabled();
  });
});

describe('RoleSwitcherModal — 边界', () => {
  it('单角色账号：弹窗不渲染', () => {
    mockUser = makeUser({ roles: ['user'] });
    const { container } = render(<RoleSwitcherModal open onClose={onCloseMock} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('open=false 时不渲染', () => {
    const { container } = render(<RoleSwitcherModal open={false} onClose={onCloseMock} />);
    expect(container).toBeEmptyDOMElement();
  });
});
