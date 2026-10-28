#!/usr/bin/env bash
# ============================================================
#  简道云数据推送接收平台 - 一键部署脚本
#  适用：宝塔面板 + Node.js 环境（OpenCloudOS / CentOS / Ubuntu）
#  用法：sudo bash deploy.sh
# ============================================================
set -euo pipefail

APP_NAME="jdy-push"
APP_DIR="/www/wwwroot/jdy-push"
NODE_BIN="/www/server/nodejs/v24.14.1/bin/node"
NPM_BIN="/www/server/nodejs/v24.14.1/bin/npm"
PORT=8781
RUN_USER="www"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

[ "$(id -u)" -eq 0 ] || { error "请使用 root 运行：sudo bash deploy.sh"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- 1. 检查 Node ----------
if [ ! -x "$NODE_BIN" ]; then
  warn "未找到 $NODE_BIN，尝试使用 PATH 中的 node"
  NODE_BIN="$(command -v node || true)"
  NPM_BIN="$(command -v npm || true)"
fi
[ -x "$NODE_BIN" ] || { error "未找到 Node.js，请先在宝塔「软件商店 → Node.js版本管理」安装 v18+"; exit 1; }
info "Node 版本: $($NODE_BIN -v)"

# ---------- 2. 同步代码 ----------
info "部署目录: $APP_DIR"
mkdir -p "$APP_DIR"
if [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
  info "同步代码到 $APP_DIR ..."
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude 'node_modules' --exclude '.env' --exclude 'logs' \
      --exclude '.git' --exclude 'scripts/e2e-test.js' \
      "$SCRIPT_DIR"/ "$APP_DIR"/
  else
    tar -C "$SCRIPT_DIR" --exclude=node_modules --exclude=.env --exclude=logs \
        --exclude=.git -cf - . | tar -C "$APP_DIR" -xf -
  fi
fi

# ---------- 3. 生成 .env ----------
if [ ! -f "$APP_DIR/.env" ]; then
  info "生成 .env（数据库使用本机 127.0.0.1）"
  SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > "$APP_DIR/.env" <<EOF
PORT=$PORT
HOST=0.0.0.0
NODE_ENV=production

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
DB_CONNECTION_LIMIT=10

SESSION_SECRET=$SECRET

DEFAULT_ADMIN_USER=admin
DEFAULT_ADMIN_PASSWORD=change-me-on-first-login

MAX_BODY_SIZE=20mb
REQUIRE_SIGNATURE=0
EOF
  chmod 600 "$APP_DIR/.env"
else
  info ".env 已存在，保留现有配置"
fi

# ---------- 4. 安装依赖 ----------
info "安装 npm 依赖 ..."
cd "$APP_DIR"
"$NPM_BIN" install --omit=dev --registry=https://registry.npmmirror.com --no-audit --no-fund

# ---------- 5. 权限 ----------
info "设置目录权限（运行用户: $RUN_USER）"
mkdir -p "$APP_DIR/logs"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

# ---------- 6. 防火墙放行 ----------
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  info "firewalld 放行端口 $PORT"
  firewall-cmd --permanent --add-port=$PORT/tcp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

info "部署完成！"
echo
echo "  应用目录 : $APP_DIR"
echo "  配置文件 : $APP_DIR/.env"
echo "  监听端口 : $PORT"
echo
echo "  下一步："
echo "   1) 在宝塔面板「网站 → Node项目」中新建项目："
echo "        项目目录   : $APP_DIR"
echo "        启动选项   : start"
echo "        启动文件   : src/server.js"
echo "        项目端口   : $PORT"
echo "        运行用户   : $RUN_USER"
echo "        包管理器   : npm"
echo "        绑定域名   : 你的域名（会自动创建 Nginx 反代）"
echo "   2) 或直接命令行启动："
echo "        cd $APP_DIR && $NODE_BIN src/server.js"
echo
echo "  默认登录：见 .env 中 DEFAULT_ADMIN_USER / DEFAULT_ADMIN_PASSWORD"
echo
