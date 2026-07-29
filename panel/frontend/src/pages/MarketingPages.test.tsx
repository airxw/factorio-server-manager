import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Home from './Home';
import PlayerHome from './PlayerHome';
import { BUILD_ID } from '../buildInfo';

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('../context/GameThemeContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/GameThemeContext')>();
  return {
    ...actual,
    useGameTheme: () => ({
      theme: 'default',
      switchGame: vi.fn(),
    }),
  };
});

vi.mock('../context/AppVersionContext', () => ({
  useAppVersion: () => ({
    version: '4.16.3',
    fallback: '4.16.3',
    loading: false,
    failed: false,
  }),
}));

vi.mock('../components/DemoShowcase', () => ({
  default: () => <div>DemoShowcase Mock</div>,
}));

vi.mock('../components/GameTransition', () => ({
  default: () => null,
}));

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
vi.stubGlobal('scrollTo', vi.fn());

describe('Marketing Pages', () => {
  // 辅助：在 footer 元素的 textContent 中匹配 BUILD 编号
  // 注：JSX 中 `BUILD {BUILD_ID}` 会被渲染为两个独立文本节点（"BUILD" 和 BUILD_ID 值），
  // 所以不能用 getByText('BUILD xxx') 单节点匹配，需用函数匹配器检查整段 textContent
  // 不同页面 footer 类名不同（landing-footer-light / app-footer-build），统一用 textContent 函数匹配
  function findBuildFooter() {
    // 1) 优先找 app-footer-build 类
    const byClass = document.querySelector('.app-footer-build, .landing-footer-bottom-light');
    if (byClass) return byClass;
    // 2) 兜底：查找含 BUILD 文本的最接近 footer 的元素
    return screen.queryByText((content, element) => {
      if (!element) return false;
      return content.includes('BUILD');
    });
  }

  it('公开页 /home 展示底部规范化 footer BUILD span 和首页式 Hero', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    // BUILD 编号已规范化为底部 footer span：© YYYY GameServer Panel vX.X.X · BUILD YYYYMMDD-XXX · 开源免费
    const footer = findBuildFooter();
    expect(footer).not.toBeNull();
    expect(footer?.textContent ?? '').toContain(`BUILD ${BUILD_ID}`);
    expect(screen.getAllByRole('button', { name: '进入控制台' }).length).toBeGreaterThan(0);
    expect(screen.getByText('一个面板，')).toBeInTheDocument();
    expect(screen.getAllByText(/5 分钟/).length).toBeGreaterThan(0);
  });

  it('玩家页 /player 展示底部规范化 footer BUILD span 和玩家 Hero', () => {
    render(
      <MemoryRouter>
        <PlayerHome />
      </MemoryRouter>,
    );

    // BUILD 编号已规范化为底部 footer span：© YYYY GSP · Game Server Panel · BUILD YYYYMMDD-XXX
    const footer = findBuildFooter();
    expect(footer).not.toBeNull();
    expect(footer?.textContent ?? '').toContain(`BUILD ${BUILD_ID}`);
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByText('你玩的服务器，')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看我的福利' })).toBeInTheDocument();
  });
});
