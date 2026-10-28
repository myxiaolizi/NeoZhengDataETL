'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('./db');
const settings = require('./settings');
const mailPush = require('./mail-push');
const accounts = require('./mail-accounts');

/**
 * 邮箱收信（IMAP）—— 多账户版
 *
 * 设计要点：
 *  - 每个账户独立连接、独立进度（last_uid）、独立错误，互不影响
 *  - 只读拉取（BODY.PEEK），不改变邮件已读状态
 *  - 按「UID + 附件名」幂等，重复轮询不会重复导入
 *  - 支持浏览邮件列表与正文（不落库，实时读取）
 */

/** 运行态（按账户记录最近一次结果） */
const state = {
  timer: null,
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  perAccount: {},
};

function isOn(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/** 由账户记录创建 IMAP 客户端 */
function makeClient(acc) {
  return new ImapFlow({
    host: acc.imap_host,
    port: Number(acc.imap_port) || 993,
    secure: Number(acc.imap_secure) === 1,
    auth: { user: acc.email, pass: acc.password },
    logger: false,
    maxIdleTime: 1000 * 60,
  });
}

/** 把底层协议错误翻译成可操作的中文提示 */
function humanizeError(e, acc) {
  const raw = String((e && e.message) || e || '未知错误');
  if (/Command failed|AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|账号或密码不正确/i.test(raw)) {
    return '账号或密码不正确（部分邮箱需使用客户端专用密码/授权码，而非网页登录密码）';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(raw)) {
    return `无法连接 ${acc ? acc.imap_host : 'IMAP 服务器'}${acc ? ':' + acc.imap_port : ''}：${raw}`;
  }
  if (/Mailbox doesn't exist|NONEXISTENT/i.test(raw)) {
    return `收件文件夹「${acc ? acc.mailbox : ''}」不存在`;
  }
  return raw;
}

/**
 * 测试连接
 * @param {object} input  {id} 或 {email,password,imap_host,...}
 */
async function testConnection(input) {
  const src = input || {};
  let acc;

  if (src.id) {
    acc = await accounts.getRaw(src.id);
    if (!acc) return { ok: false, message: '邮箱账户不存在' };
    // 允许用表单里新填的值覆盖（未填密码则沿用已保存的）
    if (src.email) acc.email = String(src.email).trim();
    if (src.password) acc.password = String(src.password);
    if (src.imap_host) acc.imap_host = String(src.imap_host).trim();
    if (src.imap_port) acc.imap_port = parseInt(src.imap_port, 10) || acc.imap_port;
    if (src.imap_secure !== undefined) acc.imap_secure = Number(src.imap_secure) ? 1 : 0;
    if (src.mailbox) acc.mailbox = String(src.mailbox).trim();
  } else {
    acc = {
      email: String(src.email || '').trim(),
      password: String(src.password || ''),
      imap_host: String(src.imap_host || accounts.DEFAULTS.imap_host).trim(),
      imap_port: parseInt(src.imap_port, 10) || accounts.DEFAULTS.imap_port,
      imap_secure: src.imap_secure === undefined ? 1 : (Number(src.imap_secure) ? 1 : 0),
      mailbox: String(src.mailbox || accounts.DEFAULTS.mailbox).trim(),
    };
  }

  if (!acc.email || !acc.password) {
    return { ok: false, message: '请先填写邮箱账号与密码' };
  }

  const client = makeClient(acc);
  try {
    await client.connect();
    if (!client.authenticated || !client.usable) throw new Error('账号或密码不正确');
    const lock = await client.getMailboxLock(acc.mailbox || 'INBOX');
    let total = 0;
    try {
      const st = await client.status(acc.mailbox || 'INBOX', { messages: true });
      total = Number(st.messages || 0);
    } finally {
      lock.release();
    }
    await client.logout();
    return { ok: true, message: `连接成功，${acc.mailbox || 'INBOX'} 共 ${total} 封邮件`, total };
  } catch (e) {
    try { await client.logout(); } catch (_) { /* ignore */ }
    return { ok: false, message: `连接失败：${humanizeError(e, acc)}` };
  }
}

/** 从解析后的邮件中提取 Excel 附件 */
async function extractExcelAttachments(source) {
  const parsed = await simpleParser(source);
  const out = [];
  for (const att of parsed.attachments || []) {
    const name = String(att.filename || '').trim();
    if (!name) continue;
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    if (!mailPush.EXCEL_EXT.has(ext)) continue;
    out.push({ filename: name, buffer: att.content });
  }
  return { attachments: out, subject: parsed.subject || '', from: parsed.from && parsed.from.text };
}

/* ------------------------------------------------------------------ *
 * 邮件浏览（实时读取，不落库）
 * ------------------------------------------------------------------ */

/**
 * 列出某账户的邮件
 * @param {number} accountId
 * @param {object} [opts] {mailbox, limit, offset, onlyAttachments}
 */
async function listMessages(accountId, opts) {
  const o = opts || {};
  const acc = await accounts.getRaw(accountId);
  if (!acc) throw new Error('邮箱账户不存在');

  const mailbox = o.mailbox || acc.mailbox || 'INBOX';
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 30, 1), 100);
  const offset = Math.max(parseInt(o.offset, 10) || 0, 0);

  const client = makeClient(acc);
  let lock = null;
  try {
    await client.connect();
    if (!client.authenticated || !client.usable) throw new Error('账号或密码不正确');
    lock = await client.getMailboxLock(mailbox);

    const st = await client.status(mailbox, { messages: true });
    const total = Number(st.messages || 0);
    if (total === 0) return { total: 0, messages: [], mailbox };

    // 按时间倒序取最近 limit 封（从尾部往前）
    const end = Math.max(1, total - offset);
    const start = Math.max(1, end - limit + 1);

    const messages = [];
    for await (const msg of client.fetch(`${start}:${end}`, {
      uid: true,
      envelope: true,
      flags: true,
      bodyStructure: true,
      size: true,
    })) {
      const hasAtt = hasAttachment(msg.bodyStructure);
      const excelAtt = hasExcelAttachment(msg.bodyStructure);
      if (o.onlyAttachments && !hasAtt) continue;
      messages.push({
        uid: msg.uid,
        seq: msg.seq,
        subject: (msg.envelope && msg.envelope.subject) || '(无主题)',
        from: formatAddress(msg.envelope && msg.envelope.from),
        to: formatAddress(msg.envelope && msg.envelope.to),
        date: msg.envelope && msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
        seen: !!(msg.flags && msg.flags.has && msg.flags.has('\\Seen')),
        flagged: !!(msg.flags && msg.flags.has && msg.flags.has('\\Flagged')),
        hasAttachment: hasAtt,
        hasExcel: excelAtt,
        size: Number(msg.size || 0),
        messageId: (msg.envelope && msg.envelope.messageId) || null,
      });
    }

    messages.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { total, mailbox, messages };
  } finally {
    try { if (lock) lock.release(); } catch (_) { /* ignore */ }
    try { await client.logout(); } catch (_) { /* ignore */ }
  }
}

