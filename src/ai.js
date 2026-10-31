'use strict';

const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const reports = require('./reports');
const datasources = require('./datasources');
const dsMod = require('./datasource');
const aiScope = require('./ai-scope');

/**
 * AI 问数（V8）
 *
 * 通过大模型把自然语言问题转换为 SQL，在**用户选定的数据范围**上执行并返回结果。
 *
 * V8 相对 V7 的关键修复：
 *   1. URL 归一化：用户可能填「域名根 / 带 /v1 / 带 /v1/chat/completions 的完整地址」，
 *      旧代码无条件 `baseUrl + '/chat/completions'` → 完整地址会双拼成
 *      `.../chat/completions/chat/completions`（实测 HTTP 400）。
 *   2. MiMo 预设纠错：真实地址是小米 MiMo 开放平台 `https://api.xiaomimimo.com`，
 *      模型 `mimo-v2.6-pro`（默认）/ `mimo-v2.6-flash`。
 *   3. 多数据范围：`ask(question, { scope })`，由 `ai-scope.js` 解析成物理表 + 列 + 行数，
 *      以「逻辑表名 + CTE 注入」喂给模型，执行前做只读 + 表白名单双校验。
 *   4. `reasoning_content` 只当思维链，**绝不**当答案或 SQL；
 *      模型只返回推理过程时给出明确中文提示。
 */

/* ══════════════════════════════════════════════════════════════════
 *  一、供应商预设
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 预设的 AI 供应商。
 *
 * `apiStyle` 只是「默认协议风格」，最终以设置项 `ai_api_style` 为准；
 * Anthropic 原生协议（/anthropic/v1/messages + x-api-key）本轮不实现，
 * 但在 note 里写清正确形态，避免用户照抄一个跑不通的配置。
 */
const PROVIDERS = [
  {
    key: 'mimo',
    name: 'MiMo（小米开放平台）',
    baseUrl: 'https://api.xiaomimimo.com',
    apiStyle: 'chat',
    models: [
      { key: 'mimo-v2.6-pro', name: 'MiMo-V2.6-Pro（能力更强，默认）', default: true },
      { key: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash（响应更快）' },
    ],
    keyUrl: 'https://api.xiaomimimo.com/',
    note: '小米 MiMo 开放平台，兼容 OpenAI Chat Completions 协议。'
      + '接口地址填 https://api.xiaomimimo.com 或 https://api.xiaomimimo.com/v1 均可（系统会自动归一化）。'
      + '返回字段 choices[0].message.content 是答案，reasoning_content 是思维链（不会被当作答案）。'
      + '注意：该平台不提供 GET /v1/models，本系统也不会依赖它。'
      + '原生 Anthropic 协议端点为 POST https://api.xiaomimimo.com/anthropic/v1/messages（头 x-api-key + anthropic-version: 2023-06-01），本系统不直接支持，如需请选择「自定义」并填写兼容地址。',
  },
  {
    key: 'deepseek',
    name: 'DeepSeek 深度求索',
    baseUrl: 'https://api.deepseek.com/v1',
    apiStyle: 'chat',
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
    apiStyle: 'chat',
    models: [
      { key: 'qwen-plus', name: 'Qwen-Plus（均衡，推荐）', default: true },
      { key: 'qwen-max', name: 'Qwen-Max（最强）' },
      { key: 'qwen-turbo', name: 'Qwen-Turbo（快速低价）' },
      { key: 'qwen2.5-72b-instruct', name: 'Qwen2.5-72B-Instruct' },
    ],
    keyUrl: 'https://bailian.console.aliyun.com/',
    note: '阿里云百炼平台，兼容 OpenAI 协议（地址已含 /compatible-mode/v1，系统会识别）',
  },
  {
    key: 'kimi',
    name: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiStyle: 'chat',
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
    apiStyle: 'chat',
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
    key: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiStyle: 'chat',
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
    apiStyle: 'chat',
    models: [
      { key: 'gpt-4o', name: 'GPT-4o' },
      { key: 'gpt-4o-mini', name: 'GPT-4o mini', default: true },
      { key: 'gpt-35-turbo', name: 'GPT-3.5 Turbo' },
    ],
    keyUrl: 'https://portal.azure.com/',
    note: '需替换地址中的 {your-resource} 与 {deployment}；Azure 还需要 api-version 参数，本系统不自动附加',
    custom: true,
  },
  {
    key: 'ollama',
    name: 'Ollama（本地部署）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiStyle: 'chat',
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
    apiStyle: 'chat',
    models: [],
    note: '任何兼容 OpenAI Chat Completions 协议的服务。地址可填域名根、带 /v1、或完整 .../v1/chat/completions，系统会自动归一化，不会重复拼接',
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
    apiStyle: p.apiStyle || 'chat',
    models: p.models,
    keyUrl: p.keyUrl || null,
    note: p.note || '',
    custom: !!p.custom,
    noKey: !!p.noKey,
  }));
}

