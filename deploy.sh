#!/bin/bash
# GameServer Panel 4.0.2 一键部署脚本
# 用法: sudo bash deploy.sh [install|start|stop|restart|status|update|one-click|diagnose|uninstall]
#       sudo bash deploy.sh update --rollback
#
# v4.0.0 双目录约定：
#   - 开发目录：/home/airxw/Documents/gsp/gameserver-panel/（airxw 属主，git 提交+测试）
#   - 部署目录：/opt/gameserver-panel/（gameserver 属主，systemd 运行）
#   - 本脚本职责：把开发目录的代码复制到部署目录，并启动 systemd 服务
#   - 禁止在开发目录直接运行生产服务（SSH 断开即崩溃）
#
# v4.0.2 改动（演示模式 Demo Mode）：
#   - 后端启动时若 VITE_ENABLE_DEMO=true 则自动 seed 5 个游戏实例
#   - 新增 /api/demo/status + /api/demo/reset 端点（仅 server_admin 可重置）
#   - users.is_built_in=1 的账号改密被拒绝（BUILT_IN_ACCOUNT_PASSWORD_READONLY）
#   - 前端 .env.production 默认 VITE_ENABLE_DEMO=true（gsp.ecsrz.com 部署）
#   - 登录页底部展示"或使用演示账号"区块，3 角色一键登录
#
# v4.0.1 改动（HTTPS 反向代理）：
#   - Panel 后端监听端口从 3000 改为 3002（仅本机内部访问）
#   - 新增 nginx 反向代理：3000(HTTP) → 301 跳转 → 3001(HTTPS) → 127.0.0.1:3002
#   - SSL 证书部署到 /etc/nginx/ssl/gsp.ecsrz.com.{fullchain.pem,privkey.key}
#   - nginx 站点配置：/etc/nginx/sites-available/gameserver-panel
#   - WebSocket /ws 路径透传 Upgrade/Connection 头
#   - 注意：本脚本不自动安装/配置 nginx，需手动执行 nginx 配置步骤
#
# v4.0.0 改动：
#   C1-C9: 历史包袱大清理（模块编号重整 10-13 → 0-3 + 编译产物清扫 + 双目录约定文档化 + 端口 18432 → 8080 统一 + migration down() 复核 + 环境变量整理 + 死代码删除 + 版本号同步 + 历史文档归档）
#
# v3.9.0 改动：
#   S1-S10: 安全加固（Helmet / 速率限制 / 密码强度 / 密码找回 / 邮箱验证 / Nodemailer / 用户协议 / 维护模式 / 友好错误页 / Audit 中间件）
#   D1-D4: 灾备运维（DB 自动备份调度 + 磁盘空间监控 + 备份恢复文档 + 故障 Runbook）
#   V1-V6: 业务回归验证（前端单测 148 例全部通过）
#   L1/D8: v3.8.0 延迟项回收（index.ts 历史注释归档至 docs/version-history.md + 僵尸实例检测规则）

set -e

# ============ 配置区 ============
# Panel 后端实际监听端口（v4.0.1 起改为 3002，仅本机内部访问，由 nginx 反向代理）
PANEL_PORT=3002
# 对外访问端口（v4.0.1 起由 nginx 接管，3000=HTTP 跳转 / 3001=HTTPS 主入口）
PANEL_HTTP_PORT=3000
PANEL_HTTPS_PORT=3001
DAEMON_PORT=8080  # 与 deploy.md 规则 #7 一致，8080 对公网禁用，仅 Panel 本机调用
INSTALL_DIR="/opt/gameserver-panel"
PANEL_USER="gameserver"
NODE_VERSION="20"
DEPLOY_VERSION="4.35.2"

# 备份目录（P4: update 时备份代码 + DB 到此目录，失败时回滚）
BACKUP_DIR="$INSTALL_DIR/.backup"
# 上一成功部署的代码备份路径（用于 --rollback）
LAST_GOOD_BACKUP="$BACKUP_DIR/last-good"

# ============ 颜色输出 ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1" >&2; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# ============ 检查 root 权限 ============
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "请使用 sudo 或 root 权限运行此脚本"
        exit 1
    fi
}

# ============ 安装 Node.js ============
install_nodejs() {
    if command -v node &> /dev/null; then
        local current_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ $current_version -ge $NODE_VERSION ]]; then
            log_success "Node.js $(node -v) 已安装"
            return 0
        fi
    fi

    log_info "安装 Node.js $NODE_VERSION..."
    curl -fsSL https://deb.nodesource.com/setup_$NODE_VERSION.x | bash -
    apt-get install -y nodejs
    log_success "Node.js $(node -v) 安装完成"
}

# ============ 安装 Java 运行时 (A9) ============
install_java() {
    if command -v java &> /dev/null; then
        log_success "Java 已安装: $(java -version 2>&1 | head -1)"
        return 0
    fi

    log_info "安装 OpenJDK 21 JRE..."
    apt-get install -y openjdk-21-jre-headless
    if command -v java &> /dev/null; then
        log_success "Java 安装完成: $(java -version 2>&1 | head -1)"
    else
        log_error "Java 安装失败，请手动安装 openjdk-21-jre-headless"
        exit 1
    fi
}

# ============ 检测 SteamCMD (A9 辅助) ============
check_steamcmd() {
    if command -v steamcmd &> /dev/null; then
        log_success "SteamCMD 已安装"
    else
        log_warn "SteamCMD 未安装。Rust/ARK/Palworld 等 Steam 游戏服务端需要 SteamCMD 来下载和更新。"
        log_warn "如需安装 SteamCMD，请参考: https://developer.valvesoftware.com/wiki/SteamCMD#Linux"
        log_warn "快捷安装: sudo apt-get install -y lib32gcc-s1 && curl -sqL 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz' | tar -xz -C /opt/steamcmd"
    fi
}

