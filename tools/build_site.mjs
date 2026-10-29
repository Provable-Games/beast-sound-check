#!/usr/bin/env node
// Stage 2: tracks.json -> index.html (one file with no dependencies).
//   BEASTS3=<beasts-v3 checkout> OMP_MAIN=<onchain-midi-player checkout> OMP_PR88=<onchain-midi-player checkout> node build_site.mjs
// (run gen_tracks.mjs first; see its header for the repo checkouts)
//
// The engine tests (tracks.json) are embedded. The real Beasts (section 1, "Beasts on Sepolia") are not: the page
// fetches a rendition set from its own renditions/<deployment>/ path when it opens, rebuilds each token_uri with
// tools/rendition_set.mjs (embedded here as it is), checks its SHA-256 against the set's manifest and plays the
// token's animation_url byte for byte. Only a summary of each set (its directory, block and size) is baked in, so
// the page can choose the newest set (the highest block) and offer older ones.
//
// The "Page footer" selector splices another footer fragment into a real Beast's page. The alternatives are baked in
// with their commits:
//   BEASTS3   the deployed footer: beasts-v3's vendored assets/player-page/footer.html, checked against its
//             manifest's SHA-256 and against onchain-midi-player's file at the manifest's source revision
//   OMP_MAIN  onchain-midi-player at origin/main: examples/beast_consumer/fixtures/footer.html
//   OMP_PR88  onchain-midi-player at origin/feat/pause-freezes-img-art (PR #88): the same file
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(here, "tracks.json"), "utf8"));
const need = (k) => process.env[k] || (console.error(`set ${k} (see the header)`), process.exit(2));
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 1 << 26 });
const FOOTER = "examples/beast_consumer/fixtures/footer.html";

// The rendition sets in renditions/, newest (highest block) first.
const RENDITIONS = path.join(here, "..", "renditions");
const sets = (fs.existsSync(RENDITIONS) ? fs.readdirSync(RENDITIONS) : []).filter((d) => fs.existsSync(path.join(RENDITIONS, d, "manifest.json"))).map((dir) => {
  const m = JSON.parse(fs.readFileSync(path.join(RENDITIONS, dir, "manifest.json"), "utf8"));
  if (m.schema !== "beast-sound-check-renditions/v1" || m.schemaVersion !== 1) throw new Error(`renditions/${dir}: unsupported schema ${m.schema} ${m.schemaVersion}`);
  if (m.deployment !== dir) throw new Error(`renditions/${dir}: the manifest names deployment ${m.deployment}`);
  return { dir, network: m.network, chainId: m.chainId, blockNumber: m.blockNumber, generatedAt: m.generatedAt, tokens: m.tokens.length, tinysynth: m.contracts?.tinysynth?.version ?? "" };
}).sort((a, b) => b.blockNumber - a.blockNumber || (a.generatedAt < b.generatedAt ? 1 : -1));
if (!sets.length) throw new Error("no rendition set in renditions/ (see the README's Sepolia rendition sets)");

// The page footers: the deployed one (the real pages carry it) and the alternatives the selector splices in.
const footers = (() => {
  const B3 = need("BEASTS3"), main = need("OMP_MAIN"), pr88 = need("OMP_PR88");
  const pm = JSON.parse(fs.readFileSync(path.join(B3, "assets/player-page/manifest.json"), "utf8"));
  const deployed = fs.readFileSync(path.join(B3, pm.fragments.footer.path), "utf8");
  if (sha256(deployed) !== pm.fragments.footer.sha256 || Buffer.byteLength(deployed) !== pm.fragments.footer.bytes) throw new Error("beasts-v3's vendored footer differs from its manifest");
  if (git(main, "show", `${pm.source.revision}:${FOOTER}`) !== deployed) throw new Error(`beasts-v3's vendored footer differs from onchain-midi-player ${pm.source.revision}'s`);
  const at = (dir, label, title) => {
    const commit = git(dir, "rev-parse", "HEAD").trim(), text = fs.readFileSync(path.join(dir, FOOTER), "utf8");
    if (git(dir, "status", "--porcelain", "--", FOOTER).trim()) throw new Error(`${dir}: ${FOOTER} has local changes`);
    // every NFT-owned fragment is 9k bytes (both base64 layers stay on three-byte boundaries): an alternative keeps the page's layout
    if (Buffer.byteLength(text) % 9) throw new Error(`${dir}: ${FOOTER} is ${Buffer.byteLength(text)} bytes, not a multiple of 9`);
    return { label, title, commit, sha256: sha256(text), bytes: Buffer.byteLength(text), text };
  };
  return {
    deployed: { label: "As deployed", title: `Beasts' vendored footer, onchain-midi-player ${pm.source.revision.slice(0, 7)}`, commit: pm.source.revision, sha256: pm.fragments.footer.sha256, bytes: pm.fragments.footer.bytes, text: deployed },
    main: { ...at(main, "Upstream main", "onchain-midi-player origin/main"), sameAsEngineTests: null },
    pr88: at(pr88, "Pause-freeze PR #88", "onchain-midi-player origin/feat/pause-freezes-img-art"),
  };
})();
footers.main.sameAsEngineTests = footers.main.text === data.fixed.footer;
data.sepolia = { sets, footers };
// tools/rendition_set.mjs, as it is, runs in the page (its exports become local functions)
const LOADER = fs.readFileSync(path.join(here, "rendition_set.mjs"), "utf8").replace(/^export /gm, "");
if (/<\/script|<!--/i.test(LOADER)) throw new Error("rendition_set.mjs cannot be inlined in a <script>");
// JSON inside a <script type="application/json">: no "<" may survive (pages contain </script>).
const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(new RegExp("\\u2028", "g"), "\\u2028").replace(new RegExp("\\u2029", "g"), "\\u2029");

const V = data.meta.playerVersion;
const BANNER = "";
// Engine test (opt-in, off by default): injected into the NFT page's head ahead of the engine. It sets the
// AudioContext latency hint and the sequencer lookahead (preroll) for an A/B on a phone, optionally makes
// every oscillator's detune AudioParam k-rate, and paints a meter: Chrome's AudioContext.playbackStats
// underruns where available (Chrome 146+), the longest main-thread stall, and the settings in effect.
// M: { key, hint: null (as shipped: whatever the engine asks for) | "default" (no options) | "playback" |
// "balanced" | seconds, preroll: s | null (as shipped), k: true to make detune k-rate }.
// k-rate: the engine connects the CC1 modulation LFO to every oscillator's detune (chmod[ch].connect(o.detune)),
// which makes Chromium compute a per-sample exp2 for the phase increment; a k-rate detune computes it once per
// 128-frame quantum, so vibrato steps every 128 frames (about 2.7 ms at 48 kHz). Only OscillatorNode's detune can
// change: an AudioBufferSourceNode's detune and playbackRate are k-rate by the spec, so those nodes are
// wrapped too but read back k-rate in every mode. The engine makes all its nodes through
// AudioContext.createOscillator and createBufferSource, which the wrapper covers.
function engineTest(M) {
  "use strict";
  var W = window, R = W.AudioContext || W.webkitAudioContext, box = null;
  if (!R) return;
  var st = { ctx: null, pre: null, cap: "waiting for audio", now: null, under: 0, first: null, stall: 0, firstStall: null,
    hint: "?", ko: 0, kb: 0, kfail: 0, kread: null, dread: null };
  var makeOsc = R.prototype.createOscillator;
  function kRate(n, kind) {
    try { n.detune.automationRate = "k-rate"; st[kind]++; if (kind === "ko" && st.kread === null) st.kread = n.detune.automationRate; }
    catch (e) { st.kfail++; }
    return n;
  }
  if (M.k) [["createOscillator", "ko"], ["createBufferSource", "kb"]].forEach(function (x) {
    var f = R.prototype[x[0]];
    if (typeof f === "function") R.prototype[x[0]] = function () { return kRate(f.apply(this, arguments), x[1]); };
  });
  function A(o) {
    var c;
    if (M.hint === null) { c = o === undefined ? new R() : new R(o); st.hint = o && o.latencyHint !== undefined ? o.latencyHint + " (the engine's own)" : "default"; }
    else if (M.hint === "default") { c = new R(); st.hint = "default"; }
    else {
      try { c = new R({ latencyHint: M.hint }); st.hint = M.hint + (typeof M.hint === "number" ? " s" : ""); }
      catch (e) { c = new R(); st.hint = "default (" + M.hint + " was rejected)"; }
    }
    if (!st.ctx) {
      st.ctx = c; watch(c);
      // the detune rate a plain oscillator has here (not through the k-rate wrapper)
      try { st.dread = makeOsc.call(c).detune.automationRate; } catch (e) { /* no automationRate */ }
    }
    return c;
  }
  A.prototype = R.prototype;
  W.AudioContext = A;
  if (W.webkitAudioContext) W.webkitAudioContext = A;
  var real;
  Object.defineProperty(W, "WebAudioTinySynth", { configurable: true, enumerable: true, set: function (v) { real = v; },
    get: function () { return real && function (o) { var s = new real(o); if (M.preroll !== null) s.preroll = M.preroll; st.pre = s.preroll; paint(); return s; }; } });
  function at() { return st.ctx ? st.ctx.currentTime : 0; }
  function watch(c) {
    // AudioContext.playbackStats (Chrome 146+): cumulative underrun events and duration; renderCapacity is not shipped
    st.cap = c.playbackStats ? "on" : "not available in this browser (needs Chrome 146+)";
    var last = performance.now();
    setInterval(function () {
      var p = performance.now(), gap = p - last - 100; last = p;
      if (c.state === "running") { if (gap > st.stall) st.stall = gap; if (gap > 150 && st.firstStall === null) st.firstStall = at(); }
      var ps = c.playbackStats;
      if (ps) { st.under = ps.underrunEvents; st.now = ps.underrunDuration; if (ps.underrunEvents > 0 && st.first === null) st.first = at(); }
      paint();
    }, 100);
  }
  function ms(x) { return typeof x === "number" ? (x * 1000).toFixed(1) + " ms" : "n/a"; }
  function detuneLine() {
    if (!M.k) return "detune rate: " + (typeof st.dread === "string" ? st.dread + " (the default, not changed)" : "n/a (no automationRate in this browser)");
    var n = st.ko + st.kb;
    return "detune rate: k-rate requested; set on " + st.ko + " oscillators, " + st.kb + " buffer sources" + (st.kfail ? ", " + st.kfail + " failed" : "") +
      (st.kread !== null ? "; an engine oscillator reads back " + st.kread : n || st.kfail ? "" : "; no node made yet");
  }
  function paint() {
    if (!document.body) return;
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;left:4px;top:4px;z-index:2147483647;font:11px/1.35 monospace;color:#fff;background:rgba(0,0,0,.75);padding:4px 6px;border-radius:4px;pointer-events:none;white-space:pre";
      document.body.appendChild(box);
    }
    var c = st.ctx;
    box.textContent = [
      "engine test: " + M.key,
      c ? "audio clock " + c.currentTime.toFixed(1) + " s, " + c.state + ", " + c.sampleRate + " Hz" : "audio not started",
      c ? "latency hint " + st.hint : "",
      c ? "base latency " + ms(c.baseLatency) + (typeof c.baseLatency === "number" ? " = " + Math.round(c.baseLatency * c.sampleRate) + " frames" : "") : "",
      c ? "output latency " + ms(c.outputLatency) : "",
      "lookahead " + (st.pre === null ? "?" : st.pre + " s"),
      c ? detuneLine() : "",
      "underruns: " + (st.cap === "on" ? st.under + " (" + ms(st.now) + " in all)" : st.cap),
      st.cap === "on" ? "first underrun " + (st.first === null ? "none" : "at about " + st.first.toFixed(1) + " s") : "",
      "longest main-thread stall " + Math.round(st.stall) + " ms" + (st.firstStall === null ? "" : ", first over 150 ms at " + st.firstStall.toFixed(1) + " s"),
    ].filter(Boolean).join("\n");
  }
  document.addEventListener("DOMContentLoaded", paint);
}
const ENGINE_TEST = engineTest.toString();

