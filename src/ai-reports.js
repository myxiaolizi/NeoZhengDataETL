'use strict';
/**
 * V16 · AI 报表（受限 DSL 配置驱动）—— 契约 §4.3 / §4.4
 *
 * ══════════════════════════════════════════════════════════════
 * 安全红线（P0-2 用户答复，不得违反）
 * ══════════════════════════════════════════════════════════════
 *   ✗ 绝不 eval / new Function / vm.runInContext / require 执行 AI 或用户产出的任意代码
 *   ✓ AI 只产出**受限 DSL（JSON 配置）**，经服务端 schema 校验 + 字段白名单后入库
 *   ✓ 「查看代码 / 修改代码」= 查看与编辑该报表的 DSL JSON（带校验与预览）
 *
 * AI 报表 = 白名单组件 + 白名单数据源 + 白名单字段 的**声明式配置**，
 * 前端按 `blocks[].type` 渲染既有看板组件，不做任何动态脚本执行。
 */

const db = require('./db');
const ai = require('./ai');

const TABLE = 'jdywh_reports';
const DSL_SPEC = 'jdy-bi-dsl/1';
const MAX_BLOCKS = 32;

/** 区块类型白名单 */
const BLOCK_TYPES = ['kpi', 'table', 'chart', 'flow', 'ranking', 'summary'];
/** 图表类型白名单 */
const CHART_TYPES = ['bar', 'line', 'pie', 'area'];
/** 主题白名单 */
const THEMES = ['light', 'dark'];
/** 内置看板路由白名单 */
const ROUTES = ['/dashboard/board', '/dashboard/crm'];

/**
 * 数据源白名单 → 每个数据源允许的字段。
 * `report:<id>` 形式指向 BI 报表，字段由该报表列定义，不做字段白名单限制。
 */
const SOURCES = {
  'board.erp': ['name', 'clients', 'withCoupon', 'withoutCoupon', 'ratio'],
  'board.flow': ['node', 'count', 'avgDuration', 'clients', 'status'],
  'board.chain': ['chainId', 'chainName', 'chainType', 'region', 'reachedPeople', 'arrivedPeople',
    'reachRate', 'gmv', 'couponGmv', 'couponCost', 'channelCost', 'roi', 'runningStrategies'],
  'board.run': ['model', 'type', 'reachedPeople', 'arrivedPeople', 'reachRate', 'gmv', 'roi',
    'channelCost', 'couponCost', 'totalCost', 'couponGmv'],
  'board.sign': ['region', 'signType', 'totalClients', 'totalStores', 'achieved', 'target', 'rate'],
};

/** 顶层允许的键（多余键一律拒绝，防止夹带任意语义） */
const TOP_KEYS = ['spec', 'title', 'theme', 'route', 'blocks', 'description', 'icon', 'tags', 'group'];
/** block 允许的键 */
const BLOCK_KEYS = ['type', 'title', 'source', 'fields', 'options'];
/** options 允许的键 */
const OPT_KEYS = ['limit', 'chartType', 'showLegend'];

/** 明确禁止出现在配置里的代码执行关键字（纵深防御：即使不是字符串执行也拒绝，避免误导后续实现者） */
const FORBIDDEN = ['eval', 'new Function', 'require(', 'import(', 'process.', '<script', '__proto__', 'constructor'];

/* ═══════════════════════════════════════════════════════════════
 * DSL 校验
 * ═══════════════════════════════════════════════════════════════ */

class DslError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DslError';
    this.status = 400;
  }
}

/** 递归扫描字符串值中的禁止关键字 */
function scanForbidden(v, pathStr) {
  if (typeof v === 'string') {
    for (const f of FORBIDDEN) {
      if (v.includes(f)) {
        throw new DslError(`DSL 含被禁止的代码执行关键字：${f}（位置 ${pathStr}）`);
      }
    }
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => scanForbidden(x, `${pathStr}[${i}]`));
    return;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) scanForbidden(x, `${pathStr}.${k}`);
  }
}

/**
 * 校验并归一化 DSL。**只做校验与清洗，绝不执行任何内容。**
 *
 * @param {string|Object} input DSL 原文（JSON 字符串）或对象
 * @returns {Object} 归一化后的 DSL（仅白名单键）
 * @throws {DslError} 校验失败，message 为中文可读文案
 */
