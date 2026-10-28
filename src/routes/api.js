'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const users = require('../users');
const roles = require('../roles');
const settings = require('../settings');
const mailer = require('../mailer');
const projects = require('../projects');
const schema = require('../schema');
const fields = require('../fields');
const jdy = require('../jdy');
const datasources = require('../datasources');
const dsDriver = require('../datasource');
const reports = require('../reports');
const integrations = require('../integrations');
const ai = require('../ai');
const audit = require('../audit');
const departments = require('../departments');
const projectGroups = require('../project-groups');
const forms = require('../forms');
const flows = require('../flows');
const { quoteIdent } = require('../ident');

const router = express.Router();

router.use(auth.requireAuthApi);

/* ══════════════ 当前用户 ══════════════ */

router.get('/me', (req, res) => {
  res.json({
    ok: true,
    data: Object.assign({}, req.user, {
      permissions: req.user.permissions || [],
    }),
  });
});

router.put('/me', async (req, res, next) => {
  try {
    const { displayName, email, phone, position } = req.body || {};
    if (email !== undefined && email && !users.validEmail(email)) {
      return res.status(400).json({ ok: false, message: '邮箱格式不正确' });
    }
    const patch = {};
    if (displayName !== undefined) patch.displayName = displayName;
    if (email !== undefined) patch.email = email;
    if (phone !== undefined) patch.phone = phone;
    if (position !== undefined) patch.position = position;
    await users.updateUser(req.user.id, patch);
    res.json({ ok: true, message: '个人资料已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.post('/me/password', async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body || {};
  if (confirmPassword !== undefined && newPassword !== String(confirmPassword)) {
    return res.status(400).json({ ok: false, message: '两次输入的密码不一致' });
  }
  const r = await auth.changePassword(req.user.id, oldPassword, newPassword);
  if (!r.ok) return res.status(400).json({ ok: false, message: r.message });
  auth.clearSessionCookie(res);
  res.json({ ok: true, message: '密码修改成功，请重新登录', relogin: true });
});

router.get('/me/sessions', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT token, ip, user_agent, created_at, expires_at FROM jdywh_sessions
        WHERE user_id = ? AND expires_at > NOW() ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({
      ok: true,
      data: rows.map((r) => ({
        current: r.token === (req.session && req.session.token),
        ip: r.ip,
        userAgent: r.user_agent,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      })),
    });
  } catch (err) { next(err); }
});

router.delete('/me/sessions', async (req, res, next) => {
  try {
    const keep = req.session ? req.session.token : null;
    await db.query('DELETE FROM jdywh_sessions WHERE user_id = ? AND token <> ?', [req.user.id, keep]);
    res.json({ ok: true, message: '已退出其他所有设备' });
  } catch (err) { next(err); }
});

/* ══════════════ 概览 ══════════════ */

router.get('/overview', async (req, res, next) => {
  try {
    const stats = await projects.globalStats();
    const recentLogs = [];
    const list = await projects.listProjects({});
    for (const p of list.slice(0, 5)) {
      try {
        const rows = await db.query(
          `SELECT id, op, op_label, data_id, form_name, result, created_at
             FROM \`${p.log_table}\` ORDER BY id DESC LIMIT 5`
        );
        rows.forEach((r) => recentLogs.push(Object.assign({ projectId: p.id, projectName: p.name }, r)));
      } catch (_) { /* 表不存在 */ }
    }
    recentLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ ok: true, data: { stats, recentLogs: recentLogs.slice(0, 10) } });
  } catch (err) { next(err); }
});

/* ══════════════ 项目分组 ══════════════ */

/** 分组列表（扁平）+ 树形结构，一次返回两种形态，前端按需使用 */
router.get('/project-groups', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const flat = await projectGroups.list();
    const treeData = projectGroups.buildTree(flat);
    const st = await projectGroups.stats();
    res.json({ ok: true, data: { list: flat, tree: treeData, stats: st, maxDepth: projectGroups.MAX_DEPTH } });
  } catch (err) { next(err); }
});

