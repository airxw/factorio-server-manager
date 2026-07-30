// ============================================================================
// BindingApplications API 领域切片 — v4.38.0 公会服务器市场改造
// 后端路由：panel/backend/src/api/routes/bindingRequests.ts（挂载于 /api，套 authenticateToken）
//   POST   /api/servers/:serverId/binding-requests       用户申请绑定私有实例
//   GET    /api/servers/:serverId/binding-requests       服主查看该实例的申请列表
//   POST   /api/binding-requests/:id/approve             服主审批通过（自动创建 binding）
//   POST   /api/binding-requests/:id/reject              服主审批拒绝
//   DELETE /api/binding-requests/:id                     申请人撤销自己的 pending 申请
//   GET    /api/my/binding-requests                      用户查看自己提交的全部申请
//
// 权限：
//   - 用户申请 / 查自己 / 撤销：JWT 即可（任意登录用户）
//   - 服主查列表 / 审批：requireInstanceAdmin（owner 或 instance_admin 或 server_admin）
// ============================================================================

import type {
  ApproveBindingApplicationRequest,
  ApproveBindingApplicationResponse,
  BindingApplicationStatus,
  CreateBindingApplicationRequest,
  CreateBindingApplicationResponse,
  ListBindingApplicationsResponse,
  ListMyBindingApplicationsResponse,
  RejectBindingApplicationRequest,
  RejectBindingApplicationResponse,
} from '@public/schema/panel-api-types';

/**
 * v4.38.0 绑定申请审批 API 切片
 * PanelApiClient 通过 extends 组合（见 client.ts）
 */
export interface BindingApplicationsApi {
  /** 用户申请绑定私有实例（POST /api/servers/:serverId/binding-requests） */
  createBindingApplication(
    serverId: string,
    req?: CreateBindingApplicationRequest,
  ): Promise<CreateBindingApplicationResponse>;

  /** 服主查看该实例的申请列表（GET /api/servers/:serverId/binding-requests） */
  listServerBindingApplications(
    serverId: string,
    status?: BindingApplicationStatus,
  ): Promise<ListBindingApplicationsResponse>;

  /** 服主审批通过（POST /api/binding-requests/:id/approve）— 自动创建 binding（vip_level=1） */
  approveBindingApplication(
    id: string,
    req?: ApproveBindingApplicationRequest,
  ): Promise<ApproveBindingApplicationResponse>;

  /** 服主审批拒绝（POST /api/binding-requests/:id/reject） */
  rejectBindingApplication(
    id: string,
    req?: RejectBindingApplicationRequest,
  ): Promise<RejectBindingApplicationResponse>;

  /** 申请人撤销自己的 pending 申请（DELETE /api/binding-requests/:id） */
  cancelBindingApplication(id: string): Promise<void>;

  /** 用户查看自己提交的全部申请（GET /api/my/binding-requests） */
  listMyBindingApplications(): Promise<ListMyBindingApplicationsResponse>;
}
