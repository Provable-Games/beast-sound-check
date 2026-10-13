#!/usr/bin/env node
// Smoke test of index.html at a phone viewport (390x844) in Playwright Chromium and WebKit.
//   PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=chromium|webkit node smoke.mjs [tracks per section]
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const engine = process.env.PLAYWRIGHT_BROWSER || "chromium";
const browser = await pw[engine].launch({ env: process.env });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: engine !== "firefox" });
const errors = [], requests = [];
await ctx.addInitScript(() => {
  for (const k of ["AudioContext", "webkitAudioContext"]) {
    const A = window[k]; if (!A) continue;
    window[k] = new Proxy(A, { construct(t, a, nt) { const o = Reflect.construct(t, a, nt); (window.__acs ||= []).push(o); window.__ac = o; return o; } });
  }
});
await ctx.addInitScript(() => {
  const MM = window.MediaMetadata;
  if (MM) window.MediaMetadata = new Proxy(MM, { construct(t, a, nt) { (window.__mm ||= []).push(JSON.parse(JSON.stringify(a[0] || {}))); return Reflect.construct(t, a, nt); } });
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { (window.__media ||= []).push(this); return play.apply(this, arguments); };
});
ctx.on("request", (r) => { const u = r.url(); if (!/^(file|data|blob|about):/.test(u)) requests.push(u); });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e));
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`); };

const SITE = process.env.SITE || "../index.html", PREVIEW = true; // 0.7.0 pages always carry background audio and media controls
await page.goto("file://" + path.join(here, SITE));
console.log(engine, browser.version());
const n = await page.locator(".trk").count();
ok("track list renders", n > 50, `${n} tracks, ${await page.locator(".list details").count()} sections`);
const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
ok("no horizontal scroll", sw[0] <= sw[1], `scrollWidth ${sw[0]} / ${sw[1]}`);
ok("background audio checks in the global list", (await page.locator("[data-g^=bg]").count()) === 3);
ok("title", (await page.title()) === "Beast Sound Check", await page.title());
ok("one iframe loaded", (await page.locator("iframe").count()) === 1);
const t0 = await page.locator("#ttl").textContent();
await page.click("#next");
const t1 = await page.locator("#ttl").textContent();
ok("next changes track", t1 !== t0 && (await page.locator("#pos").textContent()).startsWith("2 /"), `${t0} -> ${t1}`);
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

// one track per section: load, play, stop
const per = Number(process.argv[2] || 1);
const sections = await page.evaluate(() => Array.from(document.querySelectorAll(".list details")).map((d) => Array.from(d.querySelectorAll(".trk")).map((b) => b.querySelector(".id").textContent)));
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
        // the play button sits inside the art frame (card 15,58 to 235,202), top-right, clear of the Beast box (62,66 to 190,194), about 24 card units across (clamped to 44-128 px)
        const pos = await frame.evaluate(() => { const b = document.getElementById("play").getBoundingClientRect(), W = innerWidth, H = innerHeight, k = Math.min(W / 250, H / 350), ox = (W - 250 * k) / 2, oy = (H - 350 * k) / 2; const m = (x, y) => [ox + x * k, oy + y * k]; const [fx0, fy0] = m(15, 58), [fx1, fy1] = m(235, 202), [bx0, by0] = m(62, 66), [bx1, by1] = m(190, 194); const cs = getComputedStyle(document.getElementById("play")), mn = parseFloat(cs.getPropertyValue("--play-min")), mx = parseFloat(cs.getPropertyValue("--play-max")), S = +(document.getElementById("beast-art").getAttribute("data-play-anchor") || "").split(/\s+/)[2]; const d = Math.max(mn, Math.min(mx, S * k)); const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2; return { b: [b.left, b.top, b.right, b.bottom].map((v) => +v.toFixed(1)), frame: [fx0, fy0, fx1, fy1].map((v) => +v.toFixed(1)), diam: +b.width.toFixed(1), want: +d.toFixed(1), inside: b.left >= fx0 - 1 && b.top >= fy0 - 1 && b.right <= fx1 + 1 && b.bottom <= fy1 + 1, tr: cx > (fx0 + fx1) / 2 && cy < (fy0 + fy1) / 2, clear: b.right <= bx0 + 0.5 || b.left >= bx1 - 0.5 || b.bottom <= by0 + 0.5 || b.top >= by1 - 0.5, overlap: +(Math.max(0, Math.min(b.right, bx1) - Math.max(b.left, bx0))).toFixed(1), clamped: S * k < mn, hit: (() => { const x = b.left - Math.max(1, (44 - b.width) / 2 - 2), y = (b.top + b.bottom) / 2, e = document.elementFromPoint(x, y); return b.width >= 44 || e === document.getElementById("play"); })(), k: +k.toFixed(3), sizeOk: Math.abs(b.width - d) <= 3 && Math.abs(b.height - d) <= 3 }; });
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
import zlib from "node:zlib";
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
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".trk")).find((x) => x.querySelector(".id").textContent === "1.03"); b.closest("details").open = true; b.click(); });
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

ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
ok("no network requests", requests.length === 0, requests.slice(0, 3).join(" | "));
await browser.close();
const bad = results.filter((r) => !r.pass);
console.log(`${engine}: ${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
