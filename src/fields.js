'use strict';

const crypto = require('crypto');
const db = require('./db');
const { sanitizeIdent } = require('./ident');

/**
 * 字段定义与解析引擎
 *
 * 需求 5：支持粘贴简道云「字段对照表及 JSON 样例」的 Markdown 表格，
 *         解析出「字段名称 / 字段ID·别名 / 字段类型 / 说明」，
 *         并把中文「字段名称」写入数据库列注释，保证明细可读性。
 *
 * 需求 7：支持字段解析加工 —— 把 JSON 结构字段（如成员 {"_id":..,"name":"郭晨",..}）
 *         解析为可读值，并在数据库中自动创建对应的解析列；
 *         数组字段可选择「展开为子表」，自动创建新的子表存放每一行。
 */

/* ============ 简道云系统字段 ============ */

const SYSTEM_FIELDS = {
  formName: { name: '表单名称', type: 'string', column: 'jdy_form_name' },
  _id: { name: '数据ID', type: 'string', column: 'jdy_data_id' },
  appId: { name: '应用ID', type: 'string', column: 'sys_app_id' },
  entryId: { name: '表单ID', type: 'string', column: 'sys_entry_id' },
  creator: { name: '提交人', type: 'json', column: 'sys_creator' },
  updater: { name: '修改人', type: 'json', column: 'sys_updater' },
  deleter: { name: '删除人', type: 'json', column: 'sys_deleter' },
  createTime: { name: '提交时间', type: 'string', column: 'sys_create_time' },
  updateTime: { name: '更新时间', type: 'string', column: 'sys_update_time' },
  deleteTime: { name: '删除时间', type: 'string', column: 'sys_delete_time' },
  flowState: { name: '流程状态', type: 'number', column: 'sys_flow_state' },
  sequenceNumber: { name: '流水号', type: 'string', column: 'sys_sequence_number' },
};

/** 内部保留列（不参与字段定义） */
const INTERNAL_COLUMNS = ['id', 'jdy_op', 'jdy_op_time', 'raw_json', 'received_at', 'updated_at'];

/* ============ 解析方式 ============ */

const PARSE_MODES = [
  { key: 'none', name: '不解析（原样存储）', desc: '直接把推送值存入该列', types: ['*'] },
  { key: 'name', name: '取成员/部门名称', desc: '从 {"name":"郭晨",...} 中提取 name', types: ['json'] },
  { key: 'username', name: '取成员账号', desc: '从 {"username":"guochen@x.cn",...} 中提取 username', types: ['json'] },
  { key: 'phone', name: '取手机号', desc: '从 {"phone":"138...","verified":false} 中提取 phone', types: ['json'] },
  { key: 'id', name: '取关联数据 ID', desc: '从 {"_id":"65d4..."} 中提取 _id', types: ['json'] },
  { key: 'text', name: '取文本值', desc: '从 {"text":"..."} 中提取 text', types: ['json'] },
  { key: 'address', name: '地址拼接', desc: '把省/市/区/详细地址拼接为完整地址', types: ['json'] },
  { key: 'member_full', name: '成员完整信息', desc: '输出 名称(账号)，如 郭晨(guochen@sinohealth.cn)', types: ['json'] },
  { key: 'array_join', name: '数组拼接', desc: '把数组各项拼接为一行文本', types: ['array'] },
  { key: 'array_names', name: '数组取名称', desc: '数组每项取 name 后拼接', types: ['array'] },
  { key: 'array_count', name: '数组计数', desc: '输出数组元素个数', types: ['array'] },
  { key: 'timestamp', name: '时间格式化', desc: 'UTC 时间戳 → 本地时间字符串', types: ['string'] },
  { key: 'path', name: '自定义路径', desc: '按自定义路径取值，如 user.name 或 data[0].name', types: ['*'] },
  { key: 'suffix', name: '后缀拼接', desc: '取字段文本再拼上固定后缀（用于「标题」这类派生展示字段）', types: ['string', 'json'] },
];

const PARSE_MODE_MAP = {};
PARSE_MODES.forEach((m) => { PARSE_MODE_MAP[m.key] = m; });

/**
 * 解析方式别名 → 标准键
 *
 * 历史版本前端曾使用 member_name / join / json_path / relate_id / date 等
 * 非标准键，后端只认 name / array_join / path ...，导致取值落到 default 分支
 * 直接把整段 JSON 原样输出（表现为「解析不对」）。
 * 这里统一做一次别名归一，保证新旧配置都能正确解析。
 */
const PARSE_MODE_ALIASES = {
  member_name: 'name',
  member: 'name',
  name_only: 'name',
  username_only: 'username',
  account: 'username',
  mobile: 'phone',
  tel: 'phone',
  relate_id: 'id',
  related_id: 'id',
  record_id: 'id',
  join: 'array_join',
  array_text: 'array_join',
  array_names: 'array_names',
  names: 'array_names',
  count: 'array_count',
  array_length: 'array_count',
  json_path: 'path',
  jsonpath: 'path',
  custom: 'path',
  date: 'timestamp',
  datetime: 'timestamp',
  time: 'timestamp',
  full_member: 'member_full',
  member_info: 'member_full',
  address_text: 'address',
  expand_sub: 'expand',
  subtable: 'expand',
  array_expand: 'expand',
  // 中文标签兼容（历史导入或人工填写）
  不解析: 'none',
  原样存储: 'none',
  取成员名称: 'name',
  取成员部门名称: 'name',
  成员名称: 'name',
  取名称: 'name',
  取成员账号: 'username',
  账号: 'username',
  取手机号: 'phone',
  手机号: 'phone',
  取关联数据ID: 'id',
  关联ID: 'id',
  取文本值: 'text',
  地址拼接: 'address',
  成员完整信息: 'member_full',
  数组拼接: 'array_join',
  数组取名称: 'array_names',
  数组计数: 'array_count',
  时间格式化: 'timestamp',
  时间戳格式化: 'timestamp',
  日期: 'timestamp',
  自定义路径: 'path',
  展开为子表: 'expand',
};

