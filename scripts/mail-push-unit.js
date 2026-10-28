/**
 * 邮箱推送 —— 数据层单元测试
 *
 * 直接在 Node 内调用 mail-push 模块，覆盖：
 *   文件名解析、建表结构、入库、同文件幂等、跨文件合并、
 *   不同项目分流、表结构演进、异常输入、清理逻辑
 *
 * 用法：node scripts/mail-push-unit.js
 * 会在库中创建「测试_」前缀的临时项目，结束自动清理。
 */
'use strict';

const XLSX = require('xlsx');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, extra) {
  pass += 1;
  console.log(`  OK   ${name}${extra ? '  ' + extra : ''}`);
}
function bad(name, msg) {
  fail += 1;
  failures.push(`${name}: ${msg}`);
  console.log(`  FAIL ${name}  ${msg}`);
}
function check(name, cond, extra) {
  if (cond) ok(name, extra); else bad(name, extra || '断言失败');
}
function eq(name, actual, expect) {
  check(name, actual === expect, `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expect)}`);
}

function makeXlsx(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

(async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  const db = require('../src/db');
  const mp = require('../src/mail-push');

  console.log('======== 邮箱推送 · 数据层单元测试 ========');
  console.log('');

  const created = [];   // 记录本次创建的项目名，便于清理

  try {
    await db.ping();
    await mp.ensureMetaTables();

    /* ---------- 1. 文件名解析 ---------- */
    console.log('── 1. 文件名解析 ──');
    const cases = [
      ['药店智能体触达转化_整体_2026-10-28_11-14-36-157_987.xlsx', '药店智能体触达转化', '整体_2026-10-28_11-14-36-157_987'],
      ['药店智能体触达转化_整体_2026-10-29_09-14-36-157_987.xlsx', '药店智能体触达转化', '整体_2026-10-29_09-14-36-157_987'],
      ['药店智能体签约情况_整体_2026-10-29_11-14.xlsx', '药店智能体签约情况', '整体_2026-10-29_11-14'],
      ['A_B_2026-01-01.xlsx', 'A', 'B_2026-01-01'],
    ];
    for (const [f, pj, wj] of cases) {
      const r = mp.parseAttachmentName(f);
      eq('项目名 ← ' + f, r.projectName, pj);
      eq('wjmc  ← ' + f, r.wjmc, wj);
      eq('可解析 ← ' + f, r.ok, true);
    }

    console.log('');
    console.log('── 2. 非法文件名（应拒绝）──');
    const bads = [
      ['', '空文件名'],
      ['无扩展名_整体_2026-01-01', '无扩展名'],
      ['测试_整体_2026-01-01.txt', 'txt'],
      ['single.xlsx', '单段'],
    ];
    for (const [f, label] of bads) {
      const r = mp.parseAttachmentName(f);
      check('拒绝 ' + label, r.ok === false, 'reason=' + r.reason);
    }

    /* ---------- 3. 建表 + 入库 ---------- */
    console.log('');
    console.log('── 3. 建表与入库 ──');
    // 注意：项目名不能含下划线，否则会参与分段规则（这是需求给定的解析规则）
    const proj = '测试建表入库' + (Date.now() % 100000);
    const f1 = proj + '_整体_2026-01-01_10-00-00-000_001.xlsx';
    created.push(proj);

    const r1 = await mp.processAttachment({
      filename: f1,
      buffer: makeXlsx([
        ['连锁id', '连锁名称', '门店数'],
        [1001, '测试连锁A', 10],
        [1002, '测试连锁B', 20],
        [1003, '测试连锁C', 30],
      ]),
      meta: { uid: 'unit-1' },
    });
    eq('首次导入成功', r1.ok, true);
    eq('新建项目', r1.projectCreated, true);
    eq('新建数据表', r1.tableCreated, true);
    eq('列数（3 数据列 + id + wjmc + import_date）', r1.columnsTotal, 3);
    eq('入库行数', r1.rowsTotal, 3);
    eq('累计行数', r1.rowCount, 3);
    eq('项目名解析正确', r1.projectName, proj);

    // 列顺序校验
    const cols = await mp.columns(r1.table);
    eq('表第 1 列为 id', cols[0].name, 'id');
    eq('表第 2 列为 wjmc', cols[1].name, 'wjmc');
    eq('表最后 1 列为 import_date', cols[cols.length - 1].name, 'import_date');
    eq('id 为主键', cols[0].ckey, 'PRI');
    eq('数据列注释为中文表头', cols[2].comment, '连锁id');
    eq('数据列第 3 列', cols[2].comment, '连锁id');
    eq('数据列第 4 列', cols[3].comment, '连锁名称');

    /* ---------- 4. 同文件幂等 ---------- */
    console.log('');
    console.log('── 4. 同文件重复导入（幂等）──');
    const r2 = await mp.processAttachment({
      filename: f1,
      buffer: makeXlsx([
        ['连锁id', '连锁名称', '门店数'],
        [1001, '测试连锁A', 10],
        [1002, '测试连锁B', 20],
        [1003, '测试连锁C', 30],
      ]),
      meta: { uid: 'unit-1' },
    });
    eq('幂等：行数不变', r2.rowCount, 3);
    eq('替换旧数据', r2.replaced, 3);

    /* ---------- 5. 跨文件合并 ---------- */
    console.log('');
    console.log('── 5. 同项目不同文件（合并）──');
    const f2 = proj + '_整体_2026-01-02_10-00-00-000_002.xlsx';
    const r3 = await mp.processAttachment({
      filename: f2,
      buffer: makeXlsx([
        ['连锁id', '连锁名称', '门店数'],
        [2001, '测试连锁D', 40],
        [2002, '测试连锁E', 50],
      ]),
      meta: { uid: 'unit-2' },
    });
    eq('合并：非新建项目', r3.projectCreated, false);
    eq('合并：累计 3+2', r3.rowCount, 5);

    const wjRows = await db.query(
      `SELECT wjmc, COUNT(*) AS c FROM \`${r3.table}\` GROUP BY wjmc ORDER BY wjmc`
    );
    eq('两个 wjmc 分组', wjRows.length, 2);
    eq('第 1 批 3 行', Number(wjRows[0].c), 3);
    eq('第 2 批 2 行', Number(wjRows[1].c), 2);

    /* ---------- 6. 不同项目分流 ---------- */
    console.log('');
    console.log('── 6. 不同业务名（新建项目）──');
    const proj2 = '测试分流' + (Date.now() % 100000);
    created.push(proj2);
    const r4 = await mp.processAttachment({
      filename: proj2 + '_整体_2026-01-03_10-00-00-000_003.xlsx',
      buffer: makeXlsx([['甲', '乙'], [1, 2]]),
      meta: { uid: 'unit-3' },
    });
    eq('分流：新建独立项目', r4.projectCreated, true);
    check('分流：独立数据表', r4.table !== r3.table, `${r4.table} vs ${r3.table}`);

    /* ---------- 6b. 不同批次同项目（追加而非覆盖）---------- */
    console.log('');
    console.log('── 6b. 同项目不同日期（应追加，不覆盖）──');
    const r4b = await mp.processAttachment({
      filename: proj2 + '_整体_2026-01-05_10-00-00-000_005.xlsx',
      buffer: makeXlsx([['甲', '乙'], [3, 4], [5, 6]]),
      meta: { uid: 'unit-3b' },
    });
    eq('追加后累计 1+2', r4b.rowCount, 3);
    const wj2 = await db.query(
      `SELECT wjmc, COUNT(*) AS c FROM \`${r4b.table}\` GROUP BY wjmc ORDER BY wjmc`
    );
    eq('保留 2 个批次', wj2.length, 2);
    eq('第 1 批仍为 1 行', Number(wj2[0].c), 1);
    eq('第 2 批为 2 行', Number(wj2[1].c), 2);

    /* ---------- 7. 表结构演进 ---------- */
    console.log('');
    console.log('── 7. 新附件增加新列（自动 ALTER）──');
    const beforeCols = (await mp.columns(r3.table)).length;
    const r5 = await mp.processAttachment({
      filename: proj + '_整体_2026-01-04_10-00-00-000_004.xlsx',
      buffer: makeXlsx([
        ['连锁id', '连锁名称', '门店数', '新增列X', '新增列Y'],
        [3001, '测试连锁F', 60, 'x1', 'y1'],
      ]),
      meta: { uid: 'unit-4' },
    });
    const afterCols = (await mp.columns(r3.table)).length;
    eq('新增 2 列后总列数', r5.columnsTotal, 5);
    eq('物理表列数增加', afterCols - beforeCols, 2);
    eq('累计行数 5+1', r5.rowCount, 6);

    // 旧行新列应为 NULL
    const oldWjmc = mp.parseAttachmentName(f1).wjmc;
    const oldRows = await db.query(
      `SELECT * FROM \`${r3.table}\` WHERE wjmc = ?`, [oldWjmc]
    );
    eq('旧批次行仍存在', oldRows.length, 3);
    const newColName = (await mp.columns(r3.table)).find((c) => c.comment === '新增列X');
    check('新列已创建', !!newColName, newColName ? newColName.name : '未找到');
    if (oldRows.length && newColName) {
      const v = oldRows[0][newColName.name];
      check('旧行新列为 NULL', v === null || v === undefined, '实际=' + JSON.stringify(v));
    }

    /* ---------- 8. 异常输入 ---------- */
    console.log('');
    console.log('── 8. 异常输入健壮性 ──');
    const beforeProjects = (await mp.listProjects()).length;
    const errCases = [
      ['损坏文件（纯文本冒充）', '测试损坏文件_整体_2026-01-01.xlsx', Buffer.from('not a real xlsx')],
      ['随机二进制冒充', '测试随机二进制_整体_2026-01-01.xlsx', Buffer.from([0, 1, 2, 3, 255, 254, 253, 252])],
      ['空 buffer', '测试空文件_整体_2026-01-01.xlsx', Buffer.alloc(0)],
      ['空表头', '测试空表头_整体_2026-01-01.xlsx', makeXlsx([[]])],
      ['纯文本扩展名', '测试纯文本_整体_2026-01-01.txt', Buffer.from('hello')],
      ['单单元格伪表格', '测试单格_整体_2026-01-01.xlsx', makeXlsx([['孤立值']])],
    ];
    for (const [label, fn, buf] of errCases) {
      let res;
      try {
        res = await mp.processAttachment({ filename: fn, buffer: buf, meta: { uid: 'unit-err' } });
        check(label + ' 被拒绝', res.ok === false, 'result=' + res.result + ' msg=' + (res.message || ''));
      } catch (e) {
        bad(label + ' 被拒绝', '抛出未捕获异常: ' + e.message);
      }
    }
    const afterProjects = (await mp.listProjects()).length;
    eq('异常输入未产生垃圾项目', afterProjects, beforeProjects);

    /* ---------- 9. 表名白名单 ---------- */
    console.log('');
    console.log('── 9. 安全：表名白名单 ──');
    for (const t of ['users', 'jdywh_data_16', 'mysql.user', 'test; DROP TABLE x']) {
      let threw = false;
      try { await mp.columns(t); mp.assertOwnTable(t); } catch (e) { threw = true; }
      if (['users', 'mysql.user', 'test; DROP TABLE x'].includes(t)) {
        check('拒绝非白名单表 ' + t, threw);
      }
    }
    // jdywh_data_16 属于本应用前缀，允许操作（只读查询列）
    const legit = await mp.columns('jdywh_data_16');
    check('允许同前缀表 jdywh_data_16', legit.length > 0, '列数=' + legit.length);

    /* ---------- 10. 邮箱连接失败必须正确报错 ---------- */
    console.log('');
    console.log('── 10. 邮箱连接失败的错误传递 ──');
    const accounts = require('../src/mail-accounts');
    const inbox = require('../src/mail-inbox');
    await accounts.ensureTable();
    const enabled = await accounts.listEnabled();
    const target = enabled.find((a) => a.password) || enabled[0];
    if (target) {
      const origPass = target.password;
      try {
        // 临时改成错误密码
        await accounts.update(target.id, { password: 'definitely-wrong-password-' + Date.now() });
        const t = await inbox.testConnection({ id: target.id });
        check('错误密码 testConnection 返回 ok=false', t.ok === false, 'msg=' + (t.message || '').slice(0, 50));
        check('错误密码提示可读', /密码|认证|连接/.test(t.message || ''), (t.message || '').slice(0, 40));

        const rr = await inbox.runOnce({ force: true, accountId: target.id });
        check('错误密码 runOnce 返回 ok=false', rr.ok === false, 'msg=' + (rr.message || '').slice(0, 50));
        check('runOnce 未误报导入', (rr.imported || 0) === 0, 'imported=' + rr.imported);
      } finally {
        await accounts.update(target.id, { password: origPass });
      }
      const t2 = await inbox.testConnection({ id: target.id });
      check('恢复密码后可连接', t2.ok === true, (t2.message || '').slice(0, 40));
    } else {
      console.log('  跳过（无启用的邮箱账户）');
    }

    /* ---------- 汇总 ---------- */
    console.log('');
    console.log('======== 结果 ========');
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) {
      console.log('');
      console.log('失败详情：');
      failures.forEach((f) => console.log('  - ' + f));
    }

    /* ---------- 清理 ---------- */
    console.log('');
    console.log('── 清理测试数据 ──');
    const P = process.env.TABLE_PREFIX || 'jdywh_';
    for (const name of created) {
      const pj2 = await db.queryOne(`SELECT id, data_table FROM \`${P}mail_projects\` WHERE name = ?`, [name]);
      if (!pj2) continue;
      await db.query(`DROP TABLE IF EXISTS \`${pj2.data_table}\``);
      await db.query(`DELETE FROM \`${P}mail_logs\` WHERE project_id = ?`, [pj2.id]);
      await db.query(`DELETE FROM \`${P}mail_projects\` WHERE id = ?`, [pj2.id]);
      console.log('  已清理: ' + name + ' (' + pj2.data_table + ')');
    }
    await db.query(`DELETE FROM \`${P}mail_logs\` WHERE uid LIKE 'unit-%'`);

    await db.close();
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('');
    console.error('测试执行异常:', e.stack || e.message);
    try { await db.close(); } catch (_) { /* ignore */ }
    process.exit(1);
  }
})();