router.post('/project-groups', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const g = await projectGroups.createGroup(req.body || {});
    await audit.log(req, 'project_group.create', {
      targetType: 'project_group', targetId: g.id, detail: { name: g.name },
    });
    res.json({ ok: true, data: g, message: '分组创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/project-groups/:id', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const g = await projectGroups.updateGroup(req.params.id, req.body || {});
    await audit.log(req, 'project_group.update', {
      targetType: 'project_group', targetId: g.id, detail: { name: g.name },
    });
    res.json({ ok: true, data: g, message: '分组已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/**
 * 删除分组
 * 默认把该分组下的项目上移到父分组；可用 body.moveTo 指定迁往哪个分组（0=未分组）。
 * 不级联删除项目，也不删除子分组（有子分组时拒绝，需先处理）。
 */
router.delete('/project-groups/:id', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const r = await projectGroups.deleteGroup(req.params.id, {
      moveTo: body.moveTo !== undefined ? body.moveTo : undefined,
    });
    await audit.log(req, 'project_group.delete', {
      targetType: 'project_group', targetId: req.params.id,
      detail: { movedProjects: r.movedProjects, movedTo: r.movedTo },
    });
    const msg = r.movedProjects
      ? `分组已删除，${r.movedProjects} 个项目已移动到「${r.movedToName}」`
      : '分组已删除';
    res.json({ ok: true, data: r, message: msg });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 批量把项目移动到分组（groupId=0 表示移出分组） */
router.post('/project-groups/assign', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const r = await projectGroups.assignProjects(body.projectIds, body.groupId);
    await audit.log(req, 'project_group.assign', {
      targetType: 'project_group', targetId: r.groupId,
      detail: { moved: r.moved, projectIds: body.projectIds },
    });
    res.json({ ok: true, data: r, message: `已移动 ${r.moved} 个项目` });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 同级分组排序（拖拽） */
router.post('/project-groups/reorder', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const r = await projectGroups.reorder((req.body || {}).orderedIds);
    res.json({ ok: true, data: r, message: '排序已保存' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════ 项目 ══════════════ */

router.get('/projects', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    const onlyOwn = String(req.query.onlyOwn || '') === '1' && !users.isAdmin(req.user);
    // 分组筛选：groupId 缺省/'all' = 全部；'0' = 未分组；具体数字 = 该分组
    const groupId = req.query.groupId;
    const includeSubGroups = String(req.query.includeSubGroups || '') === '1';
    const rows = await projects.listProjects({
      keyword,
      userId: req.user.id,
      onlyOwn,
      groupId,
      includeSubGroups,
    });

    // 附带每个项目的统计（数据量/日志量）
    const out = [];
    for (const p of rows) {
      let dataCount = 0;
      let failedLogs = 0;
      try {
        const d = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${p.data_table}\``);
        dataCount = Number((d && d.c) || 0);
      } catch (_) { /* ignore */ }
      try {
        const l = await db.queryOne(
          `SELECT SUM(CASE WHEN result <> 'success' THEN 1 ELSE 0 END) AS f FROM \`${p.log_table}\``
        );
        failedLogs = Number((l && l.f) || 0);
      } catch (_) { /* ignore */ }

      // 计算最近 7 天趋势
      let trend = [];
      try {
        const t = await db.query(
          `SELECT DATE(received_at) AS d, COUNT(*) AS c FROM \`${p.data_table}\`
            WHERE received_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(received_at) ORDER BY d`
        );
        trend = t.map((r) => ({ date: r.d, count: Number(r.c) }));
      } catch (_) { /* ignore */ }

      out.push(Object.assign({}, p, {
        dataCount,
        failedLogs,
        columnCount: Number(p.column_count || 0),
        fieldCount: Number(p.field_count || 0),
        trend,
      }));
    }
    res.json({ ok: true, data: out });
  } catch (err) { next(err); }
});

router.post('/projects', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const { name, code, description, jdyBaseUrl, jdySecret, remark, parseEnabled,
      category, tags, groupId, datasourceId } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, message: '项目名称不能为空' });
    }
    const project = await projects.createProject(
      { name, code, description, jdyBaseUrl, jdySecret, remark, parseEnabled,
        category, tags, groupId, datasourceId },
      req.user.id
    );
    res.json({ ok: true, data: project, message: '项目创建成功，数据表已自动创建' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/projects/:id', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const columns = await schema.getDataColumns(project.id);
    const columnStats = await schema.columnFillStats(schema.makeTableName(project.id));
    const parsedTable = project.parsed_table || schema.makeParsedTableName(project.id);
    let parsedColumns = [];
    try {
      parsedColumns = await schema.columnInfo(parsedTable);
    } catch (_) { /* 解析表可能尚未创建 */ }

    const stats = await projects.projectStats(project.id);
    const fieldDefs = await fields.listFieldDefs(project.id);
    const subTables = await schema.getSubTables(project.id);

    // 数据源信息
    let datasource = null;
    try {
      datasource = await datasources.getPublic(project.datasource_id || 0);
    } catch (_) { /* ignore */ }

    res.json({
      ok: true,
      data: {
        project: Object.assign({}, project, {
          datasource_name: datasource ? datasource.name : '本机数据库',
          datasource_type: datasource ? datasource.type : 'mysql',
        }),
        columns,
        parsedColumns,
        parsedTable,
        stats,
        columnStats,
        fieldDefs,
        subTables,
        fieldMap: projects.parseFieldMap(project.field_map),
      },
    });
  } catch (err) { next(err); }
});

router.put('/projects/:id', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const project = await projects.updateProject(req.params.id, req.body || {});
    res.json({ ok: true, data: project, message: '保存成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.post('/projects/:id/regenerate-token', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const project = await projects.regenerateToken(req.params.id);
    res.json({ ok: true, data: project, message: '推送令牌已重新生成，请同步更新简道云推送地址' });
  } catch (err) { next(err); }
});

router.delete('/projects/:id', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    await projects.deleteProject(req.params.id);
    res.json({ ok: true, message: '项目已删除（含数据表、日志表与子表）' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════ 字段设置（需求 5 / 7） ══════════════ */

/** 解析方式字典 */
router.get('/field-modes', (req, res) => {
  res.json({ ok: true, data: { modes: fields.PARSE_MODES, system: fields.SYSTEM_FIELDS } });
});

/** 项目字段定义列表 */
router.get('/projects/:id/fields', auth.requirePerm('field:write'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });
    const defs = await fields.listFieldDefs(project.id);
    const cols = await schema.getDataColumns(project.id);
    const dataTable = schema.makeTableName(project.id);
    const stats = await schema.columnFillStats(dataTable);

    // 把「该字段对应列的非空行数」附带到定义上，界面据此区分「真实列 / 空列」
    const enriched = defs.map((d) => Object.assign({}, d, {
      rows: Number(stats[d.column_name] || 0),
    }));

    res.json({ ok: true, data: { fieldDefs: enriched, columns: cols, stats } });
  } catch (err) { next(err); }
});

/** 解析粘贴的字段表（预览，不落库） */
router.post('/projects/:id/fields/parse', auth.requirePerm('field:write'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const text = String((req.body && req.body.text) || '');
    if (!text.trim()) return res.status(400).json({ ok: false, message: '请粘贴字段表格内容' });

    const parsed = fields.parseFieldTable(text);
    const dataTable = schema.makeTableName(project.id);
    const existing = await schema.columnNames(dataTable);
    const stats = await schema.columnFillStats(dataTable);
    const existingDefs = await fields.getFieldDefMap(project.id);
    const decorated = fields.decorateFields(parsed.fields, existing, existingDefs, stats);

    // 对照现有表结构：标出列是否已存在、以及该列已承载多少行数据
    const existingSet = new Set(existing);
    decorated.forEach((f) => {
      f.exists = existingSet.has(f.columnName);
      f.rows = Number(stats[f.columnName] || 0);
    });

    res.json({
      ok: true,
      data: {
        fields: decorated,
        errors: parsed.errors,
        warnings: parsed.warnings || [],
        skipped: parsed.skipped,
        source: parsed.source || '',
        total: decorated.length,
        systemCount: decorated.filter((f) => f.isSystem).length,
        newCount: decorated.filter((f) => !f.exists).length,
      },
    });
  } catch (err) { next(err); }
});

/** 导入字段定义（保存 + 按需建列 + 回填列注释） */
router.post('/projects/:id/fields/import', auth.requirePerm('field:write'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const body = req.body || {};
    let list = Array.isArray(body.fields) ? body.fields : null;

    const dataTable = schema.makeTableName(project.id);
    const existing = await schema.columnNames(dataTable);
    const colStats = await schema.columnFillStats(dataTable);

    // 先清理历史误导入的垃圾定义（无数据的非法字段键），避免继续污染字段表
    const purged = await fields.purgeInvalidFieldDefs(project.id, colStats);
    // 再校正历史字段定义（把重复列指向真正承载数据的那一列）
    const reconciled = await fields.reconcileFieldDefs(project.id, existing, colStats);
    const existingDefs = await fields.getFieldDefMap(project.id);

    if (!list) {
      const parsed = fields.parseFieldTable(String(body.text || ''));
      if (!parsed.fields.length) {
        return res.status(400).json({ ok: false, message: parsed.errors[0] || '未解析到字段' });
      }
      list = fields.decorateFields(parsed.fields, existing, existingDefs, colStats);
    } else {
      // 前端回传的字段列表也做一次列名校正，避免重复建列
      list = fields.decorateFields(list, existing, existingDefs, colStats);
    }

    if (!list.length) return res.status(400).json({ ok: false, message: '没有可导入的字段' });

    const mode = body.mode === 'merge' ? 'merge' : 'replace';
    const defs = await fields.saveFieldDefs(project.id, list, { replace: mode === 'replace' });

    // 按字段定义建列 / 补注释（用已有数据的样本推断类型）
    const sampleRow = await db.queryOne(
      `SELECT raw_json FROM \`${project.data_table}\` ORDER BY id DESC LIMIT 1`
    );
    let samples = {};
    if (sampleRow && sampleRow.raw_json) {
      try {
        const raw = JSON.parse(sampleRow.raw_json);
        const d = raw.data || {};
        samples = d.data && typeof d.data === 'object' ? Object.assign({}, d, d.data) : d;
      } catch (_) { /* ignore */ }
    }

    const sync = await schema.syncFieldColumns(project.id, defs, samples);

    res.json({
      ok: true,
      data: { fieldDefs: defs, added: sync.added, altered: sync.altered, reconciled, purged: purged.removed },
      message: `已导入 ${defs.length} 个字段定义` +
        (purged.removed ? `，清理 ${purged.removed} 个无效定义` : '') +
        (reconciled ? `，校正 ${reconciled} 个历史列名` : '') +
        (sync.added.length ? `，新建 ${sync.added.length} 个列` : ''),
    });
  } catch (err) {
    console.error('[fields/import]', err);
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 更新单个字段定义 */
router.put('/projects/:id/fields/:fieldKey', auth.requirePerm('field:write'), async (req, res, next) => {
  try {
    const def = await fields.updateFieldDef(req.params.id, req.params.fieldKey, req.body || {});
    res.json({ ok: true, data: def, message: '字段已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 批量设置解析方式 */
router.post('/projects/:id/fields/parse-mode', auth.requirePerm('field:write'), async (req, res, next) => {
  try {
    const items = (req.body && req.body.items) || [];
    const n = await fields.bulkSetParseMode(req.params.id, items);
    res.json({ ok: true, message: `已更新 ${n} 个字段的解析方式` });
  } catch (err) { next(err); }
});

/** 删除字段定义 */
router.delete('/projects/:id/fields/:fieldKey', auth.requirePerm('field:write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM jdywh_field_defs WHERE project_id = ? AND field_key = ?', [
      req.params.id, req.params.fieldKey,
    ]);
    res.json({ ok: true, message: '字段定义已删除（数据列保留）' });
  } catch (err) { next(err); }
});

/** 重建：按字段定义重新同步所有列（含解析列） */
router.post('/projects/:id/fields/sync', auth.requirePerm('field:write'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    // 先校正历史字段定义，再同步结构
    const liveCols = await schema.columnNames(schema.makeTableName(project.id));
    const liveStats = await schema.columnFillStats(schema.makeTableName(project.id));
    await fields.normalizeParseModes(project.id);
    const purged = await fields.purgeInvalidFieldDefs(project.id, liveStats);
    const reconciled = await fields.reconcileFieldDefs(project.id, liveCols, liveStats);

    const defs = await fields.listFieldDefs(project.id);
    const sampleRow = await db.queryOne(
      `SELECT raw_json FROM \`${project.data_table}\` ORDER BY id DESC LIMIT 1`
    );
    let samples = {};
    if (sampleRow && sampleRow.raw_json) {
      try {
        const raw = JSON.parse(sampleRow.raw_json);
        const d = raw.data || {};
        samples = d.data && typeof d.data === 'object' ? Object.assign({}, d, d.data) : d;
      } catch (_) { /* ignore */ }
    }

    const sync = await schema.syncFieldColumns(project.id, defs, samples);

    // 补齐项目记录中的表名（兼容 v2 升级上来的旧项目）
    const dataTable = schema.makeTableName(project.id);
    const parsedTable = schema.makeParsedTableName(project.id);
    if (project.parsed_table !== parsedTable || project.raw_table !== dataTable) {
      await db.query(
        'UPDATE jdywh_projects SET data_table = ?, parsed_table = ?, raw_table = ? WHERE id = ?',
        [dataTable, parsedTable, dataTable, project.id]
      );
    }

    // 回填历史数据的解析列
    const backfill = await backfillParsed(project, defs);
    const resync = await syncRawFromParsed(project, defs);

    res.json({
      ok: true,
      data: { added: sync.added, altered: sync.altered, backfill, resync, reconciled, purged: purged.removed, parsedTable },
      message: `结构同步完成：新增 ${sync.added.length} 列，回填 ${backfill.updated} 行解析值` +
        (resync.filled ? `，补齐 ${resync.filled} 行原始数据` : '') +
        (purged.removed ? `，清理 ${purged.removed} 个无效定义` : '') +
        (reconciled ? `，校正 ${reconciled} 个历史列名` : ''),
    });
  } catch (err) {
    console.error('[fields/sync]', err);
    res.status(400).json({ ok: false, message: err.message });
  }
});

/**
 * 回填解析数据表
 *
 * 从原始数据表读取 raw_json，重新计算解析值，写入解析数据表
 * （jdywh_parsed_N，含 <column>_p 解析列）。
 */
async function backfillParsed(project, defs) {
  const rawTable = project.data_table;
  const parsedTable = project.parsed_table || schema.makeParsedTableName(project.id);

  if (!(await schema.tableExists(parsedTable))) {
    return { updated: 0, total: 0, parsedTable, message: '解析表不存在' };
  }

  const rows = await db.query(
    `SELECT id, jdy_data_id, jdy_form_name, jdy_op, jdy_op_time, raw_json
       FROM \`${rawTable}\` WHERE raw_json IS NOT NULL ORDER BY id DESC LIMIT 5000`
  );
  if (!rows.length) return { updated: 0, total: 0, parsedTable };

  const parseDefs = defs.filter(
    (d) => d.parse_mode && d.parse_mode !== 'none' && d.parse_mode !== fields.EXPAND_MODE
  );

  // 解析表真实存在的列（避免写入不存在的列）
  const liveCols = new Set((await schema.columnInfo(parsedTable)).map((c) => c.name));

  let updated = 0;
  for (const row of rows) {
    let raw;
    try { raw = JSON.parse(row.raw_json); } catch (_) { continue; }
    const d = (raw && raw.data) || {};
    const values = d.data && typeof d.data === 'object' && !Array.isArray(d.data)
      ? Object.assign({}, d, d.data)
      : d;

    // 原始值（解析表也保留一份，便于对照）
    const columns = {};
    const parsed = {};
    for (const def of defs) {
      if (Number(def.enabled) === 0) continue;

      /*
       * 取值键的确定：
       *   普通字段           → values[def.field_key]
       *   派生字段（source_key 非空）→ field_key 形如 `_widget_xxx#province`，
       *     这个键**不存在于推送报文**（实测 92 行报文里出现 0 次），
       *     必须回到 source_key 指向的父字段取值，再套 parse_mode / parse_path 拆分。
       *   修复前此处直接 `values[def.field_key]` 取不到就 continue，
       *   导致「字段设置 → 同步表结构」永远无法回填派生字段（标题/地址省市区）。
       */
      const srcKey = fields.sourceKeyOf(def);
      const lookupKey = srcKey || def.field_key;
      const rawVal = values[lookupKey];
      if (rawVal === undefined) continue;

      // 派生字段：只写解析列（原始列由父字段自身负责），且按派生模式解析
      const isDerived = Boolean(srcKey);
      if (isDerived) {
        const mode = def.parse_mode && def.parse_mode !== 'none' ? def.parse_mode : 'path';
        const pcol = fields.parsedColumnOf(def.column_name);
        if (!liveCols.has(pcol)) continue;
        const v = fields.parseValue(rawVal, mode, def.parse_path);
        if (v !== null && v !== undefined && v !== '') parsed[pcol] = String(v).slice(0, 500);
        continue;
      }

      if (liveCols.has(def.column_name)) columns[def.column_name] = rawVal;
      if (parseDefs.includes(def)) {
        const pcol = fields.parsedColumnOf(def.column_name);
        if (!liveCols.has(pcol)) continue;
        const v = fields.parseValue(rawVal, def.parse_mode, def.parse_path);
        if (v !== null && v !== undefined && v !== '') parsed[pcol] = String(v).slice(0, 500);
      }
    }

    if (!Object.keys(columns).length && !Object.keys(parsed).length) continue;

    try {
      await schema.upsertInto(parsedTable, {
        dataId: row.jdy_data_id,
        formName: row.jdy_form_name,
        op: row.jdy_op,
        opTime: row.jdy_op_time,
        rawJson: row.raw_json,
      }, Object.assign({}, columns, parsed));
      updated += 1;
    } catch (err) {
      console.error('[backfill] 写入解析表失败:', err.message);
    }
  }

  return { updated, total: rows.length, parsedTable };
}

/**
 * 反向补齐：解析表存在但原始表缺失的行
 *
 * 历史版本在未开启字段解析时曾直接往解析表写入数据，导致两表行数不一致
 * （原始表看不到、解析表却有）。这里从解析表的 raw_json 还原原始表行。
 *
 * @returns {Promise<{filled:number, skipped:number}>}
 */
async function syncRawFromParsed(project, defs) {
  const rawTable = project.data_table;
  const parsedTable = project.parsed_table || schema.makeParsedTableName(project.id);
  if (!(await schema.tableExists(rawTable)) || !(await schema.tableExists(parsedTable))) {
    return { filled: 0, skipped: 0 };
  }

  const orphans = await db.query(
    `SELECT jdy_data_id, jdy_form_name, jdy_op, jdy_op_time, raw_json, received_at
       FROM \`${parsedTable}\`
      WHERE jdy_data_id IS NOT NULL
        AND jdy_data_id NOT IN (SELECT jdy_data_id FROM \`${rawTable}\` WHERE jdy_data_id IS NOT NULL)
      LIMIT 5000`
  );
  if (!orphans.length) return { filled: 0, skipped: 0 };

  let filled = 0;
  let skipped = 0;
  for (const row of orphans) {
    let raw;
    try { raw = JSON.parse(row.raw_json || ''); } catch (_) { skipped += 1; continue; }
    const d = (raw && raw.data) || {};
    const values = d.data && typeof d.data === 'object' && !Array.isArray(d.data)
      ? Object.assign({}, d, d.data)
      : d;

    const columns = {};
    const parsed = {};
    for (const def of defs) {
      if (Number(def.enabled) === 0) continue;
      if (def.parse_mode === fields.EXPAND_MODE) continue;
      const v = values[def.field_key];
      if (v === undefined) continue;
      columns[def.column_name] = v;
      if (def.parse_mode && def.parse_mode !== 'none') {
        const pv = fields.parseValue(v, def.parse_mode, def.parse_path);
        if (pv !== null && pv !== undefined && pv !== '') {
          parsed[fields.parsedColumnOf(def.column_name)] = String(pv).slice(0, 500);
        }
      }
    }
    if (!Object.keys(columns).length) { skipped += 1; continue; }

    try {
      await schema.upsertRecord(project.id, {
        dataId: row.jdy_data_id,
        op: row.jdy_op || 'data_update',
        formName: row.jdy_form_name,
        opTime: Number(row.jdy_op_time) || Date.parse(row.received_at) || Date.now(),
        rawJson: String(row.raw_json || '').slice(0, 4000000),
        columns,
        parsed,
      });
      filled += 1;
    } catch (err) {
      console.error('[syncRawFromParsed]', row.jdy_data_id, err.message);
      skipped += 1;
    }
  }

  return { filled, skipped };
}

/* ══════════════ 接收日志 ══════════════ */

router.get('/projects/:id/logs', auth.requirePerm('log:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(5, parseInt(req.query.pageSize || '20', 10)));
    const offset = (page - 1) * pageSize;
    const op = String(req.query.op || '').trim();
    const result = String(req.query.result || '').trim();
    const keyword = String(req.query.keyword || '').trim();

    const where = [];
    const params = [];
    if (op) { where.push('op = ?'); params.push(op); }
    if (result) { where.push('result = ?'); params.push(result); }
    if (keyword) {
      where.push('(data_id LIKE ? OR form_name LIKE ? OR message LIKE ? OR deliver_id LIKE ?)');
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw, kw);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const table = quoteIdent(project.log_table);

    const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM ${table} ${whereSql}`, params);
    const rows = await db.query(
      `SELECT id, op, op_label, deliver_id, data_id, form_name, entry_id, op_time,
              signature_ok, signature_msg, result, message, source_ip, field_count,
              change_summary, created_at
         FROM ${table} ${whereSql}
        ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const ops = await db.query(`SELECT op, COUNT(*) AS c FROM ${table} GROUP BY op ORDER BY c DESC`);

    res.json({
      ok: true,
      data: { list: rows, total: Number((totalRow && totalRow.c) || 0), page, pageSize, ops },
    });
  } catch (err) { next(err); }
});

router.get('/projects/:id/logs/:logId', auth.requirePerm('log:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });
    const row = await db.queryOne(
      `SELECT * FROM ${quoteIdent(project.log_table)} WHERE id = ? LIMIT 1`,
      [req.params.logId]
    );
    if (!row) return res.status(404).json({ ok: false, message: '日志不存在' });

    // 历史日志没有 change_summary：按当时的报文即时补算，页面同样能看到描述
    if (!row.change_summary && row.payload) {
      try {
        row.change_summary = await buildLegacySummary(project, row);
      } catch (e) {
        console.error('[logs] 补算变更描述失败:', e.message);
      }
    }
    res.json({ ok: true, data: row });
  } catch (err) { next(err); }
});

/**
 * 为历史日志补算变更描述。
 * 新旧报文都要能处理：流程推送（schema 2.0）走流程描述，数据推送走字段比对。
 */
async function buildLegacySummary(project, row) {
  const logDescribe = require('../log-describe');
  const flow = require('../flow');
  let body = null;
  try { body = JSON.parse(row.payload); } catch (_) { return ''; }
  if (!body || typeof body !== 'object') return '';

  // 1) 流程推送报文
  const flowPush = flow.parse(body);
  if (flowPush) {
    const lines = logDescribe.describeFlowChange(flowPush);
    return logDescribe.joinDescriptions(lines);
  }

  // 2) 数据推送：与上一条同 data_id 的日志比对
  const op = String(body.op || '');

  const defs = await db.query(
    'SELECT field_key, field_name FROM jdywh_field_defs WHERE project_id = ?', [project.id]);
  const labelMap = {};
  defs.forEach((d) => { labelMap[d.field_key] = d.field_name; });

  const prev = (op === 'data_create' || op === 'data_update' || op === 'data_recover')
    ? await schema.previousPayloadOf(project.id, row.data_id, row.op_time)
    : null;

  return logDescribe.describeDataPush({
    body,
    prev,
    labelOf: (k) => labelMap[k] || k,
    fieldCount: row.field_count,
  });
}

router.delete('/projects/:id/logs', auth.requirePerm('log:clear'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });
    await schema.safeRaw(`TRUNCATE TABLE ${quoteIdent(project.log_table)}`, [], [project.log_table]);
    res.json({ ok: true, message: '接收日志已清空' });
  } catch (err) { next(err); }
});

/* ══════════════ 数据明细 ══════════════ */

router.get('/projects/:id/records', auth.requirePerm('data:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const pageSize = Math.min(200, Math.max(5, parseInt(req.query.pageSize || '20', 10)));
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const offset = (page - 1) * pageSize;
    const keyword = String(req.query.keyword || '').trim();
    const op = String(req.query.op || '').trim();
    const field = String(req.query.field || '').trim();
    const sortKey = String(req.query.sort || '').trim();
    const sortDir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const table = quoteIdent(project.data_table);
    const where = [];
    const params = [];

    // 数据ID 来源字段（如 CRM 用「流水号」），用于搜索与展示
    const defsForId = await fields.listFieldDefs(project.id);
    const idField = projects.resolveIdField(project, defsForId);
    const idCol = idField.column && /^[A-Za-z0-9_]+$/.test(idField.column) ? idField.column : null;

    if (op) { where.push('jdy_op = ?'); params.push(op); }
    if (keyword) {
      if (field && /^[A-Za-z0-9_]+$/.test(field)) {
        where.push(`${quoteIdent(field)} LIKE ?`);
        params.push(`%${keyword}%`);
      } else {
        const kw = `%${keyword}%`;
        if (idCol) {
          where.push(`(jdy_data_id LIKE ? OR jdy_form_name LIKE ? OR raw_json LIKE ? OR ${quoteIdent(idCol)} LIKE ?)`);
          params.push(kw, kw, kw, kw);
        } else {
          where.push('(jdy_data_id LIKE ? OR jdy_form_name LIKE ? OR raw_json LIKE ?)');
          params.push(kw, kw, kw);
        }
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // 排序：只接受真实存在的列名，避免拼接注入
    let orderSql = 'id DESC';
    if (sortKey && /^[A-Za-z0-9_]+$/.test(sortKey)) {
      const liveCols = new Set((await schema.columnInfo(project.data_table)).map((c) => c.name));
      if (liveCols.has(sortKey)) orderSql = `${quoteIdent(sortKey)} ${sortDir}`;
    }

    const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM ${table} ${whereSql}`, params);
    const rows = await db.query(
      `SELECT * FROM ${table} ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    const list = rows.map((r) => Object.assign({}, r, {
      display_id: idCol ? (r[idCol] === null || r[idCol] === undefined || r[idCol] === '' ? null : String(r[idCol])) : null,
    }));

    res.json({
      ok: true,
      data: {
        list,
        total: Number((totalRow && totalRow.c) || 0),
        page,
        pageSize,
        idField: { fieldKey: idField.fieldKey, column: idCol, label: idField.label },
      },
    });
  } catch (err) { next(err); }
});

/** 解析后数据（解析数据表） */
router.get('/projects/:id/parsed', auth.requirePerm('data:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const parsedTable = project.parsed_table || schema.makeParsedTableName(project.id);

    const defsForId = await fields.listFieldDefs(project.id);
    const idField = projects.resolveIdField(project, defsForId);
    const idCol = idField.column && /^[A-Za-z0-9_]+$/.test(idField.column) ? idField.column : null;

    if (!(await schema.tableExists(parsedTable))) {
      return res.json({
        ok: true,
        data: {
          list: [], total: 0, page: 1, pageSize: 20, columns: [],
          idField: { fieldKey: idField.fieldKey, column: null, label: idField.label },
        },
      });
    }

    const pageSize = Math.min(200, Math.max(5, parseInt(req.query.pageSize || '20', 10)));
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const offset = (page - 1) * pageSize;
    const keyword = String(req.query.keyword || '').trim();
    const field = String(req.query.field || '').trim();
    const sortKey = String(req.query.sort || '').trim();
    const sortDir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const table = quoteIdent(parsedTable);
    const where = [];
    const params = [];
    if (keyword) {
      const kw = `%${keyword}%`;
      if (field && /^[A-Za-z0-9_]+$/.test(field)) {
        where.push(`${quoteIdent(field)} LIKE ?`);
        params.push(kw);
      } else if (idCol) {
        where.push(`(jdy_data_id LIKE ? OR jdy_form_name LIKE ? OR raw_json LIKE ? OR ${quoteIdent(idCol)} LIKE ?)`);
        params.push(kw, kw, kw, kw);
      } else {
        where.push('(jdy_data_id LIKE ? OR jdy_form_name LIKE ? OR raw_json LIKE ?)');
        params.push(kw, kw, kw);
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // 排序：只接受真实存在的列名，避免拼接注入
    let orderSql = 'id DESC';
    if (sortKey && /^[A-Za-z0-9_]+$/.test(sortKey)) {
      const liveCols = new Set((await schema.columnInfo(parsedTable)).map((c) => c.name));
      if (liveCols.has(sortKey)) orderSql = `${quoteIdent(sortKey)} ${sortDir}`;
    }

    const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM ${table} ${whereSql}`, params);
    const rows = await db.query(
      `SELECT * FROM ${table} ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const columns = await schema.columnInfo(parsedTable);
    const list = rows.map((r) => Object.assign({}, r, {
      display_id: idCol ? (r[idCol] === null || r[idCol] === undefined || r[idCol] === '' ? null : String(r[idCol])) : null,
    }));

    res.json({
      ok: true,
      data: {
        list,
        total: Number((totalRow && totalRow.c) || 0),
        page,
        pageSize,
        columns,
        table: parsedTable,
        idField: { fieldKey: idField.fieldKey, column: idCol, label: idField.label },
      },
    });
  } catch (err) { next(err); }
});

router.get('/projects/:id/records/:recordId', auth.requirePerm('data:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });
    const row = await db.queryOne(
      `SELECT * FROM ${quoteIdent(project.data_table)} WHERE id = ? LIMIT 1`,
      [req.params.recordId]
    );
    if (!row) return res.status(404).json({ ok: false, message: '数据不存在' });

    const defsOne = await fields.listFieldDefs(project.id);
    const idFieldOne = projects.resolveIdField(project, defsOne);
    const idColOne = idFieldOne.column && /^[A-Za-z0-9_]+$/.test(idFieldOne.column)
      ? idFieldOne.column : null;
    const data = Object.assign({}, row, {
      display_id: idColOne && row[idColOne] !== null && row[idColOne] !== undefined && row[idColOne] !== ''
        ? String(row[idColOne]) : null,
      id_label: idFieldOne.label,
    });

    res.json({ ok: true, data });
  } catch (err) { next(err); }
});

router.delete('/projects/:id/records/:recordId', auth.requirePerm('data:delete'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });
    await db.raw(`DELETE FROM ${quoteIdent(project.data_table)} WHERE id = ?`, [req.params.recordId]);
    res.json({ ok: true, message: '数据已删除' });
  } catch (err) { next(err); }
});