const BGBLOCK = `
  <div class="bgblock"><b>Background audio checks</b> (player ${V})</div>
  <label><input type="checkbox" data-g="bgandroid"><span><b>Android.</b> After play, the notification and Media Output show the Beast's frames side by side (a filmstrip), the whole Beast visible with no cropped face, with the track title. Pause and play work from the notification, and the lock screen controls work. Audio keeps playing with the screen locked.</span></label>
  <label><input type="checkbox" data-g="bgios"><span><b>iOS.</b> It plays with the silent switch on, and Now Playing on the lock screen shows the track with working play and pause.</span></label>
  <label><input type="checkbox" data-g="bgdesktop"><span><b>Desktop.</b> The browser's media hub or media keys show the track and its art, and pause and play from there match what you hear.</span></label>`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Beast Sound Check</title>
<meta name="color-scheme" content="light dark">
<style>
:root{
  --bg:#f5f3ee; --surface:#ffffff; --surface2:#ebe8e0; --text:#1d1b17; --muted:#625d52; --line:#d4cfc2;
  --accent:#1f5fbf; --accent-text:#ffffff; --pass:#1c7a3c; --fail:#b3261e; --warn:#8a5a00;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#141311; --surface:#1f1d1a; --surface2:#2a2723; --text:#ece8df; --muted:#a39d90; --line:#3a362f;
    --accent:#6aa3ff; --accent-text:#07101f; --pass:#58c27a; --fail:#ff7b72; --warn:#e0b054;
  }
}
:root[data-theme="dark"]{
  --bg:#141311; --surface:#1f1d1a; --surface2:#2a2723; --text:#ece8df; --muted:#a39d90; --line:#3a362f;
  --accent:#6aa3ff; --accent-text:#07101f; --pass:#58c27a; --fail:#ff7b72; --warn:#e0b054;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  padding:0 16px calc(84px + env(safe-area-inset-bottom));overflow-x:hidden}
main{max-width:640px;margin:0 auto}
h1{font-size:22px;margin:18px 0 4px}
h2{font-size:19px;margin:0 0 6px;line-height:1.25}
#ttl{background:color-mix(in srgb,var(--accent) 12%,transparent);border-left:4px solid var(--accent);border-radius:6px;padding:6px 10px;margin:4px 0 8px;font-size:20px}
p{margin:0 0 10px}
.muted{color:var(--muted);font-size:14px}
button,textarea{font:inherit;color:inherit}
button{min-height:48px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);cursor:pointer;touch-action:manipulation}
button:active{background:var(--surface2)}
button:focus-visible,summary:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}
details.card>summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center;list-style-position:inside}
.global label{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line);min-height:48px}
.global input[type=checkbox]{width:24px;height:24px;flex:none;margin-top:2px}
.checks{margin:8px 0 0;padding-left:20px}
.checks li{margin:0 0 7px}
.kicker{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.playerwrap{scroll-margin:12px 0 96px;position:relative;width:100%;aspect-ratio:1/1;max-height:62vh;margin:10px auto;background:#000;border-radius:12px;overflow:hidden}
.playerwrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}
.hint{font-size:13px;color:var(--muted);margin:0 0 6px}
.linkish{background:none;border:0;padding:0;min-height:0;color:var(--accent);font:inherit;text-decoration:underline;cursor:pointer}
.row{display:flex;gap:10px}
.row>button{flex:1}
.artrow{margin:4px 0 8px}.artrow button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}
.cardsync{display:flex;gap:10px;align-items:flex-start;min-height:44px;padding:4px 0;font-size:14px}.cardsync input{width:24px;height:24px;flex:none}
.cardsync select{flex:1;min-width:0;max-width:100%}
.speed{margin:4px 0 8px}.speedhd{display:flex;align-items:center;min-height:36px;font-size:14px}
.speedft{display:flex;flex-wrap:wrap;gap:0 10px;align-items:center;justify-content:space-between;min-height:44px;margin-top:4px}
.speedft .hint{margin:0}.speedft .linkish{min-height:44px;font-size:14px}
.speedrow{display:flex;gap:6px}
.speedrow button{flex:1 1 0;min-width:0;padding:4px 2px;font-size:14px;line-height:1.15;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.speedrow small{font-size:12px;font-weight:400}
.speedrow button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}
.speedrow button.ship{outline:2px dashed var(--muted);outline-offset:2px}
.speedrow button:disabled{opacity:.45;cursor:default}
.rate button[aria-pressed=true].p{background:var(--pass);border-color:var(--pass);color:#fff}
.rate button[aria-pressed=true].f{background:var(--fail);border-color:var(--fail);color:#fff}
textarea{width:100%;min-height:76px;margin-top:10px;padding:10px;border-radius:12px;border:1px solid var(--line);background:var(--bg);resize:vertical}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--surface);border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom));z-index:5}
.bar .in{max-width:640px;margin:0 auto;display:flex;gap:10px;align-items:center}
.bar button{flex:1}
.bar .pos{flex:none;min-width:84px;text-align:center;font-size:14px;color:var(--muted)}
.list details{border:1px solid var(--line);border-radius:14px;background:var(--surface);margin:10px 0;overflow:hidden}
.list summary{padding:0 14px;min-height:52px;display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600}
.list summary .n{margin-left:auto;font-weight:400;color:var(--muted);font-size:14px}
.trk{display:flex;width:100%;text-align:left;border:0;border-top:1px solid var(--line);border-radius:0;min-height:52px;padding:8px 14px;gap:10px;align-items:center;background:transparent}
.trk .id{flex:none;width:36px;color:var(--muted);font-size:13px}
.trk .t{flex:1;min-width:0;overflow-wrap:anywhere}
.trk .s{flex:none;width:20px;text-align:center;font-weight:700}
.trk .s.cnt{width:auto;min-width:36px;font-size:13px;text-align:right}
.trk.cur{background:var(--surface2)}
.s.pass{color:var(--pass)}.s.fail{color:var(--fail)}
.btnrow{display:flex;gap:10px;margin:10px 0}
.btnrow button{flex:1}
#toast{position:fixed;left:16px;right:16px;bottom:calc(86px + env(safe-area-inset-bottom));background:var(--text);color:var(--bg);border-radius:12px;padding:12px 14px;display:none;z-index:9;max-width:608px;margin:0 auto}
#exportbox{display:none}
#exportbox textarea{min-height:220px;font:13px/1.35 ui-monospace,Menlo,Consolas,monospace}
.err{color:var(--fail)}
.lab{margin:12px 0;padding:10px 12px;border:1px dashed var(--line);border-radius:10px}.lab>summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center}
.slider{display:flex;flex-direction:column;gap:4px;margin:10px 0}.slider input{width:100%;min-height:32px}
.labbadge{margin:8px 0 0;padding:8px 10px;border-radius:10px;border:1px solid var(--warn);color:var(--warn);font-size:14px;font-weight:600}
.banner{margin:12px 0 0;padding:10px 12px;border-radius:10px;border:1px solid var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent);font-weight:600}
.bgblock{padding:12px 0 2px;border-top:1px solid var(--line)}
.field{display:flex;flex-direction:column;gap:4px;margin:8px 0;font-size:14px}
.field select,#ftsel{min-height:44px;font-size:16px;padding:0 8px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--text)}
.field select{width:100%}
.field[hidden]{display:none}
.varrow{display:flex;gap:6px;margin:8px 0}
.varrow button{flex:1 1 0;min-width:0;min-height:52px;padding:4px 2px;font-size:13px;white-space:nowrap;line-height:1.15;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.varrow small{font-size:11px;font-weight:400;white-space:normal;text-align:center}
.varrow button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
.varrow button:disabled{opacity:.45;cursor:default}
.facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;margin:8px 0;font-size:14px}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere;min-width:0}
.pwmsg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;color:#fff;font-size:15px;overflow-wrap:anywhere}
.pwmsg.bad{color:#ffb4ab;font-weight:600}
.enghd{margin:22px 0 2px;font-size:18px}
</style>
</head>
<body>
<main>
${BANNER}
<h1>Beast Sound Check</h1>
<p class="muted" id="intro"></p>

<details class="card global" id="global">
  <summary id="gsum">Global checklist (do once)</summary>
  <label><input type="checkbox" data-g="tap"><span><b>Tap to start.</b> A track is silent until you tap the round play button in the player. The art shows first. After the tap, audio begins within about half a second, with no error text at the bottom of the player.</span></label>
  <label><input type="checkbox" data-g="silent"><span><b>iPhone silent switch.</b> Flip the side switch to silent and play a track. Note whether you hear it (Web Audio on iOS often follows the switch). Flip it back before testing.</span></label>
  <label><input type="checkbox" data-g="headphones"><span><b>Headphones, then Bluetooth.</b> Plug in wired headphones mid-track, then connect Bluetooth. Playback should carry on or resume without crackle. Note the Bluetooth delay between the art and the sound.</span></label>
  <label><input type="checkbox" data-g="background"><span><b>Background the tab and return.</b> Play, switch to another app or tab for 10 seconds, come back. Note whether the audio kept playing while hidden. On return, the play/pause button must match what you hear, and playback must have no glitch.</span></label>
  <label><input type="checkbox" data-g="pause"><span><b>Pause and resume.</b> Tap pause while a dense track plays. All sound must stop at once (no stuck notes). Tap play: the music carries on from the same point. The art: on a real Beast as deployed, the GIF keeps moving while the music is paused (an isolated image runs on its own clock); with the Pause-freeze PR footer it holds still and moves again on play. On an engine test, the Synced art freezes on the frame you last heard and moves again in step with the music.</span></label>${BGBLOCK}
</details>

<section class="card" id="sepolia" aria-labelledby="sephd">
  <div class="kicker">Section 1</div>
  <h2 id="sephd">Beasts on Sepolia</h2>
  <p class="muted" id="sepintro"></p>
  <label class="field" id="setrow" hidden><span>Rendition set</span><select id="setsel"></select></label>
  <label class="field"><span>Species</span><select id="species" disabled><option>Loading the rendition set&hellip;</option></select></label>
  <div class="varrow" role="group" aria-label="Variant" id="varrow">
    <button data-var="genesis" aria-pressed="false" disabled>Genesis<small></small></button>
    <button data-var="p0" aria-pressed="false" disabled>Preset 0<small></small></button>
    <button data-var="p1" aria-pressed="false" disabled>Preset 1<small></small></button>
    <button data-var="p2" aria-pressed="false" disabled>Preset 2<small></small></button>
    <button data-var="p3" aria-pressed="false" disabled>Preset 3<small></small></button>
  </div>
  <p class="err" id="seperr" role="alert" hidden></p>
</section>

<section class="card" id="cur" aria-live="polite">
  <div class="kicker" id="kick"></div>
  <h2 id="ttl"></h2>
  <p class="muted" id="blurb"></p>
  <div class="labbadge" id="labbadge" role="note" hidden></div>
  <div class="labbadge" id="ftbadge" role="note" hidden></div>
  <div class="playerwrap" id="pw"></div>
  <div id="realctl" hidden>
    <label class="field"><span>Page footer (the page's bootstrap script)</span><select id="ftsel"></select></label>
    <p class="hint" id="ftinfo"></p>
    <dl class="facts" id="facts"></dl>
  </div>
  <div id="engctl">
  <div class="row artrow" role="group" aria-label="Art variant">
    <button id="aGif" aria-pressed="false">Art: original GIF</button>
    <button id="aSync" aria-pressed="true">Art: Synced</button>
  </div>
  <label class="cardsync"><input type="checkbox" id="cardSync"><span>Card synced (rim 16 beats, pulse 4 beats, logo 8 beats; Synced art only)</span></label>
  <div class="speed" role="group" aria-labelledby="speedlbl">
    <div class="speedhd" id="speedlbl">Animation speed: one Synced frame per</div>
    <div class="speedrow">
      <button data-speed="ultraslow" aria-pressed="false">Ultra slow<small>whole</small></button>
      <button data-speed="slow" aria-pressed="false">Slow<small>half</small></button>
      <button data-speed="medium" aria-pressed="false">Medium<small>quarter</small></button>
      <button data-speed="fast" aria-pressed="false">Fast<small>eighth</small></button>
      <button data-speed="ultrafast" aria-pressed="false">Ultra fast<small>16th</small></button>
    </div>
    <div class="speedft"><p class="hint" id="speedwhy"></p><button id="speedship" class="linkish" hidden>Back to the shipped speed</button></div>
  </div>
  <label class="cardsync"><span>Engine test:</span> <select id="etest">
    <option value="">Off (the page as shipped)</option>
    <option value="meter">As shipped, with the load meter</option>
    <option value="big1">Large buffer, 1 s lookahead (v2.1.0 on a phone)</option>
    <option value="big02">Large buffer, 0.2 s lookahead</option>
    <option value="def1">Default buffer, 1 s lookahead</option>
    <option value="def02">Default buffer, 0.2 s lookahead (v2.0.1 on a phone)</option>
    <option value="bal1">Balanced hint, 1 s lookahead</option>
    <option value="n02_1">Latency hint 0.02 s, 1 s lookahead</option>
    <option value="n05_1">Latency hint 0.05 s, 1 s lookahead</option>
    <option value="def1k">Default buffer, 1 s lookahead, k-rate detune</option>
    <option value="n05_1k">Latency hint 0.05 s, 1 s lookahead, k-rate detune</option>
  </select></label>
  <p class="muted" id="etestinfo"></p>
  <p class="muted" id="artinfo"></p>
  </div>
  <p class="hint">Tap the play button on the card. Only this track's player is loaded. Marketplaces show animation_url in a sandboxed frame like this one; <button id="alone" class="linkish">open this page on its own</button> to test it as a top-level page (background audio and lock-screen controls can differ).</p>
  <details class="lab" id="lab">
    <summary>Design lab: play button</summary>
    <p class="muted">Try other values for the page's button settings (its stylesheet's --play-min, --play-max and --play-target). The button is drawn at the art's own size for it (the card's play anchor, in card units, times the card's scale on this screen), kept between the minimum and the maximum: set both to the same value for a fixed size. Each change reloads this track's player. Changed values are not the shipped page, and the banner above the player says so.</p>
    <label class="slider"><span>Proportion (the art's anchor diameter): <b id="vs"></b></span><input type="range" id="ls" min="8" max="40" step="1"></label>
    <label class="slider"><span>Fixed diameter: <b id="vfix"></b></span><input type="range" id="lfix" min="12" max="64" step="1"></label>
    <p class="muted" style="margin:0">Or let it follow the art, between a minimum and a maximum:</p>
    <label class="slider"><span>Minimum diameter: <b id="vmin"></b></span><input type="range" id="lmin" min="12" max="64" step="1"></label>
    <label class="slider"><span>Maximum diameter: <b id="vmax"></b></span><input type="range" id="lmax" min="12" max="200" step="1"></label>
    <label class="slider"><span>Touch target: <b id="vtarget"></b></span><input type="range" id="ltarget" min="24" max="64" step="1"></label>
    <p class="muted" id="lnow" aria-live="polite"></p>
    <button id="lreset">Reset to the shipped settings</button>
  </details>
  <h3 style="font-size:16px;margin:12px 0 0">Listen for</h3>
  <ul class="checks" id="checks"></ul>
  <div class="rate row" style="margin-top:12px">
    <button class="p" id="bp" aria-pressed="false">Pass</button>
    <button class="f" id="bf" aria-pressed="false">Fail</button>
  </div>
  <textarea id="note" placeholder="Notes for this track (what you heard, device, headphones)" aria-label="Notes for this track"></textarea>
</section>

<div class="btnrow">
  <button id="export">Export results</button>
  <button id="clear">Clear results</button>
</div>
<div class="card" id="exportbox">
  <p class="muted">Clipboard copy was not allowed. Select all and copy this text.</p>
  <textarea id="exporttext" readonly aria-label="Results summary"></textarea>
</div>

<h2 style="margin-top:20px">All tracks</h2>
<p class="muted" id="listintro"></p>
<div class="list" id="list"></div>
<p class="muted" id="foot"></p>
</main>

<div class="bar"><div class="in">
  <button id="prev" aria-label="Previous track">&larr; Prev</button>
  <div class="pos" id="pos"></div>
  <button id="next" aria-label="Next track">Next &rarr;</button>
</div></div>
<div id="toast" role="status"></div>

<script type="application/json" id="data">${json}</script>
<script>
(function(){
"use strict";
var D = JSON.parse(document.getElementById("data").textContent);
var T = D.tracks, F = D.fixed, KEY = "beast-sound-check-${V}-v1";
// the page as consumerPieces composed it: fixed fragments, this track's art and D, and its alignment whitespace
function pageOf(t, v) { var p = t.pages[v], sp = function (n) { return new Array(9 * n + 1).join(" "); };
  return F.head + labStyle() + engineTest() + sp(p.ws[0]) + F.gunzip + sp(p.ws[1]) + F.player + F.body + labArt(v ? speedArt(t, p.art) : p.art) + t.d + sp(p.ws[2]) + (F.notes ? F.notes + sp(p.ws[3]) : "") + F.footer; }
function variant() { return store.art === "gif" ? 0 : store.card ? 2 : 1; }
var ENGINE_TEST = ${JSON.stringify(ENGINE_TEST)};
var TESTS = { meter: { hint: null, preroll: null }, big1: { hint: "playback", preroll: 1 }, big02: { hint: "playback", preroll: 0.2 },
  def1: { hint: "default", preroll: 1 }, def02: { hint: "default", preroll: 0.2 },
  bal1: { hint: "balanced", preroll: 1 }, n02_1: { hint: 0.02, preroll: 1 }, n05_1: { hint: 0.05, preroll: 1 },
  def1k: { hint: "default", preroll: 1, k: true }, n05_1k: { hint: 0.05, preroll: 1, k: true } };
function engineTest() { var m = TESTS[store.test]; if (!m) return "";
  return "<script>(" + ENGINE_TEST + ")(" + JSON.stringify({ key: store.test, hint: m.hint, preroll: m.preroll, k: !!m.k }) + ");</scr" + "ipt>"; }
// Animation speed: the Synced sprite's frame length as a note value (q quarter notes per frame). "" in store.speed
// follows the shipped policy per track (art.mjs frameUs: the eighth note, or the quarter when the eighth would be
// under 0.2 s, above 150 BPM); a step chosen here applies to every track. Frame lengths round to whole microseconds
// as frameUs does, so the shipped step reproduces the shipped dur exactly.
var SPEEDS = { ultraslow: { q: 4, label: "Ultra slow", note: "whole note" }, slow: { q: 2, label: "Slow", note: "half note" },
  medium: { q: 1, label: "Medium", note: "quarter note" }, fast: { q: 0.5, label: "Fast", note: "eighth note" },
  ultrafast: { q: 0.25, label: "Ultra fast", note: "sixteenth note" } };
function shippedSpeed(a) { return a.tempoUs / 2 < 200000 ? "medium" : "fast"; }
function speedOf(t) { return store.speed || shippedSpeed(t.art); }
function frameUsAt(a, k) { return Math.round(a.tempoUs * SPEEDS[k].q); }
function sec(us) { return (us / 1e6).toFixed(6).replace(/0+$/, "").replace(/\\.$/, ""); }
function msAt(a, k) { return +(frameUsAt(a, k) / 1000).toFixed(1) + " ms"; }
// Retimes the Synced sprite (its <animate attributeName='x' ... calcMode='discrete'>) and nothing else: the card's
// rim, opacity and logo animates, which Card synced sets, keep their durations. At the shipped step the art is untouched.
function speedArt(t, art) {
  var a = t.art, k = speedOf(t);
  if (!a.animated || !(a.tempoUs > 0) || k === shippedSpeed(a)) return art;
  var m = /(src="data:image\\/svg\\+xml;base64,)([^"]+)"/.exec(art); if (!m) return art;
  var svg = atob(m[2]), re = /(<animate attributeName='x' values='[^']*' dur=')[0-9.]+(s' calcMode='discrete')/;
  if (!re.test(svg)) return art;
  svg = svg.replace(re, function (x, p, q) { return p + sec(frameUsAt(a, k) * a.frames) + q; });
  return art.slice(0, m.index) + m[1] + btoa(svg) + art.slice(m.index + m[0].length - 1);
}
// what a rating was made with: "static", "gif", or the speed step in effect
function artTag(t) { return t.art.animated === false ? "static" : store.art === "gif" ? "gif" : speedOf(t); }
function tagText(t, tag) {
  if (tag === "static") return "static art";
  if (tag === "gif") return "original GIF art";
  if (!SPEEDS[tag] || !(t.art.tempoUs > 0)) return "";
  var ship = shippedSpeed(t.art);
  return "Synced " + SPEEDS[tag].label + ", one frame per " + SPEEDS[tag].note + ", " + msAt(t.art, tag) + (tag === ship ? " (shipped)" : " (shipped: " + SPEEDS[ship].note + ")");
}
// ---- Section 1, Beasts on Sepolia: real Beasts. The page fetches a rendition set from its own renditions/<set>/ path
// (only a summary of each set is baked in), rebuilds a token's raw token_uri with tools/rendition_set.mjs (embedded
// below as it is), which checks its length and SHA-256 against the set's manifest, and plays its animation_url byte
// for byte. A non-default page footer splices another footer fragment in place of the deployed one.
var SEPD = D.sepolia, FT = SEPD.footers, FTKEYS = ["", "main", "pr88"];
var store = { r: {}, g: {}, last: "", art: "synced", card: false, lab: null, test: "", speed: "", set: "", ft: "", v: 1 };
// The page's own button settings, as shipped (the head stylesheet's :root custom properties)
var SHIP = (function () { var o = {}, ok = true; ["min", "max", "target"].forEach(function (k) {
  var m = new RegExp("--play-" + k + ":([0-9.]+)px").exec(F.head); if (m) o[k] = +m[1]; else ok = false; });
  o.s = +((D.meta.playAnchor || "").split(/[\\s,]+/)[2]); if (!(o.s > 0)) ok = false; return ok ? o : null; })();
function labOn() { return !!(SHIP && store.lab && (store.lab.min !== SHIP.min || store.lab.max !== SHIP.max || store.lab.target !== SHIP.target || store.lab.s !== SHIP.s)); }
function labText() { var l = store.lab; return "anchor diameter " + l.s + " card units, minimum " + l.min + " px, maximum " + l.max + " px, touch target " + l.target + " px"; }
// The proportion lives in the art (its data-play-anchor S), so the lab re-encodes this track's art with another S
function labArt(art) {
  if (!labOn() || store.lab.s === SHIP.s) return art;
  var m = /src="data:image\\/svg\\+xml;base64,([^"]+)"/.exec(art); if (!m) return art;
  var svg = atob(m[1]).replace(/(data-play-anchor="[0-9.]+ [0-9.]+ )[0-9.]+/, "$1" + store.lab.s);
  return '<img id="beast-art" alt="" src="data:image/svg+xml;base64,' + btoa(svg) + '">';
}
function labStyle() { if (!labOn()) return ""; var l = store.lab;
  return '<style id="sound-check-lab">:root{--play-min:' + l.min + 'px;--play-max:' + l.max + 'px;--play-target:' + l.target + "px}</style>"; }
try { var raw = localStorage.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (o && typeof o === "object") { store.r = o.r || {}; store.g = o.g || {}; store.last = o.last || ""; store.art = o.art === "gif" ? "gif" : "synced";
  if (o.lab && typeof o.lab === "object" && [o.lab.min, o.lab.max, o.lab.target, o.lab.s].every(function (x) { return typeof x === "number" && x > 0; })) store.lab = { min: o.lab.min, max: o.lab.max, target: o.lab.target, s: o.lab.s }; store.card = !!o.card; store.test = TESTS[o.test] ? o.test : ""; store.speed = SPEEDS[o.speed] ? o.speed : "";
  store.set = typeof o.set === "string" ? o.set : ""; store.ft = o.ft === "main" || o.ft === "pr88" ? o.ft : "";
} } } catch (e) {}
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }
save();
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
// idx: the engine test shown when cur is null; cur: the real Beast shown ({ tok, html, err })
var idx = 0, frame = null, noteTimer = 0, cur = null;

function byId(id) { for (var i = 0; i < T.length; i++) if (T[i].id === id) return i; return -1; }
function label(t) { return t.sectionId + "." + t.id.slice(1); }

var RS = (function () {
${LOADER}
return { openRenditionSet: openRenditionSet };
})();
var VARS = ["genesis", "p0", "p1", "p2", "p3"];
var SEP = { dir: "", set: null, err: "", species: [], keys: [] };
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function varOf(t) { return t.kind === "genesis" ? "genesis" : "p" + t.visualEffects; }
function realKey(sid, v) { return "beast-" + pad2(sid) + "-" + v; }
function parseReal(k) { var m = /^beast-([0-9]+)-(genesis|p[0-3])$/.exec(k || ""); return m ? { sid: +m[1], v: m[2] } : null; }
function speciesOf(sid) { for (var i = 0; i < SEP.species.length; i++) if (SEP.species[i].id === sid) return SEP.species[i]; return null; }
function realTok(k) { var p = parseReal(k), s = p && SEP.set ? speciesOf(p.sid) : null; return s && s.v[p.v] || null; }
// a real Beast's result key: its set and token ID (never a bare engine id such as "201")
function rk(tok) { return SEP.dir + "/" + tok.tokenId; }
function presetText(tok) { return (tok.kind === "genesis" ? "Genesis" : "preset " + tok.visualEffects) + " (visual " + tok.visualEffects + ", sound " + tok.soundEffects + ")"; }
function realTitle(tok) { return tok.name + " \\u00b7 " + (tok.kind === "genesis" ? "Genesis" : "Preset " + tok.visualEffects); }
function ftOf(k) { return k ? FT[k] : FT.deployed; }
function short(c) { return String(c || "").slice(0, 7); }
var DEFAULT_REAL = realKey(1, "genesis");

// Why real Beasts cannot play in this browser, or "".
function realBlocker() {
  if (!window.crypto || !window.crypto.subtle) return "Real Beasts can't play here: each one is checked against its SHA-256 before it plays, and crypto.subtle, which does that, needs a secure context (the https site, or localhost), which " + (location.protocol + "//" + location.host) + " is not. Open https://provable-games.github.io/beast-sound-check/ instead. The engine tests below still work.";
  if (typeof window.DecompressionStream !== "function") return "Real Beasts can't play here: this browser has no DecompressionStream (Safari 16.4, Chrome 80 or Firefox 113 and later have it) to unpack the stored set. The engine tests below still work.";
  return "";
}
var openSeq = 0;
function openSet(dir, then) {
  var my = ++openSeq, base = "renditions/" + dir + "/";
  SEP.dir = dir; SEP.set = null; SEP.err = ""; SEP.species = []; SEP.keys = [];
  paintPicker(); buildRealList();
  var why = realBlocker();
  if (why) { SEP.err = why; paintPicker(); buildRealList(); then(); return; }
  RS.openRenditionSet(function (p) {
    return fetch(base + p).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " for " + base + p); return r.arrayBuffer(); });
  }).then(function (set) {
    if (my !== openSeq) return;
    if (set.manifest.deployment !== dir) throw new Error(base + "manifest.json names deployment " + set.manifest.deployment);
    var by = {};
    set.manifest.tokens.forEach(function (t) { var s = by[t.speciesId] || (by[t.speciesId] = { id: t.speciesId, name: t.species, v: {} }); s.v[varOf(t)] = t; });
    SEP.species = Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).map(function (id) { return by[id]; });
    SEP.species.forEach(function (s) { VARS.forEach(function (v) { if (s.v[v]) SEP.keys.push(realKey(s.id, v)); }); });
    SEP.set = set;
    paintPicker(); buildRealList(); then();
  }).catch(function (e) {
    if (my !== openSeq) return;
    SEP.err = "Couldn't open the rendition set " + dir + ": " + (e && e.message || e) + "." + (location.protocol === "file:" ? " A page opened from a file can't fetch it: open the https site, or serve this folder over http on localhost." : "") + " The engine tests below still work.";
    paintPicker(); buildRealList(); then();
  });
}
function utf8(b64) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder("utf-8", { fatal: true }).decode(u); }
// token_uri -> metadata JSON -> animation_url -> the page's HTML
function animationPage(uri) {
  var J = "data:application/json;base64,", H = "data:text/html;base64,";
  if (uri.indexOf(J) !== 0) throw new Error("the token_uri is not a base64 JSON data URI");
  var a = JSON.parse(utf8(uri.slice(J.length))).animation_url;
  if (typeof a !== "string" || a.indexOf(H) !== 0) throw new Error("the token's animation_url is not a base64 HTML data URI");
  return utf8(a.slice(H.length));
}
// The page is head ++ gunzip ++ player ++ body ++ art ++ MIDI ++ [notes] ++ footer, with insignificant whitespace (word
// fillers of nine spaces) between the segments: the footer is the last fragment, so another footer replaces exactly the
// deployed one's bytes at the end. Anything else (no deployed footer, two of them, or one that is not last) refuses.
function splice(html, k) {
  if (!k) return html;
  var dep = FT.deployed.text, i = html.indexOf(dep);
  if (i < 0 || html.lastIndexOf(dep) !== i || i + dep.length !== html.length) throw new Error("this page does not end with the deployed footer (" + FT.deployed.title + ") exactly once, so the " + FT[k].label + " footer was not spliced in");
  return html.slice(0, i) + FT[k].text;
}

