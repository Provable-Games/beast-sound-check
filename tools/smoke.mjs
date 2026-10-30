#!/usr/bin/env node
// Smoke test of index.html at a phone viewport (390x844) in Playwright Chromium and WebKit, served over local http
// (the real Beasts need a secure context for crypto.subtle, which localhost is; a file:// page cannot fetch the set).
//   PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=chromium|webkit node smoke.mjs [tracks per section]
// Optional: PLAYWRIGHT_EXECUTABLE (the browser's launcher, where the default one cannot run), BEASTS3 (a beasts-v3
// checkout: each real Beast's GIF is also checked against its canonical genesis file), SHOTS (a directory for
// phone-width screenshots of the real-Beasts picker and the footer banner, light and dark).
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { openRenditionSet } from "./rendition_set.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const engine = process.env.PLAYWRIGHT_BROWSER || "chromium";

// a static server for the site (the .gz files go out as application/gzip with no Content-Encoding, as GitHub Pages sends them)
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".gz": "application/gzip", ".wav": "audio/wav" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
  const f = p.endsWith(path.sep) ? path.join(p, "index.html") : p;
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const SITE = process.env.SITE || "/index.html", URL0 = ORIGIN + SITE;

const browser = await pw[engine].launch({ env: process.env, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const newCtx = async (o = {}) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: engine !== "firefox", ...o });
  await c.addInitScript(() => {
    for (const k of ["AudioContext", "webkitAudioContext"]) {
      const A = window[k]; if (!A) continue;
      window[k] = new Proxy(A, { construct(t, a, nt) { const o = Reflect.construct(t, a, nt); (window.__acs ||= []).push(o); window.__ac = o; return o; } });
    }
  });
  await c.addInitScript(() => {
    const MM = window.MediaMetadata;
    if (MM) window.MediaMetadata = new Proxy(MM, { construct(t, a, nt) { (window.__mm ||= []).push(JSON.parse(JSON.stringify(a[0] || {}))); return Reflect.construct(t, a, nt); } });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { (window.__media ||= []).push(this); return play.apply(this, arguments); };
  });
  return c;
};
const ctx = await newCtx();
const errors = [], requests = [];
// the site's own files (the page and the rendition set) are the only requests allowed; the players make none
const allowed = (u) => u.startsWith(ORIGIN + "/index.html") || u === ORIGIN + "/" || u.startsWith(ORIGIN + "/renditions/");
ctx.on("request", (r) => { const u = r.url(); if (!/^(file|data|blob|about):/.test(u) && !allowed(u)) requests.push(u); });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e));
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`); };
const PREVIEW = true; // 0.7.0 pages always carry background audio and media controls

function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8); const d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === "IDAT") idat.push(d); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * bpp), stride = w * bpp;
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)]; for (let x = 0; x < stride; x++) {
    const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
    out[y * stride + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + (() => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })()) & 255; } }
  return { w, h, bpp, data: out };
}
const diffPx = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i += a.bpp) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 60) n++; return n; };

// ---- the real Beasts, as Node rebuilds them: the expected animation_url page of every token
const D0 = JSON.parse(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(ROOT, SITE), "utf8"))[1]);
const SETINFO = D0.sepolia.sets[0], FT = D0.sepolia.footers;
const SETDIR = path.join(ROOT, "renditions", SETINFO.dir);
const set = await openRenditionSet((p) => fs.readFileSync(path.join(SETDIR, p)));
const animationPage = (uri) => Buffer.from(JSON.parse(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8")).animation_url.split(",")[1], "base64");
const varOf = (t) => (t.kind === "genesis" ? "genesis" : "p" + t.visualEffects);
const tokOf = (sid, v) => set.manifest.tokens.find((t) => t.speciesId === sid && varOf(t) === v);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const gifOf = (html) => { const m = /<img id="beast-art"[^>]*src="data:image\/svg\+xml;base64,([^"]+)"/.exec(html); const svg = m ? Buffer.from(m[1], "base64").toString("utf8") : ""; const g = /data:image\/gif;base64,([A-Za-z0-9+/=]+)/.exec(svg); return g ? sha(Buffer.from(g[1], "base64")) : null; };
const genesisGif = process.env.BEASTS3 ? new Map(JSON.parse(fs.readFileSync(path.join(process.env.BEASTS3, "assets/genesis/manifest.json"), "utf8")).assets.filter((a) => a.mime === "image/gif").map((a) => [a.sha256, a])) : null;

await page.goto(URL0);
console.log(engine, browser.version(), "set", SETINFO.dir);
await page.waitForFunction(() => document.querySelectorAll("#species option").length === 75 && !!document.querySelector("#pw iframe"), null, { timeout: 30000 });
const n = await page.locator(".trk").count();
ok("track list renders: 75 species rows and the engine tests", n === 75 + D0.tracks.length, `${n} rows, ${await page.locator(".list details").count()} sections`);
const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
ok("no horizontal scroll", sw[0] <= sw[1], `scrollWidth ${sw[0]} / ${sw[1]}`);
ok("background audio checks in the global list", (await page.locator("[data-g^=bg]").count()) === 3);
ok("title", (await page.title()) === "Beast Sound Check", await page.title());
ok("one iframe loaded", (await page.locator("iframe").count()) === 1);
const start = await page.evaluate(() => ({ hash: location.hash, ttl: document.getElementById("ttl").textContent, kick: document.getElementById("kick").textContent, pos: document.getElementById("pos").textContent }));
ok("starts on the Genesis Warlock of the newest set", start.hash === "#beast-01-genesis" && /^Warlock · Genesis$/.test(start.ttl) && start.kick.includes(SETINFO.dir) && start.pos === `1 / ${SETINFO.tokens + D0.tracks.length}`, JSON.stringify(start));
ok("the set selector shows only when there is more than one set", (await page.isHidden("#setrow")) === (D0.sepolia.sets.length < 2), `${D0.sepolia.sets.length} set(s)`);
const t0 = await page.locator("#ttl").textContent();
await page.click("#next");
const t1 = await page.locator("#ttl").textContent();
ok("next changes track", t1 !== t0 && (await page.locator("#pos").textContent()).startsWith("2 /"), `${t0} -> ${t1}`);
await page.waitForSelector("#pw iframe", { timeout: 20000 }); // a real Beast mounts once its token_uri is rebuilt and checked
ok("still one iframe after next", (await page.locator("iframe").count()) === 1);
await page.click("#prev");
ok("prev returns", (await page.locator("#ttl").textContent()) === t0);
// pass/fail + notes persist
await page.click("#bp"); await page.fill("#note", "smoke note");
await page.click("#next"); await page.click("#bf"); await page.click("#prev");
ok("pass state kept", (await page.locator("#bp").getAttribute("aria-pressed")) === "true" && (await page.inputValue("#note")) === "smoke note");
// export (clipboard may be blocked: the fallback box shows the text)
await page.click("#export");
await page.waitForTimeout(300);
const exp = await page.evaluate(() => document.getElementById("exporttext").value + "|" + document.getElementById("toast").textContent);
ok("export produces a summary", /Pass 1, fail 1/.test(exp) || /Results copied/.test(exp), exp.slice(0, 80).replace(/\n/g, " "));
const stored = await page.evaluate((k) => { try { return localStorage.getItem(k); } catch (e) { return "blocked"; } }, await page.evaluate(() => "beast-sound-check-" + JSON.parse(document.getElementById("data").textContent).meta.playerVersion + "-v1"));
ok("localStorage written (or cleanly blocked)", stored === "blocked" || /smoke note/.test(stored || ""), stored === "blocked" ? "blocked" : "saved");
await page.click("#bp"); await page.fill("#note", ""); await page.click("#next"); await page.click("#bf"); await page.click("#prev"); // clear them again

// ---- section 1: real Beasts
const frameOf = async () => (await page.locator("#pw iframe").elementHandle()).contentFrame();
const srcdoc = () => page.evaluate(() => (document.querySelector("#pw iframe") || {}).srcdoc || null);
async function pick(sid, v) {
  await page.selectOption("#species", String(sid));
  await page.click(`[data-var=${v}]`);
  const tok = tokOf(sid, v);
  await page.waitForFunction((name) => { const f = document.querySelector("#pw iframe"); return f && f.title === "Player: " + name && f.srcdoc.length > 1000; }, tok.name, { timeout: 20000 });
  return tok;
}
async function playFor(f, seconds = 0.5) {
  await f.waitForSelector("#play:not([disabled])", { timeout: 20000 });
  await f.click("#play");
  await f.waitForFunction((s) => window.__ac && window.__ac.state === "running" && window.__ac.currentTime > s, seconds, { timeout: 15000 });
}
// screenshots of the Beast's box in the card (as stepTest below): how many times the art changes in `ms`
async function artChanges(ms, every = 150) {
  const box = await page.locator("#pw iframe").boundingBox();
  const sc = Math.min(box.width / 250, box.height / 350), ox = box.x + (box.width - 250 * sc) / 2, oy = box.y + (box.height - 350 * sc) / 2;
  const clip = { x: ox + 62 * sc, y: oy + 66 * sc, width: 126 * sc, height: 126 * sc };
  const shots = [], t = Date.now();
  while (Date.now() - t < ms) { shots.push(decodePng(await page.screenshot({ clip }))); await page.waitForTimeout(every); }
  let changes = 0; for (let i = 1; i < shots.length; i++) if (diffPx(shots[i - 1], shots[i]) > 40) changes++;
  return { changes, shots: shots.length };
}
{
  await page.locator("#sepolia").scrollIntoViewIfNeeded();
  const gifs = {};
  for (const [sid, v] of [[1, "genesis"], [1, "p0"], [1, "p1"], [1, "p2"], [1, "p3"], [75, "p0"], [75, "p3"]]) {
    const tok = await pick(sid, v);
    const want = animationPage(await set.tokenUri(tok.tokenId)), got = await srcdoc();
    const same = Buffer.from(got, "utf8").equals(want);
    await page.locator("#pw").scrollIntoViewIfNeeded();
    const f = await frameOf();
    const dom = await f.evaluate(() => ({ art: (document.getElementById("beast-art") || {}).localName, trusted: document.body.hasAttribute("data-trusted-art"), notes: document.querySelectorAll("script#beast-notes").length }));
    const gif = gifOf(got); gifs[`${sid}${v}`] = gif;
    const canon = genesisGif ? genesisGif.get(gif) : null;
    const artOk = !genesisGif || (!!canon && canon.speciesId === sid && canon.provider === (tok.shiny ? "shiny-gif" : "regular-gif"));
    const wantNotes = v === "genesis" || v === "p2" || v === "p3";
    const facts = await page.textContent("#facts");
    const factsOk = facts.includes(tok.tokenId) && facts.includes(String(set.manifest.blockNumber)) && facts.includes(tok.tempo.bpm + " BPM") && facts.includes(tok.name);
    let play = "";
    try { await playFor(f); play = "playing " + (await f.evaluate(() => window.__ac.currentTime.toFixed(2))) + " s"; await f.click("#play"); } catch (e) { play = "NOT playing: " + String(e).split("\n")[0]; }
    ok(`real Beast ${sid} ${v}: ${tok.name}`, same && dom.art === "img" && !dom.trusted && (dom.notes === 1) === wantNotes && tok.notes === wantNotes && artOk && factsOk && play.startsWith("playing"),
      `byte-identical ${same} (${want.length} B), art <${dom.art}> trusted ${dom.trusted}, notes ${dom.notes} (want ${wantNotes ? 1 : 0}), ${tok.shiny ? "shiny" : "regular"} GIF ${gif && gif.slice(0, 8)}${canon ? " = " + canon.source : ""}, facts ${factsOk}, ${play}`);
  }
  // shiny and regular: the shiny variants (Genesis, 1, 3) carry one GIF, the regular ones (0, 2) another
  ok("shiny vs regular art", gifs["1genesis"] === gifs["1p1"] && gifs["1p1"] === gifs["1p3"] && gifs["1p0"] === gifs["1p2"] && gifs["1p0"] !== gifs["1p1"] && gifs["75p0"] !== gifs["75p3"] && gifs["75p0"] !== gifs["1p0"], genesisGif ? "and each is the species' canonical genesis GIF" : "(set BEASTS3 to check the canonical files too)");
}

// ---- the page footer selector and the retimed GIF's speed, on a preset 0 Beast (no notes or rainbow behind the art)
const PERIODS = [];
{
  const tok = await pick(1, "p0");
  const deployedHtml = animationPage(await set.tokenUri(tok.tokenId)).toString("utf8");
  const dep = FT.deployed.text, RK = D0.sepolia.footerKeys.find((k) => k && FT[k].retimes);
  const Q = { ultraslow: 4, slow: 2, medium: 1, fast: 0.5, ultrafast: 0.25 }, tempoUs = tok.tempo.microsecondsPerQuarter;
  const shipped = tempoUs / 2 < 200000 ? "medium" : "fast";
  const POLICY = new RegExp(D0.sepolia.policy, "g");
  const withStep = (k) => (k === shipped ? FT[RK].text : FT[RK].text.replace(POLICY, (a, f, b) => `${f}=${b}=>Math.round(${b}*${Q[k]})`));
  ok("the deployed footer ends the page exactly once", deployedHtml.endsWith(dep) && deployedHtml.indexOf(dep) === deployedHtml.lastIndexOf(dep), `${FT.deployed.title}, ${dep.length} B`);
  ok("a retiming footer is offered, with its policy exactly once", !!RK && (FT[RK].text.match(POLICY) || []).length === 1 && D0.sepolia.footerKeys.join() === ",main", `${RK} ${FT[RK] && FT[RK].commit.slice(0, 7)}`);
  await page.locator("#pw").scrollIntoViewIfNeeded();
  const pauseRun = async () => {
    const f = await frameOf();
    await playFor(f, 1);
    await page.waitForTimeout(600);
    const playing = await artChanges(1200);
    await f.click("#play");
    await f.waitForFunction(() => window.__ac.state !== "running", null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const paused = await artChanges(2000);
    await f.click("#play");
    await f.waitForFunction(() => window.__ac.state === "running", null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const resumed = await artChanges(1500);
    const label = await f.getAttribute("#play", "aria-label");
    await f.click("#play");
    return { playing: playing.changes, paused: paused.changes, pausedShots: paused.shots, resumed: resumed.changes, label };
  };
  const speedState = () => page.evaluate(() => ({ dis: Array.from(document.querySelectorAll("[data-speed]")).map((b) => b.disabled), pressed: Array.from(document.querySelectorAll("[data-speed]")).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-speed")).join(","), why: document.getElementById("speedwhy").textContent, info: document.getElementById("artinfo").textContent, lbl: document.getElementById("speedlbl").textContent }));
  const asDeployed = await pauseRun();
  const banner0 = await page.isHidden("#ftbadge"), sp0 = await speedState();
  ok("as deployed: the page is the rebuilt animation_url, no banner, the GIF keeps moving while paused", (await srcdoc()) === deployedHtml && banner0 && asDeployed.playing > 0 && asDeployed.paused > 0 && asDeployed.resumed > 0,
    `art changes: playing ${asDeployed.playing}, paused ${asDeployed.paused} in 2 s (${asDeployed.pausedShots} shots), resumed ${asDeployed.resumed}`);
  ok("as deployed: the speed row is off, with the reason", sp0.dis.every(Boolean) && sp0.pressed === "" && /the deployed page doesn't retime its GIF/.test(sp0.why) && /GIF: \d+ ms per frame, on its own clock/.test(sp0.info), `${sp0.why} | ${sp0.info}`);
  // the retiming footer at the shipped step: upstream's file byte for byte
  await page.selectOption("#ftsel", RK);
  await page.waitForFunction(() => { const f = document.querySelector("#pw iframe"); return f && f.srcdoc.length > 1000; });
  const banner = await page.evaluate(() => !document.getElementById("ftbadge").hidden && document.getElementById("ftbadge").textContent), sp1 = await speedState();
  ok(`${FT[RK].label} footer at the shipped step: upstream's footer byte for byte, banner shows, speed row on`, (await srcdoc()) === deployedHtml.slice(0, -dep.length) + FT[RK].text && /not the deployed page\.$/.test(banner || "") && banner.includes(FT[RK].commit.slice(0, 7)) && sp1.dis.every((d) => !d) && sp1.pressed === shipped && /one GIF frame per/.test(sp1.lbl) && /Retimed GIF: .* per frame, one per eighth note \(Fast\); shipped: eighth note/.test(sp1.info) && /GIF's own: \d+ ms per frame/.test(sp1.info),
    `${banner} | ${sp1.info}`);
  const freeze = await pauseRun();
  ok(`${FT[RK].label} footer: the art freezes on pause (no change in 2 s) and animates after resume`, freeze.playing > 0 && freeze.paused === 0 && freeze.resumed > 0 && freeze.label === "Pause",
    `art changes: playing ${freeze.playing}, paused ${freeze.paused} in 2 s (${freeze.pausedShots} shots), resumed ${freeze.resumed}`);
  const checks = await page.textContent("#checks");
  ok("the art and pause checks follow the footer", /holds still/.test(checks) && /retimes it to the music: one frame per eighth note/.test(checks), checks.slice(checks.indexOf("Art:"), checks.indexOf("Art:") + 120));
  // The measured frame period at a step: screenshots of the Beast against the audible music position (as upstream's
  // page_check): each change of the art is timed at the middle of the window between the reads around it, and the period
  // is the slope of those times against the step each is nearest: the median of the slopes between every two
  // changes on different steps (Theil-Sen). Headless WebKit misplaces some frame changes of a GIF inside an SVG image
  // (extra changes between the real ones), which a least-squares slope follows and the median does not.
  const measure = async (step, ms) => {
    const f = await frameOf();
    await playFor(f, 1.2);
    await page.waitForTimeout(300);
    const box = await page.locator("#pw iframe").boundingBox();
    const sc = Math.min(box.width / 250, box.height / 350), ox = box.x + (box.width - 250 * sc) / 2, oy = box.y + (box.height - 350 * sc) / 2;
    const clip = { x: ox + 62 * sc, y: oy + 66 * sc, width: 126 * sc, height: 126 * sc };
    const pos = () => f.evaluate(() => window.OnchainMidiPlayer.getPlayStatus().positionSeconds);
    const samples = [], end = Date.now() + ms;
    while (Date.now() < end) { const p0 = await pos(); const img = decodePng(await page.screenshot({ clip })); samples.push({ p0, p1: await pos(), img }); }
    await f.click("#play");
    const all = [];
    for (let i = 1; i < samples.length; i++) { const a = samples[i - 1], s = samples[i]; if (diffPx(a.img, s.img) > 40) all.push({ t: (a.p0 + a.p1 + s.p0 + s.p1) / 4, window: s.p1 - a.p0 }); }
    const usual = all.map((c) => c.window).sort((x, y) => x - y)[all.length >> 1] || 0;
    const list = all.filter((c) => c.window <= Math.max(0.06, 1.5 * usual));
    if (list.length < 3) return { period: NaN, n: list.length, samples: samples.length };
    // steps counted from the first change, so the grid's phase (the display lead, the screenshot latency) cannot split
    // changes between two steps
    const k = list.map((c) => Math.round((c.t - list[0].t) / step)), slopes = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (k[j] !== k[i]) slopes.push((list[j].t - list[i].t) / (k[j] - k[i]));
    slopes.sort((x, y) => x - y);
    const period = slopes.length ? (slopes[(slopes.length - 1) >> 1] + slopes[slopes.length >> 1]) / 2 : NaN;
    return { period, n: list.length, samples: samples.length };
  };
  for (const [k, ms] of [[shipped, 8000], ["medium", 8000], ["slow", 10000]]) {
    if (k !== shipped) { await page.click(`[data-speed=${k}]`); await page.waitForFunction(() => { const f = document.querySelector("#pw iframe"); return f && f.srcdoc.length > 1000; }); }
    await page.locator("#pw").scrollIntoViewIfNeeded();
    const html = await srcdoc(), st = await speedState(), want = Math.round(tempoUs * Q[k]) / 1e6;
    const b = await page.evaluate(() => document.getElementById("ftbadge").textContent);
    const r = await measure(want, ms);
    const tol = Math.max(0.006, 0.02 * want);
    PERIODS.push({ engine, step: k, want: want * 1000, got: r.period * 1000, n: r.n });
    ok(`${FT[RK].label} footer at ${k}${k === shipped ? " (shipped)" : ""}: the policy ${k === shipped ? "untouched" : "replaced once"}, the GIF's measured period ${(want * 1000).toFixed(1)} ms`,
      html === deployedHtml.slice(0, -dep.length) + withStep(k) && st.pressed === k && (k === shipped ? !/not the shipped speed/.test(b) : new RegExp(`Animation speed: ${k === "slow" ? "Slow" : "Medium"} .*not the shipped speed\\.$`).test(b)) && Math.abs(r.period - want) < tol,
      `measured ${(r.period * 1000).toFixed(1)} ms from ${r.n} changes in ${r.samples} shots (want ${(want * 1000).toFixed(1)} ms, within ${(tol * 1000).toFixed(1)}) | ${st.info.slice(st.info.indexOf("Retimed"), st.info.indexOf(" GIF's own"))}`);
  }
  // Ultra fast is never under 2 cs in this set (its fastest tempo makes a sixteenth of 73 ms); the row says so when it is
  const fastest = Math.min(...set.manifest.tokens.map((t) => t.tempo.microsecondsPerQuarter));
  ok("Ultra fast stays at or above 2 cs a frame in this set", Math.round(fastest * 0.25) >= 20000 && !(await speedState()).dis[4], `fastest tempo ${(60e6 / fastest).toFixed(1)} BPM: a sixteenth is ${(fastest / 4000).toFixed(1)} ms`);
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(200);
      await page.locator(".speed").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 330));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(process.env.SHOTS, `${engine}-real-speed-row-${scheme}.png`) });
      await page.locator("#cur").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 8));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(process.env.SHOTS, `${engine}-footer-banner-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
  const sw3 = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok("no horizontal scroll with a real Beast, the footer banner and the speed row", sw3[0] <= sw3[1], `scrollWidth ${sw3[0]} / ${sw3[1]}`);
  // the rating records the set, block, token, name, preset, footer and speed (Slow is chosen now)
  await page.click("#bp"); await page.fill("#note", "slow note"); await page.locator("#note").blur();
  await page.evaluate(() => { try { if (navigator.clipboard) navigator.clipboard.writeText = (t) => { window.__clip = t; return Promise.resolve(); }; } catch (e) {} window.__clip = ""; });
  await page.click("#export"); await page.waitForTimeout(200);
  const ex = await page.evaluate(() => window.__clip || document.getElementById("exporttext").value);
  const line = ex.split("\n").find((x) => x.startsWith("PASS " + SETINFO.dir)) || "";
  const slowMs = +(Math.round(tempoUs * 2) / 1000).toFixed(1) + " ms";
  ok("export records set, block, token ID, name, preset, footer with its commit and the speed", line === `PASS ${SETINFO.dir} block ${set.manifest.blockNumber} token ${tok.tokenId} ${tok.name}, preset 0 (visual 0, sound 0) [footer: ${FT[RK].label}, onchain-midi-player ${FT[RK].commit.slice(0, 7)}; speed: retimed GIF Slow, one frame per half note, ${slowMs} (shipped: ${shipped === "fast" ? "eighth" : "quarter"} note)] - slow note`
    && /^Beasts on Sepolia \(real Beasts\)$/m.test(ex) && /real-Beast speed now: Slow/.test(ex) && /^Engine tests \(onchain-midi-player's reference Beast page\)$/m.test(ex) && new RegExp(`^Pass 1, fail 0, untested ${SETINFO.tokens - 1} of ${SETINFO.tokens}$`, "m").test(ex), line);
  // persistence: the footer, the speed, the Beast shown and its rating survive a reload
  await page.reload(); await page.waitForFunction(() => { const f = document.querySelector("#pw iframe"); return f && f.srcdoc.length > 1000 && document.querySelectorAll("#species option").length === 75; }, null, { timeout: 30000 });
  const kept = await page.evaluate(() => ({ ft: document.getElementById("ftsel").value, ttl: document.getElementById("ttl").textContent, bp: document.getElementById("bp").getAttribute("aria-pressed"), note: document.getElementById("note").value, banner: !document.getElementById("ftbadge").hidden, speed: Array.from(document.querySelectorAll("[data-speed]")).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-speed")).join() }));
  ok("real Beast, footer, speed and rating persist across a reload", kept.ft === RK && kept.speed === "slow" && kept.ttl.startsWith(tok.name) && kept.bp === "true" && kept.note === "slow note" && kept.banner && (await srcdoc()).endsWith(withStep("slow")), JSON.stringify(kept));
  await page.click("#bp"); await page.fill("#note", ""); await page.locator("#note").blur();
  // a saved footer that no longer exists (the merged PR #88's) falls back to As deployed
  await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("beast-sound-check-")); const o = JSON.parse(localStorage.getItem(k)); o.ft = "pr88"; localStorage.setItem(k, JSON.stringify(o)); });
  await page.reload(); await page.waitForFunction(() => { const f = document.querySelector("#pw iframe"); return f && f.srcdoc.length > 1000 && document.querySelectorAll("#species option").length === 75; }, null, { timeout: 30000 });
  ok("a saved footer that is gone (PR #88) falls back to As deployed", (await page.inputValue("#ftsel")) === "" && (await srcdoc()) === deployedHtml && (await page.isHidden("#ftbadge")) && (await speedState()).dis.every(Boolean));
  await page.click("#speedship");
  await page.waitForFunction(() => { const f = document.querySelector("#pw iframe"); return f && f.srcdoc.length > 1000; });
  ok("back to the shipped speed on a real Beast", (await page.isHidden("#speedship")) && (await srcdoc()) === deployedHtml);
  if (process.env.SHOTS) {
    await pick(1, "p3");
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(200);
      await page.locator("#sepolia").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 8));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(process.env.SHOTS, `${engine}-picker-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
}

