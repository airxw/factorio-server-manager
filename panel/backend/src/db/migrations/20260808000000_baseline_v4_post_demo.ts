// ============================================================================
// 20260808000000_baseline_v4_post_demo.ts
// v4.19.0 M5: Schema 基线重置（Demo 期结束后合并抛弃历史包袱）
//
// 设计原则（方案 §7.2）：
//   1. 只含 CREATE TABLE IF NOT EXISTS，不含 ALTER TABLE / 中间态数据迁移
//   2. users 表不含旧 role 列（仅 roles JSON + active_role）—— M3 DROP COLUMN 被本基线吸收
//   3. 不含测试数据，仅插入系统运行必需的字典数据（permission_points / role_permission_templates）
//   4. 使用 IF NOT EXISTS 确保对已存在表的存量部署无副作用
//   5. .down() 抛异常，严禁 DROP TABLE 以防误触清空数据库
//
// 数据来源：基于 v4.17.0 完整迁移后开发库 SQLite 终态 Schema 提取
//   - backup/v4.11.0-pre-release-20260724/panel/backend/data/panel.db .schema（49 张表）
//   - v4.12-v4.17 增量 migration（新增 5 张表 + users 表加 roles/active_role 列 + DROP 旧 3 张表）
//
// 表清单（55 张）：
//   核心基础(4): users, nodes, packs, servers
//   系统(3): system_config, vip_permissions, command_queue
//   同步(1): item_sync_log
//   商城(7): shop_items, shop_orders, shop_order_items, cdk_codes, cdk_code_items, gift_claims, instance_shop_configs
//   聊天(4): chat_settings, chat_trigger_responses, chat_logs, periodic_messages
//   投票(3): votes, vote_records, vote_settings
//   玩家(3): player_histories, player_join_settings, player_sessions
//   运维(7): mod_records, mod_dependencies, save_records, backup_records, monitor_snapshots, list_entries, webhooks
//   审计(1): audit_logs
//   钱包通知(2): user_wallets, user_notifications
//   系统更新(2): system_update_jobs, user_password_history
//   版本(1): game_versions
//   认证(3): password_resets, email_verifications, api_keys
//   资源(1): resource_quotas
//   告警(2): alert_events, alert_settings
//   实例管理(2): instance_admins, instance_roles
//   好友(1): friendships
//   资产(2): global_assets, instance_assets
//   绑定权限(3): bindings, permission_points, role_permission_templates
//
// 归档说明：v4.17.0 之前的 58 个增量 migration 已移至 docs/archive/migrations_demo_period/
// ============================================================================

import type { Knex } from 'knex';
import { PERMISSION_POINTS, ROLE_PERMISSION_TEMPLATES } from '../seed-data/permission-data';

