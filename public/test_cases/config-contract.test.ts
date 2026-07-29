// ============================================================================
// config-contract.test.ts — v4.17.0 配置契约测试套件
//
// 覆盖契约：
//   - public/config_template/binding.config.schema.json
//   - public/config_template/permission.config.schema.json
//   - public/config_template/webhook.config.schema.json
//
// 测试用例数：~30（覆盖 required 字段、默认值、取值范围、枚举、additionalProperties=false、安全约束）
//
// 运行方式：npx tsx public/test_cases/config-contract.test.ts
// 退出码：0=全部通过，1=存在失败
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §2.6 + §8.4 + §10.3 + rules-3 §三 配置契约
// ============================================================================

import { Validator, type ValidationError } from 'jsonschema';
import * as fs from 'fs';
import * as path from 'path';

const validator = new Validator();

interface SchemaInfo {
  filename: string;
  displayName: string;
  schema: any;
}

function loadConfigSchema(filename: string, displayName: string): SchemaInfo {
  const schemaPath = path.resolve(__dirname, '../config_template', filename);
  const raw = fs.readFileSync(schemaPath, 'utf8');
  return { filename, displayName, schema: JSON.parse(raw) };
}

interface TestCase {
  name: string;
  config: any;
  shouldPass: boolean;
}

// ===========================================================================
// 1. binding.config.schema.json 测试用例
// ===========================================================================
const bindingConfigTests: TestCase[] = [
  // 合法用例
  {
    name: '[binding] 合法：仅 required 字段（其他用默认值由 zod 补全）',
    config: {
      verify_code_ttl_seconds: 300,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
    },
    shouldPass: true,
  },
  {
    name: '[binding] 合法：全字段填充',
    config: {
      verify_code_ttl_seconds: 600,
      verify_code_length: 8,
      verify_code_max_attempts: 3,
      verify_code_lockout_minutes: 60,
      verify_code_format: '^\\d{8}$',
      verify_code_charset: '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ',
      max_bindings_per_user_per_scope: 5,
      webhook_callback_timeout_seconds: 30,
    },
    shouldPass: true,
  },
  {
    name: '[binding] 合法：边界值（ttl=60）',
    config: {
      verify_code_ttl_seconds: 60,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
    },
    shouldPass: true,
  },
  {
    name: '[binding] 合法：边界值（ttl=3600）',
    config: {
      verify_code_ttl_seconds: 3600,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
    },
    shouldPass: true,
  },
  // 非法用例
  {
    name: '[binding] 非法：ttl 小于 60',
    config: {
      verify_code_ttl_seconds: 30,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
    },
    shouldPass: false,
  },
  {
    name: '[binding] 非法：ttl 大于 3600',
    config: {
      verify_code_ttl_seconds: 7200,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
    },
    shouldPass: false,
  },
  {
    name: '[binding] 非法：verify_code_length 小于 4',
    config: {
      verify_code_ttl_seconds: 300,
      verify_code_length: 3,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
    },
    shouldPass: false,
  },
  {
    name: '[binding] 非法：verify_code_length 大于 8',
    config: {
      verify_code_ttl_seconds: 300,
      verify_code_length: 9,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
    },
    shouldPass: false,
  },
  {
    name: '[binding] 非法：verify_code_format 不匹配 ^...$ 形态',
    config: {
      verify_code_ttl_seconds: 300,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '\\d{6}', // ❌ 缺少 ^...$ 锚定
    },
    shouldPass: false,
  },
  {
    name: '[binding] 非法：缺少 required 字段 verify_code_format',
    config: {
      verify_code_ttl_seconds: 300,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      // verify_code_format 缺失
    },
    shouldPass: false,
  },
  {
    name: '[binding] 非法：未知字段（additionalProperties=false）',
    config: {
      verify_code_ttl_seconds: 300,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
      secret_in_file: 'super-secret-do-not-do-this', // ❌ 敏感字段不得入配置文件
    },
    shouldPass: false,
  },
  {
    name: '[binding] 非法：max_bindings_per_user_per_scope=0',
    config: {
      verify_code_ttl_seconds: 300,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
      max_bindings_per_user_per_scope: 0,
    },
    shouldPass: false,
  },
  {
    name: '[binding] 非法：webhook_callback_timeout_seconds 大于 60',
    config: {
      verify_code_ttl_seconds: 300,
      verify_code_length: 6,
      verify_code_max_attempts: 5,
      verify_code_lockout_minutes: 30,
      verify_code_format: '^\\d{6}$',
      webhook_callback_timeout_seconds: 120,
    },
    shouldPass: false,
  },
];

