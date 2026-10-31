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
  {
    key: 'join', name: '关联', category: 'clean', icon: '⋈',
    desc: '按关联键把左右两路数据合成一张宽表（left / inner）；右侧 1:N 数据先按组收敛成 1 行',
    fields: [
      { key: 'joinType', label: '关联方式', type: 'select', default: 'left', options: [
        { value: 'left', label: '左关联（保留左表全部行）' },
        { value: 'inner', label: '内关联（只保留能匹配上的行）' },
      ] },
      { key: 'leftKey', label: '左表关联键', type: 'text', required: true, hint: '例如 jdy_data_id / data_id' },
      { key: 'rightKey', label: '右表关联键', type: 'text', required: true, hint: '例如 event_instance_id' },
      { key: 'rightAgg', label: '右表收敛方式', type: 'select', default: 'first', options: [
        { value: 'first', label: '每组取第一条' },
        { value: 'last', label: '每组取最后一条' },
        { value: 'pickCurrent', label: '每组取当前挂起待办（其后无完成/取消）' },
      ] },
      { key: 'timeColumn', label: '时间列（排序用）', type: 'field', hint: '右侧按此列升序后再取行；事件表建议填 jdy_op_time' },
      { key: 'mode', label: 'pickCurrent 判定规则', type: 'select', default: 'pending', options: [
        { value: 'pending', label: '挂起待办（推荐）' },
        { value: 'simple', label: '简易（旧规则）' },
      ] },
      { key: 'cutoffTime', label: 'pickCurrent 快照切点', type: 'text', hint: '留空=当前时间；毫秒或 YYYY-MM-DD HH:mm:ss（北京时间）' },
      { key: 'createdCountColumn', label: '新增待办数列（pickCurrent）', type: 'text', default: 'event_created_count' },
      { key: 'completedCountColumn', label: '完成待办数列（pickCurrent）', type: 'text', default: 'event_completed_count' },
      { key: 'canceledCountColumn', label: '取消待办数列（pickCurrent）', type: 'text', default: 'event_canceled_count' },
      { key: 'nodeColumn', label: '节点名列（别名映射用）', type: 'text' },
      { key: 'nodeAlias', label: '节点名映射', type: 'kv', hint: '每行一条：事件节点名=业务表节点名' },
      { key: 'selfCancelDisqualifies', label: '「创建即取消」视为失效', type: 'switch', default: false,
        hint: '默认为否：契约 C3 只判「其后」是否有完成/取消，不含它自己' },
      { key: 'leftPrefix', label: '左表列前缀', type: 'text' },
      { key: 'rightPrefix', label: '右表列前缀', type: 'text' },
      { key: 'rightFields', label: '右侧保留列（逗号分隔，空=全部）', type: 'text' },
      { key: 'rightColumns', label: '右侧列声明（右表为空时用于补空列）', type: 'text' },
      { key: 'leftSource', label: '左表上游节点 ID（可选）', type: 'text', hint: '留空时按连线顺序：第一条进左，第二条进右' },
      { key: 'rightSource', label: '右表上游节点 ID（可选）', type: 'text' },
    ],
  },
  {
    key: 'pick_current_task', name: '选取当前待办', category: 'clean', icon: '⌖',
    desc: '按实例分组、按时间升序，取最后一条「创建了待办且其后无完成/取消」的事件，输出当前节点/当前负责人',
    fields: [
      { key: 'instanceKey', label: '实例分组键', type: 'text', required: true, hint: '例如 event_instance_id' },
      { key: 'timeColumn', label: '时间列', type: 'field' },
      { key: 'mode', label: '判定规则', type: 'select', default: 'pending', options: [
        { value: 'pending', label: '挂起待办（推荐）：其后没有任何完成/取消' },
        { value: 'simple', label: '简易：最后一条已创建且未取消（旧规则）' },
      ] },
      { key: 'cutoffTime', label: '快照切点', type: 'text', hint: '只取此刻之前的事件。留空=当前时间；毫秒时间戳或 YYYY-MM-DD HH:mm:ss（北京时间）' },
      { key: 'createdCountColumn', label: '新增待办数列', type: 'text', default: 'event_created_count' },
      { key: 'completedCountColumn', label: '完成待办数列', type: 'text', default: 'event_completed_count' },
      { key: 'canceledCountColumn', label: '取消待办数列', type: 'text', default: 'event_canceled_count' },
      { key: 'nodeColumn', label: '节点名列', type: 'text', default: 'event_flow_name' },
      { key: 'ownerColumn', label: '负责人列', type: 'text', default: 'event_current_assignee' },
      { key: 'nodeAlias', label: '节点名映射', type: 'kv', hint: '每行一条：事件里的节点名=业务表节点名，例如 开始=销售签约' },
      { key: 'selfCancelDisqualifies', label: '「创建即取消」视为失效', type: 'switch', default: false,
        hint: '默认为否：契约 C3 只判「其后」，不含它自己' },
      { key: 'outputNodeName', label: '输出：节点列名', type: 'text', default: '当前节点' },
      { key: 'outputOwnerName', label: '输出：负责人列名', type: 'text', default: '当前负责人' },
      { key: 'extraFields', label: '额外带出的列（逗号分隔）', type: 'text' },
    ],
  },
  {
    key: 'computed', name: '计算列', category: 'clean', icon: '＋',
    desc: '为每行派生新列：常量、复制其他列、取首个非空值、或按条件置空，用于补齐缺列与回退默认值',
    fields: [
      { key: 'assignments', label: '列定义', type: 'kv', hint: '每行一条：新列名=常量 / copy:源列 / coalesce:A,B / blankif:列:值1|值2' },
      { key: 'onlyIfEmpty', label: '仅在目标列为空时写入', type: 'switch', default: false },
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
 *  关联 / 事件收敛 工具函数
 *
 *  背景：CRM表单推送(16) 是 1 行 1 单据，CRM流程推送(102) 是流程事件表
 *  （1 个实例最多 19 条事件：创建/完成/取消/转交…）。要把两者合成宽表，
 *  右侧必须先「收敛成 1 行」再关联，且不能简单取最后一条——
 *  最后一条可能是「取消」事件（见 _work/V7R-CONTRACT.md §3.3）。
 * ══════════════════════════════════════════════════════════ */

/** 关联键归一化：null/undefined → ''（空键不参与匹配，与 SQL 的 NULL 语义一致） */
function normKey(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** 数值化（待办计数用）：空值/非数字 → 0 */
function numOf(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 时间可比值（毫秒）：支持毫秒时间戳与 'YYYY-MM-DD HH:mm:ss'；不可解析 → NaN */
function timeOf(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(String(v).replace(' ', 'T'));
  return Number.isFinite(t) ? t : NaN;
}

/** 按时间列升序稳定排序；未给时间列时保持原始顺序 */
function sortByTime(rows, column) {
  const list = Array.isArray(rows) ? rows : [];
  if (!column) return list.slice();
  return list
    .map((r, i) => ({ r, i, t: timeOf(r && r[column]) }))
    .sort((a, b) => {
      // 无法解析时间的行视为「最早」，避免它抢到「最后一条」
      const ta = Number.isFinite(a.t) ? a.t : Number.NEGATIVE_INFINITY;
      const tb = Number.isFinite(b.t) ? b.t : Number.NEGATIVE_INFINITY;
      if (ta === tb) return a.i - b.i;
      return ta < tb ? -1 : 1;
    })
    .map((x) => x.r);
}

/**
 * 解析「切点时间」为毫秒
 *
 * 支持三种写法：
 *   - 空值         → 用当前时间（等价于「只看已经发生的事件」，防时钟漂移产生的未来事件）
 *   - 毫秒时间戳   → 直接用（jdy_op_time 就是毫秒）
 *   - 'YYYY-MM-DD HH:mm:ss' → **按北京时间（UTC+8）**解析
 *     （业务表导出时间、人工填写的都是北京时间；与 flow-state.toLocalString 的 +8 口径一致）
 *
 * @param {*} v 配置值
 * @param {number} [now] 当前时间（测试注入）
 * @returns {number} 毫秒
 */
function resolveCutoffTime(v, now) {
  const fallback = Number.isFinite(now) ? now : Date.now();
  if (v === null || v === undefined || String(v).trim() === '') return fallback;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;

  const s = String(v).trim();
  // 'YYYY-MM-DD HH:mm(:ss)?' 或 'YYYY-MM-DDTHH:mm(:ss)?'（无时区后缀 → 按北京时间）
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const t = Date.UTC(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] || '0')
    ) - 8 * 3600 * 1000;   // 北京时间 → UTC 毫秒
    if (Number.isFinite(t)) return t;
  }
  const parsed = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 解析节点名别名映射：'开始=销售签约' 的 kv 文本 → { 开始: '销售签约' } */
function nodeAliasMap(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  return parseKv(v);
}

/** 按别名映射节点名；无映射则原样返回 */
function applyNodeAlias(name, alias) {
  if (name === null || name === undefined) return name;
  const map = alias || {};
  const key = String(name);
  return map[key] !== undefined ? map[key] : name;
}

/**
 * 从一批事件里选出「当前挂起的待办事件」（契约 §3.5 C3，**默认规则**）
 *
 * 规则（mode='pending'，默认）：
 *   在该实例「切点时间之前」的事件里，取**最后一条 created_count > 0、
 *   且其后没有任何 completed_count > 0 或 canceled_count > 0 的事件**。
 *   —— 「其后」指按时间升序排在它之后的事件（不含它自己）。
 *
 * 与旧规则（mode='simple'）的差异：
 *   simple 只看「同一行没取消」，于是「创建后又被取消」的待办会被误选；
 *   pending 要求「其后没有任何完成/取消」，能正确跳过这些已失效的待办。
 *   实测：simple 95/96，pending 96/96（对业务表，见 scripts/v7-flow-pick-verify.js）。
 *
 * @param {Array} rows 事件行
 * @param {object} [options]
 * @param {string} [options.mode] 'pending'(默认) | 'simple'
 * @param {string} [options.timeColumn] 时间列，默认 jdy_op_time
 * @param {*} [options.cutoffTime] 切点，见 resolveCutoffTime；空=当前时间
 * @param {number} [options.now] 当前时间（测试注入）
 * @param {string} [options.createdCountColumn] 默认 event_created_count
 * @param {string} [options.completedCountColumn] 默认 event_completed_count
 * @param {string} [options.canceledCountColumn] 默认 event_canceled_count
 * @param {boolean} [options.selfCancelDisqualifies] 同一行「创建即取消」是否也算失效
 *        （默认 false = 严格按契约 §3.5 C3 的「其后」；置 true 更保守）
 * @returns {object|null} 选中的事件行；没有挂起待办时返回 null
 */
function pickCurrentEvent(rows, options) {
  const o = options || {};
  const mode = String(o.mode || 'pending').toLowerCase() === 'simple' ? 'simple' : 'pending';
  const timeCol = String(o.timeColumn || 'jdy_op_time');
  const createdCol = String(o.createdCountColumn || 'event_created_count');
  const completedCol = String(o.completedCountColumn || 'event_completed_count');
  const canceledCol = String(o.canceledCountColumn || 'event_canceled_count');
  const cutoff = resolveCutoffTime(o.cutoffTime, o.now);

  // 1) 切点：只看「快照之前」的事件（事件按时间升序）
  const sorted = sortByTime(rows, timeCol).filter((r) => {
    if (!r) return false;
    const t = timeOf(r[timeCol]);
    // 时间不可解析的行保守保留（老数据可能没有 jdy_op_time），不因缺时间而丢事件
    return !Number.isFinite(t) || t <= cutoff;
  });

  if (mode === 'simple') {
    // 旧规则（保留为可选）：最后一条 created>0 且同一行没取消
    let found = null;
    sorted.forEach((r) => {
      if (numOf(r[createdCol]) > 0 && numOf(r[canceledCol]) === 0) found = r;
    });
    return found;
  }

  // 2) pending：最后一条 created>0，且其后没有任何 completed>0 / canceled>0
  const selfCancelDisq = o.selfCancelDisqualifies === true ||
    String(o.selfCancelDisqualifies) === 'true';
  let found = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i];
    if (numOf(cur[createdCol]) <= 0) continue;
    // 可选口径：同一行「创建即取消」(created>0 && canceled>0) 视为已失效
    // 默认关闭——契约 §3.5 C3 的原文只说「其后」，不含它自己
    if (selfCancelDisq && numOf(cur[canceledCol]) > 0) continue;
    let violated = false;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const nxt = sorted[j];
      if (numOf(nxt[completedCol]) > 0 || numOf(nxt[canceledCol]) > 0) {
        violated = true;
        break;
      }
    }
    if (!violated) found = cur;
  }
  return found;
}

