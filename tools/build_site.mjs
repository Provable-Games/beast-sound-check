#!/usr/bin/env node
// Stage 2: tracks.json -> index.html (one self-contained file, no network, no dependencies).
//   node build_site.mjs        (run gen_tracks.mjs first; see its header for the two repo checkouts)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(here, "tracks.json"), "utf8"));
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
  <label><input type="checkbox" data-g="pause"><span><b>Pause and resume.</b> Tap pause while a dense track plays. All sound must stop at once (no stuck notes) and the art freezes on the frame you last heard. Tap play: the music carries on from the same point and the art moves again in step with it.</span></label>${BGBLOCK}
</details>

<section class="card" id="cur" aria-live="polite">
  <div class="kicker" id="kick"></div>
  <h2 id="ttl"></h2>
  <p class="muted" id="blurb"></p>
  <div class="labbadge" id="labbadge" role="note" hidden></div>
  <div class="playerwrap" id="pw"></div>
  <div class="row artrow" role="group" aria-label="Art variant">
    <button id="aGif" aria-pressed="false">Art: original GIF</button>
    <button id="aSync" aria-pressed="true">Art: Synced</button>
  </div>
  <label class="cardsync"><input type="checkbox" id="cardSync"><span>Card synced (rim 16 beats, pulse 4 beats, logo 8 beats; Synced art only)</span></label>
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
  return F.head + labStyle() + engineTest() + sp(p.ws[0]) + F.gunzip + sp(p.ws[1]) + F.player + F.body + labArt(p.art) + t.d + sp(p.ws[2]) + (F.notes ? F.notes + sp(p.ws[3]) : "") + F.footer; }
function variant() { return store.art === "gif" ? 0 : store.card ? 2 : 1; }
var ENGINE_TEST = ${JSON.stringify(ENGINE_TEST)};
var TESTS = { meter: { hint: null, preroll: null }, big1: { hint: "playback", preroll: 1 }, big02: { hint: "playback", preroll: 0.2 },
  def1: { hint: "default", preroll: 1 }, def02: { hint: "default", preroll: 0.2 },
  bal1: { hint: "balanced", preroll: 1 }, n02_1: { hint: 0.02, preroll: 1 }, n05_1: { hint: 0.05, preroll: 1 },
  def1k: { hint: "default", preroll: 1, k: true }, n05_1k: { hint: 0.05, preroll: 1, k: true } };
function engineTest() { var m = TESTS[store.test]; if (!m) return "";
  return "<script>(" + ENGINE_TEST + ")(" + JSON.stringify({ key: store.test, hint: m.hint, preroll: m.preroll, k: !!m.k }) + ");</scr" + "ipt>"; }
var store = { r: {}, g: {}, last: "", art: "synced", card: false, lab: null, test: "", v: 1 };
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
  if (o.lab && typeof o.lab === "object" && [o.lab.min, o.lab.max, o.lab.target, o.lab.s].every(function (x) { return typeof x === "number" && x > 0; })) store.lab = { min: o.lab.min, max: o.lab.max, target: o.lab.target, s: o.lab.s }; store.card = !!o.card; store.test = TESTS[o.test] ? o.test : "";
} } } catch (e) {}
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }
save();
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
var idx = 0, frame = null, noteTimer = 0;

function byId(id) { for (var i = 0; i < T.length; i++) if (T[i].id === id) return i; return -1; }
function label(t) { return t.sectionId + "." + t.id.slice(1); }

$("intro").textContent = T.length + " tracks. Each is the complete animation_url page of onchain-midi-player " + (D.meta.playerVersion) + "'s reference Beast consumer (the player's engine, the NFT's own controls, art sync and background audio, the track's settings, MIDI and art), embedded in a sandboxed frame, and every track has its own animated Beast (all 75 genesis species appear). The art defaults to Synced (sprite sheet stepped on the beat and seeked to the music); switch to the original GIF to compare (a GIF runs on its own clock). Results are saved on this device.";
var meta = D.meta || {};
$("foot").textContent = "Player " + meta.playerVersion + ", " + (meta.beastCommit || "") + ", " + (meta.ompCommit || "") + ". Generated " + (meta.generated || "").slice(0, 10) + ".";

// global checklist
Array.prototype.forEach.call(document.querySelectorAll("[data-g]"), function (cb) {
  cb.checked = !!store.g[cb.getAttribute("data-g")];
  cb.addEventListener("change", function () { store.g[cb.getAttribute("data-g")] = cb.checked; save(); gsum(); });
});
function gsum() { var n = Object.keys(store.g).filter(function (k) { return store.g[k]; }).length; $("gsum").textContent = "Global checklist (do once): " + n + " of " + document.querySelectorAll("[data-g]").length + " ticked"; }
gsum();
if (!Object.keys(store.g).some(function (k) { return store.g[k]; }) && !Object.keys(store.r).length) $("global").open = true;