/** 把任意历史/别名解析方式归一为标准键 */
function canonicalMode(mode) {
  const m = String(mode || '').trim();
  if (!m) return 'none';
  if (m === EXPAND_MODE) return EXPAND_MODE;
  if (PARSE_MODE_MAP[m]) return m;
  const lower = m.toLowerCase();
  if (PARSE_MODE_MAP[lower]) return lower;
  if (PARSE_MODE_ALIASES[m]) return PARSE_MODE_ALIASES[m];
  if (PARSE_MODE_ALIASES[lower]) return PARSE_MODE_ALIASES[lower];
  return 'none';
}

/** 「展开为子表」是独立的处理类型 */
const EXPAND_MODE = 'expand';

/**
 * 根据字段类型与说明推荐解析方式
 */
function suggestParseMode(fieldKey, fieldType, remark) {
  const r = String(remark || '');
  const t = String(fieldType || '').toLowerCase();

  // 系统字段优先按语义处理
  if (SYSTEM_FIELDS[fieldKey]) {
    if (['creator', 'updater', 'deleter'].includes(fieldKey)) return 'name';
    if (fieldKey === 'createTime' || fieldKey === 'updateTime' || fieldKey === 'deleteTime') return 'timestamp';
    return 'none';
  }

  if (t === 'array') return 'array_join';

  if (t === 'json') {
    if (r.includes('phone') || r.includes('手机')) return 'phone';
    if (r.includes('province') || r.includes('lnglat') || r.includes('地址')) return 'address';
    if (r.includes('唯一ID') || r.includes('唯一 ID')) return 'id';
    // 成员/部门对象（含 name、status、username）统一取名称，符合业务阅读习惯
    return 'name';
  }

  // 字符串 / 数字：依据说明与字段名判断
  if (r.includes('utc时间戳') || r.includes('UTC时间戳') || r.includes('时间戳')) return 'timestamp';
  if (t === 'string' && /(?:Time|time)$/.test(fieldKey)) return 'timestamp';

  return 'none';
}

/* ============ 列名生成 ============ */

/**
 * 依据字段 key 生成可读的数据库列名
 *   _id                  -> jdy_data_id
 *   formName             -> jdy_form_name
 *   creator              -> sys_creator
 *   _widget_1791449342208 -> w_1791449342208
 *   name / phone         -> name / phone
 *   中文别名              -> f_<md5前10位>
 */
function columnForField(fieldKey, usedSet) {
  const raw = String(fieldKey || '').trim();
  let base;

  if (SYSTEM_FIELDS[raw]) {
    base = SYSTEM_FIELDS[raw].column;
  } else if (/^_widget_(\d+)$/.test(raw)) {
    base = 'w_' + raw.replace(/^_widget_/, '');
  } else if (/^[A-Za-z0-9_]+$/.test(raw)) {
    base = sanitizeIdent(raw, 'f');
  } else {
    base = 'f_' + crypto.createHash('md5').update(raw, 'utf8').digest('hex').slice(0, 10);
  }

  if (base.length > 58) base = base.slice(0, 58);

  let name = base;
  let i = 1;
  while (usedSet && usedSet.has(name)) {
    i += 1;
    name = `${base}_${i}`;
    if (i > 999) { name = `${base}_${crypto.randomBytes(3).toString('hex')}`; break; }
  }
  if (usedSet) usedSet.add(name);
  return name;
}

/** 解析列（存放加工后的可读值） */
function parsedColumnOf(columnName) {
  return `${columnName}_p`;
}

/** 判断某列名是否为解析列 */
function isParsedColumn(columnName) {
  return /_p$/.test(String(columnName || ''));
}

/* ============ 粘贴表格解析 ============ */

/** 合法的简道云字段键：普通英文键，或 _widget_数字 */
const FIELD_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,190}$/;

/** 简道云字段类型白名单 */
const FIELD_TYPES = ['string', 'number', 'json', 'array', 'bool', 'boolean', 'date', 'datetime', 'subform', 'attachment'];

