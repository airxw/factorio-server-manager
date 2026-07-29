#!/bin/bash
# ============================================================================
# deploy-daemon.sh — GSP Daemon 独立部署脚本（v4.22.0）
#
# 用途：在远程 Linux 机器上一键部署 GSP Daemon（独立节点模式，非 slave）。
#       部署完成后输出 `gsp-daemon-import://<base64-json>` 链接，
#       用户复制链接粘贴到 GSP 面板向导内导入节点。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/airxw/GSP-Panel/main/scripts/deploy-daemon.sh | bash
#
# 参数（环境变量，均可选）：
#   INSTALL_DIR  — 安装目录（默认 /opt/gameserver-daemon）
#   GIT_REPO     — Git 仓库地址（默认 https://github.com/airxw/GSP-Panel.git）
#   GIT_BRANCH   — Git 分支（默认 main）
#   DAEMON_PORT  — Daemon 监听端口（默认 8080，对公网禁用）
#   NODE_NAME    — 节点显示名（默认使用 hostname）
#
# 系统要求：
#   - Debian/Ubuntu（apt-get）或 RHEL/CentOS（dnf/yum）
#   - root 权限
#   - 可访问 GitHub
#
# 输出：
#   部署成功后在 stdout 末尾输出形如下面的链接：
#     gsp-daemon-import://eyJuYW1lIjoi...
#   用户复制此链接粘贴到 GSP 面板向导 Step 3 多节点模式的"粘贴导入链接"输入框。
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 参数解析与初始化
# ---------------------------------------------------------------------------

INSTALL_DIR="${INSTALL_DIR:-/opt/gameserver-daemon}"
GIT_REPO="${GIT_REPO:-https://github.com/airxw/GSP-Panel.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DAEMON_PORT="${DAEMON_PORT:-8080}"
NODE_NAME="${NODE_NAME:-}"
GSP_USER="gameserver"
SERVICE_NAME="gameserver-daemon"

# 颜色输出（仅在交互式终端启用，避免管道场景污染 stdout）
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

log()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# ---------------------------------------------------------------------------
# 前置校验
# ---------------------------------------------------------------------------

# 校验 root 权限
if [[ $EUID -ne 0 ]]; then
  err "此脚本需要 root 权限执行，请使用 sudo 或以 root 用户运行"
  exit 1
fi

# 检测包管理器（优先 apt-get，回退 dnf/yum）
PKG_MANAGER=""
if command -v apt-get &>/dev/null; then
  PKG_MANAGER="apt-get"
elif command -v dnf &>/dev/null; then
  PKG_MANAGER="dnf"
elif command -v yum &>/dev/null; then
  PKG_MANAGER="yum"
else
  err "未找到支持的包管理器（apt-get / dnf / yum），请手动安装依赖后重试"
  exit 1
fi

log "开始部署 GSP Daemon（独立节点模式）"
log "INSTALL_DIR : $INSTALL_DIR"
log "GIT_REPO    : $GIT_REPO"
log "GIT_BRANCH  : $GIT_BRANCH"
log "DAEMON_PORT : $DAEMON_PORT"

# ---------------------------------------------------------------------------
# 步骤 1: 检查/安装 Node.js 20+
# ---------------------------------------------------------------------------

log "步骤 1/9: 检查 Node.js 环境..."

install_node_debian() {
  log "安装 Node.js 20.x（apt-get）..."
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
}

install_node_rhel() {
  log "安装 Node.js 20.x（$PKG_MANAGER）..."
  $PKG_MANAGER install -y -q curl ca-certificates
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  $PKG_MANAGER install -y -q nodejs
}

if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    warn "Node.js 版本过低 ($(node -v))，需要 20+，正在升级..."
    if [[ "$PKG_MANAGER" == "apt-get" ]]; then
      install_node_debian
    else
      install_node_rhel
    fi
  else
    ok "Node.js $(node -v) 已安装"
  fi
else
  log "Node.js 未安装，正在安装..."
  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    install_node_debian
  else
    install_node_rhel
  fi
fi

NODE_VERSION=$(node -v 2>/dev/null || echo "none")
if [[ "$NODE_VERSION" == "none" ]]; then
  err "Node.js 安装失败"
  exit 1
fi
ok "Node.js $NODE_VERSION 就绪"

# ---------------------------------------------------------------------------
# 步骤 2: 检查/安装 git
# ---------------------------------------------------------------------------

log "步骤 2/9: 检查 git..."

if ! command -v git &>/dev/null; then
  log "安装 git..."
  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    apt-get update -qq
    apt-get install -y -qq git
  else
    $PKG_MANAGER install -y -q git
  fi
fi
ok "git $(git --version) 就绪"

# ---------------------------------------------------------------------------
# 步骤 3: 检查/安装 openssl（用于生成 DAEMON_TOKEN）
# ---------------------------------------------------------------------------

log "步骤 3/9: 检查 openssl..."

