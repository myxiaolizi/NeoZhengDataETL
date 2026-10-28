/**
 * 邮箱账户管理 —— 单元测试
 *
 * 覆盖：账户 CRUD、邮箱格式校验、重复检测、密码掩码、
 *       启停、进度重置、旧配置迁移、邮件列表/正文读取
 *
 * 用法：node scripts/mail-accounts-test.js
 * 会创建「测试账户」并在结束自动清理。
 */
'use strict';

let pass = 0;
let fail = 0;
const failures = [];

function ok(n, e) { pass += 1; console.log(`  OK   ${n}${e ? '  ' + e : ''}`); }
function bad(n, m) { fail += 1; failures.push(`${n}: ${m}`); console.log(`  FAIL ${n}  ${m}`); }
function check(n, c, e) { if (c) ok(n, e); else bad(n, e || '断言失败'); }
function eq(n, a, b) { check(n, a === b, `实际=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`); }

(async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  const db = require('../src/db');
  const accounts = require('../src/mail-accounts');

  console.log('======== 邮箱账户管理 · 单元测试 ========');
  console.log('');

  const createdIds = [];

  try {
    await db.ping();
    await accounts.ensureTable();

    const before = (await accounts.list()).length;

    /* ---------- 1. 创建 ---------- */
    console.log('── 1. 创建账户 ──');
    const uniq = Date.now() % 1000000;
    const email1 = `test-acct-${uniq}@example.com`;

    const a1 = await accounts.create({
      name: '测试账户A',
      email: email1,
      password: 'test-password-1',
      imap_host: 'imap.example.com',
      imap_port: 993,
      imap_secure: 1,
      mailbox: 'INBOX',
      enabled: 1,
      auto_import: 1,
      initial_days: 3,
      max_per_run: 20,
    });
    createdIds.push(a1.id);
    eq('创建成功返回 id', typeof a1.id, 'number');
    eq('邮箱地址正确', a1.email, email1);
    eq('账户名称正确', a1.name, '测试账户A');
    eq('IMAP 主机正确', a1.imap_host, 'imap.example.com');
    eq('端口正确', a1.imap_port, 993);
    eq('启用状态', a1.enabled, 1);
    eq('自动导入', a1.auto_import, 1);
    check('返回不含密码字段', a1.password === undefined, 'password=' + JSON.stringify(a1.password));
    eq('hasPassword 标记', a1.hasPassword, true);

    /* ---------- 2. 校验 ---------- */
    console.log('');
    console.log('── 2. 输入校验 ──');
    const bads = [
      [{ email: '', password: 'x' }, '空邮箱'],
      [{ email: 'not-an-email', password: 'x' }, '邮箱格式错误'],
      [{ email: `x-${uniq}@example.com`, password: '' }, '空密码'],
      [{ email: email1, password: 'x' }, '邮箱重复'],
    ];
    for (const [input, label] of bads) {
      let threw = false;
      let msg = '';
      try { await accounts.create(input); } catch (e) { threw = true; msg = e.message; }
      check('拒绝' + label, threw, msg);
    }

    /* ---------- 3. 邮箱大小写归一 ---------- */
    console.log('');
    console.log('── 3. 邮箱归一化 ──');
    const email2 = `TEST-UPPER-${uniq}@Example.COM`;
    const a2 = await accounts.create({ email: email2, password: 'pw2' });
    createdIds.push(a2.id);
    eq('邮箱转小写存储', a2.email, email2.toLowerCase());

    /* ---------- 4. 列表与掩码 ---------- */
    console.log('');
    console.log('── 4. 列表与密码掩码 ──');
    const list = await accounts.list();
    eq('账户数增加 2', list.length, before + 2);
    check('列表中无密码字段', list.every((x) => x.password === undefined));
    check('列表含 hasPassword', list.every((x) => typeof x.hasPassword === 'boolean'));

    const raw = await accounts.getRaw(a1.id);
    eq('内部查询可取到密码', raw.password, 'test-password-1');

    /* ---------- 5. 更新 ---------- */
    console.log('');
    console.log('── 5. 更新账户 ──');
    const upd = await accounts.update(a1.id, { name: '改名后', max_per_run: 99 });
    eq('名称已更新', upd.name, '改名后');
    eq('参数已更新', upd.max_per_run, 99);
    eq('密码保持不变（留空）', (await accounts.getRaw(a1.id)).password, 'test-password-1');

    // 显式改密码
    await accounts.update(a1.id, { password: 'new-password-2' });
    eq('密码已更新', (await accounts.getRaw(a1.id)).password, 'new-password-2');

    /* ---------- 6. 连接参数变更重置进度 ---------- */
    console.log('');
    console.log('── 6. 连接参数变更重置拉取进度 ──');
    await accounts.setProgress(a1.id, 12345);
    eq('进度已写入', (await accounts.getRaw(a1.id)).last_uid, 12345);
    await accounts.update(a1.id, { imap_host: 'imap.newhost.com' });
    eq('改主机后进度归零', (await accounts.getRaw(a1.id)).last_uid, 0);

    /* ---------- 7. 启停 ---------- */
    console.log('');
    console.log('── 7. 启用 / 停用 ──');
    const off = await accounts.setEnabled(a1.id, 0);
    eq('已停用', off.enabled, 0);
    const enabledList = await accounts.listEnabled();
    check('停用账户不在启用列表', !enabledList.some((x) => x.id === a1.id));
    const on = await accounts.setEnabled(a1.id, 1);
    eq('已启用', on.enabled, 1);
    check('启用账户出现在启用列表', (await accounts.listEnabled()).some((x) => x.id === a1.id));

    /* ---------- 8. 错误记录 ---------- */
    console.log('');
    console.log('── 8. 错误状态记录 ──');
    await accounts.setError(a1.id, '模拟连接失败');
    const errRow = await accounts.getRaw(a1.id);
    eq('last_status=fail', errRow.last_status, 'fail');
    eq('last_error 已记录', errRow.last_error, '模拟连接失败');
    await accounts.setProgress(a1.id, 100);
    const okRow = await accounts.getRaw(a1.id);
    eq('成功后 last_status=ok', okRow.last_status, 'ok');
    eq('成功后清空错误', okRow.last_error, null);

    /* ---------- 9. 邮件读取（真实账户）---------- */
    console.log('');
    console.log('── 9. 邮件列表与正文（需真实账户）──');
    const realList = await accounts.listEnabled();
    const real = realList.find((x) => x.email === 'zkcrm@zhengl.vip');
    if (real) {
      const mailInbox = require('../src/mail-inbox');
      const r = await mailInbox.listMessages(real.id, { limit: 5 });
      check('读取邮件列表成功', typeof r.total === 'number', 'total=' + r.total);
      check('邮件为数组', Array.isArray(r.messages), 'len=' + (r.messages || []).length);
      if (r.messages && r.messages.length) {
        const m = r.messages[0];
        check('邮件含 uid', typeof m.uid === 'number');
        check('邮件含 subject', typeof m.subject === 'string');
        check('邮件含 hasExcel 标记', typeof m.hasExcel === 'boolean', 'hasExcel=' + m.hasExcel);

        const detail = await mailInbox.getMessage(real.id, m.uid);
        check('读取正文成功', typeof detail.subject === 'string');
        check('正文含附件数组', Array.isArray(detail.attachments), 'len=' + detail.attachments.length);
        check('附件标记 Excel', detail.attachments.some((a) => a.isExcel) || detail.attachments.length === 0);
      } else {
        console.log('  （收件箱无邮件，跳过正文测试）');
      }

      // 只看带附件
      const onlyAtt = await mailInbox.listMessages(real.id, { limit: 5, onlyAttachments: true });
      check('只看附件筛选可用', Array.isArray(onlyAtt.messages));
      check('筛选结果均有附件', (onlyAtt.messages || []).every((m) => m.hasAttachment));
    } else {
      console.log('  （未找到 zkcrm@zhengl.vip，跳过）');
    }

    /* ---------- 10. 不存在的账户 ---------- */
    console.log('');
    console.log('── 10. 异常处理 ──');
    eq('查询不存在账户返回 null', await accounts.get(999999), null);
    let threw = false;
    try { await accounts.update(999999, { name: 'x' }); } catch (e) { threw = true; }
    check('更新不存在账户报错', threw);
    threw = false;
    try { await accounts.remove(999999); } catch (e) { threw = true; }
    check('删除不存在账户报错', threw);

    const mailInbox2 = require('../src/mail-inbox');
    threw = false;
    try { await mailInbox2.listMessages(999999, {}); } catch (e) { threw = true; }
    check('读取不存在账户邮件报错', threw);

    /* ---------- 汇总 ---------- */
    console.log('');
    console.log('======== 结果 ========');
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) {
      console.log('');
      failures.forEach((f) => console.log('  - ' + f));
    }

    /* ---------- 清理 ---------- */
    console.log('');
    console.log('── 清理测试账户 ──');
    for (const id of createdIds) {
      try {
        const row = await accounts.getRaw(id);
        if (row) { await accounts.remove(id); console.log('  已删除: ' + row.email); }
      } catch (e) { console.log('  清理失败 ' + id + ': ' + e.message); }
    }
    const after = (await accounts.list()).length;
    eq('账户数恢复', after, before);

    await db.close();
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('');
    console.error('测试执行异常:', e.stack || e.message);
    try { await db.close(); } catch (_) { /* ignore */ }
    process.exit(1);
  }
})();
