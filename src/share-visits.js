'use strict';
/**
 * V16 · 分享访问埋点与统计（契约 §2，P0-1 方案 C）
 *
 * 职责：
 *   1. UA 解析（浏览器 / 操作系统 / 设备类型）—— **纯正则，禁止调用任何外部 API**
 *   2. 访问明细落库 `jdywh_share_visits`（**异步、不阻塞公开页响应**，30 秒同源去抖）
 *   3. 汇总统计（需求 10 项指标），beacon / nginx 两个来源**分开返回，不混算**
 *
 * 省份（根据IP）：实测全仓库无 geoip / ip2region / maxmind 依赖，
 * 因此本版 `province` 列恒为 NULL，接口返回 `provinceStatus: 'pending'`，
 * 前端必须显示「暂无数据（待接入省份库）」，**不得伪造**。
 */

const db = require('./db');

const TABLE = 'jdywh_share_visits';

/* ═══════════════════════════════════════════════════════════════
 * 一、UA 解析（纯正则，零依赖）
 * ═══════════════════════════════════════════════════════════════ */

/** bot / 爬虫优先判定：UA 命中其一即视为 bot，不再细分 */
const BOT_RE = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headlesschrome|phantomjs|python-requests|node-fetch|axios|go-http-client|okhttp|scrapy|curl|wget|postman|httpclient|java\//i;

/**
 * 解析 User-Agent。
 *
 * 判定顺序经过实测校准（顺序错会误判，例如 Edge/Opera 的 UA 里也含 "Chrome/"）：
 *   Edge → Opera → 微信 → QQ浏览器 → Chrome → Firefox → Safari
 *
 * @param {string} ua 原始 User-Agent
 * @returns {{browser: string, os: string, device: string}}
 */
function parseUA(ua) {
  const s = String(ua || '');
  if (!s.trim()) return { browser: '未知', os: '未知', device: '未知' };

  /* ── 设备类型 ── */
  let device = 'desktop';
  if (BOT_RE.test(s)) device = 'bot';
  else if (/iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) device = 'tablet';
  else if (/Mobile|iPhone|iPod|Android.*Mobile|Windows Phone|Mobi/i.test(s)) device = 'mobile';

  /* ── 操作系统 ── */
  let os = '其他';
  if (/Windows NT|Win64|WOW64/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Macintosh|Mac OS X/i.test(s)) os = 'macOS';
  else if (/CrOS/i.test(s)) os = 'ChromeOS';
  else if (/Linux|X11/i.test(s)) os = 'Linux';
  else if (/curl|wget|python-requests|axios|node-fetch|okhttp|go-http-client/i.test(s)) os = '其他';

  /* ── 浏览器（顺序敏感）── */
  let browser = '其他';
  if (/Edg(e|A|iOS)?\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/MicroMessenger/i.test(s)) browser = '微信';
  else if (/QQBrowser|MQQBrowser/i.test(s)) browser = 'QQ浏览器';
  else if (/UCBrowser/i.test(s)) browser = 'UC浏览器';
  else if (/Firefox\/|FxiOS/i.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';
  else if (/curl/i.test(s)) browser = 'curl';
  else if (/wget/i.test(s)) browser = 'wget';
  else if (/python-requests/i.test(s)) browser = 'python-requests';
  else if (/okhttp/i.test(s)) browser = 'okhttp';
  else if (/axios/i.test(s)) browser = 'axios';

  return { browser, os, device };
}

/* ═══════════════════════════════════════════════════════════════
 * 二、来源 IP 归一
 * ═══════════════════════════════════════════════════════════════ */

/**
 * 取访客真实 IP。
 *
 * `src/server.js` 已设置 `app.set('trust proxy', true)`，nginx 反代下
 * `req.ip` 即为 `X-Forwarded-For` 解析结果。实测生产 nginx 日志字段 1 为真实公网 IP，
 * 可直接用于 IP / UV / 省份统计。
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function clientIp(req) {
  let ip = String((req && req.ip) || '').trim();
  /* Express 在 trust proxy 下可能返回 "::ffff:1.2.3.4" */
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  /* XFF 兜底：取第一个非空段 */
  if (!ip) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) ip = xff;
  }
  return ip.slice(0, 64);
}

