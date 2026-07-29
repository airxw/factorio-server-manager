// ============================================================================
// bootstrapScriptTemplate — slave daemon 一键部署脚本生成器（v4.22.9）
//
// 职责：
//   - 根据邀请参数生成完整的 slave-bootstrap.sh 脚本内容
//   - 脚本在 slave 机器上以 root 执行，完成：安装 Node.js / git / 创建用户 /
//     克隆项目 / 安装依赖 + 构建 / 生成 .env / 创建 systemd 服务
//
// 设计要点：
//   - v4.22.9: 从前端迁移到后端生成（原前端字符串拼接在 Nodes.tsx，已废弃）
//   - 修复原前端脚本 Bug #3：npm install --production + npm run build 必失败
//     （devDependencies 未装导致 tsc 缺失）。改用 npm install + build + prune
//   - 仓库地址 / 安装目录 / 端口从环境变量读取，不再硬编码在前端
//   - LINK_KEY 通过 heredoc 写入 .env，不经过命令行参数（避免进入 shell history）
//
// 来源：docs/plans/nodes-add-node-fix-plan.md §步骤 1-2
// ============================================================================

/** slave 部署配置参数 */
export interface BootstrapScriptParams {
  /** master Panel 的对外公开地址（如 https://gsp.ecsrz.com:3001） */
  masterUrl: string;
  /** 邀请密钥明文（写入 slave 机器 .env） */
  linkKey: string;
}

/** 读取 slave 部署配置（环境变量，带默认值） */
function getSlaveRepoUrl(): string {
  return process.env.SLAVE_REPO_URL ?? 'https://github.com/airxw/GSP-Panel.git';
}

function getSlaveInstallDir(): string {
  return process.env.SLAVE_INSTALL_DIR ?? '/opt/gsp-slave';
}

function getSlavePort(): string {
  return process.env.SLAVE_PORT ?? '8080';
}

/**
 * 生成 slave-bootstrap.sh 脚本内容。
 *
 * 脚本在 slave 机器（Debian/Ubuntu）上以 root 执行：
 *   sudo bash slave-bootstrap.sh
 *
 * 步骤：
 *   1. 安装 Node.js 20+ / git
 *   2. 创建 gameserver 用户
 *   3. 克隆项目代码
 *   4. 安装依赖 + 构建 + prune devDependencies
 *   5. 生成 .env（内嵌 LINK_KEY / MASTER_URL）
 *   6. 创建 systemd 服务并启动
 */
export function generateBootstrapScript(params: BootstrapScriptParams): string {
  const { masterUrl, linkKey } = params;
  const repoUrl = getSlaveRepoUrl();
  const installDir = getSlaveInstallDir();
  const port = getSlavePort();
  const generatedAt = new Date().toISOString();

  return `#!/bin/bash
# GSP Slave Daemon 一键部署脚本（由 GSP Panel 后端生成）
# 生成时间: ${generatedAt}
#
# 用法：在远程 Debian/Ubuntu 机器上以 root 执行
#   sudo bash slave-bootstrap.sh
#
# 参数已由 Panel 注入，无需手动设置环境变量

set -euo pipefail

export MASTER_URL="${masterUrl}"
export LINK_KEY="${linkKey}"
export INSTALL_DIR="${installDir}"
export REPO_URL="${repoUrl}"
export SLAVE_PORT="${port}"

echo "[INFO] 开始部署 GSP Slave Daemon..."
echo "[INFO] MASTER_URL: $MASTER_URL"
echo "[INFO] INSTALL_DIR: $INSTALL_DIR"
echo "[INFO] REPO_URL: $REPO_URL"
echo "[INFO] SLAVE_PORT: $SLAVE_PORT"

# 1. 安装 Node.js 20+
if ! command -v node &>/dev/null || [[ $(node -v | sed 's/v//' | cut -d. -f1) -lt 20 ]]; then
  echo "[INFO] 安装 Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "[OK] Node.js $(node -v) 就绪"

# 2. 安装 git
if ! command -v git &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq git
fi
echo "[OK] git $(git --version) 就绪"

# 3. 创建用户
if ! id gameserver &>/dev/null; then
  useradd -r -m -s /bin/bash gameserver
fi
echo "[OK] gameserver 用户就绪"

# 4. 克隆项目
mkdir -p "$INSTALL_DIR"
chown gameserver:gameserver "$INSTALL_DIR"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  cd "$INSTALL_DIR"
  sudo -u gameserver git fetch origin main
  sudo -u gameserver git reset --hard origin/main
else
  sudo -u gameserver git clone --depth 1 -b main "$REPO_URL" "$INSTALL_DIR"
fi
echo "[OK] 项目代码就绪"

# 5. 安装依赖 + 构建 + 清理 devDependencies
#    v4.22.9: 修复原前端脚本 Bug —— 原 npm install 带 production 标志后 npm run build 缺 tsc
#    改用：npm install（含 devDependencies）→ npm run build → npm prune --production
cd "$INSTALL_DIR/daemon"
sudo -u gameserver npm install
sudo -u gameserver npm run build
sudo -u gameserver npm prune --production
echo "[OK] 依赖安装 + 构建完成"

# 校验构建产物
if [[ ! -f "$INSTALL_DIR/daemon/dist/index.js" ]]; then
  echo "[ERROR] 构建产物 dist/index.js 不存在，构建可能失败"
  exit 1
fi
echo "[OK] 构建产物验证通过"

# 6. 生成配置（LINK_KEY 通过 heredoc 写入 .env，不经过命令行参数）
mkdir -p "$INSTALL_DIR/daemon/data"
cat > "$INSTALL_DIR/daemon/.env" << EOF
SLAVE_MODE=true
MASTER_URL=$MASTER_URL
LINK_KEY=$LINK_KEY
PORT=$SLAVE_PORT
LOG_LEVEL=info
EOF
chown gameserver:gameserver "$INSTALL_DIR/daemon/.env"
chmod 600 "$INSTALL_DIR/daemon/.env"
chown gameserver:gameserver "$INSTALL_DIR/daemon/data"
echo "[OK] 配置文件已生成"

# 7. 创建 systemd 服务
NODE_BIN=$(which node)
cat > /etc/systemd/system/gsp-slave-daemon.service << EOF
[Unit]
Description=GSP Slave Daemon
After=network.target

[Service]
Type=simple
User=gameserver
WorkingDirectory=$INSTALL_DIR/daemon
EnvironmentFile=$INSTALL_DIR/daemon/.env
ExecStart=$NODE_BIN $INSTALL_DIR/daemon/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gsp-slave-daemon
systemctl restart gsp-slave-daemon
sleep 2

if systemctl is-active --quiet gsp-slave-daemon; then
  echo "[OK] GSP Slave Daemon 部署完成！"
  echo "[INFO] 查看状态: systemctl status gsp-slave-daemon"
  echo "[INFO] 查看日志: journalctl -u gsp-slave-daemon -f"
else
  echo "[ERROR] 服务启动失败，查看日志:"
  journalctl -u gsp-slave-daemon -n 20 --no-pager
  exit 1
fi
`;
}
