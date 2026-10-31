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

/**
 * 主流程节点顺序（与业务系统列顺序一致）
 *
 * ⚠️ 历史遗留：首节点写的是流程事件流里的名字「开始」，而 `NODE_ALIAS` 又把
 * 「开始」归一化成业务名「销售签约」→ `NODE_ORDER.indexOf(normalizeNode('开始'))`
 * 恒等于 -1。这导致 V9 之前「单据提交时间」在事件聚合里**永远算不出来**
 * （用户投诉「在策略开通节点也没有同步到单据提交时间」的代码级原因之一）。
 *
 * 为保持向后兼容，NODE_ORDER 的取值不变（可能被历史脚本引用），
 * 新的推导逻辑统一使用 `CANONICAL_NODE_ORDER`（首节点 = 销售签约）。
 */
const NODE_ORDER = ['开始', '策略开通', '实施对接', '对接审核', '客服处理', '客户培训', '连锁使用', '策略审核'];

/** 规范化后的节点顺序（推导时间列时以此为准；「开始」= 业务名「销售签约」） */
const CANONICAL_NODE_ORDER = [
  '销售签约', '策略开通', '实施对接', '对接审核', '客服处理', '客户培训', '连锁使用', '策略审核',
];

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

/**
 * 历史/别名节点名 → 标准节点名
 *
 * ⚠️ V8 补齐 `开始 → 销售签约`：
 * 业务流程表的第一个节点叫「**销售签约**」，而流程事件流里该节点名是「**开始**」。
 * V7 的 C3 推导规则（`pick_current_task`）已经做了这个别名，
 * 但**推送实时链路**用的就是这个文件，之前漏了同一条别名 ——
 * 后果是：只要有实例停在首节点并再次收到流程推送，
 * `parsed_16.flow_current_node` 就会被写成「开始」，
 * 与业务表的值域（销售签约）不一致，且会顺着宽表流进看板。
 * 因此这里必须与 C3 规则保持同一套别名表。
 */