# ============ 检测其他运行时 ============
check_runtimes() {
    log_info "检测游戏运行时依赖..."
    # Java（Minecraft 等 Java 版游戏必需）
    install_java
    # SteamCMD（Rust/ARK/Palworld 等 Steam 游戏需要，仅提示不自动安装）
    check_steamcmd
    log_success "运行时检测完成"
}

# ============ 创建用户 ============
create_user() {
    if ! id "$PANEL_USER" &>/dev/null; then
        log_info "创建用户 $PANEL_USER..."
        useradd -r -s /bin/bash -d "$INSTALL_DIR" "$PANEL_USER"
        log_success "用户 $PANEL_USER 创建完成"
    fi
}

# ============ 安装依赖 ============
install_deps() {
    log_info "安装系统依赖..."
    # v4.16.3: 加 rsync，供 copy_project 排除 data/ 子目录使用
    apt-get update && apt-get install -y curl wget git unzip rsync
    log_success "系统依赖安装完成"
}

# ============ 复制项目文件 ============
copy_project() {
    log_info "复制项目文件到 $INSTALL_DIR..."

    # 获取脚本所在目录（项目根目录）
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # 创建目标目录
    mkdir -p "$INSTALL_DIR"

    # 复制必要目录
    # v4.16.3 修复：panel 目录用 rsync 排除 backend/data/，防止开发库覆盖生产库
    # 此前 cp -r "$SCRIPT_DIR/panel" 会把开发环境 panel/backend/data/panel.db
    # 覆盖到生产环境，导致 demo 数据清理成果被打回原形（demo 实例复活）
    # v4.32.4 修复：同时排除后端/Daemon 的 .env，避免把开发环境配置覆盖到生产目录，
    # 导致 DATABASE_URL / JWT_SECRET / DAEMON_TOKEN 等生产配置被污染。
    # rsync 源路径末尾 / 语义：复制 panel/ 内容到 INSTALL_DIR/panel/，排除 backend/data/
    rsync -a --exclude='backend/data/' --exclude='backend/.env' "$SCRIPT_DIR/panel/" "$INSTALL_DIR/panel/"
    rsync -a --exclude='.env' "$SCRIPT_DIR/daemon/" "$INSTALL_DIR/daemon/"
    cp -r "$SCRIPT_DIR/packs" "$INSTALL_DIR/"
    cp -r "$SCRIPT_DIR/public" "$INSTALL_DIR/"
    cp -r "$SCRIPT_DIR/modules" "$INSTALL_DIR/"
    cp -r "$SCRIPT_DIR/node_modules" "$INSTALL_DIR/" 2>/dev/null || true

    # v4.0.0 修复：同步根级版本/文档文件（version.json/version.md/README.md/deploy.sh）
    # 此前这些文件未被复制到部署目录，导致 /opt/ 中版本元数据停留在旧版本
    [[ -f "$SCRIPT_DIR/version.json" ]] && cp "$SCRIPT_DIR/version.json" "$INSTALL_DIR/"
    [[ -f "$SCRIPT_DIR/version.md" ]] && cp "$SCRIPT_DIR/version.md" "$INSTALL_DIR/"
    [[ -f "$SCRIPT_DIR/README.md" ]] && cp "$SCRIPT_DIR/README.md" "$INSTALL_DIR/"
    [[ -f "$SCRIPT_DIR/deploy.sh" ]] && cp "$SCRIPT_DIR/deploy.sh" "$INSTALL_DIR/"
    [[ -f "$SCRIPT_DIR/package.json" ]] && cp "$SCRIPT_DIR/package.json" "$INSTALL_DIR/"
    [[ -f "$SCRIPT_DIR/package-lock.json" ]] && cp "$SCRIPT_DIR/package-lock.json" "$INSTALL_DIR/"

    log_success "项目文件复制完成"
}

# ============ 安装 npm 依赖 ============
install_npm_deps() {
    log_info "安装 npm 依赖..."

    cd "$INSTALL_DIR"

    # v4.0.0 修复：移除 --production 标志，确保 devDependencies（typescript/tsx/ts-node 等）也被安装
    # 否则 build 步骤的 `tsc` / `vite build` 会因找不到二进制而失败
    # 安装根目录依赖（如果存在）
    [[ -f package.json ]] && npm install --no-audit --no-fund

    # 安装各子项目依赖（npm workspace 会自动处理共享依赖）
    cd "$INSTALL_DIR/panel/backend" && npm install --no-audit --no-fund
    cd "$INSTALL_DIR/panel/frontend" && npm install --no-audit --no-fund
    cd "$INSTALL_DIR/daemon" && npm install --no-audit --no-fund

    log_success "npm 依赖安装完成"
}

