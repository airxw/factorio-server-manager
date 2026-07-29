import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Docs from './Docs';
import DocsConfig from './DocsConfig';
import DocsDaemon from './DocsDaemon';
import DocsPacks from './DocsPacks';
import DocsPlayers from './DocsPlayers';
import DocsReports from './DocsReports';
import DocsShop from './DocsShop';

function renderDocsRoute(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/config" element={<DocsConfig />} />
        <Route path="/docs/packs" element={<DocsPacks />} />
        <Route path="/docs/shop" element={<DocsShop />} />
        <Route path="/docs/players" element={<DocsPlayers />} />
        <Route path="/docs/reports" element={<DocsReports />} />
        <Route path="/docs/daemon" element={<DocsDaemon />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Docs routes', () => {
  it('文档首页暴露所有二级文档入口', () => {
    renderDocsRoute('/docs');

    expect(screen.getByRole('link', { name: '阅读配置文档 →' })).toHaveAttribute('href', '/docs/config');
    expect(screen.getByRole('link', { name: '查看 Pack 列表 →' })).toHaveAttribute('href', '/docs/packs');
    expect(screen.getByRole('link', { name: '商城配置指南 →' })).toHaveAttribute('href', '/docs/shop');
    expect(screen.getByRole('link', { name: '玩家管理文档 →' })).toHaveAttribute('href', '/docs/players');
    expect(screen.getByRole('link', { name: '数据看板指南 →' })).toHaveAttribute('href', '/docs/reports');
    expect(screen.getByRole('link', { name: '查看节点文档 →' })).toHaveAttribute('href', '/docs/daemon');
  });

  it.each([
    ['/docs/config', '部署拓扑与核心配置'],
    ['/docs/packs', 'Pack 安装与运维说明'],
    ['/docs/shop', 'VIP、商品与 CDK 的运营闭环'],
    ['/docs/players', '从绑定到互动的玩家链路'],
    ['/docs/reports', '从流水到系统健康的观测视角'],
    ['/docs/daemon', '节点部署与连接检查'],
  ])('路由 %s 可渲染对应专题页', (path, heading) => {
    renderDocsRoute(path);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  });
});
