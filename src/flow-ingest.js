'use strict';

const db = require('./db');
const schema = require('./schema');
const fields = require('./fields');
const projects = require('./projects');
const flow = require('./flow');
const flowState = require('./flow-state');
const flows = require('./flows');

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
 *
 * V9：补上 `id` 与 `jdy_op_time` 两列 —— deriveNodeTimes 用 (jdy_op_time, id) 作排序键，
 * 因为 V8 实测 37 个实例存在 header_created_at 的 1ms 级回退，只按时间戳排序会把
 * 「完成」认到「回退前」的那条事件上。
 */
async function eventsOfInstance(projectId, instanceId, extraEvent) {
  const table = schema.makeTableName(projectId);
  const rows = await db.query(
    `SELECT id, jdy_op_time, header_created_at, event_flow_name, event_current_assignee, event_finish_action,
            event_created_count, event_completed_count, event_canceled_count
       FROM \`${table}\`
      WHERE event_instance_id = ?
      ORDER BY jdy_op_time ASC, id ASC`,
    [instanceId]
  );
  // 本次事件可能尚未落库（同批 upsert 后已落库，这里兜底去重）
  if (extraEvent && extraEvent.header_created_at !== undefined) {
    const key = `${extraEvent.header_created_at}|${extraEvent.event_flow_name}|${extraEvent.event_finish_action}`;
    const exists = rows.some((r) => `${r.header_created_at}|${r.event_flow_name}|${r.event_finish_action}` === key);
    if (!exists) rows.push(extraEvent);
    rows.sort((a, b) => (flowState.toMs(a.jdy_op_time || a.header_created_at) || 0)
      - (flowState.toMs(b.jdy_op_time || b.header_created_at) || 0));
  }
  return rows;
}

/* ══════════════════════════════════════════════════════════
 *  V9：节点提交时间自动同步
 *
 *  用户诉求（原话）
 *  ----------------
 *  「实际因为当前节点提交，进入下一节点时就要自动同步当前节点的提交时间；
 *    如策略开通节点后进入实施对接节点，策略开通时间就要同步到数据表策略开通时间中。」
 *
 *  实现口径
 *  --------
 *  1. 用 `flowState.deriveNodeTimes(events)` 从流程事件流推导 8 个节点时间
 *     （节点 N 的时间 = 该节点最后一次「完成动作」发生的时刻，即**离开该节点那一刻**）；
 *  2. 目标列按 `COLUMN_COMMENT = 'X(解析)'` **动态**解析（不硬编码 w_xxx_p）；
 *  3. **只补空、不清值、不覆盖已有值** —— 用户投诉的另一半正是值丢失，
 *     已有非空时间一律保留（简道云「时间自动化」推来的值更权威）；
 *  4. 开关 `FLOW_SYNC_NODE_TIMES=0` 一键关停（默认开启）。
 * ══════════════════════════════════════════════════════════ */

/** 节点时间同步开关（默认开启） */
function nodeTimeSyncEnabled() {
  const v = process.env.FLOW_SYNC_NODE_TIMES;
  return String(v === undefined || v === null || v === '' ? '1' : v) !== '0';
}

/**
 * 「实时行」新鲜度窗口（毫秒，默认 10 分钟）
 *
 * 为什么需要这个窗口——这是 V9 最关键的取舍：
 *   8 个时间列的业务权威来源是简道云「时间自动化」字段原值。
 *   V8 对账（_work/VERDICT.md）实证：用流程事件推导值**覆盖**这些列，
 *   与业务表比对命中率会从 100% 掉到 26/90；V9 复测同样证明，
 *   把历史行的空位补上会让「非 fresh 行逐格 0 差异」立刻出现 8 格发散。
 *
 *   但用户诉求必须满足：「当前节点提交、进入下一节点时，就要自动同步当前节点的提交时间」。
 *   正确的时机只在**实时链路**上：
 *     · 一次业务操作里，流程事件（102）常常比数据推送（16）**先到**，
 *       此时时间列还是空的，补上就是「立刻看到时间」；
 *       随后简道云自己的时间自动化值到了，会被真实值覆盖（我们只补空，永不覆盖）。
 *     · 历史行早已不再推送，补空只会让解析表永久偏离业务表 → 必须不做。
 *
 * 因此：只对「最近 maxAgeMs 内还有推送」的行补空（默认 10 分钟）。
 * 历史回填需要显式 opt-in（scripts/v9-sync-node-times.js --force-backfill）。
 */
