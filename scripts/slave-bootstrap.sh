#!/bin/bash
# ============================================================================
# slave-bootstrap.sh — GSP Slave Daemon 一键部署脚本（v4.10.1 方案 E）
#
# 用途：在远程 Linux 机器上一键部署 GSP slave daemon，自动注册到 master。
# master 全程不接触 SSH 凭据——用户用自己的 SSH 工具登录远程机器后执行此脚本。
#
# 用法：
#   sudo MASTER_URL=https://gsp.ecsrz.com:3001 LINK_KEY=gsp_link_xxx bash slave-bootstrap.sh
#
# 参数（环境变量）：
#   MASTER_URL  — master Panel 地址（必填，如 https://gsp.ecsrz.com:3001）
#   LINK_KEY    — 邀请密钥（必填，从 master 前端获取，格式 gsp_link_xxx）
#   INSTALL_DIR — 安装目录（可选，默认 /opt/gsp-slave）
#   GIT_REPO    — Git 仓库地址（可选，默认 https://github.com/airxw/GSP-Panel.git）
#   GIT_BRANCH  — Git 分支（可选，默认 main）
#
# 系统要求：
#   - Debian/Ubuntu（apt-get）
#   - root 权限
#   - 可访问 master:3001（HTTPS）和 GitHub
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 参数解析与校验
# ---------------------------------------------------------------------------

MASTER_URL="${MASTER_URL:-}"
LINK_KEY="${LINK_KEY:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/gsp-slave}"
GIT_REPO="${GIT_REPO:-https://github.com/airxw/GSP-Panel.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
GSP_USER="gameserver"
SERVICE_NAME="gsp-slave-daemon"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[INFO]${NC} $1"; }
ok() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# 校验必填参数
if [[ -z "$MASTER_URL" ]]; then
  err "MASTER_URL 环境变量必填（如 https://gsp.ecsrz.com:3001）"
  exit 1
fi
if [[ -z "$LINK_KEY" ]]; then
  err "LINK_KEY 环境变量必填（从 master 前端获取，格式 gsp_link_xxx）"
  exit 1
fi

# 校验 root 权限
if [[ $EUID -ne 0 ]]; then
  err "此脚本需要 root 权限执行，请使用 sudo"
  exit 1
fi

# 校验操作系统
if [[ ! -f /etc/debian_version ]]; then
  err "当前脚本仅支持 Debian/Ubuntu。其他发行版请参考手动步骤部署。"
  exit 1
fi

log "开始部署 GSP Slave Daemon"
log "MASTER_URL: $MASTER_URL"
log "INSTALL_DIR: $INSTALL_DIR"
log "LINK_KEY: ${LINK_KEY:0:10}...(已隐藏)"

# ---------------------------------------------------------------------------
# 1. 检查/安装 Node.js 20+
# ---------------------------------------------------------------------------

log "步骤 1/7: 检查 Node.js 环境..."

install_node() {
  log "安装 Node.js 20.x..."
  # 使用 NodeSource 官方源
  if ! command -v curl &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq curl
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
}

if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VERSION" -lt 20 ]]; then
    warn "Node.js 版本过低 ($(node -v))，需要 20+，正在升级..."
    install_node
  else
    ok "Node.js $(node -v) 已安装"
  fi
else
  log "Node.js 未安装，正在安装..."
  install_node
fi

# 验证安装
NODE_VERSION=$(node -v 2>/dev/null || echo "none")
if [[ "$NODE_VERSION" == "none" ]]; then
  err "Node.js 安装失败"
  exit 1
fi
ok "Node.js $NODE_VERSION 就绪"

# ---------------------------------------------------------------------------
# 2. 检查/安装 git
# ---------------------------------------------------------------------------

log "步骤 2/7: 检查 git..."

if ! command -v git &>/dev/null; then
  log "安装 git..."
  apt-get update -qq
  apt-get install -y -qq git
fi
ok "git $(git --version) 就绪"

# ---------------------------------------------------------------------------
# 3. 创建 gameserver 用户
# ---------------------------------------------------------------------------

log "步骤 3/7: 检查/创建 $GSP_USER 用户..."

if id "$GSP_USER" &>/dev/null; then
  ok "用户 $GSP_USER 已存在"
else
  useradd -r -m -d "/home/$GSP_USER" -s /bin/bash "$GSP_USER"
  ok "用户 $GSP_USER 已创建"
fi

# ---------------------------------------------------------------------------
# 4. 克隆/更新项目代码
# ---------------------------------------------------------------------------

log "步骤 4/7: 获取项目代码..."

