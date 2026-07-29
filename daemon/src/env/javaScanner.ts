// ============================================================================
// javaScanner — Java 运行时环境扫描器（v4.4.0-M1）
//
// 职责：
//   - 扫描系统中可用的 Java 安装（JRE / JDK）
//   - 扫描路径：JAVA_HOME / PATH / /usr/lib/jvm / /usr/java / /opt/java
//   - 验证：执行 `java -version` 解析版本号 + 供应商
//   - 去重：同一路径仅保留一条记录
//   - 缓存：扫描结果可由 Panel 通过 system_config 表缓存，避免每次重复扫描
//
// 设计要点：
//   - 单次扫描：每次调用 scanJavas() 都重新扫描（轻量级，<1s）
//   - 失败容忍：单个路径扫描失败不影响其他路径
//   - Linux 优先：扫描路径仅适用于 Linux 系统（与项目部署环境一致）
//   - 解析 java -version 输出：兼容 OpenJDK / Oracle / Temurin / Zulu 等发行版
// ============================================================================

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
// v4.4.0-M1: 类型契约从公共 schema 导入（与 Panel 共享）
import type { JavaInstallation, ScanJavasResult } from '@public/schema/daemon-api-types';

// 重新导出类型供外部使用
export type { JavaInstallation, ScanJavasResult };

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// 类型定义见 @public/schema/daemon-api-types.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** java -version 执行超时（ms） */
const JAVA_VERSION_TIMEOUT_MS = 5_000;

/** 扫描根路径列表 */
const SCAN_ROOTS = [
  '/usr/lib/jvm',
  '/usr/java',
  '/opt/java',
  '/usr/local/java',
];

// ---------------------------------------------------------------------------
// 主入口：scanJavas
// ---------------------------------------------------------------------------

/**
 * 扫描系统中所有可用的 Java 安装
 *
 * 扫描顺序：
 *   1. JAVA_HOME 环境变量
 *   2. PATH 中的 java 命令（which java）
 *   3. SCAN_ROOTS 下的子目录（递归一层）
 *
 * 去重：按 `path`（java 可执行文件绝对路径）去重
 */
export async function scanJavas(): Promise<ScanJavasResult> {
  const startTime = Date.now();
  const candidates: Array<{ javaPath: string; source: string }> = [];
  const seenPaths = new Set<string>();
  let scannedPaths = 0;
  let failedPaths = 0;

  // 1. JAVA_HOME
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    scannedPaths++;
    const javaPath = path.join(javaHome, 'bin', 'java');
    if (fs.existsSync(javaPath)) {
      candidates.push({ javaPath, source: `JAVA_HOME=${javaHome}` });
      seenPaths.add(javaPath);
    } else {
      failedPaths++;
    }
  }

  // 2. PATH 中的 java（which java）
  scannedPaths++;
  try {
    const { stdout } = await execAsync('which java', { timeout: 2_000 });
    const whichPath = stdout.trim();
    if (whichPath && fs.existsSync(whichPath)) {
      // 解析符号链接获取真实路径
      let realPath = whichPath;
      try {
        realPath = fs.realpathSync(whichPath);
      } catch {
        // 保留原路径
      }
      if (!seenPaths.has(realPath)) {
        candidates.push({ javaPath: realPath, source: 'PATH (which java)' });
        seenPaths.add(realPath);
      }
    } else {
      failedPaths++;
    }
  } catch {
    // which java 失败（未安装或不在 PATH），忽略
    failedPaths++;
  }

  // 3. SCAN_ROOTS 下的子目录（递归一层）
  for (const root of SCAN_ROOTS) {
    scannedPaths++;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      // 路径不存在或无权限，跳过
      failedPaths++;
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(root, entry);
      const javaPath = path.join(entryPath, 'bin', 'java');
      if (fs.existsSync(javaPath)) {
        if (!seenPaths.has(javaPath)) {
          candidates.push({ javaPath, source: entryPath });
          seenPaths.add(javaPath);
        }
      }
    }
  }

  // 4. 并行验证所有候选路径（执行 java -version）
  const verifyResults = await Promise.allSettled(
    candidates.map((c) => verifyJava(c.javaPath, c.source)),
  );

  const installations: JavaInstallation[] = [];
  for (const r of verifyResults) {
    if (r.status === 'fulfilled' && r.value !== null) {
      installations.push(r.value);
    } else if (r.status === 'rejected') {
      failedPaths++;
    }
  }

  // 按版本号降序排序（高版本在前）
  installations.sort((a, b) => b.version - a.version);

  return {
    installations,
    elapsed_ms: Date.now() - startTime,
    scanned_paths: scannedPaths,
    failed_paths: failedPaths,
  };
}

// ---------------------------------------------------------------------------
// 辅助：验证单个 Java 安装
// ---------------------------------------------------------------------------

