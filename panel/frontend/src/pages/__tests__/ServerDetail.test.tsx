import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UserInfo } from '@public/schema/panel-api-types';
import { render, screen, userEvent, waitFor } from '../../test/utils';
import ServerDetail from '../ServerDetail';

const apiMock = {
  getServer: vi.fn(),
  listPacks: vi.fn(),
  deleteServer: vi.fn(),
  startServer: vi.fn(),
  stopServer: vi.fn(),
  resetServerState: vi.fn(),
  getServerDiskUsage: vi.fn(),
  cleanupSubdir: vi.fn(),
  // v3-billing: ServerDetail 挂载后加载计费设置 + 续费记录
  getInstanceBillingSettings: vi.fn(),
  listInstanceRenewals: vi.fn(),
};

let mockUser: Partial<UserInfo> | null = null;

vi.mock('../../api/auth', () => ({
  useAuth: () => ({
    api: apiMock,
    user: mockUser,
  }),
}));

vi.mock('../../hooks/useDocumentTitle', () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock('../../hooks/useSwipe', () => ({
  useSwipe: () => ({ current: null }),
}));

vi.mock('../../api/queries/servers', () => ({
  useUpdateServerExpiry: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../../components/ui', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  ErrorState: ({ error, onRetry }: { error: string; onRetry?: () => void }) => (
    <div>
      <div>{error}</div>
      {onRetry && <button onClick={onRetry}>重试</button>}
    </div>
  ),
  Skeleton: () => <div>loading</div>,
}));

vi.mock('../../context/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('../../components/ConfirmDialog', () => ({
  default: () => null,
}));

vi.mock('../../components/RconConsole', () => ({
  default: () => <div>mock-rcon</div>,
}));

vi.mock('../instance-detail/ConfigFiles', () => ({ default: () => <div>mock-config-files</div> }));
vi.mock('../instance-detail/WorldGen', () => ({ default: () => <div>mock-world-gen</div> }));
vi.mock('../instance-detail/Mods', () => ({ default: () => <div>mock-mods</div> }));
vi.mock('../instance-detail/Saves', () => ({ default: () => <div>mock-saves</div> }));
vi.mock('../instance-detail/Players', () => ({ default: () => <div>mock-players</div> }));
vi.mock('../instance-detail/ChatLogs', () => ({ default: () => <div>mock-chat-logs</div> }));
vi.mock('../instance-detail/UpdateCheck', () => ({ default: () => <div>mock-update</div> }));
vi.mock('../instance-detail/LogFiles', () => ({ default: () => <div>mock-log-files</div> }));
vi.mock('../instance-detail/Admins', () => ({ default: () => <div>mock-admins</div> }));
vi.mock('../instance-detail/InstanceRoles', () => ({ default: () => <div>mock-roles</div> }));
vi.mock('../instance-detail/GameCommandHelp', () => ({
  default: () => <div>mock-command-help</div>,
}));

const baseServer = {
  id: 'server-1',
  name: 'Test Server',
  pack_id: 'pack-palworld',
  game_type: 'palworld',
  node_id: 'node-1',
  owner_user_id: 'user-1',
  owner_username: 'manager',
  status: 'stopped',
  port: 8211,
  rcon_port: 25575,
  current_version: '1.0.0',
  last_activity_at: '2026-07-28T10:00:00.000Z',
  disk_usage_bytes: 2048,
  disk_usage_updated_at: '2026-07-28T11:00:00.000Z',
  startup_config_set_at: null,
  created_at: '2026-07-28T09:00:00.000Z',
  updated_at: '2026-07-28T10:00:00.000Z',
} as const;

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

function renderServerDetail(initialEntry = '/store/servers/server-1', extraRoutes?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/store/servers/:id"
          element={
            <ServerDetail
              viewMode="store"
              listPath="/store/servers"
              businessPathForServer={(serverId) => `/store/commercial/${serverId}`}
            />
          }
        />
        <Route path="/store/servers" element={<div>store-server-list</div>} />
        <Route path="/store/commercial/:id" element={<div>store-commercial-page</div>} />
        {extraRoutes}
      </Routes>
    </MemoryRouter>,
  );
}

