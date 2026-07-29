// ============================================================================
// parallelDownloader — v4.3.0-G2 分块并行下载器
//
// 职责：
//   - 通过 HTTP Range 头分块并行下载大文件
//   - 8 分块并行 + 3 文件并发 + 进度节流（1s 一次）+ 失败重试 5 次
//   - 不支持 Range 的服务器自动降级为单连接顺序下载
//   - 校验 Content-Length 与已下载字节一致性，确保文件完整
//
// 契约：
//   - 被 updateService.downloadUpdate 用于替代 curl 直链下载
//   - 不直接依赖 daemon / db / Knex，纯函数式下载工具
//   - 进度回调由调用方注入（updateService 通过 setProgress 写入 progressStore）
//
// 安全：
//   - 目标 URL 由 Pack 配置渲染，已由 renderTemplate + sanitizeTemplateVar 防注入
//   - 写入路径由调用方决定（updateService 传 daemon exec 的 downloadPath）
//   - 本模块只负责把字节写到 WritableStream，不做路径校验
// ============================================================================

import { createWriteStream, type WriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

// ----- 常量 -----

/** 并行分块数 */
const PARALLEL_CHUNKS = 8;
/** 同时下载的文件数上限（同一时刻最多 3 个 ParallelDownloader 在跑） */
const MAX_CONCURRENT_FILES = 3;
/** 单分片失败重试次数 */
const MAX_RETRIES = 5;
/** 单分片请求超时（30s） */
const CHUNK_TIMEOUT_MS = 30_000;
/** 重试退避基数（200ms，2^n 指数退避） */
const RETRY_BACKOFF_BASE_MS = 200;
/** 进度节流间隔（1s） */
const PROGRESS_THROTTLE_MS = 1_000;
/** 单分片最小字节数（1MB，避免文件过小分太多块） */
const MIN_CHUNK_BYTES = 1024 * 1024;
/** 单分片最大字节数（16MB，避免单块过大占内存） */
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

// ----- 类型 -----

export interface DownloadProgress {
  /** 已下载字节数 */
  downloaded_bytes: number;
  /** 总字节数（不支持 Content-Length 时为 null） */
  total_bytes: number | null;
  /** 百分比 0-100（total_bytes 为 null 时为 0） */
  percent: number;
  /** 速度 bytes/s */
  speed_bytes_per_sec: number;
}

export interface ParallelDownloadOptions {
  /** 目标 URL */
  url: string;
  /** 本地保存路径（绝对路径） */
  destPath: string;
  /** 进度回调（节流到 1s 一次） */
  onProgress?: (progress: DownloadProgress) => void;
  /** 取消信号：返回 true 时立即中止下载 */
  shouldCancel?: () => boolean;
  /** 鉴权头（可选，用于私有源） */
  headers?: Record<string, string>;
  /** 并行度覆盖（默认 8） */
  parallelism?: number;
}

export interface ParallelDownloadResult {
  /** 下载字节数 */
  bytes: number;
  /** 是否走了 Range 并行路径（false = 降级为单连接） */
  parallel: boolean;
  /** 实际使用的分块数 */
  chunks: number;
}

// ----- 并发信号量 -----

class Semaphore {
  private current = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const fileSemaphore = new Semaphore(MAX_CONCURRENT_FILES);

// ----- 主入口 -----

/**
 * 分块并行下载文件。
 *
 * 流程：
 *   1. HEAD 请求获取 Content-Length + Accept-Ranges
 *   2. 支持 Range → 按并行度分块，并行下载每块到临时文件
 *   3. 不支持 Range → 降级为单连接顺序下载
 *   4. 全部完成后合并临时文件 → 目标文件
 *
 * @throws {Error} 下载失败（所有重试耗尽 / 取消 / IO 错误）
 */
export async function parallelDownload(
  options: ParallelDownloadOptions,
): Promise<ParallelDownloadResult> {
  await fileSemaphore.acquire();
  try {
    return await doDownload(options);
  } finally {
    fileSemaphore.release();
  }
}

async function doDownload(
  options: ParallelDownloadOptions,
): Promise<ParallelDownloadResult> {
  const {
    url,
    destPath,
    onProgress,
    shouldCancel,
    headers,
    parallelism = PARALLEL_CHUNKS,
  } = options;

  // 1. 确保目标目录存在
  await mkdir(dirname(destPath), { recursive: true });

  // 2. HEAD 请求探测服务器能力
  const probe = await probeUrl(url, headers);

  // 3. 不支持 Range 或无 Content-Length → 降级单连接
  if (!probe.acceptRanges || probe.contentLength === null) {
    const bytes = await sequentialDownload(
      url,
      destPath,
      probe.contentLength,
      onProgress,
      shouldCancel,
      headers,
    );
    return { bytes, parallel: false, chunks: 1 };
  }

  // 4. 分块并行下载
  const totalBytes = probe.contentLength;
  const chunkSize = computeChunkSize(totalBytes, parallelism);
  const chunks = Math.max(1, Math.ceil(totalBytes / chunkSize));

  // 4.0 预创建目标文件并截断到 totalBytes，避免分片以 r+ 打开时 ENOENT
  await ensureFileExists(destPath, totalBytes);

  // 4.1 为每个分片启动下载任务
  const downloadTasks: Array<Promise<void>> = [];
  const progressTracker = new ProgressTracker(totalBytes, onProgress);

  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize - 1, totalBytes - 1);
    downloadTasks.push(
      downloadChunkWithRetry(
        url,
        start,
        end,
        i,
        destPath,
        progressTracker,
        shouldCancel,
        headers,
      ),
    );
  }

  // 4.2 等待全部分片完成
  await Promise.all(downloadTasks);

  // 4.3 校验总字节数
  if (progressTracker.getDownloadedBytes() !== totalBytes) {
    throw new Error(
      `下载字节数不匹配: expected=${totalBytes}, actual=${progressTracker.getDownloadedBytes()}`,
    );
  }

  progressTracker.flush();
  return {
    bytes: totalBytes,
    parallel: true,
    chunks,
  };
}

