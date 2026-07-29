// ============================================================================
// SiteInfoStep.test.tsx — v4.20.0 Setup Wizard v2 Step 4 子组件单测
//
// 覆盖：
//   1. validatePublicBaseUrl 纯函数边界场景（空/http/https/非协议/大小写）
//   2. 组件渲染：站点名称输入 + 公网入口输入 + 实时校验展示
//   3. 受控回调：onSiteNameChange / onPublicBaseUrlChange
// ============================================================================

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils';
import SiteInfoStep, { validatePublicBaseUrl } from '../SiteInfoStep';

// ===========================================================================
// 1. validatePublicBaseUrl 纯函数测试
// ===========================================================================

describe('validatePublicBaseUrl — 纯函数边界场景', () => {
  it('空字符串：返回 warn 级别（不阻塞，提示可在 .env 补充）', () => {
    const r = validatePublicBaseUrl('');
    expect(r.valid).toBe(false);
    expect(r.protocol).toBeNull();
    expect(r.level).toBe('warn');
    expect(r.message).toContain('未配置');
  });

  it('纯空白字符串：与空字符串同等处理（trim 后判定）', () => {
    const r = validatePublicBaseUrl('   ');
    expect(r.valid).toBe(false);
    expect(r.level).toBe('warn');
  });

  it('非 http/https 协议：返回 error 级别', () => {
    const r = validatePublicBaseUrl('ftp://example.com');
    expect(r.valid).toBe(false);
    expect(r.protocol).toBeNull();
    expect(r.level).toBe('error');
    expect(r.message).toContain('http:// 或 https://');
  });

  it('无协议前缀：返回 error 级别', () => {
    const r = validatePublicBaseUrl('gsp.ecsrz.com:3001');
    expect(r.valid).toBe(false);
    expect(r.level).toBe('error');
  });

  it('http:// 开头：返回 warn 级别（可用但不安全）', () => {
    const r = validatePublicBaseUrl('http://gsp.ecsrz.com:3000');
    expect(r.valid).toBe(true);
    expect(r.protocol).toBe('http');
    expect(r.level).toBe('warn');
    expect(r.message).toContain('HTTP');
  });

  it('https:// 开头：返回 ok 级别', () => {
    const r = validatePublicBaseUrl('https://gsp.ecsrz.com:3001');
    expect(r.valid).toBe(true);
    expect(r.protocol).toBe('https');
    expect(r.level).toBe('ok');
    expect(r.message).toContain('HTTPS');
  });

  it('HTTP 大小写不敏感：HTTP:// 与 HTTPS:// 同样识别', () => {
    const r1 = validatePublicBaseUrl('HTTP://EXAMPLE.COM');
    const r2 = validatePublicBaseUrl('HTTPS://EXAMPLE.COM');
    expect(r1.protocol).toBe('http');
    expect(r1.level).toBe('warn');
    expect(r2.protocol).toBe('https');
    expect(r2.level).toBe('ok');
  });

  it('带尾随空格的 https URL：trim 后正确识别为 ok', () => {
    const r = validatePublicBaseUrl('  https://gsp.ecsrz.com:3001  ');
    expect(r.protocol).toBe('https');
    expect(r.level).toBe('ok');
  });
});

// ===========================================================================
// 2. 组件渲染与交互
// ===========================================================================