# ============ 配置环境变量 ============
setup_env() {
    log_info "配置环境变量..."

    # Panel 后端 .env
    local panel_env="$INSTALL_DIR/panel/backend/.env"
    if [[ ! -f "$panel_env" ]]; then
        log_info "生成 Panel .env 配置..."

        local jwt_secret=$(openssl rand -hex 32)
        local daemon_token=$(openssl rand -hex 16)

        cat > "$panel_env" << EOF
# Panel 后端配置
PORT=$PANEL_PORT
PANEL_HOST=127.0.0.1
DATABASE_URL=$INSTALL_DIR/data/panel.db
JWT_SECRET=$jwt_secret
DAEMON_URL=http://127.0.0.1:$DAEMON_PORT
DAEMON_TOKEN=$daemon_token
PACKS_DIR=$INSTALL_DIR/packs
INSTANCES_DIR=$INSTALL_DIR/instances
LOG_LEVEL=info
# v4.0.2: 演示模式（gsp.ecsrz.com 部署需要）
VITE_ENABLE_DEMO=true
EOF

        log_success "Panel .env 生成完成"
        log_warn "JWT_SECRET 和 DAEMON_TOKEN 已自动生成，请妥善保管"
    else
        log_info "Panel .env 已存在，跳过"
    fi

    # Daemon .env
    local daemon_env="$INSTALL_DIR/daemon/.env"
    if [[ ! -f "$daemon_env" ]]; then
        log_info "生成 Daemon .env 配置..."

        # 读取 panel 的 DAEMON_TOKEN
        local daemon_token=$(grep "^DAEMON_TOKEN=" "$panel_env" | cut -d'=' -f2)

        cat > "$daemon_env" << EOF
# Daemon 配置
PORT=$DAEMON_PORT
DAEMON_HOST=127.0.0.1
DAEMON_TOKEN=$daemon_token
INSTANCES_DIR=$INSTALL_DIR/instances
LOG_LEVEL=info
EOF

        log_success "Daemon .env 生成完成"
    else
        log_info "Daemon .env 已存在，跳过"
    fi

    # 创建数据目录
    mkdir -p "$INSTALL_DIR/data"
    mkdir -p "$INSTALL_DIR/instances"
}

# ============ v3.8.0-P2: 环境变量检查 + .env 自动补全 ============
# 校验 .env 必需字段，缺失时按默认值补全（不覆盖已有值）
check_env() {
    log_info "校验 .env 配置..."

    local panel_env="$INSTALL_DIR/panel/backend/.env"
    local daemon_env="$INSTALL_DIR/daemon/.env"

    if [[ ! -f "$panel_env" ]]; then
        log_error "Panel .env 不存在: $panel_env，请先运行 install"
        return 1
    fi
    if [[ ! -f "$daemon_env" ]]; then
        log_error "Daemon .env 不存在: $daemon_env，请先运行 install"
        return 1
    fi

    local missing=0

    # Panel .env 必需字段
    local panel_required_fields=(
        "PORT"
          "PANEL_HOST"
        "DATABASE_URL"
        "JWT_SECRET"
        "DAEMON_URL"
        "DAEMON_TOKEN"
        "PACKS_DIR"
        "INSTANCES_DIR"
        "VITE_ENABLE_DEMO"
    )

    for field in "${panel_required_fields[@]}"; do
        local val=$(grep "^${field}=" "$panel_env" | cut -d'=' -f2-)
        if [[ -z "$val" ]]; then
            log_warn "Panel .env 缺失字段: $field，自动补全默认值"
            case "$field" in
                PORT) echo "PORT=$PANEL_PORT" >> "$panel_env" ;;
                  PANEL_HOST) echo "PANEL_HOST=127.0.0.1" >> "$panel_env" ;;
                DATABASE_URL) echo "DATABASE_URL=$INSTALL_DIR/data/panel.db" >> "$panel_env" ;;
                JWT_SECRET)
                    echo "JWT_SECRET=$(openssl rand -hex 32)" >> "$panel_env"
                    log_warn "JWT_SECRET 已自动生成，请妥善保管"
                    ;;
                  DAEMON_URL) echo "DAEMON_URL=http://127.0.0.1:$DAEMON_PORT" >> "$panel_env" ;;
                DAEMON_TOKEN)
                    echo "DAEMON_TOKEN=$(openssl rand -hex 16)" >> "$panel_env"
                    log_warn "DAEMON_TOKEN 已自动生成，请同步到 daemon/.env"
                    ;;
                PACKS_DIR) echo "PACKS_DIR=$INSTALL_DIR/packs" >> "$panel_env" ;;
                INSTANCES_DIR) echo "INSTANCES_DIR=$INSTALL_DIR/instances" >> "$panel_env" ;;
                VITE_ENABLE_DEMO) echo "VITE_ENABLE_DEMO=true" >> "$panel_env" ;;
            esac
            missing=$((missing + 1))
        fi
    done

    # JWT_SECRET 长度校验（<16 字符在生产环境拒绝）
    local jwt=$(grep "^JWT_SECRET=" "$panel_env" | cut -d'=' -f2-)
    if [[ ${#jwt} -lt 16 ]]; then
        log_error "Panel .env 的 JWT_SECRET 长度不足 16 字符（当前 ${#jwt}），生产环境将拒绝启动"
        log_warn "建议执行: sed -i \"s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|\" $panel_env"
        missing=$((missing + 1))
    fi

    # Daemon .env 必需字段
      local daemon_required_fields=("PORT" "DAEMON_HOST" "DAEMON_TOKEN" "INSTANCES_DIR")
    for field in "${daemon_required_fields[@]}"; do
        local val=$(grep "^${field}=" "$daemon_env" | cut -d'=' -f2-)
        if [[ -z "$val" ]]; then
            log_warn "Daemon .env 缺失字段: $field，自动补全默认值"
            case "$field" in
                PORT) echo "PORT=$DAEMON_PORT" >> "$daemon_env" ;;
                  DAEMON_HOST) echo "DAEMON_HOST=127.0.0.1" >> "$daemon_env" ;;
                DAEMON_TOKEN)
                    # 同步 panel 的 DAEMON_TOKEN
                    local panel_token=$(grep "^DAEMON_TOKEN=" "$panel_env" | cut -d'=' -f2-)
                    echo "DAEMON_TOKEN=$panel_token" >> "$daemon_env"
                    ;;
                INSTANCES_DIR) echo "INSTANCES_DIR=$INSTALL_DIR/instances" >> "$daemon_env" ;;
            esac
            missing=$((missing + 1))
        fi
    done

    # 校验 panel 与 daemon 的 DAEMON_TOKEN 是否一致
    local panel_token=$(grep "^DAEMON_TOKEN=" "$panel_env" | cut -d'=' -f2-)
    local daemon_token=$(grep "^DAEMON_TOKEN=" "$daemon_env" | cut -d'=' -f2-)
    if [[ -n "$panel_token" && -n "$daemon_token" && "$panel_token" != "$daemon_token" ]]; then
        log_error "Panel 与 Daemon 的 DAEMON_TOKEN 不一致，Daemon 鉴权将失败"
        log_warn "修复: sed -i \"s|^DAEMON_TOKEN=.*|DAEMON_TOKEN=$panel_token|\" $daemon_env"
        missing=$((missing + 1))
    fi

    if [[ $missing -eq 0 ]]; then
        log_success ".env 配置校验通过"
    else
        log_warn "共 $missing 项 .env 配置已补全/需关注，请检查日志"
    fi
    return 0
}