describe('ServerDetail store mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMatchMedia(false);
    mockUser = {
      id: 'u1',
      username: 'manager',
      role: 'instance_admin',
      active_role: 'instance_admin',
      roles: ['instance_admin'],
    };
    apiMock.getServer.mockResolvedValue({ server: baseServer });
    apiMock.listPacks.mockResolvedValue({
      packs: [{ id: 'pack-palworld', ui_tabs: [] }],
    });
    apiMock.deleteServer.mockResolvedValue({});
    apiMock.startServer.mockResolvedValue({});
    apiMock.stopServer.mockResolvedValue({});
    apiMock.resetServerState.mockResolvedValue({
      server_id: 'server-1',
      previous_status: 'error',
      current_status: 'stopped',
    });
    apiMock.getServerDiskUsage.mockResolvedValue({
      usage: { total_bytes: 2048, updated_at: '2026-07-28T11:00:00.000Z' },
    });
    apiMock.cleanupSubdir.mockResolvedValue({ freed_bytes: 1024 });
    // v3-billing: 默认无豁免/自动续扣开启/无续费记录
    apiMock.getInstanceBillingSettings.mockResolvedValue({
      settings: {
        id: 'ibs-1',
        instance_id: 'server-1',
        instance_type: 'small',
        custom_monthly_price: null,
        billing_exempt: false,
        exempt_reason: null,
        auto_renew_enabled: true,
        last_billing_cycle_months: null,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    });
    apiMock.listInstanceRenewals.mockResolvedValue({ renewals: [] });
  });

  it('在 store 嵌入态中隐藏旧返回按钮并展示产品化信息标签', async () => {
    const user = userEvent.setup();
    renderServerDetail();

    await screen.findByRole('heading', { name: 'Test Server' });
    expect(screen.queryByRole('button', { name: /返回列表/ })).not.toBeInTheDocument();
    expect(screen.getByText('当前实例')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开信息卡' }));

    expect(screen.getByText('游戏模板')).toBeInTheDocument();
    expect(screen.getByText('部署节点')).toBeInTheDocument();
    expect(screen.getByText('实例归属')).toBeInTheDocument();
    expect(screen.getByText('目录清理')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '备份文件' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'backups' })).not.toBeInTheDocument();
  });

  it('管理员在 store 视图中通过商城管理按钮跳转到商业化页', async () => {
    mockUser = {
      id: 'u2',
      username: 'admin',
      role: 'server_admin',
      active_role: 'server_admin',
      roles: ['server_admin', 'instance_admin'],
    };
    const user = userEvent.setup();
    renderServerDetail();

    await screen.findByRole('button', { name: '商城管理' });
    await user.click(screen.getByRole('button', { name: '商城管理' }));

    await screen.findByText('store-commercial-page');
  });

  it('加载失败时返回按钮会回到配置的 store 列表页', async () => {
    apiMock.getServer.mockRejectedValueOnce(new Error('加载失败'));
    const user = userEvent.setup();
    renderServerDetail();

    await screen.findByText('加载失败');
    await user.click(screen.getByRole('button', { name: '返回列表' }));

    await screen.findByText('store-server-list');
  });

  it('移动端仅渲染当前视口需要的 tab 导航', async () => {
    setMatchMedia(true);
    renderServerDetail();

    await waitFor(() => {
      expect(screen.getByRole('tablist', { name: '移动端标签页' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('tablist', { name: '实例详情标签页' })).not.toBeInTheDocument();
  });

  // v4.29.8: error 状态恢复路径 UI 测试
  describe('v4.29.8: error 状态重置按钮', () => {
    it('error 状态 + admin 显示重置按钮，停止/删除按钮启用', async () => {
      mockUser = {
        id: 'u2',
        username: 'admin',
        role: 'server_admin',
        active_role: 'server_admin',
        roles: ['server_admin'],
      };
      apiMock.getServer.mockResolvedValueOnce({
        server: { ...baseServer, status: 'error' },
      });
      renderServerDetail();

      await screen.findByRole('heading', { name: 'Test Server' });
      expect(screen.getByRole('button', { name: '重置状态' })).toBeInTheDocument();
      // 停止按钮启用（canStop 含 error）
      const stopBtn = screen.getByRole('button', { name: '停止' });
      expect(stopBtn).not.toBeDisabled();
      // 删除按钮启用（canDelete 含 error）
      const deleteBtn = screen.getByRole('button', { name: '删除' });
      expect(deleteBtn).not.toBeDisabled();
    });

    it('非 error 状态不显示重置按钮', async () => {
      mockUser = {
        id: 'u2',
        username: 'admin',
        role: 'server_admin',
        active_role: 'server_admin',
        roles: ['server_admin'],
      };
      // 默认 baseServer.status === 'stopped'
      renderServerDetail();

      await screen.findByRole('heading', { name: 'Test Server' });
      expect(screen.queryByRole('button', { name: '重置状态' })).not.toBeInTheDocument();
    });

    it('error 状态 + 非 admin 不显示重置按钮（仍可见停止/删除）', async () => {
      // mockUser 默认是 instance_admin
      apiMock.getServer.mockResolvedValueOnce({
        server: { ...baseServer, status: 'error' },
      });
      renderServerDetail();

      await screen.findByRole('heading', { name: 'Test Server' });
      expect(screen.queryByRole('button', { name: '重置状态' })).not.toBeInTheDocument();
      // 停止/删除按钮仍可见（owner 可用）
      expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
    });

    it('点击重置按钮调用 resetServerState', async () => {
      mockUser = {
        id: 'u2',
        username: 'admin',
        role: 'server_admin',
        active_role: 'server_admin',
        roles: ['server_admin'],
      };
      apiMock.getServer.mockResolvedValueOnce({
        server: { ...baseServer, status: 'error' },
      });
      const user = userEvent.setup();
      renderServerDetail();

      await screen.findByRole('heading', { name: 'Test Server' });
      await user.click(screen.getByRole('button', { name: '重置状态' }));

      await waitFor(() => {
        expect(apiMock.resetServerState).toHaveBeenCalledWith('server-1');
      });
    });
  });
});
