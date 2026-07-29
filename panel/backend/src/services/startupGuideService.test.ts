// ============================================================================
// startupGuideService.test.ts — 启动前置引导工具函数单元测试
// 覆盖：validateStartupGuide / renderStartupArgs / validateStartupConfig / mergeWithDefaults
// 来源：docs/plans/instance-startup-guide-and-action-bar-plan.md §3.4
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  validateStartupGuide,
  renderStartupArgs,
  validateStartupConfig,
  mergeWithDefaults,
  type StartupConfig,
} from './startupGuideService.js';
import type { StartupGuide, StartupGuideField } from '@public/schema/pack-schema.js';

// ----- fixtures -----
function makeField(over: Partial<StartupGuideField>): StartupGuideField {
  return {
    key: 'f',
    type: 'world_name',
    label: '字段',
    required: false,
    ...over,
  };
}

const guide: StartupGuide = {
  enabled: true,
  steps: [
    {
      key: 'map-selection',
      title: '地图选择',
      optional: false,
      fields: [
        makeField({
          key: 'map',
          type: 'map',
          label: '地图',
          required: true,
          options: [
            { value: 'TheIsland', display_name: '孤岛' },
            { value: 'ScorchedEarth', display_name: '焦土' },
          ],
        }),
      ],
    },
    {
      key: 'world-setup',
      title: '世界设置',
      optional: true,
      fields: [
        makeField({ key: 'seed', type: 'seed', label: '种子', required: true }),
      ],
    },
    {
      key: 'basic-config',
      title: '基础配置',
      optional: false,
      fields: [
        makeField({
          key: 'max_players',
          type: 'max_players',
          label: '最大玩家数',
          required: true,
          default: 20,
          min: 1,
          max: 100,
        }),
        makeField({
          key: 'difficulty',
          type: 'difficulty',
          label: '难度',
          required: true,
          enum_values: ['easy', 'normal', 'hard'],
        }),
      ],
    },
  ],
  args_mapping: { map: '{{map}}', server_name: '{{server_name}}' },
};

// ============================================================================
// validateStartupGuide
// ============================================================================
describe('validateStartupGuide', () => {
  it('空 config → required 无 default 的字段缺失（optional 步骤跳过）', () => {
    const r = validateStartupGuide(guide, {});
    expect(r.completed).toBe(false);
    // map（required, 无 default）缺失；max_players 有 default 不缺失；difficulty（required, 无 default）缺失
    expect(r.missingFields).toEqual(expect.arrayContaining(['map', 'difficulty']));
    expect(r.missingFields).not.toContain('max_players');
    expect(r.missingSteps).toEqual(
      expect.arrayContaining(['map-selection', 'basic-config']),
    );
  });

  it('required + default 字段不视为缺失', () => {
    const r = validateStartupGuide(guide, { map: 'TheIsland', difficulty: 'easy' });
    expect(r.completed).toBe(true);
    expect(r.missingFields).toEqual([]);
  });

  it('optional 步骤的 required 字段不参与校验', () => {
    // seed 在 optional 步骤，不填也应 completed
    const r = validateStartupGuide(guide, { map: 'TheIsland', difficulty: 'easy' });
    expect(r.missingFields).not.toContain('seed');
    expect(r.completed).toBe(true);
  });

  it('部分缺失 → completed=false 且只列缺失项', () => {
    const r = validateStartupGuide(guide, { map: 'TheIsland' });
    expect(r.completed).toBe(false);
    expect(r.missingFields).toEqual(['difficulty']);
    expect(r.missingSteps).toEqual(['basic-config']);
  });
});

// ============================================================================
// renderStartupArgs
// ============================================================================
describe('renderStartupArgs', () => {
  it('无 argsMapping → 原样返回', () => {
    const args = ['TheIsland', '?listen'];
    expect(renderStartupArgs(args, { map: 'X' })).toEqual(args);
  });

  it('整体占位 {{map}} → 用 config[map] 替换', () => {
    const args = ['{{map}}', '?listen'];
    const out = renderStartupArgs(args, { map: 'ScorchedEarth' }, guide.args_mapping);
    expect(out[0]).toBe('ScorchedEarth');
    expect(out[1]).toBe('?listen');
  });

  it('嵌入占位 ServerName={{server_name}} → 局部替换', () => {
    const args = ['ServerName={{server_name}}?MaxPlayers=70'];
    const out = renderStartupArgs(
      args,
      { server_name: 'MyServer' },
      guide.args_mapping,
    );
    expect(out[0]).toBe('ServerName=MyServer?MaxPlayers=70');
  });

  it('config 无该字段 → 保留原占位符', () => {
    const args = ['{{map}}', '{{unknown}}'];
    const out = renderStartupArgs(args, {}, guide.args_mapping);
    expect(out[0]).toBe('{{map}}');
    expect(out[1]).toBe('{{unknown}}');
  });

  it('number 值 → 转为字符串替换', () => {
    const args = ['-maxplayers={{max_players}}'];
    const out = renderStartupArgs(
      args,
      { max_players: 70 },
      { max_players: '{{max_players}}' },
    );
    expect(out[0]).toBe('-maxplayers=70');
  });
});

// ============================================================================
// validateStartupConfig
// ============================================================================
describe('validateStartupConfig', () => {
  it('未知字段 → 错误', () => {
    const r = validateStartupConfig(guide, { unknown_field: 'x' } as StartupConfig);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'unknown_field')).toBe(true);
  });

  it('数字字段非数字 → 错误', () => {
    const r = validateStartupConfig(guide, { max_players: 'abc' } as StartupConfig);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'max_players')).toBe(true);
  });

  it('数字字段超范围 → 错误', () => {
    const r1 = validateStartupConfig(guide, { max_players: 0 });
    expect(r1.errors.some((e) => e.message.includes('不能小于'))).toBe(true);
    const r2 = validateStartupConfig(guide, { max_players: 200 });
    expect(r2.errors.some((e) => e.message.includes('不能大于'))).toBe(true);
  });

  it('enum 字段值不在枚举 → 错误', () => {
    const r = validateStartupConfig(guide, { difficulty: 'insane' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'difficulty')).toBe(true);
  });

  it('map 字段值不在 options → 错误', () => {
    const r = validateStartupConfig(guide, { map: 'NonExistentMap' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'map')).toBe(true);
  });

  it('全部字段合法 → valid=true', () => {
    const r = validateStartupConfig(guide, {
      map: 'TheIsland',
      max_players: 70,
      difficulty: 'hard',
      seed: 'abc',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

// ============================================================================
// mergeWithDefaults
// ============================================================================
describe('mergeWithDefaults', () => {
  it('config 显式值优先于 default', () => {
    const merged = mergeWithDefaults(guide, { max_players: 50 });
    expect(merged.max_players).toBe(50);
  });

  it('config 无值但有 default → 用 default 填充', () => {
    const merged = mergeWithDefaults(guide, {});
    expect(merged.max_players).toBe(20);
  });

  it('无 default 且未填写 → 不出现在结果中', () => {
    const merged = mergeWithDefaults(guide, {});
    expect('map' in merged).toBe(false);
    expect('difficulty' in merged).toBe(false);
  });
});