if ! command -v openssl &>/dev/null; then
  log "安装 openssl..."
  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    apt-get install -y -qq openssl
  else
    $PKG_MANAGER install -y -q openssl
  fi
fi
ok "openssl $(openssl version) 就绪"

# ---------------------------------------------------------------------------
# 步骤 4: 创建 gameserver 用户
# ---------------------------------------------------------------------------

log "步骤 4/9: 检查/创建 $GSP_USER 用户..."

if id "$GSP_USER" &>/dev/null; then
  ok "用户 $GSP_USER 已存在"
else
  useradd -r -m -d "/home/$GSP_USER" -s /bin/bash "$GSP_USER"
  ok "用户 $GSP_USER 已创建"
fi

# ---------------------------------------------------------------------------
# 步骤 5: 克隆/更新项目代码
# ---------------------------------------------------------------------------

log "步骤 5/9: 获取项目代码..."

mkdir -p "$INSTALL_DIR"
chown "$GSP_USER":"$GSP_USER" "$INSTALL_DIR"

# 使用临时目录克隆后只复制 daemon/ 子目录，避免污染 INSTALL_DIR
TMP_CLONE_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_CLONE_DIR"' EXIT

log "克隆仓库到临时目录 $TMP_CLONE_DIR..."
if sudo -u "$GSP_USER" git clone --depth 1 -b "$GIT_BRANCH" "$GIT_REPO" "$TMP_CLONE_DIR/repo" 2>&1 | tail -3; then
  ok "代码克隆完成"
else
  err "代码克隆失败，请检查网络或仓库地址"
  exit 1
fi

# 复制 daemon/ 子目录到 INSTALL_DIR
log "复制 daemon/ 子目录到 $INSTALL_DIR..."
if [[ -d "$TMP_CLONE_DIR/repo/daemon" ]]; then
  rsync -a --delete --exclude node_modules --exclude dist --exclude .env "$TMP_CLONE_DIR/repo/daemon/" "$INSTALL_DIR/"
  chown -R "$GSP_USER":"$GSP_USER" "$INSTALL_DIR"
  ok "daemon 代码已就位"
else
  err "仓库中未找到 daemon/ 子目录，请确认仓库结构"
  exit 1
fi