$("intro").textContent = "Two parts. Section 1, Beasts on Sepolia: real Beasts, each the exact animation_url page of a token on the latest Beasts V3 Sepolia deployment (TinySynth " + SEPD.sets[0].tinysynth + ", the Beasts renderer's card, the Originals Sound Manager's music), rebuilt from a stored rendition set and checked against its SHA-256 before it plays. Pick a species and a variant: its Genesis Beast or presets 0 to 3. Their art is the card's GIF as an isolated image, on its own clock. Then " + T.length + " engine tests (sections 2 to 5): synthetic tracks on onchain-midi-player " + D.meta.playerVersion + "'s reference Beast page, which test the engine, not shipping Beasts: their cards are templates and their inline Synced art (a sprite sheet stepped on the beat and seeked to the music) follows the music; switch to the original GIF to compare, and Animation speed sets how many notes each Synced frame lasts (by default as shipped: an eighth note, or a quarter note above 150 BPM). Each track plays in a sandboxed frame, as on a marketplace. Results are saved on this device.";
var meta = D.meta || {};
$("foot").textContent = "Beasts on Sepolia: " + SEPD.sets.map(function (s) { return s.dir + " (block " + s.blockNumber + ", " + s.tokens + " tokens)"; }).join(", ") + ". Page footers: as deployed, onchain-midi-player " + short(FT.deployed.commit) + " (Beasts' vendored copy); upstream main " + short(FT.main.commit) + "; PR #88 " + short(FT.pr88.commit) + ". Engine tests: player " + meta.playerVersion + ", " + (meta.beastCommit || "") + ", " + (meta.ompCommit || "") + ". Generated " + (meta.generated || "").slice(0, 10) + ".";
$("sepintro").textContent = "Real Beasts read from the latest Beasts V3 Sepolia deployment at one block: one Beast for each of the 75 original species at visual presets 0 to 3 (sound effects equal to the preset) and the 75 Genesis Beasts. The set is stored in this site's renditions/ folder and fetched when the page opens; each token_uri is rebuilt from it and checked against its SHA-256 before it plays, and a Beast that fails the check is not played.";
$("listintro").textContent = "Section 1 is the real Beasts, one row per species (pick the variant above). Sections 2 to 5 are the engine tests.";

