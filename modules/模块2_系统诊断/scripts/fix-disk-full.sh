#!/bin/bash
# 清理指定目录下的临时文件（超过 7 天的 .tmp 文件）
set -e
TARGET_DIR="${1:-/tmp}"
find "$TARGET_DIR" -name "*.tmp" -type f -mtime +7 -delete 2>/dev/null || true
echo "cleaned: $TARGET_DIR"
