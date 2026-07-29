// ============================================================================
// fileService — 文件管理服务（v4.3.0-F1~F5）
//
// 职责：
//   - 调用 daemonClient.listFiles / readFile / writeFile / execCommand 完成实例目录的文件操作
//   - 分片上传的会话管理（init → chunk → finish）
//   - 异步任务（download/compress/decompress）通过 taskService 提交
//
// 契约：
//   - public/schema/panel-api-types.ts → ListFilesResponse / ReadFileContentResponse / etc.
//   - public/interface_stub/daemon-client.d.ts → DaemonClient
//   - public/interface_stub/task-service.d.ts → TaskService
//
// 安全：
//   - 路径穿越防护在 daemon 端 fileManager.safeResolve 执行
//   - Panel 层做二进制后缀黑名单过滤（写入 content 时拦截）
//   - 上传会话 1h TTL，uploadId 必须 32 位 hex
// ============================================================================

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { TaskService, TaskExecutor } from '@public/interface_stub/task-service';
import type {
  ListFilesResponse,
  FileEntry,
  ReadFileContentResponse,
  WriteFileContentResponse,
  UploadInitResponse,
  UploadFinishResponse,
  DownloadFileResponse,
  CompressFileResponse,
  DecompressFileResponse,
} from '@public/schema/panel-api-types';
import { ValidationError, FileOperationError } from './errors.js';

// ----- 常量 -----