/** 子表数据 */
router.get('/projects/:id/subtables', auth.requirePerm('data:read'), async (req, res, next) => {
  try {
    const subs = await schema.getSubTables(req.params.id);
    res.json({ ok: true, data: subs });
  } catch (err) { next(err); }
});

router.get('/projects/:id/subtables/:table/rows', auth.requirePerm('data:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const tableName = String(req.params.table || '');
    if (!new RegExp(`^jdywh_sub_${Number(project.id)}_[0-9A-Za-z_]+$`).test(tableName)) {
      return res.status(400).json({ ok: false, message: '子表名不合法' });
    }
    if (!(await schema.tableExists(tableName))) {
      return res.status(404).json({ ok: false, message: '子表不存在' });
    }

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(5, parseInt(req.query.pageSize || '50', 10)));
    const offset = (page - 1) * pageSize;
    const dataId = String(req.query.dataId || '').trim();

    const where = dataId ? 'WHERE jdy_data_id = ?' : '';
    const params = dataId ? [dataId] : [];

    const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${tableName}\` ${where}`, params);
    const rows = await db.query(
      `SELECT * FROM \`${tableName}\` ${where} ORDER BY row_index ASC, id ASC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    res.json({
      ok: true,
      data: { list: rows, total: Number((totalRow && totalRow.c) || 0), page, pageSize },
    });
  } catch (err) { next(err); }
});

/* ============== 导出 ============== */

router.get('/projects/:id/export', auth.requirePerm('data:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const columns = await schema.getDataColumns(project.id);
    const rows = await db.query(
      `SELECT * FROM ${quoteIdent(project.data_table)} ORDER BY id DESC LIMIT 50000`
    );

    // 数据ID 来源字段：导出时用业务值（如流水号）替换简道云 _id 列
    const defsForExport = await fields.listFieldDefs(project.id);
    const idFieldExport = projects.resolveIdField(project, defsForExport);
    const idColExport = idFieldExport.column && /^[A-Za-z0-9_]+$/.test(idFieldExport.column)
      ? idFieldExport.column : null;
    if (idColExport) {
      const at = columns.findIndex((c) => c.name === 'jdy_data_id');
      if (at >= 0) {
        columns[at] = Object.assign({}, columns[at], { comment: idFieldExport.label });
      }
    }

    // 表头优先使用中文注释
    const header = columns.map((c) => c.comment || c.name);
    const lines = [header.map(csvCell).join(',')];
    for (const row of rows) {
      lines.push(columns.map((c) => {
        if (idColExport && c.name === 'jdy_data_id') {
          const v = row[idColExport];
          return csvCell(v === null || v === undefined || v === '' ? row[c.name] : v);
        }
        return csvCell(row[c.name]);
      }).join(','));
    }
    const csv = '\uFEFF' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(project.code)}_data.csv"`
    );
    res.send(csv);
  } catch (err) { next(err); }
});

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.length > 32000) s = s.slice(0, 32000) + '...';
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/* ══════════════ 模拟推送 ══════════════ */