function validate(input) {
  let dsl = input;
  if (typeof dsl === 'string') {
    const txt = dsl.trim();
    if (!txt) throw new DslError('DSL 配置不能为空');
    try {
      dsl = JSON.parse(txt);
    } catch (e) {
      throw new DslError(`DSL 配置必须是合法的 JSON：${e.message}`);
    }
  }
  if (!dsl || typeof dsl !== 'object' || Array.isArray(dsl)) {
    throw new DslError('DSL 配置必须是合法的 JSON 对象');
  }

  /* 0. 全局禁止关键字 */
  scanForbidden(dsl, '$');

  /* 1. 顶层键白名单 */
  const unknownKeys = Object.keys(dsl).filter((k) => !TOP_KEYS.includes(k));
  if (unknownKeys.length) {
    throw new DslError(`DSL 含未允许的字段：${unknownKeys.join(', ')}（允许 ${TOP_KEYS.join('/')}）`);
  }

  /* 2. spec 版本 */
  if (dsl.spec !== DSL_SPEC) {
    throw new DslError(`DSL 版本标识 spec 必须为 ${DSL_SPEC}`);
  }

  const out = { spec: DSL_SPEC };

  /* 3. 标量字段 */
  if (dsl.title !== undefined) {
    if (typeof dsl.title !== 'string') throw new DslError('title 必须是字符串');
    if (dsl.title.length > 64) throw new DslError('title 长度不能超过 64 个字符');
    out.title = dsl.title;
  }
  if (dsl.description !== undefined) {
    if (typeof dsl.description !== 'string') throw new DslError('description 必须是字符串');
    if (dsl.description.length > 500) throw new DslError('description 长度不能超过 500 个字符');
    out.description = dsl.description;
  }
  if (dsl.icon !== undefined) {
    if (typeof dsl.icon !== 'string' || dsl.icon.length > 64) throw new DslError('icon 必须是 ≤64 字符的字符串');
    out.icon = dsl.icon;
  }
  if (dsl.tags !== undefined) {
    if (typeof dsl.tags !== 'string' || dsl.tags.length > 255) throw new DslError('tags 必须是 ≤255 字符的字符串');
    out.tags = dsl.tags;
  }
  if (dsl.group !== undefined) {
    if (typeof dsl.group !== 'string' || dsl.group.length > 64) throw new DslError('group 必须是 ≤64 字符的字符串');
    out.group = dsl.group;
  }
  if (dsl.theme !== undefined) {
    if (!THEMES.includes(dsl.theme)) throw new DslError(`theme 不在白名单：${dsl.theme}（允许 ${THEMES.join('/')}）`);
    out.theme = dsl.theme;
  }
  if (dsl.route !== undefined) {
    if (!ROUTES.includes(dsl.route)) throw new DslError(`route 不在白名单：${dsl.route}（允许 ${ROUTES.join(' / ')}）`);
    out.route = dsl.route;
  }

  /* 4. blocks */
  if (dsl.blocks === undefined) throw new DslError('DSL 缺少 blocks 区块数组');
  if (!Array.isArray(dsl.blocks)) throw new DslError('blocks 必须是数组');
  if (dsl.blocks.length > MAX_BLOCKS) throw new DslError(`区块数量超过上限 ${MAX_BLOCKS}`);

  out.blocks = dsl.blocks.map((blk, i) => {
    const at = `blocks[${i}]`;
    if (!blk || typeof blk !== 'object' || Array.isArray(blk)) throw new DslError(`${at} 必须是对象`);

    const extra = Object.keys(blk).filter((k) => !BLOCK_KEYS.includes(k));
    if (extra.length) throw new DslError(`${at} 含未允许的字段：${extra.join(', ')}（允许 ${BLOCK_KEYS.join('/')}）`);

    /* type */
    if (!BLOCK_TYPES.includes(blk.type)) {
      throw new DslError(`区块类型不在白名单：${blk.type}（允许 ${BLOCK_TYPES.join('/')}）`);
    }

    /* title */
    if (blk.title !== undefined && (typeof blk.title !== 'string' || blk.title.length > 64)) {
      throw new DslError(`${at}.title 必须是 ≤64 字符的字符串`);
    }

    /* source */
    const src = String(blk.source || '');
    let sourceOk = false;
    let allowFields = null;
    if (SOURCES[src]) {
      sourceOk = true;
      allowFields = SOURCES[src];
    } else if (/^report:\d+$/.test(src)) {
      sourceOk = true;
      allowFields = null;
    }
    if (!sourceOk) {
      throw new DslError(`${at}.source 不在白名单：${src || '(空)'}（允许 ${Object.keys(SOURCES).join('/')} 或 report:<id>）`);
    }

    /* fields */
    let fields;
    if (blk.fields !== undefined) {
      if (!Array.isArray(blk.fields)) throw new DslError(`${at}.fields 必须是数组`);
      if (blk.fields.length > 40) throw new DslError(`${at}.fields 超过 40 个字段`);
      fields = blk.fields.map((f) => {
        if (typeof f !== 'string') throw new DslError(`${at}.fields 只能是字符串`);
        if (allowFields && !allowFields.includes(f)) {
          throw new DslError(`字段不在白名单：${f}（数据源 ${src} 允许 ${allowFields.join('/')}）`);
        }
        return f;
      });
    }

    /* options */
    let options;
    if (blk.options !== undefined) {
      if (!blk.options || typeof blk.options !== 'object' || Array.isArray(blk.options)) {
        throw new DslError(`${at}.options 必须是对象`);
      }
      const oe = Object.keys(blk.options).filter((k) => !OPT_KEYS.includes(k));
      if (oe.length) throw new DslError(`${at}.options 含未允许的字段：${oe.join(', ')}（允许 ${OPT_KEYS.join('/')}）`);
      options = {};
      if (blk.options.limit !== undefined) {
        const l = Number(blk.options.limit);
        if (!Number.isInteger(l) || l < 1 || l > 1000) throw new DslError(`${at}.options.limit 必须是 1~1000 的整数`);
        options.limit = l;
      }
      if (blk.options.chartType !== undefined) {
        if (!CHART_TYPES.includes(blk.options.chartType)) {
          throw new DslError(`${at}.options.chartType 不在白名单：${blk.options.chartType}（允许 ${CHART_TYPES.join('/')}）`);
        }
        options.chartType = blk.options.chartType;
      }
      if (blk.options.showLegend !== undefined) {
        if (typeof blk.options.showLegend !== 'boolean') throw new DslError(`${at}.options.showLegend 必须是布尔值`);
        options.showLegend = blk.options.showLegend;
      }
    }

    const item = { type: blk.type, source: src };
    if (blk.title !== undefined) item.title = blk.title;
    if (fields) item.fields = fields;
    if (options) item.options = options;
    return item;
  });

  return out;
}