/* ══════════════════════════════════════════════════════════════════
 *  二、接口地址归一化
 * ══════════════════════════════════════════════════════════════════ */

/** 会被识别为「协议终点」的后缀（归一化时剥掉） */
const ENDPOINT_SUFFIXES = ['/chat/completions', '/responses', '/completions', '/messages'];

/** 版本段：/v1 /v2 /v4 /v1beta /compatible-mode/v1 ... */
const VERSION_SEGMENT_RE = /(^|\/)(v\d+[a-z0-9]*|compatible-mode\/v\d+[a-z0-9]*)$/i;

/**
 * 把用户填写的接口地址归一化成「协议根」（不含 /chat/completions 或 /responses）。
 *
 * 覆盖（实测要求）：
 *   https://api.xiaomimimo.com                       → https://api.xiaomimimo.com
 *   https://api.xiaomimimo.com/                      → https://api.xiaomimimo.com
 *   https://api.xiaomimimo.com/v1                    → https://api.xiaomimimo.com/v1
 *   https://api.xiaomimimo.com/v1/chat/completions   → https://api.xiaomimimo.com/v1
 *   https://api.xiaomimimo.com/chat/completions      → https://api.xiaomimimo.com
 *   https://dashscope.aliyuncs.com/compatible-mode/v1 → 原样保留
 *   .../v1/chat/completions/chat/completions         → .../v1（重复拼接会被彻底消除）
 *
 * @param {string} raw 用户填写的地址
 * @returns {string} 协议根
 */
function normalizeBaseUrl(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';

  // 去尾部斜杠（可能有多层）
  s = s.replace(/\/+$/, '');
  if (!s) return '';

  // 反复剥离协议终点后缀，直到稳定 —— 这一步顺手治好历史脏数据里的双拼地址
  for (let k = 0; k < 5; k += 1) {
    const low = s.toLowerCase();
    const hit = ENDPOINT_SUFFIXES.find((sfx) => low.endsWith(sfx));
    if (!hit) break;
    s = s.slice(0, s.length - hit.length).replace(/\/+$/, '');
    if (!s) break;
  }
  return s;
}

/**
 * 构造真实请求地址。
 *
 * @param {string} raw 用户填写的接口地址
 * @param {string} [style] 'chat'（默认）| 'responses'
 * @returns {string} 完整端点地址
 */
function buildEndpoint(raw, style) {
  const root = normalizeBaseUrl(raw);
  if (!root) return '';
  const suffix = String(style || '').toLowerCase() === 'responses' ? '/responses' : '/chat/completions';

  // 形如 https://host（无路径，或只有协议://host/）→ 补 /v1
  const noPath = /^[a-z][a-z0-9+.-]*:\/\/[^/]+$/i.test(root);
  if (noPath) return `${root}/v1${suffix}`;

  // 相对地址（自建反代的 /api 前缀）：没有版本段时也补 /v1
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(root)) {
    return VERSION_SEGMENT_RE.test(root) ? `${root}${suffix}` : `${root}/v1${suffix}`;
  }

  // 已含版本段（/v1、/v4、/compatible-mode/v1）→ 直接接终点；否则原样接终点（用户自有路径）
  return `${root}${suffix}`;
}

/* ══════════════════════════════════════════════════════════════════
 *  三、调用大模型
 * ══════════════════════════════════════════════════════════════════ */

