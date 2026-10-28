'use strict';

/**
 * 接收日志的「自然语言变更描述」
 *
 * 需求（2026-10-27）：在原始推送内容上方增加一段描述，用自然语言说明
 * 本次推送「修改了什么、增加了什么」，让人不打开 JSON 也能看懂。
 *
 * 设计
 * ----
 * - 只做「有据可查」的描述：字段确实变了才提，没变就说明没变。
 * - 优先与上一次成功推送的同一条数据比较（回放历史日志）。
 * - 首次收到该数据时，逐列说明「新增了哪些字段」。
 * - 流程推送单独一套说法（节点、负责人、待办变化）。
 * - 不臆测业务含义，只描述数据事实。
 */

/** 值 → 便于阅读的短文本 */
function brief(value, maxLen) {
  const limit = maxLen || 40;
  if (value === null || value === undefined) return '(空)';

  // ISO 时间串（简道云的 UTC 时间）→ 北京时间，便于阅读
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    const t = Date.parse(value);
    if (Number.isFinite(t)) {
      return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    }
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.length ? `[${value.length} 项]` : '(空数组)';
    const keys = Object.keys(value);
    if (keys.includes('name') && value.name) return String(value.name);
    if (keys.includes('phone') && value.phone) return String(value.phone);
    if (keys.includes('province')) {
      return [value.province, value.city, value.district, value.detail].filter(Boolean).join('') || '(空地址)';
    }
    return `{${keys.slice(0, 3).join(',')}${keys.length > 3 ? '…' : ''}}`;
  }
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (s === '') return '(空)';
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

/** 归一化用于比较（对象转稳定字符串） */
function stableKey(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  return String(v);
}

/**
 * 描述表单推送的字段变更
 *
 * @param {object} ctx
 * @param {object} ctx.curr      本次推送的 values（字段键 → 值）
 * @param {object} ctx.prev      上一次同 data_id 成功推送的 values；无则 null
 * @param {object} ctx.labelOf   字段键 → 中文名 的函数
 * @param {string[]} [ctx.skip]  不参与比较的字段键（如系统时间戳）
 * @returns {string[]} 若干句自然语言描述
 */
function describeFormChange(ctx) {
  const curr = ctx.curr || {};
  const prev = ctx.prev;
  const labelOf = typeof ctx.labelOf === 'function' ? ctx.labelOf : (k) => k;
  const skip = new Set(ctx.skip || []);

  const keys = Object.keys(curr).filter((k) => !skip.has(k));
  if (!keys.length) return ['本次推送不含业务字段。'];

  if (!prev) {
    // 首次收到
    const nonEmpty = keys.filter((k) => stableKey(curr[k]) !== '');
    if (!nonEmpty.length) return ['首次收到该数据，但所有字段均为空。'];
    const names = nonEmpty.slice(0, 12).map(labelOf);
    const more = nonEmpty.length > 12 ? ` 等 ${nonEmpty.length} 个字段` : '';
    return [`首次收到该数据，写入 ${nonEmpty.length} 个字段：${names.join('、')}${more}。`];
  }

  const added = [];
  const changed = [];
  const cleared = [];

  for (const k of keys) {
    const before = stableKey(prev[k]);
    const after = stableKey(curr[k]);
    if (before === after) continue;

    const name = labelOf(k);
    if (before === '' && after !== '') {
      added.push(`${name}：填入「${brief(curr[k])}」`);
    } else if (before !== '' && after === '') {
      cleared.push(name);
    } else {
      changed.push(`${name}：「${brief(prev[k])}」→「${brief(curr[k])}」`);
    }
  }

  const out = [];
  if (changed.length) {
    const head = changed.slice(0, 10).join('；');
    const more = changed.length > 10 ? `；另有 ${changed.length - 10} 个字段修改` : '';
    out.push(`修改了 ${changed.length} 个字段：${head}${more}。`);
  }
  if (added.length) {
    const head = added.slice(0, 10).join('；');
    const more = added.length > 10 ? `；另有 ${added.length - 10} 个字段填入` : '';
    out.push(`新填入 ${added.length} 个字段：${head}${more}。`);
  }
  if (cleared.length) {
    out.push(`清空了 ${cleared.length} 个字段：${cleared.slice(0, 10).join('、')}${cleared.length > 10 ? ' 等' : ''}。`);
  }
  if (!out.length) out.push('本次推送的业务字段与上一次相比没有变化。');
  return out;
}

/**
 * 描述流程推送的变更
 *
 * @param {object} p  flow.parse() 的结果
 * @returns {string[]}
 */
