'use strict';

const crypto = require('crypto');
const db = require('./db');
const schema = require('./schema');
const settings = require('./settings');
const { sanitizeIdent } = require('./ident');

function newPushToken() {
  return crypto.randomBytes(16).toString('hex');
}

async function uniqueCode(base) {
  let code = sanitizeIdent(base, 'project');
  if (!code) code = 'project';
  let candidate = code;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = await db.queryOne('SELECT id FROM jdywh_projects WHERE code = ? LIMIT 1', [candidate]);
    if (!row) return candidate;
    i += 1;
    candidate = `${code}_${i}`;
    if (i > 500) return `${code}_${crypto.randomBytes(3).toString('hex')}`;
  }
}

async function createProject(input, userId) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('项目名称不能为空');

  const code = await uniqueCode(input.code || name);
  const pushToken = newPushToken();
  const defaultBase = await settings.get('default_base_url', '');

  const defaultDsId = await settings.getInt('default_datasource_id', 0);
  const datasourceId = input.datasourceId !== undefined
    ? Number(input.datasourceId) || 0
    : defaultDsId;

  const result = await db.query(
    `INSERT INTO jdywh_projects
       (name, code, description, jdy_base_url, jdy_secret, push_token,
        data_table, log_table, field_map, parse_enabled, status, remark, created_by,
        datasource_id, parsed_table, raw_table, category, tags, id_field_key, group_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      name,
      code,
      input.description || null,
      input.jdyBaseUrl || defaultBase || null,
      input.jdySecret || null,
      pushToken,
      'pending',
      'pending',
      '{}',
      input.parseEnabled === false || input.parseEnabled === 0 ? 0 : 1,
      input.status === 0 ? 0 : 1,
      input.remark || null,
      userId || null,
      datasourceId,
      null,
      null,
      String(input.category || '').trim() || null,
      String(input.tags || '').trim() || null,
      String(input.idFieldKey || '').trim() || null,
      Number(input.groupId) || null,
    ]
  );
  const projectId = result.insertId;

  const dataTable = schema.makeTableName(projectId);
  const parsedTable = schema.makeParsedTableName(projectId);
  const logTable = schema.makeLogTableName(projectId);
  await schema.ensureProjectTables(projectId);
  await db.query(
    'UPDATE jdywh_projects SET data_table = ?, parsed_table = ?, raw_table = ?, log_table = ? WHERE id = ?',
    [dataTable, parsedTable, dataTable, logTable, projectId]
  );

  return getProject(projectId);
}

async function getProject(id) {
  return db.queryOne('SELECT * FROM jdywh_projects WHERE id = ? LIMIT 1', [id]);
}

async function getProjectByToken(token) {
  return db.queryOne('SELECT * FROM jdywh_projects WHERE push_token = ? LIMIT 1', [token]);
}

/**
 * 项目列表
 * @param {{keyword?:string, userId?:number, onlyOwn?:boolean,
 *          groupId?:number|string, includeSubGroups?:boolean}} options
 *   groupId = 具体分组 id 时按分组过滤；
 *   groupId = 0 或 '0' 时只看未分组；
 *   groupId = 'all' / 空 时不按分组过滤。
 *   includeSubGroups=true 时把子分组的项目一并包含（需 groupId 为具体分组）。
 */
async function listProjects(options) {
  const opts = options || {};
  const where = [];
  const params = [];

  if (opts.keyword) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.description LIKE ?)');
    const kw = `%${opts.keyword}%`;
    params.push(kw, kw, kw);
  }
  if (opts.onlyOwn && opts.userId) {
    where.push('p.created_by = ?');
    params.push(opts.userId);
  }

  // 分组过滤
  const gRaw = opts.groupId;
  if (gRaw !== undefined && gRaw !== null && gRaw !== '' && gRaw !== 'all') {
    const gid = Number(gRaw);
    if (Number.isFinite(gid) && gid > 0) {
      if (opts.includeSubGroups) {
        // 递归取该分组及其所有后代分组 id
        const groups = require('./project-groups');
        const ids = await groups.descendantIds(gid);
        if (ids.length) {
          where.push(`p.group_id IN (${ids.map(() => '?').join(',')})`);
          params.push(...ids);
        } else {
          where.push('p.group_id = ?');
          params.push(gid);
        }
      } else {
        where.push('p.group_id = ?');
        params.push(gid);
      }
    } else if (gid === 0) {
      where.push('(p.group_id IS NULL OR p.group_id = 0)');
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return db.query(
    `SELECT p.*,
            u.username AS creator_name,
            u.display_name AS creator_display,
            d.name AS datasource_name,
            d.type AS datasource_type,
            g.name AS group_name,
            (SELECT COUNT(*) FROM information_schema.COLUMNS c
              WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = p.data_table) AS column_count,
            (SELECT COUNT(*) FROM information_schema.COLUMNS c
              WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = p.parsed_table) AS parsed_column_count,
            (SELECT COUNT(*) FROM jdywh_field_defs f WHERE f.project_id = p.id) AS field_count
       FROM jdywh_projects p
       LEFT JOIN jdywh_users u ON u.id = p.created_by
       LEFT JOIN jdywh_datasources d ON d.id = p.datasource_id
       LEFT JOIN jdywh_project_groups g ON g.id = p.group_id
       ${whereSql}
      ORDER BY g.sort_order ASC, p.id DESC`,
    params
  );
}

async function updateProject(id, input) {
  const project = await getProject(id);
  if (!project) throw new Error('项目不存在');

  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (input.name !== undefined) set('name', String(input.name).trim());
  if (input.description !== undefined) set('description', input.description || null);
  if (input.jdyBaseUrl !== undefined) set('jdy_base_url', input.jdyBaseUrl || null);
  if (input.jdySecret !== undefined) set('jdy_secret', input.jdySecret || null);
  if (input.status !== undefined) set('status', Number(input.status) ? 1 : 0);
  if (input.parseEnabled !== undefined) set('parse_enabled', Number(input.parseEnabled) ? 1 : 0);
  if (input.remark !== undefined) set('remark', input.remark || null);
  if (input.category !== undefined) set('category', String(input.category || '').trim() || null);
  if (input.tags !== undefined) set('tags', String(input.tags || '').trim() || null);
  // 所属分组：传 0 / null 表示移出分组
  if (input.groupId !== undefined) {
    const gid = Number(input.groupId) || 0;
    if (gid) {
      const g = await db.queryOne('SELECT id FROM jdywh_project_groups WHERE id = ? LIMIT 1', [gid]);
      if (!g) throw new Error('目标分组不存在');
      set('group_id', gid);
    } else {
      set('group_id', null);
    }
  }
  if (input.idFieldKey !== undefined) {
    const k = String(input.idFieldKey || '').trim();
    set('id_field_key', k && /^[A-Za-z_][A-Za-z0-9_]{0,190}$/.test(k) ? k : null);
  }

  // 切换数据源：仅允许在项目无数据时切换，避免数据分裂
  if (input.datasourceId !== undefined) {
    const newDs = Number(input.datasourceId) || 0;
    if (newDs !== Number(project.datasource_id || 0)) {
      const cnt = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${project.data_table}\``);
      if (cnt && Number(cnt.c) > 0) {
        throw new Error(`项目已有 ${cnt.c} 条数据，无法切换数据源。请先清空数据或新建项目。`);
      }
      set('datasource_id', newDs);
    }
  }

  if (!fields.length) return getProject(id);
  params.push(id);
  await db.query(`UPDATE jdywh_projects SET ${fields.join(', ')} WHERE id = ?`, params);
  return getProject(id);
}

