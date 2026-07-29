// ============================================================================
// Panel ↔ Frontend REST API 类型契约
// 依据：spec §3.7.2
// 鉴权：JWT（除 /api/health 和 /api/auth/login 外）
// @version 3.1.0
//   - 3.1.0: UserRole 升 3 级 (server_admin/instance_admin/user)；
//            新增 RegisterRequest/RegisterResponse、CreateUserRequest、
//            UpdateUserRoleRequest、DeleteUserResponse；
//            UserInfo/AdminUserSummary.status 扩展 'deleted'；
// ============================================================================
// ----- 错误码与异常契约 -----
export const PanelErrorCode = {
    UNAUTHORIZED: 'PANEL_UNAUTHORIZED',
    FORBIDDEN: 'PANEL_FORBIDDEN',
    VALIDATION_ERROR: 'PANEL_VALIDATION_ERROR',
    SERVER_NOT_FOUND: 'SERVER_NOT_FOUND',
    PACK_NOT_FOUND: 'PACK_NOT_FOUND',
    NODE_NOT_FOUND: 'NODE_NOT_FOUND',
    DAEMON_UNREACHABLE: 'DAEMON_UNREACHABLE',
    INVALID_SERVER_STATE: 'INVALID_SERVER_STATE',
    INTERNAL_ERROR: 'PANEL_INTERNAL_ERROR',
    // P1 新增错误码
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
    INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
    VERIFY_CODE_INVALID: 'VERIFY_CODE_INVALID',
    VIP_PERMISSION_NOT_FOUND: 'VIP_PERMISSION_NOT_FOUND',
    VIP_LEVEL_INSUFFICIENT: 'VIP_LEVEL_INSUFFICIENT',
    COMMAND_RENDER_FAILED: 'COMMAND_RENDER_FAILED',
    COMMAND_QUEUE_FULL: 'COMMAND_QUEUE_FULL',
    INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
    INSTANCE_NOT_RUNNING: 'INSTANCE_NOT_RUNNING',
    ITEM_SYNC_FAILED: 'ITEM_SYNC_FAILED',
    // P2 新增错误码
    SHOP_ITEM_NOT_FOUND: 'SHOP_ITEM_NOT_FOUND',
    SHOP_ORDER_NOT_FOUND: 'SHOP_ORDER_NOT_FOUND',
    SHOP_ORDER_ALREADY_CLAIMED: 'SHOP_ORDER_ALREADY_CLAIMED',
    SHOP_ORDER_EXPIRED: 'SHOP_ORDER_EXPIRED',
    CDK_NOT_FOUND: 'CDK_NOT_FOUND',
    CDK_ALREADY_CLAIMED: 'CDK_ALREADY_CLAIMED',
    CDK_EXPIRED: 'CDK_EXPIRED',
};