// ---- a SHA-256 mismatch refuses to play, and a page without crypto.subtle says why
{
  const bad = tokOf(1, "p1");
  const p2 = await ctx.newPage();
  await p2.route("**/renditions/*/manifest.json", async (route) => {
    const r = await route.fetch(), m = await r.json();
    m.tokens.find((t) => t.tokenId === bad.tokenId).sha256 = "0".repeat(64);
    await route.fulfill({ response: r, body: JSON.stringify(m) });
  });
  await p2.goto(URL0 + "#beast-01-p1");
  await p2.waitForSelector("#pw .pwmsg.bad", { timeout: 30000 });
  const r = await p2.evaluate(() => ({ msg: document.querySelector("#pw .pwmsg.bad").textContent, frames: document.querySelectorAll("#pw iframe").length, ttl: document.getElementById("ttl").textContent }));
  ok("a SHA-256 mismatch shows an error and does not play", /SHA-256 check failed/.test(r.msg) && r.frames === 0 && r.ttl.startsWith(bad.name), r.msg.slice(0, 140));
  await p2.close();
  const c3 = await newCtx(); await c3.addInitScript(() => { try { Object.defineProperty(window.crypto, "subtle", { get: () => undefined }); } catch (e) {} });
  const p3 = await c3.newPage();
  await p3.goto(URL0); await p3.waitForSelector("#seperr:not([hidden])", { timeout: 20000 });
  await p3.waitForSelector("#pw iframe", { timeout: 20000 });
  const r3 = await p3.evaluate(() => ({ err: document.getElementById("seperr").textContent, kick: document.getElementById("kick").textContent, sel: document.getElementById("species").disabled }));
  ok("without crypto.subtle: a clear message, real Beasts off, the engine tests still load", /secure context/.test(r3.err) && /localhost/.test(r3.err) && r3.sel && r3.kick.startsWith("Engine test"), r3.err.slice(0, 120));
  await c3.close();
}

