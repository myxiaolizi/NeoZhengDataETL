'use strict';

const db = require('./db');
const schema = require('./schema');
const projects = require('./projects');
const datasources = require('./datasources');
const dsDriver = require('./datasource');

/**
 * 数据处理流程引擎
 *
 * 通过拖拽编排节点，把输入数据经过加工后输出到目标表。
 * 节点类型分为：数据源（source）/ 处理器（transform）/ 输出（sink）。
 */

/* ══════════════════════════════════════════════════════════
 *  节点定义
 * ══════════════════════════════════════════════════════════ */

const NODE_TYPES = [
  /* ---------- 数据源 ---------- */
  {
    key: 'source_project', name: '项目数据表', category: 'source', icon: '▦',
    desc: '读取某个项目的原始表或解析表',
    fields: [
      { key: 'projectId', label: '项目', type: 'project', required: true },
      { key: 'table', label: '数据表', type: 'select', options: [
        { value: 'parsed', label: '解析数据表（推荐）' },
        { value: 'raw', label: '原始数据表' },
      ], default: 'parsed' },
      { key: 'limit', label: '最多读取行数', type: 'number', default: 5000 },
    ],
  },
  {
    key: 'source_sql', name: 'SQL 查询', category: 'source', icon: '⌘',
    desc: '在指定数据源上执行只读 SQL',
    fields: [
      { key: 'datasourceId', label: '数据源', type: 'datasource', default: 0 },
      { key: 'sql', label: 'SQL 语句', type: 'sql', required: true },
      { key: 'limit', label: '最多读取行数', type: 'number', default: 5000 },
    ],
  },
  {
    key: 'source_form', name: '表单数据', category: 'source', icon: '▤',
    desc: '读取表单的提交记录',
    fields: [
      { key: 'formId', label: '表单', type: 'form', required: true },
      { key: 'limit', label: '最多读取行数', type: 'number', default: 5000 },
    ],
  },
  {
    key: 'source_manual', name: '手动输入', category: 'source', icon: '✎',
    desc: '直接输入 JSON 数组作为数据源',
    fields: [
      { key: 'json', label: 'JSON 数据', type: 'json', required: true },
    ],
  },

  /* ---------- 数据清洗 ---------- */
  {
    key: 'filter', name: '条件过滤', category: 'clean', icon: '⧩',
    desc: '按条件筛选行，支持 =、!=、>、<、包含、为空等',
    fields: [
      { key: 'field', label: '字段', type: 'field', required: true },
      { key: 'operator', label: '条件', type: 'select', default: 'eq', options: [
        { value: 'eq', label: '等于' },
        { value: 'ne', label: '不等于' },
        { value: 'gt', label: '大于' },
        { value: 'gte', label: '大于等于' },
        { value: 'lt', label: '小于' },
        { value: 'lte', label: '小于等于' },
        { value: 'contains', label: '包含' },
        { value: 'notContains', label: '不包含' },
        { value: 'startsWith', label: '开头是' },
        { value: 'endsWith', label: '结尾是' },
        { value: 'isEmpty', label: '为空' },
        { value: 'notEmpty', label: '不为空' },
        { value: 'in', label: '在列表中（逗号分隔）' },
      ] },
      { key: 'value', label: '比较值', type: 'text' },
    ],
  },
  {
    key: 'select_fields', name: '字段选择', category: 'clean', icon: '☰',
    desc: '保留或排除指定字段',
    fields: [
      { key: 'mode', label: '模式', type: 'select', default: 'keep', options: [
        { value: 'keep', label: '仅保留选中字段' },
        { value: 'drop', label: '排除选中字段' },
      ] },
      { key: 'fields', label: '字段列表（逗号分隔）', type: 'text', required: true },
    ],
  },
  {
    key: 'rename', name: '字段重命名', category: 'clean', icon: '⇄',
    desc: '把字段名改为新的名称',
    fields: [
      { key: 'mapping', label: '映射关系', type: 'kv', hint: '每行一条：原字段名=新字段名' },
    ],
  },
  {
    key: 'dedupe', name: '去重', category: 'clean', icon: '⧉',
    desc: '按指定字段去重，保留第一条或最后一条',
    fields: [
      { key: 'fields', label: '去重字段（逗号分隔）', type: 'text', required: true },
      { key: 'keep', label: '保留', type: 'select', default: 'first', options: [
        { value: 'first', label: '第一条' },
        { value: 'last', label: '最后一条' },
      ] },
    ],
  },
  {
    key: 'fill_null', name: '空值填充', category: 'clean', icon: '◍',
    desc: '把空值替换为指定内容',
    fields: [
      { key: 'fields', label: '字段（逗号分隔，* 表示全部）', type: 'text', default: '*' },
      { key: 'value', label: '填充值', type: 'text', default: '' },
    ],
  },
  {
    key: 'replace', name: '查找替换', category: 'clean', icon: '⇋',
    desc: '在指定字段中查找并替换文本',
    fields: [
      { key: 'fields', label: '字段（逗号分隔，* 表示全部）', type: 'text', default: '*' },
      { key: 'search', label: '查找内容', type: 'text', required: true },
      { key: 'replace', label: '替换为', type: 'text', default: '' },
      { key: 'regex', label: '使用正则表达式', type: 'switch', default: false },
    ],
  },
  {
    key: 'trim', name: '去除空白', category: 'clean', icon: '⌫',
    desc: '去除文本首尾空格、换行符',
    fields: [
      { key: 'fields', label: '字段（逗号分隔，* 表示全部）', type: 'text', default: '*' },
    ],
  },
  {
    key: 'type_convert', name: '类型转换', category: 'clean', icon: '⇌',
    desc: '把字段值转换为数字、文本、日期等类型',
    fields: [
      { key: 'field', label: '字段', type: 'field', required: true },
      { key: 'to', label: '转换为', type: 'select', default: 'number', options: [
        { value: 'number', label: '数字' },
        { value: 'string', label: '文本' },
        { value: 'date', label: '日期（YYYY-MM-DD）' },
        { value: 'datetime', label: '日期时间' },
        { value: 'boolean', label: '布尔值' },
      ] },
      { key: 'onError', label: '转换失败时', type: 'select', default: 'null', options: [
        { value: 'null', label: '置为空' },
        { value: 'keep', label: '保留原值' },
        { value: 'zero', label: '置为 0' },
      ] },
    ],
  },
  {
    key: 'split_field', name: '字段拆分', category: 'clean', icon: '⑂',
    desc: '按分隔符把一列拆成多列',
    fields: [
      { key: 'field', label: '源字段', type: 'field', required: true },
      { key: 'separator', label: '分隔符', type: 'text', default: ',' },
      { key: 'targets', label: '目标字段（逗号分隔）', type: 'text', required: true },
      { key: 'dropSource', label: '删除源字段', type: 'switch', default: false },
    ],
  },
  {
    key: 'merge_field', name: '字段合并', category: 'clean', icon: '⑃',
    desc: '把多个字段合并为一个',
    fields: [
      { key: 'fields', label: '源字段（逗号分隔）', type: 'text', required: true },
      { key: 'target', label: '目标字段', type: 'text', required: true },
      { key: 'separator', label: '连接符', type: 'text', default: '' },
      { key: 'dropSource', label: '删除源字段', type: 'switch', default: false },
    ],
  },
  {
    key: 'extract_json', name: 'JSON 提取', category: 'clean', icon: '{}',
    desc: '从 JSON 文本字段中提取指定路径的值',
    fields: [
      { key: 'field', label: '源字段', type: 'field', required: true },
      { key: 'path', label: '提取路径', type: 'text', placeholder: 'name 或 data.list[0].name', required: true },
      { key: 'target', label: '目标字段', type: 'text', required: true },
      { key: 'dropSource', label: '删除源字段', type: 'switch', default: false },
    ],
  },
  {
    key: 'extract_regex', name: '正则提取', category: 'clean', icon: '.*',
    desc: '用正则表达式从文本中提取内容',
    fields: [
      { key: 'field', label: '源字段', type: 'field', required: true },
      { key: 'pattern', label: '正则表达式', type: 'text', required: true, hint: '例如 (\\d{11}) 提取手机号' },
      { key: 'group', label: '捕获组序号', type: 'number', default: 1 },
      { key: 'target', label: '目标字段', type: 'text', required: true },
    ],
  },
  {
    key: 'compute', name: '公式计算', category: 'clean', icon: 'ƒ',
    desc: '用表达式计算新字段，支持 + - * / 与函数',
    fields: [
      { key: 'target', label: '目标字段', type: 'text', required: true },
      { key: 'expression', label: '表达式', type: 'text', required: true, hint: '例如 {price} * {qty} 或 ROUND({amount} * 0.13, 2)' },
    ],
  },
  {
    key: 'aggregate', name: '分组聚合', category: 'clean', icon: '∑',
    desc: '按字段分组并统计',
    fields: [
      { key: 'groupBy', label: '分组字段（逗号分隔）', type: 'text', required: true },
      { key: 'aggregates', label: '聚合项', type: 'kv', hint: '每行一条：新字段名=sum:字段名（sum/count/avg/max/min）' },
    ],
  },
  {
    key: 'sort', name: '排序', category: 'clean', icon: '⇅',
    desc: '按字段排序',
    fields: [
      { key: 'field', label: '排序字段', type: 'field', required: true },
      { key: 'order', label: '顺序', type: 'select', default: 'asc', options: [
        { value: 'asc', label: '升序' },
        { value: 'desc', label: '降序' },
      ] },
    ],
  },
  {
    key: 'limit', name: '限制行数', category: 'clean', icon: '✂',
    desc: '只保留前 N 行',
    fields: [
      { key: 'count', label: '保留行数', type: 'number', default: 100 },
    ],
  },

  /* ---------- 输出 ---------- */
  {
    key: 'sink_table', name: '写入数据表', category: 'sink', icon: '⛁',
    desc: '把处理结果写入指定数据表',
    fields: [
      { key: 'datasourceId', label: '数据源', type: 'datasource', default: 0 },
      { key: 'table', label: '目标表名', type: 'text', required: true, hint: '以 jdywh_ 开头可被平台管理' },
      { key: 'mode', label: '写入方式', type: 'select', default: 'replace', options: [
        { value: 'replace', label: '清空后写入' },
        { value: 'append', label: '追加写入' },
        { value: 'upsert', label: '按主键更新插入' },
      ] },
      { key: 'keyField', label: '主键字段（upsert 用）', type: 'text' },
      { key: 'createTable', label: '自动建表', type: 'switch', default: true },
    ],
  },
  {
    key: 'sink_project', name: '写入项目表', category: 'sink', icon: '▦',
    desc: '把结果写入项目的解析数据表',
    fields: [
      { key: 'projectId', label: '项目', type: 'project', required: true },
      { key: 'mode', label: '写入方式', type: 'select', default: 'append', options: [
        { value: 'append', label: '追加写入' },
        { value: 'replace', label: '清空后写入' },
      ] },
    ],
  },
  {
    key: 'sink_api', name: '推送接口', category: 'sink', icon: '⇡',
    desc: '把结果 POST 到指定接口',
    fields: [
      { key: 'url', label: '接口地址', type: 'text', required: true },
      { key: 'method', label: '请求方法', type: 'select', default: 'POST', options: [
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
      ] },
      { key: 'headers', label: '请求头', type: 'kv', hint: '每行一条：Header名=值' },
      { key: 'batchSize', label: '每批条数', type: 'number', default: 500 },
    ],
  },
  {
    key: 'sink_dataset', name: '生成数据集', category: 'sink', icon: '◫',
    desc: '把结果保存为数据集，供报表使用',
    fields: [
      { key: 'datasetName', label: '数据集名称', type: 'text', required: true },
      { key: 'table', label: '存储表名', type: 'text', required: true, hint: '建议以 jdywh_ 开头' },
    ],
  },
];

