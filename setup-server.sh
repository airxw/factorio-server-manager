#!/bin/bash
# ============================================================================
# GameServer Panel 新服务器一键部署脚本 (setup-server.sh)
# 适用于：裸机 Ubuntu → 全功能运行面板
# 特性：中国镜像加速 / 自动安装全部依赖 / nginx SSL / systemd 持久化
# 用法：sudo bash setup-server.sh
# ============================================================================

set -e

# ============ 配置 ============
PANEL_PORT=3002
PANEL_HTTP_PORT=3000
PANEL_HTTPS_PORT=3001
DAEMON_PORT=8080
INSTALL_DIR="/opt/gameserver-panel"
PANEL_USER="gameserver"
NODE_VERSION="20"
DEPLOY_VERSION="4.32.2"

# 新服务器 IP（用于 nginx SSL 证书和 rules 替换）
SERVER_IP="192.168.5.23"
SERVER_HOSTNAME="gsp.ecsrz.com"

# 中国镜像源配置
UBUNTU_MIRROR="https://mirrors.tuna.tsinghua.edu.cn/ubuntu/"
NPM_MIRROR="https://registry.npmmirror.com"

# ============ 颜色输出 ============
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()  { echo -e "${BLUE}[INFO]${NC}  $1" >&2; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1" >&2; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_step()  { echo -e "\n${GREEN}========== $1 ==========${NC}" >&2; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "请使用 sudo 或 root 权限运行: sudo bash setup-server.sh"
        exit 1
    fi
}

# ============================================================================
# 阶段 1：更换 Ubuntu APT 软件源为清华镜像
# ============================================================================
setup_apt_mirror() {
    log_step "阶段 1/8：配置 APT 清华镜像源"
    
    local SRC_FILE="/etc/apt/sources.list"
    local CODENAME=$(lsb_release -cs)
    
    if grep -q "tuna.tsinghua.edu.cn" "$SRC_FILE" 2>/dev/null; then
        log_ok "APT 已配置清华镜像，跳过"
        apt-get update -qq
        return 0
    fi

    # 备份原文件
    cp "$SRC_FILE" "${SRC_FILE}.bak.$(date +%s)"

    cat > "$SRC_FILE" << EOF
deb ${UBUNTU_MIRROR} ${CODENAME} main restricted universe multiverse
deb ${UBUNTU_MIRROR} ${CODENAME}-updates main restricted universe multiverse
deb ${UBUNTU_MIRROR} ${CODENAME}-backports main restricted universe multiverse
deb ${UBUNTU_MIRROR} ${CODENAME}-security main restricted universe multiverse
EOF

    apt-get update -qq
    log_ok "APT 清华镜像配置完成"
}

# ============================================================================
# 阶段 2：安装系统依赖
# ============================================================================
install_system_deps() {
    log_step "阶段 2/8：安装系统依赖"

    apt-get install -y -qq \
        curl wget git unzip rsync \
        openssl sqlite3 \
        build-essential \
        lib32gcc-s1 \
        ufw \
        certbot

    log_ok "系统依赖安装完成"
}

# ============================================================================
# 阶段 3：安装 Node.js（apt 源 + npm 淘宝镜像）
# ============================================================================
install_nodejs() {
    log_step "阶段 3/8：安装 Node.js"

    if command -v node &> /dev/null; then
        local current_major=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$current_major" -ge "$NODE_VERSION" ]]; then
            log_ok "Node.js $(node -v) 已安装，跳过"
            return 0
        fi
    fi

    log_info "安装 Node.js（使用 Ubuntu 官方源 + 清华 mirror 加速）..."
    apt-get install -y -qq nodejs npm

    log_ok "Node.js $(node -v) 安装完成"

    # 配置 npm 淘宝镜像
    log_info "配置 npm 淘宝镜像..."
    npm config set registry "$NPM_MIRROR"
    log_ok "npm registry → $NPM_MIRROR"
}