// ---- engine tests: one track per section (the first and the middle one): load, play, stop
const per = Number(process.argv[2] || 1);
const sections = await page.evaluate(() => Array.from(document.querySelectorAll(".list details")).slice(1).map((d) => Array.from(d.querySelectorAll(".trk")).map((b) => b.querySelector(".id").textContent)));
for (const ids of sections) {
  const picks = ids.slice(0, per);
  if (ids.length > per && per === 1) picks.push(ids[Math.floor(ids.length / 2)]);
  for (const id of picks) {
    const row = page.locator(".trk", { has: page.locator(".id", { hasText: new RegExp("^" + id.replace(".", "\\.") + "$") }) });
    await row.evaluate((b) => { b.closest("details").open = true; });
    await row.click();
    await page.waitForTimeout(150);
    const title = await page.locator("#ttl").textContent();
    await page.locator("#pw").scrollIntoViewIfNeeded();
    const handle = await page.locator("iframe").elementHandle();
    const frame = await handle.contentFrame();
    try {
      await frame.waitForSelector("#play:not([disabled])", { timeout: 20000 });
      const err = await frame.evaluate(() => (document.getElementById("error") || {}).textContent || "");
      await frame.click("#play");
      await frame.waitForFunction(() => window.__ac && window.__ac.state === "running", null, { timeout: 15000 });
      const label1 = await frame.getAttribute("#play", "aria-label");
      let mmInfo = "", artInfo = "";
      if (PREVIEW) {
        await frame.waitForFunction(() => (window.__media || []).length > 0 && (window.__mm || []).some((x) => x.artwork && x.artwork.length), null, { timeout: 8000 }).catch(() => {});
        const info = await frame.evaluate(() => ({ mm: window.__mm || null, hasMS: "mediaSession" in navigator, media: (window.__media || []).map((m) => ({ paused: m.paused, loop: m.loop, muted: m.muted, src: m.currentSrc.slice(0, 5), dur: m.duration })), as: navigator.audioSession ? navigator.audioSession.type : "n/a" }));
        const m = info.mm && (info.mm.filter((x) => x.artwork && x.artwork.length).pop() || info.mm.at(-1));
        const nMM = info.mm ? info.mm.length : 0;
        const art = m && m.artwork && m.artwork.find((a) => /^512x512/.test(a.sizes));
        let px = null;
        if (art) px = await frame.evaluate(async (src) => {
          const img = new Image(); img.src = src; await img.decode();
          const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
          const x = c.getContext("2d"); x.drawImage(img, 0, 0);
          const luma = (y) => { const d = x.getImageData(0, y, c.width, 1).data; let s = 0, n = 0, opaque = 0; for (let i = 0; i < d.length; i += 4) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; if (d[i + 3] === 255) opaque++; } return [s / n, opaque / n]; };
          return { w: img.naturalWidth, h: img.naturalHeight, top: luma(0), bottom: luma(c.height - 1), mid: luma(c.height >> 1) };
        }, art.src);
        if (!px || px.w !== 512 || px.h !== 512 || px.top[0] > 70 || px.bottom[0] > 70 || px.top[1] < 1 || px.bottom[1] < 1) throw new Error("artwork check failed: " + JSON.stringify(px));
        artInfo = ` | artwork ${px.w}x${px.h}, top luma ${px.top[0].toFixed(0)}, bottom luma ${px.bottom[0].toFixed(0)} (opaque ${px.top[1]}/${px.bottom[1]}), mid luma ${px.mid[0].toFixed(0)}`;
        const okMM = !!(m && m.title && m.artwork && m.artwork.length >= 1 && m.artwork.every((a) => a.src));
        const okAudio = info.media.length >= 1 && info.media[0].paused === false && info.media[0].loop === true;
        mmInfo = ` | mediaSession ${info.hasMS}, MediaMetadata x${nMM} ${okMM ? "ok" : "MISSING"} title=${JSON.stringify(m && m.title)} artwork=${m && m.artwork ? m.artwork.map((a) => a.sizes + " " + a.type).join(",") : "none"}, silent audio ${okAudio ? "playing+loop" : "NOT playing"} ${JSON.stringify(info.media[0] || null)}, audioSession.type=${info.as}${artInfo}`;
        // the play button sits inside the art frame (card 15,54 to 235,224), top-right, clear of the Beast box (45,59 to 205,219), about 24 card units across (clamped to 44-128 px)
        const pos = await frame.evaluate(() => { const b = document.getElementById("play").getBoundingClientRect(), W = innerWidth, H = innerHeight, k = Math.min(W / 250, H / 350), ox = (W - 250 * k) / 2, oy = (H - 350 * k) / 2; const m = (x, y) => [ox + x * k, oy + y * k]; const [fx0, fy0] = m(15, 54), [fx1, fy1] = m(235, 224), [bx0, by0] = m(45, 59), [bx1, by1] = m(205, 219); const cs = getComputedStyle(document.getElementById("play")), mn = parseFloat(cs.getPropertyValue("--play-min")), mx = parseFloat(cs.getPropertyValue("--play-max")), S = +(document.getElementById("beast-art").getAttribute("data-play-anchor") || "").split(/\s+/)[2]; const d = Math.max(mn, Math.min(mx, S * k)); const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2; return { b: [b.left, b.top, b.right, b.bottom].map((v) => +v.toFixed(1)), frame: [fx0, fy0, fx1, fy1].map((v) => +v.toFixed(1)), diam: +b.width.toFixed(1), want: +d.toFixed(1), inside: b.left >= fx0 - 1 && b.top >= fy0 - 1 && b.right <= fx1 + 1 && b.bottom <= fy1 + 1, tr: cx > (fx0 + fx1) / 2 && cy < (fy0 + fy1) / 2, clear: b.right <= bx0 + 0.5 || b.left >= bx1 - 0.5 || b.bottom <= by0 + 0.5 || b.top >= by1 - 0.5, overlap: +(Math.max(0, Math.min(b.right, bx1) - Math.max(b.left, bx0))).toFixed(1), clamped: S * k < mn, hit: (() => { const x = b.left - Math.max(1, (44 - b.width) / 2 - 2), y = (b.top + b.bottom) / 2, e = document.elementFromPoint(x, y); return b.width >= 44 || e === document.getElementById("play"); })(), k: +k.toFixed(3), sizeOk: Math.abs(b.width - d) <= 3 && Math.abs(b.height - d) <= 3 }; });
        const placed = pos.inside && pos.tr && (pos.clear || pos.clamped) && pos.sizeOk && pos.hit; // below k = 1.375 the 44 px minimum is wider than 32 card units, and below k = 0.98 wider than the 45 card units between the Beast box and the frame corner, so a small overlap is by design there
        mmInfo += ` | play button ${JSON.stringify(pos.b)} in frame ${JSON.stringify(pos.frame)}, diameter ${pos.diam} (want ${pos.want}): ${placed ? "inside, top-right, " + (pos.clear ? "clear of the Beast box" : "overlaps the Beast box by " + pos.overlap + " px (page limits " + mn + "-" + mx + " px, 44 px touch target " + (pos.hit ? "ok" : "MISSING") + ", scale " + pos.k + ")") : "NOT placed " + JSON.stringify(pos)}`;
        if (!placed) throw new Error("play button not at the anchor" + mmInfo);
        if (!okMM || !okAudio) throw new Error("background audio check failed" + mmInfo);
      }
      await frame.waitForFunction(() => window.__ac.currentTime > 0.5, null, { timeout: 8000 }).catch(() => {});
      const t = await frame.evaluate(() => window.__ac.currentTime);
      await frame.click("#play");
      const label2 = await frame.getAttribute("#play", "aria-label");
      ok(`${id} ${title}`, label1 === "Pause" && label2 === "Play" && t > 0.3 && !err, `ctx running, t=${t.toFixed(2)}s, labels ${label1}/${label2}${err ? ", error text: " + err : ""}${mmInfo}`);
    } catch (e) {
      ok(`${id} ${title}`, false, String(e).split("\n")[0]);
    }
  }
}

