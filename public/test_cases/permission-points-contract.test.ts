// ============================================================================
// permission-points-contract.test.ts — v4.17.0 权限点字典契约测试套件
//
// 覆盖契约：public/schema/permission-points-schema.json
// 测试用例数：~10（覆盖 category 枚举、code 命名规范、required 字段）
//
// 运行方式：npx tsx public/test_cases/permission-points-contract.test.ts
// 退出码：0=全部通过，1=存在失败
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §3.3 + rules-3 §五
// ============================================================================

import { Validator, type ValidationError } from 'jsonschema';
import * as fs from 'fs';
import * as path from 'path';

const validator = new Validator();

function loadSchema(): any {
  const schemaPath = path.resolve(__dirname, '../schema/permission-points-schema.json');
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

const NOW_ISO = '2026-07-25T12:00:00.000Z';

interface TestCase {
  name: string;
  point: any;
  shouldPass: boolean;
}

const testCases: TestCase[] = [
  // 合法用例
  {
    name: '合法：instance.create 权限点',
    point: {
      code: 'instance.create',
      description: '创建实例',
      category: 'instance',
      created_at: NOW_ISO,
    },
    shouldPass: true,
  },
  {
    name: '合法：binding.verify 三段式权限点',
    point: {
      code: 'binding.verify',
      description: '验证绑定',
      category: 'binding',
      created_at: NOW_ISO,
    },
    shouldPass: true,
  },
  {
    name: '合法：user.role.manage 三段式权限点',
    point: {
      code: 'user.role.manage',
      description: '调整用户角色集合',
      category: 'user',
      created_at: NOW_ISO,
    },
    shouldPass: true,
  },
  {
    name: '合法：wallet.claim_daily 三段式权限点',
    point: {
      code: 'wallet.claim_daily',
      description: '领取每日点券',
      category: 'wallet',
      created_at: NOW_ISO,
    },
    shouldPass: true,
  },
  // 非法用例
  {
    name: '非法：code 不符合命名规范（含大写）',
    point: {
      code: 'Instance.Create', // ❌ pattern ^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$
      description: '创建实例',
      category: 'instance',
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：code 不符合命名规范（含数字）',
    point: {
      code: 'instance.create2', // ❌
      description: '创建实例',
      category: 'instance',
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：code 不符合命名规范（单段无点）',
    point: {
      code: 'instance', // ❌ 至少需要 a.b 格式
      description: '实例',
      category: 'instance',
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：category 不在枚举内',
    point: {
      code: 'test.action',
      description: '测试',
      category: 'invalid_category', // ❌
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：缺少 required 字段 description',
    point: {
      code: 'test.action',
      // description 缺失
      category: 'test',
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：description 空字符串',
    point: {
      code: 'test.action',
      description: '', // ❌ minLength 1
      category: 'test',
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
];

function runTests(): boolean {
  console.log('--- 开始 permission-points-schema.json 契约测试 ---');
  console.log(`共 ${testCases.length} 个测试用例\n`);

  const schema = loadSchema();
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of testCases) {
    const result = validator.validate(tc.point, schema);
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

  // 额外检查：category 枚举完整性
  console.log('\n--- category 枚举完整性检查 ---');
  const expectedCategories = [
    'instance', 'binding', 'wallet', 'vip', 'user',
    'node', 'asset', 'pack', 'cdk', 'store', 'shop',
    'backup', 'save', 'mod', 'file', 'cleanup', 'batch', 'operation',
    'chat', 'vote', 'periodic_message', 'player', 'lists',
    'system', 'quota', 'monitor', 'maintenance',
    'apikey', 'ssl', 'tunnel', 'webhook', 'audit',
    'settings', 'discover', 'platform_stats',
  ];
  const schemaCategories = schema.properties.category.enum;
  const missingCategories = expectedCategories.filter((c) => !schemaCategories.includes(c));
  if (missingCategories.length === 0) {
    console.log(`  ✅ category 枚举完整（${schemaCategories.length} 项，覆盖五大资源类）`);
    passed++;
  } else {
    const msg = `  ❌ category 枚举缺失：${missingCategories.join(', ')}`;
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
console.log(allPassed ? '\n🎉 permission-points-contract 测试全部通过！' : '\n💥 permission-points-contract 测试存在失败项。');
process.exit(allPassed ? 0 : 1);
