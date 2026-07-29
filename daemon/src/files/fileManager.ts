// ============================================================================
// fileManager — Daemon 文件操作（Task 3.5 新增）
//
// 职责：在实例 workdir 范围内读写文件，严格防路径穿越
// 端点：GET /api/instances/:id/files?path= / PUT /api/instances/:id/files?path=
//
// 安全设计：
//   1. relPath 必须为相对路径，禁止绝对路径（/xx 或 C:\xx）
//   2. 路径段不得包含 ".."（防穿越）
//   3. resolve 后必须仍在 workdir 内（双重保险）
//   4. 拒绝 symlink（防软链接逃逸到 workdir 外）
//   5. 拒绝 null 字节（防截断攻击）
//   6. 文件大小限制（READ_MAX_BYTES / WRITE_MAX_BYTES）
// ============================================================================

import path from 'node:path';
import fs from 'node:fs/promises';

/** 单次读取最大字节数（10MB，防止读超大文件 OOM） */
const READ_MAX_BYTES = 10 * 1024 * 1024;
/** 单次写入最大字节数（10MB） */
const WRITE_MAX_BYTES = 10 * 1024 * 1024;

/** 路径非法错误 */
export class FilePathInvalidError extends Error {
  readonly code = 'FILE_PATH_INVALID' as const;
  constructor(message: string) {
    super(message);
    this.name = 'FilePathInvalidError';
  }
}

/** 文件不存在错误 */
export class FileNotFoundError extends Error {
  readonly code = 'FILE_NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'FileNotFoundError';
  }
}

/** 文件读取响应 */
export interface FileReadResult {
  path: string;
  content: string;
  size: number;
  modified_at: string;
}

/** 文件写入响应 */
export interface FileWriteResult {
  path: string;
  size: number;
  modified_at: string;
}

/** 目录条目（v4.3.0-F1 新增） */
export interface DirEntry {
  /** 相对 workdir 的路径 */
  path: string;
  /** 名称（最后一段） */
  name: string;
  /** 类型：file / directory */
  type: 'file' | 'directory';
  /** 字节数（仅 file，目录为 0） */
  size: number;
  /** 最后修改时间 ISO */
  modified_at: string;
  /** 文件扩展名（小写不含点；目录为空字符串） */
  extension: string;
}

/** 目录列表结果（v4.3.0-F1 新增） */
export interface ListDirResult {
  path: string;
  entries: DirEntry[];
}

/** 二进制后缀黑名单（前端编辑器拦截） */
const BINARY_EXTENSIONS = new Set([
  'jar', 'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib',
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'tiff',
  'db', 'dat', 'level', 'region', 'mca',
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'avi', 'mov',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

/** 是否为二进制后缀 */
export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * 安全校验：relPath 必须在 workdir 内，返回绝对路径。
 *
 * 校验链：
 *   1. 非字符串/空 → FILE_PATH_INVALID
 *   2. 含 null 字节 → FILE_PATH_INVALID
 *   3. 绝对路径（POSIX 或 Windows）→ FILE_PATH_INVALID
 *   4. 路径段含 ".." → FILE_PATH_INVALID
 *   5. resolve(workdir, relPath) 不在 workdir 内 → FILE_PATH_INVALID
 *
 * 不在此方法检查 symlink 与文件存在性（readFile/writeFile 各自处理）
 */
function safeResolve(workdir: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new FilePathInvalidError('path 不能为空');
  }
  if (relPath.includes('\0')) {
    throw new FilePathInvalidError('path 含非法字符（null byte）');
  }
  // 绝对路径检测（POSIX: /开头；Windows: 盘符开头）
  if (path.isAbsolute(relPath)) {
    throw new FilePathInvalidError('path 必须为相对路径，禁止绝对路径');
  }
  // 段级 ".." 检测
  const segments = relPath.split(/[\\/]/);
  if (segments.some((seg) => seg === '..')) {
    throw new FilePathInvalidError('path 禁止包含 ".." 路径段');
  }

  const resolvedWorkdir = path.resolve(workdir);
  const resolvedTarget = path.resolve(resolvedWorkdir, relPath);

  // 必须在 workdir 内（resolvedWorkdir 是 resolvedTarget 的前缀）
  const rel = path.relative(resolvedWorkdir, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new FilePathInvalidError('path 解析后逃逸出 workdir');
  }
  return resolvedTarget;
}

/**
 * 检查路径是否为 symlink（防软链接逃逸）。
 * symlink 本身可能指向 workdir 外，因此拒绝。
 */
async function assertNotSymlink(absPath: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(absPath);
  } catch (err) {
    // 文件不存在不在此处抛（readFile 调用方处理）
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new FilePathInvalidError(`path 不允许为 symlink: ${absPath}`);
  }
}