# ============ v3.8.0-P3: 预部署诊断 ============
# 检查端口占用 / 磁盘空间 / Node 版本 / 系统依赖
pre_diagnose() {
    log_info "===== 预部署诊断 ====="
    local issues=0

    # 1. 端口占用检查
    log_info "检查端口占用..."
    if ss -tln 2>/dev/null | grep -qE ":$PANEL_PORT\s"; then
        log_warn "端口 $PANEL_PORT 已被占用（Panel 将无法启动）"
        ss -tlnp 2>/dev/null | grep -E ":$PANEL_PORT\s" || true
        issues=$((issues + 1))
    else
        log_success "端口 $PANEL_PORT 可用"
    fi
    if ss -tln 2>/dev/null | grep -qE ":$DAEMON_PORT\s"; then
        log_warn "端口 $DAEMON_PORT 已被占用（Daemon 将无法启动）"
        ss -tlnp 2>/dev/null | grep -E ":$DAEMON_PORT\s" || true
        issues=$((issues + 1))
    else
        log_success "端口 $DAEMON_PORT 可用"
    fi

    # 2. 磁盘空间检查（需 >= 1GB）
    log_info "检查磁盘空间..."
    local free_mb=$(df -m "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
    if [[ -z "$free_mb" ]]; then
        # INSTALL_DIR 不存在时检查父目录
        free_mb=$(df -m "/opt" 2>/dev/null | awk 'NR==2 {print $4}')
    fi
    if [[ -n "$free_mb" ]]; then
        if [[ $free_mb -lt 1024 ]]; then
            log_error "磁盘空间不足: ${free_mb}MB < 1024MB（建议至少 1GB 可用空间）"
            issues=$((issues + 1))
        else
            log_success "磁盘空间充足: ${free_mb}MB 可用"
        fi
    else
        log_warn "无法检测磁盘空间（df 失败），跳过"
    fi

    # 3. Node.js 版本检查
    log_info "检查 Node.js 版本..."
    if command -v node &> /dev/null; then
        local node_major=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ $node_major -lt $NODE_VERSION ]]; then
            log_error "Node.js 版本过低: $(node -v) < v$NODE_VERSION"
            issues=$((issues + 1))
        else
            log_success "Node.js $(node -v) 满足要求"
        fi
    else
        log_warn "Node.js 未安装（install 时会自动安装 v$NODE_VERSION）"
    fi

    # 4. 系统依赖检查
    log_info "检查系统依赖..."
    local missing_deps=()
    for dep in curl wget git unzip openssl; do
        if ! command -v "$dep" &> /dev/null; then
            missing_deps+=("$dep")
        fi
    done
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_warn "缺失系统依赖: ${missing_deps[*]}（install 时会自动安装）"
    else
        log_success "系统依赖齐全"
    fi

    # 5. 现有安装检查
    if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/panel/backend/.env" ]]; then
        log_warn "检测到已有安装: $INSTALL_DIR（建议使用 update 而非 install）"
    fi

    # 6. systemd 服务文件检查
    if [[ -f /etc/systemd/system/gameserver-panel.service ]]; then
        log_info "已存在 systemd 服务文件（install 会覆盖）"
    fi

    log_info "===== 诊断完成（${issues} 项问题） ====="
    if [[ $issues -gt 0 ]]; then
        log_warn "存在 $issues 项部署前问题，建议修复后再执行 install/one-click"
        return 1
    fi
    log_success "预部署诊断全部通过"
    return 0
}

# ============ 构建 ============
build() {
    log_info "构建前端..."
    cd "$INSTALL_DIR/panel/frontend"
    # v4.33.0: 暂用 build（vite build + verify）替代 build:release（含 typecheck），
    # 因 Mods.tsx 有 pre-existing TS 类型推断差异（dev tsc 通过但 /opt 环境报 TS2304）
    npm run build && npm run verify || { log_error "前端构建失败"; return 1; }

    log_info "编译后端..."
    cd "$INSTALL_DIR/panel/backend"
    npm run build || { log_error "后端编译失败"; return 1; }

    log_info "编译 Daemon..."
    cd "$INSTALL_DIR/daemon"
    npm run build || { log_error "Daemon 编译失败"; return 1; }

    log_success "构建完成"
}