const NODE_MAP = {};
NODE_TYPES.forEach((n) => { NODE_MAP[n.key] = n; });

const CATEGORIES = [
  { key: 'source', name: '数据源', desc: '流程的输入' },
  { key: 'clean', name: '数据清洗与加工', desc: '过滤、转换、计算' },
  { key: 'sink', name: '数据输出', desc: '流程的结果去向' },
];

/* ══════════════════════════════════════════════════════════
 *  工具函数
 * ══════════════════════════════════════════════════════════ */

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (_) { return fallback; }
}

function newCode(base) {
  const b = String(base || 'flow').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 40) || 'flow';
  return `${b}_${Date.now().toString(36)}`;
}

/** 按路径取值：a.b.c 或 a.list[0].name */
function getByPath(obj, path) {
  if (!path) return obj;
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** 解析 kv 文本为对象 */
function parseKv(text) {
  const out = {};
  String(text || '').split('\n').forEach((line) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const i = s.indexOf('=');
    if (i < 0) return;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  });
  return out;
}

/** 安全表达式求值 */
function evalExpression(expr, row) {
  let e = String(expr || '');
  // {字段名} → 取值
  e = e.replace(/\{([^}]+)\}/g, (_, name) => {
    const v = row[name.trim()];
    const n = Number(v);
    return Number.isFinite(n) && v !== '' && v !== null ? String(n) : '0';
  });

  // 只允许数字、运算符、括号、空白与白名单函数
  if (!/^[0-9+\-*/().,%\s]|^[A-Za-z_]+\(/.test(e.replace(/[A-Za-z_]+\(/g, ''))) {
    // 继续，下面统一校验
  }
  const allowed = /^(?:[0-9+\-*/().,%\s]|ROUND|ABS|CEIL|FLOOR|MAX|MIN|POW|SQRT|IF|CONCAT|LEN|UPPER|LOWER)+$/i;
  if (!allowed.test(e)) throw new Error('表达式包含不允许的字符或函数');

  const ROUND = (n, d) => { const p = Math.pow(10, d || 0); return Math.round(n * p) / p; };
  const ABS = Math.abs;
  const CEIL = Math.ceil;
  const FLOOR = Math.floor;
  const MAX = Math.max;
  const MIN = Math.min;
  const POW = Math.pow;
  const SQRT = Math.sqrt;
  const LEN = (s) => String(s).length;
  const UPPER = (s) => String(s).toUpperCase();
  const LOWER = (s) => String(s).toLowerCase();
  const CONCAT = (...a) => a.join('');
  const IF = (c, a, b) => (c ? a : b);

  /* eslint-disable no-new-func */
  const fn = new Function('ROUND', 'ABS', 'CEIL', 'FLOOR', 'MAX', 'MIN', 'POW', 'SQRT',
    'LEN', 'UPPER', 'LOWER', 'CONCAT', 'IF', `"use strict"; return (${e});`);
  /* eslint-enable no-new-func */
  return fn(ROUND, ABS, CEIL, FLOOR, MAX, MIN, POW, SQRT, LEN, UPPER, LOWER, CONCAT, IF);
}

/** 判断是否为空值 */
function isEmpty(v) {
  return v === null || v === undefined || v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'string' && v.trim() === '');
}

