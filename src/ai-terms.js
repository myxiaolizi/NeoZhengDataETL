'use strict';
/**
 * AI 问数 · 业务术语配置（V10 A1）
 *
 * 术语用于把用户的业务口语映射到数据库字段/取值，注入 SQL 生成的 system prompt。
 *   例：term=南区，definition=region 字段为「南区」的连锁，aliases=南边,南方
 */
const db = require('./db');

const MAX_TERM = 191;
const MAX_DEF = 1000;
const MAX_ALIAS = 500;

function s(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}

function toPublic(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    term: r.term || '',
    definition: r.definition || '',
    aliases: r.aliases || '',
    category: r.category || '',
    enabled: Number(r.enabled) === 1,
    sortOrder: Number(r.sort_order) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 列表（可按关键词/分类/启用状态过滤） */
async function list(opts) {
  const o = opts || {};
  const where = [];
  const params = [];
  if (o.keyword) {
    where.push('(term LIKE ? OR definition LIKE ? OR aliases LIKE ?)');
    const kw = `%${s(o.keyword, 64)}%`;
    params.push(kw, kw, kw);
  }
  if (o.category) { where.push('category = ?'); params.push(s(o.category, 64)); }
  if (o.enabled !== undefined && o.enabled !== null && o.enabled !== '') {
    where.push('enabled = ?');
    params.push(o.enabled ? 1 : 0);
  }
  const sql = `SELECT * FROM jdywh_ai_terms ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sort_order ASC, id DESC LIMIT 500`;
  const rows = await db.query(sql, params);
  return rows.map(toPublic);
}

async function get(id) {
  const rows = await db.query('SELECT * FROM jdywh_ai_terms WHERE id = ? LIMIT 1', [Number(id) || 0]);
  return toPublic(rows[0]);
}

async function create(body, userId) {
  const b = body || {};
  const term = s(b.term, MAX_TERM);
  const definition = s(b.definition, MAX_DEF);
  if (!term) throw new Error('术语名不能为空');
  if (!definition) throw new Error('术语定义不能为空');
  const r = await db.query(
    `INSERT INTO jdywh_ai_terms (term, definition, aliases, category, enabled, sort_order, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [term, definition, s(b.aliases, MAX_ALIAS), s(b.category, 64),
      b.enabled === false || b.enabled === 0 ? 0 : 1, Number(b.sortOrder) || 0, Number(userId) || 0],
  );
  // db.query 返回 rows；INSERT 返回 ResultSetHeader，insertId 在对象上
  const insertId = (r && r.insertId) || (r && r[0] && r[0].insertId) || 0;
  if (insertId) return get(insertId);
  // 兜底：取回刚插入的最新一条
  const last = await db.queryOne('SELECT * FROM jdywh_ai_terms ORDER BY id DESC LIMIT 1');
  return toPublic(last);
}

async function update(id, body) {
  const b = body || {};
  const cur = await get(id);
  if (!cur) throw new Error('术语不存在');
  const term = b.term === undefined ? cur.term : s(b.term, MAX_TERM);
  const definition = b.definition === undefined ? cur.definition : s(b.definition, MAX_DEF);
  if (!term) throw new Error('术语名不能为空');
  if (!definition) throw new Error('术语定义不能为空');
  await db.query(
    `UPDATE jdywh_ai_terms SET term=?, definition=?, aliases=?, category=?, enabled=?, sort_order=? WHERE id=?`,
    [term, definition,
      b.aliases === undefined ? cur.aliases : s(b.aliases, MAX_ALIAS),
      b.category === undefined ? cur.category : s(b.category, 64),
      b.enabled === undefined ? (cur.enabled ? 1 : 0) : (b.enabled ? 1 : 0),
      b.sortOrder === undefined ? cur.sortOrder : Number(b.sortOrder) || 0,
      Number(id)],
  );
  return get(id);
}

async function remove(id) {
  await db.query('DELETE FROM jdywh_ai_terms WHERE id = ?', [Number(id) || 0]);
  return { ok: true };
}

/**
 * 拼成注入 prompt 的文本块。
 * 只取启用的术语，按 category 分组，控制总长度避免挤爆上下文。
 */
async function promptBlock(maxChars) {
  const limit = Number(maxChars) || 3000;
  const rows = await list({ enabled: 1 });
  if (!rows.length) return '';
  const lines = [];
  let used = 0;
  for (const r of rows) {
    const alias = r.aliases ? `（又称：${r.aliases}）` : '';
    const line = `- ${r.term}${alias}：${r.definition}`;
    if (used + line.length > limit) break;
    lines.push(line);
    used += line.length;
  }
  return lines.length ? `## 业务术语（用户可能用这些说法，务必按此理解）\n${lines.join('\n')}\n` : '';
}

module.exports = { list, get, create, update, remove, promptBlock, toPublic };