router.post('/projects/:id/simulate', auth.requirePerm('project:write'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const defs = await fields.listFieldDefs(project.id);
    const op = String((req.body && req.body.op) || 'data_create');
    const dataId = (req.body && req.body.dataId) || 'sim_' + Date.now();
    const now = Date.now();

    // 依据字段定义生成更贴近真实的模拟数据
    const data = {
      _id: dataId,
      formName: (req.body && req.body.formName) || '模拟表单',
      appId: 'sim_app',
      entryId: 'sim_entry',
      createTime: now,
      updateTime: now,
      creator: { username: 'admin', name: '管理员', status: 1 },
      updater: { username: 'admin', name: '管理员', status: 1 },
    };

    if (defs.length) {
      defs.forEach((d) => {
        if (d.field_key === '_id') { data._id = dataId; return; }
        if (fields.SYSTEM_FIELDS[d.field_key]) return;

        switch (d.parse_mode) {
          case 'member_full':
          case 'name':
            data[d.field_key] = { _id: '65d46c5d9b614620407b1419', name: '郭晨', status: 1,
              type: 0, username: 'guochen@sinohealth.cn' };
            break;
          case 'phone':
            data[d.field_key] = { phone: '13800000000', verified: false };
            break;
          case 'id':
            data[d.field_key] = { _id: '65d46c5d9b614620407b1419' };
            break;
          case 'address':
            data[d.field_key] = { province: '江苏省', city: '无锡市', district: '梁溪区', detail: '清扬路138号' };
            break;
          case 'timestamp':
            data[d.field_key] = now;
            break;
          case 'array_count':
          case 'array_join':
          case 'array_names':
          case fields.EXPAND_MODE:
            data[d.field_key] = [
              { name: '张三', amount: 1000, remark: '第一行' },
              { name: '李四', amount: 2000, remark: '第二行' },
            ];
            break;
          default:
            if (d.field_type === 'number') data[d.field_key] = 1234.56;
            else if (d.field_type === 'json') data[d.field_key] = { name: '示例', value: '示例值' };
            else if (d.field_type === 'array') data[d.field_key] = ['示例A', '示例B'];
            else data[d.field_key] = '模拟数据';
        }
      });
    } else {
      Object.assign(data, {
        姓名: '张三',
        手机: { phone: '15852540044', verified: false },
        金额: 1234.56,
        销售: { _id: '65d46c5d9b614620407b1419', name: '郭晨', status: 1, username: 'guochen@sinohealth.cn' },
        备注: '模拟推送数据',
      });
    }

    const payload = { op, opTime: now, data };
    if (op === 'data_remove') {
      payload.data = { formName: data.formName, _id: dataId, deleteTime: now };
    }

    const raw = JSON.stringify(payload);
    const nonce = Math.random().toString(16).slice(2, 8);
    const timestamp = String(Math.floor(now / 1000));
    const signature = jdy.calcSignature(nonce, raw, project.jdy_secret || '', timestamp);

    const port = process.env.PORT || 8781;
    const url = `http://127.0.0.1:${port}/jdy/push/${project.push_token}?nonce=${nonce}&timestamp=${timestamp}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-JDY-Signature': signature,
        'X-JDY-DeliverId': 'sim_' + Math.random().toString(16).slice(2),
      },
      body: raw,
    });
    const text = await resp.text();
    res.json({
      ok: resp.ok,
      data: { status: resp.status, body: text, payload, url },
      message: resp.ok ? '模拟推送成功，已写入数据与日志' : '模拟推送失败',
    });
  } catch (err) { next(err); }
});

/* ══════════════ 用户管理（管理员） ══════════════ */

router.get('/users', auth.requireAdminApi, async (req, res, next) => {
  try {
    const list = await users.list(req.query.keyword);
    const stats = await users.stats();
    const roleMap = await users.loadRoles();
    res.json({ ok: true, data: { list, stats, roles: roleMap } });
  } catch (err) { next(err); }
});

router.post('/users', auth.requireAdminApi, async (req, res, next) => {
  try {
    const body = req.body || {};
    const user = await users.createUser(body, { emailVerified: !body.sendVerify });
    const pub = await users.publicUser(user);

    // 可选：发送账号通知邮件
    let mailSent = false;
    let mailError = null;
    if (body.sendMail && pub.email && (await settings.mailReady())) {
      try {
        const base = publicBaseUrl(req);
        await mailer.sendAccountCreated(pub.email, pub.username, body.password, base + '/login');
        mailSent = true;
      } catch (err) {
        mailError = err.message;
      }
    }

    res.json({
      ok: true,
      data: pub,
      mailSent,
      mailError,
      message: '用户创建成功' + (mailSent ? '，通知邮件已发送' : (mailError ? '，但邮件发送失败：' + mailError : '')),
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/users/:id', auth.requireAdminApi, async (req, res, next) => {
  try {
    const user = await users.updateUser(req.params.id, req.body || {});
    res.json({ ok: true, data: await users.publicUser(user), message: '用户已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/users/:id', auth.requireAdminApi, async (req, res, next) => {
  try {
    await users.deleteUser(req.params.id, req.user.id);
    res.json({ ok: true, message: '用户已删除' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 管理员重置某用户密码 */
router.post('/users/:id/reset-password', auth.requireAdminApi, async (req, res, next) => {
  try {
    const { newPassword } = req.body || {};
    const user = await users.findById(req.params.id);
    if (!user) return res.status(404).json({ ok: false, message: '用户不存在' });
    await users.setPassword(user.id, newPassword);
    res.json({ ok: true, message: `已重置 ${user.username} 的密码` });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 给用户发送重置密码邮件 */
router.post('/users/:id/send-reset', auth.requireAdminApi, async (req, res, next) => {
  try {
    const user = await users.findById(req.params.id);
    if (!user) return res.status(404).json({ ok: false, message: '用户不存在' });
    if (!user.email) return res.status(400).json({ ok: false, message: '该用户未设置邮箱' });

    const r = await auth.requestPasswordReset(user.email, publicBaseUrl(req));
    res.json({ ok: r.ok, message: r.message });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════ 系统设置（管理员） ══════════════ */

router.get('/settings', auth.requireAdminApi, async (req, res, next) => {
  try {
    const map = await settings.all();
    // 敏感字段脱敏返回
    const safe = Object.assign({}, map);
    settings.SECRET_KEYS.forEach((k) => {
      if (safe[k]) safe[k] = '';
      safe[k + '__set'] = map[k] ? '1' : '0';
    });
    res.json({ ok: true, data: { values: safe, groups: settings.GROUPS, mailReady: await settings.mailReady() } });
  } catch (err) { next(err); }
});

router.put('/settings', auth.requireAdminApi, async (req, res, next) => {
  try {
    const body = (req.body && req.body.values) || {};
    const patch = {};
    Object.keys(body).forEach((k) => {
      if (!(k in settings.DEFAULTS)) return;
      // 敏感字段留空表示不修改
      if (settings.SECRET_KEYS.includes(k) && (body[k] === '' || body[k] === undefined)) return;
      patch[k] = body[k];
    });
    if (!Object.keys(patch).length) return res.json({ ok: true, message: '没有需要保存的修改' });
    await settings.setMany(patch);
    res.json({ ok: true, message: '系统设置已保存' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 测试邮件配置（可指定收件人） */
router.post('/settings/test-mail', auth.requireAdminApi, async (req, res, next) => {
  try {
    const to = String((req.body && req.body.to) || req.user.email || '').trim();
    if (!users.validEmail(to)) {
      return res.status(400).json({ ok: false, message: '请提供有效的收件邮箱' });
    }
    if (!(await settings.mailReady())) {
      return res.status(400).json({ ok: false, message: '请先保存 SMTP 配置并启用邮件服务' });
    }
    await mailer.verify();
    await mailer.sendTest(to);
    res.json({ ok: true, message: `测试邮件已发送至 ${to}` });
  } catch (err) {
    res.status(400).json({ ok: false, message: '发送失败：' + err.message });
  }
});

/** 登录日志 */
router.get('/login-logs', auth.requireAdminApi, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(5, parseInt(req.query.pageSize || '30', 10)));
    const offset = (page - 1) * pageSize;
    const keyword = String(req.query.keyword || '').trim();

    const where = keyword ? 'WHERE username LIKE ? OR ip LIKE ?' : '';
    const params = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];

    const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM jdywh_login_logs ${where}`, params);
    const rows = await db.query(
      `SELECT * FROM jdywh_login_logs ${where} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    res.json({
      ok: true,
      data: { list: rows, total: Number((totalRow && totalRow.c) || 0), page, pageSize },
    });
  } catch (err) { next(err); }
});

/** 数据库表一览（系统设置 → 数据维护） */
router.get('/system/tables', auth.requireAdminApi, async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS rowCount, TABLE_COMMENT AS comment,
              DATA_LENGTH + INDEX_LENGTH AS size
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'jdywh%'
        ORDER BY TABLE_NAME`
    );
    res.json({
      ok: true,
      data: rows.map((r) => ({
        name: r.name,
        rowCount: Number(r.rowCount || 0),
        comment: r.comment || '',
        sizeText: formatBytes(Number(r.size || 0)),
      })),
    });
  } catch (err) { next(err); }
});

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 清理过期会话与令牌 */
router.post('/system/cleanup', auth.requireAdminApi, async (req, res, next) => {
  try {
    await auth.cleanupExpired();
    res.json({ ok: true, message: '已清理过期会话与令牌' });
  } catch (err) { next(err); }
});

/* ══════════════ 工具 ══════════════ */

function publicBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

/* ══════════════════════════════════════════════════════════
 *  角色与权限
 * ══════════════════════════════════════════════════════════ */

router.get('/permissions', async (req, res) => {
  res.json({
    ok: true,
    data: {
      groups: roles.PERMISSION_GROUPS,
      all: roles.ALL_PERMISSIONS,
      names: roles.PERMISSION_NAMES,
    },
  });
});

router.get('/roles', auth.requirePerm('role:write'), async (req, res, next) => {
  try {
    const list = await roles.list();
    res.json({
      ok: true,
      data: { list, groups: roles.PERMISSION_GROUPS, all: roles.ALL_PERMISSIONS },
    });
  } catch (err) { next(err); }
});

