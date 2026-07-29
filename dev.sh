#!/bin/bash
# GameServer Panel 开发环境快速启动脚本
# 用法: ./dev.sh [daemon|panel|frontend|all|stop]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
PID_DIR="$SCRIPT_DIR/.pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEV]${NC} $1"; }

# 检查进程是否运行
is_running() {
    local pid_file="$1"
    [[ -f "$pid_file" ]] && kill -0 $(cat "$pid_file") 2>/dev/null
}

# 启动 Daemon
start_daemon() {
    log "启动 Daemon (端口 8080)..."
    cd "$SCRIPT_DIR/daemon"

    if is_running "$PID_DIR/daemon.pid"; then
        log "Daemon 已在运行"
        return 0
    fi

    nohup npm run dev > "$LOG_DIR/daemon.log" 2>&1 &
    echo $! > "$PID_DIR/daemon.pid"
    log "Daemon PID: $(cat $PID_DIR/daemon.pid)"
}

# 启动 Panel Backend
start_panel() {
    log "启动 Panel Backend (端口 3000)..."
    cd "$SCRIPT_DIR/panel/backend"

    if is_running "$PID_DIR/panel.pid"; then
        log "Panel Backend 已在运行"
        return 0
    fi

    nohup npm run dev > "$LOG_DIR/panel.log" 2>&1 &
    echo $! > "$PID_DIR/panel.pid"
    log "Panel PID: $(cat $PID_DIR/panel.pid)"
}

# 启动 Frontend
start_frontend() {
    log "启动 Frontend (端口 5173)..."
    cd "$SCRIPT_DIR/panel/frontend"

    if is_running "$PID_DIR/frontend.pid"; then
        log "Frontend 已在运行"
        return 0
    fi

    nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$PID_DIR/frontend.pid"
    log "Frontend PID: $(cat $PID_DIR/frontend.pid)"
}

# 停止所有服务
stop_all() {
    log "停止所有服务..."

    for svc in daemon panel frontend; do
        local pid_file="$PID_DIR/${svc}.pid"
        if [[ -f "$pid_file" ]]; then
            local pid=$(cat "$pid_file")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid"
                log "$svc (PID $pid) 已停止"
            fi
            rm -f "$pid_file"
        fi
    done
}

# 查看日志
view_logs() {
    local svc="$1"
    local log_file="$LOG_DIR/${svc}.log"
    if [[ -f "$log_file" ]]; then
        tail -f "$log_file"
    else
        log "日志文件不存在: $log_file"
    fi
}

# 查看状态
status() {
    echo ""
    for svc in daemon panel frontend; do
        local pid_file="$PID_DIR/${svc}.pid"
        if is_running "$pid_file"; then
            echo -e "${GREEN}● $svc${NC} 运行中 (PID $(cat $pid_file))"
        else
            echo -e "○ $svc 未运行"
        fi
    done
    echo ""
}

# 主入口
case "$1" in
    daemon)
        start_daemon
        ;;
    panel)
        start_panel
        ;;
    frontend)
        start_frontend
        ;;
    all)
        start_daemon
        sleep 2
        start_panel
        sleep 2
        start_frontend
        echo ""
        status
        log "访问: http://localhost:5173"
        ;;
    stop)
        stop_all
        ;;
    status)
        status
        ;;
    logs)
        view_logs "$2"
        ;;
    *)
        echo "用法: $0 {daemon|panel|frontend|all|stop|status|logs <service>}"
        echo ""
        echo "命令:"
        echo "  daemon   - 启动 Daemon"
        echo "  panel    - 启动 Panel Backend"
        echo "  frontend - 启动 Frontend"
        echo "  all      - 启动全部服务"
        echo "  stop     - 停止全部服务"
        echo "  status   - 查看状态"
        echo "  logs     - 查看日志 (daemon/panel/frontend)"
        ;;
esac