async function regenerateToken(id) {
  const token = newPushToken();
  await db.query('UPDATE jdywh_projects SET push_token = ? WHERE id = ?', [token, id]);
  return getProject(id);
}

/** 删除项目（含数据表、日志表、子表与字段定义） */
async function deleteProject(id) {
  const project = await getProject(id);
  if (!project) throw new Error('项目不存在');

  // 收集子表（仅限本应用前缀）
  const subs = await db.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?`,
    [`${schema.tablePrefix()}sub_${Number(id)}_%`]
  );

  // 逐一校验归属后再删除，任何非本应用的表都会被拒绝
  for (const s of subs) {
    schema.assertOwnTable(s.name);
    await schema.safeRaw(`DROP TABLE IF EXISTS \`${s.name}\``, [], [s.name]);
  }

  const dropList = [
    project.data_table,
    project.parsed_table || schema.makeParsedTableName(id),
    project.log_table,
  ].filter(Boolean);

  for (const t of dropList) {
    schema.assertOwnTable(t);
    await schema.safeRaw(`DROP TABLE IF EXISTS \`${t}\``, [], [t]);
  }

  await db.query('DELETE FROM jdywh_field_defs WHERE project_id = ?', [id]);
  await db.query('DELETE FROM jdywh_projects WHERE id = ?', [id]);
  return true;
}

