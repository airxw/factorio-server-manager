// ============================================================================
// DaemonNodeStep.test.tsx — v4.22.0 Setup Wizard v3 Step 3 子组件单测
//
// v4.22.0 重构后覆盖三模式：
//   1. 默认渲染：local 模式（本机单节点）+ 三张模式卡片
//   2. 模式切换：local → multi → skip
//   3. local 模式：DAEMON_TOKEN 输入 + 测试按钮 + 测试结果横幅
//   4. multi 模式：部署命令展示 + 导入链接粘贴 + 测试并导入 + 节点列表
//   5. skip 模式：跳过提示
//   6. parseDaemonImportLink：链接解析单元用例
// ============================================================================

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils';
import DaemonNodeStep, {
  DEPLOY_DAEMON_COMMAND,
  LOCAL_DEFAULTS,
  parseDaemonImportLink,
  type DaemonNodeDraft,
} from '../DaemonNodeStep';

// ---------------------------------------------------------------------------
// 辅助 fixtures
// ---------------------------------------------------------------------------

const SAMPLE_NODES: DaemonNodeDraft[] = [
  {
    draftId: 'draft-1',
    name: '上海节点',
    fqdn: '192.168.5.14',
    daemon_token: 'secret-token-1',
    node_type: 'master',
  },
  {
    draftId: 'draft-2',
    name: '北京节点',
    fqdn: 'bj.example.com',
    public_ip: '203.0.113.10',
    daemon_token: 'secret-token-2',
    node_type: 'worker',
  },
];

const COMMON_PROPS = {
  localTestResult: null,
  localTesting: false,
  localTested: false,
  autoDetectError: null,
  autoDetectEnvPath: null,
  nodes: [],
  importLink: '',
  importError: null,
  importing: false,
  importTestResult: null,
  onModeChange: vi.fn(),
  onTestLocal: vi.fn(),
  onImportLinkChange: vi.fn(),
  onTestAndImport: vi.fn(),
  onRemoveNode: vi.fn(),
};

// ===========================================================================
// 1. 默认渲染（local 模式）
// ===========================================================================

describe('DaemonNodeStep — 默认渲染（local 模式）', () => {
  it('渲染三张模式卡片，默认 local 模式高亮', () => {
    renderWithProviders(<DaemonNodeStep {...COMMON_PROPS} mode="local" />);

    expect(screen.getByText('本机单节点')).toBeInTheDocument();
    expect(screen.getByText('多节点')).toBeInTheDocument();
    expect(screen.getByText('暂不配置')).toBeInTheDocument();
    // local 模式标识"推荐"
    expect(screen.getByText('推荐')).toBeInTheDocument();
  });

  it('local 模式下展示自动检测提示与"自动检测并连接"按钮', () => {
    renderWithProviders(<DaemonNodeStep {...COMMON_PROPS} mode="local" />);

    // v4.22.1: token 输入框被移除，改为展示自动检测提示文案
    expect(screen.getByText(/自动读取/)).toBeInTheDocument();
    expect(screen.getByText(/DAEMON_TOKEN/)).toBeInTheDocument();
    // 按钮文案改为"自动检测并连接"
    expect(screen.getByRole('button', { name: /自动检测并连接/ })).toBeInTheDocument();
  });

  it('local 模式下节点名称/地址/端口为只读且使用默认值', () => {
    renderWithProviders(<DaemonNodeStep {...COMMON_PROPS} mode="local" />);

    const nameInput = screen.getByDisplayValue(LOCAL_DEFAULTS.name) as HTMLInputElement;
    const fqdnInput = screen.getByDisplayValue(LOCAL_DEFAULTS.fqdn) as HTMLInputElement;
    const portInput = screen.getByDisplayValue(String(LOCAL_DEFAULTS.port)) as HTMLInputElement;

    expect(nameInput).toBeDisabled();
    expect(fqdnInput).toBeDisabled();
    expect(portInput).toBeDisabled();
  });
});

// ===========================================================================
// 2. 模式切换
// ===========================================================================

describe('DaemonNodeStep — 模式切换', () => {
  it('点击「多节点」卡片触发 onModeChange("multi")', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <DaemonNodeStep {...COMMON_PROPS} mode="local" onModeChange={onModeChange} />,
    );

    fireEvent.click(screen.getByText('多节点'));
    expect(onModeChange).toHaveBeenCalledWith('multi');
  });

  it('点击「暂不配置」卡片触发 onModeChange("skip")', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <DaemonNodeStep {...COMMON_PROPS} mode="local" onModeChange={onModeChange} />,
    );

    fireEvent.click(screen.getByText('暂不配置'));
    expect(onModeChange).toHaveBeenCalledWith('skip');
  });

  it('点击「本机单节点」卡片触发 onModeChange("local")', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <DaemonNodeStep {...COMMON_PROPS} mode="multi" onModeChange={onModeChange} />,
    );

    fireEvent.click(screen.getByText('本机单节点'));
    expect(onModeChange).toHaveBeenCalledWith('local');
  });
});

