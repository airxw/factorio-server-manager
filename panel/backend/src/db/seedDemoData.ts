// ============================================================================
// v4.0.2: 演示数据 Seed 脚本
// 用途：在 .env.production 启用 VITE_ENABLE_DEMO=true 时，
//       为 5 个游戏 Pack 各创建一个示例实例，附带完整的演示数据：
//       - 商店商品（从 pack.items.static_list 同步）
//       - CDK 兑换码
//       - 聊天触发响应
//       - 玩家加入设置（欢迎语 + 首次礼包）
//       - 周期广播
//       - 投票设置（启用 + 默认阈值）
//       - 投票示例（passed / failed / cancelled 各一条）
//       - Mods 记录
//       - 存档记录
//       - 白名单 / 黑名单示例
// 幂等：以 server_id 固定 UUID 标识，重复 seed 不会产生重复行
// ============================================================================

import type { Knex } from 'knex';
import type { PackRegistry } from '../core/packs/registry.js';

// 演示账号——5 个实例各分配给一个角色
//   - admin 拥有全部 5 个实例（系统管理员视角）
//   - manager 拥有 2 个（实例管理员视角）
//   - user 拥有 1 个（普通用户视角）
const DEMO_INSTANCES: Array<{
  packId: string;
  name: string;
  description: string;
  ownerEmail: 'admin@local.dev' | 'manager@local.dev' | 'user@local.dev';
  // 固定 UUID——便于幂等和跨 seed 重用
  fixedId: string;
  // 游戏端口基准
  portBase: number;
  rconPortBase: number;
}> = [
  {
    packId: 'minecraft-vanilla',
    name: '🌍 我的世界 · 演示服',
    description: '原版 Minecraft 1.20.4 — 沙盒创造、商店试运营',
    ownerEmail: 'admin@local.dev',
    fixedId: '11111111-1111-4111-8111-111111111111',
    portBase: 25565,
    rconPortBase: 25575,
  },
  {
    packId: 'factorio-vanilla',
    name: '⚙️ 异星工厂 · 演示服',
    description: 'Factorio 1.1.x — 自动化工厂、Mod 试运营',
    ownerEmail: 'admin@local.dev',
    fixedId: '22222222-2222-4222-8222-222222222222',
    portBase: 34197,
    rconPortBase: 27015,
  },
  {
    packId: 'rust-vanilla',
    name: '🏚️ 腐蚀 · 演示服',
    description: 'Rust 原版 — 生存掠夺、VIP 试运营',
    ownerEmail: 'manager@local.dev',
    fixedId: '33333333-3333-4333-8333-333333333333',
    portBase: 28015,
    rconPortBase: 28016,
  },
  {
    packId: 'factorio-vanilla',
    name: '⚙️ 异星工厂 · 演示服',
    description: 'Factorio 1.1.x — 自动化流水线、蓝图试运营',
    ownerEmail: 'user@local.dev',
    fixedId: '44444444-4444-4444-8444-444444444444',
    portBase: 34197,
    rconPortBase: 27015,
  },
  {
    packId: 'terraria-vanilla',
    name: '🌳 泰拉瑞亚 · 演示服',
    description: 'Terraria — 冒险建造、CDK 试运营',
    ownerEmail: 'user@local.dev',
    fixedId: '55555555-5555-4555-8555-555555555555',
    portBase: 7777,
    rconPortBase: 27020,
  },
];

/** 为每个实例生成的"标准"扩展业务数据 */
const CHAT_TRIGGERS: Array<{ trigger: string; response: string; priority: number }> = [
  { trigger: '!help', response: 'say 可用命令: !help !status !daily !vk <player>', priority: 10 },
  { trigger: '!status', response: 'say 服务运行中·积分商城已上线·欢迎来玩', priority: 20 },
  { trigger: '!daily', response: 'give {{player}} diamond 5', priority: 30 },
  { trigger: '!rules', response: 'say 1.禁止外挂 2.尊重其他玩家 3.有问题联系管理', priority: 5 },
];

