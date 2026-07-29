/**
 * 商城物品名中英文映射表
 *
 * - 后端返回的 `item_name` 通常是 Minecraft 风格的英文 ID（如 `diamond` / `iron_sword`）
 * - 前端展示时使用本表翻译为中文，格式：中文 (英文原名)
 * - 未在表中的物品名原样显示英文，并加上灰色提示（由调用方根据返回值 `mapped` 自行处理）
 *
 * 使用示例：
 *   const { zh, mapped } = getItemDisplayName(it.item_name);
 *   // 显示：钻石 (diamond)   或   some_unknown_id (灰色提示)
 */

const ITEM_NAME_ZH: Record<string, string> = {
  // ─── 通用物品 / 矿物 ─────────────────────────────────────────
  diamond: '钻石',
  iron_ingot: '铁锭',
  gold_ingot: '金锭',
  coal: '煤矿',
  redstone: '红石',
  emerald: '绿宝石',
  lapis: '青金石',
  lapis_lazuli: '青金石',
  netherite_ingot: '下界合金锭',
  netherite_scrap: '下界合金碎片',
  quartz: '下界石英',
  amethyst_shard: '紫水晶碎片',
  copper_ingot: '铜锭',
  raw_iron: '粗铁',
  raw_gold: '粗金',
  raw_copper: '粗铜',
  flint: '燧石',
  stick: '木棍',
  string: '线',
  feather: '羽毛',
  leather: '皮革',
  bone: '骨头',
  slime_ball: '史莱姆球',
  ender_pearl: '末影珍珠',
  ender_pearls: '末影珍珠',
  ghast_tear: '恶魂之泪',
  blaze_rod: '烈焰棒',
  blaze_powder: '烈焰粉',
  magma_cream: '岩浆膏',
  phantom_membrane: '幻翼膜',
  nether_star: '下界之星',
  dragon_egg: '龙蛋',
  dragon_head: '龙首',
  shulker_shell: '潜影贝壳',
  heart_of_the_sea: '海洋之心',
  nautilus_shell: '鹦鹉螺壳',

  // ─── 工具 ────────────────────────────────────────────────────
  wooden_sword: '木剑',
  stone_sword: '石剑',
  iron_sword: '铁剑',
  golden_sword: '金剑',
  diamond_sword: '钻石剑',
  netherite_sword: '下界合金剑',
  wooden_pickaxe: '木镐',
  stone_pickaxe: '石镐',
  iron_pickaxe: '铁镐',
  golden_pickaxe: '金镐',
  diamond_pickaxe: '钻石镐',
  netherite_pickaxe: '下界合金镐',
  wooden_axe: '木斧',
  stone_axe: '石斧',
  iron_axe: '铁斧',
  diamond_axe: '钻石斧',
  netherite_axe: '下界合金斧',
  wooden_shovel: '木锹',
  stone_shovel: '石锹',
  iron_shovel: '铁锹',
  diamond_shovel: '钻石锹',
  netherite_shovel: '下界合金锹',
  wooden_hoe: '木锄',
  stone_hoe: '石锄',
  iron_hoe: '铁锄',
  diamond_hoe: '钻石锄',
  netherite_hoe: '下界合金锄',
  shears: '剪刀',
  fishing_rod: '钓鱼竿',
  flint_and_steel: '打火石',
  bow: '弓',
  crossbow: '弩',
  shield: '盾牌',
  trident: '三叉戟',
  elytra: '鞘翅',
  totem_of_undying: '不死图腾',

  // ─── 防具 ────────────────────────────────────────────────────
  leather_helmet: '皮革帽子',
  leather_chestplate: '皮革外套',
  leather_leggings: '皮革裤子',
  leather_boots: '皮革靴子',
  chainmail_helmet: '锁链头盔',
  chainmail_chestplate: '锁链胸甲',
  chainmail_leggings: '锁链护腿',
  chainmail_boots: '锁链靴子',
  iron_helmet: '铁头盔',
  iron_chestplate: '铁胸甲',
  iron_leggings: '铁护腿',
  iron_boots: '铁靴子',
  golden_helmet: '金头盔',
  golden_chestplate: '金胸甲',
  golden_leggings: '金护腿',
  golden_boots: '金靴子',
  diamond_helmet: '钻石头盔',
  diamond_chestplate: '钻石胸甲',
  diamond_leggings: '钻石护腿',
  diamond_boots: '钻石靴子',
  netherite_helmet: '下界合金头盔',
  netherite_chestplate: '下界合金胸甲',
  netherite_leggings: '下界合金护腿',
  netherite_boots: '下界合金靴子',
  turtle_helmet: '海龟壳',

  // ─── 食物 ────────────────────────────────────────────────────
  apple: '苹果',
  golden_apple: '金苹果',
  enchanted_golden_apple: '附魔金苹果',
  bread: '面包',
  cooked_beef: '熟牛肉',
  cooked_porkchop: '熟猪排',
  cooked_chicken: '熟鸡肉',
  cooked_mutton: '熟羊肉',
  cooked_salmon: '熟鲑鱼',
  cooked_cod: '熟鳕鱼',
  golden_carrot: '金胡萝卜',
  baked_potato: '烤马铃薯',
  pumpkin_pie: '南瓜派',
  cake: '蛋糕',
  cookie: '曲奇',
  melon: '西瓜',
  sweet_berries: '甜浆果',
  glow_berries: '发光浆果',
  honey_bottle: '蜂蜜瓶',
  chorus_fruit: '紫颂果',
  dried_kelp: '干海带',
  mushroom_stew: '蘑菇煲',
  rabbit_stew: '兔肉煲',
  beetroot_soup: '甜菜汤',
  suspicious_stew: '迷之炖菜',

  // ─── 方块 ────────────────────────────────────────────────────
  dirt: '泥土',
  grass_block: '草方块',
  cobblestone: '圆石',
  stone: '石头',
  granite: '花岗岩',
  diorite: '闪长岩',
  andesite: '安山岩',
  deepslate: '深板岩',
  tuff: '凝灰岩',
  sand: '沙子',
  gravel: '砂砾',
  clay: '黏土',
  oak_log: '橡木原木',
  spruce_log: '云杉原木',
  birch_log: '白桦原木',
  jungle_log: '丛林原木',
  acacia_log: '金合欢原木',
  dark_oak_log: '深色橡木原木',
  mangrove_log: '红树原木',
  cherry_log: '樱花原木',
  oak_planks: '橡木木板',
  spruce_planks: '云杉木板',
  birch_planks: '白桦木板',
  jungle_planks: '丛林木板',
  glass: '玻璃',
  sand_stone: '砂岩',
  brick: '砖块',
  bookshelf: '书架',
  obsidian: '黑曜石',
  netherrack: '下界岩',
  soul_sand: '灵魂沙',
  soul_soil: '灵魂土',
  glowstone: '荧石',
  end_stone: '末地石',
  purpur_block: '紫珀块',
  prismarine: '海晶石',
  sea_lantern: '海晶灯',

  // ─── 其它常用 ────────────────────────────────────────────────
  arrow: '箭',
  spectral_arrow: '光灵箭',
  tipped_arrow: '药箭',
  torch: '火把',
  soul_torch: '灵魂火把',
  lantern: '灯笼',
  soul_lantern: '灵魂灯笼',
  crafting_table: '工作台',
  furnace: '熔炉',
  blast_furnace: '高炉',
  smoker: '烟熏炉',
  anvil: '铁砧',
  enchanting_table: '附魔台',
  brewing_stand: '酿造台',
  ender_chest: '末影箱',
  chest: '箱子',
  barrel: '木桶',
  shulker_box: '潜影盒',
  hopper: '漏斗',
  dropper: '投掷器',
  dispenser: '发射器',
  piston: '活塞',
  redstone_block: '红石块',
  slime_block: '史莱姆块',
  honey_block: '蜂蜜块',
  sponge: '海绵',
  bucket: '铁桶',
  water_bucket: '水桶',
  lava_bucket: '岩浆桶',
  milk_bucket: '牛奶桶',
  saddle: '鞍',
  horse_armor: '马铠',
  name_tag: '命名牌',
  lead: '拴绳',
  book: '书',
  writable_book: '书与笔',
  written_book: '成书',
  compass: '指南针',
  recovery_compass: '追溯指南针',
  clock: '时钟',
  spyglass: '望远镜',
  map: '地图',
  filled_map: '已绘制地图',
  banner: '旗帜',
  bed: '床',
  respawn_anchor: '重生锚',
  lodestone: '磁石',
  smithing_table: '锻造台',
  grindstone: '砂轮',
  stonecutter: '切石机',
  loom: '织布机',
  cartography_table: '制图台',
  fletching_table: '箭术台',
  beehive: '蜂巢',
  beehive_block: '蜂巢',
  bee_nest: '蜂箱',
};

