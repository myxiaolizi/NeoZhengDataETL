'use strict';

const fs = require('fs');
const path = require('path');

/**
 * agg 数据加载器
 *
 * 读取 agg-split 目录下按月份拆分的列式分片，提供：
 *  - 索引与摘要（看板首屏，无需加载全量）
 *  - 按月加载分片
 *  - 聚合统计（按月汇总、按分类汇总、Top N）
 *
 * 数据格式：{ cols: [...], rows: [[...], [...]] }
 */

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'agg-split');

/** 内存缓存（分片较大，只缓存最近访问的若干个月） */
const cache = new Map();
const CACHE_MAX = 6;

function dataDir(dir) {
  return dir || process.env.AGG_DIR || DEFAULT_DIR;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 索引 */
function index(label, dir) {
  const file = path.join(dataDir(dir), label, 'index.json');
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

/** 摘要 */
function summary(label, dir) {
  const file = path.join(dataDir(dir), label, '_summary.json');
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

/** 把列式分片转为对象数组 */
function toObjects(columnar) {
  const { cols, rows } = columnar;
  return rows.map((r) => {
    const o = {};
    for (let i = 0; i < cols.length; i += 1) o[cols[i]] = r[i];
    return o;
  });
}

/**
 * 加载某个月份的分片
 * @param {string} label classified / raw
 * @param {string} month 2025-04
 * @param {string} dir 数据目录
 * @returns {Array<object>}
 */
function loadMonth(label, month, dir) {
  const key = `${label}:${month}`;
  if (cache.has(key)) return cache.get(key);

  const idx = index(label, dir);
  if (!idx) return [];
  const m = idx.months.find((x) => x.month === month);
  if (!m) return [];

  let all = [];
  m.files.forEach((f) => {
    const file = path.join(dataDir(dir), label, f);
    if (!fs.existsSync(file)) return;
    all = all.concat(toObjects(readJson(file)));
  });

  // LRU 淘汰
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, all);
  return all;
}

/** 加载多个月份 */
function loadMonths(label, months, dir) {
  let all = [];
  months.forEach((m) => { all = all.concat(loadMonth(label, m, dir)); });
  return all;
}

/** 加载全部（大文件，慎用） */
function loadAll(label, dir) {
  const idx = index(label, dir);
  if (!idx) return [];
  return loadMonths(label, idx.months.map((m) => m.month), dir);
}

/* ══════════ 聚合统计 ══════════ */

const NUMERIC_FIELDS = [
  '触达次数', '计费条数', '人数', '消费人数', '消费次数', '消费金额',
  '健康卡会员数', '新会员触达', '新会员消费', '活跃会员触达', '活跃会员消费',
  '沉睡会员触达', '沉睡会员消费', '流失会员触达', '流失会员消费',
  '高净值触达', '高净值消费', '其他触达', '其他消费',
];

/** 按月汇总 */
function byMonth(label, dir) {
  const idx = index(label, dir);
  if (!idx) return [];

  return idx.months.map((m) => {
    const rows = loadMonth(label, m.month, dir);
    const out = { 月份: m.month, 记录数: rows.length };
    NUMERIC_FIELDS.forEach((f) => {
      out[f] = rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    });
    out.转化率 = out.人数 ? Number(((out.消费人数 / out.人数) * 100).toFixed(2)) : 0;
    out.客单价 = out.消费人数 ? Number((out.消费金额 / out.消费人数).toFixed(2)) : 0;
    return out;
  });
}

/** 按分类汇总 */
function byCategory(label, dir) {
  const rows = loadAll(label, dir);
  const map = new Map();

  rows.forEach((r) => {
    const c = r.分类 || '未分类';
    if (!map.has(c)) {
      const base = { 分类: c, 记录数: 0 };
      NUMERIC_FIELDS.forEach((f) => { base[f] = 0; });
      map.set(c, base);
    }
    const b = map.get(c);
    b.记录数 += 1;
    NUMERIC_FIELDS.forEach((f) => { b[f] += Number(r[f]) || 0; });
  });

  return Array.from(map.values()).sort((a, b) => b.消费金额 - a.消费金额);
}

/** Top N（按指定字段） */
function topN(label, field, n, dir) {
  const rows = loadAll(label, dir);
  return rows
    .slice()
    .sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0))
    .slice(0, n || 10);
}

/** 全局 KPI */
function kpis(label, dir) {
  const sum = summary(label, dir);
  if (!sum) return null;

  const months = byMonth(label, dir);
  const total = { 记录数: 0 };
  NUMERIC_FIELDS.forEach((f) => { total[f] = 0; });
  months.forEach((m) => {
    total.记录数 += m.记录数;
    NUMERIC_FIELDS.forEach((f) => { total[f] += m[f] || 0; });
  });

  total.转化率 = total.人数 ? Number(((total.消费人数 / total.人数) * 100).toFixed(2)) : 0;
  total.客单价 = total.消费人数 ? Number((total.消费金额 / total.消费人数).toFixed(2)) : 0;
  total.月份数 = sum.monthCount;
  total.总记录数 = sum.totalRecords;

  return total;
}

module.exports = {
  DEFAULT_DIR,
  NUMERIC_FIELDS,
  dataDir,
  index,
  summary,
  loadMonth,
  loadMonths,
  loadAll,
  toObjects,
  byMonth,
  byCategory,
  topN,
  kpis,
  clearCache: () => cache.clear(),
};