/** 单元格清洗：去 HTML 片段、去内联代码记号、压缩空白 */
function cleanCell(raw) {
  let s = String(raw === undefined || raw === null ? '' : raw);
  s = s.replace(/<br\s*\/?>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
  s = s.replace(/`/g, '');
  s = s.replace(/\*\*/g, '');
  s = s.replace(/[\u00a0\u3000]/g, ' ');
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

/** 是否像「字段类型」而不是「字段名称」 */
function looksLikeType(s) {
  return FIELD_TYPES.includes(String(s || '').trim().toLowerCase());
}

/**
 * 把「复制网页表格」得到的各种形态统一还原为行数组。
 *
 * 关键难点：简道云页面里「说明」列常含 <br>、JSON 样例、多行文本，
 * 复制到剪贴板后一个逻辑行会被拆成多行物理行，直接按行切分会错列。
 * 处理方式：以表头列数为准，行内单元格不足时把后续物理行并入同一行，
 * 直到单元格数达到列数为止。
 */
function tableRowsFromText(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n');

  // 1) HTML 表格（从浏览器复制富文本时常见）
  if (/<t[dh][\s>]/i.test(raw) && /<tr[\s>]/i.test(raw)) {
    const rows = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr;
    while ((tr = trRe.exec(raw))) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c;
      while ((c = cellRe.exec(tr[1]))) cells.push(cleanCell(c[1].replace(/<br\s*\/?>/gi, '\n')));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) return { rows, source: 'html' };
  }

  const phys = raw.split('\n').map((l) => l.replace(/\s+$/, ''));

  // 2) Markdown / 竖线表格
  const pipeLines = phys.filter((l) => l.trim().startsWith('|'));
  if (pipeLines.length >= 2) {
    const splitPipe = (line) => {
      let s = line.trim();
      s = s.replace(/^\|/, '');
      s = s.replace(/\|+$/, '');      // 尾部的 || 视为结束，不产生空列
      return s.split('|').map((c) => c.trim());
    };
    const isSep = (cells) => cells.length > 0
      && cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c));

    // 表头列数
    const first = splitPipe(pipeLines[0]);
    let width = first.length;
    if (pipeLines.length > 1 && isSep(splitPipe(pipeLines[1]))) {
      width = Math.max(width, splitPipe(pipeLines[1]).length);
    }
    if (width < 2) width = 4;

    const rows = [];
    let buf = null;
    const flush = () => {
      if (!buf) return;
      while (buf.length < width) buf.push('');
      rows.push(buf.slice(0, width));
      buf = null;
    };

    /**
     * 判断某竖线行是否是「一条新记录的开头」。
     * 说明列里的 JSON 片段/换行文本也可能带竖线，只有满足
     * 「第 2 列是合法字段键」才认为是新记录。
     */
    const startsNewRecord = (cells) => {
      if (cells.length < 2) return false;
      const key = String(cells[1] || '').trim();
      const name = String(cells[0] || '').trim();
      return !!name && !looksLikeType(name) && /^[A-Za-z_][A-Za-z0-9_]{0,190}$/.test(key);
    };

    for (const line of phys) {
      const t = line.trim();
      if (!t) continue;

      if (!t.startsWith('|')) {
        // 非竖线行：视为上一行单元格的续行（说明列常含换行/JSON 样例）
        if (buf) buf[buf.length - 1] = (buf[buf.length - 1] + ' ' + t).trim();
        continue;
      }

      const cells = splitPipe(line);
      if (isSep(cells)) continue;    // 分隔行不打断当前行

      if (!buf) {
        buf = cells;
        continue;
      }

      if (startsNewRecord(cells)) {
        flush();
        buf = cells;
        continue;
      }

      // 同一逻辑行的续写：并入末尾单元格
      buf[buf.length - 1] = (buf[buf.length - 1] + ' ' + cells.join(' ')).trim();
    }
    flush();
    return { rows, source: 'pipe' };
  }

  // 3) Tab 分隔（Excel / 网页复制兜底）
  const tabLines = phys.filter((l) => l.includes('\t'));
  if (tabLines.length) {
    const rows = tabLines.map((l) => l.split('\t').map((c) => c.trim()));
    return { rows, source: 'tab' };
  }

  return { rows: [], source: 'none' };
}

/** 判断表头行，返回列索引映射 */
function detectHeader(cells) {
  const idx = { name: -1, key: -1, type: -1, remark: -1 };
  cells.forEach((c, i) => {
    const s = String(c || '').replace(/\s/g, '');
    if (idx.name < 0 && /^(字段名称|字段名|名称)$/.test(s)) idx.name = i;
    else if (idx.key < 0 && /^(字段ID|字段ID\/字段别名|字段别名|字段ID或别名|ID|字段标识)$/i.test(s)) idx.key = i;
    else if (idx.type < 0 && /^(字段类型|类型)$/.test(s)) idx.type = i;
    else if (idx.remark < 0 && /^(说明|备注|描述)$/.test(s)) idx.remark = i;
  });
  const hit = idx.name >= 0 && idx.key >= 0;
  return { idx, hit };
}

/**
 * 解析用户粘贴的简道云字段对照表
 *
 * 支持：
 *   ① Markdown 表格（| 字段名称 | 字段ID/字段别名 | 字段类型 | 说明 |）
 *   ② 从网页直接复制的富文本（HTML table / Tab 分隔）
 *   ③ 单元格内含 <br>、JSON 样例、多行说明（自动合并回同一行）
 *   ④ 说明列缺失、列序颠倒、多出空列等容错
 *
 * @returns {{fields:Array, errors:Array, skipped:number, warnings:Array, source:string}}
 */
function parseFieldTable(text) {
  const { rows, source } = tableRowsFromText(text);
  const fields = [];
  const errors = [];
  const warnings = [];
  let skipped = 0;
  const seen = new Set();

  if (!rows.length) {
    errors.push('未识别到表格内容，请确认已完整复制简道云「字段对照表」的表格（含表头）');
    return { fields, errors, warnings, skipped, source };
  }

  // 表头定位（可能前几行是说明文字）
  let headerIdx = -1;
  let colIdx = { name: 0, key: 1, type: 2, remark: 3 };
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const cells = rows[i].map(cleanCell);
    const h = detectHeader(cells);
    if (h.hit) {
      headerIdx = i;
      colIdx = {
        name: h.idx.name,
        key: h.idx.key,
        type: h.idx.type >= 0 ? h.idx.type : -1,
        remark: h.idx.remark >= 0 ? h.idx.remark : -1,
      };
      break;
    }
  }
  if (headerIdx < 0) {
    warnings.push('未找到表头，已按「字段名称 / 字段ID / 字段类型 / 说明」的默认列序解析，请核对结果');
  }

  const body = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;

  for (const row of body) {
    const cells = row.map(cleanCell);
    if (!cells.length) { skipped += 1; continue; }
    if (cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c))) { skipped += 1; continue; }

    let fieldName = (cells[colIdx.name] || '').trim();
    let fieldKey = (cells[colIdx.key] || '').trim();
    let fieldType = colIdx.type >= 0 ? (cells[colIdx.type] || '').trim() : '';
    let remark = colIdx.remark >= 0 ? (cells[colIdx.remark] || '').trim() : '';

    // ---- 容错 1：整行错位一格（字段名称位置是类型，字段ID位置是中文名称） ----
    if (looksLikeType(fieldName) && fieldKey && !FIELD_KEY_RE.test(fieldKey)) {
      const shiftedKey = String(cells[colIdx.key + 1] || '').trim();
      if (FIELD_KEY_RE.test(shiftedKey)) {
        remark = [fieldType, remark].filter(Boolean).join(' ').trim();
        fieldType = fieldName;
        fieldName = fieldKey;
        fieldKey = shiftedKey;
      }
    }

    // ---- 容错 2：字段名称位置为空但字段ID位置是中文 → 顺延一列 ----
    if (!fieldName && fieldKey && !FIELD_KEY_RE.test(fieldKey)) {
      const shiftedKey = String(cells[colIdx.key + 1] || '').trim();
      if (FIELD_KEY_RE.test(shiftedKey)) {
        fieldName = fieldKey;
        fieldKey = shiftedKey;
        fieldType = fieldType || String(cells[colIdx.key + 2] || '').trim();
      }
    }

    // ---- 校验：字段ID必须是合法键；字段名称不能是纯类型词 ----
    if (!fieldKey || !FIELD_KEY_RE.test(fieldKey)) { skipped += 1; continue; }
    if (!fieldName) { skipped += 1; continue; }
    if (looksLikeType(fieldName) && !SYSTEM_FIELDS[fieldKey]) { skipped += 1; continue; }

    // 类型归一
    let t = String(fieldType || '').toLowerCase();
    if (!FIELD_TYPES.includes(t)) {
      if (/^\d+(\.\d+)?$/.test(fieldType)) t = 'number';
      else t = 'string';
    }
    if (t === 'boolean') t = 'bool';

    if (seen.has(fieldKey)) {
      // 同名字段（简道云允许重名）保留第一个，其余跳过并提示
      warnings.push(`字段「${fieldName}」(${fieldKey}) 重复出现，已保留第一条`);
      skipped += 1;
      continue;
    }

    seen.add(fieldKey);
    fields.push({
      fieldName,
      fieldKey,
      fieldType: t,
      remark,
      isSystem: !!SYSTEM_FIELDS[fieldKey],
      parseMode: 'none',
      parsePath: null,
    });
  }

  if (!fields.length) {
    errors.push('未识别到有效字段行，请确认已完整复制简道云「字段对照表」的表格内容');
  }

  return { fields, errors, warnings, skipped, source };
}

/**
 * 已知的历史列名变体（用于兼容 1.x/2.x/3.x 自动登记产生的列，避免重复建列）
 *   1.x: _widget_1791449342204 → widget_1791449342204
 *   2.x: _widget_1791449342204 → w_1791449342204
 *   3.x: 系统字段重复登记     → sys_creator_2 / sys_creator_3 ...
 */
function legacyColumnCandidates(fieldKey) {
  const raw = String(fieldKey || '');
  const out = [];
  if (/^_widget_(\d+)$/.test(raw)) {
    const digits = raw.replace(/^_widget_/, '');
    out.push(`w_${digits}`, `widget_${digits}`, `_widget_${digits}`);
  }
  if (SYSTEM_FIELDS[raw]) {
    const base = SYSTEM_FIELDS[raw].column;
    out.push(base);
    for (let i = 2; i <= 9; i += 1) out.push(`${base}_${i}`);
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
    out.push(raw.toLowerCase(), raw.replace(/^_+/, ''));
  }
  return out;
}

/**
 * 去掉结尾的 _2 / _3 等「重复序号」后缀，得到列名基名。
 *
 * 注意：简道云控件列名形如 `w_1792131264427` / `widget_1792131264427`，
 * 末尾那串数字是**控件 ID**，不是重复序号。早先的实现直接 `replace(/_\d+$/, '')`
 * 会把它们统统削成 `w`，于是「地址」`w_1792131264427` 与后面新增的 13 个字段
 * （8 个流程时间 + SIC/销售门店数 + ERP名称 + 策略开通情况）被判为「同基名的重复列」，
 * 全部抢占了同一列 `w_1792131264427`，数据互相覆盖、且从未真正落库。
 *
 * 因此这里只剥离真正的重复后缀：
 *   - 剥掉后若基名仍以 _数字 结尾（如 `sys_creator_2_3`、`w_1792131264427` → `w`），不剥；
 *   - 基名是控件列前缀（w / widget / _widget），数字即控件 ID，不剥；
 *   - 其余（`sys_creator_2` → `sys_creator`）正常剥离。
 */
function stripDupSuffix(col) {
  const s = String(col || '');
  const m = s.match(/^(.*?)_(\d+)$/);
  if (!m) return s;
  const basePart = m[1];
  if (!basePart) return s;
  // 剥完还剩「基名_数字」→ 数字是标识的一部分（如 w_1792131264427）
  if (/_\d+$/.test(basePart)) return s;
  // 控件列前缀：数字是控件 ID
  if (/^(w|widget|_widget)$/i.test(basePart)) return s;
  return basePart;
}

/**
 * 在候选列中选出「实际承载数据」的那一个。
 *
 * 背景：同一字段在历史版本中被重复建列（widget_xxx 与 w_xxx、sys_creator 与
 * sys_creator_2/3/4 并存）。仅按固定顺序取第一个会选到空列，导致界面显示的
 * 字段/数据与原始表不一致。这里以「非空行数」为准择优，空列永不优先。
 *
 * @param {string[]} candidates 候选列名（按优先级从高到低）
 * @param {Set<string>} colSet 表中真实存在的列
 * @param {Object} stats { 列名: 非空行数 }
 */
function pickBestColumn(candidates, colSet, stats) {
  const st = stats || {};
  let best = null;
  let bestScore = -1;
  for (const cand of candidates) {
    if (!cand || !colSet.has(cand)) continue;
    const score = Number(st[cand] || 0);
    // 严格大于：并列时保留优先级更高（更靠前）的候选
    if (score > bestScore) { best = cand; bestScore = score; }
  }
  return best;
}

/**
 * 若表中已存在该字段的历史列，则复用，避免重复建列导致数据分裂。
 * 有数据统计时按非空行数择优；并列时按候选优先级（标准列 > 当前定义 > 历史变体）。
 */
function preferExistingColumn(fieldKey, proposed, existingColumns, columnStats) {
  if (!existingColumns) return proposed;
  const set = existingColumns instanceof Set ? existingColumns : new Set(existingColumns);
  if (set.size === 0) return proposed;

  const key = String(fieldKey || '');
  const sys = SYSTEM_FIELDS[key];
  const base = sys ? sys.column : null;

  const cands = [];
  const push = (c) => {
    if (!c) return;
    if (INTERNAL_COLUMNS.includes(c)) return;   // 内部列不可被业务字段占用
    // 解析列（xxx_p）存放加工后的可读值，不能被当作字段真值列复用
    if (isParsedColumn(c)) return;
    if (!cands.includes(c)) cands.push(c);
  };

  // 系统字段：标准列优先（formName→jdy_form_name，_id→jdy_data_id）
  if (base) push(base);
  push(proposed);
  legacyColumnCandidates(key).forEach(push);

  // 同基名的重复列（xxx_2 / xxx_3 ...）
  const bases = new Set([stripDupSuffix(proposed), base, stripDupSuffix(base || '')].filter(Boolean));
  set.forEach((col) => {
    if (bases.has(stripDupSuffix(col))) push(col);
  });

  if (columnStats) {
    const best = pickBestColumn(cands, set, columnStats);
    if (best) return best;
  }
  for (const cand of cands) {
    if (set.has(cand)) return cand;
  }
  return proposed;
}

/**
 * 为解析出的字段批量分配列名与推荐解析方式
 *
 * 列名决策优先级：
 *   1) 已有字段定义中记录的 column_name（保持稳定）
 *   2) 表中已存在的历史列名（按非空数据量择优，避免选中空列）
 *   3) 新生成的标准列名
 *
 * @param {Array} fields
 * @param {Array|Set} existingColumns 当前表中已存在的列名
 * @param {Object} existingDefs 已有字段定义 { fieldKey: {column_name} }
 * @param {Object} columnStats  列名 -> 非空行数（可选，用于择优选列）
 */
function decorateFields(fields, existingColumns, existingDefs, columnStats) {
  const colArr = existingColumns ? Array.from(existingColumns) : [];
  const colSet = new Set(colArr);
  const used = new Set(colArr);
  const defs = existingDefs || {};
  const stats = columnStats || null;

  return fields.map((f, i) => {
    const key = f.fieldKey || f.field_key;
    let columnName = f.columnName;

    const defined = defs[key] && defs[key].column_name;
    const definedUsable = defined && !INTERNAL_COLUMNS.includes(defined);

    // 统一走候选择优：已有定义仅作为「优先候选」，
    // 若表中另有同基名但数据更完整的列（历史重复建列），按真实数据量改选，
    // 避免界面展示空列 / 只有少量数据的分裂列。
    if (!columnName || INTERNAL_COLUMNS.includes(columnName)) {
      const proposed = definedUsable ? defined : columnForField(key, used);
      columnName = preferExistingColumn(key, proposed, colSet, stats);
    }

    used.add(columnName);

    const parseMode = canonicalMode(
      f.parseMode && f.parseMode !== 'none'
        ? f.parseMode
        : suggestParseMode(key, f.fieldType || f.field_type, f.remark)
    );

    return Object.assign({}, f, {
      fieldKey: key,
      columnName,
      parseMode: key === '_id' ? 'none' : parseMode,
      sortOrder: i,
    });
  });
}

/* ============ 值解析 ============ */

/** 按路径取值：a.b.c / a[0].b */
function getByPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((p) => p !== '');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function stringify(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

/** 成员状态的可读后缀 */
function memberStatusText(status) {
  const n = Number(status);
  if (n === -1) return '离职';
  if (n === 0) return '未加入';
  if (n === 1) return '';
  return '';
}

/** 安全地把值转成对象（字符串形式的 JSON 也尝试解析） */
function asObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        const o = JSON.parse(s);
        if (o && typeof o === 'object' && !Array.isArray(o)) return o;
      } catch (_) { /* ignore */ }
    }
  }
  return null;
}

/** 安全地把值转成数组（字符串形式的 JSON 数组也尝试解析） */
function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const a = JSON.parse(s);
        if (Array.isArray(a)) return a;
      } catch (_) { /* ignore */ }
    }
  }
  return null;
}

/** 子表单行 → 一行可读文本（跳过空值与嵌套对象） */
function subRowText(row) {
  const o = asObject(row);
  if (!o) return row === null || row === undefined ? '' : String(row);
  const prefer = [];
  const rest = [];
  Object.keys(o).forEach((k) => {
    // 子表单行的键就是 _widget_xxx，不能按前缀过滤；只跳过显式的行标识键
    if (k === '_id' || k === '_index' || k === 'row_index') return;
    const v = o[k];
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v)) {
      const names = v.map((x) => (asObject(x) || {}).name).filter(Boolean);
      if (names.length) prefer.push(names.join('、'));
      else {
        const sub = v.map((x) => subRowText(x)).filter(Boolean);
        if (sub.length) prefer.push(sub.join('、'));
      }
      return;
    }
    if (typeof v === 'object') {
      const inner = asObject(v);
      if (inner) {
        if (inner.name !== undefined && inner.name !== null && inner.name !== '') prefer.push(String(inner.name));
        else if (inner.text !== undefined && inner.text !== null && inner.text !== '') prefer.push(String(inner.text));
      }
      return;
    }
    rest.push(String(v));
  });
  const out = prefer.concat(rest).filter(Boolean);
  return out.join(' / ');
}

/**
 * 核心解析函数：把原始推送值加工为可读文本
 * @param {*} raw 原始值
 * @param {string} mode 解析方式（支持历史别名）
 * @param {string} path 自定义路径
 * @returns {string|null}
 */
function parseValue(raw, mode, path) {
  if (raw === null || raw === undefined || raw === '') return null;
  const m = canonicalMode(mode);

  try {
    switch (m) {
      case 'none':
        return stringify(raw);

      case 'name': {
        const arr = asArray(raw);
        if (arr) {
          return arr.map((x) => parseValue(x, 'name')).filter(Boolean).join('、') || null;
        }
        const o = asObject(raw);
        if (o) {
          if (o.name !== undefined && o.name !== null && o.name !== '') return String(o.name);
          if (o.text !== undefined && o.text !== null && o.text !== '') return String(o.text);
          if (o.value !== undefined && o.value !== null && o.value !== '') return String(o.value);
          return null;
        }
        return String(raw);
      }

      case 'username': {
        const arr = asArray(raw);
        if (arr) return arr.map((x) => parseValue(x, 'username')).filter(Boolean).join('、') || null;
        const o = asObject(raw);
        if (o) {
          if (o.username !== undefined && o.username !== null && o.username !== '') return String(o.username);
          if (o.name !== undefined && o.name !== null && o.name !== '') return String(o.name);
          return null;
        }
        return String(raw);
      }

      case 'phone': {
        const arr = asArray(raw);
        if (arr) return arr.map((x) => parseValue(x, 'phone')).filter(Boolean).join('、') || null;
        const o = asObject(raw);
        if (o) {
          const v = o.phone !== undefined ? o.phone : (o.text !== undefined ? o.text : o.value);
          if (v !== undefined && v !== null && v !== '') return String(v);
          if (o.name !== undefined && o.name !== null && o.name !== '') return String(o.name);
          return null;
        }
        return String(raw);
      }

      case 'id': {
        const arr = asArray(raw);
        if (arr) return arr.map((x) => parseValue(x, 'id')).filter(Boolean).join('、') || null;
        const o = asObject(raw);
        if (o) {
          const v = o._id !== undefined ? o._id
            : (o.id !== undefined ? o.id
              : (o.value !== undefined ? o.value : o.name));
          return v === undefined || v === null || v === '' ? null : String(v);
        }
        return String(raw);
      }

      case 'text': {
        const o = asObject(raw);
        if (o) {
          if (o.text !== undefined && o.text !== null && o.text !== '') return String(o.text);
          if (o.name !== undefined && o.name !== null && o.name !== '') return String(o.name);
          if (o.value !== undefined && o.value !== null && o.value !== '') return String(o.value);
          return null;
        }
        return String(raw);
      }

      case 'address': {
        const o = asObject(raw);
        if (o) {
          const parts = [o.province, o.city, o.district, o.detail]
            .map((x) => (x === null || x === undefined ? '' : String(x).trim()))
            .filter(Boolean);
          const s = parts.join('').trim();
          return s || null;
        }
        return String(raw);
      }

      case 'member_full': {
        const arr = asArray(raw);
        if (arr) return arr.map((x) => parseValue(x, 'member_full')).filter(Boolean).join('、') || null;
        const o = asObject(raw);
        if (o) {
          const name = o.name !== undefined && o.name !== null ? String(o.name)
            : (o.username ? String(o.username) : '');
          const account = o.username !== undefined && o.username !== null ? String(o.username) : '';
          const st = memberStatusText(o.status);
          let out = name;
          if (account && account !== name) out += `(${account})`;
          if (st) out += ` · ${st}`;
          return out || null;
        }
        return String(raw);
      }

      case 'array_join': {
        const arr = asArray(raw);
        if (arr) {
          const items = arr.map((x) => subRowText(x)).filter((s) => s !== '');
          /*
           * 分隔符口径：英文逗号（,）
           * --------------------------
           * 2026-10-28 业务对账结论：业务系统导出表的「基础资料」「渠道充值和余额」
           * 「已开通策略」「优惠券」等多值列统一用英文逗号分隔。
           * 历史实现使用中文分号「；」，导致与业务表 47 格不一致（separator 类差异）。
           */
          return items.join(',') || null;
        }
        // 非数组但为对象：当作单行子表处理
        const o = asObject(raw);
        if (o) return subRowText(o) || null;
        return stringify(raw);
      }

      case 'array_names': {
        const arr = asArray(raw);
        if (arr) {
          const names = arr.map((x) => {
            const o = asObject(x);
            if (o) {
              if (o.name !== undefined && o.name !== null && o.name !== '') return String(o.name);
              if (o.text !== undefined && o.text !== null && o.text !== '') return String(o.text);
              return subRowText(o);
            }
            return x === null || x === undefined ? '' : String(x);
          }).filter(Boolean);
          return names.join('、') || null;
        }
        return parseValue(raw, 'name');
      }

      case 'array_count': {
        const arr = asArray(raw);
        return String(arr ? arr.length : 0);
      }

      case 'timestamp': {
        const n = Number(raw);
        let d = null;
        if (Number.isFinite(n) && n > 0) {
          // 简道云时间戳为毫秒；兼容 10 位秒级
          d = new Date(n < 1e12 ? n * 1000 : n);
        } else if (typeof raw === 'string') {
          const s = raw.trim();
          // 纯数字字符串
          if (/^\d{10,13}$/.test(s)) {
            const num = Number(s);
            d = new Date(num < 1e12 ? num * 1000 : num);
          } else {
            const t = Date.parse(s.replace(' ', 'T'));
            if (!Number.isNaN(t)) d = new Date(t);
          }
        }
        if (!d || Number.isNaN(d.getTime())) return stringify(raw);
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
               `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      }

      case 'path': {
        const v = getByPath(raw, path);
        return stringify(v);
      }

      /**
       * 后缀拼接：取字段文本再拼上固定后缀。
       * 用于「标题」这类由简道云自动生成、推送报文里没有独立键的展示字段
       * （例如 连锁名称「XX大药房」→ 标题「XX大药房已签约智能体」）。
       */
      case 'suffix': {
        const base = parseValue(raw, 'text');
        if (base === null || base === undefined || base === '') return null;
        return `${base}${path || ''}`;
      }

      default:
        return stringify(raw);
    }
  } catch (_) {
    return stringify(raw);
  }
}