// global checklist
Array.prototype.forEach.call(document.querySelectorAll("[data-g]"), function (cb) {
  cb.checked = !!store.g[cb.getAttribute("data-g")];
  cb.addEventListener("change", function () { store.g[cb.getAttribute("data-g")] = cb.checked; save(); gsum(); });
});
function gsum() { var n = Object.keys(store.g).filter(function (k) { return store.g[k]; }).length; $("gsum").textContent = "Global checklist (do once): " + n + " of " + document.querySelectorAll("[data-g]").length + " ticked"; }
gsum();
if (!Object.keys(store.g).some(function (k) { return store.g[k]; }) && !Object.keys(store.r).length) $("global").open = true;

// list: section 1 (one row per species, filled when the set opens), then the engine tests
var listEl = $("list"), rows = {}, secCount = {}, realSec = { d: el("details"), n: el("span", "n", ""), body: el("div"), rows: {} };
(function () {
  var s = el("summary"); s.appendChild(el("span", "", "1 Beasts on Sepolia")); s.appendChild(realSec.n); realSec.d.appendChild(s); realSec.d.appendChild(realSec.body); listEl.appendChild(realSec.d);
  listEl.appendChild(el("h3", "enghd", "Engine tests"));
  listEl.appendChild(el("p", "muted", "Synthetic tracks on onchain-midi-player " + D.meta.playerVersion + "'s reference Beast page (" + (meta.ompCommit || "") + "), not real Beasts: templated cards with inline Synced art, the Card synced option and the Animation speed row. Casey's Beast compositions are no longer here: section 1 plays the real Beasts' music."));
})();
(function build() {
  var sec = null, body = null;
  T.forEach(function (t) {
    if (!sec || sec.id !== t.sectionId) {
      var d = el("details"); var s = el("summary"); s.appendChild(el("span", "", t.sectionId + " " + t.section)); var n = el("span", "n", ""); s.appendChild(n); d.appendChild(s);
      listEl.appendChild(d); sec = { id: t.sectionId, d: d, n: n }; secCount[t.sectionId] = { n: n, total: 0, ids: [] }; body = d;
    }
    secCount[t.sectionId].total++; secCount[t.sectionId].ids.push(t.id);
    var b = el("button", "trk"); b.type = "button";
    b.appendChild(el("span", "id", label(t))); b.appendChild(el("span", "t", t.title)); var st = el("span", "s", "");
    b.appendChild(st); rows[t.id] = { b: b, st: st, d: body };
    b.addEventListener("click", function () { go(t.id); window.scrollTo({ top: 0, behavior: "smooth" }); });
    body.appendChild(b);
  });
})();
function buildRealList() {
  var body = realSec.body; body.textContent = ""; realSec.rows = {};
  if (!SEP.set) { body.appendChild(el("p", "muted", SEP.err || "Loading the rendition set\\u2026")).style.padding = "8px 14px"; paintRealRows(); return; }
  SEP.species.forEach(function (s) {
    var b = el("button", "trk"); b.type = "button";
    b.appendChild(el("span", "id", "1." + pad2(s.id))); b.appendChild(el("span", "t", s.name)); var st = el("span", "s cnt", "");
    b.appendChild(st); realSec.rows[s.id] = { b: b, st: st };
    b.addEventListener("click", function () { var v = cur ? varOf(cur.tok) : "genesis"; go(s.v[v] ? realKey(s.id, v) : realKey(s.id, VARS.filter(function (x) { return s.v[x]; })[0])); window.scrollTo({ top: 0, behavior: "smooth" }); });
    body.appendChild(b);
  });
  paintRealRows();
}