// ---- art toggle and sprite stepping (SMIL inside SVG-as-image)
async function stepTest(titlePrefix, wantFrames, play) {
  await page.evaluate((t) => { const b = Array.from(document.querySelectorAll(".trk")).find((x) => x.querySelector(".t").textContent.startsWith(t)); b.closest("details").open = true; b.click(); }, titlePrefix);
  await page.waitForTimeout(300);
  await page.locator("#pw").scrollIntoViewIfNeeded();
  const frame = await (await page.locator("iframe").elementHandle()).contentFrame();
  await frame.waitForSelector("#play:not([disabled])");
  if (play) { await frame.click("#play"); await frame.waitForFunction(() => window.__ac && window.__ac.state === "running"); }
  const box = await page.locator("iframe").boundingBox();
  const sc = Math.min(box.width / 250, box.height / 350), ox = box.x + (box.width - 250 * sc) / 2, oy = box.y + (box.height - 350 * sc) / 2;
  const clip = { x: ox + 62 * sc, y: oy + 66 * sc, width: 126 * sc, height: 126 * sc };
  const shots = [];
  for (let i = 0; i < 16; i++) { shots.push(decodePng(await page.screenshot({ clip }))); await page.waitForTimeout(90); }
  let changes = 0; for (let i = 1; i < shots.length; i++) if (diffPx(shots[i - 1], shots[i]) > 40) changes++;
  let distinct = 0; const seen = []; for (const sh of shots) if (!seen.some((o) => diffPx(o, sh) <= 40)) { seen.push(sh); distinct++; }
  if (play) await frame.click("#play");
  return { changes, distinct };
}
const artHtml = async () => { const f = await (await page.locator("iframe").elementHandle()).contentFrame(); await f.waitForSelector("#play:not([disabled])"); return f.evaluate(() => { const a = document.getElementById("beast-art"); return a.localName + "|" + a.outerHTML; }); };
const has = (h) => [h.includes("data:image/png"), h.includes("data:image/gif")];
// the engine tests' art: inline SVG on the reference page, Synced by default (an animated track at 120 BPM)
await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".trk")).find((x) => x.querySelector(".id").textContent === "2.03"); b.closest("details").open = true; b.click(); });
await page.waitForTimeout(300);
const a0 = await artHtml();
ok("trusted art is inline SVG", a0.startsWith("svg|"), a0.slice(0, 4));
const syncedHas = has(a0);
ok("default art is Synced (sprite PNG, no GIF)", syncedHas[0] && !syncedHas[1], JSON.stringify(syncedHas));
for (const [t, n] of [["Pulse 25% Lead (2)", 4], ["Pulse 12.5% Lead (1)", 3]]) {
  for (const play of [false, true]) {
    const r = await stepTest(t, n, play);
    ok(`sprite steps in the art <img> (${t}, ${n} frames, ${play ? "after play" : "idle"})`, r.distinct >= Math.min(n, 3) && r.changes >= 3, `${r.distinct} distinct sprite states, ${r.changes} changes in 16 shots`);
  }
}
await page.click("#aGif");
await page.waitForTimeout(300); const gifHas = has(await artHtml());
ok("Original GIF toggle swaps the art", !gifHas[0] && gifHas[1], JSON.stringify(gifHas));
await page.click("#aSync"); await page.check("#cardSync");
await page.waitForTimeout(300); const cs = ((await artHtml()).match(/gradientTransform[^>]*dur="([^"]*)"/) || [])[1];
ok("Card synced sets the rim to 16 beats", /^\d+(\.\d+)?s$/.test(cs) && cs !== "6s", cs);
await page.uncheck("#cardSync");

