// ============================================================================
// bindings-api-contract.test.ts — v4.17.0 绑定服务接口契约测试套件
//
// 覆盖契约：public/interface_stub/bindings.d.ts（IBindingService 接口）
// 测试用例数：~20（覆盖 CRUD 签名匹配、异常契约、Mock 行为验证）
//
// 运行方式：npx tsx public/test_cases/bindings-api-contract.test.ts
// 退出码：0=全部通过，1=存在失败
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §2.6 + rules-3 §五
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { mockBindingService, MockBindingError } from '../pre_generated_mock/bindings';
import type { IBindingService } from '../interface_stub/bindings';

/**
 * 测试结果统计
 */
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    const msg = `  ❌ ${name}${detail ? `\n     ${detail}` : ''}`;
    console.log(msg);
    failures.push(msg);
    failed++;
  }
}

async function assertThrows(
  fn: () => Promise<unknown>,
  expectedCode: string,
  name: string,
): Promise<void> {
  try {
    await fn();
    const msg = `  ❌ ${name}\n     预期抛出 ${expectedCode}，实际未抛出`;
    console.log(msg);
    failures.push(msg);
    failed++;
  } catch (err) {
    if (err instanceof MockBindingError && err.code === expectedCode) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      const actualCode = err instanceof MockBindingError ? err.code : (err as Error).name;
      const msg = `  ❌ ${name}\n     预期 ${expectedCode}，实际 ${actualCode}`;
      console.log(msg);
      failures.push(msg);
      failed++;
    }
  }
}

