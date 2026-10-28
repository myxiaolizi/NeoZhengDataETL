'use strict';

const nodemailer = require('nodemailer');
const settings = require('./settings');

/**
 * 邮件服务：基于系统设置中的 SMTP 配置动态创建传输器
 */

function buildTransportOptions(map) {
  const port = parseInt(map.smtp_port || '465', 10);
  const secure = ['1', 'true', 'yes', 'on'].includes(String(map.smtp_secure).toLowerCase());
  return {
    host: map.smtp_host,
    port,
    secure,
    auth: {
      user: map.smtp_user,
      pass: map.smtp_pass,
    },
    // 587 等端口自动升级 STARTTLS
    requireTLS: !secure && port === 587,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: { rejectUnauthorized: false },
  };
}

async function getTransport() {
  const map = await settings.all();
  if (!map.smtp_host) throw new Error('未配置 SMTP 服务器地址');
  if (!map.smtp_user) throw new Error('未配置邮箱账号');
  return nodemailer.createTransport(buildTransportOptions(map));
}

async function fromAddress() {
  const map = await settings.all();
  const name = map.smtp_from_name || map.site_name || '推送接收平台';
  const email = map.smtp_from_email || map.smtp_user;
  return `"${name}" <${email}>`;
}

/**
 * 发送邮件
 * @param {{to:string, subject:string, html?:string, text?:string}} opts
 */
async function send(opts) {
  const transport = await getTransport();
  const info = await transport.sendMail({
    from: await fromAddress(),
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
  return info;
}

/** 连通性测试（设置页「测试发信」用） */
async function verify() {
  const transport = await getTransport();
  await transport.verify();
  return true;
}

/** 发送测试邮件 */
async function sendTest(to) {
  const map = await settings.all();
  return send({
    to,
    subject: `【${map.site_name}】邮件服务测试`,
    html: mailLayout(map, '邮件服务测试', `
      <p>您好，</p>
      <p>这是一封来自 <b>${escapeHtml(map.site_name)}</b> 的测试邮件。</p>
      <p>如果您收到了这封邮件，说明系统的邮件服务配置正确，可以正常用于找回密码与通知。</p>
      <p class="muted">发送时间：${new Date().toLocaleString('zh-CN')}</p>
    `),
  });
}

/** 找回密码邮件 */
async function sendResetPassword(to, displayName, link, ttlMinutes) {
  const map = await settings.all();
  return send({
    to,
    subject: `【${map.site_name}】重置登录密码`,
    html: mailLayout(map, '重置登录密码', `
      <p>您好${displayName ? '，' + escapeHtml(displayName) : ''}：</p>
      <p>我们收到了您重置登录密码的请求。请点击下方按钮设置新密码：</p>
      <p style="text-align:center;margin:26px 0;">
        <a class="btn" href="${link}">重置密码</a>
      </p>
      <p class="muted">该链接 ${ttlMinutes} 分钟内有效，且只能使用一次。</p>
      <p class="muted">如果按钮无法点击，请复制以下地址到浏览器打开：</p>
      <p class="link">${link}</p>
      <p class="muted">如果这不是您本人的操作，请忽略本邮件，您的密码不会发生变化。</p>
    `),
  });
}

/** 注册验证 / 邮箱验证邮件 */
async function sendVerifyEmail(to, displayName, link) {
  const map = await settings.all();
  return send({
    to,
    subject: `【${map.site_name}】验证邮箱地址`,
    html: mailLayout(map, '验证邮箱地址', `
      <p>您好${displayName ? '，' + escapeHtml(displayName) : ''}：</p>
      <p>感谢注册 <b>${escapeHtml(map.site_name)}</b>。请点击下方按钮完成邮箱验证：</p>
      <p style="text-align:center;margin:26px 0;">
        <a class="btn" href="${link}">验证邮箱</a>
      </p>
      <p class="muted">如果按钮无法点击，请复制以下地址到浏览器打开：</p>
      <p class="link">${link}</p>
    `),
  });
}

/** 新账号通知（管理员创建用户时可选发送） */
async function sendAccountCreated(to, username, password, loginUrl) {
  const map = await settings.all();
  return send({
    to,
    subject: `【${map.site_name}】您的账号已创建`,
    html: mailLayout(map, '账号已创建', `
      <p>您好，管理员已为您开通 <b>${escapeHtml(map.site_name)}</b> 的账号：</p>
      <table class="kv">
        <tr><td>登录账号</td><td><b>${escapeHtml(username)}</b></td></tr>
        <tr><td>初始密码</td><td><b>${escapeHtml(password)}</b></td></tr>
        <tr><td>登录地址</td><td><a href="${loginUrl}">${loginUrl}</a></td></tr>
      </table>
      <p class="muted">为了账号安全，请登录后立即修改初始密码。</p>
    `),
  });
}

/** 统一邮件外框 */
function mailLayout(map, title, content) {
  const color = map.theme_color || '#2D6FE4';
  const siteName = escapeHtml(map.site_name || '推送接收平台');
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:rgba(220,221,221,.30);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:22px;">
      <div style="display:inline-block;width:46px;height:46px;line-height:46px;border-radius:13px;
                  background:${color};color:#FFFFFF;font-size:23px;font-weight:700;text-align:center;">
        ${escapeHtml(map.site_logo_text || '简')}
      </div>
      <div style="margin-top:10px;font-size:15px;font-weight:600;color:#003378;">${siteName}</div>
    </div>
    <div style="background:#FFFFFF;border-radius:14px;padding:32px 30px;border:1px solid #DCDDDD;">
      <h1 style="margin:0 0 18px;font-size:19px;color:#003378;font-weight:600;">${title}</h1>
      <div style="font-size:14px;line-height:1.8;color:#003378;">${content}</div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:12px;color:#B5B5B6;line-height:1.7;">
      ${map.site_footer ? escapeHtml(map.site_footer) + '<br>' : ''}
      本邮件由系统自动发送，请勿直接回复<br>© ${year} ${siteName}
    </div>
  </div>
  <style>
    .btn{display:inline-block;padding:12px 32px;background:${color};color:#FFFFFF !important;
         text-decoration:none;border-radius:9px;font-weight:600;font-size:14px;}
    .muted{color:rgba(0,51,120,.70);font-size:13px;}
    .link{word-break:break-all;color:${color};font-size:12px;background:rgba(220,221,221,.22);padding:10px 12px;border-radius:7px;}
    .kv{width:100%;border-collapse:collapse;margin:14px 0;}
    .kv td{padding:9px 12px;border-bottom:1px solid #DCDDDD;font-size:14px;}
    .kv td:first-child{color:rgba(0,51,120,.70);width:100px;}
  </style>
</body></html>`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { send, verify, sendTest, sendResetPassword, sendVerifyEmail, sendAccountCreated, mailLayout };
