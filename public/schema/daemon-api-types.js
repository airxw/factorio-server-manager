// ============================================================================
// Panel ↔ Daemon REST API 类型契约
// 依据：spec §3.7.1
// 鉴权：Bearer Token（除 /health 外）
// ============================================================================
// ----- 错误码与异常契约 -----
export const DaemonErrorCode = {
    UNAUTHORIZED: 'DAEMON_UNAUTHORIZED',
    FORBIDDEN: 'DAEMON_FORBIDDEN',
    INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
    INSTANCE_ALREADY_RUNNING: 'INSTANCE_ALREADY_RUNNING',
    INSTANCE_NOT_RUNNING: 'INSTANCE_NOT_RUNNING',
    INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
    COMMAND_FAILED: 'COMMAND_FAILED',
    INTERNAL_ERROR: 'DAEMON_INTERNAL_ERROR',
    // 文件操作错误码（Task 3.5 新增）
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',
    FILE_PATH_INVALID: 'FILE_PATH_INVALID',
    // 命令执行错误码（Task 3.5 新增）
    EXEC_COMMAND_FAILED: 'EXEC_COMMAND_FAILED',
    EXEC_TIMEOUT: 'EXEC_TIMEOUT',
};