# 创建安装目录
mkdir -p "$INSTALL_DIR"
chown "$GSP_USER":"$GSP_USER" "$INSTALL_DIR"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "目录已存在 git 仓库，拉取最新代码..."
  cd "$INSTALL_DIR"
  sudo -u "$GSP_USER" git fetch origin "$GIT_BRANCH"
  sudo -u "$GSP_USER" git reset --hard "origin/$GIT_BRANCH"
else
  log "克隆项目代码到 $INSTALL_DIR..."
  sudo -u "$GSP_USER" git clone --depth 1 -b "$GIT_BRANCH" "$GIT_REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "项目代码就绪"

# ---------------------------------------------------------------------------
# 5. 安装依赖并构建 daemon
# ---------------------------------------------------------------------------

log "步骤 5/7: 安装依赖并构建 daemon..."

cd "$INSTALL_DIR/daemon"

# 安装依赖
log "安装 npm 依赖..."
sudo -u "$GSP_USER" npm install --production 2>&1 | tail -5

# 构建 TypeScript
log "构建 daemon..."
if sudo -u "$GSP_USER" npm run build 2>&1 | tail -5; then
  ok "daemon 构建完成"
else
  err "daemon 构建失败"
  exit 1
fi

# ---------------------------------------------------------------------------
# 6. 生成 daemon/.env 配置文件
# ---------------------------------------------------------------------------

log "步骤 6/7: 生成 daemon/.env 配置..."

ENV_FILE="$INSTALL_DIR/daemon/.env"
cat > "$ENV_FILE" << EOF
# GSP Slave Daemon 配置（由 slave-bootstrap.sh 自动生成）
# 生成时间: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# slave 模式（必填）
SLAVE_MODE=true

# master Panel 地址（slave 通过此地址访问 master）
MASTER_URL=$MASTER_URL

# 邀请密钥（首次注册用，注册成功后 commsKey 会持久化到 data/slave-state.json）
LINK_KEY=$LINK_KEY

# daemon 监听端口（8080 对公网禁用，仅局域网/VPN 可达）
PORT=8080

# 日志级别
LOG_LEVEL=info
EOF

chown "$GSP_USER":"$GSP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"  # 仅 gameserver 用户可读（含密钥）
ok "配置文件已生成: $ENV_FILE"

# 创建 data 目录（slave-state.json 持久化路径）
mkdir -p "$INSTALL_DIR/daemon/data"
chown "$GSP_USER":"$GSP_USER" "$INSTALL_DIR/daemon/data"

# ---------------------------------------------------------------------------
# 7. 创建并启动 systemd 服务
# ---------------------------------------------------------------------------

log "步骤 7/7: 创建 systemd 服务..."

NODE_BIN=$(which node)
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=GSP Slave Daemon
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$GSP_USER
WorkingDirectory=$INSTALL_DIR/daemon
EnvironmentFile=$INSTALL_DIR/daemon/.env
ExecStart=$NODE_BIN $INSTALL_DIR/daemon/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR/daemon/data

[Install]
WantedBy=multi-user.target
EOF

ok "systemd 服务文件已创建: $SERVICE_FILE"

# 重载 systemd 并启动
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# 如果服务已在运行，重启；否则启动
if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "服务已在运行，重启以应用新配置..."
  systemctl restart "$SERVICE_NAME"
else
  log "启动 $SERVICE_NAME..."
  systemctl start "$SERVICE_NAME"
fi

# 等待启动
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "GSP Slave Daemon 已启动并运行"
else
  err "服务启动失败，查看日志:"
  journalctl -u "$SERVICE_NAME" -n 20 --no-pager
  exit 1
fi

# ---------------------------------------------------------------------------
# 完成
# ---------------------------------------------------------------------------

echo ""
ok "============================================"
ok "GSP Slave Daemon 部署完成！"
ok "============================================"
echo ""
log "部署信息："
log "  安装目录: $INSTALL_DIR"
log "  daemon 端口: 8080（对公网禁用）"
log "  master 地址: $MASTER_URL"
log "  systemd 服务: $SERVICE_NAME"
echo ""
log "常用命令："
log "  查看状态: systemctl status $SERVICE_NAME"
log "  查看日志: journalctl -u $SERVICE_NAME -f"
log "  重启服务: systemctl restart $SERVICE_NAME"
log "  停止服务: systemctl stop $SERVICE_NAME"
echo ""
log "slave daemon 启动后会自动向 master 注册。"
log "如果 master 前端显示节点状态为「在线」，则注册成功。"