/** 判断某字段是否应展开为子表 */
function shouldExpand(field) {
  return field && field.parseMode === EXPAND_MODE;
}

/* ============ 字段定义持久化 ============ */

async function listFieldDefs(projectId) {
  return db.query(
    'SELECT * FROM jdywh_field_defs WHERE project_id = ? ORDER BY sort_order ASC, id ASC',
    [projectId]
  );
}

async function getFieldDefMap(projectId) {
  const rows = await listFieldDefs(projectId);
  const map = {};
  rows.forEach((r) => { map[r.field_key] = r; });
  return map;
}

/**
 * 派生字段：由另一个源字段按 parse_path 拆出（如地址对象 → 省/市/区，连锁名称 → 标题）。
 *
 * 这类字段不直接出现在推送报文的顶层，靠 def.source_key 指明去哪里取值。
 * 早先没有这个概念时，地址只能整段拼成一列，业务表需要的三列无从落地。
 */
async function listDerivedDefs(projectId) {
  const rows = await db.query(
    `SELECT * FROM jdywh_field_defs
      WHERE project_id = ? AND source_key IS NOT NULL AND source_key <> ''
      ORDER BY sort_order ASC, id ASC`,
    [projectId]
  );
  return rows;
}

/** 取派生字段的源字段键 */
function sourceKeyOf(def) {
  const s = def && def.source_key;
  return s && String(s).trim() ? String(s).trim() : null;
}

