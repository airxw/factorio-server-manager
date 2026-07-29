// ============================================================================
// versionCompare.ts — 版本号规范化解析与比对
//
// 步骤 2:版本号规范化与比对逻辑修复
//
// 支持的版本号格式:
//   - 标准 semver:        "2.0.77" / "1.20.4"
//   - v 前缀:             "v5.2.0" / "v0.3.3"
//   - 多段版本号:         "1.20.4.1" / "0.3.3.54124"
//   - build 号:           "0.3.3.54124"(最后一段为 build 号)
//   - 非 semver(如 "1.0"): segments=[1,0],buildId=undefined
//
// 非 semver 版本(如纯 buildid)的 segments 统一为 [0],buildId 存储原始值。
// ============================================================================

/**
 * 解析后的版本号结构。
 *
 * - segments: 主版本段数组(如 "2.0.77" → [2,0,77];"0.3.3.54124" → [0,3,3])
 * - buildId:  build 号(如 "0.3.3.54124" → "54124";"2.0.77" → undefined)
 * - raw:      原始字符串(去除 v 前缀后)
 */
export interface ParsedVersion {
  segments: number[];
  buildId?: string;
  raw: string;
}

/**
 * 灵活解析版本号,支持 v 前缀、多段版本号、build 号。
 *
 * 解析规则:
 *   1. 去除 v/V 前缀(如 "v5.2.0" → "5.2.0")
 *   2. 按点分割为多段
 *   3. 每段尝试解析为数字;非数字段视为 buildId(停止解析后续段)
 *   4. 若最后一段长度 > 3 且前面已有 ≥3 段数字,视为 build 号(如 "0.3.3.54124" 的 "54124")
 *   5. 纯数字版本(如 Steam buildid "1234567")→ segments=[0],buildId="1234567"
 *
 * @param version 原始版本号字符串
 * @returns ParsedVersion
 */
export function parseVersionFlex(version: string): ParsedVersion {
  // 去除 v/V 前缀
  const stripped = version.replace(/^v/i, '').trim();
  const raw = stripped;

  // 纯数字(如 Steam buildid "1234567")
  if (/^\d+$/.test(stripped)) {
    // 若是短数字(≤3 位),视为单段版本号;否则视为 buildId
    if (stripped.length <= 3) {
      return { segments: [parseInt(stripped, 10)], raw };
    }
    return { segments: [0], buildId: stripped, raw };
  }

  const parts = stripped.split('.');
  const segments: number[] = [];
  let buildId: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();

    // 纯数字段:直接作为 segments
    if (/^\d+$/.test(part)) {
      // 判断是否为 build 号:前面已有 ≥3 段数字,且当前段长度 > 3(如 "54124")
      if (segments.length >= 3 && part.length > 3) {
        buildId = part;
        break;
      }
      segments.push(parseInt(part, 10));
      continue;
    }

    // 非纯数字段:尝试 "数字-后缀" 形式(如 "3-snapshot-4" → segment=3, buildId=snapshot-4)
    const prefixMatch = part.match(/^(\d+)-(.+)$/);
    if (prefixMatch) {
      // 数字前缀作为 segment
      segments.push(parseInt(prefixMatch[1], 10));
      // 后缀 + 剩余部分作为 buildId
      const remaining = [prefixMatch[2], ...parts.slice(i + 1)].join('.');
      if (remaining.length > 0) {
        buildId = remaining;
      }
      break;
    }

    // 完全非数字段:取剩余部分作为 buildId(如 "snapshot-4")
    const remaining = parts.slice(i).join('.');
    if (remaining.length > 0) {
      buildId = remaining;
    }
    break;
  }

  // 兜底:无有效段时返回 [0]
  if (segments.length === 0) {
    return { segments: [0], buildId, raw };
  }

  return { segments, buildId, raw };
}

/**
 * 比较两个版本号。
 *
 * 比对规则:
 *   1. 先比 segments(逐段数值比较,短的补 0);
 *   2. segments 相同时比 buildId(数值比较,缺失视为 0);
 *   3. 都没有 buildId 时视为相等。
 *
 * @returns 负数(a<b)/ 0(相等)/ 正数(a>b)
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersionFlex(a);
  const pb = parseVersionFlex(b);

  // 1. 比 segments
  const maxLen = Math.max(pa.segments.length, pb.segments.length);
  for (let i = 0; i < maxLen; i++) {
    const sa = pa.segments[i] ?? 0;
    const sb = pb.segments[i] ?? 0;
    if (sa !== sb) return sa - sb;
  }

  // 2. 比 buildId
  const buildA = pa.buildId ? parseInt(pa.buildId, 10) : 0;
  const buildB = pb.buildId ? parseInt(pb.buildId, 10) : 0;
  if (Number.isNaN(buildA) || Number.isNaN(buildB)) {
    // buildId 非数字时按字符串比较
    const strA = pa.buildId ?? '';
    const strB = pb.buildId ?? '';
    if (strA === strB) return 0;
    return strA < strB ? -1 : 1;
  }
  return buildA - buildB;
}

/**
 * 兼容旧接口:解析为 { major, minor, patch }。
 *
 * @deprecated v4.12.0:请使用 parseVersionFlex。本函数仅为向后兼容保留,
 *   对非 semver 版本统一返回 0(与旧行为一致)。
 */
export function parseVersionLegacy(v: string): { major: number; minor: number; patch: number } {
  const parsed = parseVersionFlex(v);
  return {
    major: parsed.segments[0] ?? 0,
    minor: parsed.segments[1] ?? 0,
    patch: parsed.segments[2] ?? 0,
  };
}