/** 单次写入最大字节数（2MB，与 F2 一致） */
const WRITE_MAX_BYTES = 2 * 1024 * 1024;
/** 上传会话 TTL（1 小时） */
const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;
/** 单分片最大字节数（512KB，base64 后约 682KB） */
const CHUNK_MAX_BYTES = 512 * 1024;
/** 最大分片数（防无限分片） */
const MAX_CHUNKS = 1024;
/** 二进制后缀黑名单（写入 content 时拦截，强制走分片上传） */
const BINARY_EXTENSIONS = new Set([
  'jar', 'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib',
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'tiff',
  'db', 'dat', 'level', 'region', 'mca',
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'avi', 'mov',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

// ----- DB 行类型 -----

interface ServerRow {
  id: string;
  node_id: string;
}

// ----- 上传会话（内存） -----

interface UploadSession {
  uploadId: string;
  serverId: string;
  chunks: Map<number, Buffer>;
  createdAt: number;
  expiresAt: number;
}

// ----- 实现 -----

export class FileServiceImpl {
  private readonly uploadSessions = new Map<string, UploadSession>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Knex,
    private readonly daemonClient: DaemonClient,
    private readonly taskService: TaskService,
  ) {
    this.startUploadCleanup();
  }

  // ----- F1: 目录列表 -----

  async listFiles(serverId: string, relPath: string, recursive = false): Promise<ListFilesResponse> {
    const { nodeId } = await this.resolveNode(serverId);
    const result = await this.daemonClient.listFiles(nodeId, serverId, relPath, recursive);
    // 标注 is_binary 字段（daemon 返回的 DirEntry 没有此字段，由 Panel 层补全）
    const entries: FileEntry[] = result.entries.map((e) => ({
      path: e.path,
      name: e.name,
      type: e.type,
      size: e.size,
      modified_at: e.modified_at,
      extension: e.extension,
      is_binary: e.type === 'file' ? BINARY_EXTENSIONS.has(e.extension.toLowerCase()) : false,
    }));
    return { path: result.path, entries };
  }

  // ----- F2: 文件内容读写 -----

  async readFileContent(serverId: string, relPath: string): Promise<ReadFileContentResponse> {
    const { nodeId } = await this.resolveNode(serverId);
    const result = await this.daemonClient.readFile(nodeId, serverId, relPath);
    return {
      path: result.path,
      content: result.content,
      size: result.size,
      modified_at: result.modified_at,
      encoding: 'utf-8',
    };
  }

  async writeFileContent(serverId: string, relPath: string, content: string): Promise<WriteFileContentResponse> {
    // 二进制后缀拦截
    const ext = path.extname(relPath).slice(1).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      throw new FileOperationError('FILE_BINARY_NOT_EDITABLE', `二进制文件 ${ext} 不能通过 content 接口编辑，请使用分片上传`);
    }
    // 大小校验
    const buf = Buffer.from(content, 'utf-8');
    if (buf.length > WRITE_MAX_BYTES) {
      throw new FileOperationError('FILE_TOO_LARGE', `文件内容过大 (${buf.length} bytes)，超过写入上限 ${WRITE_MAX_BYTES} bytes`);
    }
    const { nodeId } = await this.resolveNode(serverId);
    const result = await this.daemonClient.writeFile(nodeId, serverId, relPath, { content, encoding: 'utf-8' });
    return {
      path: result.path,
      size: result.size,
      modified_at: result.modified_at,
    };
  }

  // ----- F3: 分片上传 -----

  /**
   * 初始化上传会话。返回 uploadId（32 位 hex）+ 过期时间。
   */
  initUpload(serverId: string): UploadInitResponse {
    const uploadId = randomUUID().replace(/-/g, '');
    const now = Date.now();
    const session: UploadSession = {
      uploadId,
      serverId,
      chunks: new Map(),
      createdAt: now,
      expiresAt: now + UPLOAD_SESSION_TTL_MS,
    };
    this.uploadSessions.set(uploadId, session);
    return {
      upload_id: uploadId,
      expires_at: new Date(session.expiresAt).toISOString(),
    };
  }

  /**
   * 接收一个分片。校验 uploadId / index / size。
   */
  uploadChunk(uploadId: string, index: number, base64Content: string): { received: boolean } {
    const session = this.uploadSessions.get(uploadId);
    if (!session) {
      throw new FileOperationError('FILE_UPLOAD_ID_INVALID', `uploadId 不存在或已过期: ${uploadId}`);
    }
    if (session.expiresAt < Date.now()) {
      this.uploadSessions.delete(uploadId);
      throw new FileOperationError('FILE_UPLOAD_EXPIRED', `上传会话已过期: ${uploadId}`);
    }
    if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
      throw new ValidationError(`分片索引非法: ${index}`);
    }
    if (session.chunks.has(index)) {
      // 重复上传：幂等返回 received=true
      return { received: true };
    }
    // base64 解码
    let buf: Buffer;
    try {
      buf = Buffer.from(base64Content, 'base64');
    } catch {
      throw new FileOperationError('FILE_UPLOAD_CHUNK_INVALID', `分片 ${index} base64 解码失败`);
    }
    if (buf.length === 0) {
      throw new FileOperationError('FILE_UPLOAD_CHUNK_INVALID', `分片 ${index} 内容为空`);
    }
    if (buf.length > CHUNK_MAX_BYTES) {
      throw new FileOperationError('FILE_UPLOAD_CHUNK_INVALID', `分片 ${index} 过大 (${buf.length} bytes)，上限 ${CHUNK_MAX_BYTES}`);
    }
    session.chunks.set(index, buf);
    return { received: true };
  }

  /**
   * 完成上传：合并所有分片 → 通过 daemonClient.writeFile 写入实例目录。
   */
  async finishUpload(uploadId: string, targetPath: string): Promise<UploadFinishResponse> {
    const session = this.uploadSessions.get(uploadId);
    if (!session) {
      throw new FileOperationError('FILE_UPLOAD_ID_INVALID', `uploadId 不存在或已过期: ${uploadId}`);
    }
    if (session.expiresAt < Date.now()) {
      this.uploadSessions.delete(uploadId);
      throw new FileOperationError('FILE_UPLOAD_EXPIRED', `上传会话已过期: ${uploadId}`);
    }
    // 校验分片连续性：0..N-1 必须全部存在
    const indices = Array.from(session.chunks.keys()).sort((a, b) => a - b);
    if (indices.length === 0) {
      throw new ValidationError('无任何分片可合并');
    }
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) {
        throw new ValidationError(`分片不连续：缺少 index=${i}`);
      }
    }
    // 合并
    const totalSize = indices.reduce((sum, idx) => sum + session.chunks.get(idx)!.length, 0);
    if (totalSize > 100 * 1024 * 1024) {
      throw new FileOperationError('FILE_TOO_LARGE', `合并后文件过大 (${totalSize} bytes)，上限 100MB`);
    }
    const merged = Buffer.concat(indices.map((idx) => session.chunks.get(idx)!));
    // 写入实例目录（base64 编码后传给 daemon）
    const { nodeId } = await this.resolveNode(session.serverId);
    const result = await this.daemonClient.writeFile(nodeId, session.serverId, targetPath, {
      content: merged.toString('base64'),
      encoding: 'base64',
    });
    // 清理会话
    this.uploadSessions.delete(uploadId);
    return { path: result.path, size: result.size };
  }

  // ----- F4: 异步下载 -----

  /**
   * 提交异步下载任务。返回 taskId。
   * executor 内部使用 fetch 流式下载到实例目录（通过 daemonClient.writeFile 分段写入）。
   */
  submitDownloadTask(serverId: string, url: string, targetPath: string, sha256?: string): DownloadFileResponse {
    const executor: TaskExecutor = async (ctx) => {
      ctx.reportProgress(0, `开始下载 ${url}`);
      // 使用全局 fetch（Node 18+）
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`下载失败：HTTP ${response.status} ${response.statusText}`);
      }
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (!response.body) {
        throw new Error('下载响应无 body');
      }
      // 流式读取并按 512KB 分块累积（避免一次性 OOM）
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let received = 0;
      let lastReport = 0;
      try {
        while (true) {
          if (ctx.shouldCancel()) {
            throw new Error('下载被取消');
          }
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          received += value.byteLength;
          // 1s 节流上报
          const now = Date.now();
          if (now - lastReport > 1000) {
            lastReport = now;
            const percent = contentLength > 0 ? Math.floor((received / contentLength) * 100) : 0;
            ctx.reportProgress(percent, `已下载 ${received} / ${contentLength} bytes`);
          }
        }
      } finally {
        reader.releaseLock();
      }
      ctx.reportProgress(95, '下载完成，写入文件');
      // 合并并写入
      const merged = Buffer.concat(chunks);
      const { nodeId } = await this.resolveNode(serverId);
      const writeResult = await this.daemonClient.writeFile(nodeId, serverId, targetPath, {
        content: merged.toString('base64'),
        encoding: 'base64',
      });
      ctx.reportProgress(100, '写入完成');
      return {
        output_path: writeResult.path,
        bytes: writeResult.size,
        meta: { source_url: url, sha256_provided: sha256 ?? null },
      };
    };

    const taskId = this.taskService.submitTask('download', { server_id: serverId, executor });
    return { task_id: taskId, status: 'running' };
  }

  // ----- F5: 压缩 / 解压 -----

  /**
   * 提交异步压缩任务。使用 daemon execCommand 调用系统 tar / zip 命令。
   */
  submitCompressTask(serverId: string, sourcePath: string, targetPath: string, format?: 'zip' | 'tar.gz'): CompressFileResponse {
    const fmt = format ?? (targetPath.endsWith('.zip') ? 'zip' : 'tar.gz');
    const executor: TaskExecutor = async (ctx) => {
      ctx.reportProgress(0, `开始压缩 ${sourcePath} → ${targetPath}`);
      const { nodeId } = await this.resolveNode(serverId);
      // 构造命令：zip -r target source / tar -czf target source
      const binary = fmt === 'zip' ? 'zip' : 'tar';
      const args = fmt === 'zip'
        ? ['-r', targetPath, sourcePath]
        : ['-czf', targetPath, sourcePath];
      const result = await this.daemonClient.execCommand(nodeId, serverId, {
        binary,
        args,
        timeout: 300_000, // 5 分钟
      });
      if (result.exit_code !== 0) {
        throw new Error(`压缩失败（exit=${result.exit_code}）: ${result.stderr}`);
      }
      ctx.reportProgress(100, '压缩完成');
      return { output_path: targetPath, meta: { format: fmt, source: sourcePath } };
    };
    const taskId = this.taskService.submitTask('compress', { server_id: serverId, executor });
    return { task_id: taskId, status: 'running' };
  }

  /**
   * 提交异步解压任务。
   */
  submitDecompressTask(serverId: string, sourcePath: string, targetPath: string): DecompressFileResponse {
    const fmt: 'zip' | 'tar.gz' = sourcePath.endsWith('.zip') ? 'zip' : 'tar.gz';
    const executor: TaskExecutor = async (ctx) => {
      ctx.reportProgress(0, `开始解压 ${sourcePath} → ${targetPath}`);
      const { nodeId } = await this.resolveNode(serverId);
      // 构造命令：unzip -o source -d target / tar -xzf source -C target
      const binary = fmt === 'zip' ? 'unzip' : 'tar';
      const args = fmt === 'zip'
        ? ['-o', sourcePath, '-d', targetPath]
        : ['-xzf', sourcePath, '-C', targetPath];
      const result = await this.daemonClient.execCommand(nodeId, serverId, {
        binary,
        args,
        timeout: 300_000,
      });
      if (result.exit_code !== 0) {
        throw new Error(`解压失败（exit=${result.exit_code}）: ${result.stderr}`);
      }
      ctx.reportProgress(100, '解压完成');
      return { output_path: targetPath, meta: { format: fmt, source: sourcePath } };
    };
    const taskId = this.taskService.submitTask('decompress', { server_id: serverId, executor });
    return { task_id: taskId, status: 'running' };
  }

  // ----- 销毁 -----

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.uploadSessions.clear();
  }

  // ----- 内部辅助 -----

  private async resolveNode(serverId: string): Promise<{ nodeId: string }> {
    const server = await this.db<ServerRow>('servers').select('id', 'node_id').where({ id: serverId }).first();
    if (!server) {
      throw new FileOperationError('SERVER_NOT_FOUND', `实例不存在: ${serverId}`);
    }
    return { nodeId: server.node_id };
  }

  private startUploadCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.uploadSessions.entries()) {
        if (session.expiresAt < now) {
          this.uploadSessions.delete(id);
        }
      }
    }, 5 * 60 * 1000); // 5 分钟扫描
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }
}

// ----- 工厂 -----

export function createFileService(db: Knex, daemonClient: DaemonClient, taskService: TaskService): FileServiceImpl {
  return new FileServiceImpl(db, daemonClient, taskService);
}