/* ═══════════════════════════════════════════════════════════════
 * 三、埋点写入（异步 + 去抖）
 * ═══════════════════════════════════════════════════════════════ */

/** 30 秒去抖：同一 token + IP + UA 的重复请求只记一条（防止 F5 刷爆 PV） */
const DEDUP_WINDOW_MS = 30 * 1000;
const dedup = new Map();

function dedupKey(shareType, token, ip, ua) {
  return `${shareType}|${token}|${ip}|${String(ua || '').slice(0, 120)}`;
}

function pruneDedup(now) {
  if (dedup.size < 2000) return;
  for (const [k, t] of dedup) {
    if (now - t > DEDUP_WINDOW_MS) dedup.delete(k);
  }
}

let tableReady = null;
/** 幂等建表：首次写入前确保表存在（bootstrap 也会建，这里是兜底） */
function ensureTable() {
  if (!tableReady) {
    tableReady = db.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      share_type VARCHAR(16) NOT NULL COMMENT 'report=报表/看板分享, ai=AI问数分享',
      share_id INT UNSIGNED NOT NULL,
      token VARCHAR(64) NOT NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(512) NULL,
      referer VARCHAR(512) NULL,
      path VARCHAR(255) NULL,
      bytes_sent INT UNSIGNED NOT NULL DEFAULT 0,
      browser VARCHAR(32) NULL,
      os VARCHAR(32) NULL,
      device VARCHAR(16) NULL,
      province VARCHAR(32) NULL COMMENT '省份，无离线IP库时恒 NULL',
      source VARCHAR(16) NOT NULL DEFAULT 'beacon',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_share (share_type, share_id, created_at),
      KEY idx_token (token, created_at),
      KEY idx_created (created_at),
      KEY idx_source (source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
      .catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

/**
 * 记录一次分享访问。**绝不阻塞调用方**：内部 setImmediate，任何失败只 warn。
 *
 * @param {Object} opt
 * @param {'report'|'ai'} opt.shareType
 * @param {number} opt.shareId
 * @param {string} opt.token
 * @param {import('express').Request} opt.req
 * @param {string} [opt.path] 访问路径
 */
function record(req, shareType, shareId, token, pathOverride) {
  try {
    const now = Date.now();
    const ip = clientIp(req);
    const ua = String((req && req.headers && req.headers['user-agent']) || '').slice(0, 512);
    const key = dedupKey(shareType, token, ip, ua);
    const last = dedup.get(key);
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) return;

    pruneDedup(now);
    dedup.set(key, now);

    const sid = Number(shareId) || 0;
    if (!sid || !token) return;

    const parsed = parseUA(ua);
    const referer = String((req && req.headers && req.headers.referer) || '').slice(0, 512);
    const path = String(pathOverride || (req && req.originalUrl) || '').slice(0, 255);

    setImmediate(() => {
      ensureTable()
        .then(() => db.query(
          `INSERT INTO ${TABLE}
             (share_type, share_id, token, ip, user_agent, referer, path, bytes_sent,
              browser, os, device, province, source)
           VALUES (?,?,?,?,?,?,?,0,?,?,?,NULL,'beacon')`,
          [shareType, sid, token, ip, ua, referer, path, parsed.browser, parsed.os, parsed.device],
        ))
        .catch((e) => console.warn('[share-visit] 埋点写入失败:', e.message));
    });
  } catch (e) {
    console.warn('[share-visit] 埋点异常:', e.message);
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 四、统计查询（需求 10 项指标）
 * ═══════════════════════════════════════════════════════════════ */

function countBy(rows, key, limit) {
  const m = new Map();
  rows.forEach((r) => {
    const k = r[key] || '未知';
    m.set(k, (m.get(k) || 0) + 1);
  });
  const arr = [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  return limit ? arr.slice(0, limit) : arr;
}

/**
 * 单来源聚合。**beacon 与 nginx 必须分开算，不得相加成一个数字**（契约 §2.5）。
 */
function aggregate(rows) {
  const ips = new Set();
  let pv = 0;
  let traffic = 0;
  rows.forEach((r) => {
    if (r.ip) ips.add(r.ip);
    pv += 1;
    traffic += Number(r.bytes_sent) || 0;
  });
  return {
    /** 流量：响应体字节数合计（beacon 源恒为 0，未知） */
    traffic,
    /** 请求数：明细行数 */
    requests: rows.length,
    /** IP：去重 IP 数（与 UV 同口径，逐字保留需求命名） */
    ips: ips.size,
    /** UV：去重访客数 */
    uv: ips.size,
    /** PV：访问次数 */
    pv,
    browsers: countBy(rows, 'browser'),
    oses: countBy(rows, 'os'),
    devices: countBy(rows, 'device'),
    visitorIps: countBy(rows, 'ip', 50),
    provinces: countBy(rows, 'province'),
  };
}

/**
 * 分享统计：10 项指标汇总 + 明细。
 *
 * @param {'report'|'ai'} shareType
 * @param {number} shareId
 * @param {Object} [opt] { days = 30, limit = 200 }
 */
async function stats(shareType, shareId, opt) {
  const o = opt || {};
  const days = Math.min(Math.max(Number(o.days) || 30, 1), 365);
  const limit = Math.min(Math.max(Number(o.limit) || 200, 1), 1000);
  const sid = Number(shareId) || 0;

  await ensureTable();
  const all = await db.query(
    `SELECT id, share_type, share_id, token, ip, user_agent, referer, path, bytes_sent,
            browser, os, device, province, source, created_at
       FROM ${TABLE}
      WHERE share_type = ? AND share_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY id DESC`,
    [shareType, sid, days],
  );

  const beacon = all.filter((r) => r.source !== 'nginx');
  const nginx = all.filter((r) => r.source === 'nginx');

  const b = aggregate(beacon);
  const n = aggregate(nginx);

  /* 省份：已知 IP 库里无数据 → pending；有行但全 NULL → 同样 pending */
  const provinceKnown = all.some((r) => r.province);
  const provinceStatus = provinceKnown ? 'ok' : 'pending';

  return {
    shareType,
    shareId: sid,
    days,
    /** 汇总口径：以「应用埋点(beacon)」为主口径；回填历史单独给 bySource.nginx */
    summary: {
      traffic: b.traffic,
      requests: b.requests,
      ips: b.ips,
      uv: b.uv,
      pv: b.pv,
      browsers: b.browsers,
      oses: b.oses,
      devices: b.devices,
      visitorIps: b.visitorIps,
      provinces: b.provinces,
      provinceStatus,
      provinceNote: '暂无数据（待接入省份库）',
      /** 标注统计起点，避免把「埋点上线前」当成 0 访问 */
      statsSince: 'beacon 埋点上线时刻（V16 部署时）起，此前历史不可追溯；历史回填见 bySource.nginx',
    },
    /** 两个来源分开，**不得混算** */
    bySource: {
      beacon: { ...b, label: '应用埋点（V16 上线起）' },
      nginx: { ...n, label: 'nginx 日志回填（仅覆盖日志保留窗口）' },
    },
    rows: all.slice(0, limit).map((r) => ({
      id: Number(r.id),
      createdAt: r.created_at,
      ip: r.ip || '',
      browser: r.browser || '',
      os: r.os || '',
      device: r.device || '',
      province: r.province || null,
      referer: r.referer || '',
      path: r.path || '',
      source: r.source,
      userAgent: r.user_agent || '',
    })),
    rowCount: all.length,
  };
}

module.exports = {
  TABLE,
  parseUA,
  clientIp,
  record,
  stats,
  aggregate,
  ensureTable,
  DEDUP_WINDOW_MS,
};