/** 读取 AI 相关设置（合并供应商预设的兜底值） */
async function resolveConfig() {
  const providerKey = await settings.get('ai_provider', 'deepseek');
  const preset = providerOf(providerKey);
  const baseUrl = String(await settings.get('ai_base_url', '')
    || (preset && preset.baseUrl) || '').trim();
  const apiKey = String(await settings.get('ai_api_key', '') || '').trim();
  const model = String(await settings.get('ai_model', '')
    || (preset && preset.models && preset.models[0] && preset.models[0].key)
    || 'deepseek-chat').trim();
  const style = String(await settings.get('ai_api_style', (preset && preset.apiStyle) || 'chat') || 'chat').toLowerCase();
  const timeoutMs = await settings.getInt('ai_timeout_ms', 60000);
  const temperatureRaw = Number(await settings.get('ai_temperature', '0'));
  const maxRows = await settings.getInt('ai_max_rows', 500);
  const thinking = await settings.getBool('ai_enable_thinking');
  return {
    providerKey,
    baseUrl,
    apiKey,
    model,
    style: style === 'responses' ? 'responses' : 'chat',
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000,
    // 问数场景温度默认 0（实测比 0.1 更稳）
    temperature: Number.isFinite(temperatureRaw) ? Math.min(Math.max(temperatureRaw, 0), 2) : 0,
    maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 500,
    thinking: !!thinking,
  };
}

/** 从各种返回结构里提取文本（跳过 reasoning） */
function pickText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(pickText).join('');
  if (typeof node === 'object') {
    if (typeof node.text === 'string') return node.text;
    if (typeof node.content === 'string') return node.content;
    if (node.content) return pickText(node.content);
    if (typeof node.value === 'string') return node.value;
  }
  return '';
}

/**
 * 解析 chat 风格返回。**只取 message.content**，reasoning_content 单独返回。
 * @returns {{content:string, reasoning:string, usage:object|null}}
 */
function parseChatResponse(json) {
  const msg = (json && json.choices && json.choices[0] && json.choices[0].message) || null;
  const content = msg ? pickText(msg.content) : '';
  const reasoning = msg && msg.reasoning_content ? String(msg.reasoning_content) : '';
  // 少数网关把内容放在 choice.text（completions 风格）
  const fallback = content || (json && json.choices && json.choices[0] && json.choices[0].text) || '';
  return { content: String(fallback || '').trim(), reasoning, usage: (json && json.usage) || null };
}

/**
 * 解析 responses 风格返回。
 * 优先取顶层 `output_text`；否则遍历 `output[]`，只取 `type==='message'` 的 content[].text，
 * **跳过 `type==='reasoning'`**。
 * @returns {{content:string, reasoning:string, usage:object|null}}
 */
function parseResponsesResponse(json) {
  const j = json || {};
  let content = '';
  let reasoning = '';
  const hasTopLevel = typeof j.output_text === 'string' && j.output_text.trim().length > 0;
  if (hasTopLevel) content = j.output_text.trim();

  if (Array.isArray(j.output)) {
    for (const item of j.output) {
      if (!item) continue;
      if (item.type === 'reasoning' || item.type === 'thinking') {
        reasoning += pickText(item.summary || item.content || '');
        continue;
      }
      if (item.type === 'message') {
        // 顶层已有 output_text 时不再累加，避免同一段答案被拼两遍
        if (hasTopLevel) continue;
        // content[] 里 type==='output_text' 或 'text'
        const parts = Array.isArray(item.content) ? item.content : [];
        for (const c of parts) {
          if (!c) continue;
          if (c.type === 'reasoning' || c.type === 'thinking') { reasoning += pickText(c); continue; }
          content += pickText(c);
        }
      }
    }
  }
  return { content: String(content || '').trim(), reasoning, usage: j.usage || null };
}

/** 把服务端返回体里的错误信息抽出来（用于中文报错） */
function serverMessage(text) {
  try {
    const j = JSON.parse(text);
    const e = j && (j.error || j);
    if (e && typeof e === 'object') {
      return String(e.message || e.param || e.type || e.code || '').trim();
    }
  } catch (_) { /* 非 JSON，直接用原文 */ }
  return String(text || '').trim();
}

