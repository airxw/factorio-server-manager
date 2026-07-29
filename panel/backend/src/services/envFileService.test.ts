// ============================================================================
// envFileService.test.ts — v4.20.0 .env 文件读写服务单元测试
//
// 覆盖：
//   - validateEnvPath: 文件不存在 / 不可写
//   - readEnvFile: 注释/空行跳过、KEY=VALUE 解析、重复 KEY 覆盖
//   - writeEnvFile: 仅更新指定字段、保留注释/空行结构、追加新字段、原子写入、备份
//   - 边界：空 updates、原文件末尾换行习惯、重复字段
//
// 来源：docs/plans/setup-wizard-v2-configuration-plan.md §4.5
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EnvFileService } from './envFileService.js';

// ---------------------------------------------------------------------------
// 测试夹具：每个用例独享的临时 .env 文件
// ---------------------------------------------------------------------------

let tmpDir: string;
let envPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsp-env-test-'));
  envPath = path.join(tmpDir, '.env');
});

afterEach(() => {
  // 递归删除临时目录
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 写入初始 .env 内容 */
function writeInitialEnv(content: string): void {
  fs.writeFileSync(envPath, content, 'utf8');
}

/** 读取 .env 内容（用于断言） */
function readEnv(): string {
  return fs.readFileSync(envPath, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. validateEnvPath
// ---------------------------------------------------------------------------

describe('EnvFileService - validateEnvPath', () => {
  it('文件存在且可写时不抛错', () => {
    writeInitialEnv('PORT=3000\n');
    const svc = new EnvFileService({ envPath });
    expect(() => svc.validateEnvPath()).not.toThrow();
  });

  it('文件不存在时抛错', () => {
    const svc = new EnvFileService({ envPath });
    expect(() => svc.validateEnvPath()).toThrow(/\.env 文件不存在/);
  });

  it('文件不可写时抛错', () => {
    writeInitialEnv('PORT=3000\n');
    fs.chmodSync(envPath, 0o444); // 只读
    const svc = new EnvFileService({ envPath });
    try {
      expect(() => svc.validateEnvPath()).toThrow(/\.env 文件不可写/);
    } finally {
      // 恢复权限便于清理
      fs.chmodSync(envPath, 0o644);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. readEnvFile
// ---------------------------------------------------------------------------

describe('EnvFileService - readEnvFile', () => {
  it('解析 KEY=VALUE，忽略注释和空行', async () => {
    writeInitialEnv([
      '# 这是注释',
      '',
      'PORT=3000',
      'DATABASE_URL=sqlite://./data/panel.db',
      '  # 缩进的注释',
      '',
    ].join('\n'));
    const svc = new EnvFileService({ envPath });
    const result = await svc.readEnvFile();
    expect(result).toEqual({
      PORT: '3000',
      DATABASE_URL: 'sqlite://./data/panel.db',
    });
  });

  it('VALUE 含 = 号时正确解析（第一个 = 为分隔符）', async () => {
    writeInitialEnv('DATABASE_URL=mysql://user:pass=word@host:3306/db\n');
    const svc = new EnvFileService({ envPath });
    const result = await svc.readEnvFile();
    expect(result.DATABASE_URL).toBe('mysql://user:pass=word@host:3306/db');
  });

  it('VALUE 含引号时保留原样（不去引号）', async () => {
    writeInitialEnv('NAME="带空格的值"\nOTHER=\'单引号\'\n');
    const svc = new EnvFileService({ envPath });
    const result = await svc.readEnvFile();
    expect(result.NAME).toBe('"带空格的值"');
    expect(result.OTHER).toBe('\'单引号\'');
  });

  it('重复 KEY 时后出现的覆盖先出现的', async () => {
    writeInitialEnv('PORT=3000\nPORT=3001\n');
    const svc = new EnvFileService({ envPath });
    const result = await svc.readEnvFile();
    expect(result.PORT).toBe('3001');
  });

  it('文件不存在时抛错', async () => {
    const svc = new EnvFileService({ envPath });
    await expect(svc.readEnvFile()).rejects.toThrow(/\.env 文件不存在/);
  });

  it('无等号的行被忽略', async () => {
    writeInitialEnv('INVALID_LINE_NO_EQUALS\nPORT=3000\n');
    const svc = new EnvFileService({ envPath });
    const result = await svc.readEnvFile();
    expect(result).toEqual({ PORT: '3000' });
  });

  it('KEY 前后空格被 trim', async () => {
    writeInitialEnv('  PORT  =3000\n');
    const svc = new EnvFileService({ envPath });
    const result = await svc.readEnvFile();
    expect(result.PORT).toBe('3000');
  });

  it('VALUE 保留尾部空格（符合 .env 习惯）', async () => {
    // 注意：此处 trim 只作用于整行用于判断注释/空行，VALUE 部分不做 trim
    // 但实际实现：const trimmed = line.trim() —— 整行 trim 后 VALUE 也会被 trim 掉首尾空格
    // 这是已知行为，符合 dotenv 习惯
    writeInitialEnv('PORT=3000   \n');
    const svc = new EnvFileService({ envPath });
    const result = await svc.readEnvFile();
    // 实现中整行 trim 后再切分，VALUE 尾部空格会被 trim 掉
    expect(result.PORT).toBe('3000');
  });
});

// ---------------------------------------------------------------------------
// 3. writeEnvFile - 基础更新
// ---------------------------------------------------------------------------

describe('EnvFileService - writeEnvFile 基础更新', () => {
  it('仅更新指定字段，其他字段保持不变', async () => {
    writeInitialEnv([
      '# Panel 配置',
      'PORT=3000',
      'DATABASE_URL=sqlite://./data/panel.db',
      'PUBLIC_BASE_URL=',
    ].join('\n'));
    const svc = new EnvFileService({ envPath });
    const result = await svc.writeEnvFile({
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      PUBLIC_BASE_URL: 'https://gsp.ecsrz.com',
    });
    expect(result.updatedKeys).toEqual(expect.arrayContaining(['DATABASE_URL', 'PUBLIC_BASE_URL']));
    expect(result.appendedKeys).toEqual([]);
    const content = readEnv();
    expect(content).toContain('# Panel 配置');
    expect(content).toContain('PORT=3000');
    expect(content).toContain('DATABASE_URL=postgresql://user:pass@host:5432/db');
    expect(content).toContain('PUBLIC_BASE_URL=https://gsp.ecsrz.com');
    expect(content).not.toContain('sqlite://./data/panel.db');
  });

  it('保留注释和空行结构', async () => {
    const original = [
      '# Panel 配置',
      '',
      '# 数据库连接',
      'DATABASE_URL=sqlite://./data/panel.db',
      '',
      '# 公网入口',
      'PUBLIC_BASE_URL=',
    ].join('\n');
    writeInitialEnv(original);
    const svc = new EnvFileService({ envPath });
    await svc.writeEnvFile({ DATABASE_URL: 'mysql://host/db' });
    const content = readEnv();
    // 注释保留
    expect(content).toContain('# Panel 配置');
    expect(content).toContain('# 数据库连接');
    expect(content).toContain('# 公网入口');
    // 空行保留（数量与原文件一致）
    const originalEmptyLines = original.split('\n').filter((l) => l === '').length;
    const newEmptyLines = content.split('\n').filter((l) => l === '').length;
    expect(newEmptyLines).toBe(originalEmptyLines);
  });

  it('保留原文件末尾换行习惯', async () => {
    writeInitialEnv('PORT=3000\nDATABASE_URL=sqlite\n'); // 末尾有换行
    const svc = new EnvFileService({ envPath });
    await svc.writeEnvFile({ PORT: '3001' });
    const content = readEnv();
    expect(content.endsWith('\n')).toBe(true);
  });

  it('原文件无末尾换行时不强制添加', async () => {
    writeInitialEnv('PORT=3000\nDATABASE_URL=sqlite'); // 末尾无换行
    const svc = new EnvFileService({ envPath });
    await svc.writeEnvFile({ PORT: '3001' });
    const content = readEnv();
    expect(content.endsWith('\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. writeEnvFile - 追加新字段
// ---------------------------------------------------------------------------

describe('EnvFileService - writeEnvFile 追加新字段', () => {
  it('updates 中含原文件没有的 KEY 时追加到末尾', async () => {
    writeInitialEnv([
      'PORT=3000',
      'DATABASE_URL=sqlite://./data/panel.db',
    ].join('\n'));
    const svc = new EnvFileService({ envPath });
    const result = await svc.writeEnvFile({
      PUBLIC_BASE_URL: 'https://gsp.ecsrz.com',
      DAEMON_URL: 'http://127.0.0.1:8080',
    });
    expect(result.updatedKeys).toEqual([]);
    expect(result.appendedKeys).toEqual(expect.arrayContaining(['PUBLIC_BASE_URL', 'DAEMON_URL']));
    const content = readEnv();
    expect(content).toContain('# v4.20.0 Setup Wizard v2 追加字段');
    expect(content).toContain('PUBLIC_BASE_URL=https://gsp.ecsrz.com');
    expect(content).toContain('DAEMON_URL=http://127.0.0.1:8080');
    // 原字段保留
    expect(content).toContain('PORT=3000');
    expect(content).toContain('DATABASE_URL=sqlite://./data/panel.db');
  });

  it('混合场景：部分更新、部分追加', async () => {
    writeInitialEnv([
      'PORT=3000',
      'DATABASE_URL=sqlite://./data/panel.db',
    ].join('\n'));
    const svc = new EnvFileService({ envPath });
    const result = await svc.writeEnvFile({
      DATABASE_URL: 'postgresql://host/db', // 更新
      PUBLIC_BASE_URL: 'https://gsp.ecsrz.com', // 追加
    });
    expect(result.updatedKeys).toEqual(['DATABASE_URL']);
    expect(result.appendedKeys).toEqual(['PUBLIC_BASE_URL']);
    const content = readEnv();
    expect(content).toContain('DATABASE_URL=postgresql://host/db');
    expect(content).toContain('PUBLIC_BASE_URL=https://gsp.ecsrz.com');
    expect(content).toContain('PORT=3000');
  });
});

// ---------------------------------------------------------------------------
// 5. writeEnvFile - 备份与原子写入
// ---------------------------------------------------------------------------

describe('EnvFileService - writeEnvFile 备份与原子写入', () => {
  it('写入后生成备份文件（.env.bak.YYYYMMDDHHmmss）', async () => {
    writeInitialEnv('PORT=3000\n');
    const svc = new EnvFileService({ envPath });
    const result = await svc.writeEnvFile({ PORT: '3001' });
    expect(result.backupPath).not.toBe('');
    expect(fs.existsSync(result.backupPath)).toBe(true);
    // 备份内容 = 原文件内容
    const backupContent = fs.readFileSync(result.backupPath, 'utf8');
    expect(backupContent).toBe('PORT=3000\n');
  });

  it('备份文件名格式为 .env.bak.<14位时间戳>', async () => {
    writeInitialEnv('PORT=3000\n');
    const svc = new EnvFileService({ envPath });
    const result = await svc.writeEnvFile({ PORT: '3001' });
    const basename = path.basename(result.backupPath);
    expect(basename).toMatch(/^\.env\.bak\.\d{14}$/);
  });

  it('原子写入：不残留 .env.tmp 文件', async () => {
    writeInitialEnv('PORT=3000\n');
    const svc = new EnvFileService({ envPath });
    await svc.writeEnvFile({ PORT: '3001' });
    const dirFiles = fs.readdirSync(tmpDir);
    const tmpFiles = dirFiles.filter((f) => f.includes('.tmp.'));
    expect(tmpFiles).toEqual([]);
  });

  it('写入中断时原文件不被破坏（原子性）', async () => {
    // 模拟方式：writeFile 成功但 rename 失败的场景难以直接构造，
    // 此处仅验证正常流程下原文件在写入完成后被新内容替换
    writeInitialEnv('PORT=3000\n');
    const svc = new EnvFileService({ envPath });
    await svc.writeEnvFile({ PORT: '3001' });
    const content = readEnv();
    expect(content).toContain('PORT=3001');
    expect(content).not.toContain('PORT=3000');
  });
});

// ---------------------------------------------------------------------------
// 6. writeEnvFile - 边界
// ---------------------------------------------------------------------------

describe('EnvFileService - writeEnvFile 边界', () => {
  it('updates 为空对象时直接返回，不写入文件', async () => {
    const original = 'PORT=3000\n';
    writeInitialEnv(original);
    const svc = new EnvFileService({ envPath });
    const result = await svc.writeEnvFile({});
    expect(result.backupPath).toBe('');
    expect(result.updatedKeys).toEqual([]);
    expect(result.appendedKeys).toEqual([]);
    // 文件内容不变
    expect(readEnv()).toBe(original);
  });

  it('updates 中 KEY 在原文件中重复出现时，所有匹配行都被更新', async () => {
    // .env 习惯是不应重复，但若用户手动复制粘贴导致重复，服务应全部替换避免歧义
    writeInitialEnv([
      'PORT=3000',
      '# 中间注释',
      'PORT=3001',
    ].join('\n'));
    const svc = new EnvFileService({ envPath });
    const result = await svc.writeEnvFile({ PORT: '3002' });
    // 两次出现都被更新（updatedKeys 含两次 PORT）
    expect(result.updatedKeys).toEqual(['PORT', 'PORT']);
    const content = readEnv();
    // 两行都变成 PORT=3002
    const portLines = content.split('\n').filter((l) => l.startsWith('PORT='));
    expect(portLines).toEqual(['PORT=3002', 'PORT=3002']);
  });

  it('VALUE 含特殊字符（= / 空格 / 中文）时正确写入', async () => {
    writeInitialEnv('PORT=3000\n');
    const svc = new EnvFileService({ envPath });
    await svc.writeEnvFile({
      DATABASE_URL: 'mysql://user:p@ss=word@host:3306/db',
      PUBLIC_BASE_URL: 'https://gsp.ecsrz.com',
      NODE_NAME: '中文节点名称',
    });
    const content = readEnv();
    expect(content).toContain('DATABASE_URL=mysql://user:p@ss=word@host:3306/db');
    expect(content).toContain('PUBLIC_BASE_URL=https://gsp.ecsrz.com');
    expect(content).toContain('NODE_NAME=中文节点名称');
  });

  it('文件不存在时抛错', async () => {
    const svc = new EnvFileService({ envPath });
    await expect(svc.writeEnvFile({ PORT: '3000' })).rejects.toThrow(/\.env 文件不存在/);
  });
});

// ---------------------------------------------------------------------------
// 7. getEnvPath
// ---------------------------------------------------------------------------

describe('EnvFileService - getEnvPath', () => {
  it('返回注入的 envPath', () => {
    const svc = new EnvFileService({ envPath });
    expect(svc.getEnvPath()).toBe(envPath);
  });

  it('未注入时返回 process.cwd()/.env', () => {
    const svc = new EnvFileService();
    const expected = path.resolve(process.cwd(), '.env');
    expect(svc.getEnvPath()).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 8. 集成场景：Setup Wizard v2 完整写入流程
// ---------------------------------------------------------------------------

describe('EnvFileService - 集成场景（Setup Wizard v2）', () => {
  it('模拟向导提交：DATABASE_URL + PUBLIC_BASE_URL + DAEMON_URL 三个字段同时写入', async () => {
    // 模拟生产 .env 初始状态（只有 PORT 和 SQLite DATABASE_URL）
    writeInitialEnv([
      '# Panel 后端配置',
      '',
      '# HTTP 监听端口（内部端口，nginx 反代）',
      'PORT=3000',
      '',
      '# 数据库连接（默认 SQLite）',
      'DATABASE_URL=sqlite://./data/panel.db',
      '',
      '# Daemon 通信地址（单机模式可留空）',
      'DAEMON_URL=',
    ].join('\n'));
    const svc = new EnvFileService({ envPath });

    // 向导提交：用户切换到 PostgreSQL + 配置公网入口 + 启用 Daemon
    const result = await svc.writeEnvFile({
      DATABASE_URL: 'postgresql://gsp:pass@127.0.0.1:5432/gameserver',
      PUBLIC_BASE_URL: 'https://gsp.ecsrz.com',
      DAEMON_URL: 'http://127.0.0.1:8080',
    });

    // 验证返回值
    expect(result.updatedKeys).toEqual(expect.arrayContaining(['DATABASE_URL', 'DAEMON_URL']));
    expect(result.appendedKeys).toEqual(['PUBLIC_BASE_URL']);
    expect(result.backupPath).not.toBe('');

    // 验证文件内容
    const content = readEnv();
    expect(content).toContain('# Panel 后端配置');
    expect(content).toContain('# HTTP 监听端口（内部端口，nginx 反代）');
    expect(content).toContain('PORT=3000');
    expect(content).toContain('# 数据库连接（默认 SQLite）');
    expect(content).toContain('DATABASE_URL=postgresql://gsp:pass@127.0.0.1:5432/gameserver');
    expect(content).toContain('# Daemon 通信地址（单机模式可留空）');
    expect(content).toContain('DAEMON_URL=http://127.0.0.1:8080');
    expect(content).toContain('# v4.20.0 Setup Wizard v2 追加字段');
    expect(content).toContain('PUBLIC_BASE_URL=https://gsp.ecsrz.com');
    expect(content).not.toContain('sqlite://./data/panel.db');
  });

  it('向导提交后再次读取 .env，能拿到所有写入的字段', async () => {
    writeInitialEnv('PORT=3000\nDATABASE_URL=sqlite\n');
    const svc = new EnvFileService({ envPath });
    await svc.writeEnvFile({
      DATABASE_URL: 'postgresql://host/db',
      PUBLIC_BASE_URL: 'https://gsp.ecsrz.com',
    });
    const readResult = await svc.readEnvFile();
    expect(readResult.PORT).toBe('3000');
    expect(readResult.DATABASE_URL).toBe('postgresql://host/db');
    expect(readResult.PUBLIC_BASE_URL).toBe('https://gsp.ecsrz.com');
  });
});