/** 按某列分组（保持首次出现顺序）；空键也成组，由调用方决定是否参与匹配 */
function groupByColumn(rows, column) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const k = normKey(r && r[column]);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return map;
}

/** 取列集合：先取 ensure 指定的列，再按行出现顺序补全 */
function columnsOf(rows, ensure) {
  const seen = new Set();
  const out = [];
  const push = (c) => {
    if (!c || seen.has(c)) return;
    seen.add(c);
    out.push(c);
  };
  (ensure || []).forEach(push);
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r) return;
    Object.keys(r).forEach(push);
  });
  return out;
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

/**
 * 关联（join）：左右两路按 key 合并成宽表
 *
 * 与 run() 既有的「多上游拼接（concat）」是两种语义，互不影响：
 *   concat —— 纵向拼接（行变多、列不变）
 *   join   —— 横向关联（行数由左表决定、列变宽）
 *
 * @param {object} node 节点（node.config 为配置）
 * @param {Array} leftRows  左表行
 * @param {Array} rightRows 右表行（允许 1:N）
 */
function runJoin(node, leftRows, rightRows) {
  const cfg = node.config || {};
  const left = Array.isArray(leftRows) ? leftRows : [];
  const right = Array.isArray(rightRows) ? rightRows : [];

  const joinType = cfg.joinType === 'inner' ? 'inner' : 'left';
  const leftKey = String(cfg.leftKey || cfg.keyField || '').trim();
  const rightKey = String(cfg.rightKey || cfg.leftKey || cfg.keyField || '').trim();
  if (!leftKey) throw new Error('关联节点需要配置左表关联键');
  if (!rightKey) throw new Error('关联节点需要配置右表关联键');

  const agg = ['first', 'last', 'pickCurrent'].indexOf(String(cfg.rightAgg || '')) >= 0
    ? String(cfg.rightAgg)
    : 'first';

  const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rightFields = splitList(cfg.rightFields);
  const declaredRightCols = splitList(cfg.rightColumns);

  // 1) 右侧 1:N 收敛成每组 1 行
  const converged = new Map();
  const pickOpts = {
    mode: cfg.mode || cfg.pickMode,
    timeColumn: cfg.timeColumn,
    cutoffTime: cfg.cutoffTime,
    now: Number.isFinite(cfg.now) ? cfg.now : undefined,
    createdCountColumn: cfg.createdCountColumn,
    completedCountColumn: cfg.completedCountColumn,
    canceledCountColumn: cfg.canceledCountColumn,
    selfCancelDisqualifies: cfg.selfCancelDisqualifies,
  };
  const alias = nodeAliasMap(cfg.nodeAlias);
  const aliasCol = String(cfg.nodeColumn || '').trim();

  groupByColumn(right, rightKey).forEach((list, key) => {
    const sorted = sortByTime(list, cfg.timeColumn);
    let row = null;
    if (agg === 'pickCurrent') row = pickCurrentEvent(sorted, pickOpts);
    else if (agg === 'last') row = sorted.length ? sorted[sorted.length - 1] : null;
    else row = sorted.length ? sorted[0] : null;
    // 节点名别名只作用于显式声明的节点列，避免误改其他同名列
    if (row && aliasCol && row[aliasCol] !== undefined) {
      row = Object.assign({}, row, { [aliasCol]: applyNodeAlias(row[aliasCol], alias) });
    }
    if (row) converged.set(key, row);
  });

  // 2) 计算输出列名（前缀 + 冲突兜底）
  const leftCols = columnsOf(left, [leftKey]);
  const rawRightCols = declaredRightCols.length ? declaredRightCols : columnsOf(right, []);
  const rightCols = rawRightCols.filter((c) => {
    if (c === rightKey) return false;                    // 关联键只保留左侧一列
    if (!rightFields.length) return true;
    return rightFields.indexOf(c) >= 0;
  });

  const leftPrefix = String(cfg.leftPrefix || '');
  const rightPrefix = String(cfg.rightPrefix || '');
  const used = new Set();
  const leftMap = leftCols.map((src) => {
    const name = leftPrefix + src;
    used.add(name);
    return { src, name };
  });
  const rightMap = rightCols.map((src) => {
    let name = rightPrefix + src;
    if (used.has(name)) name = `${rightPrefix || 'right_'}${src}`;   // 仍冲突 → 加 right_ 兜底
    let i = 2;
    while (used.has(name)) { name = `${rightPrefix || 'right_'}${src}_${i}`; i += 1; }
    used.add(name);
    return { src, name };
  });

  // 3) 组装结果：左表行数为准，左关联保行、内关联只留匹配上的
  const out = [];
  const emit = (lrow, rrow) => {
    const o = {};
    leftMap.forEach((m) => {
      o[m.name] = lrow && lrow[m.src] !== undefined ? lrow[m.src] : null;
    });
    rightMap.forEach((m) => {
      o[m.name] = rrow && rrow[m.src] !== undefined ? rrow[m.src] : null;
    });
    out.push(o);
  };

  left.forEach((lrow) => {
    const key = normKey(lrow && lrow[leftKey]);
    const rrow = key === '' ? null : (converged.get(key) || null);
    if (rrow) emit(lrow, rrow);
    else if (joinType === 'left') emit(lrow, null);
  });

  return out;
}

