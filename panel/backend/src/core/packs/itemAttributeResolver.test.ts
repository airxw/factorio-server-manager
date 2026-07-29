// ============================================================================
// itemAttributeResolver.test.ts — 物品特殊属性自适应解析器单元测试
// 步骤 11: 覆盖版本约束解析 / 属性降级 / 命令模板预处理 / give_command vars 生成
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  matchesVersionConstraint,
  resolveAttributes,
  resolveGiveCommandVars,
  stripHiddenPlaceholders,
  hasSpecialAttributes,
  needsAttributeResolution,
} from './itemAttributeResolver.js';
import type { GamePack, PackItemSpecialAttribute } from '@public/schema/pack-schema';

// ----- 测试用 Pack 构造工具 -----

/** 构造带 special_attributes 的 GamePack(仅含必要字段) */
function makePack(attrs: PackItemSpecialAttribute[]): GamePack {
  return {
    pack: { id: 'test-pack', game: 'factorio', variant: 'vanilla', display_name: 'Test', version: '1.0' },
    startup: {
      binary: './server',
      args: [],
      working_dir: '.',
      ready_pattern: 'ready',
      stop_command: 'stop',
      stop_timeout: 30,
    },
    protocol: { type: 'rcon', default_port: 25575, auth: 'password', encrypt: 'none' },
    commands: {},
    versions: { source: 'test', type: 'binary', eula_required: false },
    backup: { world_dir: '.', pre_backup_commands: [], post_backup_commands: [] },
    ui: { tabs: [] },
    items: {
      source: { type: 'static', sync_interval_hours: 24 },
      qualities: [],
      quality_tiers: 0,
      categories: [],
      special_attributes: attrs,
    },
  };
}

const qualityAttr: PackItemSpecialAttribute = {
  name: 'quality',
  display_name: '品质',
  applicable_versions: '>=2.0.0',
  default_value: 'normal',
  fallback_behavior: 'default',
  values: ['normal', 'uncommon', 'rare', 'epic', 'legendary'],
  description: 'Factorio 2.0+ 支持 5 档品质',
  command_template_key: '{{quality}}',
};

const enchantAttr: PackItemSpecialAttribute = {
  name: 'enchantment',
  display_name: '附魔',
  applicable_versions: undefined, // 全版本适用
  default_value: 'none',
  fallback_behavior: 'hide',
  values: ['sharpness', 'protection'],
  command_template_key: '{{enchantment}}',
};

const disableAttr: PackItemSpecialAttribute = {
  name: 'skin',
  display_name: '皮肤',
  applicable_versions: '<1.0.0',
  default_value: undefined,
  fallback_behavior: 'disable',
  command_template_key: '{{skin}}',
};

// ----- matchesVersionConstraint -----

describe('matchesVersionConstraint', () => {
  describe('空约束', () => {
    it('undefined 视为全版本适用', () => {
      expect(matchesVersionConstraint('1.0.0', undefined)).toBe(true);
      expect(matchesVersionConstraint('99.99.99', undefined)).toBe(true);
    });

    it('空字符串视为全版本适用', () => {
      expect(matchesVersionConstraint('1.0.0', '')).toBe(true);
      expect(matchesVersionConstraint('1.0.0', '   ')).toBe(true);
    });
  });

  describe('简单比较', () => {
    it('>=2.0.0 约束', () => {
      expect(matchesVersionConstraint('2.0.0', '>=2.0.0')).toBe(true);
      expect(matchesVersionConstraint('2.0.77', '>=2.0.0')).toBe(true);
      expect(matchesVersionConstraint('3.0.0', '>=2.0.0')).toBe(true);
      expect(matchesVersionConstraint('1.9.99', '>=2.0.0')).toBe(false);
    });

    it('<3.0.0 约束', () => {
      expect(matchesVersionConstraint('2.99.99', '<3.0.0')).toBe(true);
      expect(matchesVersionConstraint('3.0.0', '<3.0.0')).toBe(false);
    });

    it('=1.20.4 约束', () => {
      expect(matchesVersionConstraint('1.20.4', '=1.20.4')).toBe(true);
      expect(matchesVersionConstraint('1.20.5', '=1.20.4')).toBe(false);
    });

    it('无操作符视为 =', () => {
      expect(matchesVersionConstraint('1.0.0', '1.0.0')).toBe(true);
      expect(matchesVersionConstraint('1.0.1', '1.0.0')).toBe(false);
    });
  });

  describe('多约束(逗号分隔)', () => {
    it('>=1.20,<1.21 范围', () => {
      expect(matchesVersionConstraint('1.20.0', '>=1.20,<1.21')).toBe(true);
      expect(matchesVersionConstraint('1.20.4', '>=1.20,<1.21')).toBe(true);
      expect(matchesVersionConstraint('1.21.0', '>=1.20,<1.21')).toBe(false);
      expect(matchesVersionConstraint('1.19.99', '>=1.20,<1.21')).toBe(false);
    });
  });

  describe('通配符', () => {
    it('1.x 匹配 1.x.x', () => {
      expect(matchesVersionConstraint('1.0.0', '1.x')).toBe(true);
      expect(matchesVersionConstraint('1.99.99', '1.x')).toBe(true);
      expect(matchesVersionConstraint('2.0.0', '1.x')).toBe(false);
    });

    it('2.0.x 匹配 2.0.x', () => {
      expect(matchesVersionConstraint('2.0.0', '2.0.x')).toBe(true);
      expect(matchesVersionConstraint('2.0.77', '2.0.x')).toBe(true);
      expect(matchesVersionConstraint('2.1.0', '2.0.x')).toBe(false);
    });
  });
});