function status(id) { var r = store.r[id]; return r && r.s ? r.s : ""; }
function paintRow(id) {
  var s = status(id), r = rows[id]; if (!r) return;
  r.st.textContent = s === "pass" ? "\\u2713" : s === "fail" ? "\\u2717" : (store.r[id] && store.r[id].n ? "\\u270e" : "");
  r.st.className = "s " + s;
}
function paintCounts() {
  Object.keys(secCount).forEach(function (k) {
    var c = secCount[k], done = 0, bad = 0;
    c.ids.forEach(function (id) { var s = status(id); if (s) done++; if (s === "fail") bad++; });
    c.n.textContent = done + "/" + c.total + (bad ? ", " + bad + " fail" : "");
  });
}
// a species row: its rated variants in this set (of 5), with a cross if any failed
function paintRealRows() {
  var done = 0, bad = 0;
  SEP.species.forEach(function (s) {
    var n = 0, f = 0, all = 0;
    VARS.forEach(function (v) { if (!s.v[v]) return; all++; var st = status(rk(s.v[v])); if (st) n++; if (st === "fail") f++; });
    done += n; bad += f;
    var r = realSec.rows[s.id]; if (!r) return;
    r.st.textContent = (f ? "\\u2717 " : "") + n + "/" + all; r.st.className = "s cnt" + (f ? " fail" : n === all ? " pass" : "");
    r.b.classList.toggle("cur", !!cur && cur.tok.speciesId === s.id);
  });
  realSec.n.textContent = SEP.set ? done + "/" + SEP.keys.length + (bad ? ", " + bad + " fail" : "") : "";
}
T.forEach(function (t) { paintRow(t.id); }); paintCounts();

