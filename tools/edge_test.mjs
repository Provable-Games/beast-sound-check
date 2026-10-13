import { createRequire } from "node:module";
import * as A from "./art.mjs";
import zlib from "node:zlib";
// Texture-bleed test for the synced sprite, in the real card markup. The sheet holds n frames where the frame
// being shown is fully transparent and every neighbour is solid magenta; the card's Beast box is black, so any
// magenta pixel inside the 32x32 window is a neighbour's edge column bleeding in at a fractional pixel boundary.
// Rendered as an SVG-as-image like the page's art <img>, at several fractional zooms and device pixel ratios.
//   PLAYWRIGHT_CORE=... PLAYWRIGHT_BROWSER=chromium|webkit GUTTER=0|2 node edge_test.mjs
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const engine = process.env.PLAYWRIGHT_BROWSER || "chromium";
const GUT = Number(process.env.GUTTER ?? 2);
const beastOf_unused = (id) => ({ id, prefix: 1, suffix: 1, level: 20, health: 100, shiny: 0, animated: 1, tier: 3, beast_type: 0, rank: 0 });
const strings = (n) => ({ name: n, prefix: "A", suffix: "B", type: "Magic" });
function decode(buf) {
  let p = 8, w = 0, h = 0, ct = 6; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), t = buf.toString("latin1", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len); if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (t === "IDAT") idat.push(d); p += 12 + len; }
  const src = ct === 6 ? 4 : 3, bpp = src, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 4); const tmp = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)]; for (let x = 0; x < stride; x++) { const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? tmp[y * stride + x - bpp] : 0, b = y ? tmp[(y - 1) * stride + x] : 0, c = x >= bpp && y ? tmp[(y - 1) * stride + x - bpp] : 0; tmp[y * stride + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + (() => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })()) & 255; } }
  for (let i = 0; i < w * h; i++) { out[i * 4] = tmp[i * bpp]; out[i * 4 + 1] = tmp[i * bpp + 1]; out[i * 4 + 2] = tmp[i * bpp + 2]; out[i * 4 + 3] = bpp === 4 ? tmp[i * 4 + 3] : 255; }
  return { w, h, data: out };
}
const browser = await pw[engine].launch({ env: process.env });
const frameSolid = () => { const a = new Uint8Array(32 * 32 * 4); for (let i = 0; i < a.length; i += 4) { a[i] = 255; a[i + 1] = 0; a[i + 2] = 255; a[i + 3] = 255; } return a; };
const frameBlank = () => new Uint8Array(32 * 32 * 4);
const base = A.speciesArt(1, true);
let checks = 0, bad = 0, worst = 0; const hits = [];
for (const n of [2, 3, 4, 5, 6]) {
  for (const [dsf, css] of [[1, 1.37], [1, 1.83], [1, 2.41], [1.75, 1.0], [2.625, 1.0], [2.625, 1.31], [3, 1.17], [1.5, 1.6]]) {
    const ctx = await browser.newContext({ viewport: { width: Math.ceil(250 * css) + 20, height: Math.ceil(350 * css) + 20 }, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    for (let i = 0; i < n; i++) {
      const frames = Array.from({ length: n }, (_, k) => (k === i ? frameBlank() : frameSolid()));
      const png = A.spritePng({ w: 32, h: 32, frames }, GUT);
      const art = { ...base, n, gutter: GUT, pngUri: "data:image/png;base64," + png.toString("base64") };
      const svg = A.card({ beast: { id: 1, prefix: 1, suffix: 1, level: 20, health: 100, shiny: 0, animated: 1, tier: 3, beast_type: 0, rank: 0 }, art, tempoUs: 500000, mode: "synced", strings: { name: "T", prefix: "A", suffix: "B", type: "Magic" }, staticFrame: i });
      await page.setContent(`<body style="margin:0;background:#000"><img id=i style="display:block;width:${250 * css}px;height:${350 * css}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body>`);
      await page.waitForFunction(() => document.getElementById("i").complete);
      await page.waitForTimeout(60);
      // the whole viewport, read in device pixels: the columns/rows the window (62,66)-(190,194) touches, partial edge pixels included
      const shot = decode(await page.screenshot());
      const S = css * dsf, x0 = Math.floor(62 * S), x1 = Math.ceil(190 * S) - 1, y0 = Math.floor(66 * S), y1 = Math.ceil(194 * S) - 1;
      let m = 0, edge = "";
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = (y * shot.w + x) * 4; if (shot.data[k] > 40 && shot.data[k + 2] > 40 && shot.data[k + 1] < shot.data[k] * 0.6) { m++; if (!edge) edge = x === x0 ? "left" : x === x1 ? "right" : y === y0 ? "top" : y === y1 ? "bottom" : "inside"; } }
      checks++; worst = Math.max(worst, m); if (m) { bad++; hits.push(`n=${n} frame ${i + 1} dsf ${dsf} css ${css}: ${m} magenta px (${edge} edge)`); }
    }
    await ctx.close();
  }
}
hits.slice(0, 12).forEach((h) => console.log("  " + h));
console.log(`${engine} gutter ${GUT}: ${checks} frame/zoom checks, ${bad} with neighbour pixels inside the window (worst ${worst} px)`);
await browser.close();
