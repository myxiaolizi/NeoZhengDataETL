'use strict';

/**
 * V9 AI 问数「值域（value domain）」自测
 *
 * 运行：node scripts/v9-ai-valuedomain.js           （全量，含 4 次真实 Mimo 问数）
 *      node scripts/v9-ai-valuedomain.js --offline  （跳过真实问数，只跑离线断言）
 *
 * 修复背景（V8 遗留真实故障）：
 *   `buildSchemaText` 只把「列名(注释)」喂给模型，不给列的真实取值域。
 *   `jdywh_parsed_16.sys_flow_state_2` 是 DOUBLE 存 0/1、注释却叫「流程状态」，
 *   模型按中文语义猜：
 *     查询当前有多少客户已经完成了流程  → WHERE sys_flow_state_2 = '2'          → 0 行（真值 4）
 *     统计流程状态为流转完成的数量      → WHERE flow_current_node = '流转完成'    → 0 行（真值 4）
 *   同表还有「流程状态(节点)」「当前节点」两个注释相近的列，模型无从区分。
 *
 * 本脚本验证：
 *   1) 低基数列采样确实拿到值域（project 16 / mail 19 / flow 25 三类来源）；
 *   2) sys_flow_state_2 的值域含 0 与 1，且行数与库内直查一致；
 *   3) 提示词里出现「取值：」「0=进行中」「数值编码列」「近似列提醒」；
 *   4) 采样有兜底：坏列 / 空来源 / 不存在的列都不抛错；
 *   5) 有性能与体量红线：单次 resolveScope(project 16) ≤ 3000ms、候选列 ≤ 40、取值 ≤ 8；
 *   6) 真实问数 4 例结果正确：4 / 4 / 4 / 97。
 *
 * 只读：除 `ai.ask()` 会按既有行为写一条 jdywh_ai_chats 审计记录外，不改任何业务数据。
 */

const db = require('../src/db');
const ai = require('../src/ai');
const aiScope = require('../src/ai-scope');

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

function ok(name, detail) {
  pass += 1;
  console.log(`  PASS  ${name}${detail ? '  → ' + detail : ''}`);
}
function bad(name, detail) {
  fail += 1;
  failures.push(`${name}: ${detail}`);
  console.log(`  FAIL  ${name}  → ${detail}`);
}
function skipped(name, detail) {
  skip += 1;
  console.log(`  SKIP  ${name}${detail ? '  → ' + detail : ''}`);
}
function check(name, cond, detail) {
  if (cond) ok(name, detail); else bad(name, detail);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(name, a); else bad(name, `${a} !== ${e}`);
}
async function throwsAsync(name, fn, re) {
  try {
    await fn();
    bad(name, '未抛错');
  } catch (err) {
    if (!re || re.test(err.message)) ok(name, err.message.split('\n')[0].slice(0, 80));
    else bad(name, `错误信息不匹配：${err.message}`);
  }
}
async function noThrow(name, fn) {
  try {
    const r = await fn();
    ok(name, typeof r === 'string' ? r : '');
    return r;
  } catch (err) {
    bad(name, err.message);
    return null;
  }
}

/** 库里某列的真实取值分布（用于和采样结果对账） */
async function realDistribution(table, column) {
  const rows = await db.query(
    `SELECT ${aiScope.quoteName(column)} AS v, COUNT(*) AS c
       FROM ${aiScope.quoteName(table)} GROUP BY ${aiScope.quoteName(column)} ORDER BY c DESC`
  );
  return rows.map((r) => ({ v: r.v === null ? null : String(r.v), c: Number(r.c) }));
}

/** 从来源里找列 */
function columnOf(source, name) {
  return (source.columns || []).find((c) => String(c.name) === String(name)) || null;
}

const OFFLINE_ONLY = process.argv.includes('--offline');

