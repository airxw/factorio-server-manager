// ============================================================================
// settingSchemaService — v3.8.0 结构化设置面板后端
// 替代纯 KV 编辑器：带类型校验 + 默认值 + 枚举约束 + 分组展示
//
// 设计要点：
//   - Schema 在代码中定义（TypeScript），不入库——避免运行时 schema 漂移
//   - 值仍存储在 system_config 表（KV），通过 SettingSchemaService 包装为类型化访问
//   - 首次访问时自动 seed 默认值到 system_config（如果缺失）
//   - 提供 typed getters: getString / getBoolean / getNumber / getJSON
//   - 前端通过 GET /api/settings/schema 获取 schema 渲染表单式 UI
//
// 契约对齐：
//   - 内部服务，不对外暴露接口契约（通过 settings 路由层封装）
//   - 复用 system_config 表（P1 已建表），无需新增 migration
// ============================================================================

import type { Knex } from 'knex';
import { SystemConfigServiceImpl } from './systemConfigService.js';

// ----------------------------------------------------------------------------
// 类型定义
// ----------------------------------------------------------------------------

/** 设置值类型 */
export type SettingType = 'boolean' | 'number' | 'string' | 'json' | 'enum';

/** 设置分组（对应前端 UI 分组） */
export type SettingGroup =
  | 'site' // 站点信息
  | 'registration' // 注册管理
  | 'games' // 游戏配置
  | 'vip' // VIP 体系
  | 'admin' // 管理员配置
  | 'backup' // 备份策略（实例 + DB）
  | 'mail' // v3.9.0-S6: SMTP 邮件配置
  | 'maintenance' // v3.9.0-S8: 维护模式
  | 'disk' // v3.9.0-D2: 磁盘监控
  | 'legal' // v3.9.0-S7: 用户协议 / 隐私政策
  | 'system'; // v4.18.0: 系统运行模式与初始化状态

/** 单个设置项的 Schema 定义 */
export interface SettingDefinition {
  /** 配置键（如 "registration.enabled"） */
  key: string;
  /** 显示名称（中文） */
  label: string;
  /** 值类型 */
  type: SettingType;
  /** 分组 */
  group: SettingGroup;
  /** 默认值（字符串形式存储，读取时按 type 转换） */
  defaultValue: string;
  /** 描述 */
  description: string;
  /** 枚举可选值（仅 type=enum 时有效） */
  enumValues?: string[];
  /** 数字类型的最小值（仅 type=number 时有效） */
  min?: number;
  /** 数字类型的最大值（仅 type=number 时有效） */
  max?: number;
  /** 排序权重（同组内按 order 升序） */
  order: number;
  /** 是否敏感（前端显示为 ***，需点击查看） */
  sensitive?: boolean;
}

/** 前端获取 schema 时的响应项 */
export interface SettingSchemaItem extends SettingDefinition {
  /** 当前值（敏感字段返回 null，需单独 API 获取） */
  currentValue: string | null;
}

// ----------------------------------------------------------------------------
// v3.8.0 S2-S11：全部设置项定义
// ----------------------------------------------------------------------------