/** 读取单封邮件正文 */
async function getMessage(accountId, uid, opts) {
  const o = opts || {};
  const acc = await accounts.getRaw(accountId);
  if (!acc) throw new Error('邮箱账户不存在');
  const mailbox = o.mailbox || acc.mailbox || 'INBOX';

  const client = makeClient(acc);
  let lock = null;
  try {
    await client.connect();
    if (!client.authenticated || !client.usable) throw new Error('账号或密码不正确');
    lock = await client.getMailboxLock(mailbox);

    const msg = await client.fetchOne(String(uid), {
      uid: true, source: true, envelope: true,
    }, { uid: true });
    if (!msg || !msg.source) throw new Error('邮件不存在或已被删除');

    const parsed = await simpleParser(msg.source);
    const attachments = (parsed.attachments || []).map((a) => ({
      filename: a.filename || '',
      size: a.size || (a.content ? a.content.length : 0),
      contentType: a.contentType || '',
      isExcel: mailPush.EXCEL_EXT.has(
        (() => {
          const n = String(a.filename || '');
          const d = n.lastIndexOf('.');
          return d > 0 ? n.slice(d).toLowerCase() : '';
        })()
      ),
    }));

    return {
      uid: Number(uid),
      subject: parsed.subject || '(无主题)',
      from: parsed.from ? parsed.from.text : '',
      to: parsed.to ? parsed.to.text : '',
      cc: parsed.cc ? parsed.cc.text : '',
      date: parsed.date ? parsed.date.toISOString() : null,
      text: parsed.text || '',
      html: parsed.html || '',
      attachments,
    };
  } finally {
    try { if (lock) lock.release(); } catch (_) { /* ignore */ }
    try { await client.logout(); } catch (_) { /* ignore */ }
  }
}