// ---- pause keeps the position, resume carries on, the inline art follows the music
{
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".trk")).find((x) => x.querySelector(".id").textContent === "2.03"); b.closest("details").open = true; b.click(); });
  await page.waitForTimeout(300); await page.locator("#pw").scrollIntoViewIfNeeded();
  const f = await (await page.locator("iframe").elementHandle()).contentFrame();
  await f.waitForSelector("#play:not([disabled])");
  await f.click("#play");
  await f.waitForFunction(() => { const s = window.OnchainMidiPlayer.getPlayStatus(); return s.state === "playing" && s.positionSeconds > 2; }, null, { timeout: 15000 });
  const drift = () => f.evaluate(() => { const s = window.OnchainMidiPlayer.getPlayStatus(), a = document.getElementById("beast-art"); let d = a.getCurrentTime() - (s.positionSeconds + 0.017); if (s.passSeconds) d -= Math.round(d / s.passSeconds) * s.passSeconds; return { pos: s.positionSeconds, drift: d, mon: window.OnchainArtMonitor }; });
  const d1 = await drift();
  ok("art follows the music while playing", Math.abs(d1.drift) < 0.1, `pos ${d1.pos.toFixed(2)}s, art-music ${(d1.drift * 1000).toFixed(0)} ms, monitor max ${(d1.mon.maxDrift * 1000).toFixed(0)} ms`);
  await f.click("#play");
  await f.waitForFunction(() => window.OnchainMidiPlayer.getPlayStatus().state === "paused" && window.__ac.state === "suspended", null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300); // the art freezes on the first animation frame that sees the suspended clock
  const p1 = await f.evaluate(() => [window.OnchainMidiPlayer.getPlayStatus(), document.getElementById("beast-art").animationsPaused(), document.getElementById("beast-art").getCurrentTime(), window.__ac.state]);
  await page.waitForTimeout(1200);
  const p2 = await f.evaluate(() => [window.OnchainMidiPlayer.getPlayStatus().positionSeconds, document.getElementById("beast-art").getCurrentTime()]);
  ok("pause holds the music and freezes the art", p1[0].state === "paused" && p1[3] === "suspended" && p1[1] && Math.abs(p2[0] - p1[0].positionSeconds) < 0.02 && Math.abs(p2[1] - p1[2]) < 0.02, `state ${p1[0].state}, audio ${p1[3]}, art paused ${p1[1]}, held at ${p1[0].positionSeconds?.toFixed(2)}s`);
  await f.click("#play");
  await f.waitForFunction(() => window.OnchainMidiPlayer.getPlayStatus().state === "playing" && window.__ac.state === "running", null, { timeout: 5000 });
  await page.waitForTimeout(800);
  const d2 = await drift();
  ok("resume carries on from the held point, art in step", d2.pos > p1[0].positionSeconds && d2.pos < p1[0].positionSeconds + 3 && Math.abs(d2.drift) < 0.1, `resumed at ${d2.pos.toFixed(2)}s (held ${p1[0].positionSeconds.toFixed(2)}s), art-music ${(d2.drift * 1000).toFixed(0)} ms`);
  await f.click("#play");
}

