/**
 * agg_*.json 拆分优化工具
 *
 * 原始文件为单个超大 JSON 数组（agg_classified.json 605MB / agg_raw.json 478MB），
 * 浏览器与 Node 都无法一次性加载。本脚本按「月份」流式拆分为多个小文件，
 * 并生成索引与统计摘要，便于看板按需加载。
 *
 * 用法：
 *   node scripts/split-agg.js [--dir <数据目录>] [--out <输出目录>] [--chunk <每片记录数>]
 *
 * 输出结构：
 *   <out>/classified/index.json          索引（月份 → 文件、记录数、大小）
 *   <out>/classified/2025-04.json        按月分片
 *   <out>/classified/_summary.json       全局统计摘要（看板首屏用）
 *   <out>/raw/...
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ══════════ 参数 ══════════ */

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dir: process.cwd(), out: null, chunk: 20000 };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dir') out.dir = args[i + 1];
    else if (args[i] === '--out') out.out = args[i + 1];
    else if (args[i] === '--chunk') out.chunk = Number(args[i + 1]) || 20000;
  }
  out.out = out.out || path.join(out.dir, 'agg-split');
  return out;
}

/* ══════════ 流式 JSON 数组解析 ══════════ */

/**
 * 逐条解析顶层 JSON 数组，避免整体载入内存
 *
 * 关键点：跨 chunk 的对象必须完整保留。用「累积缓冲 + 已消费偏移」的方式，
 * 每次只把未消费完的尾部留在缓冲里，避免对象被切断。
 *
 * @param {string} file 文件路径
 * @param {(obj:object)=>void} onItem 每条记录的回调
 * @returns {Promise<number>} 解析成功的记录数
 */
function streamJsonArray(file, onItem) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 8 * 1024 * 1024 });

    let buf = '';
    let pos = 0;          // 当前扫描位置
    let depth = 0;        // 对象嵌套深度
    let inString = false;
    let escape = false;
    let objStart = -1;    // 当前对象起始位置
    let arrayStarted = false;
    let count = 0;

    const scan = () => {
      for (; pos < buf.length; pos += 1) {
        const ch = buf[pos];

        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }

        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (!arrayStarted) {
          if (ch === '[') arrayStarted = true;
          continue;
        }

        if (ch === '{') {
          if (depth === 0) objStart = pos;
          depth += 1;
        } else if (ch === '}') {
          depth -= 1;
          if (depth === 0 && objStart >= 0) {
            const text = buf.slice(objStart, pos + 1);
            try {
              onItem(JSON.parse(text));
              count += 1;
            } catch (err) {
              console.error(`[split] 第 ${count + 1} 条解析失败：${err.message}`);
            }
            objStart = -1;
          }
        }
      }
    };

    const compact = () => {
      // 只保留未完成对象的尾部
      if (objStart >= 0) {
        buf = buf.slice(objStart);
        pos = buf.length;
        objStart = 0;
      } else {
        buf = '';
        pos = 0;
      }
    };

    rs.on('data', (chunk) => {
      buf += chunk;
      scan();
      compact();
    });

    rs.on('end', () => {
      scan();
      resolve(count);
    });

    rs.on('error', reject);
  });
}

/* ══════════ 字段精简 ══════════ */

/** 去掉空值字段，减小体积 */
function compactObj(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v) && v.length === 0) return;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return;
    out[k] = v;
  });
  return out;
}

/** 数值字段转数字 */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/* ══════════ 拆分主流程 ══════════ */

