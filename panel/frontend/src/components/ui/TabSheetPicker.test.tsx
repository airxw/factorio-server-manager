// ============================================================================
// TabSheetPicker 组件单测 — v4.38.0 W8 移动端 Tab 选择器
// 覆盖：触发器渲染 / 展开 sheet / 分组渲染 / 选中回调 / business 跳转 /
//       遮罩关闭 / ESC 关闭 / 空列表 / 键盘导航 / keep-alive 行为（activatedTabs 由父管理）
// ============================================================================

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TabSheetPicker, { type TabSheetPickerGroup } from './TabSheetPicker';

const GROUP_LABELS: Record<string, string> = {
  runtime: '运行时',
  config: '配置',
  ops: '运维',
  business: '业务运营',
};

const TAB_LABELS: Record<string, string> = {
  console: '控制台',
  'log-files': '日志文件',
  'config-files': '配置文件',
  saves: '存档管理',
  mods: 'Mod 管理',
  __business__: '业务运营',
};

const GROUPED: TabSheetPickerGroup[] = [
  {
    group: 'runtime',
    tabs: [
      { tab: 'console', order: 10 },
      { tab: 'log-files', order: 20 },
    ],
  },
  {
    group: 'config',
    tabs: [{ tab: 'config-files', order: 30 }],
  },
  {
    group: 'ops',
    tabs: [
      { tab: 'saves', order: 40 },
      { tab: 'mods', order: 50 },
      { tab: '__business__', order: 1000 },
    ],
  },
];

const getTabLabel = (key: string) => TAB_LABELS[key] ?? key;

function renderPicker(overrides: Partial<React.ComponentProps<typeof TabSheetPicker>> = {}) {
  const onSelectTab = vi.fn();
  const onSelectBusiness = vi.fn();
  const props: React.ComponentProps<typeof TabSheetPicker> = {
    activeTab: 'console',
    groupedTabs: GROUPED,
    groupLabels: GROUP_LABELS,
    getTabLabel,
    onSelectTab,
    onSelectBusiness,
    ...overrides,
  };
  const result = render(<TabSheetPicker {...props} />);
  return { ...result, onSelectTab, onSelectBusiness };
}