// ---- design lab: the page's button settings, overridden in the frame only, flagged and reset
{
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".trk")).find((x) => x.querySelector(".id").textContent === "2.01"); b.closest("details").open = true; b.click(); });
  const btn = async () => { await page.waitForTimeout(300); const f = await (await page.locator("iframe").elementHandle()).contentFrame(); await f.waitForSelector("#play:not([disabled])"); await page.waitForTimeout(200);
    return f.evaluate(() => { const b = document.getElementById("play").getBoundingClientRect(), x = b.left - 6, y = (b.top + b.bottom) / 2; return { d: Math.round(b.width), lab: !!document.getElementById("sound-check-lab"), hit6: document.elementFromPoint(x, y) === document.getElementById("play") }; }); };
  const ship = await btn();
  const set = (id, v) => page.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change")); }, [id, v]);
  await page.evaluate(() => { document.getElementById("lab").open = true; });
  await set("lmin", 24); await set("ltarget", 56);
  const lab = await btn();
  const badge = await page.evaluate(() => !document.getElementById("labbadge").hidden && document.getElementById("labbadge").textContent);
  // the export goes to the clipboard when allowed, else to the box: capture either
  await page.evaluate(() => { try { if (navigator.clipboard) navigator.clipboard.writeText = (t) => { window.__clip = t; return Promise.resolve(); }; } catch (e) {} });
  await page.click("#export"); await page.waitForTimeout(200);
  const exp = await page.evaluate(() => window.__clip || document.getElementById("exporttext").value);
  ok("design lab overrides the button settings in the frame, flagged", !ship.lab && lab.lab && lab.d === 24 && lab.hit6 && /not the shipped page/.test(badge || ""), `shipped ${ship.d} px, lab ${lab.d} px (target 56 px reaches 6 px outside: ${lab.hit6}), badge: ${badge}`);
  const said = await page.evaluate(() => +((/The button is (\d+) px/.exec(document.getElementById("lnow").textContent) || [])[1]));
  ok("lab readout states the drawn size", Math.abs(said - lab.d) <= 1, `readout ${said} px, drawn ${lab.d} px`);
  ok("export names the lab override", /Design lab override \(not the shipped page\): .*minimum 24 px/.test(exp));
  await set("lfix", 20);
  const fixed = await btn();
  const fixedSaid = await page.evaluate(() => document.getElementById("lnow").textContent);
  ok("lab fixed diameter sets the actual size", fixed.d === 20 && /The button is 20 px \(fixed\)/.test(fixedSaid), `${fixed.d} px | ${fixedSaid.slice(-60)}`);
  await page.click("#lreset");
  const back = await btn();
  await set("ls", 36);
  const prop = await btn();
  const propSaid = await page.evaluate(() => document.getElementById("lnow").textContent);
  ok("lab proportion re-anchors the art: the button follows S times the card's scale", Math.abs(prop.d - Math.round(36 * 0.937)) <= 1 && new RegExp("The button is " + prop.d + " px").test(propSaid), `${prop.d} px | ${propSaid.slice(0, 120)}`);
  await page.click("#lreset"); await btn();
  ok("reset returns to the shipped page", !back.lab && back.d === ship.d && (await page.evaluate(() => document.getElementById("labbadge").hidden)), `${back.d} px`);
}