// the picker
(function () {
  var ss = $("setsel");
  SEPD.sets.forEach(function (s, i) { var o = el("option", "", s.dir + " (block " + s.blockNumber + (i === 0 ? ", newest" : "") + ")"); o.value = s.dir; ss.appendChild(o); });
  $("setrow").hidden = SEPD.sets.length < 2;
  ss.addEventListener("change", function () {
    var k = cur ? realKey(cur.tok.speciesId, varOf(cur.tok)) : "", keep = !!cur;
    store.set = ss.value; save();
    if (keep) { cur = null; clearFrame(); pwMsg("Loading the rendition set\\u2026"); }
    openSet(ss.value, function () { if (keep && !go(k) && !go(DEFAULT_REAL)) go(T[0].id); paintPos(); });
  });
  var fs = $("ftsel");
  FTKEYS.forEach(function (k) { var f = ftOf(k), o = el("option", "", f.label + " \\u00b7 onchain-midi-player " + short(f.commit) + (k ? "" : " (Beasts' vendored copy)")); o.value = k; fs.appendChild(o); });
  fs.addEventListener("change", function () { store.ft = FTKEYS.indexOf(fs.value) >= 0 ? fs.value : ""; save(); if (cur) showReal(cur.tok); });
  $("species").addEventListener("change", function () {
    var s = speciesOf(+$("species").value); if (!s) return;
    var v = cur ? varOf(cur.tok) : "genesis";
    go(realKey(s.id, s.v[v] ? v : VARS.filter(function (x) { return s.v[x]; })[0]));
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-var]"), function (b) {
    b.addEventListener("click", function () { go(realKey(+$("species").value, b.getAttribute("data-var"))); });
  });
})();
function paintPicker() {
  var sel = $("species"), err = $("seperr");
  err.hidden = !SEP.err; err.textContent = SEP.err;
  $("setsel").value = SEP.dir;
  if (!SEP.set) {
    sel.disabled = true; sel.textContent = ""; sel.appendChild(el("option", "", SEP.err ? "Unavailable" : "Loading the rendition set\\u2026")); delete sel.dataset.dir;
    Array.prototype.forEach.call(document.querySelectorAll("[data-var]"), function (b) { b.disabled = true; b.setAttribute("aria-pressed", "false"); b.querySelector("small").textContent = ""; });
    return;
  }
  if (sel.dataset.dir !== SEP.dir) {
    sel.textContent = ""; SEP.species.forEach(function (s) { var o = el("option", "", s.id + " " + s.name); o.value = String(s.id); sel.appendChild(o); });
    sel.dataset.dir = SEP.dir; sel.disabled = false;
  }
  var c = cur && cur.tok, s = speciesOf(c ? c.speciesId : +sel.value) || SEP.species[0];
  sel.value = String(s.id);
  Array.prototype.forEach.call(document.querySelectorAll("[data-var]"), function (b) {
    var v = b.getAttribute("data-var"), t = s.v[v];
    b.disabled = !t; b.setAttribute("aria-pressed", c && c.speciesId === s.id && varOf(c) === v ? "true" : "false");
    b.querySelector("small").textContent = t ? (t.shiny ? "shiny" : "regular") + (t.notes ? ", notes" : "") : "none";
  });
}

function clearFrame() { if (frame) { try { frame.srcdoc = ""; } catch (e) {} frame.remove(); frame = null; } $("pw").textContent = ""; }
function pwMsg(text, bad) { clearFrame(); var m = el("div", "pwmsg" + (bad ? " bad" : ""), text); if (bad) m.setAttribute("role", "alert"); $("pw").appendChild(m); }
function mountHtml(html, title) {
  clearFrame();
  var f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-scripts");
  f.setAttribute("allow", "autoplay");
  f.setAttribute("title", "Player: " + title);
  f.srcdoc = html;
  $("pw").appendChild(f); frame = f; paintNow();
}
function mountFrame(t) { mountHtml(pageOf(t, variant()), t.title); }
function reloadEngine() { if (!cur) mountFrame(T[idx]); }
var mountSeq = 0;
function mountReal() {
  var c = cur, my = ++mountSeq, k = store.ft;
  c.html = ""; c.err = "";
  pwMsg("Rebuilding the token_uri and checking its SHA-256\\u2026");
  SEP.set.tokenUri(c.tok.tokenId).then(function (uri) {
    if (my !== mountSeq) return;
    c.html = splice(animationPage(uri), k);
    mountHtml(c.html, c.tok.name);
  }).catch(function (e) {
    if (my !== mountSeq) return;
    var msg = String(e && e.message || e);
    c.err = (/differs from the manifest/.test(msg) ? "SHA-256 check failed, so this Beast is not played: " : "Not played: ") + msg;
    pwMsg(c.err, true);
  });
}