async function runTests(): Promise<boolean> {
  console.log('--- 开始 bindings.d.ts 接口契约测试 ---\n');

  // ===== 1. 接口存根文件存在性检查 =====
  console.log('--- 接口存根文件检查 ---');
  const stubPath = path.resolve(__dirname, '../interface_stub/bindings.d.ts');
  assert(fs.existsSync(stubPath), 'bindings.d.ts 文件存在');

  const stubContent = fs.readFileSync(stubPath, 'utf8');
  assert(stubContent.includes('interface IBindingService'), 'IBindingService 接口声明存在');
  assert(stubContent.includes('createBinding'), 'createBinding 方法声明存在');
  assert(stubContent.includes('listBindings'), 'listBindings 方法声明存在');
  assert(stubContent.includes('getBinding'), 'getBinding 方法声明存在');
  assert(stubContent.includes('updateBinding'), 'updateBinding 方法声明存在');
  assert(stubContent.includes('verifyBinding'), 'verifyBinding 方法声明存在');
  assert(stubContent.includes('revokeBinding'), 'revokeBinding 方法声明存在');
  assert(stubContent.includes('deleteBinding'), 'deleteBinding 方法声明存在');
  assert(stubContent.includes('cleanupExpiredVerifyCodes'), 'cleanupExpiredVerifyCodes 方法声明存在');
  assert(stubContent.includes('findBindingByPlayerName'), 'findBindingByPlayerName 方法声明存在');

  // 检查异常契约
  assert(stubContent.includes('@throws'), '接口存根包含 @throws 异常声明');
  assert(stubContent.includes('PANEL_NOT_FOUND'), '异常码 PANEL_NOT_FOUND 声明');
  assert(stubContent.includes('PANEL_FORBIDDEN'), '异常码 PANEL_FORBIDDEN 声明');
  assert(stubContent.includes('VERIFY_CODE_INVALID'), '异常码 VERIFY_CODE_INVALID 声明');

  // ===== 2. Mock 实现签名匹配检查 =====
  console.log('\n--- Mock 实现签名匹配检查 ---');
  const mock = mockBindingService;
  mock.resetMockBindings();

  // 检查 Mock 实现了 IBindingService 接口的所有方法
  const requiredMethods: (keyof IBindingService)[] = [
    'createBinding',
    'listBindings',
    'getBinding',
    'updateBinding',
    'verifyBinding',
    'revokeBinding',
    'deleteBinding',
    'cleanupExpiredVerifyCodes',
    'findBindingByPlayerName',
  ];
  for (const method of requiredMethods) {
    assert(typeof (mock as any)[method] === 'function', `Mock 实现 ${method} 方法`);
  }

  // ===== 3. Mock 行为验证（覆盖关键路径） =====
  console.log('\n--- Mock 行为验证 ---');

  // 3.1 listBindings 返回预设数据
  const listResp = await mock.listBindings({});
  assert(listResp.bindings.length >= 6, 'listBindings 返回预设 6 条数据', `实际 ${listResp.bindings.length} 条`);

  // 3.2 listBindings 按 user_id 过滤
  const userBindings = await mock.listBindings({ user_id: '11111111-1111-1111-1111-111111111111' });
  assert(
    userBindings.bindings.length === 2,
    'listBindings 按 user_id 过滤返回 2 条',
    `实际 ${userBindings.bindings.length} 条`,
  );

  // 3.3 listBindings 按 verify_status 过滤
  const pendingBindings = await mock.listBindings({ verify_status: 'pending' });
  assert(
    pendingBindings.bindings.every((b) => b.verify_status === 'pending'),
    'listBindings 按 verify_status=pending 过滤正确',
  );

  // 3.4 getBinding 返回正确记录
  const binding = await mock.getBinding(1);
  assert(binding.id === 1, 'getBinding 返回正确 ID');
  assert(binding.binding_type === 'account', 'getBinding 返回正确 binding_type');

  // 3.5 getBinding 不存在时抛出 PANEL_NOT_FOUND
  await assertThrows(
    () => mock.getBinding(99999),
    'PANEL_NOT_FOUND',
    'getBinding 不存在时抛出 PANEL_NOT_FOUND',
  );

  // 3.6 getBinding 玩家视角越权访问抛出 PANEL_FORBIDDEN
  await assertThrows(
    () => mock.getBinding(1, '99999999-9999-9999-9999-999999999999'),
    'PANEL_FORBIDDEN',
    'getBinding 玩家视角越权访问抛出 PANEL_FORBIDDEN',
  );

  // 3.7 createBinding 合法创建（v4.27.0: player 绑定使用 instance 语义）
  const newBinding = await mock.createBinding(
    {
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: 'server-uuid-001',
      player_name: 'NewPlayer',
    },
    '77777777-7777-7777-7777-777777777777',
  );
  assert(newBinding.verify_status === 'pending', 'createBinding 创建 pending 态绑定');
  assert(newBinding.verify_code !== null, 'createBinding 生成 verify_code');
  assert(newBinding.verify_expires_at !== null, 'createBinding 设置 verify_expires_at');

  // 3.8 createBinding player 类型缺少 player_name 抛错
  await assertThrows(
    () =>
      mock.createBinding(
        { binding_type: 'player', scope_type: 'instance', scope_ref: 'server-uuid-001' },
        '77777777-7777-7777-7777-777777777777',
      ),
    'PANEL_VALIDATION_ERROR',
    'createBinding player 缺少 player_name 抛 PANEL_VALIDATION_ERROR',
  );

  // 3.9 createBinding account 类型 scope_type != instance 抛错
  await assertThrows(
    () =>
      mock.createBinding(
        { binding_type: 'account', scope_type: 'game_type', scope_ref: 'minecraft' },
        '77777777-7777-7777-7777-777777777777',
      ),
    'PANEL_VALIDATION_ERROR',
    'createBinding account + game_type 抛 PANEL_VALIDATION_ERROR',
  );

  // 3.10 verifyBinding 合法验证
  const verified = await mock.verifyBinding(3, { verify_code: '654321' }, '22222222-2222-2222-2222-222222222222');
  assert(verified.binding.verify_status === 'verified', 'verifyBinding 成功转为 verified 态');
  assert(verified.binding.verify_code === null, 'verifyBinding 消费后 verify_code 置 NULL');
  assert(verified.binding.verified_at !== null, 'verifyBinding 设置 verified_at');

  // 3.11 verifyBinding 错误验证码抛错
  mock.resetMockBindings(); // 重置以恢复 pending 态
  await assertThrows(
    () => mock.verifyBinding(3, { verify_code: 'wrong' }, '22222222-2222-2222-2222-222222222222'),
    'VERIFY_CODE_INVALID',
    'verifyBinding 错误验证码抛 VERIFY_CODE_INVALID',
  );

  // 3.12 verifyBinding 重复验证抛错
  await mock.verifyBinding(3, { verify_code: '654321' }, '22222222-2222-2222-2222-222222222222');
  await assertThrows(
    () => mock.verifyBinding(3, { verify_code: '654321' }, '22222222-2222-2222-2222-222222222222'),
    'BINDING_ALREADY_VERIFIED',
    'verifyBinding 重复验证抛 BINDING_ALREADY_VERIFIED',
  );

  // 3.13 revokeBinding 合法撤销
  mock.resetMockBindings();
  const revoked = await mock.revokeBinding(1, '11111111-1111-1111-1111-111111111111');
  assert(revoked.binding.verify_status === 'revoked', 'revokeBinding 转为 revoked 态');

  // 3.14 revokeBinding 越权访问抛错
  mock.resetMockBindings();
  await assertThrows(
    () => mock.revokeBinding(1, '99999999-9999-9999-9999-999999999999'),
    'PANEL_FORBIDDEN',
    'revokeBinding 越权访问抛 PANEL_FORBIDDEN',
  );

  // 3.15 updateBinding 修改 vip_level
  mock.resetMockBindings();
  const updated = await mock.updateBinding(1, { vip_level: 3 });
  assert(updated.vip_level === 3, 'updateBinding 修改 vip_level 成功');

  // 3.16 updateBinding 玩家视角修改 vip_level 抛错
  mock.resetMockBindings();
  await assertThrows(
    () => mock.updateBinding(1, { vip_level: 3 }, '11111111-1111-1111-1111-111111111111'),
    'PANEL_FORBIDDEN',
    'updateBinding 玩家视角修改 vip_level 抛 PANEL_FORBIDDEN',
  );

  // 3.17 updateBinding vip_level 越界抛错
  mock.resetMockBindings();
  await assertThrows(
    () => mock.updateBinding(1, { vip_level: 99 }),
    'PANEL_VALIDATION_ERROR',
    'updateBinding vip_level > 5 抛 PANEL_VALIDATION_ERROR',
  );

  // 3.18 deleteBinding 物理删除
  mock.resetMockBindings();
  const deleteResp = await mock.deleteBinding(6);
  assert(deleteResp.deleted === true, 'deleteBinding 返回 deleted=true');
  await assertThrows(
    () => mock.getBinding(6),
    'PANEL_NOT_FOUND',
    'deleteBinding 后 getBinding 抛 PANEL_NOT_FOUND',
  );

  // 3.19 cleanupExpiredVerifyCodes 清理过期
  mock.resetMockBindings();
  // 注入一条 pending + verify_expires_at 已过期的绑定作为清理目标
  // Mock 的 createBinding 默认生成未来 5 分钟过期的 verify_expires_at，
  // 故直接通过 listBindings 找出已存在的 pending（id=3），手动改 verify_expires_at 为过去时间
  const pendingForCleanup = await mock.listBindings({ verify_status: 'pending' });
  if (pendingForCleanup.bindings.length > 0) {
    const target = pendingForCleanup.bindings[0];
    // 通过 updateBinding 无法直接修改 verify_expires_at，故直接操作 Mock 内部状态
    (mock as any).setVerifyExpiresAtForTest?.(target.id, '2020-01-01T00:00:00.000Z');
  }
  const cleanupResp = await mock.cleanupExpiredVerifyCodes();
  assert(cleanupResp.cleaned_count >= 1, 'cleanupExpiredVerifyCodes 清理至少 1 条过期绑定', `实际清理 ${cleanupResp.cleaned_count} 条`);

  // 3.20 findBindingByPlayerName 反查
  // v4.27.0: player 绑定从 scope_type='game_type' 迁移到 scope_type='instance', scope_ref=server_id
  //   mock #2 Steve_Builder 现为 scope_type='instance', scope_ref='server-uuid-001'（见 pre_generated_mock/bindings.ts）
  mock.resetMockBindings();
  const found = await mock.findBindingByPlayerName('instance', 'server-uuid-001', 'Steve_Builder');
  assert(found !== null, 'findBindingByPlayerName 反查到 verified 绑定');
  assert(found?.user_id === '11111111-1111-1111-1111-111111111111', 'findBindingByPlayerName 返回正确 user_id');

  const notFound = await mock.findBindingByPlayerName('instance', 'server-uuid-001', 'NonExistent');
  assert(notFound === null, 'findBindingByPlayerName 未找到返回 null');

  console.log(`\n--- 测试结果：${passed} 通过 / ${failed} 失败 / 共 ${passed + failed} ---`);
  if (failed > 0) {
    console.log('\n失败用例详情：');
    failures.forEach((f) => console.log(f));
  }
  return failed === 0;
}

runTests()
  .then((allPassed) => {
    console.log(allPassed ? '\n🎉 bindings-api-contract 测试全部通过！' : '\n💥 bindings-api-contract 测试存在失败项。');
    process.exit(allPassed ? 0 : 1);
  })
  .catch((err) => {
    console.error('测试执行异常：', err);
    process.exit(1);
  });