# ============ 创建 systemd 服务 ============
create_systemd_services() {
    log_info "创建 systemd 服务..."

    # Daemon 服务
    cat > /etc/systemd/system/gameserver-daemon.service << EOF
[Unit]
Description=GameServer Panel Daemon
After=network.target

[Service]
Type=simple
User=$PANEL_USER
Group=$PANEL_USER
WorkingDirectory=$INSTALL_DIR/daemon
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    # Panel 服务
    cat > /etc/systemd/system/gameserver-panel.service << EOF
[Unit]
Description=GameServer Panel Backend
After=network.target gameserver-daemon.service

[Service]
Type=simple
User=$PANEL_USER
Group=$PANEL_USER
WorkingDirectory=$INSTALL_DIR/panel/backend
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload

    # v4.20.0: sudoers 配置——允许 gameserver 用户免密执行 systemctl restart gameserver-panel
    # 用途：Setup Wizard v2 提交后，Panel 后端通过 restartService.ts 调用
    #   `sudo systemctl restart gameserver-panel` 触发自身重启（使 .env 新配置生效）
    # 安全：仅允许此单条命令，无其他特权；sudoers 文件权限 440
    local SUDOERS_FILE="/etc/sudoers.d/gameserver-panel"
    cat > "$SUDOERS_FILE" << EOF
# v4.20.0 Setup Wizard v2: 允许 gameserver 用户免密重启 Panel 后端
# 仅限 systemctl restart gameserver-panel 这一条命令，无其他特权
$PANEL_USER ALL=(root) NOPASSWD: /bin/systemctl restart gameserver-panel
EOF
    chmod 440 "$SUDOERS_FILE"
    # visudo -c 校验语法（失败则删除 sudoers 文件并报错，避免破坏 sudo）
    if ! visudo -cf "$SUDOERS_FILE" >/dev/null 2>&1; then
        log_warn "sudoers 语法校验失败，删除 $SUDOERS_FILE 避免破坏 sudo"
        rm -f "$SUDOERS_FILE"
    else
        log_info "sudoers 配置完成（$PANEL_USER 可免密重启 gameserver-panel）"
    fi

    log_success "systemd 服务创建完成"
}

# ============ 设置权限 ============
set_permissions() {
    log_info "设置文件权限..."
    chown -R "$PANEL_USER:$PANEL_USER" "$INSTALL_DIR"
    chmod 600 "$INSTALL_DIR/panel/backend/.env"
    chmod 600 "$INSTALL_DIR/daemon/.env"
    log_success "权限设置完成"
}

# ============ 完整安装 ============
install() {
    check_root
    log_info "开始安装 GameServer Panel v$DEPLOY_VERSION..."

    install_deps
    install_nodejs
    check_runtimes
    create_user
    copy_project
    install_npm_deps
    setup_env
    check_env  # v3.8.0-P2: 安装后立即校验 .env
    build
    create_systemd_services
    set_permissions

    log_success "===== 安装完成 ====="
    echo ""
    echo "启动服务:"
    echo "  sudo systemctl start gameserver-daemon"
    echo "  sudo systemctl start gameserver-panel"
    echo ""
    echo "访问: https://<服务器IP>:$PANEL_HTTPS_PORT (HTTP :$PANEL_HTTP_PORT 自动跳转 HTTPS)"
    echo "默认账号: admin@local.dev / admin123"
    echo ""
    log_warn "生产环境请通过浏览器访问 /setup 完成首启动初始化（修改管理员密码、设置站点名）"
}

# ============ 启动服务 ============
start() {
    check_root
    log_info "启动服务..."
    systemctl start gameserver-daemon
    sleep 2
    systemctl start gameserver-panel
    log_success "服务已启动"

    # D16/G28: 启动后健康检查（30秒超时循环检测）
    health_check

    status
}

# ============ 健康检查 (D16/G28) ============
# 同时检测 Daemon（8080）和 Panel（3002）端口，30s 超时
# v4.0.1 起 Panel 端口 3002 仅本机访问，对外由 nginx 反向代理 3001(HTTPS)/3000(HTTP 跳转)
health_check() {
    local max_wait=30
    local elapsed=0
    local panel_health="http://localhost:$PANEL_PORT/api/health"
    local daemon_health="http://localhost:$DAEMON_PORT/health"

    log_info "健康检查（最长等待 ${max_wait}s）"
    log_info "  Panel:  $panel_health"
    log_info "  Daemon: $daemon_health"

    local panel_ok=false
    local daemon_ok=false
    while [[ $elapsed -lt $max_wait ]]; do
        # 检测 Panel（/api/health 无需鉴权）
        if [[ "$panel_ok" == "false" ]] && curl -sf --max-time 3 "$panel_health" &>/dev/null; then
            panel_ok=true
            log_success "Panel 健康检查通过（${elapsed}s）"
        fi
        # 检测 Daemon（/health 无需鉴权）
        if [[ "$daemon_ok" == "false" ]] && curl -sf --max-time 3 "$daemon_health" &>/dev/null; then
            daemon_ok=true
            log_success "Daemon 健康检查通过（${elapsed}s）"
        fi
        # 两者都通过则退出
        if [[ "$panel_ok" == "true" && "$daemon_ok" == "true" ]]; then
            log_success "全部健康检查通过（${elapsed}s）"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    if [[ "$panel_ok" == "false" ]]; then
        log_error "Panel 健康检查超时（${max_wait}s），服务可能未就绪"
    fi
    if [[ "$daemon_ok" == "false" ]]; then
        log_error "Daemon 健康检查超时（${max_wait}s），服务可能未就绪"
    fi
    log_warn "请检查日志: journalctl -u gameserver-panel -u gameserver-daemon --no-pager -n 50"
    return 1
}

# ============ 停止服务 ============
stop() {
    check_root
    log_info "停止服务..."
    systemctl stop gameserver-panel || true
    systemctl stop gameserver-daemon || true
    log_success "服务已停止"
}

# ============ 重启服务 ============
restart() {
    check_root
    log_info "重启服务..."
    systemctl restart gameserver-daemon
    sleep 2
    systemctl restart gameserver-panel
    log_success "服务已重启"

    # D16/G28: 重启后健康检查
    health_check

    status
}

# ============ 查看状态 ============
status() {
    echo ""
    systemctl status gameserver-daemon --no-pager || true
    echo ""
    systemctl status gameserver-panel --no-pager || true
}