/* ══════════════════════════════════════════════════════════
 *  节点执行器
 * ══════════════════════════════════════════════════════════ */

/** 数据源节点 */
async function runSource(node, ctx) {
  const cfg = node.config || {};

  if (node.type === 'source_project') {
    const project = await projects.getProject(cfg.projectId);
    if (!project) throw new Error('项目不存在');
    const table = cfg.table === 'raw'
      ? (project.data_table || schema.makeTableName(project.id))
      : (project.parsed_table || schema.makeParsedTableName(project.id));
    if (!(await schema.tableExists(table))) return [];
    const limit = Math.min(Number(cfg.limit) || 5000, 50000);
    return db.query(`SELECT * FROM \`${table}\` ORDER BY id DESC LIMIT ${limit}`);
  }

  if (node.type === 'source_sql') {
    const sql = String(cfg.sql || '').trim();
    if (!sql) throw new Error('SQL 语句不能为空');
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error('仅支持 SELECT / WITH 只读查询');
    if (/;\s*\S/.test(sql)) throw new Error('不允许多条语句');
    const source = await datasources.getById(cfg.datasourceId || 0);
    if (!source) throw new Error('数据源不存在');
    const limit = Math.min(Number(cfg.limit) || 5000, 50000);
    // 与数据集同一链路：表名自动补引号（含连字符/中文/保留字的表名）+ 分页
    const normalized = dsDriver.normalizeSql(source, sql.replace(/;+\s*$/, ''));
    const paged = dsDriver.paginate(source, normalized, limit, 0);
    try {
      return await dsDriver.query(source, paged, []);
    } catch (err) {
      throw dsDriver.describeDbError(source, err, paged, sql, normalized);
    }
  }

  if (node.type === 'source_form') {
    const formId = Number(cfg.formId);
    if (!formId) throw new Error('请选择表单');
    const limit = Math.min(Number(cfg.limit) || 5000, 50000);
    const rows = await db.query(
      `SELECT * FROM jdywh_form_records WHERE form_id = ? AND status <> 'invalid'
        ORDER BY id DESC LIMIT ${limit}`,
      [formId]
    );
    // 把 data_json 展开为列
    return rows.map((r) => {
      const d = parseJson(r.data_json, {});
      return Object.assign({}, d, {
        _record_id: r.id,
        _submitter: r.submitter,
        _created_at: r.created_at,
      });
    });
  }

  if (node.type === 'source_manual') {
    const v = parseJson(cfg.json, null);
    if (!Array.isArray(v)) throw new Error('手动输入必须是 JSON 数组');
    return v;
  }

  throw new Error(`未知的数据源节点：${node.type}`);
}