describe('SiteInfoStep — 组件渲染与受控回调', () => {
  it('渲染站点名称输入框 + 公网入口输入框', () => {
    renderWithProviders(
      <SiteInfoStep
        siteName="GameServer Panel"
        publicBaseUrl=""
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    expect(screen.getByLabelText(/站点名称/)).toBeInTheDocument();
    expect(screen.getByLabelText(/公网入口 URL/)).toBeInTheDocument();
  });

  it('站点名称初始值正确显示', () => {
    renderWithProviders(
      <SiteInfoStep
        siteName="我的游戏服务器"
        publicBaseUrl=""
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    const nameInput = screen.getByLabelText(/站点名称/) as HTMLInputElement;
    expect(nameInput.value).toBe('我的游戏服务器');
  });

  it('公网入口为空时不显示校验结果块', () => {
    renderWithProviders(
      <SiteInfoStep
        siteName="Test"
        publicBaseUrl=""
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    // 空字符串时 validatePublicBaseUrl 返回 warn，但组件仅在校验块 publicBaseUrl.trim() 非空时渲染
    expect(screen.queryByText('HTTPS 协议')).not.toBeInTheDocument();
    expect(screen.queryByText('HTTP 协议')).not.toBeInTheDocument();
    expect(screen.queryByText('格式错误')).not.toBeInTheDocument();
  });

  it('公网入口填 https:// 时显示 HTTPS 协议 OK 提示', () => {
    renderWithProviders(
      <SiteInfoStep
        siteName="Test"
        publicBaseUrl="https://gsp.ecsrz.com:3001"
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    expect(screen.getByText('HTTPS 协议')).toBeInTheDocument();
    expect(screen.getByText('HTTPS 协议，安全可用')).toBeInTheDocument();
  });

  it('公网入口填 http:// 时显示 HTTP 协议 warn 提示', () => {
    renderWithProviders(
      <SiteInfoStep
        siteName="Test"
        publicBaseUrl="http://192.168.5.14:3000"
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    expect(screen.getByText('HTTP 协议')).toBeInTheDocument();
    expect(screen.getByText(/不安全/)).toBeInTheDocument();
  });

  it('公网入口填非协议字符串时显示格式错误', () => {
    renderWithProviders(
      <SiteInfoStep
        siteName="Test"
        publicBaseUrl="gsp.ecsrz.com"
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    expect(screen.getByText('格式错误')).toBeInTheDocument();
    expect(screen.getByText(/必须以 http:\/\/ 或 https:\/\/ 开头/)).toBeInTheDocument();
  });

  it('修改站点名称触发 onSiteNameChange 回调', () => {
    const onSiteNameChange = vi.fn();
    renderWithProviders(
      <SiteInfoStep
        siteName=""
        publicBaseUrl=""
        onSiteNameChange={onSiteNameChange}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    const nameInput = screen.getByLabelText(/站点名称/);
    // 受控组件 value 由 props 决定，用 fireEvent.change 一次性输入完整值验证回调
    fireEvent.change(nameInput, { target: { value: '新站点' } });

    expect(onSiteNameChange).toHaveBeenCalledWith('新站点');
  });

  it('修改公网入口触发 onPublicBaseUrlChange 回调', () => {
    const onPublicBaseUrlChange = vi.fn();
    renderWithProviders(
      <SiteInfoStep
        siteName="Test"
        publicBaseUrl=""
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={onPublicBaseUrlChange}
      />,
    );

    const urlInput = screen.getByLabelText(/公网入口 URL/);
    // fireEvent.change 一次触发，验证回调收到完整值
    fireEvent.change(urlInput, { target: { value: 'https://example.com' } });

    expect(onPublicBaseUrlChange).toHaveBeenCalledWith('https://example.com');
  });

  it('站点名称输入框有 maxLength=64 限制', () => {
    renderWithProviders(
      <SiteInfoStep
        siteName=""
        publicBaseUrl=""
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    const nameInput = screen.getByLabelText(/站点名称/) as HTMLInputElement;
    expect(nameInput.maxLength).toBe(64);
  });

  it('站点名称 data-site-valid 标记：非空时为 1', () => {
    const { container } = renderWithProviders(
      <SiteInfoStep
        siteName="有效站点"
        publicBaseUrl=""
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    const hidden = container.querySelector('[data-site-valid]') as HTMLInputElement;
    expect(hidden.dataset.siteValid).toBe('1');
  });

  it('站点名称 data-site-valid 标记：空时为 0', () => {
    const { container } = renderWithProviders(
      <SiteInfoStep
        siteName=""
        publicBaseUrl=""
        onSiteNameChange={() => {}}
        onPublicBaseUrlChange={() => {}}
      />,
    );

    const hidden = container.querySelector('[data-site-valid]') as HTMLInputElement;
    expect(hidden.dataset.siteValid).toBe('0');
  });
});