/** HTTP 状态 → 中文可操作提示（含服务端返回前 300 字） */
function httpError(status, text, url) {
  const raw = String(text || '');
  const detail = serverMessage(raw).slice(0, 300) || raw.slice(0, 300);
  const where = url ? `（请求地址：${url}）` : '';
  // 注意：某些网关把真正原因放在 error.param 里（如 param:"404 NOT_FOUND"），
  // 因此判断「地址不对」时要同时看原始返回体，不能只看提取出的 message。
  const hay = `${detail}\n${raw}`;
  if (status === 401 || status === 403) {
    return `AI 接口鉴权失败（HTTP ${status}）${where}：API Key 无效、已过期或没有该模型的权限，请在「系统设置 → AI 问数」重新填写密钥。服务端返回：${detail}`;
  }
  if (status === 404) {
    return `AI 接口地址不存在（HTTP 404）${where}：请检查「接口地址」是否填成了完整端点或路径写错；本系统会自动补齐 /v1/chat/completions，不要重复填写。服务端返回：${detail}`;
  }
  if (/unsupported\s*model|model.*not.*(exist|found|support)/i.test(hay)) {
    return `模型名称不被支持（HTTP ${status}）${where}：请检查「模型名称」是否拼写正确，MiMo 可用 mimo-v2.6-pro / mimo-v2.6-flash。服务端返回：${detail}`;
  }
  if (/404\s*NOT_FOUND|not\s*found/i.test(hay)) {
    return `AI 接口地址不正确（HTTP ${status}）${where}：这通常是地址被重复拼接（如 .../chat/completions/chat/completions）或路径写错导致的。请把「接口地址」改成 https://api.xiaomimimo.com 或 https://api.xiaomimimo.com/v1，系统会自动补齐端点。服务端返回：${detail}`;
  }
  if (status === 429) {
    return `AI 接口请求过于频繁（HTTP 429）${where}：请稍后重试或降低问数频率。服务端返回：${detail}`;
  }
  if (status >= 500) {
    return `AI 服务端错误（HTTP ${status}）${where}：对方服务暂时不可用，请稍后重试。服务端返回：${detail}`;
  }
  return `AI 接口返回 HTTP ${status}${where}：${detail}`;
}

/** 网络层异常 → 中文 */
function networkError(err, url, timeoutMs) {
  const msg = String((err && err.message) || err || '');
  const name = String((err && err.name) || '');
  if (name === 'TimeoutError' || name === 'AbortError' || /aborted|timeout|timed out/i.test(msg)) {
    return new Error(`AI 接口请求超时（${Math.round((timeoutMs || 60000) / 1000)} 秒未返回）：请稍后重试、换用更快的模型，或在「系统设置 → AI 问数」调大超时时间`);
  }
  if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) {
    // 保留「无法连接 AI 接口」这一既有短语（历史回归 scripts/v41-ai-backend.js 按它断言），
    // 括号里再补充精确原因，兼顾可读性与可定位性。
    return new Error(`无法连接 AI 接口：无法解析域名（${err.code}）${url}，请检查「接口地址」拼写与网络 / DNS`);
  }
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'EHOSTUNREACH' || err.code === 'ETIMEDOUT')) {
    return new Error(`无法连接 AI 接口（${err.code}）：${url}，请检查网络、代理与接口地址`);
  }
  if (/certificate|self signed|SSL|TLS/i.test(msg)) {
    return new Error(`AI 接口 HTTPS 证书校验失败：${url}，请确认对方证书有效（或改用自建中转地址）`);
  }
  return new Error(`调用 AI 接口失败：${msg || '未知错误'}（请求地址：${url}）`);
}

/**
 * 调用大模型。
 *
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number, maxTokens?:number, timeoutMs?:number, style?:string, config?:object}} [options]
 * @returns {Promise<{content:string, reasoning:string, usage:object|null, model:string, endpoint:string, style:string}>}
 */
