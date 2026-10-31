'use strict';

/**
 * V7 · 目标流程装配生成器（**只读**：只写本地 JSON 文件，不碰数据库）
 *
 * 产出 scripts/v7-flow-assembly.json —— 要求 6 的交付物：
 *   源(16) ⟕ 右路收敛(102 → pick_current_task) → 59 列重命名 → sink_table upsert
 *
 * 设计要点：
 *   1. 102 是**流程事件表**（1 实例最多 19 条事件，实测 369 条 / 69 实例），
 *      右路必须先过 pick_current_task 收敛成「1 实例 1 行」，否则 96×369 行数爆炸；
 *   2. 27 个实例在 102 里没有任何事件（事件推送 2026-10-23 才开始），
 *      left join 保留这些左行，两列用 computed 的 coalesce 回退到 16 的
 *      flow_current_node / flow_current_owner；
 *   3. xlsx 两组重名列必须改名：第 2 个「优惠券」→「优惠券(结果)」，
 *      第 2 个「流程状态」→「流程状态(节点)」。后者与第 1 个共用同一源列，
 *      因此在 computed 里先 copy 出一个别名列，再由 rename 映射成两个不同目标名；
 *   4. 目标表必须 jdywh_ 开头（schema.isOwnTable），主键 data_id 供 upsert。
 *
 * 运行：cd C:\Data\DSH\jdy-push && node scripts/v7-flow-assembly.build.js
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'v7-flow-assembly.json');
const TARGET_TABLE = 'jdywh_crm_signing_v7';
const PROJ_FORM = 16;
const PROJ_FLOW = 102;

/** 59 列：[来源表达式, 目标列名] —— 顺序即契约 §2.1 的业务表列顺序 */
const STATE_SRC_COL = '流程状态_状态源';   // 由 computed 从 sys_flow_state_2 翻译而来
const COLUMNS = [
  ['jdy_data_id', 'data_id'],
  ['w_1791449342206_title_p', '标题'],
  ['w_1792564761950', '流水号'],
  ['widget_1791449342211', '区域'],
  ['widget_1791449342205', '连锁ID'],
  ['widget_1791449342209', '签约主体名称'],
  ['widget_1791449342206', '连锁名称'],
  ['widget_1792048325267', '连锁类型'],
  ['w_1792577110570', '对接版本'],
  ['widget_1792048325259', '门店数'],
  ['w_1793101382911', '上月销售门店数'],
  ['w_1793101382912', '近2年销售门店数'],
  ['w_1793343168111', '签约类型'],
  ['widget_1791882979503', '连锁业务对接人姓名'],
  ['widget_1791882979504_p', '连锁业务对接人联系电话'],
  ['widget_1791882979505', '连锁技术对接人姓名'],
  ['widget_1791882979506_p', '连锁技术对接人联系电话'],
  ['widget_1791510326270_p', '签约时间'],
  ['widget_1791449342217_p', '服务开始时间'],
  ['widget_1791449342218_p', '服务结束时间'],
  ['widget_1791449342208_p', '销售'],
  ['widget_1791509478932_p', '客服'],
  ['w_1792139730147_p', '解决方案'],
  ['widget_1791509478935_p', '培训人'],
  ['widget_1791510696565_p', '基础资料'],
  ['widget_1791510696561_p', '优惠券'],
  ['w_1793089366573', '连锁ERP名称'],
  ['widget_1792029306426', '对接结果'],
  ['widget_1791596350260', '对接备注'],
  ['w_1792547295323', '优惠券(结果)'],          // 原名「优惠券」第 2 个 → 改名避免重名
  ['w_1792547295325', '短信报备'],
  ['widget_1791509478941_p', '渠道充值和余额'],
  ['w_1792547295328', '客服备注'],
  ['w_1792552277283', '培训结果'],
  ['w_1792552277285', '培训备注'],
  ['w_1793089366506', '策略开通情况'],
  ['widget_1791964258708_p', '已开通策略'],
  ['widget_1791964258722', '未开通策略原因'],
  ['widget_1791533061604', '流程状态'],
  ['widget_1791453695943', '区域负责人手机号码'],
  ['w_1792139730191', '省或直辖市'],
  ['w_1792131264427_province_p', '地址(表单格式)(省/自治区/直辖市)'],
  ['w_1792131264427_city_p', '地址(表单格式)(市)'],
  ['w_1792131264427_district_p', '地址(表单格式)(县/区)'],
  ['widget_1792072044675', '是否开通'],
  ['w_1793094135522_p', '单据提交时间'],
  ['w_1793094135524_p', '策略开通时间'],
  ['w_1793094135538_p', '实施对接时间'],
  ['w_1793094135578_p', '对接审核时间'],
  ['w_1793094135592_p', '客服处理时间'],
  ['w_1793094135593_p', '客户培训时间'],
  ['w_1793094135594_p', '连锁使用时间'],
  ['w_1793094135608_p', '策略审核时间'],
  ['sys_creator_2_p', '提交人'],
  ['sys_create_time_2_p', '提交时间'],
  ['sys_update_time_2_p', '更新时间'],
  // ⚠️ 契约 §3.5 C2 修正：第 2 个「流程状态」并非与第 1 个同源，
  //    而是 sys_flow_state_2（0=进行中 / 1=流转完成，实测 96/96 对应）。
  //    业务表里是中文文本，故先用 computed 的 map: 翻译，再改名。
  [STATE_SRC_COL, '流程状态(节点)'],
  ['当前节点', '当前节点'],                     // 102 优先，回退 16.flow_current_node
  ['当前负责人', '当前负责人'],                 // 102 优先，回退 16.flow_current_owner
];

