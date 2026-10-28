'use strict';

/**
 * 简道云「流程推送 / 待办变更」报文解析（schema 2.0）
 *
 * 背景：
 *   数据推送的报文形如 { op:'data_create', data:{...} }，靠 body.op 判定事件。
 *   流程推送完全没有 op / data，形如：
 *     { schema:'2.0', header:{ event_type:'task_update', created_at, tenant_id },
 *       event:{ app_id, form_id, instance_id, flow_id, flow_name, version,
 *               created_tasks:[], completed_tasks:[], canceled_tasks:[],
 *               suspended_tasks:[], resumed_tasks:[] } }
 *   旧代码只认 body.op，于是把它当成「未知事件」——只写日志、不落数据，
 *   这就是「简道云显示推送成功、这边没有数据」的根因。
 *
 * 设计：
 *   - 字段键统一用下划线展平（header.event_type -> header_event_type），
 *     因为字段键只允许 [A-Za-z0-9_]，点号无法作为列标识。
 *   - 一条推送 = 一行记录，用 instance_id + created_at 作为数据 ID：
 *     同一事件重投时幂等覆盖，不同事件各自留痕，待办变更历史不会被抹掉。
 *   - 五个待办列表按「展开为子表」写入子表，保留 task_id / 状态 / 负责人 / 链接。
 *   - 额外派生几个可读摘要列（当前待办人、各类待办数量），便于直接在列表页看。
 */

/** 流程事件类型 → 中文说明 */
const FLOW_EVENT_LABELS = {
  task_update: '流程待办变更',
  flow_state_change: '流程状态变更',
  flow_instance_create: '流程发起',
  flow_instance_finish: '流程完成',
  flow_instance_delete: '流程删除',
  cc_create: '产生抄送',
};

/** 待办列表：[报文里的键, 字段键, 中文名] */
const TASK_LISTS = [
  ['created_tasks', 'event_created_tasks', '创建的待办'],
  ['completed_tasks', 'event_completed_tasks', '完成的待办'],
  ['canceled_tasks', 'event_canceled_tasks', '取消的待办'],
  ['suspended_tasks', 'event_suspended_tasks', '暂停的待办'],
  ['resumed_tasks', 'event_resumed_tasks', '恢复的待办'],
];

/**
 * 流程报文字段定义
 * key   —— 落库字段键（下划线展平）
 * name  —— 中文显示名
 * type  —— 逻辑类型
 * mode  —— 解析方式；expand 表示展开为子表
 * order —— 展示顺序
 */
const FLOW_FIELDS = [
  { key: 'schema', name: '事件版本', type: 'string', mode: 'none', order: 1 },
  { key: 'header_event_type', name: '事件类型', type: 'string', mode: 'none', order: 2 },
  { key: 'header_created_at', name: '事件生成时间', type: 'number', mode: 'timestamp', order: 3 },
  { key: 'header_tenant_id', name: '租户 ID', type: 'string', mode: 'none', order: 4 },
  { key: 'event_app_id', name: '应用 ID', type: 'string', mode: 'none', order: 5 },
  { key: 'event_form_id', name: '表单 ID', type: 'string', mode: 'none', order: 6 },
  { key: 'event_version', name: '流程版本', type: 'string', mode: 'none', order: 7 },
  { key: 'event_instance_id', name: '实例 ID', type: 'string', mode: 'none', order: 8 },
  { key: 'event_flow_id', name: '节点 ID', type: 'number', mode: 'none', order: 9 },
  { key: 'event_flow_name', name: '节点名称', type: 'string', mode: 'none', order: 10 },
  { key: 'event_created_count', name: '新增待办数', type: 'number', mode: 'none', order: 11 },
  { key: 'event_completed_count', name: '完成待办数', type: 'number', mode: 'none', order: 12 },
  { key: 'event_canceled_count', name: '取消待办数', type: 'number', mode: 'none', order: 13 },
  { key: 'event_current_assignee', name: '当前待办人', type: 'string', mode: 'none', order: 14 },
  { key: 'event_finish_action', name: '完成时动作', type: 'string', mode: 'none', order: 15 },
  { key: 'event_created_tasks', name: '创建的待办', type: 'array', mode: 'expand', order: 21 },
  { key: 'event_completed_tasks', name: '完成的待办', type: 'array', mode: 'expand', order: 22 },
  { key: 'event_canceled_tasks', name: '取消的待办', type: 'array', mode: 'expand', order: 23 },
  { key: 'event_suspended_tasks', name: '暂停的待办', type: 'array', mode: 'expand', order: 24 },
  { key: 'event_resumed_tasks', name: '恢复的待办', type: 'array', mode: 'expand', order: 25 },
];

