// ============================================================================
// gameItemName.ts 工具单测 — 物品名映射 + Pack API 集成
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getItemDisplayName,
  getItemDisplayNameWithPack,
  loadPackItemNames,
} from './gameItemName';

describe('getItemDisplayName', () => {
  it('空字符串返回空 zh + mapped false', () => {
    expect(getItemDisplayName('')).toEqual({ zh: '', mapped: false });
  });

  it('已知物品 diamond 返回中文', () => {
    expect(getItemDisplayName('diamond')).toEqual({ zh: '钻石', mapped: true });
  });

  it('大写字母自动转小写匹配', () => {
    expect(getItemDisplayName('DIAMOND')).toEqual({ zh: '钻石', mapped: true });
  });

  it('前后空格自动 trim', () => {
    expect(getItemDisplayName('  diamond  ')).toEqual({ zh: '钻石', mapped: true });
  });

  it('未知物品返回原名 + mapped false', () => {
    expect(getItemDisplayName('unknown_item')).toEqual({ zh: 'unknown_item', mapped: false });
  });

  it('iron_sword 返回铁剑', () => {
    expect(getItemDisplayName('iron_sword')).toEqual({ zh: '铁剑', mapped: true });
  });
});

describe('getItemDisplayNameWithPack', () => {
  it('packItemMap 包含 name 时返回 Pack 中文名', () => {
    const map = new Map([['custom_item', '自定义物品']]);
    expect(getItemDisplayNameWithPack('custom_item', map)).toEqual({
      zh: '自定义物品',
      mapped: true,
    });
  });

  it('packItemMap 不包含 name 时降级到静态表', () => {
    const map = new Map([['other', '其他']]);
    expect(getItemDisplayNameWithPack('diamond', map)).toEqual({
      zh: '钻石',
      mapped: true,
    });
  });

  it('packItemMap 为 null 时降级到静态表', () => {
    expect(getItemDisplayNameWithPack('diamond', null)).toEqual({
      zh: '钻石',
      mapped: true,
    });
  });

  it('packItemMap 不包含且静态表也不包含时返回原名', () => {
    const map = new Map();
    expect(getItemDisplayNameWithPack('unknown_item', map)).toEqual({
      zh: 'unknown_item',
      mapped: false,
    });
  });
});

describe('loadPackItemNames', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // localStorage mock
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'mock-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('成功获取 Pack items 返回 Map', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        pack_id: 'pack-1',
        items: [
          { name: 'item_a', display_name: '物品A' },
          { name: 'item_b', display_name: '物品B' },
          { name: 'item_c' }, // 无 display_name，应跳过
        ],
      }),
    });

    const map = await loadPackItemNames('pack-1');
    expect(map.size).toBe(2);
    expect(map.get('item_a')).toBe('物品A');
    expect(map.get('item_b')).toBe('物品B');
    expect(map.has('item_c')).toBe(false);
  });

  it('fetch 返回非 ok 时返回空 Map', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
    });

    const map = await loadPackItemNames('pack-1');
    expect(map.size).toBe(0);
  });

  it('fetch 抛异常时返回空 Map', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));

    const map = await loadPackItemNames('pack-1');
    expect(map.size).toBe(0);
  });

  it('请求 URL 正确编码 packId', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ pack_id: 'pack/1', items: [] }),
    });

    await loadPackItemNames('pack/1 with space');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/packs/pack%2F1%20with%20space/items',
      expect.objectContaining({ headers: { Authorization: 'Bearer mock-token' } }),
    );
  });

  it('localStorage 无 token 时不设置 Authorization 头', async () => {
    (globalThis.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ pack_id: 'pack-1', items: [] }),
    });

    await loadPackItemNames('pack-1');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/packs/pack-1/items',
      expect.objectContaining({ headers: {} }),
    );
  });

  it('localStorage 抛异常时忽略并继续请求（无 Authorization 头）', async () => {
    (globalThis.localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('localStorage not available');
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ pack_id: 'pack-1', items: [] }),
    });

    const map = await loadPackItemNames('pack-1');
    expect(map.size).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/packs/pack-1/items',
      expect.objectContaining({ headers: {} }),
    );
  });
});