async function callLLM(messages, options) {
  const opts = options || {};
  const cfg = opts.config || await resolveConfig();

  if (!cfg.baseUrl) throw new Error('未配置 AI 接口地址（系统设置 → AI 问数 → 接口地址）');
  if (!cfg.apiKey && !(providerOf(cfg.providerKey) || {}).noKey) {
    throw new Error('未配置 AI 接口密钥（系统设置 → AI 问数 → 接口密钥）');
  }

  const style = opts.style || cfg.style || 'chat';
  const url = buildEndpoint(cfg.baseUrl, style);
  const timeoutMs = Number(opts.timeoutMs) || cfg.timeoutMs;

  /*
   * max_tokens 下限 256：
   * MiMo 等推理模型会把思维链计入 max_tokens 预算 —— 实测 max_tokens=16 时
   * 推理吃光预算导致 content 为空。这里统一兜底，防止调用方传进太小的值。
   */
  const maxTokens = Math.max(256, Number(opts.maxTokens) || 2048);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + cfg.apiKey,
  };
  const body = style === 'responses'
    ? {
      model: cfg.model,
      input: messages,
      max_output_tokens: maxTokens,
      temperature: opts.temperature === undefined ? cfg.temperature : opts.temperature,
    }
    : {
      model: cfg.model,
      messages,
      temperature: opts.temperature === undefined ? cfg.temperature : opts.temperature,
      max_tokens: maxTokens,
      stream: false,
    };

  // fetch 与 resp.text() 分开包：AbortSignal.timeout 同时作用于「等响应头」与「读响应体」，
  // 只在 fetch() 外面 try 的话，读 body 超时会漏出英文原始错误。
  let resp;
  let text;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await resp.text();
  } catch (err) {
    throw networkError(err, url, timeoutMs);
  }

  if (!resp.ok) throw new Error(httpError(resp.status, text, url));

  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error(`AI 接口返回内容不是合法 JSON（HTTP ${resp.status}）：${String(text).slice(0, 300)}`);
  }

  const parsed = style === 'responses' ? parseResponsesResponse(json) : parseChatResponse(json);

  if (!parsed.content) {
    /*
     * 关键防御：MiMo 等推理模型可能先输出思维链（reasoning_content / output[].type='reasoning'）。
     * **绝不允许**把思维链当答案或当 SQL 执行 —— 那会把半截推理文本塞进 SQL 执行链路。
     */
    if (parsed.reasoning) {
      throw new Error('模型只返回了推理过程，没有给出最终答案，请重试或换个问法（如减少字段、把问题问得更具体）');
    }
    throw new Error(`AI 接口未返回有效内容（HTTP ${resp.status}）：${String(text).slice(0, 300)}`);
  }

  return {
    content: parsed.content,
    reasoning: parsed.reasoning,
    usage: parsed.usage,
    model: cfg.model,
    endpoint: url,
    style,
  };
}

/* ══════════════════════════════════════════════════════════════════
 *  四、SQL 生成
 * ══════════════════════════════════════════════════════════════════ */

/** 从模型输出中提取 SQL（实测 MiMo 会输出干净 SQL，这里只做兜底） */
function extractSql(content) {
  let s = String(content || '').trim();
  // ```sql ... ``` / ``` ... ```
  const fence = s.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 去掉前后解释文字，取第一条 SELECT/WITH
  const m = s.match(/\b(select|with)\b[\s\S]*/i);
  if (m) s = m[0];
  s = s.replace(/;+\s*$/, '').trim();
  return s;
}

/** 构造 SQL 生成的 system 提示词 */
function buildSqlSystemPrompt(schemaText) {
  return [
    '你是一个严谨的 MySQL 数据分析助手，负责把用户的自然语言问题翻译成一条可执行的 SELECT 查询。',
    '',
    '可用数据（只允许使用下面列出的逻辑表名与字段，不得使用其它任何表）：',
    schemaText || '（未提供数据）',
    '',
    '硬性规则：',
    '1. 只输出**一条** SELECT / WITH 查询语句，不要输出任何解释、前言、结尾或 Markdown 围栏（不要 ```）；',
    '2. 语句结尾不要写分号；',
    '3. 只能用「逻辑表名」（如 t1、t2、ds_42）作为 FROM / JOIN 的对象，**不要**使用任何物理表名或库名；',
    '4. 只能使用上面列出的真实字段名，不得臆造；字段名含中文、括号、空格或保留字时，必须用反引号包裹，例如 SELECT `区域`, COUNT(*) AS `数量` FROM t1 GROUP BY `区域`；',
    '5. 禁止 INSERT / UPDATE / DELETE / DROP / TRUNCATE / ALTER / CREATE 等任何写操作，也不要访问 information_schema、mysql、performance_schema、sys；',
    '6. 多表关联时使用明确的 JOIN ... ON；聚合请写 GROUP BY，并给结果列取中文别名（AS `别名`）；',
    '7. 时间字段可能是字符串或数字时间戳，跨类型比较前先做 CAST / STR_TO_DATE 等转换，避免类型不匹配；',
    '8. 若问题无法用给定字段回答，仍要输出一条最接近的 SELECT（例如只查询相关维度），不要输出道歉或说明文字。',
  ].join('\n');
}

