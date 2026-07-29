/**
 * 版本号同步校验脚本（L6）
 *
 * 校验以下来源的版本号一致（共 12 项）：
 *   1. version.json .version（根目录）
 *   2. version.json .daemon
 *   3. version.json .panel_backend
 *   4. version.json .panel_frontend
 *   5. package.json (root) .version
 *   6. panel/frontend/package.json .version
 *   7. panel/backend/package.json .version
 *   8. daemon/package.json .version
 *   9. version.md 最新版本条目（首行裸版本号 + 第一个 `## vX.Y.Z` 标题）
 *  10. README.md 中的版本号（**vX.Y.Z** 当前版本，兼容旧 # GameServer Panel X.Y.Z）
 *  11. deploy.sh 的 DEPLOY_VERSION 变量
 *  12. daemon/src/index.ts 的 DAEMON_VERSION 派生检查（v4.15.0 新增，闭环 bug1.md）
 *      - 必须从 package.json 派生（import pkg + pkg.version），不得硬编码字面量
 *      - 硬编码 → 强制拦截；派生 → version 取 daemon/package.json 值参与一致性校验
 *
 * 一致时输出 "✅ 版本号同步校验通过" 并 exit 0
 * 不一致时输出差异表并 exit 1
 *
 * 运行方式：npx tsx scripts/check-version-sync.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '..');

interface VersionSource {
    /** 来源标识，用于差异输出 */
    label: string;
    /** 解析出的版本号；解析失败为 null */
    version: string | null;
    /** 解析失败时的诊断信息 */
    error?: string;
}

/** 期望版本号格式：x.y.z，x/y/z 为非负整数 */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** 从 JSON 文件读取指定字段 */
function readJsonField(filePath: string, field: string): string | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const obj = JSON.parse(raw);
        return obj?.[field] != null ? String(obj[field]) : null;
    } catch (e) {
        return null;
    }
}

/** 从 version.json 读取 4 个版本字段，返回首个非空字段（正常情况下 4 个应一致） */
function readVersionJson(filePath: string): { version: string | null; subFields?: Record<string, string | null> } {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const obj = JSON.parse(raw);
        const sub: Record<string, string> = {};
        for (const k of ['version', 'daemon', 'panel_backend', 'panel_frontend']) {
            if (obj?.[k] != null) sub[k] = String(obj[k]);
        }
        return { version: obj?.version != null ? String(obj.version) : null, subFields: sub };
    } catch (e) {
        return { version: null };
    }
}

/** 从 version.md 解析首个 `## vX.Y.Z` 标题中的版本号 */
function readVersionMdLatest(filePath: string): string | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const match = raw.match(/^##\s+v(\d+\.\d+\.\d+)/m);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
}

/** 从 README.md 解析当前版本号
 *  兼容两种格式：
 *    旧：`# GameServer Panel X.Y.Z`（H1 标题内）
 *    新：`**vX.Y.Z**`（“当前版本”小节内的加粗版本号）
 */
function readReadmeVersion(filePath: string): string | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        // 优先匹配新格式：**vX.Y.Z**
        const newMatch = raw.match(/\*\*v(\d+\.\d+\.\d+)\*\*/);
        if (newMatch) return newMatch[1];
        // 回退到旧格式：# GameServer Panel X.Y.Z
        const oldMatch = raw.match(/^#\s+GameServer\s+Panel\s+(\d+\.\d+\.\d+)/m);
        return oldMatch ? oldMatch[1] : null;
    } catch (e) {
        return null;
    }
}

/** 从 deploy.sh 解析 `DEPLOY_VERSION="x.y.z"` 变量 */
function readDeployVersion(filePath: string): string | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const match = raw.match(/^DEPLOY_VERSION=["']([^"']+)["']/m);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
}

/**
 * v4.15.0: 校验 daemon/src/index.ts 的 DAEMON_VERSION 从 package.json 派生（非硬编码）
 *
 * 闭环 bug1.md 最早点名的"Daemon 运行时硬编码"校验盲区。DAEMON_VERSION 经
 * createDaemonServer → daemon-event-forwarder → nodeService 写入 nodes.daemon_version
 * 并在前端节点页展示，若硬编码且与 package.json 漂移，会出现"幽灵版本"且原校验脚本无告警。
 *
 * 判定逻辑：
 *  - 硬编码字面量 `const DAEMON_VERSION = 'x.y.z'` → version=null + error（强制拦截，防止回退）
 *  - 从 package.json 派生（import pkg from '../package.json' + DAEMON_VERSION = pkg.version）
 *    → version=daemonPkgVersion（与 daemon/package.json 一致，通过校验）
 *  - 来源不明 → version=null + error
 */
function checkDaemonVersionDerivation(
    filePath: string,
    daemonPkgVersion: string | null,
): VersionSource {
    const label = 'daemon/src/index.ts (DAEMON_VERSION ← package.json)';
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        // 硬编码字面量模式：const DAEMON_VERSION = 'x.y.z'
        const hardcoded = raw.match(/^const\s+DAEMON_VERSION\s*=\s*['"]([^'"]+)['"]/m);
        if (hardcoded) {
            return {
                label: 'daemon/src/index.ts (DAEMON_VERSION 硬编码)',
                version: null,
                error: `DAEMON_VERSION 硬编码为 '${hardcoded[1]}'，应改为从 package.json 读取（import pkg from '../package.json'; const DAEMON_VERSION = pkg.version;）`,
            };
        }
        // 确认从 package.json 派生：存在 import ... from '../package.json' 且 DAEMON_VERSION = ...version
        const importsPkg = /import\s+\w+\s+from\s+['"]\.\.\/package\.json['"]/.test(raw);
        const usesPkgVersion = /DAEMON_VERSION\s*=\s*\w+\.version/.test(raw);
        if (importsPkg && usesPkgVersion) {
            return {
                label,
                version: daemonPkgVersion,
                error:
                    daemonPkgVersion == null
                        ? '无法读取 daemon/package.json 的 version 字段'
                        : undefined,
            };
        }
        return {
            label: 'daemon/src/index.ts (DAEMON_VERSION)',
            version: null,
            error:
                'DAEMON_VERSION 既非硬编码也无法确认从 package.json 派生，请检查实现',
        };
    } catch (e) {
        return {
            label: 'daemon/src/index.ts (DAEMON_VERSION)',
            version: null,
            error: `无法读取 ${filePath}：${e instanceof Error ? e.message : String(e)}`,
        };
    }
}