function seq() { return SEP.keys.concat(T.map(function (t) { return t.id; })); }
function curKey() { return cur ? realKey(cur.tok.speciesId, varOf(cur.tok)) : T[idx].id; }
function paintPos() { var q = seq(), i = q.indexOf(curKey()); $("pos").textContent = (i + 1) + " / " + q.length; }
function step(d) { var q = seq(), i = q.indexOf(curKey()); go(q[(i + d + q.length) % q.length]); }
function go(key) {
  var tok = realTok(key); if (tok) { showReal(tok); return true; }
  var i = byId(key); if (i >= 0) { showEngine(i); return true; }
  return false;
}
function rateUi(r) {
  r = r || {};
  $("bp").setAttribute("aria-pressed", r.s === "pass" ? "true" : "false");
  $("bf").setAttribute("aria-pressed", r.s === "fail" ? "true" : "false");
  $("note").value = r.n || "";
}
function panels(real) {
  $("realctl").hidden = !real; $("engctl").hidden = real;
  if (real) { $("lab").hidden = true; $("labbadge").hidden = true; } else { $("ftbadge").hidden = true; paintLab(); }
}
function showEngine(i) {
  cur = null; mountSeq++;
  idx = i; var t = T[i];
  panels(false);
  $("kick").textContent = "Engine test \\u00b7 " + t.sectionId + " " + t.section + "  \\u00b7  " + label(t);
  $("ttl").textContent = t.title;
  $("blurb").textContent = t.blurb;
  var ul = $("checks"); ul.textContent = "";
  t.checks.forEach(function (c) { ul.appendChild(el("li", "", c)); });
  rateUi(store.r[t.id]);
  paintPos();
  paintArt();
  Object.keys(rows).forEach(function (id) { rows[id].b.classList.toggle("cur", id === t.id); });
  paintRealRows(); paintPicker();
  mountFrame(t);
  store.last = t.id; save();
  try { history.replaceState(null, "", "#" + t.id); } catch (e) {}
}
function realChecks(tok) {
  var tp = tok.tempo || {}, k = store.ft, blk = SEP.set.manifest.blockNumber, c = [];
  c.push("Tap the round play button on the card: the music starts within about half a second, with no error text at the bottom of the player. It is the Originals Sound Manager's track for this Beast at block " + blk + ", at " + tp.bpm + " BPM.");
  c.push("Art: the " + (tok.shiny ? "Shiny" : "Regular") + " GIF of the " + tok.species + " in the card's art frame. It is an isolated image (not inline SVG), so it runs on its own clock and is not stepped to the music.");
  c.push(tok.rainbow ? "Rainbow: the card's rim and logo cycle through rainbow colours." : "No rainbow: the card's rim and logo are plain.");
  c.push(tok.notes ? "Notes: the song's own MIDI scrolls right to left behind the Beast in the art frame, one colour per channel, drums as ticks along the bottom; each note sounds as it reaches the playhead near the left edge. They stand still before play, freeze on pause, and loop with the music." : "No notes behind the Beast: presets 0 and 1 draw none.");
  c.push(k === "pr88" ? "Pause, with the Pause-freeze PR footer: all sound stops at once (no stuck notes) and the GIF holds still; play carries the music on from the same point and the GIF moves again." :
    "Pause, " + (k ? "with the upstream main footer" : "as deployed") + ": all sound stops at once (no stuck notes), but the GIF keeps moving: this footer cannot pause an isolated image. Play carries the music on from the same point. Choose the Pause-freeze PR footer to compare.");
  c.push("Let it loop at least once: no gap and no click at the seam, and the play button still matches what you hear.");
  return c;
}
function paintFooter() {
  var k = store.ft, f = ftOf(k), b = $("ftbadge");
  $("ftsel").value = k;
  b.hidden = !(cur && k);
  b.textContent = k ? "Page footer: " + f.label + " (" + f.title + " " + short(f.commit) + "), not the deployed page." : "";
  $("ftinfo").textContent = k ? "This Beast's page with its footer (the bootstrap script: play button, art, notes, background audio and media session) replaced by " + f.title + " " + short(f.commit) + "'s examples/beast_consumer/fixtures/footer.html; everything before it is the real page." + (k === "main" && FT.main.sameAsEngineTests ? " It is the footer the engine tests' reference page runs." : "") + (k === "pr88" ? " It freezes the isolated GIF art while the music is paused." : "") :
    "The page exactly as the token_uri carries it, with Beasts' vendored footer (onchain-midi-player " + short(FT.deployed.commit) + ").";
}
function paintFacts(tok) {
  var dl = $("facts"), tp = tok.tempo || {}, m = SEP.set.manifest; dl.textContent = "";
  [["Token ID", tok.tokenId], ["Name", tok.name], ["Preset", presetText(tok)], ["Shiny", tok.shiny ? "yes (the Shiny GIF)" : "no (the Regular GIF)"],
    ["Notes", tok.notes ? "yes" : "no"], ["Rainbow", tok.rainbow ? "yes" : "no"],
    ["Tempo", tp.bpm + " BPM (" + tp.microsecondsPerQuarter + " \\u00b5s per quarter note" + (tp.tempoChanges > 1 ? ", " + tp.tempoChanges + " tempo events" : "") + ")"],
    ["Block", m.blockNumber + " (" + SEP.dir + ", " + m.chainId + ")"]].forEach(function (x) { dl.appendChild(el("dt", "", x[0])); dl.appendChild(el("dd", "", x[1])); });
}
function showReal(tok) {
  cur = { tok: tok, html: "", err: "" };
  panels(true);
  $("kick").textContent = "1 Beasts on Sepolia \\u00b7 " + SEP.dir + " \\u00b7 block " + SEP.set.manifest.blockNumber;
  $("ttl").textContent = realTitle(tok);
  $("blurb").textContent = "The real token_uri of this Beast at block " + SEP.set.manifest.blockNumber + ", rebuilt from the stored set and checked against its SHA-256. The frame shows its animation_url as a marketplace would: TinySynth " + ((SEP.set.manifest.contracts || {}).tinysynth || {}).version + ", the Beasts renderer's card and the Originals Sound Manager's music.";
  var ul = $("checks"); ul.textContent = "";
  realChecks(tok).forEach(function (c) { ul.appendChild(el("li", "", c)); });
  paintFooter(); paintFacts(tok);
  rateUi(store.r[rk(tok)]);
  paintPos();
  Object.keys(rows).forEach(function (id) { rows[id].b.classList.remove("cur"); });
  paintRealRows(); paintPicker();
  mountReal();
  store.last = curKey(); store.set = SEP.dir; save();
  try { history.replaceState(null, "", "#" + store.last); } catch (e) {}
}

function paintArt() {
  var t = T[idx], a = t.art, synced = store.art !== "gif";
  $("aGif").setAttribute("aria-pressed", synced ? "false" : "true");
  $("aSync").setAttribute("aria-pressed", synced ? "true" : "false");
  $("cardSync").checked = !!store.card; $("cardSync").disabled = !synced;
  var animated = a.animated !== false, k = speedOf(t), ship = shippedSpeed(a);
  Array.prototype.forEach.call(document.querySelectorAll("[data-speed]"), function (b) {
    var key = b.getAttribute("data-speed");
    b.setAttribute("aria-pressed", animated && key === k ? "true" : "false"); b.disabled = !(synced && animated);
    b.classList.toggle("ship", animated && key === ship);
  });
  $("speedship").hidden = !store.speed;
  $("speedwhy").textContent = !animated ? "Off: this Beast is a static PNG, with no frames to time." : !synced ? "Off for the original GIF: it keeps its own clock, the baseline to compare with." : "Dashed: the shipped speed at this tempo.";
  var gif = a.gifMs && a.gifMs.length ? (a.gifMs.every(function (x) { return x === a.gifMs[0]; }) ? a.gifMs[0] : a.gifMs.join("/")) + " ms" : "?";
  $("artinfo").textContent = "Beast: " + a.name + " (" + (a.shiny ? "shiny" : "regular") + ", " + (a.animated === false ? "static, PNG " + a.spriteBytes + " B" : "animated, " + a.frames + " frames; GIF " + a.gifBytes + " B, sprite sheet " + a.spriteBytes + " B") + "); tempo " + a.bpm + " BPM." +
    (animated ? " Synced: " + msAt(a, k) + " per frame, one per " + SPEEDS[k].note + " (" + SPEEDS[k].label + "); shipped: " + SPEEDS[ship].note + " (" + msAt(a, ship) + "). GIF: " + gif + " per frame, on its own clock." : "") + " The song's notes scroll behind it.";
}
function setArt(mode, card) {
  if (mode !== undefined) store.art = mode;
  if (card !== undefined) store.card = card;
  save(); paintArt(); reloadEngine();
}
$("aGif").addEventListener("click", function () { setArt("gif"); });
$("aSync").addEventListener("click", function () { setArt("synced"); });
$("cardSync").addEventListener("change", function () { setArt(undefined, $("cardSync").checked); });
// Engine test: ?test=<mode> in the URL selects one too (for a link to send).
(function () { var q = /[?&]test=([a-z0-9_]+)/.exec(location.search); if (q && TESTS[q[1]]) store.test = q[1]; })();
// Animation speed: ?speed=<ultraslow|slow|medium|fast|ultrafast|shipped> in the URL selects one too.
(function () { var q = /[?&]speed=([a-z]+)/.exec(location.search); if (q && (SPEEDS[q[1]] || q[1] === "shipped")) store.speed = SPEEDS[q[1]] ? q[1] : ""; })();
function setSpeed(k) { store.speed = SPEEDS[k] ? k : ""; save(); paintArt(); reloadEngine(); }
Array.prototype.forEach.call(document.querySelectorAll("[data-speed]"), function (b) { b.addEventListener("click", function () { setSpeed(b.getAttribute("data-speed")); }); });
$("speedship").addEventListener("click", function () { setSpeed(""); });
function paintTest() { $("etest").value = store.test; $("etestinfo").textContent = store.test ? "Engine test on: the meter is at the top left of the player. Reload the track after changing the mode (choosing it here does)." : ""; }
$("etest").addEventListener("change", function () { store.test = TESTS[$("etest").value] ? $("etest").value : ""; save(); paintTest(); reloadEngine(); });
paintTest();
// a real Beast's result carries what it was rated with: the set, block, token, name, preset and page footer
function realRec(tok) {
  var k = rk(tok), r = store.r[k] || (store.r[k] = {});
  r.real = 1; r.set = SEP.dir; r.blk = SEP.set.manifest.blockNumber; r.tid = tok.tokenId; r.nm = tok.name; r.sid = tok.speciesId; r.v = varOf(tok); r.pr = presetText(tok);
  return r;
}
function stampFooter(r) { var f = ftOf(store.ft); r.ft = store.ft || "deployed"; r.fl = f.label; r.fc = f.commit; }
function setRate(s) {
  if (cur) {
    var q = realRec(cur.tok);
    q.s = q.s === s ? "" : s;
    if (q.s || q.n) stampFooter(q); else delete store.r[rk(cur.tok)];
    rateUi(q); save(); paintRealRows(); return;
  }
  var t = T[idx], r = store.r[t.id] || (store.r[t.id] = {});
  r.s = r.s === s ? "" : s;
  if (r.s) r.sp = artTag(t); else delete r.sp;
  $("bp").setAttribute("aria-pressed", r.s === "pass" ? "true" : "false");
  $("bf").setAttribute("aria-pressed", r.s === "fail" ? "true" : "false");
  save(); paintRow(t.id); paintCounts();
}
$("bp").addEventListener("click", function () { setRate("pass"); });
$("bf").addEventListener("click", function () { setRate("fail"); });
function setNote(v) {
  if (cur) { if (!v && !store.r[rk(cur.tok)]) return; var q = realRec(cur.tok); q.n = v; if (!q.s) stampFooter(q); save(); paintRealRows(); return; }
  var id = T[idx].id, r = store.r[id] || (store.r[id] = {}); r.n = v; save(); paintRow(id);
}
$("note").addEventListener("input", function () {
  clearTimeout(noteTimer);
  var v = $("note").value, c = cur, i = idx;
  noteTimer = setTimeout(function () { if (c === cur && i === idx) setNote(v); }, 300);
});
$("note").addEventListener("blur", function () { setNote($("note").value); });
$("prev").addEventListener("click", function () { step(-1); });
$("next").addEventListener("click", function () { step(1); });