/** 判断是否为「超时」类错误（用于 SQL 生成的重试判断） */
function isTimeoutError(err) {
  const msg = String((err && err.message) || '');
  const name = String((err && err.name) || '');
  return name === 'TimeoutError' || name === 'AbortError' || /超时|timeout|timed out|aborted/i.test(msg);
}

/**
 * 生成 SQL。
 *
 * 对「超时」做**最多一次**重试，并把超时放宽到 2 倍（上限 180s）：
 * 推理模型在字段很多（实测 107 列）时首字延迟偶尔超过 60s，
 * 直接失败会让用户反复点重试；SQL 生成无副作用，重试是安全的。
 *
 * @param {string} question
 * @param {string} schemaText
 * @param {Array} [history]
 * @param {object} [opts] { config }
 */
async function generateSql(question, schemaText, history, opts) {
  const messages = [{ role: 'system', content: buildSqlSystemPrompt(schemaText) }];
  (history || []).slice(-4).forEach((h) => {
    if (h && h.role && h.content) {
      const role = h.role === 'assistant' ? 'assistant' : 'user';
      messages.push({ role, content: String(h.content).slice(0, 2000) });
    }
  });
  messages.push({ role: 'user', content: String(question) });

  let r;
  try {
    r = await callLLM(messages, Object.assign({ maxTokens: 2048 }, opts || {}));
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    const cfg = (opts && opts.config) || await resolveConfig();
    const retryTimeout = Math.min(Math.max(Number(cfg.timeoutMs) || 60000, 60000) * 2, 180000);
    console.warn(`[ai] 生成 SQL 超时，自动重试一次（超时放宽到 ${Math.round(retryTimeout / 1000)} 秒）`);
    r = await callLLM(messages, Object.assign({ maxTokens: 2048 }, opts || {}, { timeoutMs: retryTimeout }));
  }

  const sql = extractSql(r.content);
  if (!sql) {
    throw new Error(`模型没有给出可用的查询语句，请换个问法重试（模型原文：${String(r.content).slice(0, 200)}）`);
  }
  return { sql, raw: r.content, usage: r.usage, model: r.model, reasoning: r.reasoning };
}

/** 生成结果的自然语言解读 */
async function explainResult(question, sql, rows, opts) {
  const preview = JSON.stringify((rows || []).slice(0, 30)).slice(0, 4000);
  const messages = [
    {
      role: 'system',
      content: '你是数据分析助手。请用简洁的中文总结查询结果，突出关键数字与趋势，不要编造数据，不要输出 SQL。',
    },
    {
      role: 'user',
      content: `问题：${question}\n\n查询结果（JSON，最多 30 行）：\n${preview}\n\n请用 2-4 句话总结。`,
    },
  ];
  const r = await callLLM(messages, Object.assign({ temperature: 0.3, maxTokens: 800 }, opts || {}));
  return r.content.trim();
}

/* ══════════════════════════════════════════════════════════════════
 *  五、问数主流程
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 把请求参数归一成 scope 数组（兼容旧的 datasetId）。
 */
function normalizeScopeInput(body) {
  const b = body || {};
  if (Array.isArray(b.scope) && b.scope.length) return b.scope;
  if (b.datasetId !== undefined && b.datasetId !== null && b.datasetId !== '') {
    return [{ kind: 'dataset', id: Number(b.datasetId) }];
  }
  if (b.projectId !== undefined && b.projectId !== null && b.projectId !== '') {
    return [{ kind: 'project', id: Number(b.projectId), tableType: b.tableType }];
  }
  return [];
}

/**
 * 问数主流程。
 *
 * @param {string} question 自然语言问题
 * @param {{
 *   scope?: Array<{kind:string,id:number,tableType?:string}>,
 *   datasetId?: number,
 *   sessionKey?: string, userId?: number, history?: Array,
 *   limit?: number, shareId?: number, config?: object
 * }} options
 */
