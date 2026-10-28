'use strict';

const crypto = require('crypto');
const db = require('./db');
const schema = require('./schema');
const projects = require('./projects');

/**
 * 表单引擎
 *
 * 通过拖拽设计表单，收集数据并写入指定项目的数据表。
 * 支持公开填写（无需登录）与内部填写两种模式。
 */

/** 支持的字段类型 */
const FIELD_TYPES = [
  { key: 'text', name: '单行文本', icon: '▭', group: '基础' },
  { key: 'textarea', name: '多行文本', icon: '▤', group: '基础' },
  { key: 'number', name: '数字', icon: '#', group: '基础' },
  { key: 'amount', name: '金额', icon: '¥', group: '基础' },
  { key: 'percent', name: '百分比', icon: '%', group: '基础' },
  { key: 'select', name: '下拉选择', icon: '▾', group: '选择' },
  { key: 'radio', name: '单选', icon: '◉', group: '选择' },
  { key: 'checkbox', name: '多选', icon: '☑', group: '选择' },
  { key: 'date', name: '日期', icon: '▦', group: '日期时间' },
  { key: 'datetime', name: '日期时间', icon: '◷', group: '日期时间' },
  { key: 'time', name: '时间', icon: '◔', group: '日期时间' },
  { key: 'daterange', name: '日期区间', icon: '⇹', group: '日期时间' },
  { key: 'member', name: '成员选择', icon: '◐', group: '高级' },
  { key: 'department', name: '部门选择', icon: '⛢', group: '高级' },
  { key: 'image', name: '图片上传', icon: '▣', group: '高级' },
  { key: 'file', name: '附件上传', icon: '⎘', group: '高级' },
  { key: 'address', name: '地址', icon: '⌂', group: '高级' },
  { key: 'location', name: '定位', icon: '◈', group: '高级' },
  { key: 'rating', name: '评分', icon: '★', group: '高级' },
  { key: 'slider', name: '滑块', icon: '⇔', group: '高级' },
  { key: 'formula', name: '公式计算', icon: 'ƒ', group: '高级' },
  { key: 'divider', name: '分割线', icon: '—', group: '布局' },
  { key: 'section', name: '分组标题', icon: '▬', group: '布局' },
  { key: 'table', name: '子表格', icon: '▦', group: '布局' },
];

const FIELD_TYPE_MAP = {};
FIELD_TYPES.forEach((t) => { FIELD_TYPE_MAP[t.key] = t; });

/**
 * 表单类型
 *  - fill  普通填写表单
 *  - flow  流程表单（提交后进入审批流程）
 *  - exam  考试表单（含题目、分值、自动判分）
 */
const FORM_TYPES = [
  { key: 'fill', name: '填写表单', icon: '▤', desc: '常规数据采集，提交即完成' },
  { key: 'flow', name: '流程表单', icon: '⇉', desc: '提交后进入多级审批流程' },
  { key: 'exam', name: '考试表单', icon: '✎', desc: '含题目与分值，提交后自动判分' },
];

const FORM_TYPE_MAP = {};
FORM_TYPES.forEach((t) => { FORM_TYPE_MAP[t.key] = t; });

/** 字段宽度选项（12 栅格） */
const WIDTHS = [
  { key: '1/5', name: '1/5 宽', span: 2 },
  { key: '1/4', name: '1/4 宽', span: 3 },
  { key: '1/3', name: '1/3 宽', span: 4 },
  { key: '1/2', name: '1/2 宽', span: 6 },
  { key: '1', name: '整行', span: 12 },
];

const WIDTH_MAP = {};
WIDTHS.forEach((w) => { WIDTH_MAP[w.key] = w; });

/** 选项展示方式 */
const OPTION_LAYOUTS = [
  { key: 'horizontal', name: '横向排列' },
  { key: 'vertical', name: '纵向排列' },
  { key: 'dropdown', name: '下拉选择' },
];

/** 流程节点状态 */
const FLOW_STATUS = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  finished: '已完成',
};

function newToken() {
  return crypto.randomBytes(12).toString('hex');
}

/** 生成唯一表单编码 */
async function uniqueCode(base) {
  let code = String(base || 'form').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 40) || 'form';
  let n = 1;
  /* eslint-disable no-await-in-loop */
  while (await db.queryOne('SELECT id FROM jdywh_forms WHERE code = ? LIMIT 1', [code])) {
    code = `${base}_${n}`;
    n += 1;
  }
  /* eslint-enable no-await-in-loop */
  return code;
}

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (_) { return fallback; }
}

