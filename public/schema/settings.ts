// ============================================================================
// 结构化设置契约（v4.33.0 新建，s0601）
//
// 唯一真相源：此前 SettingSchemaItem 在后端 settingSchemaService.ts 与前端
// api/modules/settings.ts 双处定义（且前端 SettingGroup 缺 'system'），
// 现统一上推 public/，前后端均从此文件引用。
// ============================================================================

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
  | 'mail' // SMTP 邮件配置
  | 'maintenance' // 维护模式
  | 'disk' // 磁盘监控
  | 'legal' // 用户协议 / 隐私政策
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