# ============================================================================
# 阶段 4：安装 Java 运行时
# ============================================================================
install_java() {
    # Minecraft 服务端 jar 用 Java 25 编译，需要 Java 25+ 运行时
    # 通过 Adoptium API 动态获取最新 Java 25 JRE 下载地址
    local JAVA_MAJOR="25"
    local INSTALL_DIR="/usr/lib/jvm/temurin-25-jre"

    # 检查是否已有 Java 25+ 安装
    if command -v java &> /dev/null; then
        local current_version=$(java -version 2>&1 | grep -oP 'version "\K\d+' | head -1 || echo "0")
        if [ "$current_version" -ge "$JAVA_MAJOR" ] 2>/dev/null; then
            log_ok "Java $current_version 已安装: $(java -version 2>&1 | head -1)"
            return 0
        fi
        log_info "当前 Java 版本 $current_version < $JAVA_MAJOR，需要升级"
    fi

    log_info "安装 Eclipse Temurin Java $JAVA_MAJOR JRE..."

    # 通过 Adoptium API 获取最新 Java 25 JRE 下载链接
    local DOWNLOAD_URL
    DOWNLOAD_URL=$(curl -sL "https://api.adoptium.net/v3/assets/latest/${JAVA_MAJOR}/hotspot?architecture=x64&image_type=jre&os=linux&vendor=eclipse" \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['binaries'][0]['package']['link'])" 2>/dev/null)

    if [ -z "$DOWNLOAD_URL" ]; then
        log_error "无法获取 Java $JAVA_MAJOR 下载链接（Adoptium API 不可达或版本不可用）"
        log_info "尝试回退：手动安装 openjdk-21-jre-headless 作为备用..."
        apt-get install -y -qq openjdk-21-jre-headless
        log_warn "仅供临时使用，请后续手动安装 Java $JAVA_MAJOR"
        return 0
    fi

    local TARBALL="/tmp/temurin-${JAVA_MAJOR}-jre.tar.gz"
    log_info "下载 $DOWNLOAD_URL ..."
    curl -L --progress-bar -o "$TARBALL" "$DOWNLOAD_URL"

    log_info "解压到 $INSTALL_DIR ..."
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$TARBALL" -C "$INSTALL_DIR" --strip-components=1
    rm -f "$TARBALL"

    # 注册到 update-alternatives（优先级 2500 = 对应 Java 25）
    update-alternatives --install /usr/bin/java java "${INSTALL_DIR}/bin/java" 2500
    update-alternatives --set java "${INSTALL_DIR}/bin/java" || true

    # 验证
    if java -version 2>&1 | grep -qP 'version "\d+'; then
        log_ok "Java $(java -version 2>&1 | head -1) 安装完成"
    else
        log_error "Java 版本验证失败，请检查安装"
        return 1
    fi
}

# ============================================================================
# 阶段 5：安装与配置 nginx
# ============================================================================
setup_nginx() {
    log_step "阶段 5/8：安装与配置 nginx"

    # 安装 nginx
    if command -v nginx &> /dev/null; then
        log_ok "nginx 已安装: $(nginx -v 2>&1)"
    else
        apt-get install -y -qq nginx
        log_ok "nginx 安装完成"
    fi

    # 创建 SSL 目录
    mkdir -p /etc/nginx/ssl

    # 生成自签名 SSL 证书（如已有则跳过）
    local CERT_KEY="/etc/nginx/ssl/${SERVER_HOSTNAME}.privkey.key"
    local CERT_PEM="/etc/nginx/ssl/${SERVER_HOSTNAME}.fullchain.pem"

    if [[ -f "$CERT_KEY" && -f "$CERT_PEM" ]]; then
        log_ok "SSL 证书已存在，跳过生成"
    else
        log_info "生成自签名 SSL 证书（有效期 10 年）..."
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout "$CERT_KEY" \
            -out "$CERT_PEM" \
            -subj "/C=CN/ST=Guangdong/L=Shenzhen/O=GSP/CN=${SERVER_HOSTNAME}" \
            -addext "subjectAltName=DNS:${SERVER_HOSTNAME},IP:${SERVER_IP}"
        log_ok "自签名 SSL 证书生成完成"
    fi

    # 创建 nginx 站点配置
    local NGINX_CONF="/etc/nginx/sites-available/gameserver-panel"

    cat > "$NGINX_CONF" << 'NGINX_EOF'
# GameServer Panel nginx 配置
# HTTP → HTTPS 跳转 + WebSocket 透传

# HTTP 入口（301 跳转 HTTPS）
server {
    listen 0.0.0.0:3000;
    listen [::]:3000;
    server_name _;

    return 301 https://$host:3001$request_uri;
}

# HTTPS 主入口
server {
    listen 0.0.0.0:3001 ssl;
    listen [::]:3001 ssl;
    server_name _;

    # SSL 证书
    ssl_certificate     /etc/nginx/ssl/gsp.ecsrz.com.fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/gsp.ecsrz.com.privkey.key;

    # TLS 配置（TLS 1.2/1.3，禁用不安全协议）
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # 安全头
    add_header Strict-Transport-Security "max-age=63072000" always;

    # 反向代理到 Panel 后端（127.0.0.1:3002）
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 透传
    location /ws {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }
}
NGINX_EOF

    # 启用站点
    rm -f /etc/nginx/sites-enabled/default
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/gameserver-panel

    # 测试配置
    nginx -t
    log_ok "nginx 配置完成"
}

