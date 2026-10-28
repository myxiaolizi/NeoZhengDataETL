/**
 * agg 分片二次优化：字段字典化 + 数值列式存储
 *
 * 拆分后的分片仍是「对象数组」，字段名在每个对象里重复出现，体积浪费明显。
 * 本脚本把每个分片转换为列式结构：
 *   { cols: ["月份","短信内容",...], rows: [[...],[...]] }
 * 字段名只出现一次，数值保持数字类型，体积可再降 40%+，且前端解析更快。
 *
 * 用法：
 *   node scripts/optimize-agg.js [--dir <agg-split 目录>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dir: null };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dir') out.dir = args[i + 1];
  }
  out.dir = out.dir || path.join(process.cwd(), 'agg-split');
  return out;
}

/** 把对象数组转为列式结构 */
function toColumnar(rows) {
  if (!rows.length) return { cols: [], rows: [] };

  // 收集所有字段（保持首次出现顺序）
  const cols = [];
  const seen = new Set();
  rows.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    });
  });

  const data = rows.map((r) => cols.map((c) => {
    const v = r[c];
    return v === undefined ? null : v;
  }));

  return { cols, rows: data };
}

/** 优化单个目录 */
function optimizeDir(dir) {
  const indexFile = path.join(dir, 'index.json');
  if (!fs.existsSync(indexFile)) {
    console.log(`[skip] 无索引：${dir}`);
    return null;
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  console.log(`\n═══ 优化 ${index.label} ═══`);

  let before = 0;
  let after = 0;
  let fileCount = 0;

  index.months.forEach((m) => {
    m.files.forEach((f) => {
      const src = path.join(dir, f);
      if (!fs.existsSync(src)) return;

      const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
      const sizeBefore = fs.statSync(src).size;
      before += sizeBefore;

      const columnar = toColumnar(raw);
      const dst = path.join(dir, f.replace(/\.json$/, '.col.json'));
      const text = JSON.stringify(columnar);
      fs.writeFileSync(dst, text, 'utf8');
      const sizeAfter = Buffer.byteLength(text, 'utf8');
      after += sizeAfter;
      fileCount += 1;

      // 删除原始分片
      fs.unlinkSync(src);
    });
  });

  // 更新索引：文件名改为 .col.json
  index.months.forEach((m) => {
    m.files = m.files.map((f) => f.replace(/\.json$/, '.col.json'));
    const size = m.files.reduce((s, f) => {
      const p = path.join(dir, f);
      return s + (fs.existsSync(p) ? fs.statSync(p).size : 0);
    }, 0);
    m.size = size;
    m.sizeText = `${(size / 1024).toFixed(1)} KB`;
  });
  index.format = 'columnar';
  index.optimizedAt = new Date().toISOString();
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf8');

  // 更新摘要
  const sumFile = path.join(dir, '_summary.json');
  if (fs.existsSync(sumFile)) {
    const sum = JSON.parse(fs.readFileSync(sumFile, 'utf8'));
    sum.format = 'columnar';
    sum.optimizedSize = after;
    sum.optimizedAt = index.optimizedAt;
    fs.writeFileSync(sumFile, JSON.stringify(sum, null, 2), 'utf8');
  }

  console.log(`  文件数：${fileCount}`);
  console.log(`  优化前：${(before / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  优化后：${(after / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  再压缩：${((1 - after / before) * 100).toFixed(1)}%`);

  return { before, after };
}

/* 入口 */
const opts = parseArgs();
console.log('════════ agg 分片列式优化 ════════');
console.log('  目录：' + opts.dir);

const started = Date.now();
let tb = 0;
let ta = 0;

['classified', 'raw'].forEach((label) => {
  const dir = path.join(opts.dir, label);
  const r = optimizeDir(dir);
  if (r) { tb += r.before; ta += r.after; }
});

console.log('\n════════ 汇总 ════════');
console.log(`  优化前合计：${(tb / 1024 / 1024).toFixed(1)} MB`);
console.log(`  优化后合计：${(ta / 1024 / 1024).toFixed(1)} MB`);
console.log(`  总压缩率：${((1 - ta / tb) * 100).toFixed(1)}%`);
console.log(`  耗时：${((Date.now() - started) / 1000).toFixed(1)} 秒`);
