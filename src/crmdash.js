'use strict';

const db = require('./db');
const projects = require('./projects');
const schema = require('./schema');

/**
 * CRM 客户签约看板数据
 *
 * 从项目 #16（CRM）的解析数据表聚合出看板所需的各项指标。
 * 参考 zk2.zhengl.vip/pc.html 的看板结构。
 */

/** CRM 项目字段映射（简道云 widget ID → 业务含义） */
const CRM_FIELDS = {
  连锁名称: 'widget_1791449342206',
  签约主体: 'widget_1791449342209',
  连锁类型: 'widget_1792048325267',
  门店数: 'widget_1792048325259',
  区域: 'widget_1791449342211',
  销售: 'widget_1791449342208',
  客服: 'widget_1791509478932',
  培训人: 'widget_1791509478935',
  签约时间: 'widget_1791510326270',
  服务开始: 'widget_1791449342217',
  服务结束: 'widget_1791449342218',
  业务对接人: 'widget_1791882979503',
  业务电话: 'widget_1791882979504',
  技术对接人: 'widget_1791882979505',
  技术电话: 'widget_1791882979506',
  对接结果: 'widget_1792029306426',
  对接备注: 'widget_1791596350260',
  提交流程: 'widget_1791533061604',
  流程状态: 'sys_flow_state_2',
  提交人: 'sys_creator_2',
  提交时间: 'sys_create_time_2',
};

/** 流程状态码 → 名称 */
const FLOW_STATES = {
  0: '进行中',
  1: '已完成',
  2: '已结束',
  3: '已撤销',
};

/** 解析值列名 */
function pcol(widget) {
  return `${widget}_p`;
}

/** 取字段值（优先解析列，回退原始列） */
function val(row, key) {
  const w = CRM_FIELDS[key];
  if (!w) return null;
  const p = row[`${w}_p`];
  if (p !== null && p !== undefined && p !== '') return p;
  const raw = row[w];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw.name || raw.phone || JSON.stringify(raw);
  return raw;
}

/** 取数字 */
function num(row, key) {
  const v = val(row, key);
  const n = Number(String(v === null ? '' : v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 取成员名称（去掉邮箱后缀） */
function memberName(row, key) {
  const v = val(row, key);
  if (!v) return '';
  return String(v).replace(/\([^)]*\)/g, '').trim();
}

/** 加载项目全部数据 */
async function loadRows(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) throw new Error('项目不存在');

  const table = project.parsed_table || schema.makeParsedTableName(project.id);
  if (!(await schema.tableExists(table))) return { project, rows: [] };

  const rows = await db.query(`SELECT * FROM \`${table}\` ORDER BY id DESC LIMIT 20000`);
  return { project, rows };
}

/** 构建看板数据 */
async function build(projectId) {
  const { project, rows } = await loadRows(projectId);

  /* ── 基础统计 ── */
  const total = rows.length;
  const totalStores = rows.reduce((s, r) => s + num(r, '门店数'), 0);

  const byRegion = {};
  const byType = {};
  const bySales = {};
  const byFlowState = {};
  const byMonth = {};

  rows.forEach((r) => {
    const region = val(r, '区域') || '未分区';
    const type = val(r, '连锁类型') || '未分类';
    const sales = memberName(r, '销售') || '未分配';
    const state = FLOW_STATES[Number(val(r, '流程状态'))] || '未知';
    const stores = num(r, '门店数');

    if (!byRegion[region]) byRegion[region] = { count: 0, stores: 0 };
    byRegion[region].count += 1;
    byRegion[region].stores += stores;

    if (!byType[type]) byType[type] = { count: 0, stores: 0 };
    byType[type].count += 1;
    byType[type].stores += stores;

    if (!bySales[sales]) bySales[sales] = { count: 0, stores: 0 };
    bySales[sales].count += 1;
    bySales[sales].stores += stores;

    byFlowState[state] = (byFlowState[state] || 0) + 1;

    // 按月统计签约
    const t = val(r, '签约时间') || val(r, '提交时间');
    if (t) {
      const d = new Date(String(t).replace(' ', 'T'));
      if (!isNaN(d.getTime())) {
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonth[m]) byMonth[m] = { count: 0, stores: 0 };
        byMonth[m].count += 1;
        byMonth[m].stores += stores;
      }
    }
  });

  /* ── 明细行（脱敏字段用于列表） ── */
  const detail = rows.map((r) => ({
    连锁名称: val(r, '连锁名称') || '',
    连锁类型: val(r, '连锁类型') || '',
    区域: val(r, '区域') || '',
    销售: memberName(r, '销售'),
    客服: memberName(r, '客服'),
    培训人: memberName(r, '培训人'),
    门店数: num(r, '门店数'),
    流程状态: FLOW_STATES[Number(val(r, '流程状态'))] || '未知',
    签约时间: val(r, '签约时间') || '',
    服务开始: val(r, '服务开始') || '',
    服务结束: val(r, '服务结束') || '',
    业务对接人: val(r, '业务对接人') || '',
    业务电话: val(r, '业务电话') || '',
    技术对接人: val(r, '技术对接人') || '',
    技术电话: val(r, '技术电话') || '',
    对接结果: val(r, '对接结果') || '',
    提交人: memberName(r, '提交人'),
    提交时间: val(r, '提交时间') || '',
  }));

  /* ── 排行榜 ── */
  const salesRank = Object.keys(bySales).map((k) => ({
    name: k, count: bySales[k].count, stores: bySales[k].stores,
  })).sort((a, b) => b.count - a.count);

  const typeRank = Object.keys(byType).map((k) => ({
    name: k, count: byType[k].count, stores: byType[k].stores,
  })).sort((a, b) => b.count - a.count);

  /* ── 趋势（按月） ── */
  const months = Object.keys(byMonth).sort();
  const trend = months.map((m) => ({
    label: m,
    count: byMonth[m].count,
    stores: byMonth[m].stores,
  }));

  /* ── 任务目标（可配置） ── */
  const TARGET = 500;

  return {
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
    },
    updatedAt: new Date().toISOString(),
    kpi: {
      total,
      totalStores,
      target: TARGET,
      completion: TARGET > 0 ? Number(((total / TARGET) * 100).toFixed(1)) : 0,
      inProgress: byFlowState['进行中'] || 0,
      done: byFlowState['已完成'] || 0,
      regions: Object.keys(byRegion).length,
      salesCount: Object.keys(bySales).length,
    },
    byRegion: Object.keys(byRegion).map((k) => ({
      name: k, count: byRegion[k].count, stores: byRegion[k].stores,
    })).sort((a, b) => b.count - a.count),
    byType: typeRank,
    byFlowState: Object.keys(byFlowState).map((k) => ({
      name: k, value: byFlowState[k],
    })).sort((a, b) => b.value - a.value),
    salesRank,
    trend,
    detail,
    options: {
      regions: Array.from(new Set(detail.map((d) => d.区域).filter(Boolean))).sort(),
      types: Array.from(new Set(detail.map((d) => d.连锁类型).filter(Boolean))).sort(),
      sales: Array.from(new Set(detail.map((d) => d.销售).filter(Boolean))).sort(),
      states: Array.from(new Set(detail.map((d) => d.流程状态).filter(Boolean))).sort(),
    },
  };
}

module.exports = { build, CRM_FIELDS, FLOW_STATES, loadRows };