/**
 * 选取当前待办：按 instanceKey 分组，输出每组的当前节点 / 当前负责人。
 *
 * 规则见 pickCurrentEvent（契约 §3.5 C3）：
 *   - mode='pending'（默认）：最后一条 created>0 且其后无 completed/canceled；
 *   - mode='simple'：旧规则（最后一条 created>0 且同一行未取消）；
 *   - cutoffTime：快照切点，留空=当前时间；
 *   - nodeAlias：节点名映射（如 '开始=销售签约'）。
 */
function runPickCurrentTask(cfg, rows) {
  const c = cfg || {};
  const instanceKey = String(c.instanceKey || c.groupBy || '').trim();
  if (!instanceKey) throw new Error('选取当前待办需要配置实例分组键');

  const nodeCol = String(c.nodeColumn || 'event_flow_name').trim();
  const ownerCol = String(c.ownerColumn || 'event_current_assignee').trim();
  const outNode = String(c.outputNodeName || '当前节点').trim() || '当前节点';
  const outOwner = String(c.outputOwnerName || '当前负责人').trim() || '当前负责人';
  const extraFields = String(c.extraFields || '').split(',').map((s) => s.trim()).filter(Boolean);
  const alias = nodeAliasMap(c.nodeAlias);

  const pickOpts = {
    mode: c.mode,
    timeColumn: c.timeColumn,
    cutoffTime: c.cutoffTime,
    now: Number.isFinite(c.now) ? c.now : undefined,
    createdCountColumn: c.createdCountColumn,
    completedCountColumn: c.completedCountColumn,
    canceledCountColumn: c.canceledCountColumn,
  };

  const out = [];
  groupByColumn(rows, instanceKey).forEach((list, key) => {
    const picked = pickCurrentEvent(list, pickOpts);
    const row = {};
    row[instanceKey] = key === '' ? null : key;
    row[outNode] = picked && picked[nodeCol] !== undefined && picked[nodeCol] !== null
      ? applyNodeAlias(picked[nodeCol], alias) : null;
    row[outOwner] = picked && picked[ownerCol] !== undefined && picked[ownerCol] !== null
      ? picked[ownerCol] : null;
    extraFields.forEach((f) => {
      row[f] = picked && picked[f] !== undefined ? picked[f] : null;
    });
    out.push(row);
  });
  return out;
}

