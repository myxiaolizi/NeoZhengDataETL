'use strict';
/**
 * AI 问数 · SQL 示例库（V10 A2）
 *
 * 存「自然语言问题 → 参考 SQL」的配对，生成 SQL 时按相似度挑选 top N 注入 prompt，
 * 让模型模仿既有的正确写法（表名、字段、口径），显著提升首次生成准确率。
 */
const db = require('./db');

function s(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}

function toPublic(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    question: r.question || '',
    sql: r.sql_text || '',
    description: r.description || '',
    tags: r.tags || '',
    datasetId: Number(r.dataset_id) || 0,
    enabled: Number(r.enabled) === 1,
    useCount: Number(r.use_count) || 0,
    sortOrder: Number(r.sort_order) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function list(opts) {
  const o = opts || {};
  const where = [];
  const params = [];
  if (o.keyword) {
    where.push('(question LIKE ? OR sql_text LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const kw = `%${s(o.keyword, 64)}%`;
    params.push(kw, kw, kw, kw);
  }
  if (o.datasetId !== undefined && o.datasetId !== null && o.datasetId !== '') {
    where.push('dataset_id = ?');
    params.push(Number(o.datasetId) || 0);
  }
  const sql = `SELECT * FROM jdywh_ai_sql_examples
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sort_order ASC, id DESC LIMIT 500`;
  const rows = await db.query(sql, params);
  return rows.map(toPublic);
}

async function get(id) {
  const r = await db.queryOne('SELECT * FROM jdywh_ai_sql_examples WHERE id = ? LIMIT 1', [Number(id) || 0]);
  return toPublic(r);
}

async function create(body, userId) {
  const b = body || {};
  const question = s(b.question, 500);
  const sqlText = s(b.sql, 20000);
  if (!question) throw new Error('示例问题不能为空');
  if (!sqlText) throw new Error('参考 SQL 不能为空');
  const r = await db.query(
    `INSERT INTO jdywh_ai_sql_examples (question, sql_text, description, tags, dataset_id, enabled, sort_order, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [question, sqlText, s(b.description, 1000), s(b.tags, 255),
      Number(b.datasetId) || 0, b.enabled === false || b.enabled === 0 ? 0 : 1,
      Number(b.sortOrder) || 0, Number(userId) || 0],
  );
  const insertId = (r && r.insertId) || 0;
  if (insertId) return get(insertId);
  const last = await db.queryOne('SELECT * FROM jdywh_ai_sql_examples ORDER BY id DESC LIMIT 1');
  return toPublic(last);
}

async function update(id, body) {
  const b = body || {};
  const cur = await get(id);
  if (!cur) throw new Error('SQL 示例不存在');
  const question = b.question === undefined ? cur.question : s(b.question, 500);
  const sqlText = b.sql === undefined ? cur.sql : s(b.sql, 20000);
  if (!question) throw new Error('示例问题不能为空');
  if (!sqlText) throw new Error('参考 SQL 不能为空');
  await db.query(
    `UPDATE jdywh_ai_sql_examples SET question=?, sql_text=?, description=?, tags=?, dataset_id=?, enabled=?, sort_order=? WHERE id=?`,
    [question, sqlText,
      b.description === undefined ? cur.description : s(b.description, 1000),
      b.tags === undefined ? cur.tags : s(b.tags, 255),
      b.datasetId === undefined ? cur.datasetId : (Number(b.datasetId) || 0),
      b.enabled === undefined ? (cur.enabled ? 1 : 0) : (b.enabled ? 1 : 0),
      b.sortOrder === undefined ? cur.sortOrder : Number(b.sortOrder) || 0,
      Number(id)],
  );
  return get(id);
}

async function remove(id) {
  await db.query('DELETE FROM jdywh_ai_sql_examples WHERE id = ?', [Number(id) || 0]);
  return { ok: true };
}

/** 命中计数 +1（被注入 prompt 时调用） */
async function bumpUse(ids) {
  const list = (ids || []).map(Number).filter((x) => x > 0);
  if (!list.length) return;
  await db.query(
    `UPDATE jdywh_ai_sql_examples SET use_count = use_count + 1 WHERE id IN (${list.map(() => '?').join(',')})`,
    list,
  );
}

/**
 * 按「问题相似度」挑 top N 示例。
 * 轻量实现：字符二元组重合度 + 标签/关键词命中，不引入额外依赖。
 */
function similarity(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s2) => {
    const set = new Set();
    for (let i = 0; i < s2.length - 1; i += 1) set.add(s2.slice(i, i + 2));
    return set;
  };
  const gx = grams(x);
  const gy = grams(y);
  if (!gx.size || !gy.size) return 0;
  let hit = 0;
  gx.forEach((g) => { if (gy.has(g)) hit += 1; });
  // Dice 系数
  let score = (2 * hit) / (gx.size + gy.size);
  // 包含关系加成
  if (y.includes(x) || x.includes(y)) score += 0.25;
  return score;
}

/**
 * 为当前问题挑选最相关的示例
 * @param {string} question 用户问题
 * @param {Array<string>} tableHints 本次涉及的表名（用于优先选同表示例）
 * @param {number} topN 取几条
 */
async function pickForPrompt(question, tableHints, topN) {
  const n = Math.max(1, Math.min(Number(topN) || 3, 8));
  const rows = await list({});
  const enabled = rows.filter((r) => r.enabled);
  if (!enabled.length) return { items: [], block: '' };

  const hints = (tableHints || []).map((t) => String(t).toLowerCase());
  const scored = enabled.map((r) => {
    let score = similarity(question, r.question);
    // 标签命中
    const tags = String(r.tags || '').toLowerCase();
    if (tags) {
      tags.split(/[,，\s]+/).filter(Boolean).forEach((tg) => {
        if (String(question).toLowerCase().includes(tg)) score += 0.18;
      });
    }
    // 涉及同表加成
    const sqlLower = String(r.sql || '').toLowerCase();
    if (hints.some((h) => h && sqlLower.includes(h))) score += 0.30;
    // 轻微偏好常用示例
    score += Math.min(Number(r.useCount) || 0, 20) * 0.002;
    return { row: r, score };
  }).sort((a, b) => b.score - a.score);

  const picked = scored.filter((x) => x.score >= 0.12).slice(0, n);
  if (!picked.length) return { items: [], block: '' };

  const parts = picked.map((x, i) => [
    `### 示例 ${i + 1}${x.row.description ? `（${x.row.description}）` : ''}`,
    `问题：${x.row.question}`,
    '```sql',
    x.row.sql,
    '```',
  ].join('\n'));

  const block = `## 参考 SQL 示例（请模仿这些写法：表名、字段、口径、聚合方式）\n${parts.join('\n\n')}\n`;

  // 命中计数
  bumpUse(picked.map((x) => x.row.id)).catch(() => {});

  return { items: picked.map((x) => x.row), block };
}

module.exports = { list, get, create, update, remove, pickForPrompt, bumpUse, similarity, toPublic };