/** 序列化前统一：稳定字段顺序，便于「查看代码」逐字比对 */
function stringify(dsl) {
  const ordered = {};
  for (const k of TOP_KEYS) if (dsl[k] !== undefined) ordered[k] = dsl[k];
  return JSON.stringify(ordered, null, 2);
}

/* ═══════════════════════════════════════════════════════════════
 * 校验 report:<id> 引用的报表真实存在
 * ═══════════════════════════════════════════════════════════════ */

async function assertReportRefs(dsl) {
  const ids = (dsl.blocks || [])
    .map((b) => (b.source || '').match(/^report:(\d+)$/))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  if (!ids.length) return;
  const uniq = [...new Set(ids)];
  const rows = await db.query(
    `SELECT id FROM ${TABLE} WHERE id IN (${uniq.map(() => '?').join(',')})`,
    uniq,
  );
  const found = new Set(rows.map((r) => Number(r.id)));
  const missing = uniq.filter((id) => !found.has(id));
  if (missing.length) throw new DslError(`数据源报表不存在：${missing.join(', ')}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 报表读写
 * ═══════════════════════════════════════════════════════════════ */

function publicAiReport(r) {
  return {
    id: Number(r.id),
    name: r.name || '',
    code: r.code || '',
    title: r.title || r.name || '',
    description: r.description || '',
    category: r.category || '',
    reportType: r.report_type,
    icon: r.icon || '',
    tags: r.tags || '',
    group: r.group_name || '',
    source: r.source || 'user',
    boardKey: r.board_key || null,
    dsl: r.dsl || '',
    status: Number(r.status) || 0,
    viewCount: Number(r.view_count) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function list(opt) {
  const o = opt || {};
  const where = ["report_type = 'ai'"];
  const params = [];
  if (o.source) { where.push('source = ?'); params.push(String(o.source)); }
  if (o.group) { where.push('group_name = ?'); params.push(String(o.group)); }
  if (o.search) {
    where.push('(name LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const kw = `%${o.search}%`;
    params.push(kw, kw, kw);
  }
  const rows = await db.query(
    `SELECT * FROM ${TABLE} WHERE ${where.join(' AND ')} ORDER BY id ASC`,
    params,
  );
  return rows.map(publicAiReport);
}

async function get(id) {
  const row = await db.queryOne(`SELECT * FROM ${TABLE} WHERE id = ? AND report_type = 'ai' LIMIT 1`, [Number(id)]);
  if (!row) return null;
  return publicAiReport(row);
}

async function create(body, userId) {
  const b = body || {};
  const name = String(b.name || '').trim();
  if (!name) throw new DslError('报表名称不能为空');
  if (name.length > 191) throw new DslError('报表名称长度不能超过 191 个字符');

  const dslObj = validate(b.dsl !== undefined ? b.dsl : { spec: DSL_SPEC, blocks: [] });
  await assertReportRefs(dslObj);
  const dslText = stringify(dslObj);

  const code = String(b.code || '').trim() || ('ai_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));

  const res = await db.query(
    `INSERT INTO ${TABLE}
       (name, code, description, category, report_type, icon, tags, group_name, source, board_key, dsl, status, created_by)
     VALUES (?,?,?,?, 'ai', ?,?,?,?,?,?, 1, ?)`,
    [
      name,
      code,
      String(b.description || '').slice(0, 500),
      String(b.category || 'AI').slice(0, 64),
      String(b.icon || '').slice(0, 64),
      String(b.tags || '').slice(0, 255),
      String(b.group || '').slice(0, 64),
      b.source === 'builtin' ? 'builtin' : 'user',
      b.boardKey ? String(b.boardKey).slice(0, 32) : null,
      dslText,
      userId || null,
    ],
  );
  const id = res.insertId || (res[0] && res[0].insertId);
  return get(id);
}

async function update(id, body) {
  const n = Number(id) || 0;
  const cur = await db.queryOne(`SELECT * FROM ${TABLE} WHERE id = ? AND report_type = 'ai' LIMIT 1`, [n]);
  if (!cur) throw new DslError('AI 报表不存在');

  const b = body || {};
  const sets = [];
  const params = [];

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) throw new DslError('报表名称不能为空');
    if (name.length > 191) throw new DslError('报表名称长度不能超过 191 个字符');
    sets.push('name = ?'); params.push(name);
  }
  if (b.description !== undefined) { sets.push('description = ?'); params.push(String(b.description).slice(0, 500)); }
  if (b.icon !== undefined) { sets.push('icon = ?'); params.push(String(b.icon).slice(0, 64)); }
  if (b.tags !== undefined) { sets.push('tags = ?'); params.push(String(b.tags).slice(0, 255)); }
  if (b.group !== undefined) { sets.push('group_name = ?'); params.push(String(b.group).slice(0, 64)); }
  if (b.category !== undefined) { sets.push('category = ?'); params.push(String(b.category).slice(0, 64)); }
  if (b.status !== undefined) { sets.push('status = ?'); params.push(Number(b.status) ? 1 : 0); }

  if (b.dsl !== undefined) {
    const dslObj = validate(b.dsl);
    await assertReportRefs(dslObj);
    sets.push('dsl = ?'); params.push(stringify(dslObj));
    /* DSL 里的 title/description 同步到报表元信息（便于列表展示） */
    if (b.title === undefined && dslObj.title) { sets.push('name = ?'); params.push(dslObj.title); }
  }

  if (!sets.length) return get(n);

  params.push(n);
  await db.query(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`, params);
  return get(n);
}