const CDK_SAMPLES: Array<{ code: string; item: string; count: number; quality: string }> = [
  { code: 'DEMO-MC-001', item: 'diamond', count: 10, quality: 'rare' },
  { code: 'DEMO-MC-002', item: 'netherite-ingot', count: 1, quality: 'epic' },
  { code: 'DEMO-VIP-001', item: 'gold-ingot', count: 64, quality: 'uncommon' },
];

const MOD_SAMPLES: Array<{ mod_name: string; version: string; source_url: string }> = [
  { mod_name: 'journeymap', version: '5.9.7', source_url: 'https://modrinth.com/mod/journeymap' },
  { mod_name: 'jade', version: '11.6.2', source_url: 'https://modrinth.com/mod/jade' },
  { mod_name: 'littletweaks', version: '1.10.2', source_url: 'https://modrinth.com/mod/littletweaks' },
];

const WHITELIST_PLAYERS = ['Steve_Demo', 'Alex_Demo'];
const BANLIST_PLAYERS: Array<{ player: string; reason: string }> = [
  { player: 'Griefer_Demo', reason: '演示用 · 已封禁示例' },
];

/**
 * 幂等 seed 5 个游戏实例及其业务数据
 * - 重复执行不会插入重复行（以 fixedId 判定存在性）
 * - 仅在 demo 模式启用（VITE_ENABLE_DEMO=true）时调用
 */
export async function seedDemoInstancesIfMissing(
  db: Knex,
  registry: PackRegistry,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const now = new Date().toISOString();
  const nowEpoch = Date.now();

  // 1. 校验本地节点已存在（seedLocalNodeIfEmpty 应已跑过）
  const node = await db('nodes').where({ id: 'node-local' }).first();
  if (!node) {
    throw new Error('[seedDemo] node-local 不存在，请先调用 seedLocalNodeIfEmpty');
  }

  // 2. 校验 demo 账号已 seed
  const ownerEmails = Array.from(new Set(DEMO_INSTANCES.map((d) => d.ownerEmail)));
  const ownerRows = await db('users').whereIn('email', ownerEmails).select('id', 'email');
  const ownerMap = new Map<string, string>();
  for (const row of ownerRows) {
    ownerMap.set(row.email as string, row.id as string);
  }
  for (const email of ownerEmails) {
    if (!ownerMap.has(email)) {
      throw new Error(`[seedDemo] 演示账号缺失: ${email}，请先调用 seedDemoAccountsIfMissing`);
    }
  }

  // 3. 逐个 seed 实例
  for (const cfg of DEMO_INSTANCES) {
    const pack = registry.get(cfg.packId);
    if (!pack) {
      console.warn(`[seedDemo] Pack 不存在，跳过: ${cfg.packId}`);
      continue;
    }
    const ownerId = ownerMap.get(cfg.ownerEmail)!;

    // 3.1 检查实例是否已存在
    const existing = await db('servers').where({ id: cfg.fixedId }).first();
    if (existing) {
      result.skipped.push(cfg.fixedId);
      await seedBusinessDataIfMissing(db, cfg, pack, ownerId, now, nowEpoch, true);
      continue;
    }

    // 3.2 创建实例（端口与原始 Pack 的 default_game_port 对齐）
    //   注：分配 port 时优先使用 cfg.portBase；已存在相同端口则顺延 +10
    const port = await allocateUniquePort(db, 'port', cfg.portBase);
    const rconPort = await allocateUniquePort(db, 'rcon_port', cfg.rconPortBase);
    const rconPasswordEnc = Buffer.from(`demo-rcon-${cfg.fixedId.slice(0, 8)}`).toString('base64');

    await db('servers').insert({
      id: cfg.fixedId,
      name: cfg.name,
      pack_id: pack.pack.id,
      game_type: pack.pack.game,
      node_id: 'node-local',
      owner_user_id: ownerId,
      status: 'stopped',
      port,
      rcon_port: rconPort,
      rcon_password_enc: rconPasswordEnc,
      resource_limits_json: JSON.stringify({ memory: '2G', cpu: 1.5 }),
      current_version: null,
      version_id: null,
      last_activity_at: now,
      marked_for_deletion: 0,
      disk_usage_bytes: null,
      disk_usage_updated_at: null,
      created_at: now,
      updated_at: now,
    });
    result.created.push(cfg.fixedId);

    // 3.3 业务数据 seed
    await seedBusinessDataIfMissing(db, cfg, pack, ownerId, now, nowEpoch, false);
  }

  return result;
}

