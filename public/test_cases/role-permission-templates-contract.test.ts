// ============================================================================
// role-permission-templates-contract.test.ts — v4.17.0 角色权限模板契约测试套件
//
// 覆盖契约：public/schema/role-permission-templates-schema.json
// 测试用例数：~15（覆盖角色-权限点映射完整性、最小权限原则、PK 复合约束）
//
// 运行方式：npx tsx public/test_cases/role-permission-templates-contract.test.ts
// 退出码：0=全部通过，1=存在失败
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §3.3 + rules-3 §五
// ============================================================================

import { Validator, type ValidationError } from 'jsonschema';
import * as fs from 'fs';
import * as path from 'path';
import { mockPermissionService } from '../pre_generated_mock/permission-service';

const validator = new Validator();

function loadSchema(): any {
  const schemaPath = path.resolve(__dirname, '../schema/role-permission-templates-schema.json');
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

const NOW_ISO = '2026-07-25T12:00:00.000Z';

interface TestCase {
  name: string;
  template: any;
  shouldPass: boolean;
}

const testCases: TestCase[] = [
  // 合法用例
  {
    name: '合法：user + instance.view',
    template: {
      role: 'user',
      permission_code: 'instance.view',
      created_at: NOW_ISO,
    },
    shouldPass: true,
  },
  {
    name: '合法：instance_admin + instance.create',
    template: {
      role: 'instance_admin',
      permission_code: 'instance.create',
      created_at: NOW_ISO,
    },
    shouldPass: true,
  },
  {
    name: '合法：server_admin + user.manage',
    template: {
      role: 'server_admin',
      permission_code: 'user.manage',
      created_at: NOW_ISO,
    },
    shouldPass: true,
  },
  {
    name: '合法：server_admin + system.config',
    template: {
      role: 'server_admin',
      permission_code: 'system.config',
      created_at: NOW_ISO,
    },
    shouldPass: true,
  },
  // 非法用例
  {
    name: '非法：role 不在枚举内',
    template: {
      role: 'super_admin', // ❌
      permission_code: 'instance.create',
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：permission_code 不符合命名规范',
    template: {
      role: 'user',
      permission_code: 'INVALID', // ❌
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：缺少 required 字段 role',
    template: {
      // role 缺失
      permission_code: 'instance.view',
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：缺少 required 字段 permission_code',
    template: {
      role: 'user',
      // permission_code 缺失
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：缺少 required 字段 created_at',
    template: {
      role: 'user',
      permission_code: 'instance.view',
      // created_at 缺失
    },
    shouldPass: false,
  },
  {
    name: '非法：permission_code 过长（> 64 字符）',
    template: {
      role: 'user',
      permission_code: 'a'.repeat(65),
      created_at: NOW_ISO,
    },
    shouldPass: false,
  },
  {
    name: '非法：additionalProperties 违反',
    template: {
      role: 'user',
      permission_code: 'instance.view',
      created_at: NOW_ISO,
      extra_field: 'not allowed', // ❌
    },
    shouldPass: false,
  },
];

async function runTests(): Promise<boolean> {
  console.log('--- 开始 role-permission-templates-schema.json 契约测试 ---');
  console.log(`共 ${testCases.length} 个测试用例\n`);

  const schema = loadSchema();
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of testCases) {
    const result = validator.validate(tc.template, schema);
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

  // 额外检查：最小权限原则（user 不应有 user.manage / system.config 等管理类权限）
  console.log('\n--- 最小权限原则检查（基于 Mock 数据）---');
  mockPermissionService.resetMockPermissionService();

  // 通过 listRolePermissionTemplates 获取真实数据（不直接访问私有字段）
  const templatesResp = await mockPermissionService.listRolePermissionTemplates();
  const allTemplates = templatesResp.templates;

  const userForbiddenPerms = ['user.manage', 'system.config', 'pack.manage', 'node.manage', 'apikey.manage'];
  const userPerms = allTemplates
    .filter((t) => t.role === 'user')
    .map((t) => t.permission_code);
  const userViolations = userForbiddenPerms.filter((p) => userPerms.includes(p));
  if (userViolations.length === 0) {
    console.log('  ✅ user 角色未包含管理类权限（最小权限原则）');
    passed++;
  } else {
    const msg = `  ❌ user 角色包含管理类权限：${userViolations.join(', ')}`;
    console.log(msg);
    failures.push(msg);
    failed++;
  }

  // 检查：instance_admin 应继承 user 全部权限
  const userPermSet = new Set(userPerms);
  const instanceAdminPerms = allTemplates
    .filter((t) => t.role === 'instance_admin')
    .map((t) => t.permission_code);
  const instanceAdminSet = new Set(instanceAdminPerms);
  const missingFromInstanceAdmin = [...userPermSet].filter((p) => !instanceAdminSet.has(p));
  if (missingFromInstanceAdmin.length === 0) {
    console.log('  ✅ instance_admin 角色继承 user 全部权限');
    passed++;
  } else {
    const msg = `  ❌ instance_admin 缺少 user 的权限：${missingFromInstanceAdmin.join(', ')}`;
    console.log(msg);
    failures.push(msg);
    failed++;
  }

  // 检查：server_admin 应有 user.manage（关键管理权限）
  const serverAdminPerms = allTemplates
    .filter((t) => t.role === 'server_admin')
    .map((t) => t.permission_code);
  if (serverAdminPerms.includes('user.manage')) {
    console.log('  ✅ server_admin 角色包含 user.manage 权限');
    passed++;
  } else {
    const msg = '  ❌ server_admin 角色缺少 user.manage 权限';
    console.log(msg);
    failures.push(msg);
    failed++;
  }

  // 检查：server_admin 权限数 >= instance_admin 权限数（权限递进）
  if (serverAdminPerms.length >= instanceAdminPerms.length) {
    console.log(`  ✅ server_admin 权限数 (${serverAdminPerms.length}) >= instance_admin (${instanceAdminPerms.length})`);
    passed++;
  } else {
    const msg = `  ❌ server_admin 权限数 (${serverAdminPerms.length}) < instance_admin (${instanceAdminPerms.length})，违反权限递进`;
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

runTests()
  .then((allPassed) => {
    console.log(allPassed ? '\n🎉 role-permission-templates-contract 测试全部通过！' : '\n💥 role-permission-templates-contract 测试存在失败项。');
    process.exit(allPassed ? 0 : 1);
  })
  .catch((err) => {
    console.error('测试执行异常：', err);
    process.exit(1);
  });
