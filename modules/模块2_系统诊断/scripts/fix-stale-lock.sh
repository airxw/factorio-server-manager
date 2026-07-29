#!/bin/bash
# 清理僵尸锁文件（.lock 后缀且超过 1 小时未修改）
set -e
find /tmp -name "*.lock" -type f -mmin +60 -delete 2>/dev/null || true
echo "stale locks cleaned"
