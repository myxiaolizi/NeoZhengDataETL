'use strict';

const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const reports = require('./reports');

/**
 * AI 问数
 *
 * 通过大模型把自然语言问题转换为 SQL，在数据集上执行并返回结果。
 * 兼容 OpenAI Chat Completions 协议（DeepSeek / 通义 / 智谱 / Ollama 等）。
 */

/**
 * 预设的 AI 供应商
 *
 * 用户只需选择供应商并填入 API Key 即可使用，无需手动填写接口地址与模型名。
 */
const PROVIDERS = [
  {
    key: 'deepseek',
    name: 'DeepSeek 深度求索',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { key: 'deepseek-chat', name: 'DeepSeek-V3（通用对话，推荐问数）', default: true },
      { key: 'deepseek-reasoner', name: 'DeepSeek-R1（深度推理）' },
    ],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '性价比高，中文与 SQL 生成能力强',
  },
  {
    key: 'qwen',
    name: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { key: 'qwen-plus', name: 'Qwen-Plus（均衡，推荐）', default: true },
      { key: 'qwen-max', name: 'Qwen-Max（最强）' },
      { key: 'qwen-turbo', name: 'Qwen-Turbo（快速低价）' },
      { key: 'qwen2.5-72b-instruct', name: 'Qwen2.5-72B-Instruct' },
    ],
    keyUrl: 'https://bailian.console.aliyun.com/',
    note: '阿里云百炼平台，兼容 OpenAI 协议',
  },
  {
    key: 'kimi',
    name: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { key: 'moonshot-v1-8k', name: 'Moonshot-v1-8K（短文本）' },
      { key: 'moonshot-v1-32k', name: 'Moonshot-v1-32K（推荐）', default: true },
      { key: 'moonshot-v1-128k', name: 'Moonshot-v1-128K（超长上下文）' },
      { key: 'kimi-k2-0711-preview', name: 'Kimi-K2（最新）' },
    ],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '长上下文能力强',
  },
  {
    key: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { key: 'glm-4-plus', name: 'GLM-4-Plus（推荐）', default: true },
      { key: 'glm-4-air', name: 'GLM-4-Air（轻量）' },
      { key: 'glm-4-flash', name: 'GLM-4-Flash（免费额度）' },
      { key: 'glm-4-long', name: 'GLM-4-Long（长文本）' },
    ],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: '智谱 AI 开放平台',
  },
  {
    key: 'mimo',
    name: 'MiMo（小米）',
    baseUrl: 'https://api.mimo.ai/v1',
    models: [
      { key: 'mimo-7b-rl', name: 'MiMo-7B-RL（推荐）', default: true },
      { key: 'mimo-vl-7b-rl', name: 'MiMo-VL-7B-RL（多模态）' },
    ],
    keyUrl: 'https://github.com/XiaomiMiMo',
    note: '小米开源模型，可自建服务后填写自定义地址',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { key: 'gpt-4o-mini', name: 'GPT-4o mini（性价比高）', default: true },
      { key: 'gpt-4o', name: 'GPT-4o（最强）' },
      { key: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { key: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo（低价）' },
    ],
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '需可访问 OpenAI 的网络环境',
  },
  {
    key: 'azure',
    name: 'Azure OpenAI',
    baseUrl: 'https://{your-resource}.openai.azure.com/openai/deployments/{deployment}',
    models: [
      { key: 'gpt-4o', name: 'GPT-4o' },
      { key: 'gpt-4o-mini', name: 'GPT-4o mini', default: true },
      { key: 'gpt-35-turbo', name: 'GPT-3.5 Turbo' },
    ],
    keyUrl: 'https://portal.azure.com/',
    note: '需替换地址中的 {your-resource} 与 {deployment}',
    custom: true,
  },
  {
    key: 'ollama',
    name: 'Ollama（本地部署）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: [
      { key: 'qwen2.5:7b', name: 'Qwen2.5 7B', default: true },
      { key: 'llama3.1:8b', name: 'Llama 3.1 8B' },
      { key: 'deepseek-coder-v2', name: 'DeepSeek Coder V2' },
    ],
    keyUrl: 'https://ollama.com/',
    note: '本地部署，API Key 可留空',
    noKey: true,
  },
  {
    key: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    note: '任何兼容 OpenAI Chat Completions 协议的服务',
    custom: true,
    noKey: false,
  },
];