// ---- animation speed: the Synced sprite's dur per note value, nothing else in the art changes, shipped by default
{
  const D = D0;
  const Q = { ultraslow: 4, slow: 2, medium: 1, fast: 0.5, ultrafast: 0.25 }; // quarter notes per frame
  const sec = (us) => (us / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""); // art.mjs
  const shipped = (a) => (a.tempoUs / 2 < 200000 ? "medium" : "fast"); // art.mjs frameUs: the eighth, or the quarter when the eighth is under 0.2 s
  const want = (a, k) => sec(Math.round(a.tempoUs * Q[k]) * a.frames);
  const SPRITE = /<animate attributeName='x' values='[^']*' dur='([0-9.]+)s' calcMode='discrete' repeatCount='indefinite'\/>/;
  const svgOf = (html) => { const m = /id="beast-art"[^>]*src="data:image\/svg\+xml;base64,([^"]+)"/.exec(html); return m ? Buffer.from(m[1], "base64").toString("latin1") : null; };
  const others = (svg) => (svg.match(/<animate(Transform)? [^>]*>/g) || []).filter((x) => !SPRITE.test(x));
  const byLabel = (l) => D.tracks.find((t) => t.sectionId + "." + t.id.slice(1) === l);
  // every animated track: the built Synced pages (with and without card sync) carry the shipped step's dur, and the policy
  // agrees with the frame length gen_tracks recorded
  const bad = [];
  for (const t of D.tracks) {
    if (!t.art.animated) continue;
    for (const v of [1, 2]) { const d = (SPRITE.exec(svgOf(t.pages[v].art)) || [])[1]; if (d !== want(t.art, shipped(t.art))) bad.push(`${t.id}/${v}: ${d} vs ${want(t.art, shipped(t.art))}`); }
    if (+(Math.round(t.art.tempoUs * Q[shipped(t.art)]) / 1000).toFixed(1) !== t.art.frameMs) bad.push(`${t.id}: frameMs ${t.art.frameMs}`);
  }
  ok("shipped step reproduces every built Synced dur", bad.length === 0, bad.length ? bad.slice(0, 3).join("; ") : `${D.tracks.filter((t) => t.art.animated).length} animated tracks x 2 variants`);
  const open = (l) => page.evaluate((l) => { const b = Array.from(document.querySelectorAll(".trk")).find((x) => x.querySelector(".id").textContent === l); b.closest("details").open = true; b.click(); }, l);
  const srcdoc = () => page.evaluate(() => document.querySelector("#pw iframe").srcdoc);
  const pressed = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-speed]")).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-speed")).join(","));
  const disabled = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-speed]")).map((b) => b.disabled));
  const liveDur = async () => { const f = await (await page.locator("iframe").elementHandle()).contentFrame(); await f.waitForSelector("#play:not([disabled])"); return f.evaluate(() => (document.querySelector("#beast-art animate[attributeName=x]") || { getAttribute: () => null }).getAttribute("dur")); };
  // two tracks at or below 150 BPM (2.03 at 120, 2.06 at exactly 150) and two above (2.07 and 3.01 at 175)
  for (const l of ["2.03", "2.06", "2.07", "3.01"]) {
    const t = byLabel(l), a = t.art, ship = shipped(a);
    await open(l); await page.waitForTimeout(200);
    const dflt = await pressed(), s0 = await srcdoc(), info = await page.textContent("#artinfo");
    ok(`speed ${l} (${a.bpm} BPM, ${a.frames} frames): default is the shipped step, page as built`, dflt === ship && s0.includes(t.pages[1].art) && (a.bpm > 150 ? ship === "medium" : ship === "fast") && info.includes("shipped: " + (ship === "fast" ? "eighth" : "quarter") + " note") && info.includes("GIF: " + a.gifMs[0]), `pressed ${dflt}, info: ${info.slice(info.indexOf("Synced:"), info.indexOf(" The song"))}`);
    for (const card of [false, true]) {
      if (card) await page.check("#cardSync"); else await page.uncheck("#cardSync");
      const v = card ? 2 : 1, built = svgOf(t.pages[v].art), builtDur = SPRITE.exec(built)[1];
      const res = [];
      for (const k of Object.keys(Q)) {
        await page.click(`[data-speed=${k}]`);
        const html = await srcdoc(), svg = svgOf(html), d = (SPRITE.exec(svg) || [])[1], live = await liveDur();
        const same = svg.replace(SPRITE, (m, x) => m.replace(`dur='${x}s'`, `dur='${builtDur}s'`)) === built; // everything but the sprite dur is the built art
        const ratio = Math.abs(d / builtDur - Q[k] / Q[ship]) < 2e-5;
        const keepCard = JSON.stringify(others(svg)) === JSON.stringify(others(built));
        const asBuilt = k !== ship || html.includes(t.pages[v].art);
        res.push({ k, d, live, pass: d === want(a, k) && live === d + "s" && same && ratio && keepCard && asBuilt && (await pressed()) === k });
      }
      ok(`speed ${l}${card ? " with card sync" : ""}: sprite dur per step, card animates unchanged`, res.every((r) => r.pass), res.map((r) => `${r.k} ${r.d}s${r.pass ? "" : " FAIL(live " + r.live + ")"}`).join(", ") + ` | card: ${others(built).map((x) => (/dur='([^']*)'/.exec(x) || [])[1]).join(" ")}`);
    }
    await page.uncheck("#cardSync");
    await page.click("#speedship");
  }
  // off in GIF mode (even with a step chosen) and on a static Beast
  await open("2.03"); await page.waitForTimeout(200);
  await page.click("[data-speed=slow]");
  await page.click("#aGif"); await page.waitForTimeout(200);
  const g = { dis: await disabled(), why: await page.textContent("#speedwhy"), as: (await srcdoc()).includes(byLabel("2.03").pages[0].art) };
  ok("speed is off for the original GIF", g.dis.every(Boolean) && /original GIF/.test(g.why) && g.as, `${JSON.stringify(g.dis)} | ${g.why}`);
  await page.click("#aSync");
  await open("2.04"); await page.waitForTimeout(200);
  const st = { dis: await disabled(), why: await page.textContent("#speedwhy"), as: (await srcdoc()).includes(byLabel("2.04").pages[1].art), pr: await pressed(), anim: byLabel("2.04").art.animated };
  ok("speed is off on a static PNG Beast", !st.anim && st.dis.every(Boolean) && /static PNG/.test(st.why) && st.as && st.pr === "", `${JSON.stringify(st.dis)} | ${st.why}`);
  // the export records the speed each result was rated with, and the setting survives a reload
  await open("2.07"); await page.waitForTimeout(200);
  if ((await page.getAttribute("#bp", "aria-pressed")) === "true") await page.click("#bp");
  await page.click("#bp");
  await page.evaluate(() => { try { if (navigator.clipboard) navigator.clipboard.writeText = (t) => { window.__clip = t; return Promise.resolve(); }; } catch (e) {} window.__clip = ""; });
  await page.click("#export"); await page.waitForTimeout(200);
  const ex = await page.evaluate(() => window.__clip || document.getElementById("exporttext").value);
  const line = ex.split("\n").find((x) => x.startsWith("PASS 2.07")) || "";
  ok("export records the speed a result was rated with", /\[Synced Slow, one frame per half note, 685\.7 ms \(shipped: quarter note\)\]/.test(line) && /Animation speed now: Slow/.test(ex), line);
  await page.click("#bp");
  await page.reload(); await page.waitForTimeout(300);
  ok("speed setting persists", (await pressed()) === "slow", await pressed());
  await page.goto(ORIGIN + SITE + "?speed=ultrafast#203"); await page.waitForTimeout(300);
  const u = (SPRITE.exec(svgOf(await srcdoc())) || [])[1];
  ok("?speed= selects a step", (await pressed()) === "ultrafast" && u === want(byLabel("2.03").art, "ultrafast"), `${await pressed()} ${u}s`);
  await page.click("#speedship");
  ok("back to the shipped speed", (await pressed()) === "fast" && (await srcdoc()).includes(byLabel("2.03").pages[1].art) && (await page.isHidden("#speedship")), await pressed());
  const sw2 = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok("no horizontal scroll with the speed row", sw2[0] <= sw2[1], `scrollWidth ${sw2[0]} / ${sw2[1]}`);
}

for (const r of PERIODS) console.log(`period ${r.engine} ${r.step}: want ${r.want.toFixed(1)} ms, measured ${r.got.toFixed(1)} ms (${r.n} changes)`);
ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
ok("no network requests", requests.length === 0, requests.slice(0, 3).join(" | "));
await browser.close();
server.close();
const bad = results.filter((r) => !r.pass);
console.log(`${engine}: ${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