/** 清洗节点 */
function runClean(node, rows, ctx) {
  const cfg = node.config || {};
  let out = rows;

  switch (node.type) {
    case 'filter': {
      const f = cfg.field;
      const op = cfg.operator || 'eq';
      const target = cfg.value;
      const num = Number(target);
      out = rows.filter((r) => {
        const v = r[f];
        const s = v === null || v === undefined ? '' : String(v);
        switch (op) {
          case 'eq': return s === String(target);
          case 'ne': return s !== String(target);
          case 'gt': return Number(v) > num;
          case 'gte': return Number(v) >= num;
          case 'lt': return Number(v) < num;
          case 'lte': return Number(v) <= num;
          case 'contains': return s.includes(String(target));
          case 'notContains': return !s.includes(String(target));
          case 'startsWith': return s.startsWith(String(target));
          case 'endsWith': return s.endsWith(String(target));
          case 'isEmpty': return isEmpty(v);
          case 'notEmpty': return !isEmpty(v);
          case 'in': return String(target).split(',').map((x) => x.trim()).includes(s);
          default: return true;
        }
      });
      break;
    }

    case 'select_fields': {
      const list = String(cfg.fields || '').split(',').map((s) => s.trim()).filter(Boolean);
      out = rows.map((r) => {
        const o = {};
        if (cfg.mode === 'drop') {
          Object.keys(r).forEach((k) => { if (!list.includes(k)) o[k] = r[k]; });
        } else {
          list.forEach((k) => { if (k in r) o[k] = r[k]; });
        }
        return o;
      });
      break;
    }

    case 'rename': {
      const map = parseKv(cfg.mapping);
      out = rows.map((r) => {
        const o = {};
        Object.keys(r).forEach((k) => { o[map[k] || k] = r[k]; });
        return o;
      });
      break;
    }

    case 'dedupe': {
      const keys = String(cfg.fields || '').split(',').map((s) => s.trim()).filter(Boolean);
      const seen = new Map();
      rows.forEach((r, i) => {
        const sig = keys.map((k) => String(r[k])).join('\u0001');
        if (!seen.has(sig)) seen.set(sig, { row: r, index: i });
        else if (cfg.keep === 'last') seen.set(sig, { row: r, index: i });
      });
      out = Array.from(seen.values()).sort((a, b) => a.index - b.index).map((x) => x.row);
      break;
    }

    case 'fill_null': {
      const fields = String(cfg.fields || '*').split(',').map((s) => s.trim()).filter(Boolean);
      const val = cfg.value === undefined ? '' : cfg.value;
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        const targets = fields.includes('*') ? Object.keys(o) : fields;
        targets.forEach((k) => { if (isEmpty(o[k])) o[k] = val; });
        return o;
      });
      break;
    }

    case 'replace': {
      const fields = String(cfg.fields || '*').split(',').map((s) => s.trim()).filter(Boolean);
      const search = String(cfg.search || '');
      const repl = cfg.replace === undefined ? '' : String(cfg.replace);
      const re = cfg.regex ? new RegExp(search, 'g') : null;
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        const targets = fields.includes('*') ? Object.keys(o) : fields;
        targets.forEach((k) => {
          if (typeof o[k] !== 'string') return;
          o[k] = re ? o[k].replace(re, repl) : o[k].split(search).join(repl);
        });
        return o;
      });
      break;
    }

    case 'trim': {
      const fields = String(cfg.fields || '*').split(',').map((s) => s.trim()).filter(Boolean);
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        const targets = fields.includes('*') ? Object.keys(o) : fields;
        targets.forEach((k) => {
          if (typeof o[k] === 'string') o[k] = o[k].trim().replace(/\s+/g, ' ');
        });
        return o;
      });
      break;
    }

    case 'type_convert': {
      const f = cfg.field;
      const to = cfg.to || 'number';
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        const v = o[f];
        let nv;
        try {
          if (to === 'number') {
            const n = Number(String(v).replace(/[^\d.\-]/g, ''));
            if (!Number.isFinite(n)) throw new Error('NaN');
            nv = n;
          } else if (to === 'string') {
            nv = v === null || v === undefined ? '' : String(v);
          } else if (to === 'date') {
            const d = new Date(v);
            if (isNaN(d.getTime())) throw new Error('Invalid');
            nv = d.toISOString().slice(0, 10);
          } else if (to === 'datetime') {
            const d = new Date(v);
            if (isNaN(d.getTime())) throw new Error('Invalid');
            nv = d.toISOString().slice(0, 19).replace('T', ' ');
          } else if (to === 'boolean') {
            nv = ['1', 'true', 'yes', 'on', '是'].includes(String(v).toLowerCase());
          }
        } catch (_) {
          if (cfg.onError === 'keep') nv = v;
          else if (cfg.onError === 'zero') nv = 0;
          else nv = null;
        }
        o[f] = nv;
        return o;
      });
      break;
    }

    case 'split_field': {
      const f = cfg.field;
      const sep = cfg.separator === undefined ? ',' : String(cfg.separator);
      const targets = String(cfg.targets || '').split(',').map((s) => s.trim()).filter(Boolean);
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        const parts = String(o[f] === null || o[f] === undefined ? '' : o[f]).split(sep);
        targets.forEach((t, i) => { o[t] = parts[i] === undefined ? '' : parts[i].trim(); });
        if (cfg.dropSource) delete o[f];
        return o;
      });
      break;
    }

    case 'merge_field': {
      const list = String(cfg.fields || '').split(',').map((s) => s.trim()).filter(Boolean);
      const target = cfg.target;
      const sep = cfg.separator === undefined ? '' : String(cfg.separator);
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        o[target] = list.map((k) => (isEmpty(o[k]) ? '' : String(o[k]))).filter(Boolean).join(sep);
        if (cfg.dropSource) list.forEach((k) => delete o[k]);
        return o;
      });
      break;
    }

    case 'extract_json': {
      const f = cfg.field;
      const path = cfg.path;
      const target = cfg.target;
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        let v = o[f];
        if (typeof v === 'string') {
          try { v = JSON.parse(v); } catch (_) { v = null; }
        }
        const got = getByPath(v, path);
        o[target] = got === undefined || got === null ? ''
          : (typeof got === 'object' ? JSON.stringify(got) : String(got));
        if (cfg.dropSource) delete o[f];
        return o;
      });
      break;
    }

    case 'extract_regex': {
      const f = cfg.field;
      const target = cfg.target;
      const group = Number(cfg.group) || 1;
      let re;
      try { re = new RegExp(String(cfg.pattern || '')); } catch (e) { throw new Error('正则表达式无效：' + e.message); }
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        const s = o[f] === null || o[f] === undefined ? '' : String(o[f]);
        const m = s.match(re);
        o[target] = m ? (m[group] === undefined ? m[0] : m[group]) : '';
        return o;
      });
      break;
    }

    case 'compute': {
      const target = cfg.target;
      const expr = cfg.expression;
      out = rows.map((r) => {
        const o = Object.assign({}, r);
        try {
          const v = evalExpression(expr, o);
          o[target] = typeof v === 'number' ? (Number.isFinite(v) ? Number(v.toFixed(6)) : null) : v;
        } catch (_) {
          o[target] = null;
        }
        return o;
      });
      break;
    }

    case 'aggregate': {
      const groupKeys = String(cfg.groupBy || '').split(',').map((s) => s.trim()).filter(Boolean);
      const aggs = parseKv(cfg.aggregates);
      const buckets = new Map();

      rows.forEach((r) => {
        const sig = groupKeys.map((k) => String(r[k])).join('\u0001');
        if (!buckets.has(sig)) {
          const base = {};
          groupKeys.forEach((k) => { base[k] = r[k]; });
          buckets.set(sig, { base, rows: [] });
        }
        buckets.get(sig).rows.push(r);
      });

      out = Array.from(buckets.values()).map((b) => {
        const o = Object.assign({}, b.base);
        Object.keys(aggs).forEach((name) => {
          const spec = String(aggs[name]);
          const i = spec.indexOf(':');
          const fn = (i < 0 ? 'count' : spec.slice(0, i)).toLowerCase();
          const field = i < 0 ? null : spec.slice(i + 1).trim();
          const nums = field
            ? b.rows.map((r) => Number(r[field])).filter((n) => Number.isFinite(n))
            : [];
          switch (fn) {
            case 'count': o[name] = b.rows.length; break;
            case 'sum': o[name] = nums.reduce((s, n) => s + n, 0); break;
            case 'avg': o[name] = nums.length ? Number((nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(4)) : 0; break;
            case 'max': o[name] = nums.length ? Math.max(...nums) : null; break;
            case 'min': o[name] = nums.length ? Math.min(...nums) : null; break;
            case 'countDistinct': o[name] = new Set(b.rows.map((r) => r[field])).size; break;
            default: o[name] = b.rows.length;
          }
        });
        return o;
      });
      break;
    }

    case 'sort': {
      const f = cfg.field;
      const dir = cfg.order === 'desc' ? -1 : 1;
      out = rows.slice().sort((a, b) => {
        const x = a[f];
        const y = b[f];
        const nx = Number(x);
        const ny = Number(y);
        if (Number.isFinite(nx) && Number.isFinite(ny)) return (nx - ny) * dir;
        return String(x === null || x === undefined ? '' : x)
          .localeCompare(String(y === null || y === undefined ? '' : y), 'zh-CN') * dir;
      });
      break;
    }

    case 'limit': {
      out = rows.slice(0, Math.max(0, Number(cfg.count) || 100));
      break;
    }

    default:
      break;
  }

  return out;
}