/**
 * 读取 workdir 下的文件。
 * @param workdir 实例工作目录（绝对路径）
 * @param relPath 相对 workdir 的路径
 * @throws {FilePathInvalidError} 路径非法
 * @throws {FileNotFoundError} 文件不存在
 */
export async function readFile(
  workdir: string,
  relPath: string,
): Promise<FileReadResult> {
  const absPath = safeResolve(workdir, relPath);
  await assertNotSymlink(absPath);

  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileNotFoundError(`文件不存在: ${relPath}`);
    }
    throw err;
  }
  if (!stat.isFile()) {
    throw new FilePathInvalidError(`path 不是常规文件: ${relPath}`);
  }
  if (stat.size > READ_MAX_BYTES) {
    throw new FilePathInvalidError(
      `文件过大 (${stat.size} bytes)，超过读取上限 ${READ_MAX_BYTES} bytes`,
    );
  }

  const content = await fs.readFile(absPath, 'utf-8');
  return {
    path: relPath,
    content,
    size: stat.size,
    modified_at: stat.mtime.toISOString(),
  };
}

/**
 * 写入 workdir 下的文件（覆盖已存在的文件）。
 * @param workdir 实例工作目录（绝对路径）
 * @param relPath 相对 workdir 的路径
 * @param content 文件内容
 * @param encoding 编码（utf-8 或 base64）
 * @throws {FilePathInvalidError} 路径非法
 */
export async function writeFile(
  workdir: string,
  relPath: string,
  content: string,
  encoding: 'utf-8' | 'base64' = 'utf-8',
): Promise<FileWriteResult> {
  const absPath = safeResolve(workdir, relPath);

  // 写入前 size 校验（防超大文件）
  const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8');
  if (buf.length > WRITE_MAX_BYTES) {
    throw new FilePathInvalidError(
      `写入内容过大 (${buf.length} bytes)，超过写入上限 ${WRITE_MAX_BYTES} bytes`,
    );
  }

  // 若文件已存在，检查非 symlink
  await assertNotSymlink(absPath);

  // 确保父目录存在
  const parentDir = path.dirname(absPath);
  await fs.mkdir(parentDir, { recursive: true });

  await fs.writeFile(absPath, buf);

  const stat = await fs.stat(absPath);
  return {
    path: relPath,
    size: stat.size,
    modified_at: stat.mtime.toISOString(),
  };
}

/**
 * 列出 workdir 下指定目录的所有条目（v4.3.0-F1 新增）。
 *
 * @param workdir 实例工作目录（绝对路径）
 * @param relPath 相对 workdir 的目录路径；空字符串或 "." 表示 workdir 本身
 * @param recursive 是否递归列出（默认 false，仅一级）
 * @param maxEntries 最大条目数（防超大目录 OOM，默认 5000）
 * @throws {FilePathInvalidError} 路径非法或逃逸
 * @throws {FileNotFoundError} 目录不存在
 */
export async function listDir(
  workdir: string,
  relPath: string,
  recursive = false,
  maxEntries = 5000,
): Promise<ListDirResult> {
  // 兼容空字符串（表示 workdir 本身）
  const safeRel = relPath === '' || relPath === '.' ? '.' : relPath;
  const absPath = safeResolve(workdir, safeRel);
  await assertNotSymlink(absPath);

  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileNotFoundError(`目录不存在: ${relPath}`);
    }
    throw err;
  }
  if (!stat.isDirectory()) {
    throw new FilePathInvalidError(`path 不是目录: ${relPath}`);
  }

  const entries: DirEntry[] = [];
  await walkDir(absPath, '', entries, recursive, maxEntries);

  return {
    path: relPath === '' ? '.' : relPath,
    entries,
  };
}

