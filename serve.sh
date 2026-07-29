#!/bin/bash
# GameServer Panel 生产模式启动（开发目录直跑，不依赖 systemd / /opt）
# 用法: ./serve.sh {start|stop|restart|status|logs <svc>|health}
#
# 与 dev.sh 的区别：
#   - 不启动 Vite dev server（5173）
#   - Panel Backend 直接以 tsx 跑在 3000，托管 panel/frontend/dist
#   - 适合公网已经做好端口映射、只关心 3000 端口可达的场景

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
PID_DIR="$SCRIPT_DIR/.pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[SERVE]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }

is_running() {
    local pid_file="$1"
    [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

start_daemon() {
    info "启动 Daemon (端口 8080, 仅本机)..."
    cd "$SCRIPT_DIR/daemon"

    if is_running "$PID_DIR/daemon.pid"; then
        log "Daemon 已在运行 (PID $(cat "$PID_DIR/daemon.pid"))"
        return 0
    fi

    nohup npx tsx src/index.ts > "$LOG_DIR/daemon.log" 2>&1 &
    echo $! > "$PID_DIR/daemon.pid"
    disown
    log "Daemon PID: $(cat "$PID_DIR/daemon.pid")"
}

start_panel() {
    info "启动 Panel Backend (端口 3002，托管 frontend dist)..."
    cd "$SCRIPT_DIR/panel/backend"

    if is_running "$PID_DIR/panel.pid"; then
        log "Panel 已在运行 (PID $(cat "$PID_DIR/panel.pid"))"
        return 0
    fi

    nohup npx tsx src/index.ts > "$LOG_DIR/panel.log" 2>&1 &
    echo $! > "$PID_DIR/panel.pid"
    disown
    log "Panel PID: $(cat "$PID_DIR/panel.pid")"
}

stop_all() {
    info "停止服务..."
    # 先停 panel（依赖 daemon），再停 daemon
    for svc in panel daemon; do
        local pid_file="$PID_DIR/${svc}.pid"
        if [[ -f "$pid_file" ]]; then
            local pid
            pid=$(cat "$pid_file")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                log "$svc (PID $pid) 已停止"
            else
                warn "$svc PID $pid 已不存在，清理 pid 文件"
            fi
            rm -f "$pid_file"
        fi
    done
}

status() {
    echo ""
    for svc in panel daemon; do
        local pid_file="$PID_DIR/${svc}.pid"
        if is_running "$pid_file"; then
            local pid
            pid=$(cat "$pid_file")
            local port
            [[ "$svc" == "panel" ]] && port=3002 || port=8080
            echo -e "${GREEN}● $svc${NC} 运行中 (PID $pid, 端口 $port)"
        else
            echo -e "${RED}○ $svc${NC} 未运行"
        fi
    done
    echo ""
}

health_check() {
    local max=30 elapsed=0
    local panel_ok=false daemon_ok=false

    info "健康检查（最长 ${max}s）"
    info "  Panel:  http://localhost:3002/api/health"
    info "  Daemon: http://localhost:8080/health"

    while [[ $elapsed -lt $max ]]; do
        [[ "$panel_ok" == "false" ]] && curl -sf --max-time 3 http://localhost:3002/api/health &>/dev/null && panel_ok=true
        [[ "$daemon_ok" == "false" ]] && curl -sf --max-time 3 http://localhost:8080/health &>/dev/null && daemon_ok=true
        if [[ "$panel_ok" == "true" && "$daemon_ok" == "true" ]]; then
            log "健康检查通过（${elapsed}s）"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    [[ "$panel_ok" == "false" ]] && err "Panel 健康检查超时"
    [[ "$daemon_ok" == "false" ]] && err "Daemon 健康检查超时"
    err "查看日志: tail -f logs/panel.log 或 logs/daemon.log"
    return 1
}

case "$1" in
    start)
        # 清理过期的 PID 文件
        for svc in panel daemon; do
            pid_file="$PID_DIR/${svc}.pid"
            if [[ -f "$pid_file" ]] && ! is_running "$pid_file"; then
                warn "清理过期 PID 文件: $svc ($(cat "$pid_file"))"
                rm -f "$pid_file"
            fi
        done
        start_daemon
        sleep 2
        start_panel
        health_check || true
        status
        info "公网访问入口: http://<服务器IP>:3002"
        ;;
    stop)
        stop_all
        ;;
    restart)
        stop_all
        sleep 1
        "$0" start
        ;;
    status)
        status
        ;;
    health)
        health_check
        ;;
    logs)
        svc="${2:-panel}"
        log_file="$LOG_DIR/${svc}.log"
        if [[ -f "$log_file" ]]; then
            tail -f "$log_file"
        else
            err "日志文件不存在: $log_file"
            exit 1
        fi
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status|health|logs <panel|daemon>}"
        echo ""
        echo "命令:"
        echo "  start   - 启动 daemon + panel（生产模式，托管 frontend dist）"
        echo "  stop    - 停止全部服务"
        echo "  restart - 重启全部服务"
        echo "  status  - 查看运行状态"
        echo "  health  - 健康检查（30s 超时）"
        echo "  logs    - 跟踪日志（panel/daemon）"
        ;;
esac