/**
 * 保存字段定义（整体覆盖式导入）
 * @param {number} projectId
 * @param {Array} fields 已 decorate 的字段数组
 * @param {{replace:boolean}} options
 */
async function saveFieldDefs(projectId, fields, options) {
  const opts = options || {};
  if (opts.replace) {
    await db.query('DELETE FROM jdywh_field_defs WHERE project_id = ?', [projectId]);
  }
  for (const f of fields) {
    await db.query(
      `INSERT INTO jdywh_field_defs
         (project_id, field_name, field_key, field_type, remark, column_name,
          parse_mode, parse_path, is_system, sort_order, enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?,1)
       ON DUPLICATE KEY UPDATE
         field_name = VALUES(field_name),
         field_type = VALUES(field_type),
         remark     = VALUES(remark),
         column_name= VALUES(column_name),
         parse_mode = VALUES(parse_mode),
         parse_path = VALUES(parse_path),
         is_system  = VALUES(is_system),
         sort_order = VALUES(sort_order),
         enabled    = 1`,
      [
        projectId,
        f.fieldName || f.field_name || f.fieldKey,
        f.fieldKey,
        f.fieldType || f.field_type || null,
        f.remark || null,
        f.columnName || f.column_name,
        canonicalMode(f.parseMode || f.parse_mode || 'none'),
        f.parsePath || f.parse_path || null,
        f.isSystem || f.is_system ? 1 : 0,
        f.sortOrder !== undefined ? f.sortOrder : (f.sort_order || 0),
      ]
    );
  }
  return listFieldDefs(projectId);
}