# rsync 可能不存在，回退 cp -a
if ! command -v rsync &>/dev/null; then
  warn "rsync 不可用，回退到 cp -a"
  rm -rf "$INSTALL_DIR"/* 2>/dev/null || true
  cp -a "$TMP_CLONE_DIR/repo/daemon/." "$INSTALL_DIR/"
  chown -R "$GSP_USER":"$GSP_USER" "$INSTALL_DIR"
  ok "daemon 代码已就位（cp 模式）"
fi

# ---------------------------------------------------------------------------
# 步骤 6: 安装依赖并构建 daemon
# ---------------------------------------------------------------------------

log "步骤 6/9: 安装依赖并构建 daemon..."

cd "$INSTALL_DIR"

log "安装 npm 依赖..."
sudo -u "$GSP_USER" npm install --production 2>&1 | tail -5

log "构建 daemon（tsc）..."
if sudo -u "$GSP_USER" npm run build 2>&1 | tail -5; then
  ok "daemon 构建完成"
else
  err "daemon 构建失败"
  exit 1
fi

# ---------------------------------------------------------------------------
# 步骤 7: 生成 DAEMON_TOKEN 与 .env
# ---------------------------------------------------------------------------

log "步骤 7/9: 生成 DAEMON_TOKEN 与 .env 配置..."

DAEMON_TOKEN=$(openssl rand -hex 16)
if [[ -z "$DAEMON_TOKEN" ]]; then
  err "DAEMON_TOKEN 生成失败"
  exit 1
fi

INSTANCES_DIR="$INSTALL_DIR/instances"
mkdir -p "$INSTANCES_DIR"
chown -R "$GSP_USER":"$GSP_USER" "$INSTANCES_DIR"

ENV_FILE="$INSTALL_DIR/.env"
cat > "$ENV_FILE" << EOF
# GSP Daemon 配置（由 deploy-daemon.sh 自动生成）
# 生成时间: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Daemon 监听端口（8080 对公网禁用，仅局域网/VPN 可达）
PORT=$DAEMON_PORT

# Daemon 通信 token（与 GSP 面板向导中填写的 token 必须一致）
DAEMON_TOKEN=$DAEMON_TOKEN

# 实例根目录
INSTANCES_DIR=$INSTANCES_DIR

# 日志级别
LOG_LEVEL=info
EOF

chown "$GSP_USER":"$GSP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"  # 仅 gameserver 用户可读（含 token）
ok "配置文件已生成: $ENV_FILE"

# ---------------------------------------------------------------------------
# 步骤 8: 创建 systemd 服务并启动
# ---------------------------------------------------------------------------

log "步骤 8/9: 创建 systemd 服务..."

NODE_BIN=$(which node)
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=GSP Daemon (standalone node)
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$GSP_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$NODE_BIN $INSTALL_DIR/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR/data $INSTALL_DIR/instances

[Install]
WantedBy=multi-user.target
EOF

ok "systemd 服务文件已创建: $SERVICE_FILE"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1

# 如果服务已在运行，重启；否则启动
if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "服务已在运行，重启以应用新配置..."
  systemctl restart "$SERVICE_NAME"
else
  log "启动 $SERVICE_NAME..."
  systemctl start "$SERVICE_NAME"
fi

# 等待启动并校验
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "GSP Daemon 已启动并运行"
else
  err "服务启动失败，查看日志:"
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager
  exit 1
fi

# ---------------------------------------------------------------------------
# 步骤 9: 获取本机 hostname/IP，输出 gsp-daemon-import:// 链接
# ---------------------------------------------------------------------------

log "步骤 9/9: 生成导入链接..."

# 节点名称：优先使用环境变量 NODE_NAME，回退到 hostname
if [[ -z "$NODE_NAME" ]]; then
  NODE_NAME=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "daemon-node")
fi

# 获取本机 IP（优先返回非 loopback 的 IPv4）
LOCAL_IP=$(ip -4 -o addr show scope global 2>/dev/null \
  | awk '{print $4}' \
  | cut -d/ -f1 \
  | head -n1)

if [[ -z "$LOCAL_IP" ]]; then
  # 回退到 hostname -I（Debian 系列常见）
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

if [[ -z "$LOCAL_IP" ]]; then
  warn "无法自动获取本机 IP，使用 127.0.0.1 作为占位——请手动替换为可访问地址"
  LOCAL_IP="127.0.0.1"
fi

ok "节点名称: $NODE_NAME"
ok "本机 IP : $LOCAL_IP"
ok "端口    : $DAEMON_PORT"

# 构造 JSON payload（注意：jq 可能未安装，使用 python3 回退；若都不可用则手写拼接）
PAYLOAD_JSON=""

if command -v jq &>/dev/null; then
  PAYLOAD_JSON=$(jq -c \
    --arg name "$NODE_NAME" \
    --arg fqdn "$LOCAL_IP" \
    --argjson port "$DAEMON_PORT" \
    --arg token "$DAEMON_TOKEN" \
    '{name:$name, fqdn:$fqdn, port:$port, token:$token}' <<< '{}')
elif command -v python3 &>/dev/null; then
  PAYLOAD_JSON=$(python3 -c "
import json, sys
print(json.dumps({
  'name': sys.argv[1],
  'fqdn': sys.argv[2],
  'port': int(sys.argv[3]),
  'token': sys.argv[4],
}))" "$NODE_NAME" "$LOCAL_IP" "$DAEMON_PORT" "$DAEMON_TOKEN")
else
  # 极简回退：手工拼接（假设字段不含双引号/反斜杠）
  PAYLOAD_JSON="{\"name\":\"$NODE_NAME\",\"fqdn\":\"$LOCAL_IP\",\"port\":$DAEMON_PORT,\"token\":\"$DAEMON_TOKEN\"}"
fi

# base64 编码（兼容 Linux base64 与 macOS base64）
if [[ "$(uname)" == "Darwin" ]]; then
  PAYLOAD_B64=$(printf '%s' "$PAYLOAD_JSON" | base64 | tr -d '\n')
else
  PAYLOAD_B64=$(printf '%s' "$PAYLOAD_JSON" | base64 -w 0)
fi

IMPORT_LINK="gsp-daemon-import://${PAYLOAD_B64}"

# ---------------------------------------------------------------------------
# 输出最终信息
# ---------------------------------------------------------------------------

echo ""
ok "============================================"
ok "GSP Daemon 部署完成！"
ok "============================================"
echo ""
log "部署信息："
log "  安装目录     : $INSTALL_DIR"
log "  daemon 端口  : $DAEMON_PORT（对公网禁用，仅局域网/VPN 可达）"
log "  systemd 服务 : $SERVICE_NAME"
log "  配置文件     : $ENV_FILE"
echo ""
log "常用命令："
log "  查看状态: systemctl status $SERVICE_NAME"
log "  查看日志: journalctl -u $SERVICE_NAME -f"
log "  重启服务: systemctl restart $SERVICE_NAME"
log "  停止服务: systemctl stop $SERVICE_NAME"
echo ""
echo "============================================================"
echo "  复制以下导入链接，粘贴到 GSP 面板向导 Step 3 的输入框："
echo "============================================================"
echo ""
echo "$IMPORT_LINK"
echo ""
warn "提示：此链接包含 DAEMON_TOKEN，请妥善保管，不要泄露给无关人员。"
warn "      链接中的 fqdn 已自动填入本机 IP（$LOCAL_IP），如需通过域名/公网 IP 访问，请手动修改后再粘贴。"