// ----- 探测 -----

interface ProbeResult {
  acceptRanges: boolean;
  contentLength: number | null;
}

async function probeUrl(
  url: string,
  headers?: Record<string, string>,
): Promise<ProbeResult> {
  const resp = await fetch(url, {
    method: 'HEAD',
    headers: { ...headers },
    signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`HEAD 请求失败: HTTP ${resp.status} ${resp.statusText}`);
  }
  const acceptRanges = resp.headers.get('accept-ranges') === 'bytes';
  const contentLengthHeader = resp.headers.get('content-length');
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
  return { acceptRanges, contentLength };
}

// ----- 分块下载 -----

function computeChunkSize(totalBytes: number, parallelism: number): number {
  const ideal = Math.ceil(totalBytes / parallelism);
  return Math.max(MIN_CHUNK_BYTES, Math.min(ideal, MAX_CHUNK_BYTES));
}

async function downloadChunkWithRetry(
  url: string,
  start: number,
  end: number,
  chunkIndex: number,
  destPath: string,
  progressTracker: ProgressTracker,
  shouldCancel?: () => boolean,
  headers?: Record<string, string>,
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (shouldCancel?.()) {
      throw new Error('下载被取消');
    }
    try {
      await downloadChunkOnce(url, start, end, chunkIndex, destPath, progressTracker, shouldCancel, headers);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 指数退避
      const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
      await sleep(backoff);
    }
  }
  throw new Error(
    `分片 ${chunkIndex} [${start}-${end}] 下载失败（重试 ${MAX_RETRIES} 次）: ${lastError?.message}`,
  );
}

async function downloadChunkOnce(
  url: string,
  start: number,
  end: number,
  chunkIndex: number,
  destPath: string,
  progressTracker: ProgressTracker,
  shouldCancel?: () => boolean,
  headers?: Record<string, string>,
): Promise<void> {
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      ...headers,
      Range: `bytes=${start}-${end}`,
    },
    signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
  });
  if (!resp.ok && resp.status !== 206) {
    throw new Error(`分片 ${chunkIndex} HTTP ${resp.status} ${resp.statusText}`);
  }

  // 使用 r+ 模式打开目标文件并 seek 到 start 位置写入
  // 注意：所有分片共享同一目标文件，每个分片写入自己的 [start, end] 区间
  const fh = await open(destPath, 'r+', 0o644);
  try {
    // 检查是否需要先创建/截断文件
    const { size } = await fh.stat();
    if (size < end + 1) {
      // 文件不够大，扩展到 end+1
      await fh.truncate(end + 1);
    }
    const writeStream = fh.createWriteStream({
      start,
    });
    await pipeResponseToStream(resp, writeStream, chunkIndex, progressTracker, shouldCancel);
  } finally {
    await fh.close();
  }
}

/**
 * 首次调用前需要确保目标文件已存在并截断到 totalBytes。
 * doDownload 会在分块下载前创建空文件。
 */
async function ensureFileExists(destPath: string, size: number): Promise<void> {
  // doDownload 在并行下载前调用此函数
  const fh = await open(destPath, 'w', 0o644);
  try {
    await fh.truncate(size);
  } finally {
    await fh.close();
  }
}