async function touchProject(id) {
  await db.query(
    'UPDATE jdywh_projects SET total_count = total_count + 1, last_push_at = NOW() WHERE id = ?',
    [id]
  );
}

function parseFieldMap(raw) {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

/** 项目统计 */
async function projectStats(id) {
  const project = await getProject(id);
  if (!project) return null;

  const dataStats = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN DATE(received_at) = CURDATE() THEN 1 ELSE 0 END) AS today,
            MAX(received_at) AS last_received
       FROM \`${project.data_table}\``
  );
  const logStats = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN result <> 'success' THEN 1 ELSE 0 END) AS failed
       FROM \`${project.log_table}\``
  );

  return {
    dataTotal: Number((dataStats && dataStats.total) || 0),
    dataToday: Number((dataStats && dataStats.today) || 0),
    lastReceived: dataStats ? dataStats.last_received : null,
    logTotal: Number((logStats && logStats.total) || 0),
    logFailed: Number((logStats && logStats.failed) || 0),
  };
}

/** 全局概览统计 */
async function globalStats() {
  const p = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS active
       FROM jdywh_projects`
  );
  const u = await db.queryOne(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS active FROM jdywh_users`
  );
  const f = await db.queryOne('SELECT COUNT(*) AS total FROM jdywh_field_defs');

  // 汇总所有项目的数据量
  const projects = await db.query('SELECT id, data_table, log_table FROM jdywh_projects');
  let dataTotal = 0;
  let logTotal = 0;
  for (const proj of projects) {
    try {
      const d = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${proj.data_table}\``);
      dataTotal += Number((d && d.c) || 0);
      const l = await db.queryOne(`SELECT COUNT(*) AS c FROM \`${proj.log_table}\``);
      logTotal += Number((l && l.c) || 0);
    } catch (_) { /* 表可能不存在 */ }
  }

  return {
    projects: Number((p && p.total) || 0),
    activeProjects: Number((p && p.active) || 0),
    users: Number((u && u.total) || 0),
    activeUsers: Number((u && u.active) || 0),
    fields: Number((f && f.total) || 0),
    dataTotal,
    logTotal,
  };
}

/**
 * 解析项目的「数据ID 来源字段」配置
 *
 * 默认使用简道云 _id（列 jdy_data_id）。若项目配置了 id_field_key
 * （例如 CRM 用流水号 _widget_1792564761950），则界面显示、搜索、导出
 * 都改用该字段的业务值作为数据标识。
 *
 * @param {object} project 项目记录
 * @param {Array} defs 字段定义（可选，用于解析 field_key → column_name）
 * @returns {{fieldKey:string|null, column:string|null, label:string}}
 */
function resolveIdField(project, defs) {
  const key = project && project.id_field_key ? String(project.id_field_key).trim() : '';
  if (!key) return { fieldKey: null, column: null, label: '数据ID' };

  const list = defs || [];
  const def = list.find((d) => d.field_key === key);
  return {
    fieldKey: key,
    column: def ? def.column_name : null,
    label: def ? (def.field_name || '数据ID') : '数据ID',
  };
}

module.exports = {
  resolveIdField,
  createProject,
  getProject,
  getProjectByToken,
  listProjects,
  updateProject,
  regenerateToken,
  deleteProject,
  touchProject,
  parseFieldMap,
  projectStats,
  globalStats,
  newPushToken,
};