/** 输出节点 */
async function runSink(node, rows, ctx) {
  const cfg = node.config || {};

  if (node.type === 'sink_table') {
    const table = String(cfg.table || '').trim();
    if (!table) throw new Error('目标表名不能为空');
    if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error('表名只能包含字母、数字、下划线');

    const source = await datasources.getById(cfg.datasourceId || 0);
    if (!source) throw new Error('数据源不存在');

    const isOwn = schema.isOwnTable(table);
    const mode = cfg.mode || 'replace';

    // 自动建表
    if (cfg.createTable !== false && !(await dsDriver.tableExists(source, table))) {
      if (!isOwn) throw new Error(`表 ${table} 不存在，且非本平台表（需以 ${schema.tablePrefix()} 开头）无法自动创建`);
      const cols = rows.length ? Object.keys(rows[0]) : [];
      if (!cols.length) throw new Error('结果集为空，无法推断表结构');
      const defs = cols.map((c) => ({ column_name: c, field_name: c, field_key: c }));
      await schema.ensureTableFor(source, table, defs, rows[0]);
    }

    if (mode === 'replace') {
      if (isOwn) await schema.safeRaw(`TRUNCATE TABLE \`${table}\``, [], [table]);
      else await dsDriver.raw(source, `DELETE FROM ${dsDriver.quoteIdent(source, table)}`, []);
    }

    if (!rows.length) return { written: 0, table };

    const cols = Object.keys(rows[0]);
    let written = 0;

    if (mode === 'upsert' && cfg.keyField) {
      for (const r of rows) {
        const sets = cols.map((c) => `${dsDriver.quoteIdent(source, c)} = ?`).join(', ');
        const vals = cols.map((c) => normalizeVal(r[c]));
        await dsDriver.raw(
          source,
          `INSERT INTO ${dsDriver.quoteIdent(source, table)} (${cols.map((c) => dsDriver.quoteIdent(source, c)).join(',')})
           VALUES (${cols.map(() => '?').join(',')})
           ON DUPLICATE KEY UPDATE ${sets}`,
          vals.concat(vals)
        );
        written += 1;
      }
    } else {
      const batchSize = 200;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const placeholders = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
        const vals = [];
        batch.forEach((r) => cols.forEach((c) => vals.push(normalizeVal(r[c]))));
        await dsDriver.raw(
          source,
          `INSERT INTO ${dsDriver.quoteIdent(source, table)}
             (${cols.map((c) => dsDriver.quoteIdent(source, c)).join(',')}) VALUES ${placeholders}`,
          vals
        );
        written += batch.length;
      }
    }

    return { written, table };
  }

  if (node.type === 'sink_project') {
    const project = await projects.getProject(cfg.projectId);
    if (!project) throw new Error('项目不存在');

    if (cfg.mode === 'replace') {
      const t = project.parsed_table || schema.makeParsedTableName(project.id);
      schema.assertOwnTable(t);
      await schema.safeRaw(`TRUNCATE TABLE \`${t}\``, [], [t]);
    }

    let written = 0;
    for (const r of rows) {
      const dataId = r.jdy_data_id || r._record_id || `flow_${ctx.flowId}_${written}`;
      const columns = {};
      const parsed = {};
      Object.keys(r).forEach((k) => {
        if (k.startsWith('_')) return;
        columns[k] = r[k];
        parsed[`${k}_p`] = normalizeVal(r[k]);
      });
      await schema.upsertRecord(project.id, {
        dataId: String(dataId),
        op: 'flow_output',
        formName: ctx.flowName || '数据处理流程',
        opTime: Date.now(),
        rawJson: JSON.stringify({ op: 'flow_output', data: r, meta: { _id: String(dataId) } }),
        columns,
        parsed,
      });
      written += 1;
    }
    return { written, project: project.name };
  }

  if (node.type === 'sink_api') {
    const url = String(cfg.url || '').trim();
    if (!url) throw new Error('接口地址不能为空');
    const headers = Object.assign({ 'Content-Type': 'application/json' }, parseKv(cfg.headers));
    const batchSize = Math.min(Number(cfg.batchSize) || 500, 5000);
    let sent = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const res = await fetch(url, {
        method: cfg.method || 'POST',
        headers,
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`接口返回 HTTP ${res.status}`);
      sent += batch.length;
    }
    return { sent, url };
  }

  if (node.type === 'sink_dataset') {
    const name = String(cfg.datasetName || '').trim();
    const table = String(cfg.table || '').trim();
    if (!name || !table) throw new Error('数据集名称与存储表名都不能为空');
    if (!schema.isOwnTable(table)) throw new Error(`存储表名需以 ${schema.tablePrefix()} 开头`);

    // 先写入表
    const source = await datasources.getById(0);
    if (!(await dsDriver.tableExists(source, table))) {
      const cols = rows.length ? Object.keys(rows[0]) : [];
      if (!cols.length) throw new Error('结果集为空，无法建表');
      const defs = cols.map((c) => ({ column_name: c, field_name: c, field_key: c }));
      await schema.ensureTableFor(source, table, defs, rows[0]);
    }
    schema.assertOwnTable(table);
    await schema.safeRaw(`TRUNCATE TABLE \`${table}\``, [], [table]);

    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const batchSize = 200;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const placeholders = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
        const vals = [];
        batch.forEach((r) => cols.forEach((c) => vals.push(normalizeVal(r[c]))));
        await schema.safeRaw(
          `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ${placeholders}`,
          vals,
          [table]
        );
      }
    }

    // 创建或更新数据集
    const reports = require('./reports');
    const existing = (await reports.listDatasets()).find((d) => d.name === name);
    if (existing) {
      await reports.updateDataset(existing.id, { sourceType: 'table', sourceTable: table, datasourceId: 0 });
    } else {
      await reports.createDataset({
        name, sourceType: 'table', sourceTable: table, datasourceId: 0,
        description: `由数据处理流程生成（${ctx.flowName || ''}）`,
      }, ctx.userId);
    }

    return { dataset: name, table, written: rows.length };
  }

  throw new Error(`未知的输出节点：${node.type}`);
}