async function pipeResponseToStream(
  resp: Response,
  writeStream: WriteStream,
  chunkIndex: number,
  progressTracker: ProgressTracker,
  shouldCancel?: () => boolean,
): Promise<void> {
  if (!resp.body) {
    throw new Error(`分片 ${chunkIndex} 响应体为空`);
  }
  const reader = resp.body.getReader();
  try {
    while (true) {
      if (shouldCancel?.()) {
        throw new Error('下载被取消');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await new Promise<void>((resolve, reject) => {
          writeStream.write(value, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        progressTracker.addBytes(value.byteLength);
      }
    }
  } finally {
    reader.releaseLock();
    await new Promise<void>((resolve) => {
      writeStream.end(() => resolve());
    });
  }
}

// ----- 顺序下载（降级路径） -----

async function sequentialDownload(
  url: string,
  destPath: string,
  totalBytes: number | null,
  onProgress?: (progress: DownloadProgress) => void,
  shouldCancel?: () => boolean,
  headers?: Record<string, string>,
): Promise<number> {
  const resp = await fetch(url, {
    method: 'GET',
    headers: { ...headers },
    signal: AbortSignal.timeout(600_000),
  });
  if (!resp.ok) {
    throw new Error(`下载失败: HTTP ${resp.status} ${resp.statusText}`);
  }
  if (!resp.body) {
    throw new Error('响应体为空');
  }

  const tracker = new ProgressTracker(totalBytes, onProgress);
  const writeStream = createWriteStream(destPath);
  const reader = resp.body.getReader();
  let downloaded = 0;

  try {
    while (true) {
      if (shouldCancel?.()) {
        throw new Error('下载被取消');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await new Promise<void>((resolve, reject) => {
          writeStream.write(value, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        downloaded += value.byteLength;
        tracker.addBytes(value.byteLength);
      }
    }
  } finally {
    reader.releaseLock();
    await new Promise<void>((resolve) => {
      writeStream.end(() => resolve());
    });
    tracker.flush();
  }

  return downloaded;
}

// ----- 进度跟踪 -----

class ProgressTracker {
  private downloadedBytes = 0;
  private startTime = Date.now();
  private lastReportAt = 0;
  private lastReportBytes = 0;

  constructor(
    private readonly totalBytes: number | null,
    private readonly onProgress?: (p: DownloadProgress) => void,
  ) {}

  addBytes(n: number): void {
    this.downloadedBytes += n;
    this.maybeReport();
  }

  getDownloadedBytes(): number {
    return this.downloadedBytes;
  }

  private maybeReport(): void {
    if (!this.onProgress) return;
    const now = Date.now();
    if (now - this.lastReportAt < PROGRESS_THROTTLE_MS) return;
    this.lastReportAt = now;
    const elapsed = (now - this.startTime) / 1000;
    const deltaBytes = this.downloadedBytes - this.lastReportBytes;
    const speed = elapsed > 0 ? deltaBytes / (now - this.lastReportAt + 1) * 1000 : 0;
    this.lastReportBytes = this.downloadedBytes;
    this.onProgress({
      downloaded_bytes: this.downloadedBytes,
      total_bytes: this.totalBytes,
      percent: this.totalBytes ? Math.min(100, (this.downloadedBytes / this.totalBytes) * 100) : 0,
      speed_bytes_per_sec: speed,
    });
  }

  flush(): void {
    if (!this.onProgress) return;
    this.onProgress({
      downloaded_bytes: this.downloadedBytes,
      total_bytes: this.totalBytes,
      percent: this.totalBytes ? 100 : 0,
      speed_bytes_per_sec: 0,
    });
  }
}

// ----- 工具 -----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// v4.3.0-G1: 导出 mirror source fallback helper
/**
 * 按顺序尝试多个镜像源下载，直到成功或全部失败。
 *
 * @param urls 镜像源 URL 数组（按优先级排序）
 * @param options 下载选项（destPath/onProgress 等）
 * @returns 第一个成功下载的结果
 * @throws {Error} 所有镜像源都失败时抛出聚合错误
 */
export async function downloadWithMirrorFallback(
  urls: string[],
  options: Omit<ParallelDownloadOptions, 'url'>,
): Promise<ParallelDownloadResult> {
  if (urls.length === 0) {
    throw new Error('镜像源列表为空');
  }

  const errors: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const result = await parallelDownload({
        ...options,
        url: urls[i],
      });
      return result;
    } catch (err) {
      errors.push(`[${i}] ${urls[i]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`所有镜像源下载失败:\n${errors.join('\n')}`);
}