router.post('/roles', auth.requirePerm('role:write'), async (req, res, next) => {
  try {
    const role = await roles.create(req.body || {});
    users.clearRoleCache();
    await audit.log(req, 'role.create', { targetType: 'role', targetId: role.id, detail: { name: role.name } });
    res.json({ ok: true, data: role, message: '角色创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/roles/:id', auth.requirePerm('role:write'), async (req, res, next) => {
  try {
    const role = await roles.update(req.params.id, req.body || {});
    users.clearRoleCache();
    await audit.log(req, 'role.update', {
      targetType: 'role', targetId: role.id,
      detail: { name: role.name, permissions: role.permissions },
    });
    res.json({ ok: true, data: role, message: '角色已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/roles/:id', auth.requirePerm('role:write'), async (req, res, next) => {
  try {
    await roles.remove(req.params.id);
    users.clearRoleCache();
    await audit.log(req, 'role.delete', { targetType: 'role', targetId: req.params.id });
    res.json({ ok: true, message: '角色已删除' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
 *  数据源管理
 * ══════════════════════════════════════════════════════════ */

router.get('/datasources', auth.requirePerm('datasource:read'), async (req, res, next) => {
  try {
    const list = await datasources.list();
    const dstypes = require('../dstypes');
    res.json({
      ok: true,
      data: {
        list,
        catalog: dstypes.grouped(),
        stats: dstypes.stats(),
      },
    });
  } catch (err) { next(err); }
});

/** 数据源类型目录（新建数据源时选择） */
router.get('/datasource-types', async (req, res) => {
  const dstypes = require('../dstypes');
  res.json({
    ok: true,
    data: {
      categories: dstypes.CATEGORIES,
      catalog: dstypes.grouped(),
      stats: dstypes.stats(),
    },
  });
});

/** 某个类型的详细信息（含资源列表与字段定义） */
router.get('/datasource-types/:key', async (req, res) => {
  const dstypes = require('../dstypes');
  const t = dstypes.get(req.params.key);
  if (!t) return res.status(404).json({ ok: false, message: '类型不存在' });
  res.json({ ok: true, data: t });
});

router.post('/datasources', auth.requirePerm('datasource:write'), async (req, res, next) => {
  try {
    const row = await datasources.create(req.body || {});
    await audit.log(req, 'datasource.create', { targetType: 'datasource', targetId: row.id, detail: { name: row.name } });
    res.json({ ok: true, data: row, message: '数据源创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/datasources/:id', auth.requirePerm('datasource:write'), async (req, res, next) => {
  try {
    const row = await datasources.update(req.params.id, req.body || {});
    await audit.log(req, 'datasource.update', { targetType: 'datasource', targetId: row.id, detail: { name: row.name } });
    res.json({ ok: true, data: row, message: '数据源已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/datasources/:id', auth.requirePerm('datasource:write'), async (req, res, next) => {
  try {
    await datasources.remove(req.params.id);
    await audit.log(req, 'datasource.delete', { targetType: 'datasource', targetId: req.params.id });
    res.json({ ok: true, message: '数据源已删除' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.post('/datasources/:id/test', auth.requirePerm('datasource:write'), async (req, res, next) => {
  try {
    const r = await datasources.test(req.params.id);
    await audit.log(req, 'datasource.test', { targetType: 'datasource', targetId: req.params.id, detail: { ok: r.ok } });
    res.json({ ok: r.ok, data: r, message: r.ok ? `连接成功（${r.elapsed}ms）` : r.message });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 测试未保存的连接配置 */
router.post('/datasources/test-raw', auth.requirePerm('datasource:write'), async (req, res) => {
  try {
    const body = req.body || {};
    const r = await dsDriver.testConnection({
      type: body.type || 'mysql',
      host: body.host,
      port: body.port,
      user: body.user,
      password: body.password,
      database: body.database,
    });
    res.json({ ok: r.ok, data: r, message: r.ok ? `连接成功（${r.elapsed}ms）` : r.message });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/datasources/:id/tables', auth.requirePerm('datasource:read'), async (req, res, next) => {
  try {
    const list = await datasources.tables(req.params.id, req.query.keyword);
    res.json({ ok: true, data: list });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/datasources/:id/tables/:table/columns', auth.requirePerm('datasource:read'), async (req, res, next) => {
  try {
    const list = await datasources.columns(req.params.id, req.params.table);
    res.json({ ok: true, data: list });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
 *  数据集
 * ══════════════════════════════════════════════════════════ */

router.get('/datasets', auth.requirePerm('dataset:read'), async (req, res, next) => {
  try {
    const list = await reports.listDatasets(req.query.keyword);
    res.json({ ok: true, data: list });
  } catch (err) { next(err); }
});

router.get('/datasets/:id', auth.requirePerm('dataset:read'), async (req, res, next) => {
  try {
    const dataset = await reports.getDataset(req.params.id);
    if (!dataset) return res.status(404).json({ ok: false, message: '数据集不存在' });
    res.json({ ok: true, data: dataset });
  } catch (err) { next(err); }
});

router.post('/datasets', auth.requirePerm('dataset:write'), async (req, res, next) => {
  try {
    const dataset = await reports.createDataset(req.body || {}, req.user.id);
    await audit.log(req, 'dataset.create', { targetType: 'dataset', targetId: dataset.id, detail: { name: dataset.name } });
    res.json({ ok: true, data: dataset, message: '数据集创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/datasets/:id', auth.requirePerm('dataset:write'), async (req, res, next) => {
  try {
    const dataset = await reports.updateDataset(req.params.id, req.body || {});
    await audit.log(req, 'dataset.update', { targetType: 'dataset', targetId: dataset.id });
    res.json({ ok: true, data: dataset, message: '数据集已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/datasets/:id', auth.requirePerm('dataset:write'), async (req, res, next) => {
  try {
    await reports.deleteDataset(req.params.id);
    await audit.log(req, 'dataset.delete', { targetType: 'dataset', targetId: req.params.id });
    res.json({ ok: true, message: '数据集已删除' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 预览数据集 */
router.post('/datasets/:id/preview', auth.requirePerm('dataset:read'), async (req, res, next) => {
  try {
    const limit = Number((req.body && req.body.limit) || 50);
    const r = await reports.previewDataset(req.params.id, limit);
    res.json({ ok: true, data: r });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 临时执行 SQL（数据集设计器用） */
router.post('/datasets/test-sql', auth.requirePerm('dataset:write'), async (req, res) => {
  try {
    const body = req.body || {};
    reports.assertReadOnly(String(body.sql || ''));
    const source = await datasources.getById(body.datasourceId || 0);
    if (!source) return res.status(400).json({ ok: false, message: '数据源不存在' });

    const limit = Math.min(Number(body.limit) || 50, 1000);
    const sql = dsDriver.paginate(source, String(body.sql).replace(/;+\s*$/, ''), limit, 0);
    const started = Date.now();
    const rows = await dsDriver.query(source, sql, []);
    res.json({
      ok: true,
      data: {
        rows,
        columns: rows.length ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] })) : [],
        rowCount: rows.length,
        elapsed: Date.now() - started,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
 *  报表
 * ══════════════════════════════════════════════════════════ */

router.get('/chart-types', (req, res) => {
  res.json({
    ok: true,
    data: reports.CHART_TYPES,
    rows: reports.DASHBOARD_ROWS,
    theme: reports.DASHBOARD_THEME,
  });
});

/** 看板布局元数据 */
router.get('/dashboard-meta', (req, res) => {
  res.json({
    ok: true,
    data: {
      rows: reports.DASHBOARD_ROWS,
      theme: reports.DASHBOARD_THEME,
      components: reports.CHART_TYPES.filter((c) => c.group === '看板'),
    },
  });
});

router.get('/reports', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const list = await reports.listReports(req.query.keyword);
    res.json({ ok: true, data: list });
  } catch (err) { next(err); }
});

router.get('/reports/:id', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const report = await reports.getReport(req.params.id);
    if (!report) return res.status(404).json({ ok: false, message: '报表不存在' });
    res.json({ ok: true, data: report });
  } catch (err) { next(err); }
});

router.post('/reports', auth.requirePerm('report:write'), async (req, res, next) => {
  try {
    const report = await reports.createReport(req.body || {}, req.user.id);
    await audit.log(req, 'report.create', { targetType: 'report', targetId: report.id, detail: { name: report.name } });
    res.json({ ok: true, data: report, message: '报表创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/reports/:id', auth.requirePerm('report:write'), async (req, res, next) => {
  try {
    const report = await reports.updateReport(req.params.id, req.body || {});
    await audit.log(req, 'report.update', { targetType: 'report', targetId: report.id });
    res.json({ ok: true, data: report, message: '报表已保存' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/reports/:id', auth.requirePerm('report:write'), async (req, res, next) => {
  try {
    await reports.deleteReport(req.params.id);
    await audit.log(req, 'report.delete', { targetType: 'report', targetId: req.params.id });
    res.json({ ok: true, message: '报表已删除' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 执行报表（取数） */
router.post('/reports/:id/run', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const limit = Number((req.body && req.body.limit) || 2000);
    const r = await reports.runReport(req.params.id, { limit });
    res.json({ ok: true, data: r });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 导出报表数据 */
router.get('/reports/:id/export', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const r = await reports.runReport(req.params.id, { limit: 50000 });
    const cols = r.columns.map((c) => c.name);
    const lines = [cols.map(csvCell).join(',')];
    r.rows.forEach((row) => lines.push(cols.map((c) => csvCell(row[c])).join(',')));
    const csv = '\uFEFF' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(r.report.code)}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
 *  分享
 * ══════════════════════════════════════════════════════════ */

router.get('/shares', auth.requirePerm('share:write'), async (req, res, next) => {
  try {
    const list = await reports.listShares(req.query.reportId);
    res.json({ ok: true, data: list });
  } catch (err) { next(err); }
});

router.post('/shares', auth.requirePerm('share:write'), async (req, res, next) => {
  try {
    const allow = await settings.getBool('allow_public_share');
    if (!allow) return res.status(400).json({ ok: false, message: '系统已关闭公开分享功能' });
    const share = await reports.createShare(req.body || {}, req.user.id);
    await audit.log(req, 'share.create', { targetType: 'share', targetId: share.id, detail: { token: share.token } });
    res.json({
      ok: true,
      data: Object.assign({}, share, { url: `${publicBaseUrl(req)}/s/${share.token}` }),
      message: '分享链接已创建',
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/shares/:id', auth.requirePerm('share:write'), async (req, res, next) => {
  try {
    const share = await reports.toggleShare(req.params.id, (req.body || {}).status);
    res.json({ ok: true, data: share, message: share.status ? '分享已启用' : '分享已停用' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/shares/:id', auth.requirePerm('share:write'), async (req, res, next) => {
  try {
    await reports.deleteShare(req.params.id);
    await audit.log(req, 'share.delete', { targetType: 'share', targetId: req.params.id });
    res.json({ ok: true, message: '分享已删除' });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
 *  数据集成
 * ══════════════════════════════════════════════════════════ */

router.get('/integrations', auth.requirePerm('integration:read'), async (req, res, next) => {
  try {
    const list = await integrations.list(req.query.direction, req.query.keyword);
    const stats = await integrations.stats();
    res.json({ ok: true, data: { list, stats } });
  } catch (err) { next(err); }
});

router.get('/integrations/:id', auth.requirePerm('integration:read'), async (req, res, next) => {
  try {
    const task = await integrations.get(req.params.id);
    if (!task) return res.status(404).json({ ok: false, message: '任务不存在' });
    res.json({ ok: true, data: task });
  } catch (err) { next(err); }
});

router.post('/integrations', auth.requirePerm('integration:write'), async (req, res, next) => {
  try {
    const task = await integrations.create(req.body || {}, req.user.id);
    await audit.log(req, 'integration.create', { targetType: 'integration', targetId: task.id, detail: { name: task.name } });
    res.json({ ok: true, data: task, message: '集成任务创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/integrations/:id', auth.requirePerm('integration:write'), async (req, res, next) => {
  try {
    const task = await integrations.update(req.params.id, req.body || {});
    await audit.log(req, 'integration.update', { targetType: 'integration', targetId: task.id });
    res.json({ ok: true, data: task, message: '任务已保存' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/integrations/:id', auth.requirePerm('integration:write'), async (req, res, next) => {
  try {
    await integrations.remove(req.params.id);
    await audit.log(req, 'integration.delete', { targetType: 'integration', targetId: req.params.id });
    res.json({ ok: true, message: '任务已删除' });
  } catch (err) { next(err); }
});

/** 手动执行集成任务 */
router.post('/integrations/:id/run', auth.requirePerm('integration:write'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const log = await integrations.run(req.params.id, 'manual', {
      limit: body.limit,
      dataId: body.dataId,
      useParsed: body.useParsed,
      single: body.single,
    });
    await audit.log(req, 'integration.run', {
      targetType: 'integration', targetId: req.params.id,
      detail: { success: log.success, rows: log.rowsAffected },
    });
    res.json({ ok: log.success, data: log, message: log.message });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/integrations/:id/logs', auth.requirePerm('integration:read'), async (req, res, next) => {
  try {
    const r = await integrations.listLogs(req.params.id, req.query.page, req.query.pageSize);
    res.json({ ok: true, data: r });
  } catch (err) { next(err); }
});

router.get('/integration-logs', auth.requirePerm('integration:read'), async (req, res, next) => {
  try {
    const r = await integrations.listLogs(null, req.query.page, req.query.pageSize);
    res.json({ ok: true, data: r });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
 *  AI 问数
 * ══════════════════════════════════════════════════════════ */

router.post('/ai/ask', auth.requirePerm('ai:use'), async (req, res, next) => {
  try {
    const enabled = await settings.getBool('ai_enabled');
    if (!enabled) return res.status(400).json({ ok: false, message: '系统未启用 AI 问数，请先在系统设置中开启' });

    const body = req.body || {};
    const r = await ai.ask(body.question, {
      datasetId: body.datasetId,
      sessionKey: body.sessionKey,
      userId: req.user.id,
      history: body.history,
    });
    await audit.log(req, 'ai.ask', { detail: { question: String(body.question || '').slice(0, 200) } });
    res.json({ ok: true, data: r });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/ai/chats', auth.requirePerm('ai:use'), async (req, res, next) => {
  try {
    const list = await ai.listChats(req.query.sessionKey, req.query.limit);
    res.json({ ok: true, data: list });
  } catch (err) { next(err); }
});

router.post('/ai/test', auth.requirePerm('ai:config'), async (req, res) => {
  try {
    const r = await ai.testConnection();
    res.json({ ok: r.ok, data: r, message: r.ok ? `连接成功：${r.message}` : r.message });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** AI 供应商预设列表 */
router.get('/ai/providers', async (req, res) => {
  res.json({ ok: true, data: ai.publicProviders() });
});

/* ══════════════════════════════════════════════════════════
 *  数据治理
 * ══════════════════════════════════════════════════════════ */

/** 治理总览：表清单、数据量、字段质量 */
router.get('/governance/overview', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const list = await projects.listProjects({});
    const out = [];

    for (const p of list) {
      let dataCount = 0;
      let parsedCount = 0;
      let rawCols = 0;
      let parsedCols = 0;
      let commentedCols = 0;

      try {
        const d = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${p.data_table}\``);
        dataCount = Number((d && d.c) || 0);
      } catch (_) { /* ignore */ }
      try {
        const d = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${p.parsed_table}\``);
        parsedCount = Number((d && d.c) || 0);
      } catch (_) { /* ignore */ }

      try {
        const c1 = await db.queryOne(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN COLUMN_COMMENT <> '' THEN 1 ELSE 0 END) AS commented
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [p.data_table]
        );
        rawCols = Number((c1 && c1.total) || 0);
        commentedCols = Number((c1 && c1.commented) || 0);
      } catch (_) { /* ignore */ }

      try {
        const c2 = await db.queryOne(
          `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [p.parsed_table]
        );
        parsedCols = Number((c2 && c2.c) || 0);
      } catch (_) { /* ignore */ }

      const fieldDefs = await db.queryOne(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN parse_mode <> 'none' THEN 1 ELSE 0 END) AS parsed,
                SUM(CASE WHEN remark IS NULL OR remark = '' THEN 1 ELSE 0 END) AS no_remark
           FROM jdywh_field_defs WHERE project_id = ?`,
        [p.id]
      );

      out.push({
        id: p.id,
        name: p.name,
        code: p.code,
        datasourceId: Number(p.datasource_id || 0),
        datasourceName: p.datasource_name || '本机数据库',
        dataTable: p.data_table,
        parsedTable: p.parsed_table,
        logTable: p.log_table,
        dataCount,
        parsedCount,
        rawCols,
        parsedCols,
        commentedCols,
        fieldTotal: Number((fieldDefs && fieldDefs.total) || 0),
        fieldParsed: Number((fieldDefs && fieldDefs.parsed) || 0),
        fieldNoRemark: Number((fieldDefs && fieldDefs.no_remark) || 0),
        lastPushAt: p.last_push_at,
      });
    }

    res.json({ ok: true, data: out });
  } catch (err) { next(err); }
});

/** 表结构详情（用于治理页面查看） */
router.get('/governance/projects/:id/schema', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const rawCols = await schema.getDataColumns(project.id);
    const parsedCols = await schema.columnInfo(project.parsed_table).catch(() => []);
    const defs = await fields.listFieldDefs(project.id);

    res.json({
      ok: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          code: project.code,
          dataTable: project.data_table,
          parsedTable: project.parsed_table,
          logTable: project.log_table,
          datasourceId: Number(project.datasource_id || 0),
        },
        rawColumns: rawCols,
        parsedColumns: parsedCols,
        fieldDefs: defs,
      },
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
 *  审计日志
 * ══════════════════════════════════════════════════════════ */

router.get('/audit-logs', auth.requirePerm('audit:read'), async (req, res, next) => {
  try {
    const r = await audit.list({
      page: req.query.page,
      pageSize: req.query.pageSize,
      action: req.query.action,
      username: req.query.username,
      keyword: req.query.keyword,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    const stats = await audit.stats();
    res.json({ ok: true, data: Object.assign(r, { stats, actions: audit.ACTION_NAMES }) });
  } catch (err) { next(err); }
});

router.post('/audit-logs/cleanup', auth.requirePerm('settings:write'), async (req, res, next) => {
  try {
    await audit.cleanup();
    res.json({ ok: true, message: '已按保留策略清理过期日志' });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
 *  系统概览（数据中台首页）
 * ══════════════════════════════════════════════════════════ */

router.get('/dashboard', async (req, res, next) => {
  try {
    const stats = await projects.globalStats();

    const dsCount = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_datasources');
    const reportCount = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_reports');
    const datasetCount = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_datasets');
    const integrationCount = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_integrations');
    const shareCount = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_shares WHERE status = 1');
    const aiCount = await db.queryOne('SELECT COUNT(*) AS c FROM jdywh_ai_chats');

    // 近 7 天数据接收趋势
    const trend = [];
    const list = await projects.listProjects({});
    const byDay = {};
    for (const p of list.slice(0, 20)) {
      try {
        const rows = await db.query(
          `SELECT DATE(received_at) AS d, COUNT(*) AS c FROM \`${p.data_table}\`
            WHERE received_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(received_at)`
        );
        rows.forEach((r) => {
          const key = String(r.d).slice(0, 10);
          byDay[key] = (byDay[key] || 0) + Number(r.c);
        });
      } catch (_) { /* ignore */ }
    }
    Object.keys(byDay).sort().forEach((d) => trend.push({ date: d, count: byDay[d] }));

    // 最近推送日志
    const recentLogs = [];
    for (const p of list.slice(0, 5)) {
      try {
        const rows = await db.query(
          `SELECT id, op, op_label, data_id, form_name, result, created_at
             FROM \`${p.log_table}\` ORDER BY id DESC LIMIT 5`
        );
        rows.forEach((r) => recentLogs.push(Object.assign({ projectId: p.id, projectName: p.name }, r)));
      } catch (_) { /* ignore */ }
    }
    recentLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      ok: true,
      data: {
        stats: Object.assign({}, stats, {
          datasources: Number((dsCount && dsCount.c) || 0) + 1,
          reports: Number((reportCount && reportCount.c) || 0),
          datasets: Number((datasetCount && datasetCount.c) || 0),
          integrations: Number((integrationCount && integrationCount.c) || 0),
          shares: Number((shareCount && shareCount.c) || 0),
          aiChats: Number((aiCount && aiCount.c) || 0),
        }),
        trend,
        recentLogs: recentLogs.slice(0, 10),
        projects: list.slice(0, 6).map((p) => ({
          id: p.id, name: p.name, code: p.code,
          dataCount: 0, lastPushAt: p.last_push_at,
        })),
      },
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
 *  组织架构
 * ══════════════════════════════════════════════════════════ */

router.get('/departments', auth.requirePerm('user:read'), async (req, res, next) => {
  try {
    const [list, tree, stats] = await Promise.all([
      departments.list(), departments.tree(), departments.stats(),
    ]);
    res.json({ ok: true, data: { list, tree, stats } });
  } catch (err) { next(err); }
});

router.post('/departments', auth.requirePerm('user:write'), async (req, res, next) => {
  try {
    const dept = await departments.create(req.body || {});
    await audit.log(req, 'dept.create', { targetType: 'department', targetId: dept.id, detail: { name: dept.name } });
    res.json({ ok: true, data: dept, message: '部门创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/departments/:id', auth.requirePerm('user:write'), async (req, res, next) => {
  try {
    const dept = await departments.update(req.params.id, req.body || {});
    await audit.log(req, 'dept.update', { targetType: 'department', targetId: dept.id });
    res.json({ ok: true, data: dept, message: '部门已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/departments/:id', auth.requirePerm('user:write'), async (req, res, next) => {
  try {
    await departments.remove(req.params.id);
    await audit.log(req, 'dept.delete', { targetType: 'department', targetId: req.params.id });
    res.json({ ok: true, message: '部门已删除' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/departments/:id/users', auth.requirePerm('user:read'), async (req, res, next) => {
  try {
    const list = await departments.usersOf(req.params.id, req.query.children === '1');
    res.json({ ok: true, data: list });
  } catch (err) { next(err); }
});

/** 初始化默认组织架构 */
router.post('/departments/init', auth.requirePerm('user:write'), async (req, res, next) => {
  try {
    const created = await departments.ensureDefaults();
    res.json({ ok: true, message: created ? '已创建默认组织架构' : '已存在部门，未做改动' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
 *  表单引擎
 * ══════════════════════════════════════════════════════════ */

router.get('/form-field-types', (req, res) => {
  res.json({
    ok: true,
    data: {
      types: forms.FIELD_TYPES,
      formTypes: forms.FORM_TYPES,
      widths: forms.WIDTHS,
      optionLayouts: forms.OPTION_LAYOUTS,
      flowStatus: forms.FLOW_STATUS,
    },
  });
});

router.get('/forms', auth.requirePerm('form:read'), async (req, res, next) => {
  try {
    const list = await forms.list(req.query.keyword);
    const stats = await forms.stats();
    res.json({ ok: true, data: { list, stats } });
  } catch (err) { next(err); }
});

router.get('/forms/:id', auth.requirePerm('form:read'), async (req, res, next) => {
  try {
    const form = await forms.getById(req.params.id);
    if (!form) return res.status(404).json({ ok: false, message: '表单不存在' });
    res.json({ ok: true, data: form });
  } catch (err) { next(err); }
});

router.post('/forms', auth.requirePerm('form:write'), async (req, res, next) => {
  try {
    const form = await forms.create(req.body || {}, req.user.id);
    await audit.log(req, 'form.create', { targetType: 'form', targetId: form.id, detail: { name: form.name } });
    res.json({ ok: true, data: form, message: '表单创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/forms/:id', auth.requirePerm('form:write'), async (req, res, next) => {
  try {
    const form = await forms.update(req.params.id, req.body || {});
    await audit.log(req, 'form.update', { targetType: 'form', targetId: form.id });
    res.json({ ok: true, data: form, message: '表单已保存' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/forms/:id', auth.requirePerm('form:write'), async (req, res, next) => {
  try {
    await forms.remove(req.params.id);
    await audit.log(req, 'form.delete', { targetType: 'form', targetId: req.params.id });
    res.json({ ok: true, message: '表单已删除' });
  } catch (err) { next(err); }
});

router.post('/forms/:id/regenerate-token', auth.requirePerm('form:write'), async (req, res, next) => {
  try {
    const form = await forms.regenerateToken(req.params.id);
    res.json({
      ok: true, data: form,
      url: `${publicBaseUrl(req)}/f/${form.publicToken}`,
      message: '公开填写链接已重置',
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/forms/:id/records', auth.requirePerm('form:read'), async (req, res, next) => {
  try {
    const r = await forms.listRecords(req.params.id, {
      page: req.query.page, pageSize: req.query.pageSize, keyword: req.query.keyword,
    });
    res.json({ ok: true, data: r });
  } catch (err) { next(err); }
});

/** 导出表单数据 CSV */
router.get('/forms/:id/export', auth.requirePerm('form:read'), async (req, res, next) => {
  try {
    const form = await forms.getById(req.params.id);
    if (!form) return res.status(404).json({ ok: false, message: '表单不存在' });
    const r = await forms.listRecords(req.params.id, { page: 1, pageSize: 200 });

    const cols = form.fields.filter((f) => f.type !== 'divider' && f.type !== 'section').map((f) => f.key);
    const header = ['提交时间', '提交人', 'IP'].concat(form.fields
      .filter((f) => f.type !== 'divider' && f.type !== 'section')
      .map((f) => f.label));

    const lines = [header.map(csvCell).join(',')];
    r.list.forEach((rec) => {
      const row = [rec.created_at, rec.submitter || '', rec.ip || ''];
      cols.forEach((c) => {
        const v = rec.data[c];
        row.push(v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
      });
      lines.push(row.map(csvCell).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(form.code)}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
 *  数据处理流程
 * ══════════════════════════════════════════════════════════ */

router.get('/flow-node-types', (req, res) => {
  res.json({ ok: true, data: { nodes: flows.NODE_TYPES, categories: flows.CATEGORIES } });
});

router.get('/flows', auth.requirePerm('flow:read'), async (req, res, next) => {
  try {
    const list = await flows.list(req.query.keyword);
    const stats = await flows.stats();
    res.json({ ok: true, data: { list, stats } });
  } catch (err) { next(err); }
});

router.get('/flows/:id', auth.requirePerm('flow:read'), async (req, res, next) => {
  try {
    const flow = await flows.getById(req.params.id);
    if (!flow) return res.status(404).json({ ok: false, message: '流程不存在' });
    res.json({ ok: true, data: flow });
  } catch (err) { next(err); }
});

router.post('/flows', auth.requirePerm('flow:write'), async (req, res, next) => {
  try {
    const flow = await flows.create(req.body || {}, req.user.id);
    await audit.log(req, 'flow.create', { targetType: 'flow', targetId: flow.id, detail: { name: flow.name } });
    res.json({ ok: true, data: flow, message: '流程创建成功' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.put('/flows/:id', auth.requirePerm('flow:write'), async (req, res, next) => {
  try {
    const flow = await flows.update(req.params.id, req.body || {});
    await audit.log(req, 'flow.update', { targetType: 'flow', targetId: flow.id });
    res.json({ ok: true, data: flow, message: '流程已保存' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/flows/:id', auth.requirePerm('flow:write'), async (req, res, next) => {
  try {
    await flows.remove(req.params.id);
    await audit.log(req, 'flow.delete', { targetType: 'flow', targetId: req.params.id });
    res.json({ ok: true, message: '流程已删除' });
  } catch (err) { next(err); }
});

/** 执行流程 */
router.post('/flows/:id/run', auth.requirePerm('flow:write'), async (req, res, next) => {
  try {
    const r = await flows.run(req.params.id, 'manual');
    await audit.log(req, 'flow.run', {
      targetType: 'flow', targetId: req.params.id,
      detail: { ok: r.ok, input: r.inputRows, output: r.outputRows },
    });
    res.json({ ok: r.ok, data: r, message: r.message });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 试运行（不写入目标，仅预览结果） */
router.post('/flows/:id/preview', auth.requirePerm('flow:read'), async (req, res, next) => {
  try {
    const flow = await flows.getById(req.params.id);
    if (!flow) return res.status(404).json({ ok: false, message: '流程不存在' });

    const order = flows.topoSort(flow.nodes, flow.edges);
    const outputs = {};
    let rows = [];
    const logs = [];

    for (const node of order) {
      const def = flows.NODE_MAP[node.type];
      if (def && def.category === 'sink') {
        logs.push({ nodeId: node.id, name: node.label, type: node.type, skipped: true, rows: rows.length });
        outputs[node.id] = rows;
        continue;
      }
      const t0 = Date.now();
      const upstream = (flow.edges || []).filter((e) => e.to === node.id).map((e) => e.from);
      let input = rows;
      if (upstream.length) {
        input = [];
        upstream.forEach((uid) => { if (Array.isArray(outputs[uid])) input = input.concat(outputs[uid]); });
      }

      const out = def && def.category === 'source'
        ? await flows.runSource(node, { flowId: flow.id, flowName: flow.name })
        : flows.runClean(node, input, { flowId: flow.id });

      outputs[node.id] = out;
      rows = out;
      logs.push({
        nodeId: node.id, name: node.label, type: node.type,
        inputRows: input.length, outputRows: out.length, ms: Date.now() - t0,
      });
    }

    const limit = Math.min(Number((req.body && req.body.limit) || 50), 500);
    res.json({
      ok: true,
      data: {
        rows: rows.slice(0, limit),
        rowCount: rows.length,
        columns: rows.length ? Object.keys(rows[0]).map((k) => ({ name: k })) : [],
        logs,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/flows/:id/logs', auth.requirePerm('flow:read'), async (req, res, next) => {
  try {
    const r = await flows.listLogs(req.params.id, { page: req.query.page, pageSize: req.query.pageSize });
    res.json({ ok: true, data: r });
  } catch (err) { next(err); }
});

router.get('/flow-logs', auth.requirePerm('flow:read'), async (req, res, next) => {
  try {
    const r = await flows.listLogs(null, { page: req.query.page, pageSize: req.query.pageSize });
    res.json({ ok: true, data: r });
  } catch (err) { next(err); }
});

/** 流程可用字段（供节点配置选择） */
router.get('/flows/:id/fields', auth.requirePerm('flow:read'), async (req, res, next) => {
  try {
    const flow = await flows.getById(req.params.id);
    if (!flow) return res.status(404).json({ ok: false, message: '流程不存在' });

    const order = flows.topoSort(flow.nodes, flow.edges);
    const firstSource = order.find((n) => flows.NODE_MAP[n.type] && flows.NODE_MAP[n.type].category === 'source');
    if (!firstSource) return res.json({ ok: true, data: [] });

    const rows = await flows.runSource(firstSource, { flowId: flow.id });
    res.json({
      ok: true,
      data: rows.length ? Object.keys(rows[0]).map((k) => ({ name: k, sample: rows[0][k] })) : [],
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
 *  个人资料
 * ══════════════════════════════════════════════════════════ */

router.put('/me/profile', async (req, res, next) => {
  try {
    const body = req.body || {};
    const fields = [];
    const params = [];
    const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

    if (body.displayName !== undefined) {
      const n = String(body.displayName).trim();
      if (!n) return res.status(400).json({ ok: false, message: '昵称不能为空' });
      set('display_name', n.slice(0, 64));
    }
    if (body.avatar !== undefined) {
      const a = String(body.avatar || '');
      if (a.length > 2000000) return res.status(400).json({ ok: false, message: '头像文件过大（上限 2MB）' });
      set('avatar', a || null);
    }
    if (body.avatarColor !== undefined) set('avatar_color', String(body.avatarColor || '').slice(0, 16) || null);
    if (body.phone !== undefined) set('phone', String(body.phone || '').trim().slice(0, 32) || null);
    if (body.position !== undefined) set('position', String(body.position || '').trim().slice(0, 64) || null);

    if (!fields.length) return res.json({ ok: true, data: req.user, message: '没有需要保存的内容' });

    params.push(req.user.id);
    await db.query(`UPDATE jdywh_users SET ${fields.join(', ')} WHERE id = ?`, params);

    const row = await users.findById(req.user.id);
    res.json({ ok: true, data: await users.publicUser(row), message: '资料已保存' });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
 *  CRM 客户签约看板
 * ══════════════════════════════════════════════════════════ */

router.get('/crm/dashboard', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const crmdash = require('../crmdash');
    const projectId = Number(req.query.projectId) || 16;
    const data = await crmdash.build(projectId);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
 *  agg 短信营销数据（拆分后的分片）
 * ══════════════════════════════════════════════════════════ */

router.get('/agg/overview', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const agg = require('../aggdata');
    const label = req.query.label === 'raw' ? 'raw' : 'classified';
    const idx = agg.index(label);
    if (!idx) return res.status(404).json({ ok: false, message: '数据未初始化，请先运行拆分脚本' });

    const kpis = agg.kpis(label);
    const months = agg.byMonth(label);
    res.json({ ok: true, data: { index: idx, kpis, months } });
  } catch (err) { next(err); }
});

router.get('/agg/category', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const agg = require('../aggdata');
    const label = req.query.label === 'raw' ? 'raw' : 'classified';
    res.json({ ok: true, data: agg.byCategory(label) });
  } catch (err) { next(err); }
});

router.get('/agg/month/:month', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const agg = require('../aggdata');
    const label = req.query.label === 'raw' ? 'raw' : 'classified';
    const rows = agg.loadMonth(label, req.params.month);
    const limit = Math.min(Number(req.query.limit) || 100, 2000);
    res.json({ ok: true, data: { month: req.params.month, total: rows.length, rows: rows.slice(0, limit) } });
  } catch (err) { next(err); }
});

router.get('/agg/top', auth.requirePerm('report:read'), async (req, res, next) => {
  try {
    const agg = require('../aggdata');
    const label = req.query.label === 'raw' ? 'raw' : 'classified';
    const field = String(req.query.field || '消费金额');
    const n = Math.min(Number(req.query.n) || 10, 100);
    res.json({ ok: true, data: agg.topN(label, field, n) });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
 *  邮箱推送（邮件附件表格自动入库）
 * ══════════════════════════════════════════════════════════ */

/** 项目列表 */
router.get('/mail-push/projects', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const mailPush = require('../mail-push');
    await mailPush.ensureMetaTables();
    const rows = await mailPush.listProjects();
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

/** 项目详情（含列结构与预览数据） */
router.get('/mail-push/projects/:id', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const mailPush = require('../mail-push');
    const id = Number(req.params.id);
    const project = await mailPush.getProject(id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const cols = await mailPush.columns(project.data_table);
    const preview = await mailPush.previewRows(project.data_table, req.query.limit || 20);
    res.json({ ok: true, data: { project, columns: cols, preview } });
  } catch (err) { next(err); }
});

/** 分页读取项目数据（支持搜索/排序） */
router.get('/mail-push/projects/:id/rows', auth.requirePerm('data:read'), async (req, res, next) => {
  try {
    const mailPush = require('../mail-push');
    const id = Number(req.params.id);
    const project = await mailPush.getProject(id);
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const data = await mailPush.queryRows(project, {
      page: req.query.page,
      size: req.query.size,
      keyword: req.query.keyword,
      sort: req.query.sort,
      order: req.query.order,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
});

/** 项目列结构 */
router.get('/mail-push/projects/:id/columns', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const mailPush = require('../mail-push');
    const project = await mailPush.getProject(Number(req.params.id));
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });
    const cols = await mailPush.columns(project.data_table);
    res.json({ ok: true, data: { columns: cols } });
  } catch (err) { next(err); }
});

/** 导出项目数据为 CSV */
router.get('/mail-push/projects/:id/export', auth.requirePerm('data:read'), async (req, res) => {
  try {
    const mailPush = require('../mail-push');
    const project = await mailPush.getProject(Number(req.params.id));
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const { columns, rows } = await mailPush.exportRows(project);

    // CSV 转义：双引号包裹 + 内部双引号翻倍；防公式注入（=+-@ 开头加前置单引号）
    const csvCell = (v) => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };

    const header = columns.map((c) => csvCell(c.comment || c.name)).join(',');
    const lines = rows.map((r) => columns.map((c) => csvCell(r[c.name])).join(','));
    const csv = '\uFEFF' + [header].concat(lines).join('\r\n');

    const safeName = String(project.name || 'export').replace(/[\\/:*?"<>|]/g, '_');
    const filename = encodeURIComponent(`${safeName}_${project.data_table}.csv`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="export.csv"; filename*=UTF-8''${filename}`);
    res.send(csv);
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 更新项目元信息 */
router.put('/mail-push/projects/:id', auth.requirePerm('project:write'), async (req, res) => {
  try {
    const mailPush = require('../mail-push');
    const row = await mailPush.updateProject(Number(req.params.id), req.body || {});
    try {
      const audit = require('../audit');
      await audit.log(req, 'mailpush.project.update', { id: row.id, name: row.name });
    } catch (_) { /* ignore */ }
    res.json({ ok: true, data: row, message: '项目已更新' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 删除项目（可选连表删除） */
router.delete('/mail-push/projects/:id', auth.requirePerm('project:write'), async (req, res) => {
  try {
    const mailPush = require('../mail-push');
    const project = await mailPush.getProject(Number(req.params.id));
    if (!project) return res.status(404).json({ ok: false, message: '项目不存在' });

    const dropTable = req.query.dropTable === '1' || (req.body && req.body.dropTable);
    await mailPush.deleteProject(Number(req.params.id), !!dropTable);
    try {
      const audit = require('../audit');
      await audit.log(req, 'mailpush.project.delete', {
        id: project.id, name: project.name, dropTable: !!dropTable,
      });
    } catch (_) { /* ignore */ }
    res.json({ ok: true, message: `项目「${project.name}」已删除` + (dropTable ? '（含数据表）' : '') });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 清空项目数据（保留表结构） */
router.post('/mail-push/projects/:id/clear', auth.requirePerm('project:write'), async (req, res) => {
  try {
    const mailPush = require('../mail-push');
    const r = await mailPush.clearProject(Number(req.params.id));
    try {
      const audit = require('../audit');
      await audit.log(req, 'mailpush.project.clear', { id: Number(req.params.id), deleted: r.deleted });
    } catch (_) { /* ignore */ }
    res.json({ ok: true, message: `已清空 ${r.deleted} 行数据`, data: r });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 统计概览 */
router.get('/mail-push/overview', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const mailPush = require('../mail-push');
    const accounts = require('../mail-accounts');
    await mailPush.ensureMetaTables();
    await accounts.ensureTable();

    const ov = await mailPush.overview();
    const accList = await accounts.list();

    res.json({
      ok: true,
      data: Object.assign({}, ov, {
        accounts: {
          total: accList.length,
          enabled: accList.filter((a) => Number(a.enabled) === 1).length,
        },
      }),
    });
  } catch (err) { next(err); }
});

/** 邮箱推送设置读取 */
router.get('/mail-push/settings', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const settings = require('../settings');
    res.json({
      ok: true,
      data: {
        enabled: ['1', 'true', 'yes', 'on'].includes(
          String(await settings.get('mail_push_enabled', '0')).toLowerCase()
        ),
        interval: Number(await settings.get('mail_push_interval', '5')) || 5,
        initial_days: Number(await settings.get('mail_push_initial_days', '7')) || 7,
        max_per_run: Number(await settings.get('mail_push_max_per_run', '50')) || 50,
      },
    });
  } catch (err) { next(err); }
});

/** 邮箱推送设置保存 */
router.put('/mail-push/settings', auth.requirePerm('settings:write'), async (req, res) => {
  try {
    const settings = require('../settings');
    const body = req.body || {};
    const patch = {};

    if (body.enabled !== undefined) {
      patch.mail_push_enabled = (Number(body.enabled) || String(body.enabled) === 'true') ? '1' : '0';
    }
    if (body.interval !== undefined) {
      const n = parseInt(body.interval, 10);
      if (!Number.isFinite(n) || n < 1 || n > 1440) throw new Error('轮询周期需在 1-1440 分钟之间');
      patch.mail_push_interval = String(n);
    }
    if (body.initial_days !== undefined) {
      const n = parseInt(body.initial_days, 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) throw new Error('回溯天数需在 1-365 之间');
      patch.mail_push_initial_days = String(n);
    }
    if (body.max_per_run !== undefined) {
      const n = parseInt(body.max_per_run, 10);
      if (!Number.isFinite(n) || n < 1 || n > 500) throw new Error('单次邮件数需在 1-500 之间');
      patch.mail_push_max_per_run = String(n);
    }

    if (!Object.keys(patch).length) return res.json({ ok: true, message: '没有需要保存的修改' });

    await settings.setMany(patch);

    // 重启轮询使新周期生效
    try {
      const mailInbox = require('../mail-inbox');
      await mailInbox.restart();
    } catch (_) { /* ignore */ }

    try {
      const audit = require('../audit');
      await audit.log(req, 'mailpush.settings.update', patch);
    } catch (_) { /* ignore */ }

    res.json({ ok: true, message: '设置已保存' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 单条日志详情 */
router.get('/mail-push/logs/:id', auth.requirePerm('log:read'), async (req, res, next) => {
  try {
    const mailPush = require('../mail-push');
    const row = await mailPush.getLog(req.params.id);
    if (!row) return res.status(404).json({ ok: false, message: '日志不存在' });
    res.json({ ok: true, data: row });
  } catch (err) { next(err); }
});

/** 导入日志（支持结果/项目/关键词筛选） */
router.get('/mail-push/logs', auth.requirePerm('log:read'), async (req, res, next) => {
  try {
    const mailPush = require('../mail-push');
    await mailPush.ensureMetaTables();
    const rows = await mailPush.queryLogs({
      limit: req.query.limit || 100,
      result: req.query.result,
      projectId: req.query.projectId,
      keyword: req.query.keyword,
    });
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

/** 运行状态 */
router.get('/mail-push/status', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const mailInbox = require('../mail-inbox');
    const settings = require('../settings');
    const accounts = require('../mail-accounts');
    await accounts.ensureTable();
    const list = await accounts.list();
    const enabled = ['1', 'true', 'yes', 'on'].includes(
      String(await settings.get('mail_push_enabled', '0')).toLowerCase()
    );
    res.json({
      ok: true,
      data: {
        enabled,
        accountCount: list.length,
        enabledCount: list.filter((a) => Number(a.enabled) === 1).length,
        interval: Number(await settings.get('mail_push_interval', '5')) || 5,
        ...mailInbox.status(),
      },
    });
  } catch (err) { next(err); }
});

/* ---------- 邮箱账户管理 ---------- */

/** 账户列表（密码已掩码） */
router.get('/mail-push/accounts', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const accounts = require('../mail-accounts');
    await accounts.ensureTable();
    res.json({ ok: true, data: await accounts.list() });
  } catch (err) { next(err); }
});

/** 服务商预设 */
router.get('/mail-push/account-presets', auth.requirePerm('project:read'), async (req, res) => {
  try {
    const accounts = require('../mail-accounts');
    res.json({ ok: true, data: accounts.PRESETS });
  } catch (err) { next(err); }
});

/** 账户详情 */
router.get('/mail-push/accounts/:id', auth.requirePerm('project:read'), async (req, res, next) => {
  try {
    const accounts = require('../mail-accounts');
    const row = await accounts.get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, message: '邮箱账户不存在' });
    res.json({ ok: true, data: row });
  } catch (err) { next(err); }
});

/** 新建账户 */
router.post('/mail-push/accounts', auth.requirePerm('settings:write'), async (req, res) => {
  try {
    const accounts = require('../mail-accounts');
    const row = await accounts.create(req.body || {});
    try {
      const audit = require('../audit');
      await audit.log(req, 'mailpush.account.create', { email: row.email });
    } catch (_) { /* ignore */ }
    res.json({ ok: true, data: row, message: `邮箱账户「${row.email}」已添加` });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 修改账户（密码留空表示不修改） */
router.put('/mail-push/accounts/:id', auth.requirePerm('settings:write'), async (req, res) => {
  try {
    const accounts = require('../mail-accounts');
    const row = await accounts.update(req.params.id, req.body || {});
    try {
      const audit = require('../audit');
      await audit.log(req, 'mailpush.account.update', { email: row.email });
    } catch (_) { /* ignore */ }
    res.json({ ok: true, data: row, message: '邮箱账户已保存' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 删除账户 */
router.delete('/mail-push/accounts/:id', auth.requirePerm('settings:write'), async (req, res) => {
  try {
    const accounts = require('../mail-accounts');
    const row = await accounts.get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, message: '邮箱账户不存在' });
    await accounts.remove(req.params.id);
    try {
      const audit = require('../audit');
      await audit.log(req, 'mailpush.account.delete', { email: row.email });
    } catch (_) { /* ignore */ }
    res.json({ ok: true, message: `邮箱账户「${row.email}」已删除` });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 启用 / 停用账户 */
router.post('/mail-push/accounts/:id/toggle', auth.requirePerm('settings:write'), async (req, res) => {
  try {
    const accounts = require('../mail-accounts');
    const enabled = Number(req.body && req.body.enabled) ? 1 : 0;
    const row = await accounts.setEnabled(req.params.id, enabled);
    if (!row) return res.status(404).json({ ok: false, message: '邮箱账户不存在' });
    const mailInbox = require('../mail-inbox');
    await mailInbox.restart().catch(() => {});
    res.json({ ok: true, data: row, message: enabled ? '账户已启用' : '账户已停用' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ---------- 邮件浏览 ---------- */

/** 某账户的邮件列表 */
router.get('/mail-push/accounts/:id/messages', auth.requirePerm('project:read'), async (req, res) => {
  try {
    const mailInbox = require('../mail-inbox');
    const data = await mailInbox.listMessages(req.params.id, {
      mailbox: req.query.mailbox,
      limit: req.query.limit,
      offset: req.query.offset,
      onlyAttachments: req.query.onlyAttachments === '1',
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 单封邮件正文 */
router.get('/mail-push/accounts/:id/messages/:uid', auth.requirePerm('project:read'), async (req, res) => {
  try {
    const mailInbox = require('../mail-inbox');
    const data = await mailInbox.getMessage(req.params.id, req.params.uid, {
      mailbox: req.query.mailbox,
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 测试账户连接（支持未保存的新账户参数） */
router.post('/mail-push/test', auth.requirePerm('settings:write'), async (req, res) => {
  try {
    const mailInbox = require('../mail-inbox');
    const r = await mailInbox.testConnection(req.body || {});
    res.json({ ok: r.ok, message: r.message, data: r });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 手动触发一次拉取（可指定账户） */
router.post('/mail-push/run', auth.requirePerm('project:write'), async (req, res) => {
  try {
    const mailInbox = require('../mail-inbox');
    const force = !!req.body.force;
    const accountId = req.body.accountId ? Number(req.body.accountId) : null;
    const r = await mailInbox.runOnce({ force, accountId });
    if (req.user) {
      try {
        const audit = require('../audit');
        await audit.log(req, 'mailpush.run', {
          ok: r.ok, imported: r.imported, skipped: r.skipped, failed: r.failed,
        });
      } catch (_) { /* ignore */ }
    }
    res.json({ ok: r.ok, message: r.message || `处理完成：导入 ${r.imported || 0} 个附件`, data: r });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/** 文件名解析预览（调试用：输入附件名看会落到哪个项目） */
router.get('/mail-push/parse-name', auth.requirePerm('project:read'), async (req, res) => {
  try {
    const mailPush = require('../mail-push');
    const name = String(req.query.filename || '');
    res.json({ ok: true, data: mailPush.parseAttachmentName(name) });
  } catch (err) { next(err); }
});

module.exports = router;