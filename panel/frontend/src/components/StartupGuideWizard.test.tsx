// ============================================================================
// StartupGuideWizard 组件单测 — 启动前置引导向导（技术债清理 W6/M14）
// 覆盖：
//   1. 初始渲染（标题 / 服务器名 / 步骤指示器 / 字段 / 必填标记 / 默认值选中）
//   2. 必填字段缺失时「下一步」禁用，填写后放开（不推进）
//   3. 步骤推进（下一步）与回退（上一步，输入值保留）
//   4. 提交成功：API 参数正确 + onComplete + 清除草稿 + 成功提示
//   5. 提交失败：错误展示（sg-error + toast）且不触发 onComplete
//   6. 获取引导失败：错误展示 + 重试按钮
//   7. guide=null（Pack 无声明）时直接触发 onComplete
//   8. localStorage 草稿优先于 Pack 默认值恢复
//   9. open=false 不渲染且不拉取引导
// Mock 方式：vi.mock('../api/auth')（与 Layout.test.tsx / RoleSwitcherModal.test.tsx 一致），
// Toast 走真实 ToastProvider，断言真实 DOM。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { StartupGuide } from '@public/schema/pack-schema';
import type {
  GetStartupGuideResponse,
  SaveStartupConfigResponse,
} from '@public/schema/panel-api-types';
import { render, screen, userEvent, waitFor } from '../test/utils';
import { ToastProvider } from '../context/ToastContext';
import StartupGuideWizard from './StartupGuideWizard';

// useAuth mock——api 对象必须保持稳定引用：
// 组件拉取引导的 useEffect 依赖 api，若每次渲染返回新对象会导致无限重拉
const { apiMock, getStartupGuideMock, saveStartupConfigMock } = vi.hoisted(() => {
  const getStartupGuideMock = vi.fn();
  const saveStartupConfigMock = vi.fn();
  return {
    getStartupGuideMock,
    saveStartupConfigMock,
    apiMock: {
      getStartupGuide: getStartupGuideMock,
      saveStartupConfig: saveStartupConfigMock,
    },
  };
});

vi.mock('../api/auth', () => ({
  useAuth: () => ({ api: apiMock }),
}));

const onCompleteMock = vi.fn();
const onCancelMock = vi.fn();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 两步引导：第一步含必填文本（无默认值）+ 地图单选（有默认值）；第二步含数字 + 可选密码 */
const GUIDE: StartupGuide = {
  enabled: true,
  steps: [
    {
      key: 'world',
      title: '世界设置',
      description: '设置世界名称与地图',
      optional: false,
      fields: [
        {
          key: 'world_name',
          type: 'world_name',
          label: '世界名称',
          description: '存档名称',
          required: true,
        },
        {
          key: 'map',
          type: 'map',
          label: '地图',
          required: true,
          default: 'TheIsland',
          options: [
            { value: 'TheIsland', display_name: '孤岛', description: '默认地图' },
            { value: 'Ragnarok', display_name: '仙境' },
          ],
        },
      ],
    },
    {
      key: 'server',
      title: '服务器设置',
      optional: false,
      fields: [
        {
          key: 'max_players',
          type: 'max_players',
          label: '最大玩家数',
          required: false,
          min: 1,
          max: 100,
        },
        {
          key: 'password',
          type: 'password',
          label: '服务器密码',
          description: '留空则无密码',
          required: false,
        },
      ],
    },
  ],
};

const GUIDE_RESPONSE: GetStartupGuideResponse = {
  guide: GUIDE,
  current_config: {},
  completed: false,
};

const SAVE_RESPONSE: SaveStartupConfigResponse = {
  server_id: 'srv-1',
  completed: true,
  missing_fields: [],
  config_writes: [],
};

const DRAFT_KEY = 'startup-guide-draft:srv-1';

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function renderWizard(
  overrides: Partial<ComponentProps<typeof StartupGuideWizard>> = {},
) {
  return render(
    <ToastProvider>
      <StartupGuideWizard
        open
        serverId="srv-1"
        serverName="测试实例"
        onComplete={onCompleteMock}
        onCancel={onCancelMock}
        {...overrides}
      />
    </ToastProvider>,
  );
}

