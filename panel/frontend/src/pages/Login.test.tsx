// ============================================================================
// Login 页面单测 — 渲染表单 + 提交触发 login + 跳转 /instances
// 使用 MSW 拦截 /api/auth/login 与 /api/auth/me，隔离真实后端
// ============================================================================

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Navigate, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handlers, mockToken, TOKENS_BY_EMAIL } from '../mocks/handlers';
import { useAuth } from '../api/auth';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/utils';
import Login from './Login';

// MSW 服务器：在 Node 测试进程内拦截匹配的 fetch 请求
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  // 还原可能由用例修改的 VITE_ENABLE_DEMO，避免跨用例污染
  vi.unstubAllEnvs();
  // v4.13.1: 清除 storage，避免 AuthProvider 从 sessionStorage 恢复上一个测试的 user cache
  localStorage.clear();
  sessionStorage.clear();
});
afterAll(() => server.close());

// v4.13.1: 模拟 RootRedirect（按角色跳转到 /admin /store /guild）
// v4.19.1: Login.tsx 现统一跳 /select-identity（身份选择页），不再按角色直接跳基座
function TestRootRedirect() {
  const { user } = useAuth();
  if (user) {
    return <Navigate to="/select-identity" replace />;
  }
  return <div>身份选择器</div>;
}

// 占位组件：用于断言路由已跳转到身份选择页
function SelectIdentityPlaceholder() {
  return <div>身份选择页</div>;
}

function renderLoginRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<TestRootRedirect />} />
      <Route path="/select-identity" element={<SelectIdentityPlaceholder />} />
    </Routes>,
    { initialEntries: ['/login'] },
  );
}