/**
 * 解析「列定义」为**有序**列表（允许同一个目标列出现多次，按顺序叠加）
 *
 * 为什么不用 parseKv：parseKv 返回对象，同名列会被后者覆盖。
 * 而「当前节点=coalesce:...」后面还要接「当前节点=blankif:...」这类多步加工，
 * 必须保留顺序与重复项。单列写法与原 parseKv 完全兼容。
 *
 * @returns {Array<{target: string, spec: string}>}
 */
function parseAssignments(v) {
  if (v === null || v === undefined) return [];
  if (typeof v === 'object') {
    return Object.keys(v).map((k) => ({ target: k, spec: String(v[k]) }));
  }
  const out = [];
  String(v).split('\n').forEach((line) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const i = s.indexOf('=');
    if (i <= 0) return;
    out.push({ target: s.slice(0, i).trim(), spec: s.slice(i + 1).trim() });
  });
  return out;
}

/**
 * 计算列：为每行派生新列
 *   `新列名=常量`                 → 常量列
 *   `新列名=copy:源列名`          → 复制其他列
 *   `新列名=coalesce:A,B,...`     → 取第一个非空值（用于「102 有值用 102，否则回退 16」）
 *   `新列名=blankif:列:值1|值2`   → 当 row[列] 命中值列表时置空（''），否则**保持原值不动**
 *                                  （用于「流程状态=1 表示流程已结束 → 当前节点/负责人置空」）
 *   `新列名=const:文本`           → 显式常量（值里含 = 时用这个）
 *
 * 同名列可写多条，**按书写顺序**依次作用（见 parseAssignments）。
 */