/** 等待引导数据加载完成（第一步字段出现） */
async function waitWizardLoaded() {
  await waitFor(() => {
    expect(screen.getByLabelText(/世界名称/)).toBeInTheDocument();
  });
}

/** 填好第一步必填项并推进到第二步 */
async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/世界名称/), '我的世界');
  await user.click(screen.getByRole('button', { name: /下一步/ }));
  await waitFor(() => {
    expect(screen.getByLabelText(/最大玩家数/)).toBeInTheDocument();
  });
}

/**
 * 地图卡片为 label[role=radio] 包裹 input[type=radio] 的双层结构，
 * 按卡片文本同时定位两者：断言 aria-checked 用 label，点击用 input（触发 onChange）
 */
function getMapCard(name: RegExp) {
  const matches = screen.getAllByRole('radio', { name });
  const card = matches.find((el) => el.tagName === 'LABEL');
  const input = matches.find((el) => el.tagName === 'INPUT');
  if (!card || !input) throw new Error(`地图卡片未找到: ${String(name)}`);
  return { card, input };
}

beforeEach(() => {
  vi.clearAllMocks();
  // vitest.config restoreMocks:true 会抹掉 vi.fn() 实现，每个用例前重设默认实现
  getStartupGuideMock.mockResolvedValue(GUIDE_RESPONSE);
  saveStartupConfigMock.mockResolvedValue(SAVE_RESPONSE);
});

// ===========================================================================
// 1. 渲染门控
// ===========================================================================

