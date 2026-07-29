// ============================================================================
// commandDispatcher.test.ts — 命令模板渲染单元测试
// 步骤 11: 覆盖变量校验 / 防注入 / 残留占位符检测 / 各 Pack 命令模板渲染
// ============================================================================

import { describe, it, expect } from 'vitest';
import { CommandDispatcherImpl, VARIABLE_PATTERNS, sanitizeTemplateVar } from './commandDispatcher.js';
import { CommandRenderError } from './errors.js';
import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';

// ----- Mock 依赖 -----

const mockDb = {} as Knex;
const mockDaemonClient = {} as DaemonClient;
const dispatcher = new CommandDispatcherImpl(mockDb, mockDaemonClient);

// ----- renderCommand(纯函数,不依赖 DB/daemon) -----

describe('renderCommand — 基础渲染', () => {
  it('无占位符原样返回', () => {
    expect(dispatcher.renderCommand('say hello', {})).toBe('say hello');
  });

  it('单变量渲染', () => {
    const result = dispatcher.renderCommand('give {{player}} diamond 1', { player: 'Steve' });
    expect(result).toBe('give Steve diamond 1');
  });

  it('多变量渲染', () => {
    const result = dispatcher.renderCommand('give {{player}} {{item}} {{count}}', {
      player: 'Steve',
      item: 'diamond_pickaxe',
      count: '1',
    });
    expect(result).toBe('give Steve diamond_pickaxe 1');
  });

  it('变量名两侧允许空白', () => {
    const result = dispatcher.renderCommand('give {{ player }} {{item}} {{count}}', {
      player: 'Steve',
      item: 'diamond',
      count: '1',
    });
    expect(result).toBe('give Steve diamond 1');
  });
});

// ----- 防注入校验 -----

describe('renderCommand — 防注入校验', () => {
  it('未知变量名抛 CommandRenderError', () => {
    expect(() => dispatcher.renderCommand('give {{unknown_var}} 1', {})).toThrow(CommandRenderError);
    expect(() => dispatcher.renderCommand('give {{unknown_var}} 1', {})).toThrow(/未知变量/);
  });

  it('变量未提供值抛 CommandRenderError', () => {
    expect(() => dispatcher.renderCommand('give {{player}} 1', {})).toThrow(CommandRenderError);
    expect(() => dispatcher.renderCommand('give {{player}} 1', {})).toThrow(/未提供值/);
  });

  it('player 变量值含非法字符抛错', () => {
    expect(() =>
      dispatcher.renderCommand('give {{player}} 1', { player: 'Steve;rm -rf /' }),
    ).toThrow(CommandRenderError);
  });

  it('count 变量值必须为正整数', () => {
    expect(() =>
      dispatcher.renderCommand('give Steve {{count}}', { count: '0' }),
    ).toThrow(CommandRenderError);
    expect(() =>
      dispatcher.renderCommand('give Steve {{count}}', { count: '-1' }),
    ).toThrow(CommandRenderError);
    expect(() =>
      dispatcher.renderCommand('give Steve {{count}}', { count: 'abc' }),
    ).toThrow(CommandRenderError);
  });

  it('count 接受 1-999999 范围', () => {
    expect(dispatcher.renderCommand('give Steve {{count}}', { count: '1' })).toBe('give Steve 1');
    expect(dispatcher.renderCommand('give Steve {{count}}', { count: '999999' })).toBe('give Steve 999999');
  });

  it('item 变量允许点号(Rust shortname)', () => {
    const result = dispatcher.renderCommand('give Steve {{item}} 1', { item: 'metal.fragments' });
    expect(result).toBe('give Steve metal.fragments 1');
  });

  it('v4.12.0: item 变量允许空格(TShock 物品名)', () => {
    const result = dispatcher.renderCommand('give {{player}} {{item}} {{count}}', {
      player: 'Steve',
      item: 'Copper Broadsword',
      count: '1',
    });
    expect(result).toBe('give Steve Copper Broadsword 1');
  });

  it('quality 变量仅接受枚举值', () => {
    for (const q of ['normal', 'uncommon', 'rare', 'epic', 'legendary']) {
      expect(dispatcher.renderCommand('set {{quality}}', { quality: q })).toBe(`set ${q}`);
    }
    expect(() => dispatcher.renderCommand('set {{quality}}', { quality: 'god' })).toThrow(CommandRenderError);
  });

  it('message 变量允许空格(单行文本)', () => {
    const result = dispatcher.renderCommand('say {{message}}', { message: 'Hello World!' });
    expect(result).toBe('say Hello World!');
  });

  it('message 变量拒绝换行符', () => {
    expect(() =>
      dispatcher.renderCommand('say {{message}}', { message: 'line1\nline2' }),
    ).toThrow(CommandRenderError);
  });
});

// ----- 残留占位符检测(步骤6 新增) -----

describe('renderCommand — 残留占位符检测', () => {
  it('渲染后残留 {{xxx}} 抛 CommandRenderError', () => {
    // {{unknown}} 不在 VARIABLE_PATTERNS 中 → 第一次 replace 时抛"未知变量"
    // 但如果模板用了未知变量且未触发抛错路径(理论上不会),残留检测兜底
    // 这里用合法变量但模板含未声明的占位符形式来测试
    expect(() =>
      dispatcher.renderCommand('give {{player}} {{unknown_var}}', { player: 'Steve' }),
    ).toThrow(CommandRenderError);
  });
});

