'use strict';

/**
 * 数据明细多条件筛选（V6.1 要求 9）—— 两处数据明细端点的**唯一实现**
 *
 * 为什么要有这个文件
 * ------------------
 * 需求原文：「邮箱推送和数据项目的数据明细，格式和功能要一致」。
 * 「格式一致」由前端共用 `@/components/DataTable` 保证；
 * 「功能一致」必须由后端共用**同一段 SQL 生成逻辑**保证 ——
 * 两处各写一套迟早会漂移（一个 LIKE 一个 =、一个丢 NULL 一个不丢）。
 *
 * 因此这里提供唯一入口 `appendFilters()`，被以下端点共同调用：
 *   A. GET /api/projects/:id/parsed            （数据项目 · 数据明细）
 *   B. GET /api/mail-push/projects/:id/rows    （邮箱推送 · 数据明细，经 mail-push.queryRows）
 *   C. GET /api/projects/:id/records           （数据项目 · 原始数据，顺带同构）
 *
 * 入参格式（前端 `filtersToQuery()` 生成，契约 §6.1）
 * ------------------------------------------------
 *   [{"column":"x","op":"contains","value":"abc"},{"column":"y","op":"empty"}]
 *
 * op 语义与 SQL
 * -------------
 *   contains → `col` LIKE ?                 值 %v%
 *   eq       → `col` = ?                    值 v
 *   ne       → (`col` <> ? OR `col` IS NULL) 值 v     ← NULL 也算「不等于」
 *   empty    → (`col` IS NULL OR `col` = '')
 *   notempty → (`col` IS NOT NULL AND `col` <> '')
 *
 * 安全约束（全部强制）
 * --------------------
 *  1. `column` 必须命中**真实物理列白名单**（调用方传入 information_schema 查到的列名），
 *     不在白名单内 → 该条件直接丢弃，绝不进 SQL；
 *  2. 列名一律经 `quoteIdent()` 反引号包裹；
 *  3. **所有值走占位符绑定**，不做任何字符串拼接 —— 单引号 / 百分号 / 反斜杠 / `--`
 *     全部作为字面量处理，无法注入；
 *  4. 最多接受 `MAX_FILTERS`（20）个条件，超出截断；
 *  5. JSON 非法 / 非数组 / 数组元素不合法 → 静默忽略（不 400），
 *     保证两处端点行为完全一致，前端不会因为一个脏条件整页报错。
 *
 * 与 keyword 的关系：`appendFilters()` 只往调用方的 where 数组里追加条件，
 * 因此 filters 与 keyword 天然是 AND 关系（契约 §6.1 第 4 条）。
 */

const { quoteIdent: defaultQuoteIdent } = require('./ident');

/** 最多接受的筛选条件数（契约 §6.1 第 6 条） */
const MAX_FILTERS = 20;

/** 全部合法操作符 */
const OPS = ['contains', 'eq', 'ne', 'empty', 'notempty'];

const OP_SET = new Set(OPS);

/** 无需 value 的操作符 */
const VALUELESS_OPS = new Set(['empty', 'notempty']);

/** parseFilters() 的 error 取值（两端一致，便于排查） */
const ERRORS = {
  INVALID_JSON: 'invalid_json',
  NON_ARRAY: 'non_array',
};

/* ------------------------------------------------------------------ *
 * 入参归一
 * ------------------------------------------------------------------ */

/**
 * 把 req.query.filters 归一成一个待 JSON.parse 的字符串。
 *
 * 需要处理的现实情况：
 *  - undefined / null / ''      → 不筛选；
 *  - string                     → 正常路径（前端 qs 序列化）；
 *  - string[]                   → express 对**同名 query 参数重复**时会转成数组
 *                                 （如 ?filters=a&filters=b），取最后一个，与 express 自身语义一致；
 *  - object                     → 形如 ?filters[0][column]=x 会被 qs 解析成对象，
 *                                 先 stringify 再交给解析，最终按「非数组」忽略。
 *
 * @param {*} raw
 * @returns {string} 空串表示不筛选
 */