describe('TabSheetPicker', () => {
  it('默认渲染触发器，显示当前 tab 名与总项数，sheet 未展开', () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: /控制台/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // 总项数 = 6
    expect(screen.getByText('6 项')).toBeInTheDocument();
    // sheet 未渲染
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('点击触发器展开 sheet，按分组渲染所有 tab', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /控制台/ }));
    const sheet = screen.getByRole('dialog');
    expect(sheet).toBeInTheDocument();
    // 分组标题
    expect(screen.getByText('运行时')).toBeInTheDocument();
    expect(screen.getByText('配置')).toBeInTheDocument();
    expect(screen.getByText('运维')).toBeInTheDocument();
    // 分组计数
    expect(screen.getAllByText('2')[0]).toBeInTheDocument(); // runtime 2 项
    // tab 项
    expect(screen.getByRole('tab', { name: /控制台/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /日志文件/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /配置文件/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /存档管理/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Mod 管理/ })).toBeInTheDocument();
  });

  it('当前 active tab 在 sheet 中标记 aria-selected=true 与 active 类', () => {
    renderPicker({ activeTab: 'saves' });
    fireEvent.click(screen.getByRole('button', { name: /存档管理/ }));
    const activeTab = screen.getByRole('tab', { name: /存档管理/ });
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
    expect(activeTab).toHaveClass('active');
    // 其他 tab 不高亮
    const otherTab = screen.getByRole('tab', { name: /控制台/ });
    expect(otherTab).toHaveAttribute('aria-selected', 'false');
    expect(otherTab).not.toHaveClass('active');
  });

  it('点击普通 tab 触发 onSelectTab 并关闭 sheet', () => {
    const { onSelectTab } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /控制台/ }));
    fireEvent.click(screen.getByRole('tab', { name: /配置文件/ }));
    expect(onSelectTab).toHaveBeenCalledWith('config-files');
    expect(onSelectTab).toHaveBeenCalledTimes(1);
    // sheet 关闭
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('点击 business pseudo-tab 触发 onSelectBusiness（不触发 onSelectTab）并关闭 sheet', () => {
    const { onSelectTab, onSelectBusiness } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /控制台/ }));
    fireEvent.click(screen.getByRole('tab', { name: /业务运营/ }));
    expect(onSelectBusiness).toHaveBeenCalledOnce();
    expect(onSelectTab).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('点击遮罩关闭 sheet', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /控制台/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // 遮罩是 dialog 的兄弟元素，aria-hidden=true
    const overlay = document.querySelector('.tab-sheet-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ESC 键关闭 sheet', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /控制台/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('空分组列表渲染空态文案，不崩溃', () => {
    renderPicker({ groupedTabs: [] });
    // 触发器仍渲染，项数为空字符串（totalTabs=0 时不显示「项」）
    const trigger = screen.getByRole('button');
    expect(trigger).toBeInTheDocument();
    // 触发器内不含「N 项」
    expect(screen.queryByText(/项/)).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByText('暂无可用标签页')).toBeInTheDocument();
  });

  it('触发器 ArrowDown 键展开 sheet', () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: /控制台/ });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('sheet 内 ArrowRight 循环切换到下一个 tab（末尾回首个）', () => {
    // activeTab=mods（ops 组最后一项，但业务 pseudo-tab 在其后）
    // 全部 tab 顺序：console, log-files, config-files, saves, mods, __business__
    const { onSelectTab, onSelectBusiness } = renderPicker({ activeTab: 'mods' });
    fireEvent.click(screen.getByRole('button', { name: /Mod 管理/ }));
    const sheet = screen.getByRole('dialog');
    fireEvent.keyDown(sheet, { key: 'ArrowRight' });
    // 末尾 __business__ → onSelectBusiness
    expect(onSelectBusiness).toHaveBeenCalledOnce();
    expect(onSelectTab).not.toHaveBeenCalled();
    // onSelectBusiness 已调用，sheet 关闭
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sheet 内 ArrowLeft 从首个回退到末项（循环）', () => {
    // activeTab=console（首个），ArrowLeft → 末项 __business__
    const { onSelectBusiness } = renderPicker({ activeTab: 'console' });
    fireEvent.click(screen.getByRole('button', { name: /控制台/ }));
    const sheet = screen.getByRole('dialog');
    fireEvent.keyDown(sheet, { key: 'ArrowLeft' });
    expect(onSelectBusiness).toHaveBeenCalledOnce();
  });

  it('keep-alive 场景：选中已激活过的 tab 仍正常触发回调（activatedTabs 由父管理，组件无状态依赖）', () => {
    // 模拟父组件 keep-alive：第一次选 log-files，第二次再选 console
    // 组件本身不持有 activatedTabs，只要 onSelectTab 被正确调用即可
    const { onSelectTab, rerender } = renderPicker({ activeTab: 'log-files' });
    fireEvent.click(screen.getByRole('button', { name: /日志文件/ }));
    // 切换到 console（模拟父组件已激活过 console，从 log-files 切回）
    fireEvent.click(screen.getByRole('tab', { name: /控制台/ }));
    expect(onSelectTab).toHaveBeenCalledWith('console');
    expect(onSelectTab).toHaveBeenCalledTimes(1);
    // rerender 模拟父组件状态更新后 props 变化
    rerender(
      <TabSheetPicker
        activeTab="console"
        groupedTabs={GROUPED}
        groupLabels={GROUP_LABELS}
        getTabLabel={getTabLabel}
        onSelectTab={onSelectTab}
      />,
    );
    // 触发器显示更新后的 active tab 名
    expect(screen.getByRole('button', { name: /控制台/ })).toBeInTheDocument();
  });
});
