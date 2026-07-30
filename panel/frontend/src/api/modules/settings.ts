// ============================================================================
// Settings API 领域切片 — v3.8.0 结构化设置面板
// 替代纯 KV 编辑器的 /api/system-config，提供 schema + 当前值 + 校验
// ============================================================================

// v4.33.0: SettingType/SettingGroup/SettingSchemaItem 唯一真相源为 public/schema/settings.ts（s0601），
// 此处再导出保持既有 import 路径兼容（Settings.tsx 等页面从 modules/settings 导入）
import type {
  SettingType,
  SettingGroup,
  SettingDefinition,
  SettingSchemaItem,
} from '@public/schema/settings';

export type { SettingType, SettingGroup, SettingDefinition, SettingSchemaItem };

/** GET /api/settings/schema 响应体 */
export interface ListSettingsSchemaResponse {
  settings: SettingSchemaItem[];
}

/** GET /api/settings/schema/:key 响应体 */
export interface GetSettingSchemaResponse {
  setting: SettingSchemaItem;
}

/** PUT /api/settings/:key 请求体 */
export interface UpdateSettingRequest {
  value: string;
}

/** GET /api/settings/site-info 响应体（公开接口） */
export interface SiteInfoResponse {
  name: string;
  announcement: string;
  logoUrl: string;
}

// ----- v3.8.0-S13: 初始化引导向导 -----

/** GET /api/init/status 响应体（公开接口） */
export interface InitStatusResponse {
  needs_init: boolean;
  /** v4.21.0: 当前运行模式（由后端 process.env.VITE_ENABLE_DEMO 决定） */
  mode?: 'demo' | 'production';
}

// v4.18.0: 初始化向导类型已提升到 public/ 契约，此处仅做 re-export 保持向后兼容
//   旧调用方 `import { SubmitInitRequest } from '../api/modules/settings'` 仍可工作
// v4.20.0: 新增 testDatabaseConnection / triggerRestart 类型 re-export
export type {
  InitPreflightResponse,
  InitPreflightCheck,
  PasswordPolicyResponse,
  InitRequest,
  InitSubmitResponse,
  TestDatabaseConnectionRequest,
  TestDatabaseConnectionResponse,
  RestartTriggerRequest,
  RestartTriggerResponse,
} from '@public/schema/panel-api-types';

/** @deprecated v4.18.0: 改用 `InitRequest`（from '@public/schema/panel-api-types'） */
export type SubmitInitRequest = import('@public/schema/panel-api-types').InitRequest;
/** @deprecated v4.18.0: 改用 `InitSubmitResponse`（from '@public/schema/panel-api-types'） */
export type SubmitInitResponse = import('@public/schema/panel-api-types').InitSubmitResponse;

export interface SettingsApi {
  /** 列出全部设置项 schema + 当前值 */
  listSettingsSchema(): Promise<ListSettingsSchemaResponse>;
  /** 查询单个设置项 */
  getSettingSchema(key: string): Promise<GetSettingSchemaResponse>;
  /** 设置值（带 schema 校验） */
  updateSetting(key: string, value: string): Promise<GetSettingSchemaResponse>;
  /** 重置为默认值 */
  resetSetting(key: string): Promise<GetSettingSchemaResponse>;
  /** 公开站点信息（无需鉴权） */
  getSiteInfo(): Promise<SiteInfoResponse>;
  /** v3.8.0-S13: 查询首启动初始化状态（公开接口） */
  getInitStatus(): Promise<InitStatusResponse>;
  /** v4.18.0: 首启动环境预检（公开接口，8 项检查） */
  getInitPreflight(): Promise<import('@public/schema/panel-api-types').InitPreflightResponse>;
  /** v4.18.0: 公开密码策略（供前端实时校验，与后端规则 1:1 对齐） */
  getPasswordPolicy(): Promise<import('@public/schema/panel-api-types').PasswordPolicyResponse>;
  /** v3.8.0-S13: 提交初始化向导数据（公开接口，门控：needs_init=true）
   *  v4.18.0: 签名扩展——支持 admin 对象（邮箱/用户名可改）、mode、database_ack
   *  v4.20.0: 新增 database / daemon_nodes / public_base_url / skip_daemon 字段 */
  submitInit(req: SubmitInitRequest): Promise<SubmitInitResponse>;
  /** v4.20.0: 测试数据库连接（向导内"测试连接"按钮调用，不写入 .env） */
  testDatabaseConnection(
    req: import('@public/schema/panel-api-types').TestDatabaseConnectionRequest,
  ): Promise<import('@public/schema/panel-api-types').TestDatabaseConnectionResponse>;
  /** v4.20.0: 触发 Panel 后端重启（一次性 token，提交向导后调用） */
  triggerRestart(
    restartToken: string,
  ): Promise<import('@public/schema/panel-api-types').RestartTriggerResponse>;
  /** v4.22.0: 测试 Daemon 连接（向导内"测试连接"按钮调用，不写入 nodes 表） */
  testDaemonConnection(
    req: import('@public/schema/panel-api-types').TestDaemonConnectionRequest,
  ): Promise<import('@public/schema/panel-api-types').TestDaemonConnectionResponse>;
  /** v4.22.1: 自动检测本机 Daemon（向导本机模式加载时自动调用，读取 daemon/.env 并探测 /health） */
  autoDetectLocalDaemon(): Promise<import('@public/schema/panel-api-types').AutoDetectLocalDaemonResponse>;
  /** v4.22.0: 同步 Pack（GitHub / 自定义 URL，向导内"同步 Pack"按钮调用） */
  syncPacks(
    req: import('@public/schema/panel-api-types').SyncPacksRequest,
  ): Promise<import('@public/schema/panel-api-types').SyncPacksResponse>;
  /** v4.22.0: 上传 Pack zip（向导内"上传 zip"按钮调用，multipart/form-data） */
  uploadPack(file: File): Promise<import('@public/schema/panel-api-types').UploadPackResponse>;
}
