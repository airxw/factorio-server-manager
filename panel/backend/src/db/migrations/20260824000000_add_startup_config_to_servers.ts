// ============================================================================
// 20260824000000_add_startup_config_to_servers.ts
// v1.1.0 实例启动前置引导（方案 instance-startup-guide-and-action-bar-plan.md §4）
//
// 设计目标：
//   1. servers 表新增 startup_config_json 列（TEXT，nullable）
//      存储用户在启动向导中填写的基础设定（地图/世界名/种子/必填配置等）
//      格式：JSON 字符串 { field_key: string|number|boolean }
//      为空表示尚未完成启动引导；非空表示已保存（覆盖 Pack startup_guide.steps 的 required 项）
//   2. servers 表新增 startup_config_set_at 列（TEXT，nullable，ISO 8601）
//      引导完成时间戳，用于前端判断是否首次启动（null=未完成，需弹向导）
//
// 兼容性：
//   - up：ADD COLUMN（SQLite 支持，不锁表， nullable 默认 null）
//   - down：DROP COLUMN（SQLite 3.35+ 支持）
//   - 历史实例两列均为 null，后端 /start 校验时 startup_guide 不存在或 completed=false
//     会引导用户完成向导（向后兼容，不阻断已有实例）
//
// 来源：docs/plans/instance-startup-guide-and-action-bar-plan.md §4.1
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasStartupConfigJson = await knex.schema.hasColumn('servers', 'startup_config_json');
  const hasStartupConfigSetAt = await knex.schema.hasColumn('servers', 'startup_config_set_at');

  if (!hasStartupConfigJson || !hasStartupConfigSetAt) {
    await knex.schema.alterTable('servers', (table) => {
      if (!hasStartupConfigJson) {
        // 启动前置引导配置（JSON 字符串）
        table.text('startup_config_json').nullable().defaultTo(null);
      }
      if (!hasStartupConfigSetAt) {
        // 引导完成时间戳
        table.string('startup_config_set_at').nullable().defaultTo(null);
      }
    });
  }

  console.log(
    `[migration 20260824000000] servers.startup_config_json=${hasStartupConfigJson ? '已存在' : '已创建'} / startup_config_set_at=${hasStartupConfigSetAt ? '已存在' : '已创建'}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  const hasStartupConfigJson = await knex.schema.hasColumn('servers', 'startup_config_json');
  const hasStartupConfigSetAt = await knex.schema.hasColumn('servers', 'startup_config_set_at');

  if (!hasStartupConfigJson && !hasStartupConfigSetAt) {
    console.log('[migration 20260824000000] servers 启动配置列不存在，跳过回滚');
    return;
  }

  await knex.schema.alterTable('servers', (table) => {
    if (hasStartupConfigJson) table.dropColumn('startup_config_json');
    if (hasStartupConfigSetAt) table.dropColumn('startup_config_set_at');
  });

  console.log('[migration 20260824000000] 回滚：删除 servers 启动配置列');
}