function publicForm(r, withFields) {
  if (!r) return null;
  const settings = parseJson(r.settings, {});
  const out = {
    id: Number(r.id),
    name: r.name,
    code: r.code,
    description: r.description || '',
    projectId: r.project_id ? Number(r.project_id) : null,
    projectName: r.project_name || null,
    formType: r.form_type || 'fill',
    formTypeName: (FORM_TYPE_MAP[r.form_type] || FORM_TYPE_MAP.fill).name,
    submitCount: Number(r.submit_count || 0),
    publicToken: r.public_token || null,
    allowPublic: Number(r.allow_public) === 1,
    status: Number(r.status),
    // 分享信息
    shareTitle: settings.shareTitle || r.name,
    shareIcon: settings.shareIcon || '▤',
    shareDesc: settings.shareDesc || r.description || '',
    createdBy: r.created_by ? Number(r.created_by) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (withFields) {
    out.fields = parseJson(r.fields, []);
    out.settings = settings;
  } else {
    out.fieldCount = parseJson(r.fields, []).length;
  }
  return out;
}

/** 表单列表 */
async function list(keyword) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(f.name LIKE ? OR f.code LIKE ? OR f.description LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT f.*, p.name AS project_name
       FROM jdywh_forms f
       LEFT JOIN jdywh_projects p ON p.id = f.project_id
       ${whereSql}
      ORDER BY f.id DESC`,
    params
  );
  return rows.map((r) => publicForm(r, false));
}

async function getById(id) {
  const row = await db.queryOne(
    `SELECT f.*, p.name AS project_name
       FROM jdywh_forms f
       LEFT JOIN jdywh_projects p ON p.id = f.project_id
      WHERE f.id = ? LIMIT 1`,
    [id]
  );
  return publicForm(row, true);
}

async function getByToken(token) {
  const row = await db.queryOne('SELECT * FROM jdywh_forms WHERE public_token = ? LIMIT 1', [token]);
  return publicForm(row, true);
}

/** 字段定义校验与规范化 */
function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((f, i) => {
    const type = FIELD_TYPE_MAP[f.type] ? f.type : 'text';
    const key = String(f.key || `field_${i + 1}`).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60) || `field_${i + 1}`;

    // 宽度：兼容旧值 half/full
    let width = f.width;
    if (width === 'half') width = '1/2';
    if (width === 'full') width = '1';
    if (!WIDTH_MAP[width]) width = '1';

    // 选项展示方式
    const layout = ['horizontal', 'vertical', 'dropdown'].includes(f.optionLayout)
      ? f.optionLayout
      : (type === 'select' ? 'dropdown' : 'horizontal');

    return {
      key,
      type,
      label: String(f.label || FIELD_TYPE_MAP[type].name).slice(0, 100),
      placeholder: String(f.placeholder || '').slice(0, 200),
      required: !!f.required,
      defaultValue: f.defaultValue === undefined ? '' : f.defaultValue,
      options: Array.isArray(f.options) ? f.options.map((o) => String(o).slice(0, 100)) : [],
      optionLayout: layout,
      minSelect: f.minSelect === undefined || f.minSelect === '' ? null : Number(f.minSelect),
      maxSelect: f.maxSelect === undefined || f.maxSelect === '' ? null : Number(f.maxSelect),
      min: f.min === undefined || f.min === '' ? null : Number(f.min),
      max: f.max === undefined || f.max === '' ? null : Number(f.max),
      precision: f.precision === undefined || f.precision === '' ? null : Number(f.precision),
      formula: String(f.formula || '').slice(0, 500),
      // 联动：{ source: '字段key', map: { '源值': '目标值' } } 或 { source, mode: 'copy' }
      linkage: f.linkage && typeof f.linkage === 'object'
        ? {
          source: String(f.linkage.source || '').slice(0, 60),
          mode: ['copy', 'map', 'options'].includes(f.linkage.mode) ? f.linkage.mode : 'copy',
          map: f.linkage.map && typeof f.linkage.map === 'object' ? f.linkage.map : {},
        }
        : null,
      hint: String(f.hint || '').slice(0, 300),
      width,
      // 考试相关
      score: f.score === undefined || f.score === '' ? 0 : Number(f.score),
      answer: f.answer === undefined ? '' : f.answer,
      columns: Array.isArray(f.columns) ? f.columns : [],
    };
  });
}

async function create(input, userId) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('请填写表单名称');

  const code = await uniqueCode(input.code || 'form');
  const fields = normalizeFields(input.fields || []);
  const formType = FORM_TYPE_MAP[input.formType] ? input.formType : 'fill';

  // 合并默认设置
  const settings = Object.assign({
    successMessage: '提交成功，感谢您的填写！',
    shareTitle: name,
    shareIcon: '▤',
    shareDesc: '',
    // 流程表单
    flowNodes: [],
    // 考试表单
    examDuration: 0,
    examPassScore: 60,
    examShowAnswer: false,
  }, input.settings && typeof input.settings === 'object' ? input.settings : {});

  const result = await db.query(
    `INSERT INTO jdywh_forms
       (name, code, description, project_id, form_type, fields, settings,
        public_token, allow_public, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      name, code,
      String(input.description || '').trim() || null,
      Number(input.projectId) || null,
      formType,
      JSON.stringify(fields),
      JSON.stringify(settings),
      newToken(),
      input.allowPublic ? 1 : 0,
      input.status === 0 ? 0 : 1,
      userId || null,
    ]
  );
  return getById(result.insertId);
}