function runComputed(cfg, rows) {
  const c = cfg || {};
  const pairs = parseAssignments(c.assignments !== undefined ? c.assignments : c.mapping);
  const onlyIfEmpty = c.onlyIfEmpty === true || c.onlyIfEmpty === 1 ||
    String(c.onlyIfEmpty) === 'true';

  return (Array.isArray(rows) ? rows : []).map((r) => {
    const o = Object.assign({}, r);
    pairs.forEach((p) => {
      if (onlyIfEmpty && !isEmpty(o[p.target])) return;
      const s = p.spec.trim();
      if (/^copy:/i.test(s)) {
        const src = s.slice(5).trim();
        o[p.target] = src && o[src] !== undefined ? o[src] : null;
      } else if (/^coalesce:/i.test(s)) {
        const list = s.slice(9).split(',').map((x) => x.trim()).filter(Boolean);
        let v = null;
        for (const src of list) {
          if (o[src] !== undefined && !isEmpty(o[src])) { v = o[src]; break; }
        }
        o[p.target] = v;
      } else if (/^blankif:/i.test(s)) {
        // blankif:列名:值1|值2 —— 命中则置空；未命中**不动**（保留上一步算出的值）
        const rest = s.slice(8);
        const i = rest.indexOf(':');
        if (i > 0) {
          const col = rest.slice(0, i).trim();
          const vals = rest.slice(i + 1).split('|').map((x) => x.trim()).filter(Boolean);
          const cur = o[col];
          const curText = cur === null || cur === undefined ? '' : String(cur).trim();
          if (vals.some((v) => v === curText)) o[p.target] = '';
        }
      } else if (/^map:/i.test(s)) {
        // map:源列名:0=进行中|1=流转完成|*=其他 —— 枚举值翻译
        //   未命中且没有 * 兜底时，保持原值（避免把未知枚举变成空）
        const rest = s.slice(4);
        const i = rest.indexOf(':');
        if (i > 0) {
          const col = rest.slice(0, i).trim();
          const pairsText = rest.slice(i + 1);
          const cur = o[col];
          const curText = cur === null || cur === undefined ? '' : String(cur).trim();
          let hit = null;
          let fallback;
          pairsText.split('|').forEach((seg) => {
            const t = seg.trim();
            if (!t) return;
            const eq = t.indexOf('=');
            if (eq < 0) return;
            const from = t.slice(0, eq).trim();
            const to = t.slice(eq + 1).trim();
            if (from === '*') fallback = to;
            else if (from === curText) hit = to;
          });
          if (hit !== null) o[p.target] = hit;
          else if (fallback !== undefined) o[p.target] = fallback;
          else o[p.target] = cur === undefined ? null : cur;
        }
      } else if (/^const:/i.test(s)) {
        o[p.target] = s.slice(6).trim();
      } else {
        o[p.target] = p.spec;
      }
    });
    return o;
  });
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

    /* ---------- 新增：关联 / 当前待办 / 计算列 ---------- */

    case 'join': {
      // join 需要区分左右两路输入：由 run()/preview 通过 ctx.inputs 提供
      // （多上游的默认拼接结果仍是 ctx 未提供时的兜底，但那样等于左右混在一起，必须拒绝）
      const inputs = (ctx && ctx.inputs) || {};
      if (!Array.isArray(inputs.left) || !Array.isArray(inputs.right)) {
        throw new Error('关联节点需要左右两路上游数据（请分别连接左表、右表到本节点）');
      }
      out = runJoin(node, inputs.left, inputs.right);
      break;
    }

    case 'pick_current_task': {
      out = runPickCurrentTask(cfg, rows);
      break;
    }

    case 'computed': {
      out = runComputed(cfg, rows);
      break;
    }

    default:
      break;
  }

  return out;
}

/**
 * 确保 upsert 主键列上有唯一索引
 *
 * 为什么必须做：sink_table 的 upsert 依赖 `ON DUPLICATE KEY UPDATE`，
 * 而 schema.ensureTableFor 自动建表时只有 `PRIMARY KEY (id)`（自增 id），
 * 业务主键列（如 data_id）**没有唯一索引**。此时 ON DUPLICATE 永远不命中，
 * 每次运行都会再插一遍 → 目标表行数翻倍，静默污染数据。
 *
 * 约束：
 *   - 只处理本平台表（jdywh_ 前缀）与默认数据源（可查 information_schema）；
 *   - 列名必须是 ASCII 标识符，避免拼接风险；
 *   - 唯一键过长时（utf8mb4 下 VARCHAR(255) = 1020 字节）回退为前缀索引 (191)。
 *
 * @returns {Promise<{ok:boolean, existed?:boolean, added?:boolean, reason?:string}>}
 */
