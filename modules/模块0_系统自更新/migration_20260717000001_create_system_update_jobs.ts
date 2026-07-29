// ============================================================================
// migration_20260717000001_create_system_update_jobs.ts
// 模块0_系统自更新：system_update_jobs 表迁移
//
// 数据契约：public/schema/system_update_jobs-schema.json
// 来源：s0103 融合定稿 v3.4.0 §互斥点① B 蓝绿为主 + A git 可选
//
// 字段说明：
//   - id: UUID 主键，SQLite 用 randomblob(16) 生成（lower(hex(...)) 为 36 字符 UUID 格式
//         去横线形式；service 层也可显式 crypto.randomUUID() 写入）
//   - user_id: 发起任务的用户 ID（FK → users.id）
//   - type: 更新类型 git_pull / tar_blue_green
//   - status: 9 态状态机
//       pending→downloading→verifying→migrating→switching→smoke_testing→
//       succeeded/failed；rollback 路径：failed→rolled_back
//   - step: 当前步骤人类可读描述
//   - progress: 0-100 进度百分比
//   - target_version: 目标版本号（语义版本）
//   - is_rollback: 是否为回滚任务
//   - rollback_from_job_id: 回滚任务指向原更新任务 ID
//   - started_at / finished_at: 任务开始/完成时间
//   - error_message: 失败时的错误消息
//   - created_at / updated_at: 记录创建/更新时间
//
// 索引：
//   - idx_update_jobs_user_status: (user_id, status) 部分索引，
//     强制同一 user_id 仅允许 1 个 running 状态任务（status IN 运行态）
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 幂等保护：表已存在则跳过
  const hasTable = await knex.schema.hasTable('system_update_jobs');
  if (hasTable) {
    return;
  }

  await knex.schema.createTable('system_update_jobs', (table) => {
    // UUID 主键：SQLite 用 randomblob(16) 生成 32 字符 hex（无横线 UUID）
    // service 层优先用 crypto.randomUUID() 显式写入，此 default 作为兜底
    table
      .string('id', 64)
      .primary()
      .defaultTo(knex.raw("(lower(hex(randomblob(16))))"));

    // 发起任务的用户 ID（FK → users.id）
    // SQLite 不强制外键（默认 off），但保留 references 声明语义
    table.string('user_id', 64).notNullable().references('id').inTable('users');

    // 更新类型
    table.string('type', 32).notNullable();
    table.check("type IN ('git_pull', 'tar_blue_green')");

    // 任务状态机（9 态），默认 pending
    table.string('status', 32).notNullable().defaultTo('pending');
    table.check(
      "status IN ('pending','downloading','verifying','migrating','switching','smoke_testing','succeeded','failed','rolled_back')",
    );

    // 当前步骤人类可读描述
    table.string('step', 256).nullable().defaultTo(null);

    // 进度百分比 0-100
    table.integer('progress').notNullable().defaultTo(0);
    table.check('progress >= 0 AND progress <= 100');

    // 目标版本号（语义版本，可空）
    table.string('target_version', 64).nullable().defaultTo(null);

    // 是否为回滚任务
    table.boolean('is_rollback').notNullable().defaultTo(false);

    // 回滚任务指向原更新任务 ID（可空）
    table.string('rollback_from_job_id', 64).nullable().defaultTo(null);

    // 任务开始时间
    table.timestamp('started_at', { useTz: true }).notNullable();

    // 任务完成时间（succeeded/failed/rolled_back 时设置）
    table.timestamp('finished_at', { useTz: true }).nullable().defaultTo(null);

    // 失败时的错误消息
    table.text('error_message').nullable().defaultTo(null);

    // 记录创建/更新时间
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // 索引：按用户查询任务列表 + 状态过滤
    table.index(['user_id', 'status'], 'idx_update_jobs_user_status');
    // 索引：按创建时间排序（最近任务查询）
    table.index('created_at', 'idx_update_jobs_created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('system_update_jobs');
}
