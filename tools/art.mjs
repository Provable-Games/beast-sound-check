// Beast card art for the listening-test site: the real Beasts V3 card markup (beasts-v3's renderer fixtures,
// fixtures/renderer/*/raw.svg, the renderer's own output: a regular and a shiny card) with the Beast's own
// genesis art, animated (assets/genesis/{regular,shiny}-gif) or static ({regular,shiny}-png), plus the "synced"
// variant: the GIF decoded into one PNG sprite sheet, stepped by SMIL <animate calcMode='discrete'> at a
// beat-derived frame length (beasts-v3 issue 132). The card's art-frame background carries data-notes-bg, so
// the page draws the token's notes behind the Beast (beasts-v3 #218, onchain-midi-player's notes fragment).
import { createRequire } from "node:module";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { GifReader } = createRequire(import.meta.url)(path.join(here, "deps/node_modules/omggif"));
const B3 = process.env.BEASTS3 || "/workspace/beasts-v3";
const GENESIS = B3 + "/assets/genesis";
const fixture = (name) => fs.readFileSync(`${B3}/fixtures/renderer/${name}/raw.svg`, "utf8").replace(/\r?\n\s*/g, "");
const TEMPLATE = { regular: fixture("regular-animated-tier-4-rank-2-opaque-gif"), shiny: fixture("shiny-animated-tier-3-rank-1242-transparent-gif") };

const crc = (buf) => zlib.crc32(buf);
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td) >>> 0);
  return Buffer.concat([len, td, c]);
};

/** Decodes a GIF into full RGBA frames (disposal handled). */
export function decodeGif(buf) {
  const g = new GifReader(buf), w = g.width, h = g.height, n = g.numFrames();
  const canvas = new Uint8Array(w * h * 4), frames = [], delays = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const info = g.frameInfo(i);
    if (prev) {
      if (prev.disposal === 2) for (let y = prev.y; y < prev.y + prev.h; y++) canvas.fill(0, (y * w + prev.x) * 4, (y * w + prev.x + prev.w) * 4);
      else if (prev.disposal === 3 && prev.saved) canvas.set(prev.saved);
    }
    const saved = info.disposal === 3 ? canvas.slice() : null;
    g.decodeAndBlitFrameRGBA(i, canvas);
    frames.push(canvas.slice()); delays.push(info.delay);
    prev = { disposal: info.disposal, x: info.x, y: info.y, w: info.width, h: info.height, saved };
  }
  return { w, h, frames, delays };
}