/** 待办状态码 → 可读文本 */
const TASK_STATUS_TEXT = {
  0: '进行中',
  1: '已完成',
  2: '手动结束',
  3: '已取消',
  5: '已暂停',
};

/** 完成动作 → 可读文本 */
const FINISH_ACTION_TEXT = {
  auto_approve: '去重审批',
  forward: '提交',
  back: '回退',
  close: '关闭',
  transfer: '转交',
  batch_forward: '批量提交',
  sign_after: '后加签',
  reject: '否决',
};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 判定是否为流程推送报文
 *
 * 判定条件：没有 body.op（数据推送才有），但具备 header.event_type 与 event 对象。
 * 这样不会误伤数据推送，也不依赖 schema 字段（旧版报文可能没有）。
 */
function isFlowPayload(body) {
  if (!isPlainObject(body)) return false;
  if (body.op) return false;
  if (!isPlainObject(body.header)) return false;
  if (!body.header.event_type) return false;
  return isPlainObject(body.event);
}

/** 取待办负责人名称（assignee 可能为 null，表示成员已删除） */
function assigneeName(task) {
  if (!isPlainObject(task)) return null;
  const a = task.assignee;
  if (!isPlainObject(a)) return null;
  const name = a.name || a.username || a.integrate_id;
  return name ? String(name) : null;
}

/** 待办列表 → 适合展示的文本（用于子表可读值） */
function taskText(task) {
  if (!isPlainObject(task)) return null;
  const parts = [];
  const who = assigneeName(task);
  if (who) parts.push(who);
  if (task.status !== undefined && task.status !== null) {
    const st = TASK_STATUS_TEXT[Number(task.status)] || String(task.status);
    parts.push(st);
  }
  if (task.finish_action) {
    parts.push(FINISH_ACTION_TEXT[task.finish_action] || String(task.finish_action));
  }
  if (task.event_created_at) parts.push(String(task.event_created_at));
  return parts.join(' · ') || null;
}

/**
 * 解析流程推送报文
 *
 * @param {object} body 已解析的 JSON 报文
 * @returns {null|{eventType, opLabel, instanceId, dataId, formName, formId, flowName,
 *                 opTime, values, taskLists}}
 */