/**
 * 复制。`source` 置 `user`（副本是用户资产，可删除），名称自动加「副本」。
 */
async function copy(id, userId) {
  const n = Number(id) || 0;
  const cur = await db.queryOne(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [n]);
  if (!cur) throw new DslError('报表不存在');

  let name = `${cur.name}（副本）`;
  /* 幂等友好：重名自动追加序号 */
  const dup = await db.queryOne(
    `SELECT COUNT(*) AS c FROM ${TABLE} WHERE name = ?`, [name],
  );
  if (dup && Number(dup.c) > 0) name = `${cur.name}（副本${Number(dup.c) + 1}）`;

  const code = (cur.code || 'report') + '_copy' + Date.now().toString(36);
  const res = await db.query(
    `INSERT INTO ${TABLE}
       (name, code, description, category, report_type, icon, tags, group_name, source, board_key, dsl, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`,
    [
      name, code, cur.description || '', cur.category || '',
      cur.report_type || 'ai', cur.icon || '', cur.tags || '', cur.group_name || '',
      'user', null, cur.dsl || '', userId || null,
    ],
  );
  const newId = res.insertId || (res[0] && res[0].insertId);
  const row = await db.queryOne(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [newId]);
  return row ? publicAiReport(row) : null;
}

/**
 * 删除。P0-3 决策：`source='builtin'` 的内置看板 AI 报表**只可停用，不可删除**。
 */