async function updateFieldDef(projectId, fieldKey, input) {
  const def = await db.queryOne(
    'SELECT * FROM jdywh_field_defs WHERE project_id = ? AND field_key = ? LIMIT 1',
    [projectId, fieldKey]
  );
  if (!def) throw new Error('字段不存在');

  const fields = [];
  const params = [];
  const set = (c, v) => { fields.push(`${c} = ?`); params.push(v); };

  if (input.fieldName !== undefined) set('field_name', String(input.fieldName).trim() || def.field_name);
  if (input.fieldType !== undefined) set('field_type', input.fieldType || null);
  if (input.remark !== undefined) set('remark', input.remark || null);
  if (input.parseMode !== undefined) set('parse_mode', canonicalMode(input.parseMode));
  if (input.parsePath !== undefined) set('parse_path', input.parsePath || null);
  if (input.enabled !== undefined) set('enabled', Number(input.enabled) ? 1 : 0);
  if (input.columnName !== undefined && String(input.columnName).trim()) {
    const col = sanitizeIdent(input.columnName, 'f');
    set('column_name', col);
  }

  if (!fields.length) return def;
  params.push(def.id);
  await db.query(`UPDATE jdywh_field_defs SET ${fields.join(', ')} WHERE id = ?`, params);
  return db.queryOne('SELECT * FROM jdywh_field_defs WHERE id = ?', [def.id]);
}