/**
 * v4.15.x: 幂等 seed 演示玩家的实例绑定
 * v4.17.0: 迁移到统一 bindings 表（binding_type='account', scope_type='instance'）
 *
 * 背景：requireInstanceAccess 仅对 instance_admin 放行 owner 匹配；
 *       role='user' 的玩家访问店铺视图（shop-config/shop-items 等）需 active 绑定记录。
 *       demo 模式下 user@local.dev 拥有 44444444/55555555 两个演示实例，
 *       但历史 seed 未建绑定，导致玩家店铺页 403（"您无权访问该实例"）。
 *
 * 幂等：以 (user_id, binding_type, scope_type, scope_ref) 唯一约束判定，已存在（含 revoked）则跳过；
 *       每次启动随 seedDemoInstancesIfMissing 之后调用，兼容存量部署热更新。
 */
export async function seedDemoUserBindingsIfMissing(
  db: Knex,
): Promise<{ created: number; skipped: number }> {
  const result = { created: 0, skipped: 0 };

  // v4.17.0: 统一 bindings 表必然存在（迁移已落地），无需 hasTable 检查
  const now = new Date().toISOString();
  const playerEmails = Array.from(
    new Set(
      DEMO_INSTANCES.filter((d) => d.ownerEmail === 'user@local.dev').map((d) => d.ownerEmail),
    ),
  );
  const userRows = await db('users').whereIn('email', playerEmails).select('id', 'email');
  const userMap = new Map<string, string>();
  for (const row of userRows) {
    userMap.set(row.email as string, row.id as string);
  }

  for (const cfg of DEMO_INSTANCES) {
    if (cfg.ownerEmail !== 'user@local.dev') continue;
    const userId = userMap.get(cfg.ownerEmail);
    if (!userId) continue; // 演示账号未 seed 时由 seedDemoInstancesIfMissing 报错，此处静默跳过

    // 实例本身可能因 Pack 缺失被跳过，绑定前确认实例存在
    const server = await db('servers').where({ id: cfg.fixedId }).first();
    if (!server) continue;

    // v4.17.0: 查询统一 bindings 表（仅查 verified，已 revoked 的允许复活）
    const existing = await db('bindings')
      .where({
        user_id: userId,
        binding_type: 'account',
        scope_type: 'instance',
        scope_ref: cfg.fixedId,
        verify_status: 'verified',
      })
      .first();
    if (existing) {
      result.skipped += 1;
      continue;
    }

    // v4.17.0: 写入统一 bindings 表
    // - binding_type='account', scope_type='instance', scope_ref=server_id
    // - verify_status='verified'（对应旧表 status='active'）
    // - verified_at=now（对应旧表 bound_at）
    // - metadata.vip_expires_at=null（对应旧表 unbound_at=null，永久 VIP）
    await db('bindings').insert({
      user_id: userId,
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: cfg.fixedId,
      player_name: null,
      vip_level: 1,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: now,
      metadata: JSON.stringify({
        source: 'seedDemoData',
        vip_expires_at: null,
        unbound_at: null,
      }),
      created_at: now,
      updated_at: now,
    });
    result.created += 1;
  }

  return result;
}