// ===========================================================================
// 3. local 模式
// ===========================================================================

describe('DaemonNodeStep — local 模式', () => {
  it('点击"自动检测并连接"按钮触发 onTestLocal', () => {
    const onTestLocal = vi.fn();
    renderWithProviders(
      <DaemonNodeStep
        {...COMMON_PROPS}
        mode="local"
        onTestLocal={onTestLocal}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /自动检测并连接/ }));
    expect(onTestLocal).toHaveBeenCalledOnce();
  });

  it('localTesting=true 时按钮显示"自动检测中…"且禁用', () => {
    renderWithProviders(
      <DaemonNodeStep {...COMMON_PROPS} mode="local" localTesting={true} />,
    );

    const btn = screen.getByRole('button', { name: /自动检测中/ });
    expect(btn).toBeDisabled();
  });

  it('autoDetectError 非空时展示错误信息与修复建议', () => {
    renderWithProviders(
      <DaemonNodeStep
        {...COMMON_PROPS}
        mode="local"
        autoDetectError="Daemon 配置文件不存在"
        autoDetectEnvPath="/opt/gameserver-panel/daemon/.env"
      />,
    );

    expect(screen.getByText(/Daemon 配置文件不存在/)).toBeInTheDocument();
    expect(screen.getByText(/opt\/gameserver-panel\/daemon\/.env/)).toBeInTheDocument();
    expect(screen.getByText(/systemctl status gameserver-daemon/)).toBeInTheDocument();
  });

  it('localTestResult.ok=true 时显示成功横幅（含延迟与版本）', () => {
    renderWithProviders(
      <DaemonNodeStep
        {...COMMON_PROPS}
        mode="local"
        localTested={true}
        localTestResult={{
          ok: true,
          latency_ms: 42,
          daemon_version: '4.22.0',
        }}
      />,
    );

    expect(screen.getByText(/连接成功（耗时 42 ms/)).toBeInTheDocument();
    expect(screen.getByText(/Daemon 版本 4.22.0/)).toBeInTheDocument();
  });

  it('localTestResult.ok=false 时显示失败横幅', () => {
    renderWithProviders(
      <DaemonNodeStep
        {...COMMON_PROPS}
        mode="local"
        localTested={true}
        localTestResult={{ ok: false, error: 'Connection refused' }}
      />,
    );

    expect(screen.getByText(/连接失败：Connection refused/)).toBeInTheDocument();
  });

  it('localTested=true 时显示"测试通过"提示与"重新检测"按钮', () => {
    renderWithProviders(
      <DaemonNodeStep {...COMMON_PROPS} mode="local" localTested={true} />,
    );

    expect(screen.getByText(/连接测试通过/)).toBeInTheDocument();
    // 测试通过后按钮文案改为"重新检测"
    expect(screen.getByRole('button', { name: /重新检测/ })).toBeInTheDocument();
  });
});

// ===========================================================================
// 4. multi 模式
// ===========================================================================