// ----- sanitizeTemplateVar -----

describe('sanitizeTemplateVar', () => {
  it('移除 shell 元字符', () => {
    expect(sanitizeTemplateVar('hello;rm -rf /')).toBe('hellorm -rf /');
    expect(sanitizeTemplateVar('test`whoami`')).toBe('testwhoami');
    expect(sanitizeTemplateVar('a|b&c')).toBe('abc');
    expect(sanitizeTemplateVar('redirect>file')).toBe('redirectfile');
    expect(sanitizeTemplateVar('sub(shell)')).toBe('subshell');
  });

  it('保留字母数字空格点号短横线', () => {
    expect(sanitizeTemplateVar('Copper Broadsword')).toBe('Copper Broadsword');
    expect(sanitizeTemplateVar('metal.fragments')).toBe('metal.fragments');
    expect(sanitizeTemplateVar('diamond_pickaxe')).toBe('diamond_pickaxe');
  });

  it('移除换行和回车', () => {
    expect(sanitizeTemplateVar('line1\nline2')).toBe('line1line2');
    expect(sanitizeTemplateVar('line1\rline2')).toBe('line1line2');
  });

  it('非字符串输入返回空字符串', () => {
    expect(sanitizeTemplateVar(null as unknown as string)).toBe('');
    expect(sanitizeTemplateVar(undefined as unknown as string)).toBe('');
    expect(sanitizeTemplateVar(123 as unknown as string)).toBe('');
  });
});

// ----- VARIABLE_PATTERNS 导出验证 -----

describe('VARIABLE_PATTERNS', () => {
  it('包含 player/item/count/message/quality/reason/json 变量', () => {
    expect(VARIABLE_PATTERNS.player).toBeDefined();
    expect(VARIABLE_PATTERNS.item).toBeDefined();
    expect(VARIABLE_PATTERNS.count).toBeDefined();
    expect(VARIABLE_PATTERNS.message).toBeDefined();
    expect(VARIABLE_PATTERNS.quality).toBeDefined();
    expect(VARIABLE_PATTERNS.reason).toBeDefined();
    expect(VARIABLE_PATTERNS.json).toBeDefined();
  });

  it('item pattern 允许空格(v4.12.0)', () => {
    expect(VARIABLE_PATTERNS.item.test('Copper Broadsword')).toBe(true);
    expect(VARIABLE_PATTERNS.item.test('metal.fragments')).toBe(true);
    expect(VARIABLE_PATTERNS.item.test('diamond_pickaxe')).toBe(true);
    // 拒绝 shell 元字符
    expect(VARIABLE_PATTERNS.item.test('item;rm')).toBe(false);
    expect(VARIABLE_PATTERNS.item.test('item|cat')).toBe(false);
  });
});

// ----- 各 Pack 命令模板渲染验证(步骤6 集成) -----

describe('renderCommand — Pack 命令模板渲染验证', () => {
  // Minecraft
  it('Minecraft give 命令', () => {
    const result = dispatcher.renderCommand('give {{player}} {{item}} {{count}}', {
      player: 'Steve',
      item: 'diamond_pickaxe',
      count: '1',
    });
    expect(result).toBe('give Steve diamond_pickaxe 1');
  });

  it('Minecraft broadcast 命令', () => {
    const result = dispatcher.renderCommand('say {{message}}', {
      message: 'Server restarting in 5 minutes',
    });
    expect(result).toBe('say Server restarting in 5 minutes');
  });

  // Terraria TShock
  it('TShock give 命令(物品名含空格)', () => {
    const result = dispatcher.renderCommand('give {{player}} {{item}} {{count}}', {
      player: 'Steve',
      item: 'Copper Broadsword',
      count: '1',
    });
    expect(result).toBe('give Steve Copper Broadsword 1');
  });

  // Rust
  it('Rust give 命令(物品 shortname 含点号)', () => {
    const result = dispatcher.renderCommand('give {{player}} {{item}} {{count}}', {
      player: 'Steve',
      item: 'metal.fragments',
      count: '100',
    });
    expect(result).toBe('give Steve metal.fragments 100');
  });

  // Factorio
  it('Factorio 命令(含 quality 变量)', () => {
    const result = dispatcher.renderCommand('/c game.player.insert{name="{{item}}", count={{count}}, quality="{{quality}}"}', {
      item: 'iron-plate',
      count: '50',
      quality: 'rare',
    });
    expect(result).toBe('/c game.player.insert{name="iron-plate", count=50, quality="rare"}');
  });

  // Palworld(不支持 give_item,仅测试 broadcast)
  it('Palworld broadcast 命令', () => {
    const result = dispatcher.renderCommand('Broadcast {{message}}', {
      message: 'Welcome to the server',
    });
    expect(result).toBe('Broadcast Welcome to the server');
  });

  // Valheim spawn 命令
  it('Valheim spawn 命令', () => {
    const result = dispatcher.renderCommand('spawn {{item}} {{count}}', {
      item: 'Wood',
      count: '10',
    });
    expect(result).toBe('spawn Wood 10');
  });
});