/** 值规范化（写入数据库前） */
function normalizeVal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60000);
  return String(v).slice(0, 60000);
}

/* ══════════════════════════════════════════════════════════
 *  流程执行
 * ══════════════════════════════════════════════════════════ */

/** 拓扑排序：返回节点执行顺序 */
function topoSort(nodes, edges) {
  const map = {};
  nodes.forEach((n) => { map[n.id] = n; });

  const indeg = {};
  const adj = {};
  nodes.forEach((n) => { indeg[n.id] = 0; adj[n.id] = []; });

  (edges || []).forEach((e) => {
    if (!map[e.from] || !map[e.to]) return;
    adj[e.from].push(e.to);
    indeg[e.to] += 1;
  });

  const queue = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    adj[id].forEach((next) => {
      indeg[next] -= 1;
      if (indeg[next] === 0) queue.push(next);
    });
  }

  if (order.length !== nodes.length) throw new Error('流程存在循环依赖，请检查节点连线');
  return order.map((id) => map[id]);
}

/**
 * 执行流程
 * @param {number} flowId
 * @param {string} trigger manual / cron / webhook
 */
async function run(flowId, trigger) {
  const flow = await getById(flowId);
  if (!flow) throw new Error('流程不存在');
  if (!flow.status) throw new Error('流程已停用');

  const started = Date.now();
  const nodeLogs = [];
  let rows = [];
  let inputRows = 0;
  let outputRows = 0;
  let success = false;
  let message = '';

  try {
    const order = topoSort(flow.nodes, flow.edges);
    if (!order.length) throw new Error('流程没有任何节点');

    // 记录每个节点的输出，供下游节点使用
    const outputs = {};

    for (const node of order) {
      const def = NODE_MAP[node.type];
      const t0 = Date.now();

      // 找到上游节点的输出作为输入
      const upstream = (flow.edges || []).filter((e) => e.to === node.id).map((e) => e.from);
      let input;
      if (upstream.length) {
        input = [];
        upstream.forEach((uid) => {
          if (Array.isArray(outputs[uid])) input = input.concat(outputs[uid]);
        });
      } else {
        input = rows;
      }

      let out;
      try {
        if (def && def.category === 'source') {
          out = await runSource(node, { flowId, flowName: flow.name });
        } else if (def && def.category === 'sink') {
          const r = await runSink(node, input, { flowId, flowName: flow.name, userId: flow.createdBy });
          out = input;
          nodeLogs.push({
            nodeId: node.id, type: node.type,
            name: (node.label || (def && def.name) || node.type),
            rows: input.length, result: r, ms: Date.now() - t0, ok: true,
          });
          outputs[node.id] = out;
          continue;
        } else {
          out = runClean(node, input, { flowId });
        }

        outputs[node.id] = out;
        nodeLogs.push({
          nodeId: node.id, type: node.type,
          name: (node.label || (def && def.name) || node.type),
          inputRows: input.length, outputRows: out.length,
          ms: Date.now() - t0, ok: true,
        });
      } catch (err) {
        nodeLogs.push({
          nodeId: node.id, type: node.type,
          name: (node.label || (def && def.name) || node.type),
          ok: false, error: err.message, ms: Date.now() - t0,
        });
        throw new Error(`节点「${(node.label || (def && def.name) || node.type)}」执行失败：${err.message}`);
      }

      // 最后一个节点若是清洗节点，作为最终结果
      rows = out;
    }

    // 找到第一个 source 节点的输出行数
    const firstSource = order.find((n) => NODE_MAP[n.type] && NODE_MAP[n.type].category === 'source');
    if (firstSource && Array.isArray(outputs[firstSource.id])) inputRows = outputs[firstSource.id].length;

    // 最终输出：取最后一个 sink 的输入，或最后一个节点的输出
    const lastSink = order.filter((n) => NODE_MAP[n.type] && NODE_MAP[n.type].category === 'sink').pop();
    if (lastSink) {
      const up = (flow.edges || []).filter((e) => e.to === lastSink.id).map((e) => e.from);
      outputRows = up.reduce((sum, uid) => sum + (Array.isArray(outputs[uid]) ? outputs[uid].length : 0), 0);
    } else {
      outputRows = rows.length;
    }

    success = true;
    message = `执行成功：处理 ${inputRows} 行，输出 ${outputRows} 行`;
  } catch (err) {
    message = err.message;
  }

  const duration = Date.now() - started;

  await db.query(
    `INSERT INTO jdywh_flow_logs
       (flow_id, trigger_source, success, input_rows, output_rows, duration_ms, node_logs, message)
     VALUES (?,?,?,?,?,?,?,?)`,
    [flowId, trigger || 'manual', success ? 1 : 0, inputRows, outputRows, duration,
      JSON.stringify(nodeLogs), message.slice(0, 500)]
  );

  await db.query(
    `UPDATE jdywh_flows
        SET run_count = run_count + 1,
            success_count = success_count + ?,
            last_run_at = NOW(),
            last_run_ok = ?,
            last_run_msg = ?
      WHERE id = ?`,
    [success ? 1 : 0, success ? 1 : 0, message.slice(0, 500), flowId]
  );

  return {
    ok: success, message, inputRows, outputRows, duration, nodeLogs,
  };
}