const SETTING_DEFINITIONS: SettingDefinition[] = [
  // ----- S11: 站点信息 -----
  {
    key: 'site.name',
    label: '站点名称',
    type: 'string',
    group: 'site',
    defaultValue: 'GameServer Panel',
    description: '显示在浏览器标题栏和登录页的站点名称',
    order: 1,
  },
  {
    key: 'site.announcement',
    label: '站点公告',
    type: 'string',
    group: 'site',
    defaultValue: '',
    description: '登录页和侧边栏显示的公告信息（留空则不显示）',
    order: 2,
  },
  {
    key: 'site.logo_url',
    label: 'Logo URL',
    type: 'string',
    group: 'site',
    defaultValue: '',
    description: '自定义 Logo 图片地址（留空使用默认 Logo）',
    order: 3,
  },

  // ----- S2: 注册管理 -----
  {
    key: 'registration.enabled',
    label: '允许新用户注册',
    type: 'boolean',
    group: 'registration',
    defaultValue: 'true',
    description: '关闭后 /api/auth/register 接口返回 403，前端隐藏注册入口',
    order: 1,
  },

  // ----- S3-S5: 游戏配置 -----
  {
    key: 'games.enabled_packs',
    label: '启用的游戏 Pack',
    type: 'json',
    group: 'games',
    defaultValue: '[]',
    description: 'JSON 数组，列出允许创建实例的 pack_id（空数组=全部启用）',
    order: 1,
  },
  {
    key: 'games.max_instances_per_user',
    label: '每用户最大实例数',
    type: 'number',
    group: 'games',
    defaultValue: '5',
    min: 0,
    max: 100,
    description: '普通用户可创建的实例上限（0=禁止创建，server_admin 不受限）',
    order: 2,
  },
  {
    key: 'games.port_range',
    label: '游戏端口范围',
    type: 'json',
    group: 'games',
    defaultValue: '[25565, 26000]',
    description: 'JSON 数组 [min, max]，约束自动分配的游戏端口范围',
    order: 3,
  },

  // ----- S6-S7: VIP 体系 -----
  {
    key: 'vip.default_expiry_days',
    label: 'VIP 默认有效天数',
    type: 'number',
    group: 'vip',
    defaultValue: '30',
    min: 0,
    max: 3650,
    description: 'VIP 赋予时的默认有效天数（0=永久）',
    order: 1,
  },
  {
    key: 'vip.discount_levels',
    label: 'VIP 折扣等级',
    type: 'json',
    group: 'vip',
    defaultValue: '{"0":100,"1":95,"2":90,"3":85,"4":80,"5":75}',
    description: 'JSON 对象 {vip_level: 折扣百分比}，用于商店价格计算',
    order: 2,
  },

  // ----- S8: 管理员配置 -----
  {
    key: 'admin.expiry_days',
    label: '管理员密码有效期',
    type: 'number',
    group: 'admin',
    defaultValue: '0',
    min: 0,
    max: 365,
    description: '管理员密码到期需重置的天数（0=永久，不强制重置）',
    order: 1,
  },

  // ----- S9-S10: 备份策略 -----
  {
    key: 'backup.auto_enabled',
    label: '自动备份',
    type: 'boolean',
    group: 'backup',
    defaultValue: 'false',
    description: '开启后按 cron 定时备份数据库和实例配置',
    order: 1,
  },
  {
    key: 'backup.schedule',
    label: '备份 Cron 表达式',
    type: 'string',
    group: 'backup',
    defaultValue: '0 3 * * *',
    description: '标准 cron 表达式（默认每天凌晨 3 点）',
    order: 2,
  },
  {
    key: 'backup.path',
    label: '备份存储路径',
    type: 'string',
    group: 'backup',
    defaultValue: '/opt/gameserver-panel/backups',
    description: '备份文件存储目录（需确保 Panel 进程有写权限）',
    order: 3,
  },
  {
    key: 'backup.max_count',
    label: '最大备份保留数',
    type: 'number',
    group: 'backup',
    defaultValue: '7',
    min: 1,
    max: 100,
    description: '保留的备份份数，超出后自动清理最旧的',
    order: 4,
  },
  // v3.9.0-D1: DB 自动备份（与 backup.auto_enabled 区分——auto_enabled 控制实例备份，db_enabled 控制 DB 全量备份）
  {
    key: 'backup.db_enabled',
    label: '数据库自动备份',
    type: 'boolean',
    group: 'backup',
    defaultValue: 'true',
    description: '开启后按 cron 定时备份 panel.db 全量到 backup.path/.db-backup/',
    order: 5,
  },
  {
    key: 'backup.db_retention_days',
    label: 'DB 备份保留天数',
    type: 'number',
    group: 'backup',
    defaultValue: '7',
    min: 1,
    max: 365,
    description: 'DB 备份文件保留天数，超过后自动清理',
    order: 6,
  },

  // ----- v3.9.0-S6: SMTP 邮件配置 -----
  {
    key: 'mail.enabled',
    label: '启用邮件发送',
    type: 'boolean',
    group: 'mail',
    defaultValue: 'false',
    description: '关闭时 sendMail 仅写日志不实际发送（开发模式）；密码找回/邮箱验证需此开启',
    order: 1,
  },
  {
    key: 'mail.smtp_host',
    label: 'SMTP 主机',
    type: 'string',
    group: 'mail',
    defaultValue: '',
    description: '如 smtp.qq.com / smtp.gmail.com',
    order: 2,
  },
  {
    key: 'mail.smtp_port',
    label: 'SMTP 端口',
    type: 'number',
    group: 'mail',
    defaultValue: '587',
    min: 1,
    max: 65535,
    description: 'TLS 端口 587，SSL 端口 465（需同步开启 smtp_secure）',
    order: 3,
  },
  {
    key: 'mail.smtp_secure',
    label: '使用 SSL',
    type: 'boolean',
    group: 'mail',
    defaultValue: 'false',
    description: '端口 465 时应为 true；端口 587 时为 false（使用 STARTTLS）',
    order: 4,
  },
  {
    key: 'mail.smtp_user',
    label: 'SMTP 用户名',
    type: 'string',
    group: 'mail',
    defaultValue: '',
    description: '通常为完整邮箱地址',
    order: 5,
  },
  {
    key: 'mail.smtp_pass',
    label: 'SMTP 密码',
    type: 'string',
    group: 'mail',
    defaultValue: '',
    description: '邮箱密码或授权码（如 QQ 邮箱需使用授权码）',
    order: 6,
    sensitive: true,
  },
  {
    key: 'mail.from_address',
    label: '发件人地址',
    type: 'string',
    group: 'mail',
    defaultValue: 'noreply@localhost',
    description: '邮件 From 字段，建议与 SMTP 用户名一致',
    order: 7,
  },

  // ----- v3.9.0-S8: 维护模式 -----
  {
    key: 'maintenance.enabled',
    label: '启用维护模式',
    type: 'boolean',
    group: 'maintenance',
    defaultValue: 'false',
    description: '开启后所有非管理员请求返回 503；管理员可正常登录关闭维护模式',
    order: 1,
  },
  {
    key: 'maintenance.message',
    label: '维护提示消息',
    type: 'string',
    group: 'maintenance',
    defaultValue: '系统维护中，请稍后再试',
    description: '维护模式下返回给前端展示的消息',
    order: 2,
  },

  // ----- v3.9.0-D2: 磁盘监控 -----
  {
    key: 'disk.monitor_enabled',
    label: '启用磁盘监控',
    type: 'boolean',
    group: 'disk',
    defaultValue: 'true',
    description: '每小时检查磁盘使用率，超阈值时通知所有管理员',
    order: 1,
  },
  {
    key: 'disk.warning_threshold',
    label: '磁盘告警阈值（%）',
    type: 'number',
    group: 'disk',
    defaultValue: '85',
    min: 50,
    max: 99,
    description: '磁盘使用率达到此值时发送 warning 级通知',
    order: 2,
  },
  {
    key: 'disk.critical_threshold',
    label: '磁盘严重告警阈值（%）',
    type: 'number',
    group: 'disk',
    defaultValue: '95',
    min: 50,
    max: 100,
    description: '磁盘使用率达到此值时发送 critical 级通知',
    order: 3,
  },

  // ----- v3.9.0-S5: 邮箱验证开关（与 registration 分组合并更合理，但为便于管理单独暴露） -----
  // 注：放在 registration 组，便于管理员一次性配置注册策略
  {
    key: 'registration.require_email_verify',
    label: '注册需邮箱验证',
    type: 'boolean',
    group: 'registration',
    defaultValue: 'false',
    description: '开启后注册用户必须点击邮箱验证链接才能登录',
    order: 2,
  },

  // ----- v3.9.0-S7: 用户协议 / 隐私政策内容 -----
  {
    key: 'legal.terms_content',
    label: '用户协议内容',
    type: 'string',
    group: 'legal',
    defaultValue: '',
    description: '用户协议正文（留空时使用前端默认模板）',
    order: 1,
  },
  {
    key: 'legal.privacy_content',
    label: '隐私政策内容',
    type: 'string',
    group: 'legal',
    defaultValue: '',
    description: '隐私政策正文（留空时使用前端默认模板）',
    order: 2,
  },

  // ----- v4.18.0: 系统运行模式与初始化状态（供 SetupWizard detectInitStatus 使用） -----
  // 注：这两个字段由 migration 20260808000001 seed 默认值，POST /api/init 写入新值
  //   演示模式由 VITE_ENABLE_DEMO 环境变量覆盖，system.mode 仅为持久化记录
  {
    key: 'system.mode',
    label: '运行模式',
    type: 'enum',
    group: 'system',
    defaultValue: 'production',
    enumValues: ['production', 'demo'],
    description: 'v4.18.0: 系统运行模式（demo=演示，production=生产）。演示模式由 VITE_ENABLE_DEMO 环境变量覆盖',
    order: 1,
  },
  {
    key: 'system.preflight_passed',
    label: '环境预检通过',
    type: 'enum',
    group: 'system',
    defaultValue: 'false',
    enumValues: ['true', 'false'],
    description: 'v4.18.0: 是否完成首启动环境预检（true=已完成，false=待 SetupWizard 处理）',
    order: 2,
  },
];

