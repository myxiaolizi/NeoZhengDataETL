'use strict';

const db = require('./db');
const schema = require('./schema');
const fields = require('./fields');
const projects = require('./projects');
const flow = require('./flow');
const flowState = require('./flow-state');

/**
 * 流程推送入库
 *
 * 一条推送 = 一行主表记录；五个待办列表展开为子表。
 * 字段定义缺失时按 flow.fieldSpecs() 自动注册，保证首次推送即可落库。
 *
 * 除原始事件外，还会把「流程运行态」同步到表单推送项目的解析表：
 *   【当前节点】【当前负责人】+ 8 个节点完成时间
 * 这样业务系统读一张解析表就能拿到全部字段，不必自己合并两个项目。
 */

async function ensureFlowFieldDefs(projectId) {
  const specs = flow.fieldSpecs();
  let defMap = await fields.getFieldDefMap(projectId);
  const existingCols = await schema.columnNames(schema.makeTableName(projectId));
  const used = new Set(existingCols || []);

  Object.keys(defMap).forEach((k) => {
    if (defMap[k] && defMap[k].column_name) used.add(defMap[k].column_name);
  });

  let order = Object.keys(defMap).length;
  for (const spec of specs) {
    if (defMap[spec.key]) continue;
    const columnName = fields.columnForField(spec.key, used);
    used.add(columnName);
    const mode = fields.canonicalMode(spec.mode);
    await db.query(
      `INSERT INTO jdywh_field_defs
         (project_id, field_name, field_key, field_type, remark, column_name, parse_mode, is_system, sort_order, enabled)
       VALUES (?,?,?,?,NULL,?,?,0,?,1)
       ON DUPLICATE KEY UPDATE field_name = VALUES(field_name), column_name = VALUES(column_name)`,
      [projectId, spec.name, spec.key, spec.type, columnName, mode, order]
    );
    order += 1;
  }

  defMap = await fields.getFieldDefMap(projectId);
  return defMap;
}

/**
 * 取某实例的全部事件（用于聚合流程状态）。
 * 直接读本项目的落库表，避免依赖内存状态——进程重启后依然能算出正确结果。
 */
async function eventsOfInstance(projectId, instanceId, extraEvent) {
  const table = schema.makeTableName(projectId);
  const rows = await db.query(
    `SELECT header_created_at, event_flow_name, event_current_assignee, event_finish_action
       FROM \`${table}\`
      WHERE event_instance_id = ?
      ORDER BY header_created_at ASC`,
    [instanceId]
  );
  // 本次事件可能尚未落库（同批 upsert 后已落库，这里兜底去重）
  if (extraEvent && extraEvent.header_created_at !== undefined) {
    const key = `${extraEvent.header_created_at}|${extraEvent.event_flow_name}|${extraEvent.event_finish_action}`;
    const exists = rows.some((r) => `${r.header_created_at}|${r.event_flow_name}|${r.event_finish_action}` === key);
    if (!exists) rows.push(extraEvent);
    rows.sort((a, b) => Number(a.header_created_at) - Number(b.header_created_at));
  }
  return rows;
}

/**
 * 把流程运行态写回「表单推送」项目的解析表。
 *
 * 归属约定（2026-10-27 与业务方确认）：
 *   【当前节点】【当前负责人】+ 8 个节点完成时间 归 CRM流程推送 维护，
 *   但列落在 CRM表单推送 的解析表（业务系统只读这一张）。
 * 找不到对应的表单项目或记录时静默跳过——流程推送本身不能因此失败。
 */