function collectSources(): VersionSource[] {
    const sources: VersionSource[] = [];

    // 1. version.json
    const vjPath = path.join(PROJECT_ROOT, 'version.json');
    const vj = readVersionJson(vjPath);
    sources.push({
        label: 'version.json (root .version)',
        version: vj.version,
        error: vj.version == null ? '无法解析 version.json 的 version 字段' : undefined,
    });
    // 子字段单独校验（输出差异用）
    if (vj.subFields) {
        for (const k of ['daemon', 'panel_backend', 'panel_frontend']) {
            sources.push({
                label: `version.json (.${k})`,
                version: vj.subFields[k] ?? null,
                error: vj.subFields[k] == null ? `version.json 缺失 ${k} 字段` : undefined,
            });
        }
    }

    // 2. 根 package.json
    const rootPkg = path.join(PROJECT_ROOT, 'package.json');
    sources.push({
        label: 'package.json (root)',
        version: readJsonField(rootPkg, 'version'),
        error: undefined,
    });

    // 3-5. 子项目 package.json
    sources.push({
        label: 'panel/frontend/package.json',
        version: readJsonField(path.join(PROJECT_ROOT, 'panel/frontend/package.json'), 'version'),
        error: undefined,
    });
    sources.push({
        label: 'panel/backend/package.json',
        version: readJsonField(path.join(PROJECT_ROOT, 'panel/backend/package.json'), 'version'),
        error: undefined,
    });
    const daemonPkgVersion = readJsonField(
        path.join(PROJECT_ROOT, 'daemon/package.json'),
        'version',
    );
    sources.push({
        label: 'daemon/package.json',
        version: daemonPkgVersion,
        error: undefined,
    });

    // v4.15.0: DAEMON_VERSION 派生检查（闭环 bug1.md "Daemon 运行时硬编码"校验盲区）
    // DAEMON_VERSION 现应从 package.json 派生，而非硬编码字面量
    sources.push(
        checkDaemonVersionDerivation(
            path.join(PROJECT_ROOT, 'daemon/src/index.ts'),
            daemonPkgVersion,
        ),
    );

    // 6. version.md
    sources.push({
        label: 'version.md (latest ## vX.Y.Z)',
        version: readVersionMdLatest(path.join(PROJECT_ROOT, 'version.md')),
        error: undefined,
    });

    // 7. README.md
    sources.push({
        label: 'README.md (**vX.Y.Z** 当前版本)',
        version: readReadmeVersion(path.join(PROJECT_ROOT, 'README.md')),
        error: undefined,
    });

    // 8. deploy.sh
    sources.push({
        label: 'deploy.sh (DEPLOY_VERSION)',
        version: readDeployVersion(path.join(PROJECT_ROOT, 'deploy.sh')),
        error: undefined,
    });

    return sources;
}

function main(): void {
    const sources = collectSources();

    // 文件缺失诊断
    const missing = sources.filter((s) => s.version == null);
    if (missing.length > 0) {
        console.error('❌ 以下来源无法解析版本号：\n');
        for (const s of missing) {
            console.error(`  • ${s.label}${s.error ? ` — ${s.error}` : ''}`);
        }
        console.error('\n请检查对应文件是否存在且格式正确。');
        process.exit(1);
    }

    // 格式校验
    const malformed = sources.filter((s) => s.version != null && !VERSION_PATTERN.test(s.version));
    if (malformed.length > 0) {
        console.error('❌ 以下来源的版本号不符合 x.y.z 格式：\n');
        for (const s of malformed) {
            console.error(`  • ${s.label}: "${s.version}"`);
        }
        console.error('\n版本号必须为 x.y.z 格式（x/y/z 为非负整数）。');
        process.exit(1);
    }

    // 一致性校验
    const versions = new Set(sources.map((s) => s.version));
    if (versions.size === 1) {
        const v = sources[0].version;
        console.log(`✅ 版本号同步校验通过（${v}）`);
        console.log(`   已校验 ${sources.length} 个来源：`);
        for (const s of sources) {
            console.log(`   • ${s.label}: ${s.version}`);
        }
        process.exit(0);
    }

    // 输出差异表
    console.error('❌ 版本号同步校验失败 — 以下来源版本号不一致：\n');
    const maxLabel = Math.max(...sources.map((s) => s.label.length));
    for (const s of sources) {
        const pad = ' '.repeat(Math.max(0, maxLabel - s.label.length));
        console.error(`  • ${s.label}${pad}  →  ${s.version}`);
    }
    console.error('\n请统一上述版本号后再提交。');
    console.error('提示：版本号规则见 .trae/rules/bb.md（x.x.x = 大版本.中版本.小版本）');
    process.exit(1);
}

main();