async function remove(id) {
  const n = Number(id) || 0;
  const cur = await db.queryOne(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [n]);
  if (!cur) throw new DslError('报表不存在');
  if (cur.report_type === 'ai' && cur.source === 'builtin') {
    const e = new DslError('内置看板来源的 AI 报表不允许删除，只能停用');
    e.status = 403;
    throw e;
  }
  await db.query(`DELETE FROM ${TABLE} WHERE id = ?`, [n]);
  return { deleted: 1, id: n };
}

/* ═══════════════════════════════════════════════════════════════
 * AI 草稿（只产出 DSL JSON，绝不执行）
 * ═══════════════════════════════════════════════════════════════ */

/** 从任意文本里提取第一个 JSON 对象（AI 常带 ```json 围栏或解释文字） */
function extractJson(text) {
  const t = String(text || '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : t;
  const start = body.indexOf('{');
  if (start < 0) return null;
  /* 括号配对（忽略字符串内的花括号） */
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, i + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

/**
 * 用 `src\ai.js` 的问数能力产出 DSL 草稿。
 *
 * 铁律：AI 的输出**只当作 JSON 解析**，绝不作为代码执行；
 * 解析失败或结构非法 → 抛可读中文错误（不是 500）。
 */
async function aiDraft(prompt, user) {
  const p = String(prompt || '').trim();
  if (!p) throw new DslError('请描述你想要的新 AI 报表');

  const guide = [
    '你是 BI 报表配置生成器。你只能输出一个 JSON 对象，不要输出任何解释文字、不要输出 SQL 之外的代码。',
    `JSON 必须严格符合：{"spec":"${DSL_SPEC}","title":"≤64字","theme":"light|dark",`
      + '"blocks":[{"type":"kpi|table|chart|flow|ranking|summary","title":"≤64字",'
      + '"source":"board.erp|board.flow|board.chain|board.run|board.sign",'
      + '"fields":["白名单字段"],"options":{"limit":100,"chartType":"bar|line|pie|area","showLegend":true}}]}',
    `以下是各数据源允许的字段（fields 只能从中选）：${JSON.stringify(SOURCES)}`,
    '不允出现任何可执行代码（如 eval、new Function、require、import、process）。',
  ].join('\n');

  let raw = '';
  try {
    /* ai.ask(question, options)：把 DSL 规范作为附加约束拼进问题，不改 ai.js */
    const r = await ai.ask(`${guide}\n\n用户需求：${p}`, {
      userId: user && user.id,
      limit: 20,
    });
    raw = (r && (r.answer || r.text || r.content)) || '';
  } catch (e) {
    throw new DslError(`AI 生成失败：${e.message}`);
  }

  const obj = extractJson(raw);
  if (!obj) {
    throw new DslError('AI 未返回可解析的 JSON 配置，请调整描述后重试（原始输出片段：'
      + String(raw).slice(0, 120).replace(/\s+/g, ' ') + '）');
  }

  let dsl;
  try {
    dsl = validate(obj);
  } catch (e) {
    throw new DslError(`AI 返回的 DSL 未通过校验：${e.message}`);
  }
  await assertReportRefs(dsl);

  return { dsl: stringify(dsl), parsed: dsl, raw: String(raw).slice(0, 4000) };
}

module.exports = {
  TABLE,
  DSL_SPEC,
  BLOCK_TYPES,
  CHART_TYPES,
  THEMES,
  ROUTES,
  SOURCES,
  MAX_BLOCKS,
  FORBIDDEN,
  DslError,
  validate,
  stringify,
  extractJson,
  list,
  get,
  create,
  update,
  copy,
  remove,
  aiDraft,
  publicAiReport,
};