function describeFlowChange(p) {
  if (!p) return [];
  const out = [];

  const node = p.flowName || '(未知节点)';
  const evLabel = p.opLabel || p.eventType || '流程事件';
  const who = p.values && p.values.event_current_assignee;

  out.push(`收到流程推送「${evLabel}」，涉及节点「${node}」${who ? `，当前处理人 ${who}` : ''}。`);

  const lists = p.taskLists || {};
  const done = Array.isArray(lists.completed_tasks) ? lists.completed_tasks : [];
  const created = Array.isArray(lists.created_tasks) ? lists.created_tasks : [];
  const canceled = Array.isArray(lists.canceled_tasks) ? lists.canceled_tasks : [];
  const suspended = Array.isArray(lists.suspended_tasks) ? lists.suspended_tasks : [];
  const resumed = Array.isArray(lists.resumed_tasks) ? lists.resumed_tasks : [];

  const ACT = {
    auto_approve: '去重审批', forward: '提交', back: '回退', close: '关闭',
    transfer: '转交', batch_forward: '批量提交', sign_after: '后加签', reject: '否决',
  };
  const pick = (t) => (t && t.assignee && (t.assignee.name || t.assignee.username)) || '未知成员';

  if (done.length) {
    const detail = done.slice(0, 4).map((t) => {
      const a = t.finish_action ? (ACT[t.finish_action] || t.finish_action) : '完成';
      return `${pick(t)} ${a}`;
    }).join('、');
    const more = done.length > 4 ? ` 等 ${done.length} 项` : '';
    out.push(`完成待办 ${done.length} 项：${detail}${more}。`);
  }
  if (created.length) {
    out.push(`新增待办 ${created.length} 项，交予 ${[...new Set(created.map(pick))].slice(0, 5).join('、')}。`);
  }
  if (canceled.length) out.push(`取消待办 ${canceled.length} 项。`);
  if (suspended.length) out.push(`暂停待办 ${suspended.length} 项。`);
  if (resumed.length) out.push(`恢复待办 ${resumed.length} 项。`);
  if (!done.length && !created.length && !canceled.length && !suspended.length && !resumed.length) {
    out.push('本次事件未包含待办明细变化。');
  }
  return out;
}

/** 把若干句描述合成一段 HTML 安全的纯文本 */
function joinDescriptions(lines) {
  const arr = (lines || []).filter(Boolean);
  if (!arr.length) return '';
  return arr.map((s) => (s.endsWith('。') ? s : `${s}。`)).join('');
}

/** 数据推送事件的中文名 */
const DATA_OP_LABEL = {
  data_create: '新增数据',
  data_update: '修改数据',
  data_remove: '删除数据',
  data_recover: '恢复数据',
  form_update: '表单结构变更',
  form_delete: '表单删除',
};

/**
 * 为数据推送生成描述（统一入口，push.js 与历史回填共用）
 *
 * @param {object} ctx
 * @param {object} ctx.body     已解析的报文
 * @param {object|null} ctx.prev 上一次同 data_id 的 data 内容
 * @param {function} ctx.labelOf 字段键 → 中文名
 * @param {number} [ctx.fieldCount] 报文里的控件数（form_update 用）
 */
function describeDataPush(ctx) {
  const body = ctx.body || {};
  const op = String(body.op || '');
  const label = DATA_OP_LABEL[op] || op || '未知事件';

  if (op === 'data_remove') {
    const id = body.data && (body.data._id || body.data.dataId);
    return id ? `收到删除推送，已删除数据 ${id} 及其子表行。` : '收到删除推送，但报文缺少数据 ID，未执行删除。';
  }
  if (op === 'form_update') {
    const n = Number(ctx.fieldCount || 0);
    return `收到表单结构变更推送${n ? `，报文含 ${n} 个控件定义` : ''}，仅记录日志、不改动已有数据表结构。`;
  }
  if (op === 'form_delete') {
    return '收到表单删除推送，仅记录日志、不改动已有数据表结构。';
  }
  if (op !== 'data_create' && op !== 'data_update' && op !== 'data_recover') {
    return `收到未识别的事件「${label}」，仅记录原始报文，未改动数据。`;
  }

  let data = body.data || {};
  if (data && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const merged = Object.assign({}, data.data);
    Object.keys(data).forEach((k) => { if (k !== 'data' && merged[k] === undefined) merged[k] = data[k]; });
    data = merged;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};

  return joinDescriptions(describeFormChange({
    curr: data,
    prev: ctx.prev,
    labelOf: ctx.labelOf,
    skip: ['updateTime', 'updater', 'formName', 'entryId', 'appId'],
  }));
}

module.exports = {
  describeFormChange,
  describeFlowChange,
  describeDataPush,
  joinDescriptions,
  brief,
  DATA_OP_LABEL,
};