describe('Login 页面', () => {
  it('渲染登录表单（标题、邮箱或用户名、密码、提交按钮）', async () => {
    renderLoginRoute();

    // v3.8.0-S13: Login 组件挂载后先调 /api/init/status 完成首启动检测，
    // 需 await waitFor 等表单渲染出来后再断言
    // v4.15.0: 深色电竞风换肤后标题为「登录 GameServer Panel」（上下文标题按 from 动态变化）
    // v4.19.1: 副标题改为「登录后选择您的身份，开始使用」（v4.16.x 身份体系重构）
    // v4.22.6: 标签从「邮箱」改为「邮箱或用户名」，支持邮箱或用户名登录
    await waitFor(() => {
      expect(screen.getByText('登录 GameServer Panel')).toBeInTheDocument();
    });
    expect(screen.getByText('登录后选择您的身份，开始使用')).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱或用户名')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('表单默认为空，不预填管理员凭据', async () => {
    renderLoginRoute();

    await waitFor(() => {
      expect(screen.getByLabelText('邮箱或用户名')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('邮箱或用户名')).toHaveValue('');
    expect(screen.getByLabelText('密码')).toHaveValue('');
  });

  it('提交表单后调用 login 并按角色跳转到 /admin，token 写入 localStorage', async () => {
    const user = userEvent.setup();
    renderLoginRoute();

    // v3.8.0-S13: 等表单渲染出来再填值
    await waitFor(() => {
      expect(screen.getByLabelText('邮箱或用户名')).toBeInTheDocument();
    });

    // 一.1: 表单默认为空，需手动填写凭据
    await user.type(screen.getByLabelText('邮箱或用户名'), 'admin@local.dev');
    await user.type(screen.getByLabelText('密码'), 'admin123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    // v4.19.1: Login.tsx 统一跳 /select-identity（身份选择页），不再按角色直接跳基座
    await waitFor(() => {
      expect(screen.getByText('身份选择页')).toBeInTheDocument();
    });

    // login 成功后 token 已写入 localStorage
    expect(window.localStorage.getItem('panel_token')).toBe(mockToken);
    // 按钮在提交完成后恢复为「登录」
    expect(screen.queryByRole('button', { name: '登录中…' })).not.toBeInTheDocument();
  });

  it('v4.22.6: 支持用户名登录（输入用户名不触发邮箱格式校验错误）', async () => {
    const user = userEvent.setup();
    renderLoginRoute();

    await waitFor(() => {
      expect(screen.getByLabelText('邮箱或用户名')).toBeInTheDocument();
    });

    // 输入纯用户名（不含 @），不应触发邮箱格式错误
    const identifierInput = screen.getByLabelText('邮箱或用户名');
    await user.type(identifierInput, 'airxw');
    await user.tab(); // 触发 onBlur 校验
    // 不应有"邮箱格式不正确"错误
    expect(screen.queryByText('邮箱格式不正确')).not.toBeInTheDocument();
  });

  it('登录失败时展示错误信息且不跳转', async () => {
    // 覆盖 login handler 返回 400 + JSON 错误体（client 会读取 body.message）
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderLoginRoute();

    await waitFor(() => {
      expect(screen.getByLabelText('邮箱或用户名')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('邮箱或用户名'), 'admin@local.dev');
    // v3.9.0-S3: 密码需 8+ 位 + 字母 + 数字；用 wrongpass1 通过本地校验后才会真正提交
    await user.type(screen.getByLabelText('密码'), 'wrongpass1');
    await user.click(screen.getByRole('button', { name: '登录' }));

    // v4.22.6: Login.tsx 将 INVALID_CREDENTIALS 映射为「邮箱/用户名或密码不正确」（同时显示在表单错误和 toast 中）
    await waitFor(() => {
      expect(screen.getAllByText('邮箱/用户名或密码不正确').length).toBeGreaterThan(0);
    });
    // 仍停留在 /login，未跳转
    expect(screen.queryByText('身份选择页')).not.toBeInTheDocument();
  });
});

// v4.19.1: v4.16.x 身份体系重构后 demo 账号调整：
//   - server_admin 已从 demo 按钮中移除（系统管理员不在演示账号展示）
//   - 仅保留腐竹（instance_admin）+ 玩家（user）两个 demo 账号
//   - demo 按钮折叠在「或使用演示账号」开关后，默认收起
//   - 登录后统一跳 /select-identity（身份选择页）
describe('Login 页面 — demo 一键登录（2 级演示账号，可折叠）', () => {
  it('测试环境（DEV=true）默认折叠 demo 账号，点击展开后显示 2 个 demo 登录按钮', async () => {
    const user = userEvent.setup();
    renderLoginRoute();

    // 等表单渲染
    await waitFor(() => {
      expect(screen.getByLabelText('邮箱或用户名')).toBeInTheDocument();
    });

    // 折叠态：demo 按钮未渲染
    expect(screen.queryByRole('button', { name: '腐竹一键登录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '玩家一键登录' })).not.toBeInTheDocument();

    // 点击展开开关
    await user.click(screen.getByRole('button', { name: /或使用演示账号/ }));

    // 展开后：腐竹 + 玩家 demo 按钮可见（系统管理员已移除）
    expect(screen.getByRole('button', { name: '腐竹一键登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '玩家一键登录' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '服务器管理员一键登录' })).not.toBeInTheDocument();
  });

  it('VITE_ENABLE_DEMO=true 时同样折叠，展开后显示 2 个 demo 登录按钮', async () => {
    vi.stubEnv('VITE_ENABLE_DEMO', 'true');
    const user = userEvent.setup();
    renderLoginRoute();

    await waitFor(() => {
      expect(screen.getByLabelText('邮箱或用户名')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: '腐竹一键登录' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /或使用演示账号/ }));
    expect(screen.getByRole('button', { name: '腐竹一键登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '玩家一键登录' })).toBeInTheDocument();
  });

  // 逐个验证 2 个 demo 账号点击后都能完成登录跳转
  // v4.19.1: 统一跳 /select-identity（身份选择页），不再按角色直接跳基座
  it.each([
    { role: 'instance_admin', ariaLabel: '腐竹一键登录', email: 'manager@local.dev' },
    { role: 'user', ariaLabel: '玩家一键登录', email: 'user@local.dev' },
  ])('点击 $role demo 按钮自动填表并完成登录跳转', async ({ ariaLabel, email }) => {
    const user = userEvent.setup();
    renderLoginRoute();

    // 等表单渲染并展开 demo 区
    await waitFor(() => {
      expect(screen.getByLabelText('邮箱或用户名')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /或使用演示账号/ }));

    const demoBtn = await screen.findByRole('button', { name: ariaLabel });
    // 按钮可见文本含对应邮箱（验证 useDemoLogin 凭据与文案一致）
    expect(demoBtn).toHaveTextContent(email);

    await user.click(demoBtn);

    // v4.19.1: 登录后统一跳 /select-identity（身份选择页）
    await waitFor(() => {
      expect(screen.getByText('身份选择页')).toBeInTheDocument();
    });
    // token 已写入（v4.13.1: 按账号对应独立 token）
    expect(window.localStorage.getItem('panel_token')).toBe(TOKENS_BY_EMAIL[email]);
    // 按钮在提交完成后恢复为「登录」
    expect(screen.queryByRole('button', { name: '登录中…' })).not.toBeInTheDocument();
  });
});