/* ══════════════════════════════════════════════════════════
 *  流程 CRUD
 * ══════════════════════════════════════════════════════════ */

function publicFlow(r, withDetail) {
  if (!r) return null;
  const out = {
    id: Number(r.id),
    name: r.name,
    code: r.code,
    description: r.description || '',
    projectId: r.project_id ? Number(r.project_id) : null,
    projectName: r.project_name || null,
    sourceType: r.source_type,
    targetTable: r.target_table || null,
    runMode: r.run_mode,
    cronExpr: r.cron_expr || null,
    status: Number(r.status),
    runCount: Number(r.run_count || 0),
    successCount: Number(r.success_count || 0),
    lastRunAt: r.last_run_at,
    lastRunOk: r.last_run_ok === null || r.last_run_ok === undefined ? null : Number(r.last_run_ok) === 1,
    lastRunMsg: r.last_run_msg || null,
    createdBy: r.created_by ? Number(r.created_by) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (withDetail) {
    out.nodes = parseJson(r.nodes, []);
    out.edges = parseJson(r.edges, []);
    out.sourceConfig = parseJson(r.source_config, {});
  } else {
    out.nodeCount = parseJson(r.nodes, []).length;
  }
  return out;
}

async function list(keyword) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(f.name LIKE ? OR f.code LIKE ? OR f.description LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT f.*, p.name AS project_name
       FROM jdywh_flows f
       LEFT JOIN jdywh_projects p ON p.id = f.project_id
       ${whereSql}
      ORDER BY f.id DESC`,
    params
  );
  return rows.map((r) => publicFlow(r, false));
}

async function getById(id) {
  const row = await db.queryOne(
    `SELECT f.*, p.name AS project_name
       FROM jdywh_flows f
       LEFT JOIN jdywh_projects p ON p.id = f.project_id
      WHERE f.id = ? LIMIT 1`,
    [id]
  );
  return publicFlow(row, true);
}

function normalizeNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n, i) => ({
    id: String(n.id || `n${i + 1}`),
    type: NODE_MAP[n.type] ? n.type : 'filter',
    label: String(n.label || (NODE_MAP[n.type] ? NODE_MAP[n.type].name : '节点')).slice(0, 60),
    x: Number(n.x) || 40,
    y: Number(n.y) || 40 + i * 100,
    config: n.config && typeof n.config === 'object' ? n.config : {},
  }));
}

function normalizeEdges(edges, nodes) {
  if (!Array.isArray(edges)) return [];
  const ids = new Set(nodes.map((n) => n.id));
  return edges
    .filter((e) => e && ids.has(String(e.from)) && ids.has(String(e.to)) && String(e.from) !== String(e.to))
    .map((e) => ({ from: String(e.from), to: String(e.to) }));
}

async function create(input, userId) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('请填写流程名称');

  const nodes = normalizeNodes(input.nodes || []);
  const edges = normalizeEdges(input.edges || [], nodes);
  const code = String(input.code || '').trim() || newCode('flow');

  const result = await db.query(
    `INSERT INTO jdywh_flows
       (name, code, description, project_id, source_type, source_config, nodes, edges,
        target_table, run_mode, cron_expr, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      name, code,
      String(input.description || '').trim() || null,
      Number(input.projectId) || null,
      input.sourceType || 'project',
      JSON.stringify(input.sourceConfig || {}),
      JSON.stringify(nodes),
      JSON.stringify(edges),
      String(input.targetTable || '').trim() || null,
      input.runMode || 'manual',
      String(input.cronExpr || '').trim() || null,
      input.status === 0 ? 0 : 1,
      userId || null,
    ]
  );
  return getById(result.insertId);
}

