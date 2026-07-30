import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '../../../test/utils';
import ServerDetailStore from '../ServerDetailStore';

vi.mock('../components/InstanceEconomyConfig', () => ({
  default: ({ serverId }: { serverId: string }) => <div>economy:{serverId}</div>,
}));

vi.mock('../../instance-detail/ServerDetailCore', () => ({
  default: () => <div>store-detail-body</div>,
}));

describe('ServerDetailStore', () => {
  it('不再渲染旧的外层返回按钮与重复标题', async () => {
    render(
      <MemoryRouter initialEntries={['/store/servers/server-1']}>
        <Routes>
          <Route path="/store/servers/:id" element={<ServerDetailStore />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /返回列表/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '实例详情' })).not.toBeInTheDocument();
    expect(await screen.findByText('economy:server-1')).toBeInTheDocument();
    expect(await screen.findByText('store-detail-body')).toBeInTheDocument();
  });
});
