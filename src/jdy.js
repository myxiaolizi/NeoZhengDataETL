'use strict';

/**
 * 简道云数据推送协议工具
 * 参考：https://hc.jiandaoyun.com/open/11507
 */

const crypto = require('crypto');

/** 推送事件（op）中文说明 */
const OP_LABELS = {
  // 数据事件推送
  data_create: '数据提交',
  data_update: '数据修改',
  data_remove: '数据删除',
  data_recover: '数据恢复',
  // 表单事件推送
  form_update: '表单结构变更',
  // 消息推送
  flow_message: '流程消息',
  form_schedule_message: '自定义时间提醒',
  data_create_message: '新数据提交提醒',
  data_update_message: '数据修改提醒',
  form_backlog_message: '流程待办提醒',
  form_cc_message: '流程抄送提醒',
  form_flow_finished_message: '流程完成提醒',
  // 流程推送
  flow_state_change: '流程状态变更',
  flow_task_change: '流程待办变更',
  flow_cc_create: '产生抄送',
};

/** 事件大类 */
const OP_GROUPS = {
  data_create: 'data',
  data_update: 'data',
  data_remove: 'data',
  data_recover: 'data',
  form_update: 'form',
  flow_state_change: 'flow',
  flow_task_change: 'flow',
  flow_cc_create: 'flow',
};

function opLabel(op) {
  if (!op) return '未知事件';
  return OP_LABELS[op] || op;
}

function opGroup(op) {
  if (!op) return 'other';
  if (OP_GROUPS[op]) return OP_GROUPS[op];
  if (String(op).endsWith('_message')) return 'message';
  return 'other';
}

/**
 * 计算简道云签名
 * signature = sha1( "{nonce}:{payload}:{secret}:{timestamp}" )  十六进制
 * @param {string} nonce
 * @param {string} payload 原始请求体字符串
 * @param {string} secret
 * @param {string} timestamp
 */
function calcSignature(nonce, payload, secret, timestamp) {
  const content = [nonce, payload, secret, timestamp].join(':');
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex');
}

/**
 * 校验请求签名
 * @returns {{ok:boolean, reason:string, expected?:string, received?:string}}
 */
function verifySignature({ nonce, timestamp, payload, secret, received }) {
  if (!secret) return { ok: false, reason: '项目未配置 Secret' };
  if (!nonce || !timestamp) return { ok: false, reason: '缺少 nonce 或 timestamp 查询参数' };
  if (!received) return { ok: false, reason: '缺少 X-JDY-Signature 请求头' };
  const expected = calcSignature(nonce, payload, secret, timestamp);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(received).trim(), 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, reason: ok ? 'ok' : '签名不匹配', expected, received: String(received).trim() };
}

/** 从推送 body 中提取数据 ID（不同 op 结构不同） */
function extractDataId(op, data) {
  if (!data || typeof data !== 'object') return null;
  if (op === 'data_remove') return data._id || null;
  if (data._id) return String(data._id);
  if (data.data && data.data._id) return String(data.data._id);
  return null;
}

/** 从推送 body 中提取表单名称 */
function extractFormName(op, data) {
  if (!data || typeof data !== 'object') return null;
  if (data.formName) return data.formName;
  if (data.name && op === 'form_update') return data.name;
  if (data.entry_name) return data.entry_name;
  if (data.data && data.data.formName) return data.data.formName;
  return null;
}

/** 从推送 body 中提取表单 ID */
function extractEntryId(op, data) {
  if (!data || typeof data !== 'object') return null;
  if (data.entryId) return data.entryId;
  if (data.data && data.data.entryId) return data.data.entryId;
  return null;
}

/** 推送事件触发时间（毫秒时间戳），优先 opTime，其次 send_time */
function extractOpTime(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.opTime !== undefined && body.opTime !== null && body.opTime !== '') {
    const n = Number(body.opTime);
    if (Number.isFinite(n)) return n;
  }
  if (body.send_time) {
    const t = Date.parse(body.send_time);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

module.exports = {
  OP_LABELS,
  OP_GROUPS,
  opLabel,
  opGroup,
  calcSignature,
  verifySignature,
  extractDataId,
  extractFormName,
  extractEntryId,
  extractOpTime,
};