// list
var listEl = $("list"), rows = {}, secCount = {};
(function build() {
  var cur = null, body = null;
  T.forEach(function (t, i) {
    if (!cur || cur.id !== t.sectionId) {
      var d = el("details"); var s = el("summary"); s.appendChild(el("span", "", t.sectionId + " " + t.section)); var n = el("span", "n", ""); s.appendChild(n); d.appendChild(s);
      listEl.appendChild(d); cur = { id: t.sectionId, d: d, n: n }; secCount[t.sectionId] = { n: n, total: 0, ids: [] }; body = d;
    }
    secCount[t.sectionId].total++; secCount[t.sectionId].ids.push(t.id);
    var b = el("button", "trk"); b.type = "button";
    b.appendChild(el("span", "id", label(t))); b.appendChild(el("span", "t", t.title)); var st = el("span", "s", "");
    b.appendChild(st); rows[t.id] = { b: b, st: st, d: body };
    b.addEventListener("click", function () { go(i, true); window.scrollTo({ top: 0, behavior: "smooth" }); });
    body.appendChild(b);
  });
})();

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
T.forEach(function (t) { paintRow(t.id); }); paintCounts();

function mountFrame(t) {
  var pw = $("pw");
  if (frame) { try { frame.srcdoc = ""; } catch (e) {} frame.remove(); frame = null; }
  pw.textContent = "";
  var f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-scripts");
  f.setAttribute("allow", "autoplay");
  f.setAttribute("title", "Player: " + t.title);
  f.srcdoc = pageOf(t, variant());
  pw.appendChild(f); frame = f; paintNow();
}

function go(i, doScroll) {
  if (i < 0 || i >= T.length) return;
  idx = i; var t = T[i];
  $("kick").textContent = t.sectionId + " " + t.section + "  \\u00b7  " + label(t);
  $("ttl").textContent = t.title;
  $("blurb").textContent = t.blurb;
  var ul = $("checks"); ul.textContent = "";
  t.checks.forEach(function (c) { ul.appendChild(el("li", "", c)); });
  var r = store.r[t.id] || {};
  $("bp").setAttribute("aria-pressed", r.s === "pass" ? "true" : "false");
  $("bf").setAttribute("aria-pressed", r.s === "fail" ? "true" : "false");
  $("note").value = r.n || "";
  $("pos").textContent = (i + 1) + " / " + T.length;
  paintArt();
  Object.keys(rows).forEach(function (id) { rows[id].b.classList.toggle("cur", id === t.id); });
  var row = rows[t.id]; if (row && row.d && !row.d.open && doScroll) { /* keep lists as the user left them */ }
  mountFrame(t);
  store.last = t.id; save();
  try { history.replaceState(null, "", "#" + t.id); } catch (e) {}
}

function paintArt() {
  var t = T[idx], a = t.art, synced = store.art !== "gif";
  $("aGif").setAttribute("aria-pressed", synced ? "false" : "true");
  $("aSync").setAttribute("aria-pressed", synced ? "true" : "false");
  $("cardSync").checked = !!store.card; $("cardSync").disabled = !synced;
  $("artinfo").textContent = "Beast: " + a.name + " (" + (a.shiny ? "shiny" : "regular") + ", " + (a.animated === false ? "static, PNG " + a.spriteBytes + " B" : "animated, " + a.frames + " frames; GIF " + a.gifBytes + " B, sprite sheet " + a.spriteBytes + " B; frame " + a.frameMs + " ms") + "); tempo " + a.bpm + " BPM. The song's notes scroll behind it.";
}
function setArt(mode, card) {
  if (mode !== undefined) store.art = mode;
  if (card !== undefined) store.card = card;
  save(); paintArt(); mountFrame(T[idx]);
}
$("aGif").addEventListener("click", function () { setArt("gif"); });
$("aSync").addEventListener("click", function () { setArt("synced"); });
$("cardSync").addEventListener("change", function () { setArt(undefined, $("cardSync").checked); });
// Engine test: ?test=<mode> in the URL selects one too (for a link to send).
(function () { var q = /[?&]test=([a-z0-9_]+)/.exec(location.search); if (q && TESTS[q[1]]) store.test = q[1]; })();
function paintTest() { $("etest").value = store.test; $("etestinfo").textContent = store.test ? "Engine test on: the meter is at the top left of the player. Reload the track after changing the mode (choosing it here does)." : ""; }
$("etest").addEventListener("change", function () { store.test = TESTS[$("etest").value] ? $("etest").value : ""; save(); paintTest(); mountFrame(T[idx]); });
paintTest();
function setRate(s) {
  var t = T[idx], r = store.r[t.id] || (store.r[t.id] = {});
  r.s = r.s === s ? "" : s;
  $("bp").setAttribute("aria-pressed", r.s === "pass" ? "true" : "false");
  $("bf").setAttribute("aria-pressed", r.s === "fail" ? "true" : "false");
  save(); paintRow(t.id); paintCounts();
}
$("bp").addEventListener("click", function () { setRate("pass"); });
$("bf").addEventListener("click", function () { setRate("fail"); });
$("note").addEventListener("input", function () {
  var id = T[idx].id; clearTimeout(noteTimer);
  var v = $("note").value;
  noteTimer = setTimeout(function () { var r = store.r[id] || (store.r[id] = {}); r.n = v; save(); paintRow(id); }, 300);
});
$("note").addEventListener("blur", function () { var id = T[idx].id, r = store.r[id] || (store.r[id] = {}); r.n = $("note").value; save(); paintRow(id); });
$("prev").addEventListener("click", function () { go((idx + T.length - 1) % T.length, true); });
$("next").addEventListener("click", function () { go((idx + 1) % T.length, true); });