async function ensureUpsertKey(source, table, keyField) {
  const column = String(keyField || '').trim();
  if (!column || !/^[A-Za-z0-9_]+$/.test(column)) {
    return { ok: false, reason: `主键字段名不合法：${column}` };
  }
  if (!schema.isOwnTable(table)) return { ok: false, reason: `非本平台表，不做索引变更：${table}` };
  const dsId = source && source.id !== undefined ? Number(source.id) : 0;
  if (dsId !== 0) return { ok: false, reason: '仅默认数据源支持自动补唯一索引' };

  const colRows = await db.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!colRows.length) return { ok: false, reason: `目标表 ${table} 没有列 ${column}` };

  const idxRows = await db.query(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND NON_UNIQUE = 0
      LIMIT 1`,
    [table, column]
  );
  if (idxRows.length) return { ok: true, existed: true };

  const indexName = `uk_flow_${column}`.slice(0, 64);
  try {
    await schema.safeRaw(
      `ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${indexName}\` (\`${column}\`)`,
      [], [table]
    );
    return { ok: true, added: true };
  } catch (err) {
    // 键过长（老版本 InnoDB 767 字节上限）→ 退化成前缀唯一索引
    if (/key was too long|Specified key/i.test(String(err && err.message))) {
      await schema.safeRaw(
        `ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${indexName}\` (\`${column}\`(191))`,
        [], [table]
      );
      return { ok: true, added: true, prefix: 191 };
    }
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
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

    /*
     * upsert 前置检查：业务主键必须有唯一索引，否则 ON DUPLICATE 不命中 → 重复插入。
     * 这一步只对新建/已有本平台表做「补建唯一索引」，不删除任何数据。
     * 失败时**直接报错**而不是静默继续——静默会写脏数据。
     */
    if (mode === 'upsert' && cfg.keyField) {
      const keyCheck = await ensureUpsertKey(source, table, cfg.keyField);
      if (keyCheck.ok === false) {
        throw new Error(`upsert 主键不可用：${keyCheck.reason}`);
      }
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
 * 归集节点的输入
 *
 * 默认语义保持不变：多上游**拼接（concat）**——按连线顺序把各上游输出连起来。
 * 唯一例外是 join 节点：它需要区分左右两路，因此额外返回 inputs.left / inputs.right。
 *   - 优先用节点配置 leftSource / rightSource（上游节点 id）；
 *   - 未配置时按连线声明顺序：第一条进 left，第二条进 right；
 *   - 只连了一路时，另一路为空数组（左关联可正常跑，右列为空）。
 *
 * @param {object} node 节点
 * @param {Array} edges 连线
 * @param {object} outputs 已完成节点的输出 { nodeId: rows }
 * @returns {{upstream: string[], rows: Array, inputs: {left?: Array, right?: Array}}}
 */
function collectInput(node, edges, outputs) {
  const upstream = (edges || []).filter((e) => e.to === node.id).map((e) => e.from);
  const rowsOf = (uid) => (Array.isArray(outputs[uid]) ? outputs[uid] : []);

  let rows = [];
  upstream.forEach((uid) => { rows = rows.concat(rowsOf(uid)); });

  const inputs = {};
  if (node && node.type === 'join') {
    const cfg = node.config || {};
    const idOf = (v) => {
      if (v === null || v === undefined || String(v).trim() === '') return undefined;
      return upstream.find((u) => String(u) === String(v).trim());
    };
    let leftId = idOf(cfg.leftSource);
    let rightId = idOf(cfg.rightSource);
    if (!leftId && !rightId) {
      leftId = upstream[0];
      rightId = upstream[1];
    } else if (!leftId) {
      leftId = upstream.find((u) => u !== rightId);
    } else if (!rightId) {
      rightId = upstream.find((u) => u !== leftId);
    }
    inputs.left = leftId === undefined ? [] : rowsOf(leftId);
    inputs.right = rightId === undefined ? [] : rowsOf(rightId);
  }

  return { upstream, rows, inputs };
}

/**
 * 执行流程
 * @param {number} flowId
 * @param {string} trigger manual / cron / webhook / push（推送触发）
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

      // 找到上游节点的输出作为输入（多上游默认拼接；join 额外归集左右两路）
      const collected = collectInput(node, flow.edges, outputs);
      const input = collected.upstream.length ? collected.rows : rows;

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
          out = runClean(node, input, { flowId, inputs: collected.inputs });
        }

        outputs[node.id] = out;
        // join 的「输入行数」按左表计（右表是 1:N 事件，混在一起算会误导排查）
        const isJoin = node.type === 'join' && collected.inputs.left;
        nodeLogs.push({
          nodeId: node.id, type: node.type,
          name: (node.label || (def && def.name) || node.type),
          inputRows: isJoin ? collected.inputs.left.length : input.length,
          outputRows: out.length,
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
 *  推送触发（on_push）
 *
 *  语义：jdywh_flows.run_mode = 'trigger'（前端「执行方式 → 数据触发」，
 *  列注释本来就是 manual/cron/trigger，无需加列、无需 DDL）。
 *
 *  推送落库成功后触发，两个挂载点（都已接好）：
 *    - src/flow-ingest.js handle() 末尾 —— 流程推送（项目 102）
 *    - src/routes/push.js data_create/update 分支末尾 —— 数据推送（项目 16）
 *  两者都是 setImmediate 异步执行，**绝不阻塞推送响应**。
 *
 *  防重入：同一流程运行中 → 跳过；运行结束后 3 秒内再次触发 → 合并跳过
 *  （简道云一次业务操作常连发多条推送，不合并会把同一流程跑几十遍）。
 * ══════════════════════════════════════════════════════════ */

/** on_push 默认冷却时间（毫秒）：运行结束后此时长内的重复触发直接合并 */
const ON_PUSH_COOLDOWN_MS = 3000;

/** 运行闸门：flowId → { running, startedAt, finishedAt } */
const RUN_GATES = new Map();

/** 流程是否引用了某个项目（项目列，或任一 source_project 节点） */
function flowReferencesProject(flow, projectId) {
  const pid = Number(projectId);
  if (!flow || !Number.isFinite(pid) || pid <= 0) return false;

  const rawProjectId = flow.projectId !== undefined ? flow.projectId : flow.project_id;
  if (Number(rawProjectId) === pid) return true;

  let nodes = flow.nodes;
  if (!Array.isArray(nodes)) nodes = parseJson(nodes, []);
  if (!Array.isArray(nodes)) return false;
  return nodes.some((n) => {
    if (!n || n.type !== 'source_project') return false;
    const cfg = n.config || {};
    return Number(cfg.projectId) === pid;
  });
}

/**
 * 从流程列表中挑出「该推送应当触发的流程」（纯函数，可单测）
 *
 * 条件：启用中 + run_mode = 'trigger' + 引用了该 projectId
 * @param {Array} rows 流程行（DB 原始行或 publicFlow 结果都支持）
 * @param {number} projectId
 * @returns {Array}
 */
function selectOnPushFlows(rows, projectId) {
  return (Array.isArray(rows) ? rows : []).filter((f) => {
    if (!f) return false;
    const status = f.status === undefined || f.status === null ? 1 : Number(f.status);
    if (status !== 1) return false;
    const mode = flowRunMode(f);
    if (mode !== 'trigger') return false;
    return flowReferencesProject(f, projectId);
  });
}

/** 取流程执行方式（DB 原始行 run_mode / publicFlow 的 runMode 都支持） */
function flowRunMode(f) {
  const v = f.runMode !== undefined && f.runMode !== null ? f.runMode : f.run_mode;
  return String(v === undefined || v === null || v === '' ? 'manual' : v);
}

/**
 * 归一化执行方式：兼容前端/外部传 'on_push' 的写法，落库统一为 'trigger'
 * （jdywh_flows.run_mode 没有 on_push 取值，前端 RUN_MODE 用的也是 trigger）
 */
function normalizeRunMode(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (!s) return 'manual';
  if (s === 'on_push' || s === 'onpush' || s === 'push' || s === 'trigger') return 'trigger';
  if (s === 'cron' || s === 'manual') return s;
  return 'manual';
}

/**
 * 抢占运行闸门（防重入 + 冷却）
 * @returns {{started: boolean, reason?: string, waitMs?: number}}
 */
function beginFlowRun(flowId, options) {
  const o = options || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const cooldown = Number.isFinite(o.cooldownMs) ? o.cooldownMs : ON_PUSH_COOLDOWN_MS;
  const key = String(flowId);
  const cur = RUN_GATES.get(key);
  if (cur) {
    if (cur.running) return { started: false, reason: 'running' };
    const idle = now - cur.finishedAt;
    if (idle >= 0 && idle < cooldown) {
      return { started: false, reason: 'cooldown', waitMs: cooldown - idle };
    }
  }
  RUN_GATES.set(key, { running: true, startedAt: now, finishedAt: 0 });
  return { started: true };
}

/** 释放运行闸门（进入冷却期） */
function endFlowRun(flowId, options) {
  const o = options || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  RUN_GATES.set(String(flowId), { running: false, startedAt: 0, finishedAt: now });
}

/** 清空闸门（仅测试/排障用） */
function resetFlowRunGates() {
  RUN_GATES.clear();
}

/**
 * 读取所有启用中的 trigger 流程（只读查询）
 *
 * 为什么要缓存：这段查询在**每一次数据推送**后都会跑（push.js / flow-ingest.js），
 * 而流程表极小、变化极少。不缓存的话每次推送多一次 DB 往返；
 * 缓存 5 秒可把「一次业务操作连发 N 条推送」压成 1 次查询。
 * 流程的增/改/删会主动失效缓存，因此不会长时间读到旧配置。
 */
const TRIGGER_FLOW_CACHE_TTL_MS = 5000;
let triggerFlowCache = null;   // { at: number, rows: Array }

/** 让 trigger 流程缓存失效（流程增删改后调用） */
function invalidateTriggerFlowCache() {
  triggerFlowCache = null;
}

async function listTriggerFlows() {
  const envTtl = Number(process.env.FLOW_TRIGGER_CACHE_MS);
  const ttl = Number.isFinite(envTtl) && envTtl >= 0 ? envTtl : TRIGGER_FLOW_CACHE_TTL_MS;
  const now = Date.now();
  if (triggerFlowCache && now - triggerFlowCache.at < ttl) return triggerFlowCache.rows;

  const rows = await db.query(
    `SELECT f.* FROM jdywh_flows f
      WHERE f.status = 1 AND f.run_mode = 'trigger'
      ORDER BY f.id ASC`
  );
  triggerFlowCache = { at: now, rows };
  return rows;
}

/**
 * 推送触发入口：异步执行，不阻塞调用方（推送响应）
 *
 * 永不抛异常（内部全部兜住），返回触发明细供日志/排查。
 *
 * @param {number} projectId 刚落库推送的项目
 * @param {object} [options]
 * @param {Array}  [options.flows]   注入流程列表（测试用，跳过 DB）
 * @param {Function} [options.runner] 注入执行器 (flowId, trigger) => Promise（测试用）
 * @param {number} [options.now]     注入当前时间（测试用）
 * @param {number} [options.cooldownMs] 冷却时间
 * @returns {Promise<{ok:boolean, projectId:number, matched:number[], triggered:number[],
 *                    skipped:Array<{flowId:number, reason:string}>}>}
 */
async function triggerOnPush(projectId, options) {
  const opts = options || {};
  const pid = Number(projectId);
  const result = { ok: true, projectId: pid, matched: [], triggered: [], skipped: [] };

  if (!Number.isFinite(pid) || pid <= 0) return result;
  // 应急开关：FLOW_ON_PUSH=0 时一律不自动跑（生产排障用，无需改代码）
  if (String(process.env.FLOW_ON_PUSH === undefined ? '1' : process.env.FLOW_ON_PUSH) === '0') {
    result.ok = false;
    result.disabled = true;
    return result;
  }

  let rows;
  try {
    rows = Array.isArray(opts.flows) ? opts.flows : await listTriggerFlows();
  } catch (err) {
    console.error('[flow] 查询推送触发流程失败:', err.message);
    result.ok = false;
    result.error = err.message;
    return result;
  }

  const matched = selectOnPushFlows(rows, pid);
  result.matched = matched.map((f) => Number(f.id));

  const runner = typeof opts.runner === 'function'
    ? opts.runner
    : (id, trigger) => run(id, trigger);

  for (const f of matched) {
    const flowId = Number(f.id);
    const gate = beginFlowRun(flowId, { now: opts.now, cooldownMs: opts.cooldownMs });
    if (!gate.started) {
      result.skipped.push({ flowId, reason: gate.reason });
      continue;
    }
    result.triggered.push(flowId);
    // 关键：setImmediate 异步执行，不 await，推送响应已经返回
    setImmediate(() => {
      Promise.resolve()
        .then(() => runner(flowId, 'push'))
        .catch((err) => {
          console.error(`[flow] 推送触发流程 #${flowId} 执行失败:`, err && err.message ? err.message : err);
        })
        .finally(() => endFlowRun(flowId, { now: opts.now }));
    });
  }

  return result;
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
    // 推送触发的对等写法：run_mode='trigger' 等价于「推送后自动执行（on_push）」
    triggerMode: String(r.run_mode || 'manual') === 'trigger' ? 'on_push' : 'manual',
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
      normalizeRunMode(input.runMode),
      String(input.cronExpr || '').trim() || null,
      input.status === 0 ? 0 : 1,
      userId || null,
    ]
  );
  invalidateTriggerFlowCache();
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
  if (input.runMode !== undefined) set('run_mode', normalizeRunMode(input.runMode));
  if (input.cronExpr !== undefined) set('cron_expr', String(input.cronExpr || '').trim() || null);
  if (input.status !== undefined) set('status', Number(input.status) ? 1 : 0);

  if (!fields.length) return flow;
  params.push(id);
  await db.query(`UPDATE jdywh_flows SET ${fields.join(', ')} WHERE id = ?`, params);
  invalidateTriggerFlowCache();
  return getById(id);
}

async function remove(id) {
  const flow = await getById(id);
  if (!flow) throw new Error('流程不存在');
  await db.query('DELETE FROM jdywh_flow_logs WHERE flow_id = ?', [id]);
  await db.query('DELETE FROM jdywh_flows WHERE id = ?', [id]);
  invalidateTriggerFlowCache();
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
  collectInput,
  // 关联 / 事件收敛（供节点执行与单测直接调用）
  runJoin, runPickCurrentTask, runComputed,
  pickCurrentEvent, sortByTime, groupByColumn, columnsOf, normKey, numOf, timeOf,
  resolveCutoffTime, nodeAliasMap, applyNodeAlias,
  // 推送触发（on_push）
  ON_PUSH_COOLDOWN_MS,
  triggerOnPush, selectOnPushFlows, flowReferencesProject, flowRunMode, normalizeRunMode,
  beginFlowRun, endFlowRun, resetFlowRunGates, listTriggerFlows, invalidateTriggerFlowCache,
  ensureUpsertKey,
  parseKv, parseAssignments, getByPath, evalExpression, publicFlow,
};