(async () => {
  /* ══════════════ 1. 三类来源都能采到值域 ══════════════ */
  console.log('\n[1] 三类来源的低基数列值域采样（project 16 / mail 19 / flow 25）');

  const t0 = Date.now();
  const resolved = await aiScope.resolveScope([{ kind: 'project', id: 16 }]);
  const scopeMs = Date.now() - t0;
  const proj = resolved.sources[0];
  const projWithValues = (proj.columns || []).filter((c) => Array.isArray(c.values) && c.values.length);

  check('project 16 解析出 107 列', (proj.columns || []).length === 107, `${(proj.columns || []).length} 列`);
  check('project 16 至少 1 列拿到值域', projWithValues.length >= 1, `${projWithValues.length} 列有值域`);
  check('值域结构为 [{v,c}]（v 字符串 / c 行数）',
    projWithValues.every((c) => c.values.every((it) => 'v' in it && typeof it.c === 'number' && it.c > 0)),
    JSON.stringify(projWithValues[0] && projWithValues[0].values.slice(0, 3)));
  check('source.valueDomain 统计随来源返回（含耗时 ms）',
    !!proj.valueDomain && Number(proj.valueDomain.ms) >= 0 && proj.valueDomain.columns === projWithValues.length,
    JSON.stringify(proj.valueDomain));

  const mailSrc = (await aiScope.resolveScope([{ kind: 'mail', id: 19 }])).sources[0];
  const mailWithValues = (mailSrc.columns || []).filter((c) => Array.isArray(c.values) && c.values.length);
  check('mail 19 至少 1 列拿到值域', mailWithValues.length >= 1,
    `${mailWithValues.length} 列（${mailWithValues.map((c) => c.name).join(',')}）`);

  const flowSrc = (await aiScope.resolveScope([{ kind: 'flow', id: 25 }])).sources[0];
  const flowWithValues = (flowSrc.columns || []).filter((c) => Array.isArray(c.values) && c.values.length);
  check('flow 25 至少 1 列拿到值域', flowWithValues.length >= 1,
    `${flowWithValues.length} 列（${flowWithValues.slice(0, 3).map((c) => c.name).join(',')}…）`);

  /* ══════════════ 2. sys_flow_state_2 的值域必须含 0 与 1 ══════════════ */
  console.log('\n[2] 关键列 sys_flow_state_2（流程状态，DOUBLE 存 0/1）');
  const stateCol = columnOf(proj, 'sys_flow_state_2');
  check('sys_flow_state_2 列存在且带注释「流程状态」',
    !!stateCol && String(stateCol.label) === '流程状态',
    stateCol ? `${stateCol.type} / ${stateCol.label}` : '缺失');
  check('sys_flow_state_2 类型识别为 DOUBLE',
    !!stateCol && String(stateCol.type).toUpperCase() === 'DOUBLE', stateCol && stateCol.type);

  const stateValues = (stateCol && stateCol.values) || [];
  const stateKeys = stateValues.map((it) => String(it.v));
  check('sys_flow_state_2 值域含 0', stateKeys.includes('0'), JSON.stringify(stateValues));
  check('sys_flow_state_2 值域含 1', stateKeys.includes('1'), JSON.stringify(stateValues));
  check('sys_flow_state_2 值域恰好 2 个取值（0/1）', stateValues.length === 2, `${stateValues.length} 个`);

  const realState = await realDistribution('jdywh_parsed_16', 'sys_flow_state_2');
  const sampledCounts = Object.fromEntries(stateValues.map((it) => [String(it.v), it.c]));
  const realCounts = Object.fromEntries(realState.map((it) => [String(it.v), it.c]));
  eq('采样行数与库内直查一致（0→93、1→4）', sampledCounts, realCounts);
  check('「已完成流程」的真值 1 → 4 行（修复前 AI 查成 0）',
    Number(realCounts['1']) === 4, `COUNT(sys_flow_state_2=1) = ${realCounts['1']}`);

  /* ══════════════ 3. 采样规则：低基数 / 列数 / 取值上限 / 跳过清单 ══════════════ */
  console.log('\n[3] 采样规则（低基数 ≤24、列数 ≤40、取值 ≤8、长文本/空列/系统列跳过）');

  const candidates = aiScope.pickSampleCandidates(proj.columns, proj.rowCount);
  check('候选列数不超过 40（core 轮）', candidates.core.length <= 40, `core=${candidates.core.length} text=${candidates.text.length}`);
  check('候选列优先包含「流程状态 / 节点 / 区域」等关键词列',
    ['sys_flow_state_2', 'widget_1791533061604', 'widget_1791449342211'].every(
      (n) => candidates.core.some((c) => String(c.name) === n)
    ),
    candidates.core.slice(0, 6).map((c) => c.label).join(','));
  check('候选列不包含 id / raw_json / jdy_op_time 等系统列',
    !candidates.core.some((c) => ['id', 'raw_json', 'jdy_op_time', 'jdy_data_id'].includes(String(c.name))));
  check('每列取值个数不超过 8',
    projWithValues.every((c) => c.values.length <= aiScope.SAMPLE_TOP_VALUES),
    `上限 ${aiScope.SAMPLE_TOP_VALUES}`);

  // 高基数列（distinct > 24）不得有值域
  const highCard = await db.queryOne(
    'SELECT COUNT(DISTINCT `jdy_data_id`) AS d FROM `jdywh_parsed_16`'
  );
  const highCol = columnOf(proj, 'jdy_data_id');
  check('高基数列（jdy_data_id，97 个 distinct）未被展开值域',
    Number(highCard.d) > aiScope.SAMPLE_MAX_DISTINCT && highCol && !highCol.values,
    `distinct=${highCard.d}`);

  // 长文本列（取值超长）不得有值域
  const noteCol = columnOf(proj, 'w_1792552277285');
  check('长文本列（培训备注，取值超长）不展开值域', !!noteCol && !noteCol.values,
    noteCol ? `label=${noteCol.label}` : '列不存在');

  // 全空列不得有值域
  const emptyCol = columnOf(proj, 'widget_1792072044675');
  check('全空列（是否开通，97 行全空）不展开值域', !!emptyCol && !emptyCol.values,
    emptyCol ? `label=${emptyCol.label}` : '列不存在');

  // 值域行数与库内直查一致（再验一列，防止「只对 sys_flow_state_2 特判」）
  const areaCol = columnOf(proj, 'widget_1791449342211');
  const realArea = await realDistribution('jdywh_parsed_16', 'widget_1791449342211');
  const sampledArea = Object.fromEntries(((areaCol && areaCol.values) || []).map((it) => [String(it.v), it.c]));
  const realAreaMap = Object.fromEntries(realArea.map((it) => [String(it.v), it.c]));
  eq('「区域」列采样行数与库内直查一致（北区/南区）', sampledArea, realAreaMap);

  /* ══════════════ 4. 提示词（buildSchemaText / buildSqlSystemPrompt） ══════════════ */
  console.log('\n[4] 提示词改造（取值域 + 数值编码提示 + 近似列并列展示 + system 规则）');

  const text = aiScope.buildSchemaText(resolved.sources);
  check('schemaText 出现「取值：」字样', text.includes('取值：'), `${text.length} 字`);
  check('schemaText 出现「0=进行中」', text.includes('0=进行中'));
  check('schemaText 出现「1=流转完成」', text.includes('1=流转完成'));
  check('schemaText 显式标注 sys_flow_state_2 的中文含义',
    /`sys_flow_state_2`[^\n]*0=进行中\(93行\)、1=流转完成\(4行\)/.test(text),
    (text.split('\n').find((l) => l.includes('sys_flow_state_2')) || '').slice(0, 160));
  check('schemaText 标注「数值编码列」并禁止中文文本比较',
    text.includes('数值编码列') && text.includes('不能用中文文本比较'));
  check('schemaText 含「近似列提醒」且把流程状态两列并列展示',
    text.includes('近似列提醒')
    && /`sys_flow_state_2`[^\n]*‖[^\n]*`widget_1791533061604`/.test(text),
    (text.split('\n').find((l) => l.includes('‖')) || '').slice(0, 120));
  check('schemaText 每列一行（不再用「，」把全部字段拼成一行）',
    text.split('\n').filter((l) => l.startsWith('- `')).length === (proj.columns || []).length,
    `${text.split('\n').filter((l) => l.startsWith('- `')).length} 行`);

  const sysPrompt = ai.buildSqlSystemPrompt(text);
  check('system prompt 含「取值：」使用规则（必须严格使用列出的取值）',
    /带「取值：」时，\*\*必须严格使用列出的取值\*\*/.test(sysPrompt));
  check('system prompt 明令禁止用中文文本比较数值列',
    sysPrompt.includes('绝不允许') && sysPrompt.includes('流转完成'));
  check('system prompt 含「近似列提醒」使用规则', sysPrompt.includes('近似列提醒'));
  check('system prompt 内嵌了 schemaText（模型能看到值域）', sysPrompt.includes('0=进行中(93行)'));

  /* ══════════════ 5. 兜底：采样失败 / 坏输入一律不抛错 ══════════════ */
  console.log('\n[5] 兜底（采样异常不抛、坏输入不抛、关闭开关生效）');

  await noThrow('sampleValueDomains(null) 不抛错', () => aiScope.sampleValueDomains(null));
  await noThrow('sampleValueDomains(坏源 invalid) 不抛错',
    () => aiScope.sampleValueDomains({ invalid: true, table: null, columns: [] }));
  await noThrow('sampleValueDomains(表不存在) 不抛错', async () => {
    const fake = {
      table: 'jdywh_not_exists_v9',
      rowCount: 1,
      columns: [{ name: 'x', type: 'VARCHAR(10)', dataType: 'varchar', maxLen: 10 }],
    };
    const stat = await aiScope.sampleValueDomains(fake);
    if (fake.columns[0].values) throw new Error('表不存在竟然采到了值域');
    return `columns=${stat.columns} errors=${stat.errors.length}`;
  });
  await noThrow('sampleValueDomains(列名不存在) 不抛错且该列无值域', async () => {
    const fake = {
      table: 'jdywh_parsed_16',
      rowCount: 97,
      columns: [{ name: 'no_such_column_v9', type: 'VARCHAR(20)', dataType: 'varchar', maxLen: 20, label: '不存在的列' }],
    };
    const stat = await aiScope.sampleValueDomains(fake);
    if (fake.columns[0].values) throw new Error('不存在的列竟然采到了值域');
    return `columns=${stat.columns} errors=${stat.errors.length}`;
  });
  // 采样失败只挂 valueDomain 统计，绝不把空数组挂到 columns[i].values 上
  const failedSrc = { table: 'jdywh_not_exists_v9', rowCount: 1, columns: [{ name: 'x', type: 'VARCHAR(10)', dataType: 'varchar', maxLen: 10 }] };
  await aiScope.sampleValueDomains(failedSrc);
  check('采样失败时该列不挂 values（而非挂空数组）', !('values' in failedSrc.columns[0]));

  const noSample = await aiScope.resolveScope([{ kind: 'project', id: 16 }], { sampleValues: false });
  check('resolveScope(sampleValues:false) 不采样（values 全无）',
    (noSample.sources[0].columns || []).every((c) => !c.values),
    `columns=${(noSample.sources[0].columns || []).length}`);
  check('sampleValues:false 时 schemaText 不出现「取值：」',
    !aiScope.buildSchemaText(noSample.sources).includes('取值：'));

  /* ══════════════ 6. 性能红线 ══════════════ */
  console.log('\n[6] 性能红线（每次问数都会跑 resolveScope）');
  console.log(`        单次 resolveScope(project 16) 实测：${scopeMs}ms`);
  check('单次 resolveScope(project 16) ≤ 3000ms', scopeMs <= 3000, `${scopeMs}ms`);

  const tOpt = Date.now();
  const options = await aiScope.listScopeOptions();
  const optMs = Date.now() - tOpt;
  check('listScopeOptions 不做值域采样（批量枚举不付采样开销）',
    !options.projects.some((p) => (p.columns || []).some((c) => c.values)),
    `四类来源 ${options.projects.length}/${options.datasets.length} 个，耗时 ${optMs}ms`);

  const tMulti = Date.now();
  const multi = await aiScope.resolveScope([{ kind: 'project', id: 16 }, { kind: 'mail', id: 19 }, { kind: 'flow', id: 25 }]);
  const multiMs = Date.now() - tMulti;
  check('三来源同时采样仍 ≤ 3000ms（多范围问数可接受）', multiMs <= 3000,
    `${multi.sources.length} 个来源 ${multiMs}ms`);
  const multiText = aiScope.buildSchemaText(multi.sources);
  check('多来源 schemaText 正常生成且带值域', multiText.includes('取值：') && multiText.length > 1000,
    `${multiText.length} 字`);

  /* ══════════════ 7. 真实问数 4 例（4 / 4 / 4 / 97） ══════════════ */
  console.log('\n[7] 真实 Mimo 问数 4 例（每例最长等 180 秒）');
  const cases = [
    { q: '查询当前有多少客户已经完成了流程', want: 4, note: '修复前返回 0' },
    { q: '有多少客户完成了流程', want: 4, note: '修复前偶发 0' },
    { q: '统计流程状态为流转完成的数量', want: 4, note: '修复前返回 0' },
    { q: '当前有多少客户', want: 97, note: '总数基线' },
  ];

  if (OFFLINE_ONLY) {
    cases.forEach((c) => skipped(`真实问数「${c.q}」`, '--offline 跳过'));
  } else {
    for (const c of cases) {
      const started = Date.now();
      try {
        const r = await ai.ask(c.q, { scope: [{ kind: 'project', id: 16 }], userId: 1, maxRowsCap: 500 });
        const chatMs = Date.now() - started;
        const row = (r.rows && r.rows[0]) || {};
        // 取结果里第一个数值列作为答案（模型常附带 COUNT(DISTINCT) 等副列）
        const nums = Object.values(row).map((v) => Number(v)).filter((n) => Number.isFinite(n));
        check(`真实问数「${c.q}」返回行`, r.ok === true && r.rowCount > 0,
          `rows=${r.rowCount} ${chatMs}ms model=${r.model}`);
        check(`真实问数「${c.q}」= ${c.want}（${c.note}）`, nums.includes(c.want),
          `${JSON.stringify(row).slice(0, 160)}`);
        console.log(`        SQL 尾部：${String(r.sql).replace(/\s+/g, ' ').slice(-140)}`);
      } catch (err) {
        bad(`真实问数「${c.q}」`, err.message.split('\n')[0].slice(0, 200));
      }
    }
  }

  /* ══════════════ 收尾 ══════════════ */
  console.log('\n' + '─'.repeat(64));
  console.log(`V9 AI 值域自测：PASS ${pass}，FAIL ${fail}，SKIP ${skip}`);
  if (fail) {
    failures.forEach((f) => console.log('  - ' + f));
  } else {
    console.log('结果：ALL PASS');
  }
  try { await db.close(); } catch (_) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error('\nFATAL', err && err.stack ? err.stack : err);
  try { await db.close(); } catch (_) { /* ignore */ }
  process.exit(1);
});
