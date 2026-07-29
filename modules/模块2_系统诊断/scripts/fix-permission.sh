#!/bin/bash
# 修复指定目录权限
set -e
TARGET_DIR="${1:-.}"
PERM="${2:-644}"
chmod -R "$PERM" "$TARGET_DIR" 2>/dev/null || true
echo "permission fixed: $TARGET_DIR ($PERM)"
