'use strict';

const crypto = require('crypto');

/** 保留字：动态表名 / 列名冲突时追加下划线 */
const RESERVED = new Set([
  'select', 'insert', 'update', 'delete', 'from', 'where', 'order', 'group', 'by', 'table',
  'index', 'key', 'primary', 'foreign', 'references', 'join', 'left', 'right', 'inner',
  'outer', 'on', 'and', 'or', 'not', 'null', 'is', 'in', 'like', 'between', 'exists',
  'create', 'drop', 'alter', 'add', 'column', 'database', 'schema', 'grant', 'revoke',
  'union', 'all', 'distinct', 'having', 'limit', 'offset', 'as', 'asc', 'desc', 'case',
  'when', 'then', 'else', 'end', 'if', 'values', 'set', 'into', 'default',
  'status', 'condition', 'usage', 'rank', 'system', 'to', 'for', 'use', 'force', 'ignore',
  'describe', 'explain', 'lock', 'unlock', 'read', 'write', 'call', 'do', 'out',
  'inout', 'return', 'declare', 'while', 'repeat', 'loop', 'leave', 'iterate', 'cursor',
  'fetch', 'open', 'close', 'handler', 'signal', 'resignal', 'sqlexception', 'row',
  'rows', 'range', 'partition', 'current_date', 'current_time', 'current_timestamp',
  'interval', 'div', 'mod', 'xor', 'regexp', 'rlike', 'sounds', 'escape', 'collate',
]);

/** 判断字符串是否只包含 ASCII 可打印字符 */
function isAscii(str) {
  return /^[\x20-\x7E]*$/.test(str);
}

/**
 * 规范化标识符：仅保留 [A-Za-z0-9_]，其余替换为 _，首字符不能是数字
 */
function sanitizeIdent(input, fallback) {
  let s = String(input === undefined || input === null ? '' : input);
  s = s.replace(/[^0-9A-Za-z_]/g, '_');
  s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = fallback || 'col';
  if (/^[0-9]/.test(s)) s = 'c_' + s;
  return s.toLowerCase();
}

/**
 * 生成 MySQL 安全的列名。
 * 中文/非 ASCII 字段名使用 md5 短哈希，保证长度与唯一性可控。
 */
function makeColumnName(rawName, usedSet, fallbackPrefix) {
  const raw = String(rawName === undefined || rawName === null ? '' : rawName).trim();
  let base;
  if (!raw) {
    base = `${fallbackPrefix || 'col'}_${crypto.randomBytes(3).toString('hex')}`;
  } else if (isAscii(raw)) {
    base = sanitizeIdent(raw, fallbackPrefix || 'col');
  } else {
    const hash = crypto.createHash('md5').update(raw, 'utf8').digest('hex').slice(0, 10);
    base = `${fallbackPrefix || 'f'}_${hash}`;
  }
  if (base.length > 58) base = base.slice(0, 58);
  let name = base;
  let i = 1;
  while (usedSet.has(name) || RESERVED.has(name)) {
    name = `${base}_${i}`;
    i += 1;
    if (i > 999) {
      name = `${base}_${crypto.randomBytes(3).toString('hex')}`;
      break;
    }
  }
  usedSet.add(name);
  return name;
}

/** 生成项目数据表物理表名 */
function makeTableName(projectId) {
  return `jdywh_data_${Number(projectId)}`;
}

/** 生成项目日志表物理表名 */
function makeLogTableName(projectId) {
  return `jdywh_log_${Number(projectId)}`;
}

/** 反引号包裹标识符 */
function quoteIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

module.exports = {
  RESERVED,
  sanitizeIdent,
  makeColumnName,
  makeTableName,
  makeLogTableName,
  quoteIdent,
};