async function splitFile(srcFile, outDir, label, transform, chunkSize) {
  if (!fs.existsSync(srcFile)) {
    console.log(`[skip] 文件不存在：${srcFile}`);
    return null;
  }

  const stat = fs.statSync(srcFile);
  console.log(`\n═══ 处理 ${label} ═══`);
  console.log(`  源文件：${path.basename(srcFile)}（${(stat.size / 1024 / 1024).toFixed(1)} MB）`);

  fs.mkdirSync(outDir, { recursive: true });

  const buckets = new Map();   // month -> { items: [], part: number }
  const monthCount = {};       // month -> 总记录数
  const fieldSet = new Set();
  let total = 0;

  const flush = (month) => {
    const b = buckets.get(month);
    if (!b || !b.items.length) return;
    const name = b.part === 0 ? `${month}.json` : `${month}-${b.part}.json`;
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(b.items), 'utf8');
    b.items = [];
    b.part += 1;
  };

  const count = await streamJsonArray(srcFile, (raw) => {
    const rec = transform(raw);
    const month = rec.月份 || 'unknown';

    if (!buckets.has(month)) buckets.set(month, { items: [], part: 0 });
    const b = buckets.get(month);
    b.items.push(rec);

    total += 1;
    monthCount[month] = (monthCount[month] || 0) + 1;
    Object.keys(rec).forEach((k) => fieldSet.add(k));

    if (b.items.length >= chunkSize) flush(month);
  });

  for (const month of Array.from(buckets.keys())) flush(month);

  const index = [];
  for (const month of Array.from(buckets.keys()).sort()) {
    const b = buckets.get(month);
    const files = [];
    for (let i = 0; i < b.part; i += 1) {
      const name = i === 0 ? `${month}.json` : `${month}-${i}.json`;
      const f = path.join(outDir, name);
      if (!fs.existsSync(f)) continue;
      files.push({ file: name, size: fs.statSync(f).size });
    }
    const size = files.reduce((s, f) => s + f.size, 0);
    index.push({
      month,
      files: files.map((f) => f.file),
      records: monthCount[month],
      size,
      sizeText: `${(size / 1024).toFixed(1)} KB`,
    });
  }

  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({
    label,
    totalRecords: total,
    monthCount: index.length,
    months: index,
    generatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  const summary = {
    label,
    source: path.basename(srcFile),
    sourceSize: stat.size,
    totalRecords: total,
    monthCount: index.length,
    months: monthCount,
    fields: Array.from(fieldSet),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(`  记录数：${total.toLocaleString()}`);
  console.log(`  月份数：${index.length}`);
  console.log(`  字段数：${fieldSet.size}`);
  console.log(`  分片数：${index.reduce((s, m) => s + m.files.length, 0)}`);
  console.log(`  输出：${outDir}`);

  return summary;
}

/* ══════════ 字段映射 ══════════ */

function transformClassified(r) {
  return compactObj({
    月份: r.月份,
    短信内容: r.短信内容 ? String(r.短信内容).slice(0, 300) : '',
    分类: r.分类 || '',
    触达次数: toNumber(r.触达次数),
    计费条数: toNumber(r.计费条数),
    人数: toNumber(r.人数),
    消费人数: toNumber(r.消费人数),
    消费次数: toNumber(r.消费次数),
    消费金额: toNumber(r.消费金额),
    健康卡会员数: toNumber(r.健康卡会员数),
    新会员触达: toNumber(r.新会员触达),
    新会员消费: toNumber(r.新会员消费),
    活跃会员触达: toNumber(r.活跃会员触达),
    活跃会员消费: toNumber(r.活跃会员消费),
    沉睡会员触达: toNumber(r.沉睡会员触达),
    沉睡会员消费: toNumber(r.沉睡会员消费),
    流失会员触达: toNumber(r.流失会员触达),
    流失会员消费: toNumber(r.流失会员消费),
    高净值触达: toNumber(r.高净值触达),
    高净值消费: toNumber(r.高净值消费),
    其他触达: toNumber(r.其他触达),
    其他消费: toNumber(r.其他消费),
  });
}

function transformRaw(r) {
  return compactObj({
    月份: r.ym,
    短信内容: r.sms ? String(r.sms).slice(0, 300) : '',
    触达次数: toNumber(r.c2_sends),
    计费条数: toNumber(r.c3_fee),
    人数: toNumber(r.c4_people),
    消费人数: toNumber(r.c5_conv),
    消费次数: toNumber(r.c6_orders),
    消费金额: toNumber(r.c7_amt),
    健康卡会员数: toNumber(r.c8_health),
    新会员触达: toNumber(r.c9_new_t),
    新会员消费: toNumber(r.c10_new_c),
    活跃会员触达: toNumber(r.c11_act_t),
    活跃会员消费: toNumber(r.c12_act_c),
    沉睡会员触达: toNumber(r.c13_slp_t),
    沉睡会员消费: toNumber(r.c14_slp_c),
    流失会员触达: toNumber(r.c15_lost_t),
    流失会员消费: toNumber(r.c16_lost_c),
    高净值触达: toNumber(r.c17_hnw_t),
    高净值消费: toNumber(r.c18_hnw_c),
    其他触达: toNumber(r.c19_oth_t),
    其他消费: toNumber(r.c20_oth_c),
  });
}

/* ══════════ 入口 ══════════ */

(async () => {
  const opts = parseArgs();
  console.log('════════ agg JSON 拆分工具 ════════');
  console.log('  数据目录：' + opts.dir);
  console.log('  输出目录：' + opts.out);
  console.log('  分片阈值：' + opts.chunk + ' 条/片');

  const started = Date.now();

  await splitFile(
    path.join(opts.dir, 'agg_classified.json'),
    path.join(opts.out, 'classified'),
    'classified',
    transformClassified,
    opts.chunk
  );

  await splitFile(
    path.join(opts.dir, 'agg_raw.json'),
    path.join(opts.out, 'raw'),
    'raw',
    transformRaw,
    opts.chunk
  );

  console.log(`\n完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
})().catch((err) => {
  console.error('拆分失败：', err);
  process.exit(1);
});
