import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { handlers } from '../../mocks/handlers';
import { renderWithProviders, screen, waitFor } from '../../test/utils';
import Servers from '../Servers';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Servers Component', () => {
  it('renders a list of servers with different states', async () => {
    // Override the default MSW handler for /api/servers to provide custom test data
    server.use(
      http.get('/api/servers', () => {
        return HttpResponse.json({
          servers: [
            {
              id: 'srv-001',
              name: 'Running Server',
              pack_id: 'pack-1',
              game_type: 'factorio',
              node_id: 'node-1',
              owner_user_id: 'user-1',
              owner_username: 'admin',
              current_version: null,
              last_activity_at: '2025-06-01T00:00:00.000Z',
              status: 'running',
              port: 10001,
              rcon_port: 20001,
              disk_usage_bytes: null,
              disk_usage_updated_at: null,
              startup_config_set_at: null,
              expires_at: null,
              expiry_status: 'permanent',
              created_at: '2025-06-01T00:00:00.000Z',
              updated_at: '2025-06-01T00:00:00.000Z',
            },
            {
              id: 'srv-002',
              name: 'Stopped Server',
              pack_id: 'pack-2',
              game_type: 'minecraft',
              node_id: 'node-1',
              owner_user_id: 'user-1',
              owner_username: 'admin',
              current_version: null,
              last_activity_at: '2025-06-01T00:00:00.000Z',
              status: 'stopped',
              port: 10002,
              rcon_port: 20002,
              disk_usage_bytes: null,
              disk_usage_updated_at: null,
              startup_config_set_at: null,
              expires_at: null,
              expiry_status: 'permanent',
              created_at: '2025-06-01T00:00:00.000Z',
              updated_at: '2025-06-01T00:00:00.000Z',
            },
          ],
        });
      })
    );

    renderWithProviders(<Servers />, { initialEntries: ['/servers'] });

    // Wait for the servers to be loaded and rendered
    await waitFor(() => {
      expect(screen.getAllByText('Running Server').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Stopped Server').length).toBeGreaterThan(0);

    // Verify state labels (the component uses stateClass mapping and STATE_LABEL)
    // The component maps 'running' to '运行中' and 'stopped' to '已停止'
    
    // Check if badges are rendered
    const runningBadges = screen.getAllByLabelText('实例状态: 运行中');
    expect(runningBadges.length).toBeGreaterThan(0);
    expect(runningBadges[0]).toHaveTextContent('运行中');

    const stoppedBadges = screen.getAllByLabelText('实例状态: 已停止');
    expect(stoppedBadges.length).toBeGreaterThan(0);
    expect(stoppedBadges[0]).toHaveTextContent('已停止');
  });
});