/**
 * 为单个实例 seed 业务数据（shop/cdk/trigger/join/vote/mod/save/list）
 * @param skipExisting true 表示实例已存在，仅补缺业务数据
 */
async function seedBusinessDataIfMissing(
  db: Knex,
  cfg: typeof DEMO_INSTANCES[number],
  pack: { pack: { id: string; game: string }; items?: { static_list?: Array<{ name: string; display_name?: string; category?: string }> } },
  _ownerId: string,
  now: string,
  nowEpoch: number,
  skipExisting: boolean,
): Promise<void> {
  const serverId = cfg.fixedId;

  // 商店商品（从 pack.items.static_list 同步；首次创建时批量插入）
  if (!skipExisting) {
    const staticList = pack.items?.static_list;
    if (staticList && staticList.length > 0) {
      // 演示场景：每个商品设为 enabled，按品类分散质量等级
      const shopRows = staticList.slice(0, 12).map((item, idx) => ({
        server_id: serverId,
        item_name: item.name,
        // 轮询 5 个品质（仅适用于支持品质的游戏；Minecraft 不支持，但字段允许）
        quality: ['normal', 'uncommon', 'rare', 'epic', 'legendary'][idx % 5],
        vip_level_required: idx < 4 ? 0 : idx < 8 ? 1 : idx < 11 ? 2 : 3,
        daily_limit: idx < 3 ? 5 : idx < 6 ? 3 : null,
        enabled: true,
        created_at: now,
        updated_at: now,
      }));
      await db('shop_items').insert(shopRows);
    }
  }

  // CDK 兑换码（每个实例 3 个）
  if (!skipExisting) {
    const cdkRows = CDK_SAMPLES.map((c) => ({
      server_id: serverId,
      code: `${c.code}-${serverId.slice(0, 4).toUpperCase()}`,
      item_name: c.item,
      count: c.count,
      quality: c.quality,
      status: 'unused',
      claimed_player: null,
      claimed_at: null,
      // 30 天后过期
      expires_at: new Date(nowEpoch + 30 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'seed-demo',
      created_at: now,
    }));
    await db('cdk_codes').insert(cdkRows);
  }

  // 聊天触发响应
  if (!skipExisting) {
    const triggerRows = CHAT_TRIGGERS.map((t) => ({
      server_id: serverId,
      trigger: t.trigger,
      response: t.response,
      priority: t.priority,
      enabled: true,
      created_at: now,
    }));
    await db('chat_trigger_responses').insert(triggerRows);
  }

  // 玩家加入设置（欢迎语 + 首次礼包）
  const joinSetting = await db('player_join_settings').where({ server_id: serverId }).first();
  if (!joinSetting) {
    await db('player_join_settings').insert({
      server_id: serverId,
      welcome_message: `🎮 欢迎来到 ${cfg.name} · 输入 !help 查看命令`,
      gift_enabled: true,
      gift_item: 'diamond',
      gift_count: 1,
      gift_quality: 'normal',
      updated_at: now,
    });
  }

  // 周期广播（每 10 分钟）
  if (!skipExisting) {
    const periodic = await db('periodic_messages').where({ server_id: serverId }).first();
    if (!periodic) {
      const nextRunAt = new Date(nowEpoch + 10 * 60 * 1000).toISOString();
      await db('periodic_messages').insert({
        server_id: serverId,
        message: `⏰ ${cfg.name} · 演示服 · 输入 !daily 领取每日礼包`,
        interval_minutes: 10,
        enabled: true,
        next_run_at: nextRunAt,
        created_at: now,
      });
    }
  }

  // 投票设置（启用 + 阈值 3）
  const voteSetting = await db('vote_settings').where({ server_id: serverId }).first();
  if (!voteSetting) {
    await db('vote_settings').insert({
      server_id: serverId,
      enabled: true,
      threshold: 3,
      duration_seconds: 60,
      reason_prefix: '[VoteKick]',
      updated_at: now,
    });
  }

  // 投票示例（3 条状态各异：passed / failed / cancelled）
  if (!skipExisting) {
    const voteExample = await db('votes').where({ server_id: serverId }).first();
    if (!voteExample) {
      const votes = [
        {
          server_id: serverId,
          initiator: 'Steve_Demo',
          target: 'Griefer_Demo',
          reason: '示例：已通过的投票踢人',
          status: 'passed',
          start_time: new Date(nowEpoch - 24 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(nowEpoch - 24 * 60 * 60 * 1000 + 60 * 1000).toISOString(),
          created_at: now,
        },
        {
          server_id: serverId,
          initiator: 'Alex_Demo',
          target: 'Noisy_Demo',
          reason: '示例：未达阈值的投票',
          status: 'failed',
          start_time: new Date(nowEpoch - 12 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(nowEpoch - 12 * 60 * 60 * 1000 + 60 * 1000).toISOString(),
          created_at: now,
        },
        {
          server_id: serverId,
          initiator: 'Steve_Demo',
          target: 'Cheater_Demo',
          reason: '示例：被发起人撤销',
          status: 'cancelled',
          start_time: new Date(nowEpoch - 6 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(nowEpoch - 6 * 60 * 60 * 1000 + 30 * 1000).toISOString(),
          created_at: now,
        },
      ];
      await db('votes').insert(votes);
    }
  }

  // Mods 记录
  if (!skipExisting) {
    const modExisting = await db('mod_records').where({ server_id: serverId }).first();
    if (!modExisting) {
      const modRows = MOD_SAMPLES.map((m) => ({
        server_id: serverId,
        mod_name: m.mod_name,
        version: m.version,
        enabled: true,
        source_url: m.source_url,
        installed_at: now,
        created_at: now,
        updated_at: now,
      }));
      await db('mod_records').insert(modRows);
    }
  }

  // 存档记录（每个实例 1 个）
  if (!skipExisting) {
    const saveExisting = await db('save_records').where({ server_id: serverId }).first();
    if (!saveExisting) {
      await db('save_records').insert({
        server_id: serverId,
        save_name: 'demo-save-01',
        file_path: `/opt/gameserver-panel/data/instances/${serverId}/world/demo-save-01.dat`,
        size_bytes: 16 * 1024 * 1024, // 16MB 示例
        modified_at: now,
        is_active: true,
        created_at: now,
      });
    }
  }

  // 白名单 / 黑名单
  if (!skipExisting) {
    const listExisting = await db('list_entries').where({ server_id: serverId }).first();
    if (!listExisting) {
      const whitelistRows = WHITELIST_PLAYERS.map((player) => ({
        server_id: serverId,
        list_type: 'whitelist',
        player_name: player,
        added_at: now,
        added_by: 'seed-demo',
        reason: null,
      }));
      const banlistRows = BANLIST_PLAYERS.map((b) => ({
        server_id: serverId,
        list_type: 'banlist',
        player_name: b.player,
        added_at: now,
        added_by: 'seed-demo',
        reason: b.reason,
      }));
      await db('list_entries').insert([...whitelistRows, ...banlistRows]);
    }
  }
}

/** 在 base 基础上顺延直到找到未被占用的端口 */
async function allocateUniquePort(db: Knex, column: 'port' | 'rcon_port', base: number): Promise<number> {
  for (let offset = 0; offset < 50; offset += 1) {
    const candidate = base + offset;
    const taken = await db('servers').where({ [column]: candidate }).first();
    if (!taken) return candidate;
  }
  // 极端情况下回退到 30000+ 范围
  const fallback = 30000 + Math.floor(Math.random() * 1000);
  return fallback;
}

export const DEMO_INSTANCE_IDS = DEMO_INSTANCES.map((d) => d.fixedId);