// ----- resolveAttributes -----

describe('resolveAttributes', () => {
  it('无 special_attributes 返回空数组', () => {
    const pack = makePack([]);
    expect(resolveAttributes(pack, '2.0.0')).toEqual([]);
  });

  it('版本匹配时 applicable=true / exposed=true', () => {
    const pack = makePack([qualityAttr]);
    const result = resolveAttributes(pack, '2.0.77');
    expect(result).toHaveLength(1);
    expect(result[0].applicable).toBe(true);
    expect(result[0].exposed).toBe(true);
  });

  it('版本不匹配时 applicable=false / exposed=false', () => {
    const pack = makePack([qualityAttr]);
    const result = resolveAttributes(pack, '1.1.109');
    expect(result[0].applicable).toBe(false);
    expect(result[0].exposed).toBe(false);
  });

  it('未声明 applicable_versions 视为全版本适用', () => {
    const pack = makePack([enchantAttr]);
    const r1 = resolveAttributes(pack, '1.0.0');
    const r2 = resolveAttributes(pack, '99.99.99');
    expect(r1[0].applicable).toBe(true);
    expect(r2[0].applicable).toBe(true);
  });
});

// ----- resolveGiveCommandVars -----

describe('resolveGiveCommandVars', () => {
  it('无 special_attributes 返回 dispatchable=true / 空 vars', () => {
    const pack = makePack([]);
    const result = resolveGiveCommandVars(pack, '2.0.0', {});
    expect(result.dispatchable).toBe(true);
    expect(result.vars).toEqual({});
    expect(result.placeholders_to_remove).toEqual([]);
  });

  describe('fallback=default', () => {
    it('版本不匹配时用 default_value 填充 vars', () => {
      const pack = makePack([qualityAttr]);
      const result = resolveGiveCommandVars(pack, '1.1.109', {});
      expect(result.dispatchable).toBe(true);
      expect(result.vars.quality).toBe('normal');
      expect(result.placeholders_to_remove).toEqual([]);
    });

    it('版本匹配时优先用用户输入', () => {
      const pack = makePack([qualityAttr]);
      const result = resolveGiveCommandVars(pack, '2.0.77', { quality: 'rare' });
      expect(result.vars.quality).toBe('rare');
    });

    it('版本匹配且用户未输入时用 values[0]', () => {
      const pack = makePack([qualityAttr]);
      const result = resolveGiveCommandVars(pack, '2.0.77', {});
      expect(result.vars.quality).toBe('normal'); // values[0] = normal
    });
  });

  describe('fallback=hide', () => {
    it('版本不匹配时加入 placeholders_to_remove', () => {
      // enchantAttr 全版本适用,这里改一下约束
      const hideAttr: PackItemSpecialAttribute = {
        ...enchantAttr,
        applicable_versions: '>=2.0.0',
        fallback_behavior: 'hide',
      };
      const pack = makePack([hideAttr]);
      const result = resolveGiveCommandVars(pack, '1.1.109', {});
      expect(result.dispatchable).toBe(true);
      expect(result.placeholders_to_remove).toContain('{{enchantment}}');
      expect(result.vars.enchantment).toBeUndefined();
    });
  });

  describe('fallback=disable', () => {
    it('版本不匹配时 dispatchable=false', () => {
      const pack = makePack([disableAttr]);
      const result = resolveGiveCommandVars(pack, '2.0.0', {});
      expect(result.dispatchable).toBe(false);
      // skin 在 >=1.0.0 时不适用(<1.0.0 约束)
    });

    it('版本匹配时正常处理', () => {
      const pack = makePack([disableAttr]);
      const result = resolveGiveCommandVars(pack, '0.9.0', {});
      expect(result.dispatchable).toBe(true);
    });
  });

  it('多个属性混合处理', () => {
    // qualityAttr: >=2.0.0 适用(2.0.77 匹配)
    // enchantAttr: 全版本适用
    // disableAttr: <1.0.0 适用(2.0.77 不匹配 → fallback=disable → dispatchable=false)
    const pack = makePack([qualityAttr, enchantAttr, disableAttr]);
    const result = resolveGiveCommandVars(pack, '2.0.77', { quality: 'epic' });
    // disableAttr 版本不匹配 → dispatchable=false
    expect(result.dispatchable).toBe(false);
    expect(result.vars.quality).toBe('epic');
    expect(result.vars.enchantment).toBeDefined(); // enchantAttr 全版本适用
  });

  it('多个属性全部版本匹配时 dispatchable=true', () => {
    // 用 0.9.0 版本:disableAttr(<1.0.0)匹配,qualityAttr(>=2.0.0)不匹配→fallback=default
    const pack = makePack([qualityAttr, enchantAttr, disableAttr]);
    const result = resolveGiveCommandVars(pack, '0.9.0', {});
    expect(result.dispatchable).toBe(true);
    expect(result.vars.quality).toBe('normal'); // fallback=default
    expect(result.vars.enchantment).toBeDefined();
  });
});