/**
 * 递归遍历目录，填充 entries。
 * @param absBase 已解析的目录绝对路径
 * @param relBase 相对 absBase 的前缀（递归用）
 */
async function walkDir(
  absBase: string,
  relBase: string,
  entries: DirEntry[],
  recursive: boolean,
  maxEntries: number,
): Promise<void> {
  if (entries.length >= maxEntries) return;

  let names: string[];
  try {
    names = await fs.readdir(absBase);
  } catch (err) {
    // 权限不足或被并发删除：跳过该目录
    return;
  }

  for (const name of names) {
    if (entries.length >= maxEntries) return;

    // 跳过隐藏文件（. 开头），避免列出 .git 等噪声
    // 注：Minecraft 服务器可能用到 .properties 等隐藏文件，但 workdir 顶层一般不会
    // 这里不做跳过，由调用方按需过滤
    const absChild = path.join(absBase, name);
    const relChild = relBase === '' ? name : `${relBase}/${name}`;

    let childStat;
    try {
      // 使用 lstat 避免 symlink 自动跟随
      childStat = await fs.lstat(absChild);
    } catch {
      // 文件被并发删除：跳过
      continue;
    }

    // 拒绝 symlink（不列入，防软链接逃逸）
    if (childStat.isSymbolicLink()) continue;

    if (childStat.isDirectory()) {
      entries.push({
        path: relChild,
        name,
        type: 'directory',
        size: 0,
        modified_at: childStat.mtime.toISOString(),
        extension: '',
      });
      if (recursive) {
        await walkDir(absChild, relChild, entries, recursive, maxEntries);
      }
    } else if (childStat.isFile()) {
      const ext = path.extname(name).slice(1).toLowerCase();
      entries.push({
        path: relChild,
        name,
        type: 'file',
        size: childStat.size,
        modified_at: childStat.mtime.toISOString(),
        extension: ext,
      });
    }
    // 其他类型（FIFO/socket/block/char）跳过
  }
}

/**
 * 切换 mod 启用状态：.jar ↔ .jar.disabled（v4.3.0-H1 新增）。
 * @param workdir 实例工作目录
 * @param modName mod 文件名（如 example.jar 或 example.jar.disabled）
 * @returns 新状态
 * @throws {FilePathInvalidError} 路径非法
 * @throws {FileNotFoundError} 文件不存在
 * @throws {Error} 文件名不符合 .jar / .jar.disabled 规则
 */
export async function toggleModFile(
  workdir: string,
  modName: string,
): Promise<{ name: string; new_state: 'enabled' | 'disabled' }> {
  // 校验 modName 必须为纯文件名（无路径）
  if (modName.includes('/') || modName.includes('\\') || modName.includes('..')) {
    throw new FilePathInvalidError(`modName 不能包含路径分隔符或 ..: ${modName}`);
  }
  // 路径必须在 mods/ 子目录下
  const modsRel = `mods/${modName}`;
  const absPath = safeResolve(workdir, modsRel);

  let stat;
  try {
    stat = await fs.lstat(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileNotFoundError(`mod 文件不存在: ${modName}`);
    }
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new FilePathInvalidError(`mod 文件不允许为 symlink: ${modName}`);
  }
  if (!stat.isFile()) {
    throw new FilePathInvalidError(`mod 路径不是文件: ${modName}`);
  }

  // 判定当前状态与目标路径
  const isDisabled = modName.endsWith('.disabled');
  const enabledName = isDisabled ? modName.slice(0, -'.disabled'.length) : modName;
  if (!enabledName.endsWith('.jar')) {
    throw new Error(`mod 文件名必须以 .jar 或 .jar.disabled 结尾: ${modName}`);
  }
  const disabledName = `${enabledName}.disabled`;

  const fromPath = absPath;
  const toPath = path.join(path.dirname(absPath), isDisabled ? enabledName : disabledName);

  await fs.rename(fromPath, toPath);

  return {
    name: isDisabled ? enabledName : disabledName,
    new_state: isDisabled ? 'enabled' : 'disabled',
  };
}