async function update(id, input) {
  const flow = await getById(id);
  if (!flow) throw new Error('流程不存在');

  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (input.name !== undefined) {
    const n = String(input.name).trim();
    if (!n) throw new Error('流程名称不能为空');
    set('name', n);
  }
  if (input.description !== undefined) set('description', String(input.description || '').trim() || null);
  if (input.projectId !== undefined) set('project_id', Number(input.projectId) || null);
  if (input.sourceType !== undefined) set('source_type', input.sourceType);
  if (input.sourceConfig !== undefined) set('source_config', JSON.stringify(input.sourceConfig || {}));
  if (input.nodes !== undefined) {
    const nodes = normalizeNodes(input.nodes);
    set('nodes', JSON.stringify(nodes));
    if (input.edges !== undefined) set('edges', JSON.stringify(normalizeEdges(input.edges, nodes)));
  } else if (input.edges !== undefined) {
    set('edges', JSON.stringify(normalizeEdges(input.edges, flow.nodes)));
  }
  if (input.targetTable !== undefined) set('target_table', String(input.targetTable || '').trim() || null);
  if (input.runMode !== undefined) set('run_mode', input.runMode);
  if (input.cronExpr !== undefined) set('cron_expr', String(input.cronExpr || '').trim() || null);
  if (input.status !== undefined) set('status', Number(input.status) ? 1 : 0);

  if (!fields.length) return flow;
  params.push(id);
  await db.query(`UPDATE jdywh_flows SET ${fields.join(', ')} WHERE id = ?`, params);
  return getById(id);
}

async function remove(id) {
  const flow = await getById(id);
  if (!flow) throw new Error('流程不存在');
  await db.query('DELETE FROM jdywh_flow_logs WHERE flow_id = ?', [id]);
  await db.query('DELETE FROM jdywh_flows WHERE id = ?', [id]);
  return true;
}

async function listLogs(flowId, options) {
  const opts = options || {};
  const page = Math.max(1, parseInt(opts.page || '1', 10));
  const pageSize = Math.min(200, Math.max(5, parseInt(opts.pageSize || '20', 10)));
  const offset = (page - 1) * pageSize;

  const where = flowId ? 'WHERE flow_id = ?' : '';
  const params = flowId ? [flowId] : [];

  const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM jdywh_flow_logs ${where}`, params);
  const rows = await db.query(
    `SELECT * FROM jdywh_flow_logs ${where} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    list: rows.map((r) => Object.assign({}, r, { nodeLogs: parseJson(r.node_logs, []) })),
    total: Number((totalRow && totalRow.c) || 0),
    page,
    pageSize,
  };
}

async function stats() {
  const row = await db.queryOne(
    `SELECT (SELECT COUNT(*) FROM jdywh_flows) AS flows,
            (SELECT COUNT(*) FROM jdywh_flows WHERE status = 1) AS active,
            (SELECT COALESCE(SUM(run_count),0) FROM jdywh_flows) AS runs,
            (SELECT COALESCE(SUM(success_count),0) FROM jdywh_flows) AS oks`
  );
  return {
    flows: Number((row && row.flows) || 0),
    active: Number((row && row.active) || 0),
    runs: Number((row && row.runs) || 0),
    oks: Number((row && row.oks) || 0),
  };
}

module.exports = {
  NODE_TYPES, NODE_MAP, CATEGORIES,
  list, getById, create, update, remove,
  run, listLogs, stats, topoSort,
  runSource, runClean, runSink,
  parseKv, getByPath, evalExpression, publicFlow,
};