function parse(body) {
  if (!isFlowPayload(body)) return null;

  const header = body.header || {};
  const ev = body.event || {};
  const eventType = String(header.event_type || '');

  const values = {};
  values.schema = body.schema === undefined ? null : body.schema;
  values.header_event_type = eventType || null;
  values.header_created_at = header.created_at === undefined ? null : header.created_at;
  values.header_tenant_id = header.tenant_id === undefined ? null : header.tenant_id;
  values.event_app_id = ev.app_id === undefined ? null : ev.app_id;
  values.event_form_id = ev.form_id === undefined ? null : ev.form_id;
  values.event_version = ev.version === undefined ? null : ev.version;
  values.event_instance_id = ev.instance_id === undefined ? null : ev.instance_id;
  values.event_flow_id = ev.flow_id === undefined ? null : ev.flow_id;
  values.event_flow_name = ev.flow_name === undefined ? null : ev.flow_name;

  // 待办列表原样交给「展开为子表」逻辑；同时统计数量供主表直接阅读
  const taskLists = {};
  for (const [srcKey, fieldKey] of TASK_LISTS) {
    const arr = Array.isArray(ev[srcKey]) ? ev[srcKey] : [];
    taskLists[srcKey] = arr;
    values[fieldKey] = arr;
  }

  const created = taskLists.created_tasks;
  const completed = taskLists.completed_tasks;
  const canceled = taskLists.canceled_tasks;

  values.event_created_count = created.length;
  values.event_completed_count = completed.length;
  values.event_canceled_count = canceled.length;

  // 当前待办人：优先取新增待办的第一人，其次取完成待办的处理人
  const firstCreated = created.find((t) => assigneeName(t));
  const firstCompleted = completed.find((t) => assigneeName(t));
  values.event_current_assignee = assigneeName(firstCreated) || assigneeName(firstCompleted) || null;

  const firstFinish = completed.find((t) => isPlainObject(t) && t.finish_action);
  values.event_finish_action = firstFinish
    ? (FINISH_ACTION_TEXT[firstFinish.finish_action] || String(firstFinish.finish_action))
    : null;

  const instanceId = ev.instance_id ? String(ev.instance_id) : null;
  const createdAt = header.created_at === undefined || header.created_at === null
    ? null
    : String(header.created_at);

  // 数据 ID：一个事件一行。同一事件重复投递时键相同，走 upsert 幂等覆盖；
  // 不同事件各自留痕，不会把历史待办变更冲掉。
  const dataId = instanceId
    ? (createdAt ? `${instanceId}_${createdAt}` : instanceId)
    : (createdAt ? `flow_${createdAt}` : null);

  return {
    eventType,
    opLabel: FLOW_EVENT_LABELS[eventType] || eventType || '流程推送',
    instanceId,
    dataId,
    formName: ev.flow_name ? String(ev.flow_name) : (ev.form_id ? String(ev.form_id) : null),
    formId: ev.form_id ? String(ev.form_id) : null,
    flowName: ev.flow_name ? String(ev.flow_name) : null,
    opTime: Number.isFinite(Number(header.created_at)) ? Number(header.created_at) : null,
    values,
    taskLists,
  };
}

/** 供字段注册使用的定义列表（按 order 排序） */
function fieldSpecs() {
  return FLOW_FIELDS.slice().sort((a, b) => a.order - b.order);
}

/**
 * 待办行 → 子表可读行
 *
 * 原始待办里 status 是数字、assignee 是对象，直接落子表会变成
 * "3" 和一大串 JSON，看不出含义。这里统一转成中文文本，
 * 子表（子表数据页签）可直接阅读。
 */
function normalizeTaskRow(task) {
  if (!isPlainObject(task)) return null;
  const row = {};
  if (task.task_id !== undefined && task.task_id !== null) row.task_id = String(task.task_id);
  if (task.status !== undefined && task.status !== null) {
    const n = Number(task.status);
    row.status = TASK_STATUS_TEXT[n] || String(task.status);
  }
  if (task.event_created_at) row.event_created_at = String(task.event_created_at);
  const who = assigneeName(task);
  if (who) row.assignee = who;
  else if (task.assignee === null) row.assignee = '（成员已删除）';
  if (task.url) row.url = String(task.url);
  if (task.finish_action) {
    row.finish_action = FINISH_ACTION_TEXT[task.finish_action] || String(task.finish_action);
  }
  return row;
}

/** 子表字段中文名 */
const TASK_FIELD_NAMES = {
  task_id: '待办 ID',
  status: '待办状态',
  event_created_at: '待办事件生成时间',
  assignee: '待办负责人',
  url: '待办访问链接',
  finish_action: '完成时动作',
};

module.exports = {
  FLOW_EVENT_LABELS,
  FLOW_FIELDS,
  TASK_LISTS,
  TASK_STATUS_TEXT,
  FINISH_ACTION_TEXT,
  isFlowPayload,
  parse,
  fieldSpecs,
  taskText,
  assigneeName,
  normalizeTaskRow,
  TASK_FIELD_NAMES,
};