// ----- stripHiddenPlaceholders -----

describe('stripHiddenPlaceholders', () => {
  it('空列表原样返回', () => {
    expect(stripHiddenPlaceholders('give Steve diamond 1', [])).toBe('give Steve diamond 1');
  });

  it('移除单个占位符', () => {
    const template = "give Steve diamond 1 {{enchantment}}";
    const result = stripHiddenPlaceholders(template, ['{{enchantment}}']);
    expect(result).toBe('give Steve diamond 1');
  });

  it('移除多个占位符', () => {
    const template = "{{enchantment}} {{skin}} give Steve diamond 1";
    const result = stripHiddenPlaceholders(template, ['{{enchantment}}', '{{skin}}']);
    expect(result).toBe('give Steve diamond 1');
  });

  it('清理多余空格', () => {
    const template = "give  Steve  {{quality}}  1";
    const result = stripHiddenPlaceholders(template, ['{{quality}}']);
    expect(result).toBe('give Steve 1');
  });

  it('占位符两侧有空白时一并移除', () => {
    const template = "give Steve  {{ quality }}  1";
    // 注意:stripHiddenPlaceholders 接收的占位符字符串需匹配模板中的实际形式
    // {{ quality }} 含空格,而 command_template_key 通常是 {{quality}}(无空格)
    // 此测试验证占位符两侧的空白被一并清理
    const result = stripHiddenPlaceholders(template, ['{{ quality }}']);
    expect(result).toBe('give Steve 1');
  });
});

// ----- hasSpecialAttributes / needsAttributeResolution -----

describe('hasSpecialAttributes', () => {
  it('有 special_attributes 返回 true', () => {
    const pack = makePack([qualityAttr]);
    expect(hasSpecialAttributes(pack)).toBe(true);
  });

  it('无 special_attributes 返回 false', () => {
    const pack = makePack([]);
    expect(hasSpecialAttributes(pack)).toBe(false);
  });
});

describe('needsAttributeResolution', () => {
  it('无 special_attributes 返回 false', () => {
    const pack = makePack([]);
    expect(needsAttributeResolution(pack, '2.0.0')).toBe(false);
  });

  it('所有属性都版本匹配时返回 false(无需自适应)', () => {
    const pack = makePack([qualityAttr]);
    expect(needsAttributeResolution(pack, '2.0.77')).toBe(false);
  });

  it('任一属性版本不匹配时返回 true(需自适应)', () => {
    const pack = makePack([qualityAttr]);
    expect(needsAttributeResolution(pack, '1.1.109')).toBe(true);
  });
});