# ============================================================================
# 阶段 6：更新 IP 地址引用（192.168.5.14 → 新 IP）
# ============================================================================
update_ip_references() {
    log_step "阶段 6/8：更新 IP 地址引用"

    local OLD_IP="192.168.5.14"
    local NEW_IP="${SERVER_IP}"
    local SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    local changed=0

    # .trae/rules/0.md - 最高优先级规则文件
    local RULES_0="$SCRIPT_DIR/.trae/rules/0.md"
    if grep -q "$OLD_IP" "$RULES_0" 2>/dev/null; then
        sed -i "s/${OLD_IP}/${NEW_IP}/g" "$RULES_0"
        log_ok "已更新 .trae/rules/0.md: $OLD_IP → $NEW_IP"
        changed=$((changed + 1))
    fi

    # .trae/rules/deploy.md
    local RULES_DEPLOY="$SCRIPT_DIR/.trae/rules/deploy.md"
    if grep -q "$OLD_IP" "$RULES_DEPLOY" 2>/dev/null; then
        sed -i "s/${OLD_IP}/${NEW_IP}/g" "$RULES_DEPLOY"
        log_ok "已更新 .trae/rules/deploy.md: $OLD_IP → $NEW_IP"
        changed=$((changed + 1))
    fi

    # panel/backend/.env.example
    local BE_ENV_EXAMPLE="$SCRIPT_DIR/panel/backend/.env.example"
    if grep -q "$OLD_IP" "$BE_ENV_EXAMPLE" 2>/dev/null; then
        sed -i "s/${OLD_IP}/${NEW_IP}/g" "$BE_ENV_EXAMPLE"
        log_ok "已更新 panel/backend/.env.example: $OLD_IP → $NEW_IP"
        changed=$((changed + 1))
    fi

    # panel/frontend/playwright.config.ts
    local PW_CONFIG="$SCRIPT_DIR/panel/frontend/playwright.config.ts"
    if grep -q "$OLD_IP" "$PW_CONFIG" 2>/dev/null; then
        sed -i "s/${OLD_IP}/${NEW_IP}/g" "$PW_CONFIG"
        log_ok "已更新 playwright.config.ts: $OLD_IP → $NEW_IP"
        changed=$((changed + 1))
    fi

    # deploy.sh 中硬编码的 IP
    local DEPLOY_SH="$SCRIPT_DIR/deploy.sh"
    if grep -q "$OLD_IP" "$DEPLOY_SH" 2>/dev/null; then
        sed -i "s/${OLD_IP}/${NEW_IP}/g" "$DEPLOY_SH"
        log_ok "已更新 deploy.sh: $OLD_IP → $NEW_IP"
        changed=$((changed + 1))
    fi

    if [[ $changed -eq 0 ]]; then
        log_info "无需更新 IP 地址（可能已经是 $NEW_IP）"
    else
        log_ok "共更新 $changed 个文件中的 IP 地址"
    fi
}

# ============================================================================
# 阶段 7：执行 deploy.sh 部署
# ============================================================================
run_deploy() {
    log_step "阶段 7/8：执行项目部署（deploy.sh one-click）"

    local SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$SCRIPT_DIR"

    # 确认 deploy.sh 存在
    if [[ ! -f "$SCRIPT_DIR/deploy.sh" ]]; then
        log_error "找不到 deploy.sh，请确保在项目根目录执行本脚本"
        exit 1
    fi

    # 执行一键部署（内部包含：install + build + systemd + start）
    bash "$SCRIPT_DIR/deploy.sh" one-click
}