/** An indexed (or RGBA if more than 256 colours) PNG of the frames side by side. */
// Cells of (w + 2g) x (h + 2g) with the frame centred in each: a transparent margin of g px around every frame (2g between
// neighbours), and a sheet whose width is a whole number of cell heights, so a player that slices a sheet into square frames
// by width / height (PR #57's media artwork) still finds n square cells.
export function spritePng({ w, h: h0, frames }, gutter = 0) {
  const h = h0 + 2 * gutter, n = frames.length, W = (w + 2 * gutter) * n, X0 = (f) => gutter + f * (w + 2 * gutter);
  const colors = new Map([[0, 0]]), idx = new Uint8Array(W * h), h1 = h0;
  let rgba = false;
  for (let f = 0; f < n && !rgba; f++) for (let y = 0; y < h1 && !rgba; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, px = frames[f];
    const k = px[o + 3] === 0 ? 0 : (px[o] << 24 | px[o + 1] << 16 | px[o + 2] << 8 | px[o + 3]) >>> 0 || 1;
    if (!colors.has(k)) { if (colors.size >= 256) { rgba = true; break; } colors.set(k, colors.size); }
    idx[(y + gutter) * W + X0(f) + x] = colors.get(k);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = rgba ? 6 : 3;
  let body, extra = [];
  if (!rgba) {
    const pal = Buffer.alloc(colors.size * 3), trns = Buffer.alloc(colors.size);
    for (const [k, i] of colors) { pal[i * 3] = k >>> 24; pal[i * 3 + 1] = (k >>> 16) & 255; pal[i * 3 + 2] = (k >>> 8) & 255; trns[i] = k === 0 ? 0 : k & 255; }
    extra = [chunk("PLTE", pal), chunk("tRNS", trns)];
    body = Buffer.alloc((W + 1) * h);
    for (let y = 0; y < h; y++) { body[y * (W + 1)] = 0; Buffer.from(idx.buffer, y * W, W).copy(body, y * (W + 1) + 1); }
  } else {
    body = Buffer.alloc((W * 4 + 1) * h);
    for (let y = 0; y < h1; y++) for (let f = 0; f < n; f++) Buffer.from(frames[f].buffer, y * w * 4, w * 4).copy(body, (y + gutter) * (W * 4 + 1) + 1 + X0(f) * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", zlib.deflateSync(body, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const cache = new Map();
/** Transparent gap, in source pixels, between sprite frames and around the sheet (stops texture bleed at fractional zoom). */
export let GUTTER = 2;
export const setGutter = (g) => { GUTTER = g; };
export function speciesArt(id, shiny, animated = true) {
  const key = id + (shiny ? "s" : "r") + (animated ? "a" : "p") + GUTTER;
  if (cache.has(key)) return cache.get(key);
  if (!animated) { // the static genesis PNG: one frame, shown as it is
    const dir = `${GENESIS}/${shiny ? "shiny" : "regular"}-png`;
    const file = fs.readdirSync(dir).find((f) => f.startsWith(String(id).padStart(2, "0") + "-"));
    const png = fs.readFileSync(`${dir}/${file}`);
    const r = { id, shiny, animated: false, file, gutter: GUTTER, n: 1, delays: [0], gif: null, gifUri: null, png, pngUri: "data:image/png;base64," + png.toString("base64") };
    cache.set(key, r); return r;
  }
  const dir = `${GENESIS}/${shiny ? "shiny" : "regular"}-gif`;
  const file = fs.readdirSync(dir).find((f) => f.startsWith(String(id).padStart(2, "0") + "-"));
  const gif = fs.readFileSync(`${dir}/${file}`);
  const d = decodeGif(gif);
  if (d.w !== 32 || d.h !== 32) throw new Error(`${file}: ${d.w}x${d.h}`);
  const png = spritePng(d, GUTTER);
  const r = { id, shiny, animated: true, file, gutter: GUTTER, n: d.frames.length, delays: d.delays, gif, png, gifUri: "data:image/gif;base64," + gif.toString("base64"), pngUri: "data:image/png;base64," + png.toString("base64") };
  cache.set(key, r); return r;
}

/** Frame length in microseconds at a quarter note of tempoUs: the eighth note, or the quarter note when the eighth would be under 0.2 s (above 150 BPM), for every frame count. */
export const frameUs = (n, tempoUs) => (tempoUs / 2 < 200000 ? tempoUs : Math.round(tempoUs / 2));
const sec = (us) => (us / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
const TIER_COLOR = ["#ffffff", "#ff8800", "#8c00bf", "#0000ff", "#00ff00", "#ffffff"];
const esc = (s) => String(s).replace(/[<>&']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;" }[c]));

const RANK_COLOR = ["#ffffff", "#e6c56e", "#c0c0c0", "#cd7f32"];
const PIXELATED = "image-rendering:pixelated; image-rendering:-moz-crisp-edges; -ms-interpolation-mode:nearest-neighbor;";

/**
 * The 250x350 Beasts card, from the renderer's own regular or shiny card. mode: "gif" (the genesis GIF in the
 * renderer's 160x160 art box, as it writes it today) or "synced" (sprite sheet stepped at the beat-derived frame
 * length). A static Beast (art.animated false) shows its PNG in both. cardSync (synced only) also sets the card's
 * own animations to beat multiples: rim 16 beats, opacity pulse 4 beats, logo 8.
 */
export function card({ beast, art, tempoUs, mode, cardSync = false, strings, mediaTitle = "", staticFrame = null }) {
  let s = beast.shiny ? TEMPLATE.shiny : TEMPLATE.regular;
  const sub = (re, rep) => { if (!re.test(s)) throw new Error("template: " + re); s = s.replace(re, rep); };
  if (!beast.shiny) sub(/(Z' )fill='#[0-9a-fA-F]{6}'/, `$1fill='${TIER_COLOR[beast.tier] || "#ffffff"}'`);
  const rankRe = /<text x='[0-9.]+' y='23\.96' text-anchor='end' class='label'[^>]*>RANK<\/text><text x='[0-9.]+' y='46' text-anchor='end' style='fill:#[0-9a-fA-F]{6};font-size:22px'>[0-9]+<\/text>/;
  if (!beast.rank) sub(rankRe, "");
  else sub(rankRe, (m) => m.replace(/style='fill:#[0-9a-fA-F]{6}/, `style='fill:${RANK_COLOR[beast.rank] || RANK_COLOR[0]}`).replace(/>[0-9]+<\/text>$/, `>${beast.rank}</text>`));
  const nameRe = /<text x='125\.5' y='22\.84'[^>]*>[^<]*<\/text><text x='125\.5' y='46'[^>]*>[^<]*<\/text>/;
  const title = esc(strings.name);
  if (beast.prefix || beast.suffix) {
    const pre = [strings.prefix, strings.suffix].filter(Boolean).join(" ");
    sub(nameRe, `<text x='125.5' y='22.84' text-anchor='middle' style='fill:#fff;font-size:14px;letter-spacing:1px'>"${esc(pre)}"</text><text x='125.5' y='46' text-anchor='middle' style='fill:#fff;font-size:30px;letter-spacing:1px'>${title}</text>`);
  } else sub(nameRe, `<text x='125.5' y='46' text-anchor='middle' style='fill:#fff;font-size:34px;letter-spacing:1px'>${title}</text>`);
  const vals = [String(beast.tier), String(beast.level), strings.type, String(beast.level * Math.max(1, 6 - beast.tier)), String(beast.health)];
  let k = 0;
  s = s.replace(/(class='valL'[^>]*>)[^<]*(<)/g, (_, a, b) => a + esc(vals[k++]) + b);
  if (k !== 5) throw new Error("template: valL count " + k);
  let image;
  if (!art.animated || mode === "gif") {
    const uri = art.animated ? art.gifUri : art.pngUri;
    image = `<foreignObject x='0' y='0' width='160' height='160'><xhtml:img xmlns:xhtml='http://www.w3.org/1999/xhtml' src='${uri}' style='width:100%;height:100%;${PIXELATED}'/></foreignObject>`;
  } else {
    // cell i is (32 + 2g) square with the frame centred (g px of transparent margin all round); the frame is shown by moving
    // the image so it sits exactly in the 32x32 window, which therefore never touches a neighbour's (or the sheet's) pixels
    const g = art.gutter ?? 0, step = 32 + 2 * g, W = step * art.n, H = 32 + 2 * g;
    const fl = frameUs(art.n, tempoUs), values = Array.from({ length: art.n }, (_, i) => -(g + i * step)).join(";");
    const anim = staticFrame === null ? `<animate attributeName='x' values='${values}' dur='${sec(fl * art.n)}s' calcMode='discrete' repeatCount='indefinite'/>` : "";
    const x0 = staticFrame === null ? 0 : -(g + staticFrame * step);
    image = `<svg x='0' y='0' width='160' height='160' viewBox='0 0 32 32'><image x='${x0}' y='${-g}' width='${W}' height='${H}' style='${PIXELATED}' href='${art.pngUri}'>${anim}</image></svg>`;
  }
  sub(/<foreignObject x='0' y='0' width='160' height='160'>[\s\S]*?<\/foreignObject>/, () => image);
  if (cardSync && mode === "synced" && art.animated) {
    s = s.replace(/(attributeName='gradientTransform'[^>]*?)dur='6s'/, `$1dur='${sec(tempoUs * 16)}s'`);
    sub(/(attributeName='opacity' dur=)'2.2s'/, `$1'${sec(tempoUs * 4)}s'`);
    sub(/(attributeName='opacity' values='0.6;1;0.6' )dur='3s'/, `$1dur='${sec(tempoUs * 8)}s'`);
  }
  // the renderer's play anchor: the top-right corner of the art frame (rect x=15 y=54 220x170), 24 card units across
  sub(/ data-play-anchor='([^']*)'/, (m, v) => ` data-play-anchor="${v}"`);
  // a <title> is what navigator.mediaSession shows; previews name the track
  sub(/<title>[^<]*<\/title>/, () => (mediaTitle ? `<title>${esc(mediaTitle)}</title>` : ""));
  return s;
}

/** The tempo (microseconds per quarter) of a MIDI's first FF 51 03 event, or 500000. */
export function midiTempoUs(midi) {
  for (let i = 0; i < midi.length - 5; i++) if (midi[i] === 0xff && midi[i + 1] === 0x51 && midi[i + 2] === 3) return (midi[i + 3] << 16) | (midi[i + 4] << 8) | midi[i + 5];
  return 500000;
}
