'use strict';

/**
 * V7 · 流程装配前的前置校验（**只读**：仅 SHOW COLUMNS / SELECT）
 *
 * 校验 scripts/v7-flow-assembly.json 里引用的每个源列在 jdywh_parsed_16 /
 * jdywh_parsed_102 里是否真实存在。缺列会导致 select_fields 静默跳过 →
 * 目标表少一列，所以必须在装配前查清楚。
 *
 * 运行：cd C:\Data\DSH\jdy-push && node scripts/v7-flow-check-assembly.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const T16 = 'jdywh_parsed_16';
const T102 = 'jdywh_parsed_102';

async function columnsOf(table) {
  const rows = await db.query(`SHOW COLUMNS FROM \`${table}\``);
  return rows.map((r) => r.Field);
}

async function main() {
  const file = path.join(__dirname, 'v7-flow-assembly.json');
  if (!fs.existsSync(file)) {
    console.error(`找不到装配文件：${file}`);
    process.exit(1);
  }
  const def = JSON.parse(fs.readFileSync(file, 'utf8'));

  const c16 = new Set(await columnsOf(T16));
  const c102 = new Set(await columnsOf(T102));

  const byId = {};
  def.nodes.forEach((n) => { byId[n.id] = n; });

  let missing = 0;

  console.log('=== 1. pick_current_task 引用的 102 列 ===');
  const pct = def.nodes.find((n) => n.type === 'pick_current_task');
  const c = pct.config;
  [['instanceKey', c.instanceKey], ['timeColumn', c.timeColumn],
    ['createdCountColumn', c.createdCountColumn], ['canceledCountColumn', c.canceledCountColumn],
    ['nodeColumn', c.nodeColumn], ['ownerColumn', c.ownerColumn]].forEach(([k, v]) => {
    const has = c102.has(v);
    if (!has) missing += 1;
    console.log(`  ${has ? 'OK  ' : 'MISS'} ${k} = ${v}`);
  });

  console.log('\n=== 2. computed 引用的 16 列 ===');
  const cps = def.nodes.filter((n) => n.type === 'computed');
  const cpCols = new Set();
  cps.forEach((cp) => {
    String(cp.config.assignments || '').split('\n').forEach((line) => {
      const i = line.indexOf('=');
      if (i < 0) return;
      const spec = line.slice(i + 1).trim();
      // copy:A / coalesce:A,B / blankif:列:值 / map:列:键值对
      const m = spec.match(/^(?:copy|coalesce):(.*)$/i);
      if (m) {
        m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((col) => cpCols.add(col));
        return;
      }
      const m2 = spec.match(/^(?:blankif|map):\s*([^:]+):/i);
      if (m2) cpCols.add(m2[1].trim());
    });
  });
  [...cpCols].sort().forEach((col) => {
    // join 产出的 flow_* 列来源于 pick_current_task，不是 16 的表列
    if (col.startsWith('flow_') && col !== 'flow_current_node' && col !== 'flow_current_owner') {
      console.log(`  SKIP ${col}（join 产出列）`);
      return;
    }
    const has = c16.has(col);
    if (!has) missing += 1;
    console.log(`  ${has ? 'OK  ' : 'MISS'} ${col}`);
  });

  console.log('\n=== 3. select_fields 保留列表（左表来源列） ===');
  const sf = def.nodes.find((n) => n.type === 'select_fields');
  const keep = String(sf.config.fields || '').split(',').map((s) => s.trim()).filter(Boolean);
  const generated = new Set();
  cps.forEach((cp) => {
    String(cp.config.assignments || '').split('\n').forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) generated.add(line.slice(0, i).trim());
    });
  });

  console.log(`  共 ${keep.length} 列`);
  const seen = new Map();
  keep.forEach((col) => {
    const dup = seen.has(col);
    seen.set(col, (seen.get(col) || 0) + 1);
    if (generated.has(col)) {
      console.log(`  GEN  ${col}（由 computed 生成）`);
      return;
    }
    const has = c16.has(col);
    if (!has) missing += 1;
    if (dup) console.log(`  DUP  ${col}（重复引用）`);
    if (!has) console.log(`  MISS ${col}`);
  });
  const missingList = keep.filter((col) => !generated.has(col) && !c16.has(col));
  if (missingList.length === 0) console.log('  全部存在 ✅');

  console.log('\n=== 4. join 配置 ===');
  const jn = def.nodes.find((n) => n.type === 'join');
  const jc = jn.config;
  console.log(`  leftKey=${jc.leftKey} → 16 有此列: ${c16.has(jc.leftKey) ? 'OK' : 'MISS'}`);
  console.log(`  rightKey=${jc.rightKey} → 102 有此列: ${c102.has(jc.rightKey) ? 'OK' : 'MISS'}`);
  if (!c16.has(jc.leftKey)) missing += 1;
  if (!c102.has(jc.rightKey)) missing += 1;

  console.log('\n=== 5. 列数核对 ===');
  const rename = def.nodes.find((n) => n.type === 'rename');
  const pairs = String(rename.config.mapping || '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  console.log(`  select_fields 保留 ${keep.length} 列；rename 映射 ${pairs.length} 条`);
  const targets = pairs.map((l) => l.slice(l.indexOf('=') + 1).trim());
  const dupTarget = targets.filter((t, i) => targets.indexOf(t) !== i);
  console.log(`  目标列名 ${targets.length} 个，重复目标名：${dupTarget.length ? dupTarget.join(', ') : '无 ✅'}`);
  console.log(`  sink 表目标：${def.nodes.find((n) => n.type === 'sink_table').config.table}`);

  console.log(`\n${missing === 0 ? '✅ 装配引用全部有效' : `❌ 有 ${missing} 处缺列，需要修正装配 JSON`}`);
  if (missing) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[校验失败]', e && e.message ? e.message : e); process.exit(1); });