# ============================================================================
# 阶段 8：启动 nginx 并执行最终健康检查
# ============================================================================
start_nginx_and_verify() {
    log_step "阶段 8/8：启动 nginx 并验证"

    # 启动/重启 nginx
    systemctl enable nginx
    systemctl restart nginx

    # 等一等让服务稳定
    sleep 3

    # === 健康检查 ===
    local all_ok=true

    echo ""
    log_info "===== 连接检查 ====="

    # 1. systemd 服务状态
    echo ""
    echo "--- systemd 服务状态 ---"
    for svc in gameserver-daemon gameserver-panel nginx; do
        local active=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
        local enabled=$(systemctl is-enabled "$svc" 2>/dev/null || echo "unknown")
        if [[ "$active" == "active" ]]; then
            log_ok "$svc: active / $enabled"
        else
            log_error "$svc: $active / $enabled"
            all_ok=false
        fi
    done

    # 2. Panel 本机健康检查 (3002)
    echo ""
    echo "--- Panel 内部端口 (127.0.0.1:3002) ---"
    if curl -sf --max-time 5 "http://127.0.0.1:3002/api/health" &>/dev/null; then
        local panel_resp=$(curl -s "http://127.0.0.1:3002/api/health")
        log_ok "Panel 3002: $panel_resp"
    else
        log_error "Panel 3002 不可达"
        all_ok=false
    fi

    # 3. Daemon 健康检查 (8080)
    echo ""
    echo "--- Daemon 端口 (127.0.0.1:8080) ---"
    if curl -sf --max-time 5 "http://127.0.0.1:8080/health" &>/dev/null; then
        local daemon_resp=$(curl -s "http://127.0.0.1:8080/health")
        log_ok "Daemon 8080: $daemon_resp"
    else
        log_error "Daemon 8080 不可达"
        all_ok=false
    fi

    # 4. HTTP → HTTPS 跳转 (3000)
    echo ""
    echo "--- HTTP 跳转 (3000 → 301) ---"
    local http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3000/api/health" 2>/dev/null || echo "000")
    if [[ "$http_code" == "301" ]]; then
        log_ok "HTTP 3000 → 301 跳转正常"
    else
        log_warn "HTTP 3000 返回 $http_code（预期 301）"
    fi

    # 5. HTTPS 主入口 (3001)
    echo ""
    echo "--- HTTPS 主入口 (127.0.0.1:3001) ---"
    if curl -sfk --max-time 5 "https://127.0.0.1:3001/api/health" &>/dev/null; then
        local https_resp=$(curl -sk "https://127.0.0.1:3001/api/health")
        log_ok "HTTPS 3001: $https_resp"
    else
        log_error "HTTPS 3001 不可达"
        all_ok=false
    fi

    # 6. 版本号
    echo ""
    echo "--- 版本验证 ---"
    if curl -sf --max-time 5 "http://127.0.0.1:3002/api/version" &>/dev/null; then
        local ver=$(curl -s "http://127.0.0.1:3002/api/version")
        log_ok "版本号: $ver"
    fi

    # 7. 端口监听
    echo ""
    echo "--- 端口监听 ---"
    for port in 3000 3001 3002 8080; do
        if ss -tlnp 2>/dev/null | grep -q ":$port "; then
            local proc=$(ss -tlnp 2>/dev/null | grep ":$port " | awk '{print $NF}')
            log_ok "端口 $port: $proc"
        else
            log_error "端口 $port: 无监听"
            all_ok=false
        fi
    done

    echo ""
    if [[ "$all_ok" == "true" ]]; then
        log_ok "===== 全部连接检查通过 ====="
        echo ""
        echo "访问地址："
        echo "  局域网: https://${SERVER_IP}:3001"
        echo "  公网:   https://${SERVER_HOSTNAME}:3001"
        echo "  HTTP:   http://${SERVER_IP}:3000 (自动跳转 HTTPS)"
        echo ""
        echo "首启动初始化（设置管理员密码/站点名）："
        echo "  https://${SERVER_IP}:3001/setup"
        echo ""
        echo "默认管理员: admin@local.dev / admin123"
        echo ""
        log_warn "请务必通过浏览器访问 /setup 完成初始化，修改管理员密码！"
    else
        log_error "===== 部分连接检查失败，请查看上方日志 ====="
        exit 1
    fi
}

# ============================================================================
# 主流程
# ============================================================================
main() {
    echo ""
    echo "=============================================="
    echo "  GameServer Panel 一键部署 v${DEPLOY_VERSION}"
    echo "  目标服务器: ${SERVER_IP}"
    echo "  中国镜像加速模式"
    echo "=============================================="
    echo ""

    check_root

    setup_apt_mirror
    install_system_deps
    install_nodejs
    install_java
    setup_nginx
    update_ip_references
    run_deploy
    start_nginx_and_verify

    echo ""
    log_ok "部署完成！"
}

main "$@"