function normalizeRaw(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    const last = raw.length ? raw[raw.length - 1] : '';
    return last === undefined || last === null ? '' : String(last).trim();
  }
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw).trim();
}

/**
 * 归一单个筛选条件；不合法返回 null（调用方计入 dropped）。
 *
 * @param {*} item
 * @returns {{column:string, op:string, value:*}|null}
 */
function normalizeFilter(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const column = typeof item.column === 'string' ? item.column.trim() : '';
  if (!column) return null;

  const op = typeof item.op === 'string' ? item.op.trim().toLowerCase() : '';
  if (!OP_SET.has(op)) return null;

  if (VALUELESS_OPS.has(op)) return { column, op, value: '' };

  const v = item.value;
  // 缺值 / 对象 / 数组值对 contains|eq|ne 没有语义，直接丢弃
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return null;
  return { column, op, value: v };
}

/* ------------------------------------------------------------------ *
 * 解析
 * ------------------------------------------------------------------ */

/**
 * 解析 `filters` 原始 query 值（**不校验列白名单**，只做结构与操作符校验）。
 *
 * @param {*} raw req.query.filters
 * @returns {{filters:Array, dropped:number, truncated:number, error:string}}
 *   filters   归一后的合法条件（已按 MAX_FILTERS 截断）
 *   dropped   被丢弃的非法条件数（数组元素不合法）
 *   truncated 因超过 MAX_FILTERS 被截掉的条件数
 *   error     '' | 'invalid_json' | 'non_array'
 */