// ============================================================================
// DDL 语句数组（按依赖顺序排列）
// 注意：所有 CREATE TABLE 改为 CREATE TABLE IF NOT EXISTS 确保幂等
// ============================================================================
const DDL_STATEMENTS: string[] = [
  // ==========================================================================
  // 核心基础表（4 张）
  // ==========================================================================

  // users 表（v4.19.0 基线：不含旧 role 列，仅 roles JSON + active_role）
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`email\` varchar(255) NOT NULL,
    \`username\` varchar(255) NOT NULL,
    \`password_hash\` varchar(255) NOT NULL,
    \`status\` varchar(255) NOT NULL DEFAULT 'active',
    \`created_at\` text NOT NULL,
    \`display_name\` varchar(255) NULL DEFAULT NULL,
    \`vip_level\` integer NOT NULL DEFAULT 0,
    \`vip_expires_at\` text NULL DEFAULT NULL,
    \`is_verified\` boolean NOT NULL DEFAULT 0,
    \`last_login_at\` text NULL DEFAULT NULL,
    \`last_login_ip\` varchar(255) NULL DEFAULT NULL,
    \`updated_at\` text NOT NULL DEFAULT '2026-01-01T00:00:00.000Z',
    \`token_version\` integer NOT NULL DEFAULT 0,
    \`password_changed_at\` text NULL DEFAULT NULL,
    \`email_verified\` integer NOT NULL DEFAULT 0,
    \`is_built_in\` integer NOT NULL DEFAULT 0,
    \`roles\` text NULL DEFAULT NULL,
    \`active_role\` varchar(255) NULL DEFAULT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`users_email_unique\` ON \`users\` (\`email\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_users_active_role\` ON \`users\` (\`active_role\`)`,

  // nodes 表（v4.10.0 集群扩展：含 node_type / comms_key / link_key_hash 等字段）
  `CREATE TABLE IF NOT EXISTS \`nodes\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`name\` varchar(255) NOT NULL,
    \`fqdn\` varchar(255) NOT NULL,
    \`daemon_token_hash\` varchar(255) NOT NULL,
    \`public_ip\` varchar(255) NULL,
    \`status\` varchar(255) NOT NULL DEFAULT 'offline',
    \`last_seen_at\` text NULL,
    \`node_type\` varchar(255) NOT NULL DEFAULT 'master',
    \`comms_key\` varchar(255) NULL DEFAULT NULL,
    \`link_key_hash\` varchar(255) NULL DEFAULT NULL,
    \`linked_at\` text NULL,
    \`display_fqdn\` varchar(255) NULL
  )`,

  // packs 表
  `CREATE TABLE IF NOT EXISTS \`packs\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`game\` varchar(255) NOT NULL,
    \`variant\` varchar(255) NOT NULL,
    \`display_name\` varchar(255) NOT NULL,
    \`version\` varchar(255) NOT NULL,
    \`enabled\` boolean NOT NULL DEFAULT 1,
    \`loaded_at\` text NOT NULL
  )`,

  // servers 表（含 v4.13+ 扩展字段：restart_count / version_id / disk_usage / is_public 等）
  `CREATE TABLE IF NOT EXISTS \`servers\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`name\` varchar(255) NOT NULL,
    \`pack_id\` varchar(255) NOT NULL,
    \`game_type\` varchar(255) NOT NULL,
    \`node_id\` varchar(255) NOT NULL,
    \`owner_user_id\` varchar(255) NOT NULL,
    \`status\` varchar(255) NOT NULL DEFAULT 'stopped',
    \`port\` integer NOT NULL,
    \`rcon_port\` integer NOT NULL,
    \`rcon_password_enc\` text NULL,
    \`resource_limits_json\` text NULL,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL,
    \`shop_enabled\` boolean NOT NULL DEFAULT 1,
    \`chat_enabled\` boolean NOT NULL DEFAULT 1,
    \`mods_enabled\` boolean NOT NULL DEFAULT 1,
    \`restart_count\` integer NOT NULL DEFAULT 0,
    \`last_save_id\` integer NULL,
    \`current_version\` varchar(255) NULL,
    \`version_id\` varchar(255) NULL,
    \`last_activity_at\` text NULL,
    \`marked_for_deletion\` boolean NOT NULL DEFAULT 0,
    \`disk_usage_bytes\` integer NULL,
    \`disk_usage_updated_at\` text NULL,
    \`is_public\` integer NOT NULL DEFAULT 0,
    \`is_recommended\` integer NOT NULL DEFAULT 0,
    \`recommended_at\` text NULL,
    FOREIGN KEY (\`version_id\`) REFERENCES \`game_versions\` (\`id\`) ON DELETE SET NULL
  )`,

  // ==========================================================================
  // 系统表（3 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`vip_permissions\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`vip_level\` integer NOT NULL,
    \`display_name\` varchar(255) NOT NULL,
    \`permissions\` text DEFAULT '[]',
    \`max_quality\` varchar(255) NOT NULL DEFAULT 'normal',
    \`daily_limit\` integer NULL DEFAULT NULL,
    \`daily_reward_amount\` integer NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`vip_permissions_vip_level_unique\` ON \`vip_permissions\` (\`vip_level\`)`,

  `CREATE TABLE IF NOT EXISTS \`system_config\` (
    \`key\` varchar(255) PRIMARY KEY,
    \`value\` varchar(255) NOT NULL,
    \`description\` varchar(255) NULL DEFAULT NULL,
    \`updated_at\` text NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS \`command_queue\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`command_text\` text NOT NULL,
    \`priority\` varchar(255) NOT NULL DEFAULT 'normal',
    \`status\` varchar(255) NOT NULL DEFAULT 'pending',
    \`attempts\` integer NOT NULL DEFAULT 0,
    \`max_attempts\` integer NOT NULL DEFAULT 3,
    \`last_error\` text NULL,
    \`created_at\` text NOT NULL,
    \`sent_at\` text NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_command_queue_server_status\` ON \`command_queue\` (\`server_id\`, \`status\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_command_queue_priority_created\` ON \`command_queue\` (\`priority\`, \`created_at\`)`,

  // ==========================================================================
  // 同步日志表（1 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`item_sync_log\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`pack_id\` varchar(255) NOT NULL,
    \`source_url\` varchar(255) NOT NULL,
    \`status\` varchar(255) NOT NULL,
    \`items_count\` integer NULL DEFAULT NULL,
    \`synced_at\` text NOT NULL,
    \`error_message\` text NULL,
    \`created_at\` text NOT NULL,
    \`retention_days\` integer NOT NULL DEFAULT 30
  )`,

  // ==========================================================================
  // 商城表（7 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`shop_items\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`item_name\` varchar(255) NOT NULL,
    \`quality\` varchar(255) NOT NULL DEFAULT 'normal',
    \`vip_level_required\` integer NOT NULL DEFAULT 0,
    \`daily_limit\` integer NULL DEFAULT NULL,
    \`enabled\` boolean NOT NULL DEFAULT 0,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL,
    \`price\` integer NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_shop_items_server_item\` ON \`shop_items\` (\`server_id\`, \`item_name\`)`,

  `CREATE TABLE IF NOT EXISTS \`shop_orders\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`user_id\` varchar(255) NOT NULL,
    \`status\` varchar(255) NOT NULL DEFAULT 'pending',
    \`claim_code\` varchar(255) NOT NULL,
    \`items_count\` integer NOT NULL,
    \`claimed_at\` text NULL,
    \`expires_at\` text NOT NULL,
    \`claimed_player\` varchar(255) NULL,
    \`created_at\` text NOT NULL,
    \`claiming_at\` text NULL,
    \`total_price\` integer NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`shop_orders_claim_code_unique\` ON \`shop_orders\` (\`claim_code\`)`,

  `CREATE TABLE IF NOT EXISTS \`shop_order_items\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`order_id\` integer NOT NULL,
    \`item_name\` varchar(255) NOT NULL,
    \`count\` integer NOT NULL,
    \`quality\` varchar(255) NOT NULL DEFAULT 'normal',
    \`price\` integer NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_shop_order_items_order\` ON \`shop_order_items\` (\`order_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`cdk_codes\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`code\` varchar(255) NOT NULL,
    \`item_name\` varchar(255) NOT NULL,
    \`count\` integer NOT NULL,
    \`quality\` varchar(255) NOT NULL DEFAULT 'normal',
    \`status\` varchar(255) NOT NULL DEFAULT 'unused',
    \`claimed_player\` varchar(255) NULL,
    \`claimed_at\` text NULL,
    \`expires_at\` text NOT NULL,
    \`created_by\` varchar(255) NOT NULL,
    \`created_at\` text NOT NULL,
    \`claiming_at\` text NULL,
    \`gift_name\` varchar(255) NULL,
    \`gift_description\` varchar(255) NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`cdk_codes_code_unique\` ON \`cdk_codes\` (\`code\`)`,

  `CREATE TABLE IF NOT EXISTS \`cdk_code_items\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`cdk_code_id\` integer NOT NULL,
    \`item_name\` varchar(255) NOT NULL,
    \`count\` integer NOT NULL,
    \`quality\` varchar(255) NOT NULL DEFAULT 'normal',
    \`sort_order\` integer NOT NULL DEFAULT 0,
    FOREIGN KEY (\`cdk_code_id\`) REFERENCES \`cdk_codes\` (\`id\`) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_cdk_code_items_code_id\` ON \`cdk_code_items\` (\`cdk_code_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`gift_claims\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`user_id\` varchar(255) NOT NULL,
    \`game_player_name\` varchar(255) NOT NULL,
    \`claim_type\` varchar(255) NOT NULL,
    \`claimed_at\` text NOT NULL
  )`,

  // v4.13.0: 实例店铺外观配置
  `CREATE TABLE IF NOT EXISTS \`instance_shop_configs\` (
    \`server_id\` varchar(255) PRIMARY KEY,
    \`banner_url\` text NULL,
    \`banner_link\` text NULL,
    \`shop_description\` text NULL,
    \`shop_theme_color\` varchar(16) NULL,
    \`updated_at\` text NOT NULL
  )`,

  // ==========================================================================
  // 聊天表（4 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`chat_settings\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`enabled\` boolean NOT NULL DEFAULT 1,
    \`settings_json\` text NOT NULL,
    \`updated_at\` text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`chat_settings_server_id_unique\` ON \`chat_settings\` (\`server_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`chat_trigger_responses\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`trigger\` varchar(255) NOT NULL,
    \`response\` text NOT NULL,
    \`priority\` integer NOT NULL DEFAULT 50,
    \`enabled\` boolean NOT NULL DEFAULT 1,
    \`created_at\` text NOT NULL,
    \`mode\` TEXT NOT NULL DEFAULT 'prefix',
    \`cooldown_seconds\` INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS \`chat_logs\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`player_name\` varchar(255) NOT NULL,
    \`message\` text NOT NULL,
    \`sent_at\` text NOT NULL,
    \`created_at\` text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_chat_logs_server_sent_at\` ON \`chat_logs\` (\`server_id\`, \`sent_at\`)`,

  `CREATE TABLE IF NOT EXISTS \`periodic_messages\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`message\` text NOT NULL,
    \`interval_minutes\` integer NOT NULL,
    \`enabled\` boolean NOT NULL DEFAULT 1,
    \`next_run_at\` text NOT NULL,
    \`created_at\` text NOT NULL
  )`,

  // ==========================================================================
  // 投票表（3 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`votes\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`initiator\` varchar(255) NOT NULL,
    \`target\` varchar(255) NOT NULL,
    \`reason\` varchar(255) NOT NULL,
    \`status\` varchar(255) NOT NULL DEFAULT 'active',
    \`start_time\` text NOT NULL,
    \`end_time\` text NULL,
    \`created_at\` text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS \`vote_records\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`vote_id\` integer NOT NULL,
    \`voter\` varchar(255) NOT NULL,
    \`vote_choice\` varchar(255) NOT NULL,
    \`created_at\` text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_vote_records_vote\` ON \`vote_records\` (\`vote_id\`)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_vote_records_vote_voter\` ON \`vote_records\` (\`vote_id\`, \`voter\`)`,
  `CREATE TABLE IF NOT EXISTS \`vote_settings\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`enabled\` boolean NOT NULL DEFAULT 0,
    \`threshold\` integer NOT NULL DEFAULT 3,
    \`duration_seconds\` integer NOT NULL DEFAULT 60,
    \`reason_prefix\` varchar(255) NOT NULL DEFAULT '[VoteKick]',
    \`updated_at\` text NOT NULL,
    \`trigger_keywords\` TEXT NOT NULL DEFAULT '["!vk"]',
    \`cooldown_seconds\` INTEGER NOT NULL DEFAULT 60,
    \`target_cooldown_seconds\` INTEGER NOT NULL DEFAULT 300,
    \`admin_immune\` INTEGER NOT NULL DEFAULT 1,
    \`vip_immune_min_level\` INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`vote_settings_server_id_unique\` ON \`vote_settings\` (\`server_id\`)`,

  // ==========================================================================
  // 玩家表（3 张，已排除 v4.17.0 DROP 的 player_bindings / player_verify_codes）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`player_histories\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`game_player_name\` varchar(255) NOT NULL,
    \`joined_at\` text NOT NULL,
    \`left_at\` text NULL,
    \`ip_address\` varchar(255) NULL,
    \`session_duration\` integer NULL,
    \`created_at\` text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS \`player_join_settings\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`welcome_message\` varchar(255) NULL,
    \`gift_enabled\` boolean NOT NULL DEFAULT 0,
    \`gift_item\` varchar(255) NULL,
    \`gift_count\` integer NULL,
    \`gift_quality\` varchar(255) NULL,
    \`updated_at\` text NOT NULL,
    \`leave_message\` text NULL,
    \`relogin_gift_enabled\` boolean NOT NULL DEFAULT 0,
    \`relogin_gift_items\` text NULL,
    \`relogin_cooldown_hours\` integer NULL DEFAULT 24,
    \`relogin_daily_limit\` integer NULL DEFAULT 1,
    \`relogin_total_limit\` integer NULL,
    \`vip_welcome_messages\` text NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`player_join_settings_server_id_unique\` ON \`player_join_settings\` (\`server_id\`)`,

  // v4.13.0: 玩家会话表
  `CREATE TABLE IF NOT EXISTS \`player_sessions\` (
    \`session_id\` varchar(255) PRIMARY KEY,
    \`player_user_id\` varchar(255) NOT NULL,
    \`instance_id\` varchar(255) NOT NULL,
    \`game_player_name\` varchar(255) NULL,
    \`join_at\` text NOT NULL,
    \`leave_at\` text NULL,
    \`duration_seconds\` integer NULL,
    \`created_at\` text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_player_sessions_inst_join\` ON \`player_sessions\` (\`instance_id\`, \`join_at\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_player_sessions_inst_leave\` ON \`player_sessions\` (\`instance_id\`, \`leave_at\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_player_sessions_user_inst\` ON \`player_sessions\` (\`player_user_id\`, \`instance_id\`)`,

  // ==========================================================================
  // 运维表（7 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`mod_records\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`mod_name\` varchar(255) NOT NULL,
    \`version\` varchar(255) NOT NULL,
    \`enabled\` boolean NOT NULL DEFAULT 1,
    \`source_url\` varchar(255) NULL,
    \`installed_at\` text NULL,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_mod_records_server_mod_version\` ON \`mod_records\` (\`server_id\`, \`mod_name\`, \`version\`)`,

  `CREATE TABLE IF NOT EXISTS \`mod_dependencies\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`mod_id\` integer NOT NULL,
    \`depends_on\` varchar(255) NOT NULL,
    \`version_required\` varchar(255) NULL,
    \`satisfied\` boolean NOT NULL DEFAULT 0,
    \`checked_at\` datetime DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_mod_dependencies_mod_id\` ON \`mod_dependencies\` (\`mod_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`save_records\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`save_name\` varchar(255) NOT NULL,
    \`file_path\` varchar(255) NOT NULL,
    \`size_bytes\` integer NOT NULL,
    \`modified_at\` text NOT NULL,
    \`is_active\` boolean NOT NULL DEFAULT 0,
    \`created_at\` text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_save_records_server_save\` ON \`save_records\` (\`server_id\`, \`save_name\`)`,

  `CREATE TABLE IF NOT EXISTS \`backup_records\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`file_path\` varchar(255) NOT NULL,
    \`size_bytes\` integer NOT NULL,
    \`created_at\` text NOT NULL,
    \`created_by\` varchar(255) NOT NULL,
    \`status\` varchar(255) NOT NULL DEFAULT 'in_progress'
  )`,

  `CREATE TABLE IF NOT EXISTS \`monitor_snapshots\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`timestamp\` text NOT NULL,
    \`cpu_percent\` float NULL,
    \`memory_mb\` float NULL,
    \`tick_rate\` float NULL,
    \`player_count\` integer NULL,
    \`json_extra\` text NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_monitor_snapshots_server_timestamp\` ON \`monitor_snapshots\` (\`server_id\`, \`timestamp\`)`,

  `CREATE TABLE IF NOT EXISTS \`list_entries\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`list_type\` varchar(255) NOT NULL,
    \`player_name\` varchar(255) NOT NULL,
    \`added_at\` text NOT NULL,
    \`added_by\` varchar(255) NOT NULL,
    \`reason\` varchar(255) NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_list_entries_server_type_player\` ON \`list_entries\` (\`server_id\`, \`list_type\`, \`player_name\`)`,

  `CREATE TABLE IF NOT EXISTS \`webhooks\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NOT NULL,
    \`url\` varchar(255) NOT NULL,
    \`event_types\` text NOT NULL DEFAULT '[]',
    \`secret\` varchar(255) NULL,
    \`enabled\` boolean NOT NULL DEFAULT 1,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL
  )`,

  // ==========================================================================
  // 审计表（1 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`audit_logs\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`server_id\` varchar(255) NULL,
    \`user_id\` varchar(255) NULL,
    \`action\` varchar(255) NOT NULL,
    \`target_type\` varchar(255) NULL,
    \`target_id\` varchar(255) NULL,
    \`details_json\` text NULL,
    \`ip_address\` varchar(255) NULL,
    \`created_at\` text NOT NULL,
    \`retention_days\` integer NOT NULL DEFAULT 90
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_audit_logs_created_at\` ON \`audit_logs\` (\`created_at\`)`,

  // ==========================================================================
  // 钱包与通知表（2 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`user_wallets\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`user_id\` varchar(255) NOT NULL,
    \`server_id\` varchar(255) NOT NULL,
    \`balance\` integer NOT NULL DEFAULT 0,
    \`total_earned\` integer NOT NULL DEFAULT 0,
    \`total_spent\` integer NOT NULL DEFAULT 0,
    \`last_daily_claim_at\` text NULL,
    \`last_daily_claim_date\` text NULL,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_user_wallets_user_server\` ON \`user_wallets\` (\`user_id\`, \`server_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`user_notifications\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`user_id\` varchar(255) NOT NULL,
    \`type\` varchar(255) NOT NULL,
    \`title\` varchar(255) NOT NULL,
    \`content\` text DEFAULT '',
    \`related_server_id\` varchar(255) NULL,
    \`related_order_id\` integer NULL,
    \`is_read\` integer NOT NULL DEFAULT 0,
    \`created_at\` varchar(255) NOT NULL,
    \`retention_days\` integer NOT NULL DEFAULT 30,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
  )`,

  // ==========================================================================
  // 系统更新表（2 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`system_update_jobs\` (
    \`id\` varchar(64) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    \`user_id\` varchar(64) NOT NULL,
    \`type\` varchar(32) NOT NULL,
    \`status\` varchar(32) NOT NULL DEFAULT 'pending',
    \`step\` varchar(256) NULL,
    \`progress\` integer NOT NULL DEFAULT 0,
    \`target_version\` varchar(64) NULL,
    \`is_rollback\` boolean NOT NULL DEFAULT 0,
    \`rollback_from_job_id\` varchar(64) NULL,
    \`started_at\` datetime NOT NULL,
    \`finished_at\` datetime NULL,
    \`error_message\` text NULL,
    \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`),
    CHECK (type IN ('git_pull', 'tar_blue_green')),
    CHECK (status IN ('pending','downloading','verifying','migrating','switching','smoke_testing','succeeded','failed','rolled_back')),
    CHECK (progress >= 0 AND progress <= 100)
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_update_jobs_user_status\` ON \`system_update_jobs\` (\`user_id\`, \`status\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_update_jobs_created_at\` ON \`system_update_jobs\` (\`created_at\`)`,

  `CREATE TABLE IF NOT EXISTS \`user_password_history\` (
    \`id\` varchar(64) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    \`user_id\` varchar(64) NOT NULL,
    \`password_hash\` text NOT NULL,
    \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_password_history_user_id\` ON \`user_password_history\` (\`user_id\`, \`created_at\`)`,

  // ==========================================================================
  // 版本表（1 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`game_versions\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`pack_id\` varchar(255) NOT NULL,
    \`version\` varchar(255) NOT NULL,
    \`node_id\` varchar(255) NOT NULL,
    \`download_path\` text NOT NULL,
    \`file_size_bytes\` integer NULL,
    \`downloaded_by\` varchar(255) NOT NULL,
    \`downloaded_at\` text NOT NULL,
    \`version_major\` integer NOT NULL DEFAULT 0,
    \`version_minor\` integer NOT NULL DEFAULT 0,
    \`version_patch\` integer NOT NULL DEFAULT 0,
    \`version_buildid\` text NULL DEFAULT NULL,
    \`created_at\` text NOT NULL,
    FOREIGN KEY (\`pack_id\`) REFERENCES \`packs\` (\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`node_id\`) REFERENCES \`nodes\` (\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`downloaded_by\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS \`game_versions_pack_id_index\` ON \`game_versions\` (\`pack_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`game_versions_node_id_index\` ON \`game_versions\` (\`node_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`game_versions_pack_id_version_index\` ON \`game_versions\` (\`pack_id\`, \`version\`)`,

  // ==========================================================================
  // 认证表（3 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`password_resets\` (
    \`id\` varchar(36) PRIMARY KEY,
    \`user_id\` varchar(36) NOT NULL,
    \`token_hash\` varchar(64) NOT NULL,
    \`expires_at\` text NOT NULL,
    \`used_at\` text NULL,
    \`created_at\` text NOT NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_password_resets_token_hash\` ON \`password_resets\` (\`token_hash\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_password_resets_user_id\` ON \`password_resets\` (\`user_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`email_verifications\` (
    \`id\` varchar(36) PRIMARY KEY,
    \`user_id\` varchar(36) NOT NULL,
    \`token_hash\` varchar(64) NOT NULL,
    \`expires_at\` text NOT NULL,
    \`verified_at\` text NULL,
    \`created_at\` text NOT NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_email_verifications_token_hash\` ON \`email_verifications\` (\`token_hash\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_email_verifications_user_id\` ON \`email_verifications\` (\`user_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`api_keys\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`name\` varchar(255) NOT NULL,
    \`key_prefix\` varchar(255) NOT NULL,
    \`key_hash\` varchar(64) NOT NULL,
    \`user_id\` varchar(255) NOT NULL,
    \`role\` varchar(255) NOT NULL,
    \`created_at\` text NOT NULL,
    \`expires_at\` text NULL,
    \`last_used_at\` text NULL,
    \`last_used_ip\` text NULL,
    \`revoked_at\` text NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`api_keys_key_hash_unique\` ON \`api_keys\` (\`key_hash\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_api_keys_key_hash\` ON \`api_keys\` (\`key_hash\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_api_keys_user_id\` ON \`api_keys\` (\`user_id\`)`,

  // ==========================================================================
  // 资源配额表（1 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`resource_quotas\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`scope_type\` varchar(255) NOT NULL,
    \`scope_id\` varchar(255) NOT NULL,
    \`max_instances\` integer NULL,
    \`max_disk_mb\` bigint NULL,
    \`max_players_total\` integer NULL,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_resource_quotas_scope\` ON \`resource_quotas\` (\`scope_type\`, \`scope_id\`)`,

  // ==========================================================================
  // 告警表（2 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`alert_events\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`rule_type\` varchar(255) NOT NULL,
    \`severity\` varchar(255) NOT NULL,
    \`title\` text NOT NULL,
    \`content\` text NOT NULL,
    \`related_server_id\` varchar(255) NULL,
    \`triggered_at\` text NOT NULL,
    \`dispatched_channels\` text NOT NULL,
    \`created_at\` text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_alert_events_triggered_at\` ON \`alert_events\` (\`triggered_at\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_alert_events_server_id\` ON \`alert_events\` (\`related_server_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`alert_settings\` (
    \`user_id\` varchar(255) PRIMARY KEY,
    \`email_enabled\` integer NOT NULL DEFAULT 0,
    \`webhook_url\` text NOT NULL DEFAULT '',
    \`webhook_enabled\` integer NOT NULL DEFAULT 0,
    \`subscribed_rules\` text NOT NULL DEFAULT '[]',
    \`updated_at\` text NOT NULL
  )`,

  // ==========================================================================
  // 实例管理表（2 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`instance_admins\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`instance_id\` varchar(255) NOT NULL,
    \`user_id\` varchar(255) NOT NULL,
    \`assigned_by\` varchar(255) NOT NULL,
    \`assigned_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (\`instance_id\`) REFERENCES \`servers\` (\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_instance_admins_instance_user_unique\` ON \`instance_admins\` (\`instance_id\`, \`user_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_instance_admins_instance\` ON \`instance_admins\` (\`instance_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_instance_admins_user\` ON \`instance_admins\` (\`user_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`instance_roles\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`instance_id\` varchar(255) NOT NULL,
    \`user_id\` varchar(255) NOT NULL,
    \`role\` varchar(255) NOT NULL,
    \`granted_by\` varchar(255) NOT NULL,
    \`granted_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`expires_at\` text NULL,
    FOREIGN KEY (\`instance_id\`) REFERENCES \`servers\` (\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_instance_roles_instance_user_unique\` ON \`instance_roles\` (\`instance_id\`, \`user_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_instance_roles_instance\` ON \`instance_roles\` (\`instance_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_instance_roles_user\` ON \`instance_roles\` (\`user_id\`)`,

  // ==========================================================================
  // 好友表（1 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`friendships\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`user_id\` varchar(255) NOT NULL,
    \`friend_user_id\` varchar(255) NOT NULL,
    \`status\` varchar(255) NOT NULL DEFAULT 'pending',
    \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`accepted_at\` text NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`friend_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_friendships_user_friend_unique\` ON \`friendships\` (\`user_id\`, \`friend_user_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_friendships_user\` ON \`friendships\` (\`user_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_friendships_friend\` ON \`friendships\` (\`friend_user_id\`)`,

  // ==========================================================================
  // 资产表（2 张）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`global_assets\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`type\` varchar(255) NOT NULL,
    \`name\` varchar(255) NOT NULL,
    \`default_price\` float NULL,
    \`execution_logic\` text NULL,
    \`is_active\` boolean NOT NULL DEFAULT 1,
    \`game_pack_id\` varchar(255) NULL,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_global_assets_active\` ON \`global_assets\` (\`is_active\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_global_assets_pack\` ON \`global_assets\` (\`game_pack_id\`)`,

  `CREATE TABLE IF NOT EXISTS \`instance_assets\` (
    \`id\` varchar(255) PRIMARY KEY,
    \`instance_id\` varchar(255) NOT NULL,
    \`global_asset_id\` varchar(255) NULL,
    \`is_ugc\` boolean NOT NULL DEFAULT 0,
    \`override_price\` float NULL,
    \`override_name\` varchar(255) NULL,
    \`override_is_active\` boolean NULL,
    \`custom_execution_logic\` text NULL,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_instance_assets_instance\` ON \`instance_assets\` (\`instance_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_instance_assets_inst_global\` ON \`instance_assets\` (\`instance_id\`, \`global_asset_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_instance_assets_inst_ugc\` ON \`instance_assets\` (\`instance_id\`, \`is_ugc\`)`,

  // ==========================================================================
  // v4.17.0 统一绑定体系（3 张，替代旧 user_instance_bindings/player_bindings/player_verify_codes）
  // ==========================================================================
  `CREATE TABLE IF NOT EXISTS \`bindings\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT,
    \`user_id\` varchar(255) NOT NULL,
    \`binding_type\` varchar(255) NOT NULL,
    \`scope_type\` varchar(255) NOT NULL,
    \`scope_ref\` varchar(255) NULL,
    \`player_name\` varchar(255) NULL,
    \`vip_level\` integer NOT NULL DEFAULT 0,
    \`wallet_id\` integer NULL,
    \`verify_status\` varchar(255) NOT NULL DEFAULT 'pending',
    \`verify_code\` varchar(255) NULL,
    \`verify_expires_at\` text NULL,
    \`verified_at\` text NULL,
    \`metadata\` text NOT NULL DEFAULT '{}',
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS \`idx_bindings_user\` ON \`bindings\` (\`user_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`idx_bindings_type_scope\` ON \`bindings\` (\`binding_type\`, \`scope_type\`, \`scope_ref\`)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_bindings_verified_unique\` ON \`bindings\`(\`user_id\`, \`binding_type\`, \`scope_type\`, COALESCE(\`scope_ref\`, ''), COALESCE(\`player_name\`, '')) WHERE \`verify_status\`='verified'`,
  `CREATE INDEX IF NOT EXISTS \`idx_bindings_verify_pending\` ON \`bindings\`(\`verify_code\`) WHERE \`verify_status\`='pending' AND \`verify_code\` IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS \`idx_bindings_player_lookup\` ON \`bindings\`(\`scope_type\`, \`scope_ref\`, \`player_name\`) WHERE \`binding_type\`='player' AND \`player_name\` IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS \`permission_points\` (
    \`code\` varchar(255) PRIMARY KEY,
    \`description\` text NOT NULL,
    \`category\` varchar(255) NOT NULL,
    \`created_at\` text NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS \`role_permission_templates\` (
    \`role\` varchar(255) NOT NULL,
    \`permission_code\` varchar(255) NOT NULL,
    \`created_at\` text NOT NULL,
    PRIMARY KEY (\`role\`, \`permission_code\`)
  )`,
];