/**
 * 获取物品的中文显示名。
 * - 若 `name` 在映射表中 → 返回 `{ zh, mapped: true }`
 * - 否则 → 返回 `{ zh: name, mapped: false }`，调用方应根据 `mapped` 决定是否加灰色提示
 */
export function getItemDisplayName(name: string): { zh: string; mapped: boolean } {
  if (!name) return { zh: '', mapped: false };
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const found = ITEM_NAME_ZH[lower];
  if (found) return { zh: found, mapped: true };
  return { zh: trimmed, mapped: false };
}

// ============================================================================
// Pack API 集成 — 从后端 Pack items 接口读取中文显示名
// 优先使用 Pack YAML 中 items.static_list 的 display_name，降级到上方静态表
// ============================================================================

const PACK_API_BASE = '/api';
const PANEL_TOKEN_KEY = 'panel_token';

/** Pack items 接口返回的单个物品摘要 */
interface PackItemSummaryResponse {
  name: string;
  display_name?: string;
  category?: string;
}

/** Pack items 接口响应体 */
interface PackItemsResponse {
  pack_id: string;
  items: PackItemSummaryResponse[];
}

/**
 * 从 Pack API 获取物品中文名映射。
 * - 调用 GET /api/packs/:packId/items
 * - 返回 name → display_name 的 Map
 * - 失败时返回空 Map（不抛错），调用方降级到静态表
 */
export async function loadPackItemNames(packId: string): Promise<Map<string, string>> {
  try {
    const headers: Record<string, string> = {};
    try {
      const token = localStorage.getItem(PANEL_TOKEN_KEY);
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {
      // localStorage 不可用，忽略
    }
    const res = await fetch(`${PACK_API_BASE}/packs/${encodeURIComponent(packId)}/items`, {
      headers,
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as PackItemsResponse;
    const map = new Map<string, string>();
    for (const it of data.items) {
      if (it.display_name) {
        map.set(it.name, it.display_name);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * 获取物品显示名（优先用 Pack API 数据，降级到静态表）。
 * - packItemMap 非空且包含 name → 返回 Pack 中文显示名
 * - 否则降级到 getItemDisplayName 静态表
 */
export function getItemDisplayNameWithPack(
  name: string,
  packItemMap: Map<string, string> | null,
): { zh: string; mapped: boolean } {
  if (packItemMap && packItemMap.has(name)) {
    return { zh: packItemMap.get(name)!, mapped: true };
  }
  return getItemDisplayName(name);
}