function toast(msg, ms) { var t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(function () { t.style.display = "none"; }, ms || 2500); }

function summary() {
  var pass = 0, fail = 0, lines = [], untested = [];
  T.forEach(function (t) {
    var r = store.r[t.id] || {};
    if (r.s === "pass") pass++; else if (r.s === "fail") fail++;
    if (r.s || r.n) lines.push((r.s ? r.s.toUpperCase() : "NOTE") + " " + label(t) + " " + t.title + (r.n ? " - " + r.n.replace(/\\s+/g, " ") : ""));
    else untested.push(label(t));
  });
  var g = Object.keys(store.g).filter(function (k) { return store.g[k]; });
  var out = ["Beast Sound Check results", new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", navigator.userAgent,
    "Player " + meta.playerVersion + ", " + meta.ompCommit + "; music " + meta.beastCommit + "; built " + (meta.generated || "").slice(0, 16),
    labOn() ? "Design lab override (not the shipped page): " + labText() : "Play button: shipped settings", "",
    "Pass " + pass + ", fail " + fail + ", untested " + (T.length - pass - fail) + " of " + T.length,
    "Global checklist ticked: " + (g.length ? g.join(", ") : "none"), ""];
  return out.concat(lines.filter(function (l) { return l.indexOf("FAIL") === 0; }), lines.filter(function (l) { return l.indexOf("FAIL") !== 0; }),
    ["", "Untested: " + (untested.length ? untested.join(" ") : "none")]).join("\\n");
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
  T.forEach(function (t) { paintRow(t.id); }); paintCounts(); go(idx); toast("Results cleared");
});

function paintLab() {
  if (!SHIP) { $("lab").hidden = true; return; }
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
  if (!SHIP || !frame) return;
  var l = labValues(), S = l.s, r = frame.getBoundingClientRect(), k = Math.min(r.width / 250, r.height / 350);
  var art = S * k, d = Math.min(l.max, Math.max(l.min, art));
  var why = l.min === l.max ? "fixed" : art < l.min ? "raised to the minimum" : art > l.max ? "capped at the maximum" : "the art's size, inside the limits";
  $("lnow").textContent = S > 0 ? "On this screen: the card is drawn at " + k.toFixed(2) + "x (frame " + Math.round(r.width) + " x " + Math.round(r.height) + " px), so the art asks for " + S + " units x " + k.toFixed(2) + " = " + art.toFixed(1) + " px. The button is " + Math.round(d) + " px (" + why + "), with a " + Math.max(l.target, Math.round(d)) + " px touch target." : "";
}
window.addEventListener("resize", paintNow);
function labValues() { var mn = +$("lmin").value, mx = +$("lmax").value; if (mx < mn) mx = mn; return { min: mn, max: mx, target: +$("ltarget").value, s: +$("ls").value }; }
["lmin", "lmax", "ltarget", "ls"].forEach(function (id) {
  $(id).addEventListener("input", function () { var keep = store.lab; store.lab = labValues(); paintLab(); store.lab = keep; });
  $(id).addEventListener("change", function () { store.lab = labValues(); if (!labOn()) store.lab = null; save(); paintLab(); mountFrame(T[idx]); });
});
$("lfix").addEventListener("input", function () { $("lmin").value = $("lmax").value = this.value; var keep = store.lab; store.lab = labValues(); paintLab(); store.lab = keep; });
$("lfix").addEventListener("change", function () { $("lmin").value = $("lmax").value = this.value; store.lab = labValues(); if (!labOn()) store.lab = null; save(); paintLab(); mountFrame(T[idx]); });
$("lreset").addEventListener("click", function () { store.lab = null; save(); paintLab(); mountFrame(T[idx]); });
paintLab();
$("alone").addEventListener("click", function () {
  var url = URL.createObjectURL(new Blob([pageOf(T[idx], variant())], { type: "text/html" }));
  if (!window.open(url, "_blank")) toast("The browser blocked the new tab.");
});
var start = byId((location.hash || "").slice(1)); if (start < 0) start = byId(store.last); if (start < 0) start = 0;
go(start);
})();
</script>
</body>
</html>
`;
const out = process.env.OUT || path.join(here, "..", "index.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out, html.length, "bytes");