/** 批量设置解析方式 */
async function bulkSetParseMode(projectId, items) {
  let n = 0;
  for (const it of items || []) {
    await db.query(
      'UPDATE jdywh_field_defs SET parse_mode = ?, parse_path = ? WHERE project_id = ? AND field_key = ?',
      [canonicalMode(it.parseMode), it.parsePath || null, projectId, it.fieldKey]
    );
    n += 1;
  }
  return n;
}

/**
 * 历史配置矫正：把库里存的非标准解析方式（member_name/join/json_path...）
 * 统一改写为标准键，避免前端显示与实际行为不一致。
 * @returns {Promise<number>} 修正条数
 */
async function normalizeParseModes(projectId) {
  const rows = await db.query(
    'SELECT id, parse_mode FROM jdywh_field_defs WHERE project_id = ?',
    [projectId]
  );
  let fixed = 0;
  for (const r of rows) {
    const canon = canonicalMode(r.parse_mode);
    if (canon !== r.parse_mode) {
      await db.query('UPDATE jdywh_field_defs SET parse_mode = ? WHERE id = ?', [canon, r.id]);
      fixed += 1;
    }
  }
  return fixed;
}

/**
 * 校正已有的字段定义：
 *
 * ① 若定义中的 column_name 在表中不存在，但存在该字段的历史列名，则改指向历史列；
 * ② 若同字段存在多套历史列（widget_xxx 与 w_xxx、sys_creator 与 sys_creator_3 并存），
 *    按「非空行数」择优改指向，避免界面展示空列、原始表看起来「字段对不上」；
 * ③ 若 column_name 误指向内部列（例如 _id 被映射到自增主键 id），强制改到正确列。
 *
 * @param {number} projectId
 * @param {Array} existingColumns 表中实际存在的列名
 * @param {Object} columnStats 列名 -> 非空行数（可选）
 * @returns {Promise<number>} 修正的字段数
 */