async function ask(question, options) {
  const opts = options || {};
  const started = Date.now();
  const q = String(question || '').trim();
  if (!q) throw new Error('请输入问题');
  if (q.length > 2000) throw new Error('问题过长（最多 2000 字）');

  const sessionKey = opts.sessionKey || crypto.randomBytes(8).toString('hex');
  const rawScope = normalizeScopeInput(opts);
  let lastSql = null;
  let sources = [];

  try {
    // 1) 数据范围
    const resolved = await aiScope.resolveScope(rawScope);
    sources = resolved.sources;

    // 2) schema 上下文（只喂 scope 内有效来源）
    const schemaText = aiScope.buildSchemaText(sources);

    // 3) 生成 SQL
    const cfg = opts.config || await resolveConfig();
    const gen = await generateSql(q, schemaText, opts.history, { config: cfg });
    lastSql = gen.sql;

    // 4) 只读校验（剥掉字符串/注释后判定）
    const safeSql = reports.assertReadOnly(gen.sql);
    lastSql = safeSql;

    // 5) 表白名单校验（必须在包裹 CTE 之前，校验的是模型原文里的逻辑表名）
    const check = aiScope.assertScopeOnly(safeSql, sources);
    lastSql = safeSql;

    /*
     * 6) 按需包裹 CTE：逻辑表名 → 物理表。
     *
     * 三种情况需要包裹：
     *   a. 模型用了逻辑别名（t1 / ds_42）→ 必须注入 CTE，否则别名无从解析；
     *   b. **来源里存在「匿名物理列 + 中文业务名」**（如 parsed_16 的
     *      `widget_1791449342211` ↔ 「区域」）→ 也必须包裹，因为 CTE 会把
     *      中文业务名投影成可用列名；否则模型直接写物理表名时中文列名会报
     *      `Unknown column '区域'`（真机实测过）；
     *   c. 模型直接写「sql 数据集自身的源表」（如 `zkcrm-ry`）且该来源无匿名列
     *      → 原样执行，保持历史契约（返回模型原 SQL，sql_text 可读可排查）。
     */
    const wrapped = check.usesAlias || aiScope.hasLabelAliases(sources);
    let finalSql = wrapped ? aiScope.wrapSql(safeSql, sources) : safeSql;

    // 7) 强制分页上限：模型自带 LIMIT 时外层再套一层，确保不会绕过 cap
    const cap = Math.min(
      Number(opts.limit) || cfg.maxRows || 500,
      Number(opts.maxRowsCap) || 500
    );
    if (dsMod.hasRowLimit(finalSql)) {
      finalSql = `SELECT * FROM (${finalSql}) AS \`_v8_out\``;
    }

    const source = await datasources.getById(0);
    if (!source) throw new Error('本机数据源不可用');

    finalSql = dsMod.normalizeSql(source, finalSql);
    finalSql = dsMod.paginate(source, finalSql, cap, 0);

    let rows;
    try {
      rows = await dsMod.query(source, finalSql, []);
    } catch (err) {
      throw dsMod.describeDbError(source, err, finalSql, safeSql, safeSql);
    }

    // 8) 解读（失败不影响取数结果）
    let answer = '';
    try {
      answer = await explainResult(q, safeSql, rows, { config: cfg });
    } catch (_) {
      answer = `查询完成，共返回 ${rows.length} 行数据。`;
    }

    const duration = Date.now() - started;
    const first = sources[0] || {};
    const publicSources = sources.map((s) => ({
      kind: s.kind,
      id: s.id,
      name: s.name,
      table: s.table || s.alias,
      alias: s.alias,
      rowCount: Number(s.rowCount || 0),
      columnCount: (s.columns || []).length,
    }));

    await saveChat({
      userId: opts.userId,
      sessionKey,
      question: q,
      answer,
      sqlText: finalSql,
      datasetId: first.kind === 'dataset' ? first.id : null,
      resultRows: rows.length,
      success: true,
      durationMs: duration,
      shareId: opts.shareId,
    });

    const result = {
      ok: true,
      sessionKey,
      question: q,
      /*
       * sql 字段（契约 2.4）：给用户/前端看的那条 SQL。
       *   - 未包裹 CTE（模型直接写物理表）→ 就是模型原 SQL（保持历史行为，可读、可读性最好）
       *   - 包裹了 CTE（模型用了逻辑别名）→ 返回包裹后的可执行 SQL，否则用户看到的是 t1 无从理解
       * 真正发到数据库的完整语句（含分页）在 executedSql / sql_text 里，便于排查。
       */
      sql: wrapped ? finalSql : safeSql,
      executedSql: finalSql,
      sources: publicSources,
      datasetId: first.kind === 'dataset' ? first.id : (first.id || null),
      datasetName: first.name || '',
      answer,
      rows,
      columns: rows.length
        ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] }))
        : [],
      rowCount: rows.length,
      duration,
      model: gen.model,
    };
    // 附加提示（非契约字段，前端可忽略）：被合并/被跳过的坏源
    if (resolved.invalid.length || resolved.dropped.length) {
      result.warnings = []
        .concat(resolved.invalid.map((i) => `已跳过不可用范围「${i.name || i.id}」：${i.reason}`))
        .concat(resolved.dropped.map((i) => `已合并重复范围「${i.name || i.id}」：${i.reason}`));
    }
    return result;
  } catch (err) {
    const duration = Date.now() - started;
    await saveChat({
      userId: opts.userId,
      sessionKey,
      question: q,
      answer: null,
      sqlText: lastSql,
      datasetId: (sources[0] && sources[0].kind === 'dataset') ? sources[0].id : null,
      resultRows: 0,
      success: false,
      message: err.message,
      durationMs: duration,
      shareId: opts.shareId,
    });
    throw err;
  }
}

