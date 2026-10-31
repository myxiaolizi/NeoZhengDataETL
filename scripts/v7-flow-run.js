/**
 * V7: run the assembly flow (id from code=crm_signing_v7) to materialise the target table.
 * Usage: node scripts/v7-flow-run.js [--flow=<id>]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const flows = require('../src/flows');

(async () => {
  const arg = process.argv.find((a) => a.startsWith('--flow='));
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  let flowId = arg ? Number(arg.split('=')[1]) : 0;
  if (!flowId) {
    const [r] = await c.query("SELECT id, name FROM jdywh_flows WHERE code = 'crm_signing_v7'");
    if (!r.length) { console.error('flow not found'); process.exit(1); }
    flowId = r[0].id;
    console.log(`flow: id=${flowId} name=${r[0].name}`);
  }
  await c.end();

  console.log(`\n=== running flow ${flowId} ===`);
  const t0 = Date.now();
  const res = await flows.run(flowId, 'manual');
  const ms = Date.now() - t0;

  console.log(`\nok=${res.ok}  message=${res.message}`);
  console.log(`inputRows=${res.inputRows}  outputRows=${res.outputRows}  duration=${ms}ms`);
  if (res.nodeLogs) {
    console.log('\nnode logs:');
    res.nodeLogs.forEach((n) => {
      console.log(`  ${String(n.nodeId || '').padEnd(4)} ${String(n.type || '').padEnd(20)} in=${String(n.rows ?? '').padStart(6)} out=${String(n.outputRows ?? '').padStart(6)} ${n.ok === false ? 'FAILED: ' + (n.error || '') : ''} ${n.ms != null ? n.ms + 'ms' : ''}`);
    });
  }
  process.exit(res.ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
