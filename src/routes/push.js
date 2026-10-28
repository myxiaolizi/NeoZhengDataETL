'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const jdy = require('../jdy');
const flow = require('../flow');
const flowIngest = require('../flow-ingest');
const schema = require('../schema');
const projects = require('../projects');
const fields = require('../fields');
const settings = require('../settings');
const logDescribe = require('../log-describe');

const router = express.Router();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && (req.socket.remoteAddress || req.connection.remoteAddress)) || '';
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return JSON.stringify({ error: 'payload not serializable' });
  }
}

/** 系统字段从推送数据中取值的键名映射 */
const SYSTEM_VALUE_KEYS = ['formName', '_id', 'appId', 'entryId', 'creator', 'updater', 'deleter',
  'createTime', 'updateTime', 'deleteTime', 'flowState', 'sequenceNumber'];

/**
 * 简道云数据推送接收入口
 * POST /jdy/push/:token?nonce=xxx&timestamp=yyy
 */
router.post('/push/:token', async (req, res) => {
  const started = Date.now();
  const token = req.params.token;
  const ip = clientIp(req);
  const nonce = req.query.nonce || '';
  const timestamp = req.query.timestamp || '';
  const signature = req.headers['x-jdy-signature'] || '';
  const deliverId = req.headers['x-jdy-deliverid'] || '';

  let rawBody = '';
  if (Buffer.isBuffer(req.body)) rawBody = req.body.toString('utf8');
  else if (typeof req.body === 'string') rawBody = req.body;
  else if (req.body && typeof req.body === 'object') rawBody = safeJsonStringify(req.body);

  let body = null;
  if (rawBody) {
    try { body = JSON.parse(rawBody); } catch (_) { body = null; }
  }

  const op = body && body.op ? String(body.op) : '';

  // 流程推送（schema 2.0）报文没有 op / data，只有 header.event_type 与 event。
  // 旧逻辑只认 body.op，于是把它当成「未知事件」——只写日志、不落数据，
  // 表现就是「简道云显示推送成功，但这边没有数据」。
  const flowPush = flow.parse(body);

  /* ---- 1. 定位项目 ---- */
  let project = null;
  try {
    project = await projects.getProjectByToken(token);
  } catch (err) {
    console.error('[push] 查询项目失败:', err.message);
    return res.status(200).json({ code: 0, msg: 'received' });
  }

  if (!project) {
    console.warn(`[push] 未知推送令牌 token=${token} ip=${ip}`);
    return res.status(404).json({ code: 404, msg: 'unknown push token' });
  }

  /* ---- 2. 服务器连接测试 ---- */
  if (op === 'test' || op === 'ping' || op === 'connect_test') {
    return res.status(200).json({ code: 0, msg: 'success' });
  }

  /* ---- 3. 签名校验 ---- */
  const globalRequireSig = await settings.getBool('require_signature');
  const sig = jdy.verifySignature({
    nonce,
    timestamp,
    payload: rawBody,
    secret: project.jdy_secret,
    received: signature,
  });

  const opLabel = flowPush ? flowPush.opLabel : jdy.opLabel(op);
  const opTime = (flowPush && flowPush.opTime) || jdy.extractOpTime(body) || Date.now();
  const formName = flowPush ? flowPush.formName : jdy.extractFormName(op, body && body.data);
  const entryId = flowPush ? flowPush.formId : jdy.extractEntryId(op, body && body.data);
  const dataId = flowPush ? flowPush.dataId : jdy.extractDataId(op, body && body.data);
  const opForLog = flowPush ? flowPush.eventType : op;

  const logBase = {
    op: opForLog, opLabel, deliverId, dataId, formName, entryId, opTime,
    signatureOk: sig.ok,
    signatureMsg: sig.reason,
    sourceIp: ip,
    payload: rawBody ? rawBody.slice(0, 2000000) : null,
  };

  if ((config.requireSignature || globalRequireSig) && !sig.ok) {
    try {
      await schema.writeLog(project.id, {
        ...logBase, result: 'signature_failed', message: sig.reason, fieldCount: 0,
        changeSummary: `签名校验未通过（${sig.reason}），本次推送已拒绝，数据未写入。请核对项目的 Secret 与推送端配置是否一致。`,
      });
    } catch (err) { console.error('[push] 写日志失败:', err.message); }
    return res.status(401).json({ code: 401, msg: 'signature verification failed' });
  }

  if (!body || typeof body !== 'object') {
    try {
      await schema.writeLog(project.id, {
        ...logBase, result: 'error', message: '请求体不是合法 JSON', fieldCount: 0,
        changeSummary: '收到的请求体不是合法 JSON，无法解析，数据未写入。请检查推送端的内容类型与报文格式。',
      });
    } catch (err) { console.error('[push] 写日志失败:', err.message); }
    // 报文格式错误：pushFailVisible 时返回 400 让简道云侧显示失败
    if (config.pushFailVisible) return res.status(400).json({ code: 400, msg: 'invalid json body' });
    return res.status(200).json({ code: 0, msg: 'received' });
  }

  // 已配置 Secret 但签名不符 → 判定为非法来源，只记日志不写入
  if (!sig.ok && project.jdy_secret) {
    try {
      await schema.writeLog(project.id, {
        ...logBase,
        result: 'signature_failed',
        message: `签名校验未通过（${sig.reason}），已拒绝写入数据`,
        fieldCount: 0,
        changeSummary: `签名校验未通过（${sig.reason}），本次推送已拒绝，数据未写入。请核对项目的 Secret 与推送端配置是否一致。`,
      });
    } catch (err) { console.error('[push] 写日志失败:', err.message); }
    console.warn(`[push] 项目 ${project.code} 签名校验失败，已拒绝写入: ${sig.reason}`);
    /*
     * 关键：数据被拒绝时，必须让简道云侧能看见失败（客户 2026-10-28 反馈的核心痛点）
     * ----------------------------------------------------------------------------
     * 历史实现此处返回 HTTP 200 + {code:0,msg:'signature rejected'}，
     * 简道云只依据状态码判定 → 后台一直显示「成功」，业务方完全无从发现。
     *
     * 采用 403（客户端错误）而非 5xx：签名错误是配置问题，重试没有意义。
     * 若简道云侧因任何重试行为导致推送被自动关闭，
     * 可在 .env 设 PUSH_FAIL_VISIBLE=0 恢复「一律 200」的旧行为。
     */
    if (config.pushFailVisible) return res.status(403).json({ code: 403, msg: 'signature rejected' });
    return res.status(200).json({ code: 0, msg: 'signature rejected' });
  }

  /* ---- 4. 处理推送 ---- */
  try {
    await schema.ensureProjectTables(project.id);
    const normalized = schema_normalize(body);
    const rawData = normalized.values;
    const fieldKeys = Object.keys(rawData);
    const autoParse = Number(project.parse_enabled) === 1;

    let result = 'success';
    let message = '';
    let fieldCount = fieldKeys.length;
    let changeSummary = null;

    if (flowPush) {
      // 流程待办变更：一条推送一行记录，五个待办列表展开为子表
      const r = await flowIngest.handle(project, flowPush, rawBody);
      result = 'success';
      message = r.message;
      fieldCount = r.fieldCount;
      // 用自然语言描述这次流程变更
      changeSummary = logDescribe.joinDescriptions(logDescribe.describeFlowChange(flowPush));
      if (r.runState && r.runState.synced) {
        changeSummary += `已同步流程运行态到 ${r.runState.table}：当前节点「${r.runState.node || '-'}」`;
        changeSummary += `、当前负责人「${r.runState.owner || '-'}」。`;
      }
    } else if (op === 'data_create' || op === 'data_update' || op === 'data_recover') {
      // 4.1 读取字段定义；缺失的自动登记
      let defMap = await fields.getFieldDefMap(project.id);
      const existingCols = await schema.columnNames(schema.makeTableName(project.id));
      const missing = fieldKeys.filter((k) => !defMap[k]);
      if (missing.length) {
        await fields.autoRegisterFields(project.id, missing, defMap, existingCols);
        defMap = await fields.getFieldDefMap(project.id);
      }

      // 4.2 同步表结构（建列 + 建解析列）
      //
      // 注意：派生字段（source_key 非空，如地址拆省/市/区、标题拼接）的 field_key
      // 形如 `_widget_xxx#province`，**不出现在推送报文里**，因此不在 fieldKeys 中。
      // 若只同步 fieldKeys 对应的定义，派生字段的 <column>_p 解析列不会被建/纳入集合，
      // 后续 4.3b 的 `inParsed` 判断恒为 false → 派生字段的解析值永远写不进去。
      // 这里把派生定义一并纳入同步，保证原始列与解析列都存在。
      const derivedDefs = await fields.listDerivedDefs(project.id);
      const defs = fieldKeys.map((k) => defMap[k]).filter(Boolean);
      const seenCol = new Set(defs.map((d) => d && d.column_name).filter(Boolean));
      for (const d of derivedDefs) {
        if (!d || seenCol.has(d.column_name)) continue;
        defs.push(d);
        seenCol.add(d.column_name);
      }
      const sync = await schema.syncFieldColumns(project.id, defs, rawData);

      // 以**实际表列**为准（而不是同步器返回的集合），避免派生字段因不在同步集合里被跳过。
      //   liveCols       —— 原始表（jdywh_data_N）的列
      //   parsedLiveCols —— 解析表（jdywh_parsed_N）的列（含 <column>_p 解析列）
      const liveCols = new Set(await schema.columnNames(schema.makeTableName(project.id)));
      const parsedLiveCols = new Set(await schema.columnNames(schema.makeParsedTableName(project.id)));
      for (const c of (sync.columns || [])) liveCols.add(c);
      for (const c of (sync.parsedColumns || [])) parsedLiveCols.add(c);

      // 4.3 组装原始值与解析值
      const columns = {};
      const parsed = {};
      const expandJobs = [];

      for (const key of fieldKeys) {
        const def = defMap[key];
        if (!def || Number(def.enabled) === 0) continue;
        const raw = rawData[key];

        if (def.parse_mode === fields.EXPAND_MODE) {
          if (Array.isArray(raw) && raw.length) {
            expandJobs.push({ def, rows: raw });
          }
          continue;
        }

        if (!liveCols.has(def.column_name)) continue;
        columns[def.column_name] = raw;

        if (autoParse && def.parse_mode && def.parse_mode !== 'none') {
          const pcol = fields.parsedColumnOf(def.column_name);
          if (!parsedLiveCols.has(pcol)) continue;
          const v = fields.parseValue(raw, def.parse_mode, def.parse_path);
          if (v !== null && v !== undefined && v !== '') {
            parsed[pcol] = String(v).slice(0, 500);
          }
        }
      }

      // 4.3b 派生字段：由同一源字段按 parse_path 拆出（如地址拆省/市/区、标题拼接）
      //   注意：派生字段的 field_key（如 `_widget_xxx#province`）不在推送报文里，
      //   必须通过 source_key 回到父字段取值再套 parse_mode / parse_path。
      for (const def of derivedDefs) {
        if (Number(def.enabled) === 0) continue;
        if (def.parse_mode === fields.EXPAND_MODE) continue;
        const srcKey = fields.sourceKeyOf(def);
        if (!srcKey) continue;
        const raw = rawData[srcKey];
        if (raw === undefined) continue;

        const inRaw = liveCols.has(def.column_name);
        const pcol = fields.parsedColumnOf(def.column_name);
        const inParsed = parsedLiveCols.has(pcol);
        if (!inRaw && !inParsed) continue;

        const mode = def.parse_mode && def.parse_mode !== 'none' ? def.parse_mode : 'path';
        const v = fields.parseValue(raw, mode, def.parse_path);
        if (v === null || v === undefined || v === '') continue;

        if (inRaw) columns[def.column_name] = String(v).slice(0, 2000);
        if (autoParse && inParsed) parsed[pcol] = String(v).slice(0, 500);
      }

      // 4.4 系统字段（提交人/修改人等）也写入解析列
      if (autoParse) {
        for (const sk of SYSTEM_VALUE_KEYS) {
          const def = defMap[sk];
          if (!def || !def.parse_mode || def.parse_mode === 'none') continue;
          if (def.parse_mode === fields.EXPAND_MODE) continue;
          const raw = normalized.meta[sk];
          if (raw === undefined) continue;
          const pcol = fields.parsedColumnOf(def.column_name);
          if (!parsedLiveCols.has(pcol)) continue;
          const v = fields.parseValue(raw, def.parse_mode, def.parse_path);
          if (v !== null && v !== undefined && v !== '') {
            parsed[pcol] = String(v).slice(0, 500);
          }
        }
      }

      // 4.5 写入两张表（原始表 + 解析表）
      await schema.upsertRecord(project.id, {
        dataId: dataId || (normalized.meta && normalized.meta._id) || null,
        op,
        formName,
        opTime,
        rawJson: rawBody.slice(0, 4000000),
        columns,
        parsed,
      });

      // 4.6 数组字段展开为子表（需求 7）
      const subInfo = [];
      for (const job of expandJobs) {
        try {
          const r = await schema.writeSubTable(project.id, job.def, job.rows, dataId, opTime);
          subInfo.push(`${r.table}:${r.rows}行`);
        } catch (err) {
          console.error('[push] 子表写入失败:', err.message);
          subInfo.push(`${job.def.field_key}:失败(${err.message})`);
        }
      }

      const parts = [];
      if (sync.added.length) parts.push(`新增列: ${sync.added.join(', ')}`);
      if (sync.altered.length) parts.push(`扩展列: ${sync.altered.join(', ')}`);
      if (Object.keys(parsed).length) parts.push(`解析值: ${Object.keys(parsed).length} 个`);
      if (subInfo.length) parts.push(`子表: ${subInfo.join(', ')}`);
      message = parts.join('; ') || '写入成功';

      // 4.7 生成「本次改了什么」的自然语言描述（与上一次推送比对）
      try {
        const prev = await schema.previousPayloadOf(
          project.id,
          dataId || (normalized.meta && normalized.meta._id),
          opTime
        );
        const labelOf = (k) => (defMap[k] && defMap[k].field_name) || k;
        changeSummary = logDescribe.describeDataPush({
          body,
          prev,
          labelOf,
          fieldCount: fieldKeys.length,
        });
      } catch (e) {
        console.error('[push] 生成变更描述失败:', e.message);
      }

      await projects.touchProject(project.id);
    } else if (op === 'data_remove') {
      if (dataId) {
        const defs = await fields.listFieldDefs(project.id);
        await schema.deleteSubTableRows(project.id, defs, dataId);
        await schema.deleteRecord(project.id, dataId);
      }
      message = dataId ? `已删除数据 ${dataId}` : '缺少数据 ID';
      changeSummary = dataId ? `收到删除推送，已删除数据 ${dataId} 及其子表行。` : '收到删除推送，但报文缺少数据 ID，未执行删除。';
      await projects.touchProject(project.id);
    } else if (op === 'form_update') {
      fieldCount = Array.isArray(normalized.meta.widgets) ? normalized.meta.widgets.length : 0;
      message = '表单结构变更已记录';
      changeSummary = logDescribe.describeDataPush({ body, fieldCount });
      await projects.touchProject(project.id);
    } else {
      message = '未知事件已记录';
      changeSummary = logDescribe.describeDataPush({ body, fieldCount });
      await projects.touchProject(project.id);
    }

    await schema.writeLog(project.id, { ...logBase, result, message, fieldCount, changeSummary });

    console.log(
      `[push] project=${project.code} op=${opForLog} dataId=${dataId || '-'} ` +
      `fields=${fieldCount} sig=${sig.ok ? 'ok' : 'fail'} ${Date.now() - started}ms`
    );
    return res.status(200).json({ code: 0, msg: 'success' });
  } catch (err) {
    console.error('[push] 处理失败:', err);
    try {
      await schema.writeLog(project.id, {
        ...logBase,
        result: 'error',
        message: String(err && err.message ? err.message : err).slice(0, 2000),
        fieldCount: 0,
        changeSummary: `本次推送处理失败，数据未写入。原因：${String(err && err.message ? err.message : err).slice(0, 300)}`,
      });
    } catch (e2) { console.error('[push] 写错误日志失败:', e2.message); }
    /*
     * 处理异常：pushFailVisible 时返回 500，让简道云侧显示失败并触发重试。
     * 这类错误通常是临时性的（数据库抖动、连接超时），重试有价值；
     * 与签名失败（403，配置问题不重试）区分开。
     */
    if (config.pushFailVisible) return res.status(500).json({ code: 500, msg: 'internal error, please retry' });
    return res.status(200).json({ code: 0, msg: 'received with error' });
  }
});

/**
 * 推送数据归一化：分离业务字段与系统元数据
 */
function schema_normalize(body) {
  const op = body && body.op ? String(body.op) : '';
  let data = body && body.data !== undefined && body.data !== null ? body.data : {};
  if (typeof data !== 'object' || Array.isArray(data)) data = { value: data };

  let inner = data;
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    inner = Object.assign({}, data.data);
    Object.keys(data).forEach((k) => {
      if (k !== 'data' && inner[k] === undefined) inner[k] = data[k];
    });
  }

  const values = {};
  const meta = {};
  Object.keys(inner).forEach((k) => {
    // 系统字段仍放入 values（会被字段定义映射到 sys_* 列），同时留一份到 meta
    if (fields.SYSTEM_FIELDS[k]) meta[k] = inner[k];
    values[k] = inner[k];
  });

  return { op, values, meta };
}

/** 根路径探测 */
router.all('/push', (req, res) => {
  res.status(200).json({ code: 0, msg: 'jdy push endpoint ready' });
});

module.exports = router;