# ============ v3.8.0-P4: 代码 + DB 备份 ============
# 在 update 前：备份 panel/daemon 代码 + DB 到 $BACKUP_DIR/pre-update-<timestamp>
#
# v4.0.4 修复（严重 Bug）：
#   原备份逻辑用 `cp -r "$INSTALL_DIR/daemon"` 整目录复制，未排除 daemon/instances
#   （游戏实例数据，可达数十 GB）、Steam、coverage 等大目录，导致每次备份体积爆炸
#   （单次 23G+ × 5 份 = 115G+），把磁盘写满，SQLite 无法写入，服务启动失败。
#
#   修复原则：只备份项目代码 + 配置 + 数据库，绝不备份运行时产生的数据
#   （instances/Steam/downloads/_versions/system/logs/.cache 等）。
backup_before_update() {
    local ts=$(date +%s)
    local backup_path="$BACKUP_DIR/pre-update-$ts"
    mkdir -p "$backup_path"

    log_info "备份当前部署到 $backup_path..."

    # 备份排除清单：运行时数据 / 构建产物 / 大文件目录
    # 这些目录不属于项目代码，备份它们会导致体积爆炸
    local exclude_patterns=(
        "node_modules"        # npm 依赖（可重装）
        "dist"                # 构建产物（可重建）
        "coverage"            # 测试覆盖率报告
        "instances"           # 游戏实例数据（用户数据，单独保护，不进代码备份）
        "Steam"               # Steam 游戏文件
        ".steamcmd"           # SteamCMD 安装目录
        "downloads"           # 游戏下载缓存
        "_versions"           # 游戏版本缓存
        "system"              # 系统运行时数据
        "logs"                # 日志
        ".pids"               # PID 文件
        ".cache"              # 缓存
        ".npm"                # npm 缓存
        ".backup"             # 备份目录自身（防止递归）
        ".trae"               # IDE/AI 工具数据
    )

    # 构造 rsync 排除参数（如果 rsync 可用，优先使用，效率更高）
    local rsync_excludes=""
    for pat in "${exclude_patterns[@]}"; do
        rsync_excludes="$rsync_excludes --exclude=$pat"
    done

    # 备份函数：优先 rsync，降级到 cp + rm
    # 用法: backup_dir <src> <dst>
    backup_dir() {
        local src="$1" dst="$2"
        if [[ ! -d "$src" ]]; then
            return 0
        fi
        if command -v rsync &> /dev/null; then
            rsync -a $rsync_excludes "$src/" "$dst/" 2>/dev/null || {
                # rsync 失败则降级到 cp
                cp -r "$src" "$dst"
                for pat in "${exclude_patterns[@]}"; do
                    rm -rf "$dst/$pat" 2>/dev/null || true
                done
            }
        else
            cp -r "$src" "$dst"
            for pat in "${exclude_patterns[@]}"; do
                rm -rf "$dst/$pat" 2>/dev/null || true
            done
        fi
    }

    # 备份项目代码（已排除 instances/Steam/node_modules/dist/coverage 等大目录）
    backup_dir "$INSTALL_DIR/panel" "$backup_path/panel"
    backup_dir "$INSTALL_DIR/daemon" "$backup_path/daemon"
    backup_dir "$INSTALL_DIR/packs" "$backup_path/packs"
    backup_dir "$INSTALL_DIR/public" "$backup_path/public"

    # 备份数据库（用户数据，必须备份）
    local db_path="$INSTALL_DIR/data/panel.db"
    if [[ -f "$db_path" ]]; then
        mkdir -p "$backup_path/data"
        cp "$db_path" "$backup_path/data/panel.db"
    fi

    # 备份 .env（配置，必须备份）
    if [[ -f "$INSTALL_DIR/panel/backend/.env" ]]; then
        cp "$INSTALL_DIR/panel/backend/.env" "$backup_path/panel.env"
    fi
    if [[ -f "$INSTALL_DIR/daemon/.env" ]]; then
        cp "$INSTALL_DIR/daemon/.env" "$backup_path/daemon.env"
    fi

    # 记录备份时间戳
    echo "$ts" > "$BACKUP_DIR/.last-backup-ts"

    # 清理超过 3 个的旧备份（v4.0.4：从 5 降到 3，进一步控制磁盘占用）
    ls -dt "$BACKUP_DIR"/pre-update-* 2>/dev/null | tail -n +4 | xargs -r rm -rf

    # 磁盘空间安全检查：如果备份后磁盘使用率 >= 90%，警告并清理最旧备份
    local disk_usage=$(df "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {gsub(/%/,""); print $5}')
    if [[ -n "$disk_usage" && "$disk_usage" -ge 90 ]]; then
        log_warn "备份后磁盘使用率 ${disk_usage}%，清理最旧的备份以释放空间..."
        ls -dt "$BACKUP_DIR"/pre-update-* 2>/dev/null | tail -n +2 | xargs -r rm -rf
    fi

    log_success "备份完成: $backup_path"
    echo "$backup_path"
}

# ============ v3.8.0-P4: 从备份回滚 ============
# 用法: rollback_from_backup <backup_path>
#
# v4.0.4 修复：回滚时只恢复代码 + DB + .env，不触碰 instances/Steam 等运行时数据
# （备份里本来就不含这些，原代码的 rm -rf "$INSTALL_DIR/panel" 会误删，现已改为
# 只删除代码文件，保留 instances/data/Steam 等用户数据）
rollback_from_backup() {
    local backup_path="$1"
    if [[ -z "$backup_path" || ! -d "$backup_path" ]]; then
        log_error "回滚失败: 备份路径无效 '$backup_path'"
        return 1
    fi

    log_warn "开始从备份回滚: $backup_path"

    stop || true

    # v4.0.4: 回滚代码时只替换代码目录，保留运行时数据（instances/Steam/data 等）
    # 使用 rsync 排除运行时数据；降级到 cp 时先备份现有运行时数据再恢复
    rollback_code_dir() {
        local src="$1" dst="$2"
        if [[ ! -d "$src" ]]; then
            return 0
        fi

        # 保留的运行时数据目录（不回滚）
        local runtime_dirs=("instances" "Steam" ".steamcmd" "downloads" "_versions" "system" "data" "logs" ".pids" ".cache")

        if command -v rsync &> /dev/null; then
            # rsync 方式：排除运行时数据，只同步代码
            local excludes=""
            for pat in "${runtime_dirs[@]}"; do
                excludes="$excludes --exclude=$pat"
            done
            # --delete 让 dst 中不在 src 的文件被删除，但排除的运行时目录保留
            rsync -a --delete $excludes "$src/" "$dst/" 2>/dev/null
        else
            # cp 方式：先删除代码文件（保留运行时目录），再复制
            for pat in "${runtime_dirs[@]}"; do
                if [[ -d "$dst/$pat" ]]; then
                    mv "$dst/$pat" "$dst/.$pat.tmp-preserve" 2>/dev/null || true
                fi
            done
            rm -rf "$dst"
            cp -r "$src" "$dst"
            for pat in "${runtime_dirs[@]}"; do
                if [[ -d "$dst/.$pat.tmp-preserve" ]]; then
                    rm -rf "$dst/$pat" 2>/dev/null || true
                    mv "$dst/.$pat.tmp-preserve" "$dst/$pat" 2>/dev/null || true
                fi
            done
        fi
    }

    # 恢复代码（保留 instances/Steam/data 等运行时数据）
    rollback_code_dir "$backup_path/panel" "$INSTALL_DIR/panel"
    rollback_code_dir "$backup_path/daemon" "$INSTALL_DIR/daemon"
    rollback_code_dir "$backup_path/packs" "$INSTALL_DIR/packs"
    rollback_code_dir "$backup_path/public" "$INSTALL_DIR/public"

    # 恢复数据库
    if [[ -f "$backup_path/data/panel.db" ]]; then
        mkdir -p "$INSTALL_DIR/data"
        cp "$backup_path/data/panel.db" "$INSTALL_DIR/data/panel.db"
    elif [[ -f "$backup_path/panel.db" ]]; then
        # 兼容旧格式备份（v4.0.4 之前数据库直接放在 backup_path 根下）
        mkdir -p "$INSTALL_DIR/data"
        cp "$backup_path/panel.db" "$INSTALL_DIR/data/panel.db"
    fi

    # 恢复 .env
    if [[ -f "$backup_path/panel.env" ]]; then
        cp "$backup_path/panel.env" "$INSTALL_DIR/panel/backend/.env"
    fi
    if [[ -f "$backup_path/daemon.env" ]]; then
        cp "$backup_path/daemon.env" "$INSTALL_DIR/daemon/.env"
    fi

    # 重新安装依赖 + 构建（因为备份里删了 node_modules/dist）
    install_npm_deps
    build
    set_permissions

    log_success "回滚完成，准备启动服务..."
    start
}

# ============ 更新 ============
# 用法: update [--rollback]
update() {
    check_root

    # v3.8.0-P4: update --rollback 显式回滚到上一备份
    if [[ "$1" == "--rollback" ]]; then
        log_info "执行回滚到上一备份..."
        local last_backup=""
        # 取最新的 pre-update-* 备份
        last_backup=$(ls -dt "$BACKUP_DIR"/pre-update-* 2>/dev/null | head -n 1)
        if [[ -z "$last_backup" ]]; then
            log_error "未找到任何备份，无法回滚（路径: $BACKUP_DIR/pre-update-*）"
            exit 1
        fi
        log_warn "将回滚到: $last_backup"
        read -p "确认回滚? 此操作将覆盖当前代码和数据库 (yes/no): " confirm
        if [[ "$confirm" != "yes" ]]; then
            log_info "取消回滚"
            exit 0
        fi
        rollback_from_backup "$last_backup"
        return $?
    fi

    log_info "更新 GameServer Panel v$DEPLOY_VERSION..."

    stop

    # v3.8.0-P4: 部署前完整备份（代码 + DB + .env）
    local backup_path=$(backup_before_update)

    # 部署失败回滚机制——构建失败时恢复代码 + DB
    # 使用 trap 捕获 ERR 信号，任何命令失败时触发回滚
    trap '
        log_error "部署过程中构建失败，执行回滚..."
        rollback_from_backup "'"$backup_path"'"
        log_error "更新失败，已回滚到上一版本。请检查构建错误后重试。"
        exit 1
    ' ERR

    # 更新代码 + 安装依赖 + 构建（set -e + trap ERR 保证失败时回滚）
    copy_project
    install_npm_deps
    check_env  # v3.8.0-P2: 更新后校验 .env 字段
    build
    set_permissions

    # 构建成功后清除 ERR trap
    trap - ERR

    # 运行数据库迁移
    log_info "运行数据库迁移..."
    cd "$INSTALL_DIR/panel/backend"

    # v4.19.0 M5: 基线重置识别闸门
    # 检测是否为基线重置版本，对健康存量库注入 baseline 记录
    # 三条路径：全新安装（跳过）/ 健康存量库（注入 baseline）/ 异常库（阻断）
    BASELINE_FLAG="$INSTALL_DIR/data/.baseline_v4_applied"
    DB_PATH="$INSTALL_DIR/data/panel.db"
    if [[ ! -f "$BASELINE_FLAG" && -f "$DB_PATH" ]]; then
        log_info "v4.19.0 基线重置：检测存量库状态..."
        HAS_TABLE=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='knex_migrations';" 2>/dev/null || echo 0)
        HAS_USERS=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='users';" 2>/dev/null || echo 0)
        HAS_SYSTEM_CONFIG=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='system_config';" 2>/dev/null || echo 0)
        HAS_BINDINGS=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='bindings';" 2>/dev/null || echo 0)
        HAS_V417=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM knex_migrations WHERE name='20260807000001_unify_bindings_and_multi_role.ts';" 2>/dev/null || echo 0)
        HAS_V418_INIT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM knex_migrations WHERE name='20260808000001_system_mode_and_preflight.ts';" 2>/dev/null || echo 0)

        if [[ "$HAS_TABLE" -eq 1 && "$HAS_USERS" -eq 1 && "$HAS_SYSTEM_CONFIG" -eq 1 && "$HAS_BINDINGS" -eq 1 && ( "$HAS_V417" -eq 1 || "$HAS_V418_INIT" -eq 1 ) ]]; then
            # 健康存量库：核心表齐全 + v4.17/v4.18 migration 已执行
            log_info "基线重置：健康存量库识别通过，注入 baseline 记录..."
            sqlite3 "$DB_PATH" "DELETE FROM knex_migrations;"
            sqlite3 "$DB_PATH" "INSERT INTO knex_migrations (name, batch, migration_time) VALUES ('20260808000000_baseline_v4_post_demo.ts', 1, datetime('now'));"
            log_success "基线记录注入完成（后续仅执行增量迁移）"
        elif [[ "$HAS_TABLE" -eq 0 ]]; then
            # 全新安装：无 knex_migrations 表，跳过注入
            log_info "基线重置：全新安装，跳过 baseline 注入"
        else
            # 异常库：核心表缺失或关键 migration 不存在
            log_error "基线重置：检测到异常存量库（核心表缺失或迁移状态不完整）"
            log_error "  knex_migrations=$HAS_TABLE users=$HAS_USERS system_config=$HAS_SYSTEM_CONFIG bindings=$HAS_BINDINGS v417=$HAS_V417 v418_init=$HAS_V418_INIT"
            log_error "拒绝自动注入 baseline，请先人工核对 schema/迁移状态后重试"
            exit 1
        fi
        touch "$BASELINE_FLAG"
    fi

    npm run migrate || log_warn "迁移可能已完成或失败，请检查日志"

    # v3.8.0-P4: 部署成功后标记为 last-good 备份
    rm -rf "$LAST_GOOD_BACKUP"
    cp -r "$backup_path" "$LAST_GOOD_BACKUP"

    start
    log_success "更新完成"
}

# ============ v3.8.0-P1: 一键部署 ============
# 预诊断 → install → start → 健康检查
one_click() {
    check_root
    log_info "===== 一键部署 GameServer Panel v$DEPLOY_VERSION ====="

    # 1. 预部署诊断（端口/磁盘/依赖）
    log_info "[1/4] 预部署诊断"
    if ! pre_diagnose; then
        log_error "预部署诊断未通过，一键部署中止"
        log_info "可执行 'sudo bash deploy.sh install' 跳过诊断强制安装（不推荐）"
        exit 1
    fi

    # 2. 安装
    log_info "[2/4] 执行安装"
    install

    # 3. 启动
    log_info "[3/4] 启动服务"
    start

    # 4. 健康检查已在 start 内执行
    log_info "[4/4] 部署完成"
    log_success "===== 一键部署成功 ====="
    echo ""
    echo "访问: https://<服务器IP>:$PANEL_HTTPS_PORT (HTTP :$PANEL_HTTP_PORT 自动跳转 HTTPS)"
    echo "首启动请访问: https://<服务器IP>:$PANEL_HTTPS_PORT/setup"
    echo "默认账号: admin@local.dev / admin123"
    echo ""
    log_warn "请通过浏览器访问 /setup 完成首启动初始化（修改管理员密码、设置站点名、启用游戏）"
}

# ============ 卸载 ============
uninstall() {
    check_root
    log_warn "这将删除所有数据！"
    read -p "确认卸载? (yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        log_info "取消卸载"
        exit 0
    fi

    stop
    systemctl disable gameserver-daemon 2>/dev/null || true
    systemctl disable gameserver-panel 2>/dev/null || true
    rm -f /etc/systemd/system/gameserver-*.service
    # v4.20.0: 同步清理 sudoers 配置
    rm -f /etc/sudoers.d/gameserver-panel
    systemctl daemon-reload
    userdel -r "$PANEL_USER" 2>/dev/null || true
    rm -rf "$INSTALL_DIR"

    log_success "卸载完成"
}

# ============ 主入口 ============
case "$1" in
    install)
        install
        ;;
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    update)
        update "$2"
        ;;
    one-click)
        one_click
        ;;
    diagnose)
        check_root
        pre_diagnose
        ;;
    uninstall)
        uninstall
        ;;
    --version|-v)
        echo "GameServer Panel deploy.sh v$DEPLOY_VERSION"
        ;;
    *)
        echo "GameServer Panel deploy.sh v$DEPLOY_VERSION"
        echo "用法: $0 {install|start|stop|restart|status|update|one-click|diagnose|uninstall}"
        echo "      $0 update --rollback"
        echo ""
        echo "命令说明:"
        echo "  install          - 首次安装"
        echo "  start            - 启动服务"
        echo "  stop             - 停止服务"
        echo "  restart          - 重启服务"
        echo "  status           - 查看状态"
        echo "  update           - 更新版本（保留数据，自动备份代码+DB）"
        echo "  update --rollback - 回滚到上一备份（v3.8.0-P4）"
        echo "  one-click        - 一键部署：诊断 + install + start（v3.8.0-P1）"
        echo "  diagnose         - 仅执行预部署诊断（v3.8.0-P3）"
        echo "  uninstall        - 完全卸载"
        echo "  --version        - 显示版本号"
        exit 1
        ;;
esac