function hasAttachment(node) {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  if (Array.isArray(node.childNodes)) return node.childNodes.some(hasAttachment);
  return false;
}

function hasExcelAttachment(node) {
  if (!node) return false;
  const fn = node.dispositionParameters && node.dispositionParameters.filename;
  if (fn) {
    const name = String(fn);
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    if (mailPush.EXCEL_EXT.has(ext)) return true;
  }
  if (Array.isArray(node.childNodes)) return node.childNodes.some(hasExcelAttachment);
  return false;
}

function formatAddress(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}

/* ------------------------------------------------------------------ *
 * 拉取入库
 * ------------------------------------------------------------------ */

/** 处理单个账户的一次拉取 */
async function runAccount(acc, opts) {
  const o = opts || {};
  const summary = {
    accountId: acc.id,
    account: acc.email,
    ok: true,
    mails: 0,
    attachments: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  const client = makeClient(acc);
  let lock = null;
  try {
    await client.connect();
    if (!client.authenticated || !client.usable) {
      throw new Error('账号或密码不正确');
    }

    const mailbox = acc.mailbox || 'INBOX';
    lock = await client.getMailboxLock(mailbox);

    const st = await client.status(mailbox, { messages: true, uidNext: true });
    const uidNext = Number(st.uidNext || 1);
    const lastUid = Number(acc.last_uid || 0);

    let uids = [];
    if (o.force || lastUid <= 0) {
      const days = Math.max(1, Number(acc.initial_days) || 7);
      const since = new Date(Date.now() - days * 24 * 3600 * 1000);
      uids = (await client.search({ since }, { uid: true })) || [];
      summary.since = since.toISOString();
    } else if (lastUid + 1 < uidNext) {
      for (let u = lastUid + 1; u < uidNext; u += 1) uids.push(u);
    }

    const maxPer = Math.min(Math.max(Number(o.limit || acc.max_per_run) || 50, 1), 500);
    if (uids.length > maxPer) uids = uids.slice(-maxPer);
    summary.mails = uids.length;

    for (const uid of uids) {
      let msg;
      try {
        msg = await client.fetchOne(String(uid), { uid: true, source: true, envelope: true }, { uid: true });
      } catch (e) {
        summary.failed += 1;
        summary.details.push({ uid, result: 'failed', message: `读取邮件失败：${e.message}` });
        continue;
      }
      if (!msg || !msg.source) continue;

      let extracted;
      try {
        extracted = await extractExcelAttachments(msg.source);
      } catch (e) {
        summary.failed += 1;
        summary.details.push({ uid, result: 'failed', message: `解析邮件失败：${e.message}` });
        continue;
      }

      // 仅当账户开启自动导入时才处理附件
      if (!Number(acc.auto_import)) {
        if (extracted.attachments.length) {
          summary.details.push({ uid, result: 'skipped', message: '该账户未开启自动导入' });
        }
        continue;
      }

      for (const att of extracted.attachments) {
        summary.attachments += 1;
        const dup = await mailPush.alreadyImported(`${acc.id}:${uid}`, att.filename);
        if (dup) {
          summary.skipped += 1;
          summary.details.push({ uid, filename: att.filename, result: 'skipped', message: '已导入过' });
          continue;
        }

        let r;
        try {
          r = await mailPush.processAttachment({
            filename: att.filename,
            buffer: att.buffer,
            meta: {
              uid: `${acc.id}:${uid}`,
              subject: extracted.subject,
              from: extracted.from,
              messageId: msg.envelope && msg.envelope.messageId,
            },
          });
        } catch (e) {
          r = { ok: false, result: 'failed', message: e.message, filename: att.filename };
        }

        if (r.ok) summary.imported += 1;
        else if (r.result === 'skipped') summary.skipped += 1;
        else summary.failed += 1;

        summary.details.push({
          uid,
          filename: att.filename,
          result: r.result,
          projectName: r.projectName,
          rowsTotal: r.rowsTotal,
          columnsTotal: r.columnsTotal,
          message: r.message,
        });

        try {
          await mailPush.writeLog({
            projectId: r.projectId,
            projectName: r.projectName,
            uid: `${acc.id}:${uid}`,
            messageId: msg.envelope && msg.envelope.messageId,
            subject: extracted.subject,
            from: extracted.from,
            filename: att.filename,
            wjmc: r.wjmc,
            rowsTotal: r.rowsTotal,
            inserted: r.inserted,
            updated: r.updated,
            columnsTotal: r.columnsTotal,
            result: r.result,
            message: r.message,
          });
        } catch (e) {
          summary.details.push({ uid, filename: att.filename, result: 'log_failed', message: e.message });
        }
      }
    }

    const newLast = uids.length ? Math.max(...uids.map(Number)) : lastUid;
    if (newLast > lastUid) await accounts.setProgress(acc.id, newLast);
    else await accounts.setProgress(acc.id, lastUid);

    return summary;
  } catch (e) {
    const msg = humanizeError(e, acc);
    await accounts.setError(acc.id, msg).catch(() => {});
    return { ...summary, ok: false, message: msg };
  } finally {
    try { if (lock) lock.release(); } catch (_) { /* ignore */ }
    try { await client.logout(); } catch (_) { /* ignore */ }
  }
}

/**
 * 执行一次拉取（所有启用账户）
 * @param {object} [options] {force, limit, accountId}
 */
async function runOnce(options) {
  const opts = options || {};
  if (state.running) return { ok: false, message: '上一次拉取仍在进行中' };

  state.running = true;
  state.lastRunAt = new Date();
  const summary = {
    ok: true, accounts: 0, mails: 0, attachments: 0, imported: 0, skipped: 0, failed: 0, details: [],
  };

  try {
    await mailPush.ensureMetaTables();
    await accounts.ensureTable();

    let list;
    if (opts.accountId) {
      const one = await accounts.getRaw(opts.accountId);
      if (!one) return { ...summary, ok: false, message: '邮箱账户不存在' };
      list = [one];
    } else {
      list = await accounts.listEnabled();
    }

    if (!list.length) {
      state.lastError = null;
      state.lastResult = summary;
      return { ...summary, ok: false, message: '没有启用的邮箱账户，请先在「邮箱账户」中添加并启用' };
    }

    summary.accounts = list.length;

    for (const acc of list) {
      const r = await runAccount(acc, opts);
      state.perAccount[acc.id] = r;
      summary.mails += r.mails || 0;
      summary.attachments += r.attachments || 0;
      summary.imported += r.imported || 0;
      summary.skipped += r.skipped || 0;
      summary.failed += r.failed || 0;
      if (!r.ok) {
        summary.ok = false;
        summary.details.push({
          accountId: acc.id, account: acc.email, result: 'account_failed', message: r.message,
        });
      }
      (r.details || []).forEach((d) => summary.details.push(Object.assign({ account: acc.email }, d)));
    }

    state.lastResult = summary;
    state.lastError = summary.ok ? null : '部分账户处理失败，详见明细';
    return summary;
  } catch (e) {
    state.lastError = e.message;
    return { ...summary, ok: false, message: e.message };
  } finally {
    state.running = false;
  }
}

/* ------------------------------------------------------------------ *
 * 定时轮询
 * ------------------------------------------------------------------ */

async function start() {
  stop();
  const enabled = isOn(await settings.get('mail_push_enabled', '0'));
  if (!enabled) return { started: false, reason: '未启用' };

  await accounts.ensureTable();
  const list = await accounts.listEnabled();
  if (!list.length) return { started: false, reason: '无启用的邮箱账户' };

  const minutes = Math.max(1, Number(await settings.get('mail_push_interval', '5')) || 5);
  state.timer = setInterval(() => {
    runOnce().catch((e) => { state.lastError = e.message; });
  }, minutes * 60 * 1000);
  if (state.timer.unref) state.timer.unref();

  setTimeout(() => {
    runOnce().catch((e) => { state.lastError = e.message; });
  }, 10 * 1000).unref();

  return { started: true, intervalMinutes: minutes, accounts: list.length };
}

function stop() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

async function restart() {
  stop();
  return start();
}

function status() {
  return {
    running: state.running,
    scheduled: !!state.timer,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    lastError: state.lastError,
    perAccount: state.perAccount,
  };
}

module.exports = {
  testConnection,
  listMessages,
  getMessage,
  runOnce,
  start,
  stop,
  restart,
  status,
};
