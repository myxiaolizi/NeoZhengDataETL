/**
 * V7: import the assembly flow (16 + 102 -> jdywh_crm_signing_v7) into jdywh_flows.
 *
 * SAFETY
 *  - dry-run by default; `--apply` writes.
 *  - Idempotent: if a flow with the same `code` already exists it is UPDATED (not duplicated).
 *  - Production fix applied here: clears n3.config.cutoffTime, because the value baked into
 *    the assembly JSON is the *snapshot* timestamp used for reconciliation. Shipping it to
 *    production would freeze the derived 当前节点/负责人 forever.
 *
 * Usage:
 *   node scripts/v7-flow-import.js            # dry-run
 *   node scripts/v7-flow-import.js --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const ASSEMBLY = path.join(__dirname, 'v7-flow-assembly.json');

(async () => {
  const spec = JSON.parse(fs.readFileSync(ASSEMBLY, 'utf8'));
  console.log('=== assembly spec ===');
  console.log(`  name=${spec.name}  code=${spec.code}  runMode=${spec.runMode}  target=${spec.targetTable}`);
  console.log(`  nodes=${(spec.nodes || []).length}  edges=${(spec.edges || []).length}`);

  /* ---- production fix: clear the snapshot cutoff ---- */
  const n3 = (spec.nodes || []).find((n) => n.id === 'n3');
  if (n3 && n3.config && n3.config.cutoffTime) {
    console.log(`\n[fix] n3(${n3.type}).cutoffTime "${n3.config.cutoffTime}" -> cleared (production must be realtime)`);
    n3.config.cutoffTime = '';
  }
  const cutoffCleared = !(n3 && n3.config && n3.config.cutoffTime);
  console.log(`  cutoffTime cleared: ${cutoffCleared}`);

  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [existing] = await c.query('SELECT id, name, code, status, run_mode FROM jdywh_flows WHERE code = ?', [spec.code]);
  console.log(`\n[check] existing flow with code=${spec.code}: ${existing.length ? JSON.stringify(existing[0]) : 'none'}`);

  const nodesJson = JSON.stringify(spec.nodes || []);
  const edgesJson = JSON.stringify(spec.edges || []);

  if (!APPLY) {
    console.log(`\n[dry-run] would ${existing.length ? 'UPDATE id=' + existing[0].id : 'INSERT'} a flow:`);
    console.log(`  name=${spec.name}`);
    console.log(`  code=${spec.code}`);
    console.log(`  run_mode=${spec.runMode}`);
    console.log(`  nodes=${(spec.nodes || []).length} edges=${(spec.edges || []).length}`);
    console.log(`  nodes_json bytes=${nodesJson.length}  edges_json bytes=${edgesJson.length}`);
    console.log('\n  re-run with --apply to write.');
    await c.end();
    return;
  }

  /* write */
  if (existing.length) {
    await c.query(
      'UPDATE jdywh_flows SET name=?, nodes=?, edges=?, run_mode=?, project_id=?, status=1, updated_at=NOW() WHERE id=?',
      [spec.name, nodesJson, edgesJson, spec.runMode, spec.projectId || null, existing[0].id]
    );
    console.log(`\n[apply] UPDATED flow id=${existing[0].id}`);
    console.log(`  verify: SELECT id,name,run_mode,project_id FROM jdywh_flows WHERE id=${existing[0].id}`);
  } else {
    const [r] = await c.query(
      'INSERT INTO jdywh_flows (name, code, nodes, edges, run_mode, project_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,1,NOW(),NOW())',
      [spec.name, spec.code, nodesJson, edgesJson, spec.runMode, spec.projectId || null]
    );
    console.log(`\n[apply] INSERTED flow id=${r.insertId}`);
  }

  const [after] = await c.query('SELECT id, name, code, run_mode, project_id, status FROM jdywh_flows WHERE code = ?', [spec.code]);
  console.log('  after:', JSON.stringify(after));
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