// ===========================================================================
// 2. permission.config.schema.json 测试用例
// ===========================================================================
const permissionConfigTests: TestCase[] = [
  // 合法用例
  {
    name: '[permission] 合法：仅 required 字段',
    config: {
      cache_ttl_seconds: 300,
      cache_max_entries: 100,
      fail_closed: true,
    },
    shouldPass: true,
  },
  {
    name: '[permission] 合法：全字段填充',
    config: {
      cache_ttl_seconds: 600,
      cache_max_entries: 500,
      cache_prewarm_on_startup: false,
      fail_closed: false,
      superadmin_bypass_cache: false,
      audit_permission_checks: true,
      role_template_editable: true,
    },
    shouldPass: true,
  },
  {
    name: '[permission] 合法：cache_ttl_seconds=0（禁用缓存）',
    config: {
      cache_ttl_seconds: 0,
      cache_max_entries: 100,
      fail_closed: true,
    },
    shouldPass: true,
  },
  {
    name: '[permission] 合法：cache_max_entries 边界值 10000',
    config: {
      cache_ttl_seconds: 300,
      cache_max_entries: 10000,
      fail_closed: true,
    },
    shouldPass: true,
  },
  // 非法用例
  {
    name: '[permission] 非法：cache_ttl_seconds 大于 3600',
    config: {
      cache_ttl_seconds: 7200,
      cache_max_entries: 100,
      fail_closed: true,
    },
    shouldPass: false,
  },
  {
    name: '[permission] 非法：cache_ttl_seconds 负数',
    config: {
      cache_ttl_seconds: -1,
      cache_max_entries: 100,
      fail_closed: true,
    },
    shouldPass: false,
  },
  {
    name: '[permission] 非法：cache_max_entries 小于 10',
    config: {
      cache_ttl_seconds: 300,
      cache_max_entries: 5,
      fail_closed: true,
    },
    shouldPass: false,
  },
  {
    name: '[permission] 非法：cache_max_entries 大于 10000',
    config: {
      cache_ttl_seconds: 300,
      cache_max_entries: 50000,
      fail_closed: true,
    },
    shouldPass: false,
  },
  {
    name: '[permission] 非法：缺少 required 字段 fail_closed',
    config: {
      cache_ttl_seconds: 300,
      cache_max_entries: 100,
      // fail_closed 缺失
    },
    shouldPass: false,
  },
  {
    name: '[permission] 非法：fail_closed 类型错误（字符串）',
    config: {
      cache_ttl_seconds: 300,
      cache_max_entries: 100,
      fail_closed: 'yes', // ❌ 应为 boolean
    },
    shouldPass: false,
  },
  {
    name: '[permission] 非法：未知字段（additionalProperties=false）',
    config: {
      cache_ttl_seconds: 300,
      cache_max_entries: 100,
      fail_closed: true,
      unknown_field: 'xxx',
    },
    shouldPass: false,
  },
  {
    name: '[permission] 非法：cache_prewarm_on_startup 类型错误',
    config: {
      cache_ttl_seconds: 300,
      cache_max_entries: 100,
      cache_prewarm_on_startup: 'true', // ❌ 应为 boolean
      fail_closed: true,
    },
    shouldPass: false,
  },
];