const NODE_TIME_FRESH_DEFAULT_MS = 10 * 60 * 1000;

/** 当前生效的新鲜度窗口（每次读取，便于测试用环境变量覆盖） */
function nodeTimeFreshMs() {
  const v = Number(process.env.FLOW_SYNC_NODE_TIMES_WINDOW_MS);
  return Number.isFinite(v) && v >= 0 ? v : NODE_TIME_FRESH_DEFAULT_MS;
}

/** 「业务时间字段名 → 解析列名」缓存：表名 → { at, map } */
const TIME_COL_CACHE = new Map();
const TIME_COL_TTL_MS = 60000;

/**
 * 按 COLUMN_COMMENT 动态解析 8 个时间字段对应的解析列
 *
 * 不硬编码 w_17930941355xx_p：列名随表单字段变化，注释「X(解析)」才是稳定标识。
 * 解析失败不抛错（返回空 map，调用方自然跳过）。
 */
async function resolveTimeColumns(table) {
  const hit = TIME_COL_CACHE.get(table);
  const now = Date.now();
  if (hit && now - hit.at < TIME_COL_TTL_MS) return hit.map;

  const map = {};
  try {
    const rows = await db.query(
      `SELECT column_name, column_comment
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?`,
      [table]
    );
    const byComment = new Map();
    for (const r of rows) {
      const c = String(r.COLUMN_COMMENT || '').trim();
      if (c) byComment.set(c, r.COLUMN_NAME);
    }
    for (const field of Object.values(flowState.TIME_FIELD_OF_NODE)) {
      const col = byComment.get(`${field}(解析)`) || byComment.get(field);
      if (col) map[field] = col;
    }
  } catch (err) {
    console.error('[flow] 解析节点时间列失败:', err.message);
  }
  TIME_COL_CACHE.set(table, { at: now, map });
  return map;
}

/** 清空列名缓存（自检/建列后强制刷新用） */
function clearTimeColumnCache() {
  TIME_COL_CACHE.clear();
}

/**
 * 把推导出的节点时间**补进**解析表（只补空位、只补实时行）
 *
 * 三条铁律：
 *   1. 推导值为空 → 不写（保留原值，避免清空 —— 用户投诉的另一半就是值丢失）；
 *   2. 目标单元格已有非空值 → 不写（简道云推来的值更权威）；
 *   3. 只对「最近 freshens.maxAgeMs 内仍有推送」的行补空（历史行补空会让
 *      解析表永久偏离业务表，V8 对账已明令禁止）。
 *
 * @param {string} parsedTable
 * @param {string} dataId
 * @param {object} derived deriveNodeTimes 的结果
 * @param {object} [options]
 * @param {number} [options.maxAgeMs] 新鲜度窗口；传 Infinity 关闭新鲜度限制（历史回填）
 * @param {number} [options.now] 注入当前时间（测试用）
 * @returns {{filled: Array, skipped?: string, excluded?: Array}}
 */
