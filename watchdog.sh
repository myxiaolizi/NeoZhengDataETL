#!/bin/bash
# 简道云推送接收平台 - 进程守护脚本
# 用途：健康检查失败时自动拉起服务（宝塔 Node 项目的 nohup 启动无自动重启）
# 建议：由宝塔计划任务每分钟执行一次
#
# 配置计划任务：
#   面板 → 计划任务 → 添加任务
#     任务类型：Shell脚本
#     任务名称：jdy-push 守护
#     执行周期：N分钟 → 1分钟
#     脚本内容：bash /www/wwwroot/jdy-push/watchdog.sh

APP_DIR="/www/wwwroot/jdy-push"
PID_FILE="/www/server/nodejs/vhost/pids/jdy-push.pid"
START_SH="/www/server/nodejs/vhost/scripts/jdy-push.sh"
LOG="/www/wwwlogs/nodejs/jdy-push-watchdog.log"
HEALTH="http://127.0.0.1:8781/healthz"
NODE_BIN="/www/server/nodejs/v24.14.1/bin/node"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

# 1. 健康检查（进程在且能响应）
if curl -sf -m 5 "$HEALTH" >/dev/null 2>&1; then
    exit 0
fi

echo "[$(ts)] 健康检查失败，尝试拉起服务..." >> "$LOG"

# 2. 清理残留进程
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        kill -TERM "$OLD_PID" 2>/dev/null
        sleep 3
        kill -9 "$OLD_PID" 2>/dev/null
    fi
fi
pkill -f "$APP_DIR/src/server.js" 2>/dev/null
sleep 1

# 3. 重新启动
#    注意：宝塔计划任务以 root 执行，直接拉起会让应用以 root 运行，
#    因此这里统一降权到 RUN_USER，与面板「运行用户」保持一致。
RUN_USER="www"
if [ -x "$START_SH" ]; then
    if [ "$(id -u)" -eq 0 ]; then
        su -s /bin/bash "$RUN_USER" -c "bash '$START_SH'" >> "$LOG" 2>&1
    else
        bash "$START_SH" >> "$LOG" 2>&1
    fi
else
    cd "$APP_DIR" || exit 1
    if [ "$(id -u)" -eq 0 ]; then
        su -s /bin/bash "$RUN_USER" -c \
            "cd '$APP_DIR' && nohup '$NODE_BIN' '$APP_DIR/src/server.js' >> /www/wwwlogs/nodejs/jdy-push.log 2>&1 & echo \$! > '$PID_FILE'"
    else
        nohup "$NODE_BIN" "$APP_DIR/src/server.js" >> /www/wwwlogs/nodejs/jdy-push.log 2>&1 &
        echo $! > "$PID_FILE"
    fi
fi

# 4. 验证结果
sleep 5
if curl -sf -m 5 "$HEALTH" >/dev/null 2>&1; then
    echo "[$(ts)] 已恢复运行" >> "$LOG"
else
    echo "[$(ts)] 拉起失败，请检查 /www/wwwlogs/nodejs/jdy-push.log" >> "$LOG"
fi