// ===========================================================================
// 3. webhook.config.schema.json 测试用例
// ===========================================================================
const webhookConfigTests: TestCase[] = [
  // 合法用例
  {
    name: '[webhook] 合法：仅 required 字段',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: true,
  },
  {
    name: '[webhook] 合法：全字段填充',
    config: {
      hmac_algorithm: 'sha512',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      nonce_cache_max_entries: 50000,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
      allowed_event_types: ['player.join', 'player.chat', 'binding.verify_request'],
      max_payload_size_bytes: 131072,
    },
    shouldPass: true,
  },
  {
    name: '[webhook] 合法：timestamp_tolerance 边界值 30',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 30,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: true,
  },
  {
    name: '[webhook] 合法：timestamp_tolerance 边界值 3600',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 3600,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: true,
  },
  {
    name: '[webhook] 合法：hmac_algorithm=sha384',
    config: {
      hmac_algorithm: 'sha384',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: true,
  },
  // 非法用例
  {
    name: '[webhook] 非法：hmac_algorithm 不在枚举（md5）',
    config: {
      hmac_algorithm: 'md5', // ❌
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：timestamp_tolerance 小于 30',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 10,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：timestamp_tolerance 大于 3600',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 7200,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：nonce_cache_ttl 小于 60',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 30, // ❌ < 60
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：nonce_cache_max_entries 小于 100',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      nonce_cache_max_entries: 50, // ❌
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：signature_header 空字符串',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: '', // ❌ minLength 1
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：allowed_event_types 含大写字母（pattern 违反）',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
      allowed_event_types: ['Player.Join'], // ❌ pattern ^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：max_payload_size_bytes 小于 1024',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
      max_payload_size_bytes: 512, // ❌
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：未知字段（additionalProperties=false）',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: 'GSP_WEBHOOK_SECRET',
      secret_value: 'should-not-be-here', // ❌ 敏感密钥不得入配置文件
    },
    shouldPass: false,
  },
  {
    name: '[webhook] 非法：secret_env_var 空字符串',
    config: {
      hmac_algorithm: 'sha256',
      signature_header: 'X-GSP-Signature',
      timestamp_header: 'X-GSP-Timestamp',
      nonce_header: 'X-GSP-Nonce',
      timestamp_tolerance_seconds: 300,
      nonce_cache_ttl_seconds: 600,
      secret_env_var: '', // ❌
    },
    shouldPass: false,
  },
];

// ===========================================================================
// 4. 通用契约约束检查（rules-3 §三 配置契约规范）
// ===========================================================================
interface ComplianceCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

function runComplianceChecks(schemaInfos: SchemaInfo[]): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];

  // 4.1 所有配置 schema 必须包含 default 字段（auto_fill 要求）
  console.log('\n--- 配置契约合规性检查（rules-3 §三）---');
  for (const info of schemaInfos) {
    const props = info.schema.properties || {};
    const missingDefaults: string[] = [];
    for (const [key, def] of Object.entries<any>(props)) {
      // required 字段之外的 optional 字段必须有 default；required 字段也应推荐有 default
      // 但 rules-3 §3.2 仅要求"配置契约必须包含默认值"——这里检查所有字段
      if (def.default === undefined) {
        missingDefaults.push(key);
      }
    }
    if (missingDefaults.length === 0) {
      checks.push({
        name: `[${info.displayName}] 所有字段均提供默认值（auto_fill）`,
        pass: true,
      });
    } else {
      checks.push({
        name: `[${info.displayName}] 所有字段均提供默认值（auto_fill）`,
        pass: false,
        detail: `缺失 default 字段：${missingDefaults.join(', ')}`,
      });
    }
  }

  // 4.2 必须为 additionalProperties: false（防御性约束）
  for (const info of schemaInfos) {
    const pass = info.schema.additionalProperties === false;
    checks.push({
      name: `[${info.displayName}] additionalProperties=false（防止未知字段）`,
      pass,
      detail: pass ? undefined : `实际值：${info.schema.additionalProperties}`,
    });
  }

  // 4.3 必须包含 $id 字段（契约可寻址）
  for (const info of schemaInfos) {
    const pass = typeof info.schema.$id === 'string' && info.schema.$id.length > 0;
    checks.push({
      name: `[${info.displayName}] 包含 $id（契约可寻址）`,
      pass,
      detail: pass ? undefined : '缺失或 $id 为空',
    });
  }

  // 4.4 必须包含 title 和 description（语义自描述）
  for (const info of schemaInfos) {
    const pass =
      typeof info.schema.title === 'string' &&
      info.schema.title.length > 0 &&
      typeof info.schema.description === 'string' &&
      info.schema.description.length > 0;
    checks.push({
      name: `[${info.displayName}] 包含 title + description`,
      pass,
      detail: pass ? undefined : 'title 或 description 缺失',
    });
  }

  // 4.5 required 字段不得为空数组
  for (const info of schemaInfos) {
    const required = info.schema.required || [];
    const pass = Array.isArray(required) && required.length > 0;
    checks.push({
      name: `[${info.displayName}] required 非空`,
      pass,
      detail: pass ? undefined : 'required 缺失或为空数组',
    });
  }

  // 4.6 敏感字段安全检查：禁止在 schema 中暴露具体密钥值（仅允许 secret_env_var 字段名引用）
  for (const info of schemaInfos) {
    const jsonStr = JSON.stringify(info.schema);
    // 检查是否含常见密钥模式（不应在 schema 文件中）
    const suspiciousPatterns = [
      /"secret"\s*:\s*"[^"]{8,}"/i,
      /"api_key"\s*:\s*"[^"]{8,}"/i,
      /"password"\s*:\s*"[^"]{4,}"/i,
      /"private_key"\s*:\s*"[^"]{16,}"/i,
    ];
    const hit = suspiciousPatterns.find((p) => p.test(jsonStr));
    checks.push({
      name: `[${info.displayName}] 不含具体密钥值（仅允许 *_env_var 字段名引用）`,
      pass: !hit,
      detail: hit ? `命中模式：${hit.source}` : undefined,
    });
  }

  // 4.7 数值类字段必须有 minimum/maximum 约束
  for (const info of schemaInfos) {
    const props = info.schema.properties || {};
    const numericFieldsWithoutRange: string[] = [];
    for (const [key, def] of Object.entries<any>(props)) {
      if (def.type === 'integer' || def.type === 'number') {
        if (def.minimum === undefined || def.maximum === undefined) {
          numericFieldsWithoutRange.push(key);
        }
      }
    }
    checks.push({
      name: `[${info.displayName}] 数值字段均有 minimum+maximum`,
      pass: numericFieldsWithoutRange.length === 0,
      detail:
        numericFieldsWithoutRange.length === 0
          ? undefined
          : `缺少范围约束：${numericFieldsWithoutRange.join(', ')}`,
    });
  }

  return checks;
}