const NODE_ALIAS = {
  开始: '销售签约',
  销售签约: '销售签约',
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

/**
 * 8 个时间字段：标准（规范化）节点名 → 业务系统字段名
 *
 * 键统一使用 `CANONICAL_NODE_ORDER` 的写法（首节点 = 销售签约）；
 * 用原始名字查询请走 `timeFieldOfNode(name)`（内部会先 normalizeNode）。
 */
const TIME_FIELD_OF_NODE = {
  销售签约: '单据提交时间',
  策略开通: '策略开通时间',
  实施对接: '实施对接时间',
  对接审核: '对接审核时间',
  客服处理: '客服处理时间',
  客户培训: '客户培训时间',
  连锁使用: '连锁使用时间',
  策略审核: '策略审核时间',
};

/** 节点名（任意别名）→ 业务时间字段名；非 8 节点返回 null */
function timeFieldOfNode(name) {
  const node = normalizeNode(name);
  if (!node) return null;
  if (TIME_FIELD_OF_NODE[node]) return TIME_FIELD_OF_NODE[node];
  // 兼容「开始」这类仍以原始名查询的调用方
  const legacy = NODE_ORDER.indexOf(node) >= 0 ? node : null;
  if (legacy && TIME_FIELD_OF_NODE[legacy]) return TIME_FIELD_OF_NODE[legacy];
  const idx = NODE_ORDER.findIndex((n) => normalizeNode(n) === node);
  if (idx >= 0) return TIME_FIELD_OF_NODE[CANONICAL_NODE_ORDER[idx]] || null;
  return null;
}

/** 归一化后的节点名是否属于 8 个主流程节点 */
function isMainNode(name) {
  return CANONICAL_NODE_ORDER.indexOf(normalizeNode(name)) >= 0;
}

/** 归一化节点名 */
function normalizeNode(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return NODE_ALIAS[n] || n;
}

/** 节点在主流程序列中的下标（按规范化后的顺序）；不在序列里返回 -1 */
function nodeIndex(name) {
  return CANONICAL_NODE_ORDER.indexOf(normalizeNode(name));
}

/**
 * 任意时间表示 → epoch 毫秒（不可解析返回 null）
 *
 * 支持：Date（mysql2 DATETIME 默认返回 Date）、number（毫秒；10 位秒级时间戳自动 ×1000）、
 *       'YYYY-MM-DD HH:MM:SS[.mmm]'（按 Node 进程本地时区解析，即 Asia/Shanghai）、ISO8601。
 */
function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (v > 0 && v < 1e11) return Math.round(v * 1000);   // 10 位秒级
    return v;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return toMs(Number(s));
  // 'YYYY-MM-DD HH:MM:SS[.mmm]' 在 Node 里按本地时区解析；
  // 'YYYY-MM-DDTHH:MM:SSZ' 按 UTC。两种都交给 Date.parse。
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

/**
 * 从一批事件聚合出流程状态（**历史口径**，保留向后兼容）
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
  //    （V9 修复：index 改用规范化顺序，否则首节点「开始/销售签约」恒为 -1）
  const cut = currentNode ? nodeIndex(currentNode) : CANONICAL_NODE_ORDER.length;
  const times = {};
  for (let i = 0; i < CANONICAL_NODE_ORDER.length; i += 1) {
    const node = CANONICAL_NODE_ORDER[i];
    const field = TIME_FIELD_OF_NODE[node];
    times[field] = (i < cut && completed[node] !== undefined) ? completed[node] : null;
  }

  return { currentNode, currentOwner, completed, times };
}

/* ══════════════════════════════════════════════════════════
 *  V9 新增：节点提交时间自动同步（deriveNodeTimes）
 *
 *  业务口径（2026-10-31 用户明确要求）
 *  ------------------------------------
 *  「当前节点提交、进入下一节点时，就要自动同步当前节点的提交时间。
 *    如策略开通节点后进入实施对接节点，策略开通时间就要同步到数据表策略开通时间中。」
 *
 *  因此：节点 N 的时间 = 该节点**被提交（离开该节点）那一刻**，
 *  取「该节点最后一次完成动作所在事件的 jdy_op_time」。
 *  - 有 created 待办但**从来没有完成动作**的节点 → 不给时间（不写空值）；
 *  - **不按当前节点截断**：进入下一节点即写入上一节点时间（这正是用户要求的实时性）；
 *  - 排序键用 (jdy_op_time, id)：V8 实测 37 个实例存在 header_created_at 的 1ms 级回退，
 *    单靠时间戳排序会把「完成」认成「回退前」的那条事件。
 * ══════════════════════════════════════════════════════════ */

/**
 * deriveNodeTimes 的默认口径（全部可覆盖，默认值保持向后兼容）
 *
 * ⚠️ `includeTransferAsComplete` 默认 **false**：业务方 2026-10-27 确认「转交只是换负责人，
 * 节点仍在处理中，不算完成」。V9 库里「实施对接」有 65 条「转交」事件，
 * 若把转交算完成，实施对接时间会被写成转交时刻（严重错误）。
 * 需要时可用 FLOW_NODE_TIME_TRANSFER_AS_COMPLETE=1 打开。
 */
const DERIVE_DEFAULTS = Object.freeze({
  /** 视为「完成」的动作集合（默认 = COMPLETE_ACTIONS，向后兼容） */
  completeActions: COMPLETE_ACTIONS,
  /** 是否把 转交/transfer/移交 也算完成（默认 false） */
  includeTransferAsComplete: false,
  /** 额外并入的完成动作（如 ['移交']） */
  extraCompleteActions: null,
  /** 同一节点多次完成时取哪一个：'last'（默认，用户口径：离开节点那一刻） | 'first' */
  prefer: 'last',
  /** 是否按当前节点截断（默认 false：进入下一节点即同步上一节点） */
  trimByCurrentNode: false,
  /** 只采纳时间 >= minMs 的事件（0 = 不限，防脏数据） */
  minMs: 0,
});

/** 转交类动作（默认不算完成） */
const TRANSFER_ACTIONS = ['transfer', 'transfer_after', '转交', '移交'];

/**
 * 从事件流推导 8 个节点提交时间
 *
 * @param {Array} events 事件行（需要 event_flow_name / event_finish_action / header_created_at，
 *                       推荐同时带 jdy_op_time 与 id 作为排序键）
 * @param {object} [options] 见 DERIVE_DEFAULTS
 * @returns {{
 *   times: Object<string, number|null>,      // 业务字段名 → epoch 毫秒
 *   timesLocal: Object<string, string|null>, // 业务字段名 → 'YYYY-MM-DD HH:MM:SS'
 *   byNode: Object<string, object>,          // 标准节点名 → {ms, local, action, ...}
 *   nodesWithoutTime: string[],              // 见过事件但无完成动作的节点
 *   currentNode: string|null, currentOwner: string|null,
 *   eventCount: number, options: object,
 * }}
 */
function deriveNodeTimes(events, options) {
  const o = Object.assign({}, DERIVE_DEFAULTS, options || {});
  const actions = new Set(o.completeActions || COMPLETE_ACTIONS);
  if (o.includeTransferAsComplete) TRANSFER_ACTIONS.forEach((a) => actions.add(a));
  if (Array.isArray(o.extraCompleteActions)) o.extraCompleteActions.forEach((a) => actions.add(a));
  const minMs = Number.isFinite(Number(o.minMs)) ? Number(o.minMs) : 0;

  // 1. 归一化 + 排序（jdy_op_time 优先，id 兜底；缺列时退回 header_created_at）
  const list = (Array.isArray(events) ? events : [])
    .filter((e) => e && typeof e === 'object')
    .map((e, i) => {
      const opMs = toMs(e.jdy_op_time);
      const headerMs = toMs(e.header_created_at);
      const sortMs = opMs !== null ? opMs : headerMs;
      const idNum = Number(e.id);
      return {
        e,
        i,
        sortMs: sortMs === null ? Number.MAX_SAFE_INTEGER : sortMs,
        id: Number.isFinite(idNum) ? idNum : -1,
        eventMs: sortMs,
      };
    })
    .filter((x) => x.eventMs !== null && x.eventMs >= minMs)
    .sort((a, b) => (a.sortMs - b.sortMs) || (a.id - b.id) || (a.i - b.i));

  // 2. 逐节点收集「完成」候选
  const perNode = {};
  const seen = {};
  for (const x of list) {
    const e = x.e;
    const node = normalizeNode(e.event_flow_name);
    if (!node || CANONICAL_NODE_ORDER.indexOf(node) < 0) continue;
    seen[node] = true;
    const rec = perNode[node] || (perNode[node] = {
      node, completes: [], createdCount: 0, completedCount: 0, canceledCount: 0,
    });
    const created = Number(e.event_created_count);
    const completed = Number(e.event_completed_count);
    const canceled = Number(e.event_canceled_count);
    if (Number.isFinite(created)) rec.createdCount += created;
    if (Number.isFinite(completed)) rec.completedCount += completed;
    if (Number.isFinite(canceled)) rec.canceledCount += canceled;

    const act = String(e.event_finish_action === null || e.event_finish_action === undefined
      ? '' : e.event_finish_action).trim();
    const isComplete = (act && actions.has(act)) || (!act && Number.isFinite(completed) && completed > 0);
    if (isComplete) rec.completes.push({ ms: x.eventMs, action: act || null, eventId: e.id, sortMs: x.sortMs });
  }

  // 3. 每个节点取一个时刻（默认 last：离开节点那一刻）
  const byNode = {};
  const nodesWithoutTime = [];
  for (const node of CANONICAL_NODE_ORDER) {
    const rec = perNode[node];
    if (!rec) continue;
    if (!rec.completes.length) {
      nodesWithoutTime.push(node);
      byNode[node] = {
        ms: null, local: null, action: null, eventId: null,
        createdCount: rec.createdCount, completedCount: rec.completedCount,
        canceledCount: rec.canceledCount, completed: false,
      };
      continue;
    }
    const chosen = o.prefer === 'first' ? rec.completes[0] : rec.completes[rec.completes.length - 1];
    byNode[node] = {
      ms: chosen.ms,
      local: toLocalString(chosen.ms),
      action: chosen.action,
      eventId: chosen.eventId === undefined ? null : chosen.eventId,
      createdCount: rec.createdCount,
      completedCount: rec.completedCount,
      canceledCount: rec.canceledCount,
      completed: true,
      completes: rec.completes.length,
    };
  }

  // 4. 当前节点 / 当前负责人（最后一条事件，与 aggregate 口径一致）
  const tail = list.length ? list[list.length - 1].e : null;
  const currentNode = tail ? (normalizeNode(tail.event_flow_name) || null) : null;
  const currentOwner = tail
    ? (tail.event_current_assignee === null || tail.event_current_assignee === undefined
      ? null : String(tail.event_current_assignee))
    : null;

  // 5. 输出 8 个业务字段
  const cut = o.trimByCurrentNode && currentNode ? nodeIndex(currentNode) : CANONICAL_NODE_ORDER.length;
  const times = {};
  const timesLocal = {};
  for (let i = 0; i < CANONICAL_NODE_ORDER.length; i += 1) {
    const node = CANONICAL_NODE_ORDER[i];
    const field = TIME_FIELD_OF_NODE[node];
    const hit = byNode[node] && byNode[node].completed && i < cut ? byNode[node] : null;
    times[field] = hit ? hit.ms : null;
    timesLocal[field] = hit ? hit.local : null;
  }

  return {
    times,
    timesLocal,
    byNode,
    seenNodes: Object.keys(seen),
    nodesWithoutTime,
    currentNode,
    currentOwner,
    eventCount: list.length,
    options: {
      prefer: o.prefer,
      trimByCurrentNode: !!o.trimByCurrentNode,
      includeTransferAsComplete: !!o.includeTransferAsComplete,
      actions: Array.from(actions),
      minMs,
    },
  };
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
  CANONICAL_NODE_ORDER,
  COMPLETE_ACTIONS,
  NON_COMPLETE_ACTIONS,
  TRANSFER_ACTIONS,
  NODE_ALIAS,
  TIME_FIELD_OF_NODE,
  DERIVE_DEFAULTS,
  normalizeNode,
  nodeIndex,
  timeFieldOfNode,
  isMainNode,
  toMs,
  aggregate,
  deriveNodeTimes,
  toLocalString,
};