/** 按 key 查找供应商 */
function providerOf(key) {
  return PROVIDERS.find((p) => p.key === key) || null;
}

/** 供应商公开信息（不含密钥） */
function publicProviders() {
  return PROVIDERS.map((p) => ({
    key: p.key,
    name: p.name,
    baseUrl: p.baseUrl,
    models: p.models,
    keyUrl: p.keyUrl || null,
    note: p.note || '',
    custom: !!p.custom,
    noKey: !!p.noKey,
  }));
}

/** 构建给模型的 schema 描述 */
async function buildSchemaContext(datasetIds) {
  const list = [];
  const datasets = [];

  const all = await reports.listDatasets();
  const targets = datasetIds && datasetIds.length
    ? all.filter((d) => datasetIds.includes(d.id))
    : all.slice(0, 10);

  for (const d of targets) {
    try {
      const cols = await reports.inferFields(d.id);
      datasets.push({ id: d.id, name: d.name, columns: cols.map((c) => c.name) });
      list.push(`数据集「${d.name}」（ID: ${d.id}）字段：${cols.map((c) => c.name).join(', ')}`);
    } catch (_) { /* 跳过不可用的数据集 */ }
  }

  return { text: list.join('\n'), datasets };
}

/** 调用大模型 */
async function callLLM(messages, options) {
  const opts = options || {};
  const baseUrl = String(await settings.get('ai_base_url', '')).replace(/\/+$/, '');
  const apiKey = await settings.get('ai_api_key', '');
  const model = await settings.get('ai_model', 'deepseek-chat');

  if (!baseUrl) throw new Error('未配置 AI 接口地址（系统设置 → AI 问数）');
  if (!apiKey) throw new Error('未配置 AI 接口密钥');

  const url = baseUrl + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature === undefined ? 0.1 : opts.temperature,
      max_tokens: opts.maxTokens || 2000,
      stream: false,
    }),
    signal: AbortSignal.timeout(60000),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`AI 接口返回 HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  let json;
  try { json = JSON.parse(text); } catch (_) { throw new Error('AI 接口返回内容不是合法 JSON'); }

  const content = json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content
    : null;
  if (!content) throw new Error('AI 接口未返回有效内容');

  return { content, usage: json.usage || null, model };
}

/** 从模型输出中提取 SQL */
function extractSql(content) {
  let s = String(content || '').trim();
  // ```sql ... ```
  const fence = s.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 去掉前后解释文字，取第一条 SELECT/WITH
  const m = s.match(/\b(select|with)\b[\s\S]*/i);
  if (m) s = m[0];
  s = s.replace(/;+\s*$/, '').trim();
  return s;
}

/** 生成 SQL */
async function generateSql(question, schemaText, history) {
  const system = [
    '你是一个专业的数据分析助手，负责把用户的自然语言问题转换为 MySQL 查询语句。',
    '',
    '可用数据：',
    schemaText || '（暂无可用数据集）',
    '',
    '要求：',
    '1. 只输出一条 SELECT 查询语句，不要输出任何解释文字；',
    '2. 使用上面列出的真实字段名，不要臆造字段；',
    '3. 不要使用 INSERT/UPDATE/DELETE/DROP 等写操作；',
    '4. 不要使用分号结尾；',
    '5. 如需聚合请使用 GROUP BY，并给结果列取中文别名（用 AS）。',
  ].join('\n');

  const messages = [{ role: 'system', content: system }];
  (history || []).slice(-4).forEach((h) => {
    if (h.role && h.content) messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
  });
  messages.push({ role: 'user', content: String(question) });

  const r = await callLLM(messages);
  const sql = extractSql(r.content);
  return { sql, raw: r.content, usage: r.usage, model: r.model };
}

/** 生成结果的自然语言解读 */
async function explainResult(question, sql, rows) {
  const preview = JSON.stringify(rows.slice(0, 30)).slice(0, 4000);
  const messages = [
    {
      role: 'system',
      content: '你是数据分析助手。请用简洁的中文总结查询结果，突出关键数字与趋势，不要编造数据。',
    },
    {
      role: 'user',
      content: `问题：${question}\n\n执行的 SQL：${sql}\n\n查询结果（JSON，最多 30 行）：${preview}\n\n请用 2-4 句话总结。`,
    },
  ];
  const r = await callLLM(messages, { temperature: 0.3, maxTokens: 800 });
  return r.content.trim();
}

/**
 * 问数主流程
 * @param {string} question 自然语言问题
 * @param {{datasetId?:number, sessionKey?:string, userId?:number, history?:Array}} options
 */
async function ask(question, options) {
  const opts = options || {};
  const started = Date.now();
  const q = String(question || '').trim();
  if (!q) throw new Error('请输入问题');

  const sessionKey = opts.sessionKey || crypto.randomBytes(8).toString('hex');

  try {
    // 1) 构建 schema 上下文
    const ctx = await buildSchemaContext(opts.datasetId ? [opts.datasetId] : null);
    if (!ctx.datasets.length) {
      throw new Error('暂无可用数据集，请先在「报表中心 → 数据集」中创建');
    }

    // 2) 生成 SQL
    const gen = await generateSql(q, ctx.text, opts.history);

    // 3) 安全校验
    reports.assertReadOnly(gen.sql);

    // 4) 选择数据集执行
    let targetDatasetId = opts.datasetId;
    if (!targetDatasetId) {
      // 简单启发：选择字段命中率最高的数据集
      let best = ctx.datasets[0];
      let bestScore = -1;
      for (const d of ctx.datasets) {
        const score = d.columns.filter((c) => gen.sql.includes(c)).length;
        if (score > bestScore) { bestScore = score; best = d; }
      }
      targetDatasetId = best.id;
    }

    const dataset = await reports.getDataset(targetDatasetId);
    if (!dataset) throw new Error('数据集不存在');

    // 5) 执行
    const query = await reports.buildQuery(dataset, 500);
    const dsMod = require('./datasource');
    const sql = dsMod.paginate(query.ds, gen.sql, 500, 0);
    const rows = await dsMod.query(query.ds, sql, query.params);

    // 6) 解读
    let answer = '';
    try {
      answer = await explainResult(q, gen.sql, rows);
    } catch (err) {
      answer = `查询完成，共返回 ${rows.length} 行数据。`;
    }

    const duration = Date.now() - started;
    await saveChat({
      userId: opts.userId,
      sessionKey,
      question: q,
      answer,
      sqlText: gen.sql,
      datasetId: targetDatasetId,
      resultRows: rows.length,
      success: true,
      durationMs: duration,
    });

    return {
      ok: true,
      sessionKey,
      question: q,
      sql: gen.sql,
      datasetId: targetDatasetId,
      datasetName: dataset.name,
      answer,
      rows,
      columns: rows.length ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] })) : [],
      rowCount: rows.length,
      duration,
      model: gen.model,
    };
  } catch (err) {
    const duration = Date.now() - started;
    await saveChat({
      userId: opts.userId,
      sessionKey,
      question: q,
      answer: null,
      sqlText: null,
      datasetId: opts.datasetId || null,
      resultRows: 0,
      success: false,
      message: err.message,
      durationMs: duration,
    });
    throw err;
  }
}

async function saveChat(c) {
  try {
    await db.query(
      `INSERT INTO jdywh_ai_chats
         (user_id, session_key, question, answer, sql_text, dataset_id, result_rows, success, message, duration_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        c.userId || null, c.sessionKey, c.question,
        c.answer || null, c.sqlText || null, c.datasetId || null,
        c.resultRows || 0, c.success ? 1 : 0,
        c.message ? String(c.message).slice(0, 480) : null,
        c.durationMs || null,
      ]
    );
  } catch (err) {
    console.error('[ai] 保存问数记录失败:', err.message);
  }
}

async function listChats(sessionKey, limit) {
  const where = sessionKey ? 'WHERE session_key = ?' : '';
  const params = sessionKey ? [sessionKey] : [];
  return db.query(
    `SELECT * FROM jdywh_ai_chats ${where} ORDER BY id DESC LIMIT ${Math.min(Number(limit) || 50, 200)}`,
    params
  );
}

/** 测试 AI 连接 */
async function testConnection() {
  const started = Date.now();
  try {
    const r = await callLLM([
      { role: 'user', content: '请回复"连接成功"四个字。' },
    ], { maxTokens: 20, temperature: 0 });
    return { ok: true, message: r.content.trim().slice(0, 100), model: r.model, elapsed: Date.now() - started };
  } catch (err) {
    return { ok: false, message: err.message, elapsed: Date.now() - started };
  }
}

module.exports = {
  ask,
  generateSql,
  extractSql,
  callLLM,
  testConnection,
  listChats,
  buildSchemaContext,
  PROVIDERS,
  providerOf,
  publicProviders,
};