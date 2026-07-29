// ============================================================================
// Vitest 全局 setup — 清理 mock、重置 dbInstance 单例
// 该文件由 vitest.config.ts 的 setupFiles 加载，每个测试文件执行前运行
// ============================================================================

import { afterEach } from 'vitest';
import { closeDatabase } from '../db/connection.js';

// 每个测试结束后重置 dbInstance 单例，防止测试间状态泄漏。
// createTestDb 创建的是独立实例（不走 initDatabase），此处仅清理可能被
// 触发的单例；未初始化时 closeDatabase 为 no-op。
afterEach(async () => {
  try {
    await closeDatabase();
  } catch {
    // 未初始化时为 no-op，忽略
  }
});
