import { transformWithEsbuild } from "vite";
import fs from "fs";
const src = fs.readFileSync("src/pages/dashboard/board/RunMetrics.tsx","utf8");
try {
  const r = await transformWithEsbuild(src, "RunMetrics.tsx", { loader: "tsx", jsx: "automatic" });
  console.log("ESBUILD OK len=" + r.code.length);
} catch (e) {
  console.log("ESBUILD ERR:", e.message);
  const errs = e.errors || [];
  for (const er of errs.slice(0,5)) {
    console.log("  loc:", JSON.stringify(er.location && er.location.line) + " " + er.text);
    const line = er.location && er.location.line;
    if (line) { const ls = src.split("\n"); console.log("  ctx:", JSON.stringify(ls.slice(Math.max(0,line-2), line+2).join("\n"))); }
  }
}