describe('StartupGuideWizard — 渲染门控', () => {
  it('open=false 时不渲染对话框且不拉取引导数据', () => {
    renderWizard({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getStartupGuideMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2. 初始渲染
// ===========================================================================

describe('StartupGuideWizard — 初始渲染', () => {
  it('加载完成后渲染第一步：标题/服务器名/步骤指示器/字段/必填标记/地图默认选中', async () => {
    const { container } = renderWizard();

    await waitWizardLoaded();

    expect(getStartupGuideMock).toHaveBeenCalledWith('srv-1');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('启动配置')).toBeInTheDocument();
    expect(screen.getByText('测试实例')).toBeInTheDocument();

    // 步骤指示器 + 当前步骤标题（两处出现"世界设置"：指示器 + 步骤标题）
    expect(screen.getAllByText('世界设置').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('设置世界名称与地图')).toBeInTheDocument();

    // 必填且无默认值的字段渲染必填标记
    expect(container.querySelector('.sg-required-mark')).toHaveTextContent('*');

    // 地图单选卡片组：默认选中孤岛（default: 'TheIsland'）
    const mapGroup = screen.getByRole('radiogroup', { name: '地图' });
    expect(mapGroup).toBeInTheDocument();
    expect(getMapCard(/孤岛/).card).toHaveAttribute('aria-checked', 'true');
    expect(getMapCard(/仙境/).card).toHaveAttribute('aria-checked', 'false');

    // 第一步无「上一步」，有「下一步」
    expect(screen.queryByRole('button', { name: /上一步/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeInTheDocument();
  });

  it('localStorage 草稿优先于 Pack 默认值恢复，且使必填校验通过', async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ world_name: '草稿世界' }));

    renderWizard();
    await waitWizardLoaded();

    expect((screen.getByLabelText(/世界名称/) as HTMLInputElement).value).toBe('草稿世界');
    // 草稿补齐必填项 → 「下一步」可点击
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });
});

// ===========================================================================
// 3. 校验与步骤流转
// ===========================================================================

describe('StartupGuideWizard — 校验与步骤流转', () => {
  it('必填字段未填写时「下一步」禁用（不推进），填写后放开', async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitWizardLoaded();

    // world_name 必填且无默认值 → 初始为空，步骤未完成，按钮禁用
    const nextBtn = screen.getByRole('button', { name: /下一步/ });
    expect(nextBtn).toBeDisabled();

    await user.type(screen.getByLabelText(/世界名称/), '我的世界');
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });

  it('「下一步」推进到第二步，「上一步」回退且保留已填值', async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitWizardLoaded();

    await goToStep2(user);

    // 第二步：数字字段取类型默认值 20，按钮变为「确认并启动」
    expect((screen.getByLabelText(/最大玩家数/) as HTMLInputElement).value).toBe('20');
    expect(screen.getByRole('button', { name: /上一步/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认并启动/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /下一步/ })).not.toBeInTheDocument();

    // 回退到第一步：已填世界名称保留
    await user.click(screen.getByRole('button', { name: /上一步/ }));
    expect((screen.getByLabelText(/世界名称/) as HTMLInputElement).value).toBe('我的世界');
    expect(screen.queryByRole('button', { name: /上一步/ })).not.toBeInTheDocument();
  });

  it('切换地图卡片更新选中态', async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitWizardLoaded();

    await user.click(getMapCard(/仙境/).input);

    expect(getMapCard(/仙境/).card).toHaveAttribute('aria-checked', 'true');
    expect(getMapCard(/孤岛/).card).toHaveAttribute('aria-checked', 'false');
  });
});

// ===========================================================================
// 4. 提交
// ===========================================================================

describe('StartupGuideWizard — 提交', () => {
  it('提交成功：按完整 config 调用 API、触发 onComplete、清除草稿并提示成功', async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitWizardLoaded();

    // 第一步：填世界名称 + 改选仙境
    await user.type(screen.getByLabelText(/世界名称/), '我的世界');
    await user.click(getMapCard(/仙境/).input);
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => {
      expect(screen.getByLabelText(/最大玩家数/)).toBeInTheDocument();
    });

    // 第二步：改最大玩家数 + 填密码
    const playersInput = screen.getByLabelText(/最大玩家数/);
    await user.clear(playersInput);
    await user.type(playersInput, '50');
    await user.type(screen.getByLabelText(/服务器密码/), 'secret1');

    // 交互过程中草稿已自动写入 localStorage
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /确认并启动/ }));

    await waitFor(() => {
      expect(saveStartupConfigMock).toHaveBeenCalledWith('srv-1', {
        config: {
          world_name: '我的世界',
          map: 'Ragnarok',
          max_players: 50,
          password: 'secret1',
        },
      });
    });
    await waitFor(() => {
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });
    // 成功提示（真实 ToastProvider 渲染 role="status"）
    expect(screen.getByRole('status')).toHaveTextContent('启动配置已保存');
    // 草稿已清除
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('提交失败：展示错误信息且不触发 onComplete', async () => {
    saveStartupConfigMock.mockRejectedValue(new Error('STARTUP_CONFIG_INVALID：字段值类型不符'));
    const user = userEvent.setup();
    const { container } = renderWizard();
    await waitWizardLoaded();
    await goToStep2(user);

    await user.click(screen.getByRole('button', { name: /确认并启动/ }));

    await waitFor(() => {
      expect(container.querySelector('.sg-error')).toHaveTextContent(
        'STARTUP_CONFIG_INVALID：字段值类型不符',
      );
    });
    // 同步 toast 错误提示（role="alert"）
    expect(screen.getByRole('alert')).toHaveTextContent('STARTUP_CONFIG_INVALID：字段值类型不符');
    expect(onCompleteMock).not.toHaveBeenCalled();
    // 草稿保留（用户可修正后重试）
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });
});

// ===========================================================================
// 5. 加载失败与免引导
// ===========================================================================

describe('StartupGuideWizard — 加载失败与免引导', () => {
  it('获取引导失败：展示错误与「重试」按钮，不渲染向导主体', async () => {
    getStartupGuideMock.mockRejectedValue(new Error('网络不可达'));
    renderWizard();

    await waitFor(() => {
      expect(screen.getByText('网络不可达')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /下一步/ })).not.toBeInTheDocument();
    expect(onCompleteMock).not.toHaveBeenCalled();
  });

  it('Pack 无 startup_guide 声明（guide=null）时直接触发 onComplete', async () => {
    getStartupGuideMock.mockResolvedValue({
      guide: null,
      current_config: {},
      completed: true,
    } satisfies GetStartupGuideResponse);
    renderWizard();

    await waitFor(() => {
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });
    // 不进入向导表单
    expect(screen.queryByRole('button', { name: /下一步/ })).not.toBeInTheDocument();
  });
});