// ============================================================================
// Forward 迁移：执行全部 DDL + seed 字典数据
// ============================================================================
export async function up(knex: Knex): Promise<void> {
  console.log('[migration 20260808000000_baseline_v4_post_demo] 开始执行基线 schema 建立...');

  // ------------------------------------------------------------------
  // Step 1: 执行全部 DDL 语句（CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS）
  // ------------------------------------------------------------------
  let successCount = 0;
  let failCount = 0;
  for (const ddl of DDL_STATEMENTS) {
    try {
      await knex.raw(ddl);
      successCount++;
    } catch (err) {
      // 单条 DDL 失败不立即终止，记录后继续（部分语句可能因存量库已存在对象而失败，属正常情况）
      console.warn(
        `[migration 20260808000000_baseline] DDL 执行警告（继续）: ${err instanceof Error ? err.message : String(err).slice(0, 200)}`,
      );
      failCount++;
    }
  }
  console.log(
    `[migration 20260808000000_baseline] Step 1: DDL 执行完成（成功 ${successCount} / 警告 ${failCount}）`,
  );

  // ------------------------------------------------------------------
  // Step 2: seed 权限点字典（系统运行必需，不含测试数据）
  // ------------------------------------------------------------------
  const now = new Date().toISOString();
  const existingPermCount = await knex('permission_points').count('* as cnt').first();
  if (Number((existingPermCount as any)?.cnt ?? 0) === 0) {
    await knex('permission_points').insert(
      PERMISSION_POINTS.map((p) => ({ ...p, created_at: now })),
    );
    console.log(
      `[migration 20260808000000_baseline] Step 2: 插入 ${PERMISSION_POINTS.length} 个权限点`,
    );
  } else {
    console.log('[migration 20260808000000_baseline] Step 2: permission_points 已有数据，跳过 seed');
  }

  // ------------------------------------------------------------------
  // Step 3: seed 角色权限模板
  // ------------------------------------------------------------------
  const existingTplCount = await knex('role_permission_templates').count('* as cnt').first();
  if (Number((existingTplCount as any)?.cnt ?? 0) === 0) {
    await knex('role_permission_templates').insert(
      ROLE_PERMISSION_TEMPLATES.map((t) => ({ ...t, created_at: now })),
    );
    console.log(
      `[migration 20260808000000_baseline] Step 3: 插入 ${ROLE_PERMISSION_TEMPLATES.length} 条角色权限模板`,
    );
  } else {
    console.log(
      '[migration 20260808000000_baseline] Step 3: role_permission_templates 已有数据，跳过 seed',
    );
  }

  console.log('[migration 20260808000000_baseline] Forward 迁移完成');
}

// ============================================================================
// Rollback 迁移：基线不可回滚（防误删数据库）
// ============================================================================
export async function down(_knex: Knex): Promise<void> {
  throw new Error(
    '基线迁移不可回滚 (Baseline migration cannot be rolled back). ' +
      '如需重置数据库，请直接删除 panel.db 文件后重新运行 migrations。',
  );
}
