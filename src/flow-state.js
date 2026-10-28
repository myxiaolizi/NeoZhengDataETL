'use strict';

/**
 * 流程状态聚合器（CRM流程推送 → 业务系统所需字段）
 *
 * 背景与口径
 * ----------
 * 业务系统需要【当前节点】【当前负责人】以及 8 个节点的「完成时间」。
 * 这些值在简道云表单里要么没有（当前节点/负责人是流程运行态），
 * 要么表单里的「时间自动化」字段语义是「进入该节点的时间」（不是完成时间），
 * 与业务口径不符。真正可靠的来源是流程事件流（CRM流程推送）：
 * 每个事件都带 flow_name / finish_action / 创建待办 / 完成待办。
 *
 * 完成时间的判定（2026-10-27 与业务方确认）
 * ------------------------------------------
 *   - 只有「完成」才算：finish_action ∈ {forward, batch_forward, auto_approve}
 *     transfer（转交）只是换负责人、节点仍在处理中，不算完成；
 *     back（回退）/ close / activate 也不是完成。
 *     对应界面流程动态里的「提交」「批量提交」「对接审核完成」等标识。
 *   - 同一节点多次完成（被退回后重走）时，取**首次**完成时间。
 *   - 节点若发生回退，回退后的节点不再显示时间：时间只填到「当前节点之前」，
 *     当前节点及其之后一律留空。
 *   - 「对接审核」历史名称是「解决方案确认」，流程动态统一显示为「对接审核」。
 *   - 对接结果为「全量对接」的记录没有「对接审核」节点。
 *
 * 当前节点 / 当前负责人
 * ---------------------
 *   取该实例最新一条事件：flow_name 即当前节点，current_assignee 即当前负责人。
 *   历史节点名需归一化（开通→策略开通、系统对接→实施对接、使用培训→客户培训）。
 */

/** 主流程节点顺序（与业务系统列顺序一致） */
const NODE_ORDER = ['开始', '策略开通', '实施对接', '对接审核', '客服处理', '客户培训', '连锁使用', '策略审核'];

/**
 * 视为「完成」的动作。
 *
 * 同时收录英文原始动作与中文可读文本：`flow.js` 落库时会把 finish_action
 * 翻译成中文（forward→提交、batch_forward→批量提交、auto_approve→去重审批 …），
 * 而重新处理的原始报文里又是英文。两套都要认，否则完成时间会全部算空。
 */
const COMPLETE_ACTIONS = new Set([
  // 英文原始动作
  'forward', 'batch_forward', 'auto_approve',
  // 中文可读文本（落库值）
  '提交', '批量提交', '去重审批',
]);

/** 非完成动作（显式列出便于阅读与排查；不参与判定，仅供文档） */
const NON_COMPLETE_ACTIONS = new Set([
  'transfer', 'back', 'close', 'activate', 'reject', 'sign_after',
  '转交', '回退', '关闭', '激活', '否决', '后加签',
]);

/** 历史/别名节点名 → 标准节点名 */
const NODE_ALIAS = {
  解决方案确认: '对接审核',
  对接审核: '对接审核',
  开通: '策略开通',
  策略开通: '策略开通',
  系统对接: '实施对接',
  实施对接: '实施对接',
  使用培训: '客户培训',
  客户培训: '客户培训',
  客户结论: '策略审核',
};

/** 8 个时间字段：标准节点名 → 业务系统字段名 */
const TIME_FIELD_OF_NODE = {
  开始: '单据提交时间',
  策略开通: '策略开通时间',
  实施对接: '实施对接时间',
  对接审核: '对接审核时间',
  客服处理: '客服处理时间',
  客户培训: '客户培训时间',
  连锁使用: '连锁使用时间',
  策略审核: '策略审核时间',
};

/** 归一化节点名 */
function normalizeNode(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return NODE_ALIAS[n] || n;
}

/** 节点在主流程序列中的下标；不在序列里返回 -1 */
function nodeIndex(name) {
  return NODE_ORDER.indexOf(normalizeNode(name));
}

/**
 * 从一批事件聚合出流程状态。
 *
 * @param {Array<{header_created_at,event_flow_name,event_current_assignee,event_finish_action}>} events
 * @returns {{
 *   currentNode: string|null, currentOwner: string|null,
 *   completed: Object<string, number|null>,   // 节点名 → 首次完成时间(ms)
 *   times: Object<string, number|null>,       // 业务字段名 → 完成时间(ms)，已按截断规则处理
 * }}
 */
function aggregate(events) {
  const list = (Array.isArray(events) ? events : [])
    .filter((e) => e && e.header_created_at !== null && e.header_created_at !== undefined)
    .sort((a, b) => Number(a.header_created_at) - Number(b.header_created_at));

  // 1. 各节点首次完成时间
  const completed = {};
  for (const e of list) {
    const node = normalizeNode(e.event_flow_name);
    if (!node) continue;
    const act = String(e.event_finish_action || '');
    if (!COMPLETE_ACTIONS.has(act)) continue;      // 转交/回退/关闭不算完成
    const t = Number(e.header_created_at);
    if (!Number.isFinite(t)) continue;
    if (completed[node] === undefined || t < completed[node]) completed[node] = t;
  }

  // 2. 当前节点 / 当前负责人：取最新一条事件
  const last = list.length ? list[list.length - 1] : null;
  const currentNode = last ? (normalizeNode(last.event_flow_name) || null) : null;
  const currentOwner = last
    ? (last.event_current_assignee ? String(last.event_current_assignee) : null)
    : null;

  // 3. 按「当前节点截断」：只保留当前节点之前的节点
  const cut = currentNode ? nodeIndex(currentNode) : NODE_ORDER.length;
  const times = {};
  for (let i = 0; i < NODE_ORDER.length; i += 1) {
    const node = NODE_ORDER[i];
    const field = TIME_FIELD_OF_NODE[node];
    times[field] = (i < cut && completed[node] !== undefined) ? completed[node] : null;
  }

  return { currentNode, currentOwner, completed, times };
}

/** 时间毫秒 → 业务系统使用的本地时间字符串（Asia/Shanghai） */
function toLocalString(ms) {
  if (ms === null || ms === undefined || ms === '') return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = {
  NODE_ORDER,
  COMPLETE_ACTIONS,
  NON_COMPLETE_ACTIONS,
  NODE_ALIAS,
  TIME_FIELD_OF_NODE,
  normalizeNode,
  nodeIndex,
  aggregate,
  toLocalString,
};