async function fillMissingNodeTimes(parsedTable, dataId, derived, options) {
  const o = options || {};
  const maxAgeMs = Number.isFinite(o.maxAgeMs) ? Number(o.maxAgeMs) : nodeTimeFreshMs();
  const now = Number.isFinite(o.now) ? Number(o.now) : Date.now();

  const colMap = await resolveTimeColumns(parsedTable);
  const targets = [];
  for (const field of Object.values(flowState.TIME_FIELD_OF_NODE)) {
    if (!colMap[field]) continue;                       // 该列不存在 → 跳过
    const ms = derived && derived.times ? derived.times[field] : null;
    if (ms === null || ms === undefined) continue;       // 推导为空 → 一律不写（保留原值）
    const local = flowState.toLocalString(ms);
    if (!local) continue;
    targets.push({ field, column: colMap[field], value: local });
  }
  if (!targets.length) return { filled: [], derived };

  const alias = targets.map((t) => `\`${t.column}\` AS \`${t.field}\``).join(', ');
  const cur = await db.queryOne(
    `SELECT ${alias}, jdy_op_time FROM \`${parsedTable}\` WHERE jdy_data_id = ? LIMIT 1`,
    [dataId]
  );
  if (!cur) return { filled: [], derived, skipped: 'row_not_found' };

  // 新鲜度闸门：历史行不补空（避免解析表偏离业务表）
  if (maxAgeMs !== Infinity) {
    const lastPush = flowState.toMs(cur.jdy_op_time);
    if (lastPush === null || now - lastPush > maxAgeMs) {
      return { filled: [], derived, skipped: 'stale_row', lastPushMs: lastPush };
    }
  }

  const toFill = targets.filter((t) => {
    const v = cur[t.field];
    return v === null || v === undefined || String(v).trim() === '';
  });
  if (!toFill.length) return { filled: [], derived };

  /*
   * 二次保护：SQL 里再判一次「当前为空」才写。
   * 即使 SELECT 与 UPDATE 之间被别的链路（数据推送）写入，也不会覆盖真实值。
   */
  const sql = `UPDATE \`${parsedTable}\`
                   SET ${toFill.map((t) => `\`${t.column}\` = CASE WHEN \`${t.column}\` IS NULL OR \`${t.column}\` = '' THEN ? ELSE \`${t.column}\` END`).join(', ')}
                 WHERE jdy_data_id = ?`;
  await db.query(sql, [...toFill.map((t) => t.value), dataId]);

  return { filled: toFill.map((t) => ({ field: t.field, column: t.column, value: t.value })), derived };
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
     * 【重要】不再用流程事件聚合值**覆盖** 8 个节点时间列
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
     * V9 修正（用户 2026-10-31 投诉「没有准时同步节点时间」）
     * ------------------------------------------------------
     * 覆盖确实是错的，但「完全不写」也不对：简道云的时间自动化字段偶尔晚到/漏推，
     * 空位就永远补不上（215 的实施对接时间就是这样丢的）。
     * 折中口径——**只补空位，绝不覆盖、绝不清空**：
     *   · 推导值非空 且 目标单元格为空  → 补写（这是「进入下一节点即同步上一节点提交时间」的兜底）
     *   · 推导值为空                    → 不写（保留原值，避免清空）
     *   · 目标单元格已有非空值          → 不写（简道云推来的值更权威）
     * 开关：FLOW_SYNC_NODE_TIMES=0 一键关停（默认开启）。
     */
    const derive = nodeTimeSyncEnabled()
      ? flowState.deriveNodeTimes(events)
      : null;

    const keys = Object.keys(set);
    let runRows = 0;
    if (keys.length) {
      const r = await db.query(
        `UPDATE \`${parsedTable}\` SET ${keys.map((c) => `\`${c}\`=?`).join(', ')} WHERE jdy_data_id=?`,
        [...keys.map((c) => set[c]), instanceId]
      );
      runRows = r.affectedRows;
    }

    // 节点提交时间：只补空位、只补实时行（写库在 UPSERT 之后，保证随后触发的流程能读到）
    let timeFill = { filled: [] };
    if (derive) {
      try {
        timeFill = await fillMissingNodeTimes(parsedTable, instanceId, derive);
      } catch (err) {
        console.error('[flow] 同步节点时间失败:', err.message);
      }
    }
    if (timeFill.filled && timeFill.filled.length) {
      console.log(`[flow] 补写节点时间 ${instanceId}: ${timeFill.filled.map((f) => `${f.field}=${f.value}`).join(', ')}`);
    }

    if (!keys.length && !(timeFill.filled && timeFill.filled.length)) {
      // 两个运行态列都算不出（例如流程已结束、事件缺 flow_name）、且没有可补的时间：
      // 不能返回失败，否则上层会认为同步异常；这里如实说明原因。
      return {
        synced: false,
        reason: '无可写的运行态列或节点时间（当前节点/负责人未算出，时间列也已齐备）',
        nodeTimes: { filled: [] },
      };
    }

    return {
      synced: runRows > 0 || (timeFill.filled && timeFill.filled.length > 0),
      table: parsedTable,
      node: agg.currentNode,
      owner: agg.currentOwner,
      columns: keys.length,
      nodeTimes: {
        derived: derive ? derive.timesLocal : null,
        filled: timeFill.filled || [],
      },
    };
  } catch (err) {
    console.error('[flow] 同步流程运行态失败:', err.message);
    return { synced: false, reason: err.message };
  }
}

/**
 * 推送触发（on_push）
 *
 * 推送已经落库成功后，反查所有「引用了本项目 + run_mode='trigger'」的流程，
 * 交给 flows.triggerOnPush 用 setImmediate 异步执行。
 *
 * 三个硬约束：
 *   1. **不 await** —— 推送响应不能被流程执行拖慢（拒绝简道云超时重推）；
 *   2. **不抛异常** —— 流程跑失败只写 console + 流程日志，推送本身仍是成功；
 *   3. **防重入** —— 同一流程运行中/冷却期内的重复推送由 flows 侧的闸门合并。
 */
function triggerOnPushAfterSave(projectId) {
  try {
    const p = flows.triggerOnPush(projectId);
    if (!p || typeof p.then !== 'function') return;
    p.then((r) => {
      if (r && r.triggered && r.triggered.length) {
        console.log(`[flow] 推送触发 ${r.triggered.length} 个流程: ${r.triggered.join(', ')}`);
      } else if (r && r.error) {
        console.error('[flow] 推送触发查询失败:', r.error);
      }
    }).catch((err) => {
      console.error('[flow] 推送触发流程失败:', err && err.message ? err.message : err);
    });
  } catch (err) {
    console.error('[flow] 推送触发流程失败:', err && err.message ? err.message : err);
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

  // 推送触发：落库成功后异步跑引用了本项目的流程（不阻塞推送响应）
  triggerOnPushAfterSave(project.id);

  const parts = [];
  if (sync.added.length) parts.push(`新增列: ${sync.added.join(', ')}`);
  if (filled) parts.push(`写入字段: ${filled} 个`);
  if (Object.keys(parsedValues).length) parts.push(`解析值: ${Object.keys(parsedValues).length} 个`);
  if (subInfo.length) parts.push(`子表: ${subInfo.join(', ')}`);
  if (runInfo && runInfo.synced) {
    parts.push(`流程运行态: 节点=${runInfo.node || '-'} 负责人=${runInfo.owner || '-'}`);
  }
  if (runInfo && runInfo.nodeTimes && runInfo.nodeTimes.filled.length) {
    parts.push(`补节点时间: ${runInfo.nodeTimes.filled.map((f) => f.field).join('/')}`);
  }

  return {
    message: parts.join('; ') || '流程推送已写入',
    fieldCount: filled,
    runState: runInfo,
  };
}

module.exports = {
  handle, ensureFlowFieldDefs, syncRunStateToFormProject, eventsOfInstance,
  triggerOnPushAfterSave,
  // V9：节点提交时间自动同步
  nodeTimeSyncEnabled, nodeTimeFreshMs, NODE_TIME_FRESH_DEFAULT_MS,
  resolveTimeColumns, fillMissingNodeTimes, clearTimeColumnCache,
};
