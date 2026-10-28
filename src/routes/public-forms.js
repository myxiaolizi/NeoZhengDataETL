'use strict';

const express = require('express');
const forms = require('../forms');

const router = express.Router();

/**
 * 公开表单接口（无需登录）
 *
 * 仅允许通过表单的 public_token 访问，且表单必须开启「公开填写」。
 */

/** 简单的内存限流：同一 IP 每分钟最多提交 20 次 */
const RATE = new Map();
const RATE_WINDOW = 60000;
const RATE_MAX = 20;

function rateLimited(ip) {
  const now = Date.now();
  const rec = RATE.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW) {
    RATE.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_MAX;
}

// 定期清理限流记录
setInterval(() => {
  const now = Date.now();
  RATE.forEach((v, k) => { if (now - v.start > RATE_WINDOW * 2) RATE.delete(k); });
}, RATE_WINDOW).unref();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && (req.socket.remoteAddress || req.connection.remoteAddress)) || '';
}

/** 获取表单结构（供前端渲染） */
router.get('/:token/schema', async (req, res, next) => {
  try {
    const form = await forms.getByToken(req.params.token);
    if (!form) return res.status(404).json({ ok: false, message: '表单不存在' });
    if (!form.status) return res.status(403).json({ ok: false, message: '表单已停用' });
    if (!form.allowPublic) return res.status(403).json({ ok: false, message: '该表单未开放公开填写' });

    res.json({
      ok: true,
      data: {
        id: form.id,
        name: form.name,
        description: form.description,
        fields: form.fields,
        settings: form.settings,
      },
    });
  } catch (err) { next(err); }
});

/** 提交表单数据 */
router.post('/:token/submit', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, message: '提交过于频繁，请稍后再试' });
    }

    const result = await forms.submit(req.params.token, req.body || {}, {
      byToken: true,
      submitter: '匿名用户',
      ip,
      userAgent: req.headers['user-agent'] || '',
    });

    res.json({ ok: true, data: result, message: result.message });
  } catch (err) {
    if (err.validation) {
      return res.status(400).json({ ok: false, message: err.message, errors: err.validation });
    }
    res.status(400).json({ ok: false, message: err.message });
  }
});

module.exports = router;