async function update(id, input) {
  const form = await getById(id);
  if (!form) throw new Error('表单不存在');

  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (input.name !== undefined) {
    const n = String(input.name).trim();
    if (!n) throw new Error('表单名称不能为空');
    set('name', n);
  }
  if (input.description !== undefined) set('description', String(input.description || '').trim() || null);
  if (input.projectId !== undefined) set('project_id', Number(input.projectId) || null);
  if (input.formType !== undefined) {
    set('form_type', FORM_TYPE_MAP[input.formType] ? input.formType : 'fill');
  }
  if (input.fields !== undefined) set('fields', JSON.stringify(normalizeFields(input.fields)));
  if (input.settings !== undefined) {
    const merged = Object.assign({}, form.settings || {}, input.settings || {});
    set('settings', JSON.stringify(merged));
  }
  if (input.allowPublic !== undefined) set('allow_public', input.allowPublic ? 1 : 0);
  if (input.status !== undefined) set('status', Number(input.status) ? 1 : 0);

  if (!fields.length) return form;
  params.push(id);
  await db.query(`UPDATE jdywh_forms SET ${fields.join(', ')} WHERE id = ?`, params);
  return getById(id);
}

async function remove(id) {
  const form = await getById(id);
  if (!form) throw new Error('表单不存在');
  await db.query('DELETE FROM jdywh_form_records WHERE form_id = ?', [id]);
  await db.query('DELETE FROM jdywh_forms WHERE id = ?', [id]);
  return true;
}

async function regenerateToken(id) {
  const token = newToken();
  await db.query('UPDATE jdywh_forms SET public_token = ? WHERE id = ?', [token, id]);
  return getById(id);
}

/* ══════════ 数据提交 ══════════ */

/** 按字段定义校验并转换提交值 */
function validateAndCast(form, raw) {
  const out = {};
  const errors = [];
  const data = raw && typeof raw === 'object' ? raw : {};

  for (const f of form.fields) {
    if (f.type === 'divider' || f.type === 'section') continue;

    let v = data[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.defaultValue !== undefined && f.defaultValue !== '') v = f.defaultValue;
    }

    const empty = v === undefined || v === null || v === '' ||
      (Array.isArray(v) && v.length === 0);

    if (f.required && empty) {
      errors.push(`「${f.label}」为必填项`);
      continue;
    }
    if (empty) { out[f.key] = null; continue; }

    switch (f.type) {
      case 'number':
      case 'amount':
      case 'percent':
      case 'slider': {
        const n = Number(v);
        if (!Number.isFinite(n)) { errors.push(`「${f.label}」必须是数字`); break; }
        if (f.min !== null && n < f.min) { errors.push(`「${f.label}」不能小于 ${f.min}`); break; }
        if (f.max !== null && n > f.max) { errors.push(`「${f.label}」不能大于 ${f.max}`); break; }
        out[f.key] = f.precision !== null ? Number(n.toFixed(f.precision)) : n;
        break;
      }
      case 'checkbox':
        out[f.key] = Array.isArray(v) ? v.join(',') : String(v);
        break;
      case 'rating': {
        const n = Number(v);
        out[f.key] = Number.isFinite(n) ? n : 0;
        break;
      }
      case 'date':
      case 'datetime':
      case 'time':
        out[f.key] = String(v).slice(0, 32);
        break;
      case 'daterange':
        out[f.key] = Array.isArray(v) ? v.join(' ~ ') : String(v);
        break;
      case 'image':
      case 'file':
        out[f.key] = Array.isArray(v) ? v.join(',') : String(v);
        break;
      case 'table':
        out[f.key] = JSON.stringify(v);
        break;
      default:
        out[f.key] = typeof v === 'object' ? JSON.stringify(v) : String(v).slice(0, 2000);
    }
  }

  return { data: out, errors };
}

