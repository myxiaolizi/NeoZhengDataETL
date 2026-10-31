#!/usr/bin/env bash
# ============================================================
#  V8 生产部署脚本（在云服务器上以 root 执行）
#
#  用法：
#    bash /tmp/v8-deploy.sh /tmp/jdy-push-v8-src
#      第一个参数 = 已上传的新版本源码目录（rsync 源）
#
#  设计原则：
#   1) 先整目录备份，失败可一键回滚（脚本会打印回滚命令）
#   2) 绝不覆盖 .env 与 node_modules
#   3) 同步后做语法自检（node -c 等价），失败立即回滚并退出
#   4) 重启由宝塔面板负责，本脚本只做文件级替换 + 自检 + 备份
# ============================================================
set -uo pipefail

APP_DIR="/www/wwwroot/jdy-push"
SRC_DIR="${1:-}"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="$APP_DIR/.backup-v8-$TS"
NODE_BIN="/www/server/nodejs/v24.14.1/bin/node"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

[ "$(id -u)" -eq 0 ] || { error "请使用 root 运行"; exit 1; }
[ -n "$SRC_DIR" ] || { error "用法: bash $0 <新版本源码目录>"; exit 1; }
[ -d "$SRC_DIR" ] || { error "源码目录不存在: $SRC_DIR"; exit 1; }
[ -d "$APP_DIR" ] || { error "生产目录不存在: $APP_DIR"; exit 1; }

info "=== 1. 备份生产环境 → $BACKUP ==="
mkdir -p "$BACKUP"
cp -a "$APP_DIR/src"        "$BACKUP/" 2>/dev/null
cp -a "$APP_DIR/frontend"   "$BACKUP/" 2>/dev/null
cp -a "$APP_DIR/package.json" "$BACKUP/" 2>/dev/null
cp -a "$APP_DIR/CHANGELOG.md" "$BACKUP/" 2>/dev/null
cp -a "$APP_DIR/README.md"    "$BACKUP/" 2>/dev/null
cp -a "$APP_DIR/views"        "$BACKUP/" 2>/dev/null
cp -a "$APP_DIR/public"       "$BACKUP/" 2>/dev/null
cp -a "$APP_DIR/scripts"      "$BACKUP/" 2>/dev/null
info "备份完成，大小：$(du -sh "$BACKUP" | cut -f1)"

info "=== 2. 记录旧版本指纹 ==="
OLD_FP="$(cd "$APP_DIR" && md5sum src/flows.js src/schema.js src/routes/push.js src/flow-ingest.js src/server.js src/ai.js 2>/dev/null | md5sum | cut -d' ' -f1)"
info "旧指纹: $OLD_FP"

info "=== 3. 同步源码（排除 .env / node_modules / .git / 数据文件 / _work）==="
if command -v rsync >/dev/null 2>&1; then
  rsync -a \
    --exclude '.env' --exclude 'node_modules' --exclude '.git' \
    --exclude '数据文件' --exclude '_work' --exclude 'logs' \
    --exclude '.backup-*' --exclude '*.zip' --exclude 'browser-screenshots' \
    --exclude 'ant-design' --exclude '_color-backup*' --exclude '_sanitize-backup' \
    --exclude '_mail_attach' --exclude '_*.txt' --exclude '_*.log' \
    "$SRC_DIR"/ "$APP_DIR"/
else
  warn "未找到 rsync，改用 tar"
  tar -C "$SRC_DIR" \
      --exclude=.env --exclude=node_modules --exclude=.git \
      --exclude='数据文件' --exclude=_work --exclude=logs \
      --exclude='.backup-*' --exclude='*.zip' --exclude=browser-screenshots \
      --exclude=ant-design \
      -cf - . | tar -C "$APP_DIR" -xf -
fi
info "同步完成"

info "=== 4. 语法自检（逐个 require 关键模块，不启动监听）==="
FAILED=0
cd "$APP_DIR" || exit 1
for f in src/ai.js src/ai-scope.js src/ai-shares.js src/flows.js src/flow-ingest.js \
         src/schema.js src/routes/push.js src/routes/api.js src/settings.js src/server.js; do
  if "$NODE_BIN" --check "$f" >/dev/null 2>&1; then
    info "  语法 OK  $f"
  else
    error "  语法错误 $f"; "$NODE_BIN" --check "$f" 2>&1 | head -5; FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  error "自检失败，开始回滚"
  rsync -a "$BACKUP/src/" "$APP_DIR/src/" 2>/dev/null
  cp -a "$BACKUP/frontend" "$APP_DIR/" 2>/dev/null
  error "已回滚。请手工确认后再试。备份：$BACKUP"
  exit 1
fi

info "=== 5. 依赖同步（仅当 package.json 变化）==="
if ! diff -q "$BACKUP/package.json" "$APP_DIR/package.json" >/dev/null 2>&1; then
  warn "package.json 有变化，执行 npm install --omit=dev"
  ( cd "$APP_DIR" && /www/server/nodejs/v24.14.1/bin/npm install --omit=dev \
      --registry=https://registry.npmmirror.com --no-audit --no-fund ) || warn "npm install 失败，请手工检查"
else
  info "package.json 无变化，跳过 npm install"
fi

info "=== 6. 权限修正 ==="
chown -R www:www "$APP_DIR/src" "$APP_DIR/scripts" "$APP_DIR/frontend" 2>/dev/null
chmod 600 "$APP_DIR/.env" 2>/dev/null

info "=== 7. 前端构建产物确认 ==="
if [ -f "$APP_DIR/frontend/dist/index.html" ]; then
  info "  dist 入口: $(grep -o 'index-[A-Za-z0-9_-]*\.js' "$APP_DIR/frontend/dist/index.html" | head -1)"
  info "  dist 资源数: $(ls "$APP_DIR/frontend/dist/assets" | wc -l)"
else
  error "  frontend/dist/index.html 缺失！前端将回退到提示页"
fi

info "=== 8. 完成 ==="
cat <<EOF

  备份目录 : $BACKUP
  回滚命令 : rsync -a --delete $BACKUP/src/ $APP_DIR/src/ && cp -a $BACKUP/frontend $APP_DIR/ && cp -a $BACKUP/package.json $APP_DIR/
  重启服务 : 宝塔面板 → 网站 → Node 项目 → jdy-push → 重启
     或    : kill \$(cat /www/server/nodejs/vhost/pids/jdy-push.pid)

  部署后验证：
    curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8781/healthz
    cd $APP_DIR && $NODE_BIN scripts/v8-reconcile-verify.js
    cd $APP_DIR && $NODE_BIN scripts/v8-flow-verify.js

EOF