/**
 * 执行 `<javaPath> -version` 解析版本信息
 *
 * java -version 输出格式（stderr）：
 *   openjdk version "17.0.2" 2022-01-18
 *   OpenJDK Runtime Environment Temurin-17.0.2+8 (build 17.0.2+8)
 *   OpenJDK 64-Bit Server VM Temurin-17.0.2+8 (build 17.0.2+8, mixed mode, sharing)
 *
 * 旧版本（Java 8）格式：
 *   openjdk version "1.8.0_312"
 *   OpenJDK Runtime Environment (build 1.8.0_312-b07)
 *   OpenJDK 64-Bit Server VM (build 25.312-b07, mixed mode)
 *
 * Oracle 格式：
 *   java version "17.0.1" 2021-10-19 LTS
 *   Java(TM) SE Runtime Environment (build 17.0.1+12-39)
 *   Java HotSpot(TM) 64-Bit Server VM (build 17.0.1+12-39, mixed mode, sharing)
 *
 * @returns JavaInstallation | null（验证失败返回 null）
 */
async function verifyJava(javaPath: string, source: string): Promise<JavaInstallation | null> {
  try {
    const { stderr } = await execAsync(`"${javaPath}" -version`, {
      timeout: JAVA_VERSION_TIMEOUT_MS,
    });
    const output = stderr || '';
    // 部分新 JDK（如 JDK 20+）可能将版本信息输出到 stdout，合并解析
    let stdoutOutput = '';
    try {
      const { stdout } = await execAsync(`"${javaPath}" -version`, {
        timeout: JAVA_VERSION_TIMEOUT_MS,
      });
      stdoutOutput = stdout || '';
    } catch {
      // 某些 JDK 会用非零退出码输出到 stderr，忽略 stdout 失败
    }
    const combined = `${output}\n${stdoutOutput}`;

    // 解析版本号
    const versionMatch = combined.match(/version\s+"([^"]+)"/);
    if (!versionMatch) {
      return null;
    }
    const versionString = versionMatch[1]!;
    const mainVersion = parseMainVersion(versionString);

    // 解析供应商
    const vendor = parseVendor(combined);

    // 推断 JAVA_HOME（java 可执行文件往上两级）
    const javaHome = inferJavaHome(javaPath);

    // 判断是否为 JDK（检查 javac 是否存在）
    const isJdk = checkIsJdk(javaPath);

    return {
      path: javaPath,
      java_home: javaHome,
      version: mainVersion,
      version_string: versionString,
      vendor,
      is_jdk: isJdk,
      source,
    };
  } catch {
    return null;
  }
}

/**
 * 从完整版本字符串中解析主版本号
 * - "17.0.2" → 17
 * - "1.8.0_312" → 8（旧版 Java 8 使用 1.8 前缀）
 * - "11.0.15" → 11
 */
function parseMainVersion(versionString: string): number {
  // 旧版 Java（1.8 / 1.7 / 1.6）格式：1.X.Y → 主版本为 X
  const legacyMatch = versionString.match(/^1\.(\d+)\./);
  if (legacyMatch) {
    return parseInt(legacyMatch[1]!, 10);
  }
  // 新版 Java（9+）格式：X.Y.Z → 主版本为 X
  const modernMatch = versionString.match(/^(\d+)\./);
  if (modernMatch) {
    return parseInt(modernMatch[1]!, 10);
  }
  // 仅主版本号（如 "17"）
  const pureMatch = versionString.match(/^(\d+)$/);
  if (pureMatch) {
    return parseInt(pureMatch[1]!, 10);
  }
  return 0;
}

/**
 * 从 java -version 输出中解析供应商
 */
function parseVendor(output: string): string {
  // 优先匹配 "Vendor: XXX"（JDK 18+ 输出格式）
  const vendorMatch = output.match(/Vendor:\s*(.+)/);
  if (vendorMatch) {
    return vendorMatch[1]!.trim();
  }
  // 兼容旧格式：根据 Runtime Environment 行的关键字推断
  if (/Temurin/.test(output)) return 'Eclipse Adoptium (Temurin)';
  if (/Zulu/.test(output)) return 'Azul Systems, Inc.';
  if (/HotSpot/.test(output) && /Oracle/.test(output)) return 'Oracle Corporation';
  if (/OpenJDK/.test(output)) return 'OpenJDK';
  if (/GraalVM/.test(output)) return 'Oracle GraalVM';
  return 'Unknown';
}

/**
 * 推断 JAVA_HOME：从 java 可执行文件路径往上两级
 *   /usr/lib/jvm/java-17-openjdk-amd64/bin/java → /usr/lib/jvm/java-17-openjdk-amd64
 */
function inferJavaHome(javaPath: string): string | null {
  try {
    const binDir = path.dirname(javaPath);
    const homeDir = path.dirname(binDir);
    // 简单校验：homeDir 应包含 bin 子目录
    if (fs.existsSync(path.join(homeDir, 'bin'))) {
      return homeDir;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 检查是否为 JDK：查找同级目录下是否存在 javac
 */
function checkIsJdk(javaPath: string): boolean {
  try {
    const binDir = path.dirname(javaPath);
    const javacPath = path.join(binDir, 'javac');
    return fs.existsSync(javacPath);
  } catch {
    return false;
  }
}