// ----------------------------------------------------------------------------
// 服务实现
// ----------------------------------------------------------------------------

/**
 * SettingSchemaService — 结构化设置管理
 *
 * 包装 SystemConfigService，提供：
 *   - 类型化访问（boolean/number/string/json/enum）
 *   - 默认值自动填充
 *   - 值校验（枚举/范围/JSON 格式）
 *   - Schema 查询（供前端渲染表单）
 */
export class SettingSchemaService {
  private readonly configService: SystemConfigServiceImpl;
  private readonly definitionMap: Map<string, SettingDefinition>;

  constructor(db: Knex) {
    this.configService = new SystemConfigServiceImpl(db);
    this.definitionMap = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));
  }

  /** 获取所有设置项定义（含当前值），按 group + order 排序 */
  async listSchema(): Promise<SettingSchemaItem[]> {
    const all = await this.configService.list();
    const valueMap = new Map(all.map((c) => [c.key, c.value]));
    return SETTING_DEFINITIONS.map((def) => ({
      ...def,
      currentValue: valueMap.get(def.key) ?? def.defaultValue,
    }));
  }

  /** 获取单个设置项的 schema + 当前值 */
  async getSchema(key: string): Promise<SettingSchemaItem | null> {
    const def = this.definitionMap.get(key);
    if (!def) return null;
    const value = await this.configService.get(key);
    return { ...def, currentValue: value ?? def.defaultValue };
  }

  /** 设置值（带 schema 校验） */
  async setValue(key: string, value: string): Promise<void> {
    const def = this.definitionMap.get(key);
    if (!def) {
      throw new Error(`未知的设置项: ${key}`);
    }
    const validated = this.validateValue(def, value);
    await this.configService.set(key, validated, def.description);
  }

  /** 重置单个设置项为默认值 */
  async resetValue(key: string): Promise<void> {
    const def = this.definitionMap.get(key);
    if (!def) {
      throw new Error(`未知的设置项: ${key}`);
    }
    await this.configService.set(key, def.defaultValue, def.description);
  }

  /** 批量 seed 缺失的默认值（首次启动时调用） */
  async seedDefaults(): Promise<void> {
    for (const def of SETTING_DEFINITIONS) {
      const existing = await this.configService.get(def.key);
      if (existing === null) {
        await this.configService.set(def.key, def.defaultValue, def.description);
      }
    }
  }

  // ----- 类型化 getter（供后端业务代码使用） -----

  async getString(key: string, fallback?: string): Promise<string> {
    const def = this.definitionMap.get(key);
    if (!def) return fallback ?? '';
    const value = await this.configService.get(key);
    return value ?? def.defaultValue;
  }

  async getBoolean(key: string): Promise<boolean> {
    const value = await this.getString(key);
    return value === 'true' || value === '1';
  }

  async getNumber(key: string): Promise<number> {
    const value = await this.getString(key);
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    const value = await this.getString(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  // ----- 校验逻辑 -----

  private validateValue(def: SettingDefinition, value: string): string {
    switch (def.type) {
      case 'boolean': {
        if (value !== 'true' && value !== 'false') {
          throw new Error(`${def.label} 必须为 true 或 false`);
        }
        return value;
      }
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          throw new Error(`${def.label} 必须为数字`);
        }
        if (def.min !== undefined && n < def.min) {
          throw new Error(`${def.label} 不能小于 ${def.min}`);
        }
        if (def.max !== undefined && n > def.max) {
          throw new Error(`${def.label} 不能大于 ${def.max}`);
        }
        return String(n);
      }
      case 'enum': {
        if (!def.enumValues || !def.enumValues.includes(value)) {
          throw new Error(`${def.label} 必须为以下值之一: ${def.enumValues?.join(', ') ?? ''}`);
        }
        return value;
      }
      case 'json': {
        try {
          JSON.parse(value);
        } catch {
          throw new Error(`${def.label} 必须为合法的 JSON`);
        }
        return value;
      }
      case 'string':
      default:
        return value;
    }
  }
}

// ----------------------------------------------------------------------------
// 工厂函数
// ----------------------------------------------------------------------------

export function createSettingSchemaService(db: Knex): SettingSchemaService {
  return new SettingSchemaService(db);
}