// ===========================================================================
// 5. 主执行入口
// ===========================================================================
function runTests(): boolean {
  console.log('--- 开始 config-contract 测试套件（v4.17.0 三个配置契约）---');

  const schemaInfos: SchemaInfo[] = [
    loadConfigSchema('binding.config.schema.json', 'binding'),
    loadConfigSchema('permission.config.schema.json', 'permission'),
    loadConfigSchema('webhook.config.schema.json', 'webhook'),
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const allFailures: string[] = [];

  const suites: Array<{ name: string; info: SchemaInfo; tests: TestCase[] }> = [
    { name: 'binding.config.schema.json', info: schemaInfos[0], tests: bindingConfigTests },
    { name: 'permission.config.schema.json', info: schemaInfos[1], tests: permissionConfigTests },
    { name: 'webhook.config.schema.json', info: schemaInfos[2], tests: webhookConfigTests },
  ];

  for (const suite of suites) {
    console.log(`\n=== ${suite.name} 测试用例（${suite.tests.length} 项）===`);
    let passed = 0;
    let failed = 0;

    for (const tc of suite.tests) {
      const result = validator.validate(tc.config, suite.info.schema);
      const actualPass = result.valid;
      if (actualPass === tc.shouldPass) {
        console.log(`  ✅ ${tc.name}`);
        passed++;
      } else {
          const msg = `  ❌ ${tc.name}\n     预期: ${tc.shouldPass ? '通过' : '失败'}, 实际: ${actualPass ? '通过' : '失败'}\n     错误: ${result.errors.map((e: ValidationError) => e.toString()).join('; ')}`;
        console.log(msg);
        allFailures.push(msg);
        failed++;
      }
    }
    console.log(`  --- 子套件结果：${passed} 通过 / ${failed} 失败 ---`);
    totalPassed += passed;
    totalFailed += failed;
  }

  // 通用合规性检查
  console.log('\n=== 配置契约通用合规性检查 ===');
  const complianceChecks = runComplianceChecks(schemaInfos);
  for (const check of complianceChecks) {
    if (check.pass) {
      console.log(`  ✅ ${check.name}`);
      totalPassed++;
    } else {
      const msg = `  ❌ ${check.name}${check.detail ? `\n     详情：${check.detail}` : ''}`;
      console.log(msg);
      allFailures.push(msg);
      totalFailed++;
    }
  }

  // 最终汇总
  console.log(`\n--- 测试结果：${totalPassed} 通过 / ${totalFailed} 失败 / 共 ${totalPassed + totalFailed} ---`);
  if (totalFailed > 0) {
    console.log('\n失败用例详情：');
    allFailures.forEach((f) => console.log(f));
  }
  return totalFailed === 0;
}

const allPassed = runTests();
console.log(allPassed ? '\n🎉 config-contract 测试全部通过！' : '\n💥 config-contract 测试存在失败项。');
process.exit(allPassed ? 0 : 1);