/** 写问数记录（失败只记日志，不影响主流程） */
async function saveChat(c) {
  try {
    const prefix = c.shareId ? `share:${c.shareId} ` : '';
    await db.query(
      `INSERT INTO jdywh_ai_chats
         (user_id, session_key, question, answer, sql_text, dataset_id, result_rows, success, message, duration_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        c.userId || null,
        `${prefix}${c.sessionKey || ''}`.slice(0, 128),
        `${prefix}${c.question || ''}`.slice(0, 5000),
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

/* ══════════════════════════════════════════════════════════════════
 *  六、兼容与辅助
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 兼容旧接口：按数据集 ID 列表构建 schema 上下文。
 * 新代码请直接用 aiScope.resolveScope + buildSchemaText。
 */
async function buildSchemaContext(datasetIds) {
  const ids = Array.isArray(datasetIds) ? datasetIds : [];
  const scope = ids.map((id) => ({ kind: 'dataset', id: Number(id) }));
  const sources = [];
  for (const item of scope) {
    const r = await aiScope.resolveOne(item);
    if (!r.invalid) {
      r.alias = r.sqlAlias || `t${sources.length + 1}`;
      r.label = aiScope.KIND_LABEL[r.kind] || r.kind;
      sources.push(r);
    }
  }
  return {
    text: aiScope.buildSchemaText(sources),
    datasets: sources.map((s) => ({ id: s.id, name: s.name, columns: (s.columns || []).map((c) => c.name) })),
    sources,
  };
}

/** 测试 AI 连接：发起一次最小对话（不使用 GET /v1/models —— MiMo 返回 405） */
async function testConnection() {
  const started = Date.now();
  try {
    const cfg = await resolveConfig();
    const r = await callLLM(
      [{ role: 'user', content: '请只回复两个字：成功' }],
      { maxTokens: 64, temperature: 0, config: cfg }
    );
    return {
      ok: true,
      message: r.content.trim().slice(0, 100),
      model: r.model,
      endpoint: r.endpoint,
      style: r.style,
      elapsed: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, message: err.message, elapsed: Date.now() - started };
  }
}

module.exports = {
  // 主流程
  ask,
  generateSql,
  generateSqlWithScope: async (question, scope, options) => {
    const resolved = await aiScope.resolveScope(scope);
    return generateSql(question, aiScope.buildSchemaText(resolved.sources), (options || {}).history);
  },
  explainResult,
  extractSql,
  callLLM,
  testConnection,
  listChats,
  buildSchemaContext,
  buildSqlSystemPrompt,
  // 配置与地址
  resolveConfig,
  normalizeBaseUrl,
  buildEndpoint,
  parseChatResponse,
  parseResponsesResponse,
  httpError,
  networkError,
  isTimeoutError,
  // 供应商
  PROVIDERS,
  providerOf,
  publicProviders,
  // 兼容：把 scope 工具再导出，方便脚本/路由少 require 一个模块
  scope: aiScope,
};