function build() {
  const keep = COLUMNS.map((c) => c[0]);
  const rename = COLUMNS.map((c) => `${c[0]}=${c[1]}`).join('\n');

  const nodes = [
    {
      id: 'n1', type: 'source_project', label: '表单推送(16)',
      x: 60, y: 80,
      config: { projectId: PROJ_FORM, table: 'parsed', limit: 5000 },
    },
    {
      id: 'n2', type: 'source_project', label: '流程推送(102) 事件',
      x: 60, y: 320,
      config: { projectId: PROJ_FLOW, table: 'parsed', limit: 20000 },
    },
    {
      id: 'n3', type: 'pick_current_task', label: '收敛当前待办(每实例1行)',
      x: 320, y: 320,
      config: {
        instanceKey: 'event_instance_id',
        timeColumn: 'jdy_op_time',
        // 契约 §3.5 C3：挂起待办 = 最后一条 created>0 且其后无 completed/canceled
        mode: 'pending',
        // 业务表快照时刻 2026-10-30 23:30 北京 = 15:30 UTC。
        // 固定此值是为了与业务表逐行对账；生产环境应留空（=用当前时间）。
        cutoffTime: '2026-10-30 23:30:00',
        createdCountColumn: 'event_created_count',
        completedCountColumn: 'event_completed_count',
        canceledCountColumn: 'event_canceled_count',
        nodeColumn: 'event_flow_name',
        ownerColumn: 'event_current_assignee',
        nodeAlias: '开始=销售签约',
        outputNodeName: '当前节点',
        outputOwnerName: '当前负责人',
      },
    },
    {
      id: 'n4', type: 'join', label: '关联 16 ⟕ 102',
      x: 580, y: 180,
      config: {
        joinType: 'left',
        leftKey: 'jdy_data_id',
        rightKey: 'event_instance_id',
        rightAgg: 'first',        // 右路已在 n3 收敛成 1 行/实例，这里取唯一那条
        rightPrefix: 'flow_',
        rightFields: '当前节点,当前负责人',
        leftSource: 'n1',
        rightSource: 'n3',
      },
    },
    {
      id: 'n5', type: 'computed', label: '运行态回退 + 重名列别名',
      x: 840, y: 180,
      config: {
        // 顺序敏感（同一目标列可写多条）：
        //   1) 102 有挂起待办 → 用它；没有 → 回退 16 的 flow_current_*
        //   2) 流程已结束（sys_flow_state_2 = 1）→ 当前节点/负责人一律置空
        //   3) 第 2 个「流程状态」= sys_flow_state_2（0/1）→ 翻译成业务表用的中文
        assignments: [
          '当前节点=coalesce:flow_当前节点,flow_current_node',
          '当前负责人=coalesce:flow_当前负责人,flow_current_owner',
          '当前节点=blankif:sys_flow_state_2:1',
          '当前负责人=blankif:sys_flow_state_2:1',
          `${STATE_SRC_COL}=map:sys_flow_state_2:0=进行中|1=流转完成`,
        ].join('\n'),
      },
    },
    {
      id: 'n6', type: 'select_fields', label: '挑选 59 列',
      x: 1100, y: 180,
      config: { mode: 'keep', fields: keep.join(',') },
    },
    {
      id: 'n7', type: 'rename', label: '重命名为业务表列名',
      x: 1360, y: 180,
      config: { mapping: rename },
    },
    {
      id: 'n8', type: 'sink_table', label: '写入 jdywh_crm_signing_v7',
      x: 1620, y: 180,
      config: {
        datasourceId: 0,
        table: TARGET_TABLE,
        mode: 'upsert',
        keyField: 'data_id',
        createTable: true,
      },
    },
  ];

  const edges = [
    { from: 'n1', to: 'n4' },
    { from: 'n2', to: 'n3' },
    { from: 'n3', to: 'n4' },
    { from: 'n4', to: 'n5' },
    { from: 'n5', to: 'n6' },
    { from: 'n6', to: 'n7' },
    { from: 'n7', to: 'n8' },
  ];

  return {
    name: 'CRM签约对账表（16+102 合成）',
    code: 'crm_signing_v7',
    description: 'CRM表单推送(16) 全字段 + CRM流程推送(102) 推导的当前节点/当前负责人，'
      + '合成 59 列宽表，写入 jdywh_crm_signing_v7；run_mode=trigger 时推送后自动刷新。',
    projectId: PROJ_FORM,
    sourceType: 'project',
    runMode: 'trigger',
    targetTable: TARGET_TABLE,
    nodes,
    edges,
  };
}

const def = build();
fs.writeFileSync(OUT, JSON.stringify(def, null, 2), 'utf8');

console.log(`已生成 ${OUT}`);
console.log(`  节点 ${def.nodes.length} 个：${def.nodes.map((n) => n.type).join(' → ')}`);
console.log(`  连线 ${def.edges.length} 条`);
console.log(`  select_fields 保留列数：${String(def.nodes[5].config.fields).split(',').length}`);
console.log(`  rename 映射条数：${String(def.nodes[6].config.mapping).split('\n').length}`);
console.log(`  目标表：${def.targetTable}（mode=upsert, keyField=data_id）`);
