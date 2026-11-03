'use strict';
/**
 * V16 · nginx 日志回填（契约 §2.5，P0-1 方案 C 的历史部分）
 *
 * 用途：把生产 nginx access log 里历史分享访问回填到 `jdywh_share_visits`，
 *       `source='nginx'`，与上线后 `beacon` 埋点**分开统计、绝不混算**。
 *
 * 用法（在生产服务器或能读日志的机器上执行）：
 *   node scripts/v16-backfill.js --log /www/wwwlogs/jdy-push.log [--days 30] [--dry]
 *
 * 幂等：按 (token, ip, created_at 秒级) 去重，重复执行不会重复插入。
 *
 * 日志格式：兼容标准 combined（nginx 默认），逐行用正则解析而非 split，
 *          避免 UA 里含空格导致字段错位。只处理路径命中 /s/<token> 或 /a/<token> 的行。
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const db = require(path.join(ROOT, 'src', 'db'));
const visits = require(path.join(ROOT, 'src', 'share-visits'));

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

/**
 * 解析 combined 格式日志行。
 * 形如：
 * 1.2.3.4 - - [03/Nov/2026:10:00:00 +0800] "GET /s/abc123 HTTP/1.1" 200 1234 "https://ref" "Mozilla/5.0 ..."
 *
 * @returns {null | {ip, time, method, path, status, bytes, referer, ua}}
 */
function parseLine(line) {
  const m = line.match(
    /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([A-Z]+)\s+(\S+)\s+[^"]*"\s+(\d{3})\s+(\d+|-)\s+"([^"]*)"\s+"([^"]*)"/,
  );
  if (!m) return null;
  const [, ip, timeLocal, method, fullPath, status, bytesRaw, referer, ua] = m;
  return {
    ip,
    timeLocal,
    method,
    path: fullPath,
    status: Number(status),
    bytes: bytesRaw === '-' ? 0 : Number(bytesRaw),
    referer,
    ua,
  };
}

/** `03/Nov/2026:10:00:00 +0800` → Date */
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseNginxTime(t) {
  const m = String(t).match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mon, yyyy, hh, mm, ss] = m;
  const d = new Date(Number(yyyy), MONTHS[mon], Number(dd), Number(hh), Number(mm), Number(ss));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtSql(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 从路径提取 (shareType, token)：/s/<token> → report；/a/<token> → ai */
function extractShare(p) {
  let m = p.match(/^\/s\/([A-Za-z0-9]+)/);
  if (m) return { shareType: 'report', token: m[1] };
  m = p.match(/^\/a\/([A-Za-z0-9]+)/);
  if (m) return { shareType: 'ai', token: m[1] };
  /* 公开 API 路径也归到对应分享类型（只看 /api/public/shares/<token>） */
  m = p.match(/^\/api\/public\/shares\/([A-Za-z0-9]+)/);
  if (m) return { shareType: 'report', token: m[1] };
  return null;
}

async function main() {
  const logPath = arg('log', '/www/wwwlogs/jdy-push.log');
  const days = Number(arg('days', 30)) || 30;
  const dry = !!arg('dry', false);
  if (typeof logPath !== 'string' || !fs.existsSync(logPath)) {
    console.error(`日志文件不存在：${logPath}`);
    process.exit(1);
  }

  /* token → (shareType, shareId) 映射 */
  const shares = await db.query("SELECT id, token FROM jdywh_shares");
  const aiShares = await db.query("SELECT id, token FROM jdywh_ai_shares");
  const map = new Map();
  shares.forEach((r) => map.set('report:' + r.token, Number(r.id)));
  aiShares.forEach((r) => map.set('ai:' + r.token, Number(r.id)));
  console.log(`token 索引：report=${shares.length} ai=${aiShares.length}`);

  const since = Date.now() - days * 86400000;
  let total = 0; let matched = 0; let inserted = 0; let skipped = 0;
  const seen = new Set();

  const rl = readline.createInterface({ input: fs.createReadStream(logPath, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    total += 1;
    const rec = parseLine(line);
    if (!rec) continue;
    const ex = extractShare(rec.path);
    if (!ex) continue;
    matched += 1;
    const dt = parseNginxTime(rec.timeLocal);
    if (!dt || dt.getTime() < since) { skipped += 1; continue; }
    const shareId = map.get(ex.shareType + ':' + ex.token);
    if (!shareId) { skipped += 1; continue; }

    /* 幂等键：token + ip + 秒级时间 */
    const dedupKey = `${ex.shareType}|${ex.token}|${rec.ip}|${fmtSql(dt)}`;
    if (seen.has(dedupKey)) { skipped += 1; continue; }
    seen.add(dedupKey);

    /* 数据库层幂等：已存在同 token+ip+created_at 的 nginx 行则跳过 */
    const exists = await db.queryOne(
      `SELECT id FROM jdywh_share_visits
        WHERE source='nginx' AND token=? AND ip=? AND created_at=? LIMIT 1`,
      [ex.token, rec.ip, fmtSql(dt)],
    );
    if (exists) { skipped += 1; continue; }

    if (!dry) {
      const ua = String(rec.ua || '').slice(0, 512);
      const parsed = visits.parseUA(ua);
      await db.query(
        `INSERT INTO jdywh_share_visits
           (share_type, share_id, token, ip, user_agent, referer, path, bytes_sent,
            browser, os, device, province, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,'nginx',?)`,
        [ex.shareType, shareId, ex.token, rec.ip, ua, String(rec.referer || '').slice(0, 512),
          String(rec.path).slice(0, 255), rec.bytes, parsed.browser, parsed.os, parsed.device, fmtSql(dt)],
      );
    }
    inserted += 1;
  }

  console.log('── 回填结果 ──');
  console.log(`  日志总行数      : ${total}`);
  console.log(`  命中分享路径    : ${matched}`);
  console.log(`  ${dry ? '可回填(dry)' : '已写入'}       : ${inserted}`);
  console.log(`  跳过(过期/未知/重复/幂等): ${skipped}`);
  console.log(`  时间窗口        : 近 ${days} 天`);
  console.log(dry ? '（dry-run：未写库）' : '完成');
  await db.close();
  process.exit(0);
}

main().catch((e) => { console.error('回填失败：', e.message); process.exit(1); });
