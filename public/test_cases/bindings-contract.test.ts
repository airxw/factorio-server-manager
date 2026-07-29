// ============================================================================
// bindings-contract.test.ts — v4.17.0 统一绑定数据契约测试套件
//
// 覆盖契约：public/schema/bindings-schema.json
// 测试用例数：~30（覆盖 binding_type / scope_type / verify_status 全组合 + CHECK 约束违反）
//
// 运行方式：npx tsx public/test_cases/bindings-contract.test.ts
// 退出码：0=全部通过，1=存在失败
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §2.6 + rules-3 §五
// ============================================================================

import { Validator, type ValidationError } from 'jsonschema';
import * as fs from 'fs';
import * as path from 'path';

const validator = new Validator();

function loadSchema(): any {
  const schemaPath = path.resolve(__dirname, '../schema/bindings-schema.json');
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function loadConfig(): any {
  const configPath = path.resolve(__dirname, '../config_template/binding.config.schema.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

interface TestCase {
  name: string;
  binding: any;
  shouldPass: boolean;
  expectedErrorPath?: string;
}

const NOW_ISO = '2026-07-25T12:00:00.000Z';
const FUTURE_ISO = '2026-07-25T12:05:00.000Z';

const testCases: TestCase[] = [
  // ===== 合法用例（应通过） =====

  // 1. account + instance + verified
  {
    name: '合法：account + instance + verified（迁移自 user_instance_bindings active）',
    binding: {
      id: 1,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: 'server-uuid-001',
      player_name: null,
      vip_level: 2,
      wallet_id: 100,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: '2026-07-20T10:00:00.000Z',
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: true,
  },

  // 2. player + instance + verified（v4.27.0: 由 game_type 改为 instance 语义）
  {
    name: '合法：player + instance + verified（迁移自 player_bindings verified）',
    binding: {
      id: 2,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-001',
      player_name: 'Steve_Builder',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: '2026-07-21T14:30:00.000Z',
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: true,
  },

  // 3. player + instance + pending
  {
    name: '合法：player + instance + pending（含 verify_code + verify_expires_at）',
    binding: {
      id: 3,
      user_id: '22222222-2222-2222-2222-222222222222',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-002',
      player_name: 'Alex_Miner',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'pending',
      verify_code: '654321',
      verify_expires_at: FUTURE_ISO,
      verified_at: null,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: true,
  },

  // 4. player + instance + expired
  {
    name: '合法：player + instance + expired',
    binding: {
      id: 4,
      user_id: '33333333-3333-3333-3333-333333333333',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-003',
      player_name: 'Bob_Crafter',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'expired',
      verify_code: '111222',
      verify_expires_at: '2026-07-25T11:55:00.000Z',
      verified_at: null,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: true,
  },

  // 5. account + instance + revoked
  {
    name: '合法：account + instance + revoked',
    binding: {
      id: 5,
      user_id: '44444444-4444-4444-4444-444444444444',
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: 'server-uuid-004',
      player_name: null,
      vip_level: 0,
      wallet_id: null,
      verify_status: 'revoked',
      verify_code: null,
      verify_expires_at: null,
      verified_at: null,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: true,
  },

  // 6. account + global scope（账户级全局绑定，scope_ref=null）
  // 注：schema allOf 中 account 要求 scope_type=instance，此用例预期失败
  // 改为合法用例：global scope 必须配合 binding_type 不为 account
  // 实际 schema 限制 account 必须 scope_type=instance，所以 global 只能是 player
  // 但 player 也要求 player_name，所以 global + account + scope_ref=null 不合法
  // 移除该用例，改为 player + global + scope_ref=null
  {
    name: '合法：player + global + scope_ref=null（全局玩家绑定，如跨游戏类型）',
    binding: {
      id: 7,
      user_id: '66666666-6666-6666-6666-666666666666',
      binding_type: 'player',
      scope_type: 'global',
      scope_ref: null,
      player_name: 'Global_Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: true,
  },

  // ===== 非法用例（应失败） =====

  // 7. player 缺少 player_name（违反 CHECK 约束）
  {
    name: '非法：player 类型缺少 player_name',
    binding: {
      id: 8,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-001',
      player_name: null, // ❌ player 必须有 player_name
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 8. account + scope_type != instance（违反 CHECK 约束）
  {
    name: '非法：account 类型 scope_type 不是 instance',
    binding: {
      id: 9,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'account',
      scope_type: 'game_type', // ❌ account 必须 scope_type=instance
      scope_ref: 'minecraft',
      player_name: null,
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 9. global scope 但 scope_ref 非 null
  {
    name: '非法：global scope 但 scope_ref 非 null',
    binding: {
      id: 10,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'global',
      scope_ref: 'should_be_null', // ❌ global 必须 scope_ref=null
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 10. instance scope 完全缺失 scope_ref 字段（违反 allOf required 约束）
  {
    name: '非法：instance scope 完全缺失 scope_ref 字段',
    binding: {
      id: 11,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'account',
      scope_type: 'instance',
      // scope_ref 字段完全缺失（违反 allOf: instance/game_type → required scope_ref）
      player_name: null,
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 11. pending 缺少 verify_code
  {
    name: '非法：pending 状态缺少 verify_code',
    binding: {
      id: 12,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'pending',
      // verify_code 缺失
      verify_expires_at: FUTURE_ISO,
      verified_at: null,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 12. verified 但 verify_code 非 null
  {
    name: '非法：verified 状态 verify_code 非 null',
    binding: {
      id: 13,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: '123456', // ❌ verified 必须 verify_code=null
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 13. verified 缺少 verified_at
  {
    name: '非法：verified 状态缺少 verified_at',
    binding: {
      id: 14,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      // verified_at 缺失
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 14. vip_level 超出范围（>5）
  {
    name: '非法：vip_level > 5',
    binding: {
      id: 15,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: null,
      vip_level: 6, // ❌ 最大 5
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 15. vip_level 负数
  {
    name: '非法：vip_level < 0',
    binding: {
      id: 16,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'account',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: null,
      vip_level: -1, // ❌ 最小 0
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 16. 非法 binding_type
  {
    name: '非法：binding_type 不在枚举内',
    binding: {
      id: 17,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'invalid_type', // ❌
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: null,
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 17. 非法 scope_type
  {
    name: '非法：scope_type 不在枚举内',
    binding: {
      id: 18,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'invalid_scope', // ❌
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 18. 非法 verify_status
  {
    name: '非法：verify_status 不在枚举内',
    binding: {
      id: 19,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'invalid_status', // ❌
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 19. user_id 非 UUID 格式
  {
    name: '非法：user_id 非 UUID 格式',
    binding: {
      id: 20,
      user_id: 'not-a-uuid', // ❌
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 20. player_name 不符合 pattern
  {
    name: '非法：player_name 含非法字符（空格）',
    binding: {
      id: 21,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player With Space', // ❌ pattern ^[a-zA-Z0-9_-]{1,32}$
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 21. player_name 过长
  {
    name: '非法：player_name 超过 32 字符',
    binding: {
      id: 22,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'A'.repeat(33), // ❌ maxLength 64 但 pattern 限制 1-32
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 22. id 非整数
  {
    name: '非法：id 非整数',
    binding: {
      id: 'not-a-number', // ❌
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 23. id < 1
  {
    name: '非法：id < 1',
    binding: {
      id: 0, // ❌ minimum 1
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 24. additionalProperties 违反（多余字段）
  {
    name: '非法：包含 additionalProperties 之外的字段',
    binding: {
      id: 25,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
      extra_field: 'not allowed', // ❌ additionalProperties: false
    },
    shouldPass: false,
  },

  // 25. 缺少 required 字段 user_id
  {
    name: '非法：缺少 required 字段 user_id',
    binding: {
      id: 26,
      // user_id 缺失
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 26. 缺少 required 字段 binding_type
  {
    name: '非法：缺少 required 字段 binding_type',
    binding: {
      id: 27,
      user_id: '11111111-1111-1111-1111-111111111111',
      // binding_type 缺失
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 27. 缺少 required 字段 verify_status
  {
    name: '非法：缺少 required 字段 verify_status',
    binding: {
      id: 28,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      // verify_status 缺失
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 28. 缺少 required 字段 created_at
  {
    name: '非法：缺少 required 字段 created_at',
    binding: {
      id: 29,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: '{}',
      // created_at 缺失
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 29. metadata 非 string 类型
  {
    name: '非法：metadata 非 string 类型（直接传对象）',
    binding: {
      id: 30,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'verified',
      verify_code: null,
      verify_expires_at: null,
      verified_at: NOW_ISO,
      metadata: { key: 'value' }, // ❌ metadata 必须是 JSON 字符串
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },

  // 30. verify_code 过短（< 4）
  {
    name: '非法：verify_code 长度 < 4',
    binding: {
      id: 31,
      user_id: '11111111-1111-1111-1111-111111111111',
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-001',
      player_name: 'Player',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'pending',
      verify_code: '12', // ❌ minLength 4
      verify_expires_at: FUTURE_ISO,
      verified_at: null,
      metadata: '{}',
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    shouldPass: false,
  },
];

function runTests(): boolean {
  console.log('--- 开始 bindings-schema.json 契约测试 ---');
  console.log(`共 ${testCases.length} 个测试用例\n`);

  const schema = loadSchema();
  const config = loadConfig();
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of testCases) {
    const result = validator.validate(tc.binding, schema);
    const actualPass = result.valid;

    if (actualPass === tc.shouldPass) {
      console.log(`  ✅ ${tc.name}`);
      passed++;
    } else {
        const msg = `  ❌ ${tc.name}\n     预期: ${tc.shouldPass ? '通过' : '失败'}, 实际: ${actualPass ? '通过' : '失败'}\n     错误: ${result.errors.map((e: ValidationError) => e.toString()).join('; ')}`;
      console.log(msg);
      failures.push(msg);
      failed++;
    }
  }

  // 额外检查：配置契约与 schema 字段对齐
  console.log('\n--- 配置契约一致性检查 ---');
  const configRequiredFields = ['verify_code_ttl_seconds', 'verify_code_length', 'verify_code_max_attempts', 'verify_code_lockout_minutes', 'verify_code_format'];
  const configHasAllRequired = configRequiredFields.every((f) => f in config.properties);
  if (configHasAllRequired) {
    console.log('  ✅ binding.config.schema.json 包含全部 required 字段');
    passed++;
  } else {
    const msg = '  ❌ binding.config.schema.json 缺少 required 字段';
    console.log(msg);
    failures.push(msg);
    failed++;
  }

  // 检查默认值
  const defaultsPresent = configRequiredFields.every((f) => config.properties[f].default !== undefined);
  if (defaultsPresent) {
    console.log('  ✅ binding.config.schema.json 全部 required 字段有默认值');
    passed++;
  } else {
    const msg = '  ❌ binding.config.schema.json 部分 required 字段缺少默认值';
    console.log(msg);
    failures.push(msg);
    failed++;
  }

  console.log(`\n--- 测试结果：${passed} 通过 / ${failed} 失败 / 共 ${passed + failed} ---`);
  if (failed > 0) {
    console.log('\n失败用例详情：');
    failures.forEach((f) => console.log(f));
  }
  return failed === 0;
}

const allPassed = runTests();
console.log(allPassed ? '\n🎉 bindings-contract 测试全部通过！' : '\n💥 bindings-contract 测试存在失败项。');
process.exit(allPassed ? 0 : 1);