function parseFilters(raw) {
  const out = { filters: [], dropped: 0, truncated: 0, error: '' };

  const text = normalizeRaw(raw);
  if (!text) return out;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    out.error = ERRORS.INVALID_JSON;
    return out;
  }

  if (!Array.isArray(parsed)) {
    out.error = ERRORS.NON_ARRAY;
    return out;
  }

  for (const item of parsed) {
    const f = normalizeFilter(item);
    if (!f) {
      out.dropped += 1;
      continue;
    }
    out.filters.push(f);
  }

  if (out.filters.length > MAX_FILTERS) {
    out.truncated = out.filters.length - MAX_FILTERS;
    out.filters = out.filters.slice(0, MAX_FILTERS);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 列白名单
 * ------------------------------------------------------------------ */

/**
 * 把各种形态的列清单归一成 Set<string>。
 * 支持：Set / string[] / {name}[]（information_schema 查询结果）/ {col: true} 映射。
 *
 * @param {Set<string>|Array<string|{name?:string}>|Object} liveCols
 * @returns {Set<string>}
 */
function toColumnSet(liveCols) {
  if (liveCols instanceof Set) return liveCols;
  if (Array.isArray(liveCols)) {
    const set = new Set();
    for (const c of liveCols) {
      const name = c && typeof c === 'object' ? c.name : c;
      if (typeof name === 'string' && name) set.add(name);
    }
    return set;
  }
  if (liveCols && typeof liveCols === 'object') return new Set(Object.keys(liveCols));
  return new Set();
}

/* ------------------------------------------------------------------ *
 * SQL 生成
 * ------------------------------------------------------------------ */

/**
 * 把筛选条件编译成 SQL 片段 + 绑定参数。
 *
 * @param {Array} filters      parseFilters() 的 filters
 * @param {Set|Array|Object} liveCols 真实物理列白名单
 * @param {Function} [quoteIdent]     标识符包裹函数，默认 src/ident.js 的实现
 * @returns {{clauses:string[], params:Array, applied:Array<{column:string,op:string}>, dropped:number}}
 */
function buildFilterWhere(filters, liveCols, quoteIdent) {
  const cols = toColumnSet(liveCols);
  const q = typeof quoteIdent === 'function' ? quoteIdent : defaultQuoteIdent;

  const clauses = [];
  const params = [];
  const applied = [];
  let dropped = 0;

  const list = Array.isArray(filters) ? filters : [];
  for (const f of list) {
    if (clauses.length >= MAX_FILTERS) {
      dropped += 1;
      continue;
    }
    const column = f && typeof f.column === 'string' ? f.column.trim() : '';
    // 列白名单校验：不是这张表真实存在的物理列 → 丢弃（绝不拼进 SQL）
    if (!column || !cols.has(column)) {
      dropped += 1;
      continue;
    }
    const op = f.op;
    if (!OP_SET.has(op)) {
      dropped += 1;
      continue;
    }

    const ident = q(column);
    switch (op) {
      case 'contains':
        clauses.push(`${ident} LIKE ?`);
        params.push(`%${String(f.value === undefined || f.value === null ? '' : f.value)}%`);
        break;
      case 'eq':
        clauses.push(`${ident} = ?`);
        params.push(f.value);
        break;
      case 'ne':
        // NULL 也算「不等于」，否则「不等于 X」会漏掉所有空值行
        clauses.push(`(${ident} <> ? OR ${ident} IS NULL)`);
        params.push(f.value);
        break;
      case 'empty':
        clauses.push(`(${ident} IS NULL OR ${ident} = '')`);
        break;
      case 'notempty':
        clauses.push(`(${ident} IS NOT NULL AND ${ident} <> '')`);
        break;
      default:
        dropped += 1;
        continue;
    }
    applied.push({ column, op });
  }

  return { clauses, params, applied, dropped };
}

/**
 * 一步到位：解析 raw → 校验白名单 → 生成 whereSql。
 *
 * @param {*} raw
 * @param {Set|Array|Object} liveCols
 * @param {Function} [quoteIdent]
 * @returns {{filters:Array, clauses:string[], params:Array, whereSql:string,
 *            applied:number, dropped:number, truncated:number, error:string}}
 */
function buildFilterSql(raw, liveCols, quoteIdent) {
  const parsed = parseFilters(raw);
  const built = buildFilterWhere(parsed.filters, liveCols, quoteIdent);
  return {
    filters: parsed.filters,
    clauses: built.clauses,
    params: built.params,
    whereSql: built.clauses.length ? `WHERE ${built.clauses.join(' AND ')}` : '',
    applied: built.applied.length,
    dropped: parsed.dropped + built.dropped,
    truncated: parsed.truncated,
    error: parsed.error,
  };
}

/**
 * 两个端点共用的接入入口：把筛选条件**追加**到已有 where/params 上。
 *
 * 用法（两处完全一致，只差 liveCols 的来源）：
 *
 *   const where = [];
 *   const params = [];
 *   // ... keyword / op 等原有条件 push 进 where、params ...
 *   const f = dataFilter.appendFilters({ where, params }, req.query.filters, liveCols, quoteIdent);
 *   const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
 *
 * 因为只是 push，filters 与 keyword 自动是 AND 关系。
 *
 * @param {{where:string[], params:Array}} state 已有的 where 片段与参数（原地修改）
 * @param {*} raw req.query.filters
 * @param {Set|Array|Object} liveCols
 * @param {Function} [quoteIdent]
 * @returns {{applied:number, dropped:number, truncated:number, error:string, clauses:string[]}}
 */
function appendFilters(state, raw, liveCols, quoteIdent) {
  if (!state || !Array.isArray(state.where) || !Array.isArray(state.params)) {
    throw new Error('appendFilters: state 必须是 { where: [], params: [] }');
  }
  const built = buildFilterSql(raw, liveCols, quoteIdent);
  if (built.clauses.length) {
    state.where.push(...built.clauses);
    state.params.push(...built.params);
  }
  return {
    applied: built.applied,
    dropped: built.dropped,
    truncated: built.truncated,
    error: built.error,
    clauses: built.clauses,
  };
}

/**
 * 生成响应里给前端回显的筛选元信息（两端字段名一致）。
 *
 * @param {object} meta appendFilters() 的返回值
 * @returns {{appliedFilters:number, droppedFilters:number}}
 */
function filterMeta(meta) {
  const m = meta || {};
  return {
    appliedFilters: Number(m.applied || 0),
    droppedFilters: Number(m.dropped || 0),
  };
}

module.exports = {
  MAX_FILTERS,
  OPS,
  VALUELESS_OPS,
  ERRORS,
  parseFilters,
  buildFilterWhere,
  buildFilterSql,
  appendFilters,
  filterMeta,
  toColumnSet,
  normalizeRaw,
};