async function reconcileFieldDefs(projectId, existingColumns, columnStats) {
  const colSet = new Set(existingColumns || []);
  const defs = await listFieldDefs(projectId);
  let fixed = 0;

  for (const d of defs) {
    const key = d.field_key;
    const cur = d.column_name || '';

    // ③ 内部列被业务字段占用 → 必须迁移
    const collidesInternal = INTERNAL_COLUMNS.includes(cur)
      || cur === 'jdy_form_name' || cur === 'jdy_data_id' || cur === 'raw_json';

    // ① / ② 当前列不存在，或存在同基名但更有数据的列
    const better = preferExistingColumn(key, collidesInternal ? '' : cur, colSet, columnStats);

    if (better && better !== cur) {
      await db.query('UPDATE jdywh_field_defs SET column_name = ? WHERE id = ?', [better, d.id]);
      fixed += 1;
    }
  }

  return fixed;
}

/**
 * 清理历史遗留的「垃圾字段定义」。
 *
 * 早期版本按行切分 Markdown 表格时，会把「说明」列里的字段类型/说明文字
 * 误当成字段名称与字段 ID 导入（如 field_name=字段类型 field_key=说明、
 * field_key=数据的唯一ID ...）。这里识别并删除这些定义，让用户重新导入。
 *
 * 判定规则：字段 ID 不像合法字段键（含中文/空格/JSON 片段），且该列无任何数据。
 *
 * @param {number} projectId
 * @param {Object} columnStats 列名 -> 非空行数
 * @returns {Promise<{removed:number, keys:string[]}>}
 */
async function purgeInvalidFieldDefs(projectId, columnStats) {
  const defs = await listFieldDefs(projectId);
  const stats = columnStats || {};
  const removed = [];

  for (const d of defs) {
    const key = String(d.field_key || '');
    if (FIELD_KEY_RE.test(key)) continue;               // 合法键，保留
    if (SYSTEM_FIELDS[key]) continue;
    const hasData = Number(stats[d.column_name] || 0) > 0;
    if (hasData) continue;                              // 有数据，保守保留
    await db.query('DELETE FROM jdywh_field_defs WHERE id = ?', [d.id]);
    removed.push(`${d.field_name || ''}(${key})`);
  }

  return { removed: removed.length, keys: removed };
}

/** 自动登记推送中出现但未定义的字段（无字段表时的兜底） */
async function autoRegisterFields(projectId, fieldKeys, existingMap, existingColumns) {
  const used = new Set(existingColumns || []);
  const added = [];
  let order = Object.keys(existingMap || {}).length;

  // 已被占用的列名（含已有定义），避免重复分配出 xxx_2
  Object.keys(existingMap || {}).forEach((k) => {
    if (existingMap[k] && existingMap[k].column_name) used.add(existingMap[k].column_name);
  });

  for (const key of fieldKeys) {
    if (existingMap && existingMap[key]) continue;
    let columnName = columnForField(key, used);
    // 复用历史列名
    columnName = preferExistingColumn(key, columnName, existingColumns);
    used.add(columnName);
    const isSystem = !!SYSTEM_FIELDS[key];
    const fieldName = isSystem ? SYSTEM_FIELDS[key].name : key;
    const fieldType = isSystem ? SYSTEM_FIELDS[key].type : 'string';
    const parseMode = isSystem ? suggestParseMode(key, fieldType, '') : 'none';
    await db.query(
      `INSERT INTO jdywh_field_defs
         (project_id, field_name, field_key, field_type, remark, column_name, parse_mode, is_system, sort_order, enabled)
       VALUES (?,?,?,?,NULL,?,?,?,?,1)
       ON DUPLICATE KEY UPDATE column_name = VALUES(column_name)`,
      [projectId, fieldName, key, fieldType, columnName, canonicalMode(parseMode), isSystem ? 1 : 0, order]
    );
    order += 1;
    added.push({ fieldKey: key, fieldName, columnName });
  }
  return added;
}

module.exports = {
  SYSTEM_FIELDS,
  INTERNAL_COLUMNS,
  PARSE_MODES,
  PARSE_MODE_MAP,
  PARSE_MODE_ALIASES,
  EXPAND_MODE,
  FIELD_KEY_RE,
  canonicalMode,
  suggestParseMode,
  columnForField,
  parsedColumnOf,
  isParsedColumn,
  legacyColumnCandidates,
  preferExistingColumn,
  reconcileFieldDefs,
  purgeInvalidFieldDefs,
  normalizeParseModes,
  parseFieldTable,
  decorateFields,
  parseValue,
  getByPath,
  shouldExpand,
  listFieldDefs,
  getFieldDefMap,
  listDerivedDefs,
  sourceKeyOf,
  saveFieldDefs,
  updateFieldDef,
  bulkSetParseMode,
  autoRegisterFields,
};