/**
 * 提交表单数据
 * @param {number|string} formId 表单 ID 或公开令牌
 * @param {object} raw 提交的原始数据
 * @param {object} ctx { submitter, submitterId, ip, userAgent, byToken }
 */
async function submit(formId, raw, ctx) {
  const context = ctx || {};
  const form = context.byToken ? await getByToken(formId) : await getById(formId);
  if (!form) throw new Error('表单不存在');
  if (!form.status) throw new Error('表单已停用');
  if (context.byToken && !form.allowPublic) throw new Error('该表单未开放公开填写');

  const { data, errors } = validateAndCast(form, raw);
  if (errors.length) {
    await db.query(
      `INSERT INTO jdywh_form_records (form_id, data_json, submitter, submitter_id, ip, user_agent, status, message)
       VALUES (?,?,?,?,?,?,?,?)`,
      [form.id, JSON.stringify(raw || {}), context.submitter || null, context.submitterId || null,
        context.ip || null, (context.userAgent || '').slice(0, 255) || null, 'invalid', errors.join('；').slice(0, 500)]
    );
    const err = new Error(errors.join('；'));
    err.validation = errors;
    throw err;
  }

  // 写入项目数据表
  let writeInfo = null;
  if (form.projectId) {
    const project = await projects.getProject(form.projectId);
    if (project) {
      const dataId = `form_${form.code}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const columns = {};
      const parsed = {};

      for (const f of form.fields) {
        if (f.type === 'divider' || f.type === 'section') continue;
        const v = data[f.key];
        if (v === null || v === undefined) continue;
        columns[f.key] = v;
        parsed[`${f.key}_p`] = typeof v === 'object' ? JSON.stringify(v) : String(v).slice(0, 500);
      }

      try {
        await schema.ensureProjectTables(project.id);
        writeInfo = await schema.upsertRecord(project.id, {
          dataId,
          op: 'form_submit',
          formName: form.name,
          opTime: Date.now(),
          rawJson: JSON.stringify({ op: 'form_submit', formName: form.name, data, meta: { _id: dataId } }),
          columns,
          parsed,
        });
      } catch (err) {
        console.error('[forms] 写入项目数据表失败:', err.message);
        writeInfo = { error: err.message };
      }
    }
  }

  const result = await db.query(
    `INSERT INTO jdywh_form_records (form_id, data_json, submitter, submitter_id, ip, user_agent, status, message)
     VALUES (?,?,?,?,?,?,?,?)`,
    [form.id, JSON.stringify(data), context.submitter || null, context.submitterId || null,
      context.ip || null, (context.userAgent || '').slice(0, 255) || null,
      writeInfo && writeInfo.error ? 'partial' : 'ok',
      writeInfo && writeInfo.error ? `数据已记录，但写入项目表失败：${writeInfo.error}`.slice(0, 500) : null]
  );

  await db.query('UPDATE jdywh_forms SET submit_count = submit_count + 1 WHERE id = ?', [form.id]);

  // 考试表单：自动判分
  let examResult = null;
  if (form.formType === 'exam') {
    examResult = gradeExam(form, data);
    // 把成绩写入提交记录
    await db.query(
      'UPDATE jdywh_form_records SET message = ? WHERE id = ?',
      [`得分 ${examResult.earned}/${examResult.totalScore}（${examResult.percent}%）`, result.insertId]
    );
  }

  // 流程表单：创建待审批流程
  let flowInfo = null;
  if (form.formType === 'flow') {
    const nodes = (form.settings && form.settings.flowNodes) || [];
    flowInfo = {
      status: 'pending',
      currentStep: 0,
      totalSteps: nodes.length,
      nodes: nodes.map((n, i) => ({
        step: i + 1,
        name: n.name || `审批节点 ${i + 1}`,
        approver: n.approver || '',
        status: i === 0 ? 'pending' : 'waiting',
      })),
    };
  }

  return {
    recordId: result.insertId,
    formId: form.id,
    formType: form.formType,
    data,
    writeInfo,
    examResult,
    flowInfo,
    message: writeInfo && writeInfo.error ? '提交成功，但数据入库异常' : '提交成功',
  };
}

/** 表单提交记录 */
async function listRecords(formId, options) {
  const opts = options || {};
  const page = Math.max(1, parseInt(opts.page || '1', 10));
  const pageSize = Math.min(200, Math.max(5, parseInt(opts.pageSize || '20', 10)));
  const offset = (page - 1) * pageSize;

  const where = ['form_id = ?'];
  const params = [formId];
  if (opts.keyword) {
    where.push('(data_json LIKE ? OR submitter LIKE ? OR ip LIKE ?)');
    const kw = `%${opts.keyword}%`;
    params.push(kw, kw, kw);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM jdywh_form_records ${whereSql}`, params);
  const rows = await db.query(
    `SELECT * FROM jdywh_form_records ${whereSql} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    list: rows.map((r) => Object.assign({}, r, { data: parseJson(r.data_json, {}) })),
    total: Number((totalRow && totalRow.c) || 0),
    page,
    pageSize,
  };
}

async function stats() {
  const row = await db.queryOne(
    `SELECT (SELECT COUNT(*) FROM jdywh_forms) AS forms,
            (SELECT COUNT(*) FROM jdywh_forms WHERE status = 1) AS active,
            (SELECT COUNT(*) FROM jdywh_form_records) AS records,
            (SELECT COUNT(*) FROM jdywh_form_records WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)) AS today`
  );
  return {
    forms: Number((row && row.forms) || 0),
    active: Number((row && row.active) || 0),
    records: Number((row && row.records) || 0),
    today: Number((row && row.today) || 0),
  };
}

/**
 * 考试自动判分
 * @param {object} form 表单定义
 * @param {object} answers 提交的答案 { fieldKey: value }
 * @returns {object} { total, score, maxScore, passScore, passed, details }
 */
function gradeExam(form, answers) {
  const fields = (form.fields || []).filter((f) => Number(f.score) > 0);
  const totalScore = fields.reduce((s, f) => s + Number(f.score || 0), 0);
  const passScore = Number((form.settings && form.settings.examPassScore) || 60);

  const details = [];
  let earned = 0;

  fields.forEach((f) => {
    const expected = f.answer === undefined || f.answer === null ? '' : String(f.answer).trim();
    const actual = answers[f.key] === undefined || answers[f.key] === null ? '' : String(answers[f.key]).trim();
    const score = Number(f.score) || 0;

    let correct = false;
    if (f.type === 'checkbox') {
      // 多选：完全一致才算对（顺序无关）
      const a = actual.split(',').map((x) => x.trim()).filter(Boolean).sort();
      const b = expected.split(',').map((x) => x.trim()).filter(Boolean).sort();
      correct = a.length === b.length && a.every((v, i) => v === b[i]);
    } else if (f.type === 'number' || f.type === 'amount' || f.type === 'percent') {
      correct = Number(actual) === Number(expected);
    } else {
      correct = actual.toLowerCase() === expected.toLowerCase();
    }

    if (correct) earned += score;
    details.push({
      key: f.key,
      label: f.label,
      type: f.type,
      score,
      earned: correct ? score : 0,
      correct,
      expected: (form.settings && form.settings.examShowAnswer) ? expected : undefined,
      actual,
    });
  });

  const pct = totalScore > 0 ? Number(((earned / totalScore) * 100).toFixed(1)) : 0;

  return {
    totalScore,
    earned,
    percent: pct,
    passScore,
    passed: pct >= passScore,
    correctCount: details.filter((d) => d.correct).length,
    questionCount: details.length,
    details,
  };
}

module.exports = {
  FIELD_TYPES,
  FIELD_TYPE_MAP,
  FORM_TYPES,
  FORM_TYPE_MAP,
  WIDTHS,
  WIDTH_MAP,
  OPTION_LAYOUTS,
  FLOW_STATUS,
  list, getById, getByToken, create, update, remove, regenerateToken,
  submit, listRecords, stats, normalizeFields, validateAndCast, publicForm,
  gradeExam,
};