describe('DaemonNodeStep — multi 模式', () => {
  it('展示部署脚本命令（含复制按钮）', () => {
    renderWithProviders(<DaemonNodeStep {...COMMON_PROPS} mode="multi" />);

    expect(screen.getByText(DEPLOY_DAEMON_COMMAND)).toBeInTheDocument();
    // 复制按钮：用 aria-label 精确定位（aria-label 覆盖文本内容，避免命中多节点卡片描述）
    expect(screen.getByRole('button', { name: '复制命令' })).toBeInTheDocument();
  });

  it('展示导入链接 textarea', () => {
    renderWithProviders(<DaemonNodeStep {...COMMON_PROPS} mode="multi" />);

    expect(screen.getByPlaceholderText(/gsp-daemon-import:\/\//)).toBeInTheDocument();
  });

  it('修改导入链接触发 onImportLinkChange', () => {
    const onImportLinkChange = vi.fn();
    renderWithProviders(
      <DaemonNodeStep
        {...COMMON_PROPS}
        mode="multi"
        onImportLinkChange={onImportLinkChange}
      />,
    );

    const textarea = screen.getByPlaceholderText(/gsp-daemon-import:\/\//);
    fireEvent.change(textarea, { target: { value: 'gsp-daemon-import://abc' } });
    expect(onImportLinkChange).toHaveBeenCalledWith('gsp-daemon-import://abc');
  });

  it('导入链接为空时测试并导入按钮禁用', () => {
    renderWithProviders(
      <DaemonNodeStep {...COMMON_PROPS} mode="multi" importLink="" />,
    );

    expect(screen.getByRole('button', { name: /测试连接并导入/ })).toBeDisabled();
  });

  it('点击测试并导入按钮触发 onTestAndImport', () => {
    const onTestAndImport = vi.fn();
    renderWithProviders(
      <DaemonNodeStep
        {...COMMON_PROPS}
        mode="multi"
        importLink="gsp-daemon-import://eyJuYW1lIjoi...In0="
        onTestAndImport={onTestAndImport}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /测试连接并导入/ }));
    expect(onTestAndImport).toHaveBeenCalledOnce();
  });

  it('importError 非空时展示错误横幅', () => {
    renderWithProviders(
      <DaemonNodeStep
        {...COMMON_PROPS}
        mode="multi"
        importError="链接缺少 token 字段"
      />,
    );

    expect(screen.getByText(/链接缺少 token 字段/)).toBeInTheDocument();
  });

  it('节点列表非空时渲染所有节点（含移除按钮）', () => {
    const onRemoveNode = vi.fn();
    renderWithProviders(
      <DaemonNodeStep
        {...COMMON_PROPS}
        mode="multi"
        nodes={SAMPLE_NODES}
        onRemoveNode={onRemoveNode}
      />,
    );

    expect(screen.getByText('上海节点')).toBeInTheDocument();
    expect(screen.getByText('北京节点')).toBeInTheDocument();
    expect(screen.getByText(/已添加的节点（2）/)).toBeInTheDocument();

    // 点击第一个移除按钮
    const removeButtons = screen.getAllByRole('button', { name: /移除节点/ });
    fireEvent.click(removeButtons[0]);
    expect(onRemoveNode).toHaveBeenCalledWith('draft-1');
  });

  it('节点列表为空时显示空状态', () => {
    renderWithProviders(
      <DaemonNodeStep {...COMMON_PROPS} mode="multi" nodes={[]} />,
    );

    expect(screen.getByText('尚未添加任何 Daemon 节点。')).toBeInTheDocument();
  });
});

// ===========================================================================
// 5. skip 模式
// ===========================================================================

describe('DaemonNodeStep — skip 模式', () => {
  it('展示跳过提示文案', () => {
    renderWithProviders(<DaemonNodeStep {...COMMON_PROPS} mode="skip" />);

    expect(screen.getByText(/已选择跳过 Daemon 配置/)).toBeInTheDocument();
    // skip 模式提示文案被 <code> 拆分，分两段断言
    expect(screen.getByText(/提交后/)).toBeInTheDocument();
    expect(screen.getByText('.env DAEMON_URL')).toBeInTheDocument();
  });

  it('skip 模式下不展示「自动检测并连接」按钮（精确匹配）', () => {
    renderWithProviders(<DaemonNodeStep {...COMMON_PROPS} mode="skip" />);

    // v4.22.1: local 模式按钮文案改为"自动检测并连接"
    expect(screen.queryByRole('button', { name: /^自动检测并连接$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^测试连接并导入$/ })).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 6. parseDaemonImportLink 单测
// ===========================================================================

describe('parseDaemonImportLink', () => {
  it('空字符串返回错误', () => {
    const result = parseDaemonImportLink('');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/请粘贴导入链接/);
    }
  });

  it('缺少前缀返回错误', () => {
    const result = parseDaemonImportLink('https://example.com/foo');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/必须以 gsp-daemon-import:\/\//);
    }
  });

  it('合法链接返回 payload', () => {
    // 构造合法 payload: {name:"n1", fqdn:"1.2.3.4", port:8080, token:"tk"}
    // 使用 btoa 编码 UTF-8 安全字符串（仅 ASCII 字符）
    const payload = { name: 'n1', fqdn: '1.2.3.4', port: 8080, token: 'tk' };
    const json = JSON.stringify(payload);
    // 使用浏览器 btoa（vitest 提供）
    const b64 = btoa(json);
    const link = `gsp-daemon-import://${b64}`;

    const result = parseDaemonImportLink(link);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.name).toBe('n1');
      expect(result.fqdn).toBe('1.2.3.4');
      expect(result.port).toBe(8080);
      expect(result.token).toBe('tk');
    }
  });

  it('包含可选字段 public_ip / node_type 时透传', () => {
    const payload = {
      name: 'n2',
      fqdn: 'example.com',
      port: 8081,
      token: 'tk2',
      public_ip: '203.0.113.10',
      node_type: 'worker' as const,
    };
    const b64 = btoa(JSON.stringify(payload));
    const link = `gsp-daemon-import://${b64}`;

    const result = parseDaemonImportLink(link);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.public_ip).toBe('203.0.113.10');
      expect(result.node_type).toBe('worker');
    }
  });

  it('port 非数字返回错误', () => {
    const payload = { name: 'n', fqdn: '1.2.3.4', port: 'not-a-number', token: 't' };
    const b64 = btoa(JSON.stringify(payload));
    const link = `gsp-daemon-import://${b64}`;

    const result = parseDaemonImportLink(link);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/port 字段无效/);
    }
  });

  it('缺少 token 字段返回错误', () => {
    const payload = { name: 'n', fqdn: '1.2.3.4', port: 8080 };
    const b64 = btoa(JSON.stringify(payload));
    const link = `gsp-daemon-import://${b64}`;

    const result = parseDaemonImportLink(link);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/缺少 token 字段/);
    }
  });

  it('base64 损坏返回错误', () => {
    const link = 'gsp-daemon-import://!!!not-valid-base64!!!';
    const result = parseDaemonImportLink(link);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/base64 解码错误/);
    }
  });
});