async function syncRunStateToFormProject(flowProject, instanceId, events) {
  try {
    const agg = flowState.aggregate(events);

    // 定位表单推送项目：同 code 前缀，或另有一个 crm 项目
    const target = await db.queryOne(
      `SELECT * FROM jdywh_projects
        WHERE id <> ? AND status = 1
          AND (code = 'crm' OR name LIKE '%表单%')
        ORDER BY id LIMIT 1`,
      [flowProject.id]
    );
    if (!target) return { synced: false, reason: '未找到表单推送项目' };

    const parsedTable = schema.makeParsedTableName(target.id);
    if (!(await schema.tableExists(parsedTable))) {
      return { synced: false, reason: `解析表 ${parsedTable} 不存在` };
    }

    // 目标列是否存在
    const cols = await schema.columnNames(parsedTable);
    const colSet = new Set(cols);
    const set = {};
    // 当前节点/负责人：只有能算出时才写，避免事件缺 flow_name 时把已有值清空
    if (colSet.has('flow_current_node') && agg.currentNode) set.flow_current_node = agg.currentNode;
    if (colSet.has('flow_current_owner') && agg.currentOwner) set.flow_current_owner = agg.currentOwner;

    /*
     * 【重要】不再用流程事件聚合值覆盖 8 个节点时间列
     * --------------------------------------------------
     * 2026-10-28 业务对账结论（_work/VERDICT.md）：
     *   业务系统的 8 个节点时间列 = 简道云表单「时间自动化」字段原值
     *   （库列 w_17930941355xx），不是流程事件的完成时间。
     *
     * 历史实现曾在此处用 agg.times（流程事件聚合 + 「当前节点截断」规则）覆盖这 8 列，
     * 造成三类错误：
     *   1) 命中率极低：与业务表比对仅 26/90、19/91、6/45… （raw 列原值为 100%）
     *   2) 截断规则被业务否证：业务表「实施对接」节点的记录里实施对接时间有值的有 45 条，
     *      按截断规则该列必须为空。
     *   3) 回退场景下会把已完成的节点时间清空。
     *
     * 因此：这 8 列的写入职责完全交还「表单推送」链路（parseValue('timestamp')），
     * 流程推送只负责维护 flow_current_node / flow_current_owner 两个运行态字段。
     */

    const keys = Object.keys(set);
    if (!keys.length) {
      // 两个运行态列都算不出（例如流程已结束、事件缺 flow_name）：
      // 不能返回失败，否则上层会认为同步异常；这里如实说明原因。
      return { synced: false, reason: '无可写运行态列（当前节点/负责人均未算出）' };
    }

    const r = await db.query(
      `UPDATE \`${parsedTable}\` SET ${keys.map((c) => `\`${c}\`=?`).join(', ')} WHERE jdy_data_id=?`,
      [...keys.map((c) => set[c]), instanceId]
    );

    return {
      synced: r.affectedRows > 0,
      table: parsedTable,
      node: agg.currentNode,
      owner: agg.currentOwner,
      columns: keys.length,
    };
  } catch (err) {
    console.error('[flow] 同步流程运行态失败:', err.message);
    return { synced: false, reason: err.message };
  }
}

async function handle(project, parsed, rawBody) {
  await schema.ensureProjectTables(project.id);

  const defMap = await ensureFlowFieldDefs(project.id);
  const specs = flow.fieldSpecs();

  const defs = specs.map((s) => defMap[s.key]).filter(Boolean);
  const sync = await schema.syncFieldColumns(project.id, defs, parsed.values);

  const liveCols = new Set(sync.columns);
  const parsedLiveCols = new Set(sync.parsedColumns || sync.columns);
  const autoParse = Number(project.parse_enabled) === 1;

  const columns = {};
  const parsedValues = {};
  const expandJobs = [];
  let filled = 0;

  for (const spec of specs) {
    const def = defMap[spec.key];
    if (!def || Number(def.enabled) === 0) continue;
    const raw = parsed.values[spec.key];

    if (def.parse_mode === fields.EXPAND_MODE) {
      const arr = Array.isArray(raw) ? raw : [];
      if (arr.length) {
        const rows = arr.map((t) => flow.normalizeTaskRow(t)).filter(Boolean);
        if (rows.length) {
          expandJobs.push({
            def: Object.assign({}, def, { sub_field_names: flow.TASK_FIELD_NAMES }),
            rows,
          });
        }
      }
      continue;
    }

    if (raw === null || raw === undefined || raw === '') continue;
    filled += 1;

    if (liveCols.has(def.column_name)) columns[def.column_name] = raw;

    if (autoParse && def.parse_mode && def.parse_mode !== 'none') {
      const pcol = fields.parsedColumnOf(def.column_name);
      if (!parsedLiveCols.has(pcol)) continue;
      const v = fields.parseValue(raw, def.parse_mode, def.parse_path);
      if (v !== null && v !== undefined && v !== '') {
        parsedValues[pcol] = String(v).slice(0, 500);
      }
    }
  }

  await schema.upsertRecord(project.id, {
    dataId: parsed.dataId,
    op: parsed.eventType || 'flow_task_change',
    formName: parsed.formName,
    opTime: parsed.opTime || Date.now(),
    rawJson: String(rawBody || '').slice(0, 4000000),
    columns,
    parsed: parsedValues,
  });

  const subInfo = [];
  for (const job of expandJobs) {
    try {
      const r = await schema.writeSubTable(project.id, job.def, job.rows, parsed.dataId, parsed.opTime);
      subInfo.push(`${r.table}:${r.rows}行`);
    } catch (err) {
      console.error('[flow] 子表写入失败:', err.message);
      subInfo.push(`${job.def.field_key}:失败(${err.message})`);
    }
  }

  // 关键：把流程运行态（当前节点/负责人 + 8 个节点完成时间）同步到表单解析表
  let runInfo = null;
  if (parsed.instanceId) {
    const events = await eventsOfInstance(project.id, parsed.instanceId);
    runInfo = await syncRunStateToFormProject(project, parsed.instanceId, events);
  }

  await projects.touchProject(project.id);

  const parts = [];
  if (sync.added.length) parts.push(`新增列: ${sync.added.join(', ')}`);
  if (filled) parts.push(`写入字段: ${filled} 个`);
  if (Object.keys(parsedValues).length) parts.push(`解析值: ${Object.keys(parsedValues).length} 个`);
  if (subInfo.length) parts.push(`子表: ${subInfo.join(', ')}`);
  if (runInfo && runInfo.synced) {
    parts.push(`流程运行态: 节点=${runInfo.node || '-'} 负责人=${runInfo.owner || '-'}`);
  }

  return {
    message: parts.join('; ') || '流程推送已写入',
    fieldCount: filled,
    runState: runInfo,
  };
}

module.exports = { handle, ensureFlowFieldDefs, syncRunStateToFormProject, eventsOfInstance };
