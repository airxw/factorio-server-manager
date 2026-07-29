// ============================================================================
// safeRemoveService.test.ts — 安全删除服务单元测试
// 覆盖：路径穿越防护、白名单校验、namespace 隔离、du/rm 调用流程
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SafeRemoveService,
  createSafeRemoveService,
  ALLOWED_SUBDIRS,
} from './safeRemoveService.js';
import { mockDaemonClient, execResponse } from '../test/mock-factory.js';

// ---------------------------------------------------------------------------
// 路径穿越防护 & 白名单校验（验证失败时不调用 daemon）
// ---------------------------------------------------------------------------

describe('SafeRemoveService 路径穿越防护与白名单校验', () => {
  let service: SafeRemoveService;
  let daemonClient: ReturnType<typeof mockDaemonClient>;

  beforeEach(() => {
    daemonClient = mockDaemonClient();
    service = createSafeRemoveService(daemonClient);
  });

  it('versions: 拒绝 ../ 路径穿越', async () => {
    const res = await service.safeRemove({
      namespace: 'versions',
      targetPath: '../../../etc/passwd',
      nodeId: 'node-1',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/越界|路径/);
    expect(daemonClient.execCommand).not.toHaveBeenCalled();
  });

  it('versions: 拒绝中间含 .. 的路径穿越', async () => {
    const res = await service.safeRemove({
      namespace: 'versions',
      targetPath: 'pack1/v1/../../v2',
      nodeId: 'node-1',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/越界|路径/);
    expect(daemonClient.execCommand).not.toHaveBeenCalled();
  });

  it('versions: 拒绝深度不足（< pack_id/version）', async () => {
    const res = await service.safeRemove({
      namespace: 'versions',
      targetPath: 'onlyone',
      nodeId: 'node-1',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/深度/);
    expect(daemonClient.execCommand).not.toHaveBeenCalled();
  });

  it('versions: 缺少 targetPath 拒绝', async () => {
    const res = await service.safeRemove({
      namespace: 'versions',
      nodeId: 'node-1',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/targetPath 必填/);
  });

  it('instances: 缺少 serverId 拒绝', async () => {
    const res = await service.safeRemove({
      namespace: 'instances',
      nodeId: 'node-1',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/serverId 必填/);
  });

  it('instances: 非法 serverId（含路径字符）拒绝', async () => {
    const res = await service.safeRemove({
      namespace: 'instances',
      nodeId: 'node-1',
      serverId: '../etc',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/非法 serverId/);
    expect(daemonClient.execCommand).not.toHaveBeenCalled();
  });

  it('subdir: 缺少 subdir 拒绝', async () => {
    const res = await service.safeRemove({
      namespace: 'subdir',
      nodeId: 'node-1',
      serverId: 'srv-1',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/subdir/);
  });

  it('subdir: 非白名单 subdir 拒绝', async () => {
    const res = await service.safeRemove({
      namespace: 'subdir',
      nodeId: 'node-1',
      serverId: 'srv-1',
      subdir: 'evil',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/非法 subdir/);
    expect(daemonClient.execCommand).not.toHaveBeenCalled();
  });

  it('ALLOWED_SUBDIRS 仅含 backups/saves/mods/logs/cache', () => {
    expect(ALLOWED_SUBDIRS.has('backups')).toBe(true);
    expect(ALLOWED_SUBDIRS.has('saves')).toBe(true);
    expect(ALLOWED_SUBDIRS.has('mods')).toBe(true);
    expect(ALLOWED_SUBDIRS.has('logs')).toBe(true);
    expect(ALLOWED_SUBDIRS.has('cache')).toBe(true);
    expect(ALLOWED_SUBDIRS.has('evil')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// namespace 隔离 & 成功删除流程（du + rm 调用验证）
// ---------------------------------------------------------------------------

describe('SafeRemoveService namespace 隔离与删除流程', () => {
  let service: SafeRemoveService;
  let daemonClient: ReturnType<typeof mockDaemonClient>;

  beforeEach(() => {
    daemonClient = mockDaemonClient();
    service = createSafeRemoveService(daemonClient);
  });

  it('versions: 合法路径解析到 _versions 下并调用 du + rm', async () => {
    daemonClient.execCommand
      .mockResolvedValueOnce(execResponse({ exit_code: 0, stdout: '12345 /some/path' }))
      .mockResolvedValueOnce(execResponse({ exit_code: 0 }));

    const res = await service.safeRemove({
      namespace: 'versions',
      targetPath: 'pack1/v1',
      nodeId: 'node-1',
    });

    expect(res.success).toBe(true);
    expect(res.freed_bytes).toBe(12345);
    expect(daemonClient.execCommand).toHaveBeenCalledTimes(2);

    const calls = daemonClient.execCommand.mock.calls;
    // 第一次：du -sb
    expect(calls[0][0]).toBe('node-1');
    expect(calls[0][1]).toBe('system');
    expect(calls[0][2].binary).toBe('du');
    expect(calls[0][2].args[0]).toBe('-sb');
    // 第二次：rm -rf
    expect(calls[1][2].binary).toBe('rm');
    expect(calls[1][2].args[0]).toBe('-rf');
  });

  it('instances: 合法 serverId 解析到 instances/<id> 下', async () => {
    daemonClient.execCommand
      .mockResolvedValueOnce(execResponse({ exit_code: 1, stdout: '' })) // du 失败
      .mockResolvedValueOnce(execResponse({ exit_code: 0 })); // rm 成功

    const res = await service.safeRemove({
      namespace: 'instances',
      nodeId: 'node-1',
      serverId: 'srv-abc_123',
    });

    expect(res.success).toBe(true);
    expect(res.freed_bytes).toBeNull(); // du 失败 → null
    const rmArgs = daemonClient.execCommand.mock.calls[1][2].args as string[];
    expect(rmArgs[1]).toMatch(/srv-abc_123$/);
  });

  it('subdir: 合法 subdir 解析到 instances/<id>/<subdir> 下', async () => {
    daemonClient.execCommand
      .mockResolvedValueOnce(execResponse({ exit_code: 0, stdout: '999' }))
      .mockResolvedValueOnce(execResponse({ exit_code: 0 }));

    const res = await service.safeRemove({
      namespace: 'subdir',
      nodeId: 'node-1',
      serverId: 'srv-1',
      subdir: 'logs',
    });

    expect(res.success).toBe(true);
    expect(res.freed_bytes).toBe(999);
    const rmArgs = daemonClient.execCommand.mock.calls[1][2].args as string[];
    expect(rmArgs[1]).toMatch(/srv-1/);
    expect(rmArgs[1]).toMatch(/logs$/);
  });

  it('rm 非零退出码时返回失败', async () => {
    daemonClient.execCommand
      .mockResolvedValueOnce(execResponse({ exit_code: 0, stdout: '0' })) // du
      .mockResolvedValueOnce(
        execResponse({ exit_code: 1, stderr: 'permission denied' }), // rm 失败
      );

    const res = await service.safeRemove({
      namespace: 'instances',
      nodeId: 'node-1',
      serverId: 'srv-1',
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/rm 失败/);
  });

  it('du 抛错被容忍，rm 成功 → success=true, freed_bytes=null', async () => {
    daemonClient.execCommand
      .mockRejectedValueOnce(new Error('du crashed')) // du 抛错（被吞）
      .mockResolvedValueOnce(execResponse({ exit_code: 0 })); // rm 成功

    const res = await service.safeRemove({
      namespace: 'instances',
      nodeId: 'node-1',
      serverId: 'srv-1',
    });

    expect(res.success).toBe(true);
    expect(res.freed_bytes).toBeNull();
  });

  it('rm 抛错时返回失败并带 daemon 错误信息', async () => {
    daemonClient.execCommand
      .mockResolvedValueOnce(execResponse({ exit_code: 0, stdout: '0' })) // du
      .mockRejectedValueOnce(new Error('daemon unreachable')); // rm 抛错

    const res = await service.safeRemove({
      namespace: 'instances',
      nodeId: 'node-1',
      serverId: 'srv-1',
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/daemon unreachable/);
  });
});