function toast(msg, ms) { var t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(function () { t.style.display = "none"; }, ms || 2500); }

function realSummary() {
  var keys = Object.keys(store.r).filter(function (k) { var r = store.r[k]; return r && r.real && (r.s || r.n); });
  keys.sort(function (a, b) { var x = store.r[a], y = store.r[b]; return x.set < y.set ? -1 : x.set > y.set ? 1 : x.sid - y.sid || VARS.indexOf(x.v) - VARS.indexOf(y.v); });
  var pass = 0, fail = 0, lines = [];
  keys.forEach(function (k) {
    var r = store.r[k];
    if (r.set === SEP.dir) { if (r.s === "pass") pass++; else if (r.s === "fail") fail++; }
    lines.push((r.s ? r.s.toUpperCase() : "NOTE") + " " + r.set + " block " + r.blk + " token " + r.tid + " " + r.nm + ", " + r.pr + " [footer: " + r.fl + ", onchain-midi-player " + short(r.fc) + "]" + (r.n ? " - " + r.n.replace(/\\s+/g, " ") : ""));
  });
  var f = ftOf(store.ft), m = SEP.set && SEP.set.manifest, total = SEP.keys.length;
  return ["Beasts on Sepolia (real Beasts)",
    m ? "Set " + SEP.dir + ", block " + m.blockNumber + ", " + m.chainId + ", TinySynth " + ((m.contracts || {}).tinysynth || {}).version + "; page footer now: " + f.label + " (onchain-midi-player " + short(f.commit) + ")" : "Set " + SEP.dir + " not loaded" + (SEP.err ? ": " + SEP.err : ""),
    "Pass " + pass + ", fail " + fail + ", untested " + (total - pass - fail) + " of " + total]
    .concat(lines.filter(function (l) { return l.indexOf("FAIL") === 0; }), lines.filter(function (l) { return l.indexOf("FAIL") !== 0; }));
}
function summary() {
  var pass = 0, fail = 0, lines = [], untested = [];
  T.forEach(function (t) {
    var r = store.r[t.id] || {};
    if (r.s === "pass") pass++; else if (r.s === "fail") fail++;
    var sp = r.s && r.sp ? tagText(t, r.sp) : "";
    if (r.s || r.n) lines.push((r.s ? r.s.toUpperCase() : "NOTE") + " " + label(t) + " " + t.title + (sp ? " [" + sp + "]" : "") + (r.n ? " - " + r.n.replace(/\\s+/g, " ") : ""));
    else untested.push(label(t));
  });
  var g = Object.keys(store.g).filter(function (k) { return store.g[k]; });
  var out = ["Beast Sound Check results", new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", navigator.userAgent,
    "Global checklist ticked: " + (g.length ? g.join(", ") : "none"), ""].concat(realSummary(), ["", "Engine tests (onchain-midi-player's reference Beast page)",
    "Player " + meta.playerVersion + ", " + meta.ompCommit + "; music " + meta.beastCommit + "; built " + (meta.generated || "").slice(0, 16),
    labOn() ? "Design lab override (not the shipped page): " + labText() : "Play button: shipped settings",
    "Animation speed now: " + (store.speed ? SPEEDS[store.speed].label + " (one frame per " + SPEEDS[store.speed].note + ") on every animated Beast" : "shipped (an eighth note per frame, a quarter note above 150 BPM)") + "; a rated track shows the art and speed it was rated with",
    "Pass " + pass + ", fail " + fail + ", untested " + (T.length - pass - fail) + " of " + T.length]);
  return out.concat(lines.filter(function (l) { return l.indexOf("FAIL") === 0; }), lines.filter(function (l) { return l.indexOf("FAIL") !== 0; }),
    ["", "Untested engine tests: " + (untested.length ? untested.join(" ") : "none")]).join("\\n");
}
$("export").addEventListener("click", function () {
  var text = summary(), box = $("exportbox"), ta = $("exporttext");
  function manual() { box.style.display = "block"; ta.value = text; ta.focus(); ta.select(); box.scrollIntoView({ block: "center" }); toast("Copy blocked: text shown below"); }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { box.style.display = "none"; toast("Results copied (" + text.length + " characters)"); }, manual);
      return;
    }
  } catch (e) {}
  try { ta.value = text; box.style.display = "block"; ta.select(); if (document.execCommand("copy")) { toast("Results copied"); return; } } catch (e) {}
  manual();
});
var clearArmed = 0;
$("clear").addEventListener("click", function () {
  if (!clearArmed) { clearArmed = 1; $("clear").textContent = "Tap again to clear"; setTimeout(function () { clearArmed = 0; $("clear").textContent = "Clear results"; }, 3000); return; }
  clearArmed = 0; $("clear").textContent = "Clear results"; store.r = {}; save();
  T.forEach(function (t) { paintRow(t.id); }); paintCounts(); paintRealRows(); go(curKey()); toast("Results cleared");
});

function paintLab() {
  if (!SHIP) { $("lab").hidden = true; return; }
  if (cur) return;
  $("lab").hidden = false;
  var l = store.lab || SHIP;
  $("lmin").value = l.min; $("lmax").value = l.max; $("ltarget").value = l.target; $("lfix").value = l.min; $("ls").value = l.s;
  $("vs").textContent = l.s + " card units (" + (l.s / 2.5).toFixed(1) + "% of the card's width)" + (l.s === SHIP.s ? " (shipped)" : "");
  $("vfix").textContent = l.min === l.max ? l.min + " px" + (SHIP.min === SHIP.max && l.min === SHIP.min ? " (shipped)" : "") : "off (follows the art)";
  $("vmin").textContent = l.min + " px" + (l.min === SHIP.min ? " (shipped)" : "");
  $("vmax").textContent = l.max + " px" + (l.max === SHIP.max ? " (shipped)" : "");
  $("vtarget").textContent = l.target + " px" + (l.target === SHIP.target ? " (shipped)" : "");
  paintNow();
  var b = $("labbadge"); b.hidden = !labOn(); b.textContent = labOn() ? "Design lab override, not the shipped page: " + labText() + "." : "";
}
// What the page will draw on this screen: the anchor's diameter (card units) times the card's scale
// (the art fills the frame as object-fit: contain does, 250 x 350 units), clamped to the limits
function paintNow() {
  if (!SHIP || !frame || cur) return;
  var l = labValues(), S = l.s, r = frame.getBoundingClientRect(), k = Math.min(r.width / 250, r.height / 350);
  var art = S * k, d = Math.min(l.max, Math.max(l.min, art));
  var why = l.min === l.max ? "fixed" : art < l.min ? "raised to the minimum" : art > l.max ? "capped at the maximum" : "the art's size, inside the limits";
  $("lnow").textContent = S > 0 ? "On this screen: the card is drawn at " + k.toFixed(2) + "x (frame " + Math.round(r.width) + " x " + Math.round(r.height) + " px), so the art asks for " + S + " units x " + k.toFixed(2) + " = " + art.toFixed(1) + " px. The button is " + Math.round(d) + " px (" + why + "), with a " + Math.max(l.target, Math.round(d)) + " px touch target." : "";
}
window.addEventListener("resize", paintNow);
function labValues() { var mn = +$("lmin").value, mx = +$("lmax").value; if (mx < mn) mx = mn; return { min: mn, max: mx, target: +$("ltarget").value, s: +$("ls").value }; }
["lmin", "lmax", "ltarget", "ls"].forEach(function (id) {
  $(id).addEventListener("input", function () { var keep = store.lab; store.lab = labValues(); paintLab(); store.lab = keep; });
  $(id).addEventListener("change", function () { store.lab = labValues(); if (!labOn()) store.lab = null; save(); paintLab(); reloadEngine(); });
});
$("lfix").addEventListener("input", function () { $("lmin").value = $("lmax").value = this.value; var keep = store.lab; store.lab = labValues(); paintLab(); store.lab = keep; });
$("lfix").addEventListener("change", function () { $("lmin").value = $("lmax").value = this.value; store.lab = labValues(); if (!labOn()) store.lab = null; save(); paintLab(); reloadEngine(); });
$("lreset").addEventListener("click", function () { store.lab = null; save(); paintLab(); reloadEngine(); });
paintLab();
$("alone").addEventListener("click", function () {
  var html = cur ? cur.html : pageOf(T[idx], variant());
  if (!html) { toast(cur && cur.err ? "Not opened: " + cur.err : "This Beast has not loaded yet."); return; }
  var url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  if (!window.open(url, "_blank")) toast("The browser blocked the new tab.");
});
// Start: the track in the URL's hash, else the last one shown, else the Genesis Warlock. An engine test shows at once;
// a real Beast once its set has opened (the newest set unless another was chosen), falling back to the first engine
// test when real Beasts cannot play here.
(function () {
  var want = (location.hash || "").slice(1) || store.last, engine = byId(want) >= 0;
  var dir = SEPD.sets.some(function (s) { return s.dir === store.set; }) ? store.set : SEPD.sets[0].dir;
  if (engine) go(want);
  else { panels(true); $("realctl").hidden = true; $("kick").textContent = "1 Beasts on Sepolia"; $("ttl").textContent = "Loading the rendition set\\u2026"; pwMsg("Loading the rendition set " + dir + "\\u2026"); }
  openSet(dir, function () {
    if (!engine && !go(want) && !go(DEFAULT_REAL)) go(T[0].id);
    paintPos();
  });
})();
})();
</script>
</body>
</html>
`;
const out = process.env.OUT || path.join(here, "..", "index.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out, html.length, "bytes");
