#!/usr/bin/env node
// Ear-test pairs for k-rate detune: one score through the real pocket-synth engine, rendered offline twice, with
// every oscillator's detune AudioParam a-rate (the default) and k-rate (what the engine test's def1k and n05_1k
// modes do), written as mono 16-bit WAVs plus a page that plays each pair side by side.
//
//   cd tools && npm install --no-save node-web-audio-api    (tools/node_modules is ignored; Linux also needs libasound.so.2)
//   TINYSYNTH=<pocket-synth checkout>/webaudio-tinysynth.js node tools/k_rate_samples.mjs
//
// The k-rate wrapper is the engine test's (build_site.mjs), applied to the context instead of its prototype. Rendering is
// dry (no reverb), the most revealing setting. k-rate has Chromium's meaning: a connected AudioParam uses the first
// sample of its input for the whole 128-frame quantum, so the vibrato steps every 128 frames (2.7 ms at 48 kHz).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
if (!process.env.TINYSYNTH) { console.error("set TINYSYNTH to pocket-synth's webaudio-tinysynth.js (see the header)"); process.exit(2); }
const Synth = require(path.resolve(process.env.TINYSYNTH));
const OUT = process.env.OUT || path.join(here, "..", "samples", "k-rate");
const SR = 48000;

// The pairs. Channel 0 plays General MIDI program `prog` (0-based, quality 1 FM), installed over by `timbre` when given
// (the plain sawtooth below, which leaves the vibrato nothing to hide behind). ev: [seconds, MIDI bytes].
// kFirst: whether file 1 is the k-rate one (fixed here so the page can hide it).
const SAW = [{ w: "sawtooth", v: 0.6, a: 0.01, d: 0.3, s: 0.8, r: 0.15 }];
const PAIRS = [
  { id: "vib-moderate", title: "Held note, vibrato at moderate depth", prog: 80, timbre: SAW, dur: 2.6, kFirst: true,
    listen: "A held plain sawtooth (A4) with the engine's 5 Hz vibrato at CC1 = 48, about 38 cents each way. Listen for a buzz, roughness or grainy edge on the vibrato in one of the two, especially in the upper harmonics.",
    ev: [[0, [0xB0, 1, 48]], [0.1, [0x90, 69, 100]], [2.4, [0x80, 69, 0]]] },
  { id: "vib-full", title: "Held note, vibrato at full depth", prog: 80, timbre: SAW, dur: 2.6, kFirst: false,
    listen: "The same note at CC1 = 127, 100 cents each way, the deepest the engine goes. The pitch changes fastest at the vibrato's zero crossings, which is where a staircase would show most.",
    ev: [[0, [0xB0, 1, 127]], [0.1, [0x90, 69, 100]], [2.4, [0x80, 69, 0]]] },
  { id: "bend-sweep", title: "Slow pitch bend sweep", prog: 80, timbre: SAW, dur: 3.6, kFirst: true, bend: [0.2, 3.0],
    listen: "The same note glides up two semitones, down to two below its start, then back, as 200 pitch bend messages a second over 3 s. Listen for the glide sounding stepped or rough in one of the two.",
    ev: [[0.1, [0x90, 69, 100]], [3.4, [0x80, 69, 0]]] },
  { id: "bell-vibrato", title: "FM bell with vibrato", prog: 14, dur: 4.4, kFirst: false,
    listen: "Two struck tubular bells (C5, then G5) with CC1 = 64, about 50 cents each way. The bell's partials are the highest frequencies here, where the same pitch step is the most Hz.",
    ev: [[0, [0xB0, 1, 64]], [0.1, [0x90, 72, 100]], [1.4, [0x90, 79, 100]], [4.2, [0x80, 72, 0]], [4.2, [0x80, 79, 0]]] },
];

let wrapped = 0;
// The engine test's wrapper: every oscillator and buffer source gets a k-rate detune (guarded; a buffer source's is k-rate by the spec).
function kRate(ctx) {
  for (const m of ["createOscillator", "createBufferSource"]) {
    const f = ctx[m];
    ctx[m] = function () { const n = f.apply(this, arguments); try { n.detune.automationRate = "k-rate"; wrapped++; } catch (e) { /* no automationRate */ } return n; };
  }
}

async function render(pair, k) {
  const ctx = new OfflineAudioContext(1, Math.round(pair.dur * SR), SR);
  if (k) kRate(ctx);
  const s = new Synth({ context: ctx, useReverb: false });
  if (pair.timbre) s.setTimbre(0, pair.prog, pair.timbre);
  s.setProgram(0, pair.prog);
  for (const [t, m] of pair.ev) s.send(m, t);
  if (pair.bend) {      // 0 -> +2 -> -2 -> 0 semitones as a triangle, a message every 5 ms after the note has started
    const [t0, len] = pair.bend;
    for (let i = 0; i * 0.005 <= len; i++) {
      const ph = i * 0.005 / len, x = ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4, v = Math.round(8192 + x * 8191);
      s.send([0xE0, v & 127, v >> 7], t0 + i * 0.005);
    }
  }
  const buf = await ctx.startRendering();
  await s.dispose();
  return Float32Array.from(buf.getChannelData(0));
}

function wav(x, gain) {
  const n = x.length, b = Buffer.alloc(44 + 2 * n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + 2 * n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(2 * SR, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(2 * n, 40);
  const fade = Math.round(0.02 * SR);
  for (let i = 0; i < n; i++) { const f = i >= n - fade ? (n - i) / fade : 1; b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * gain * f * 32767))), 44 + 2 * i); }
  return b;
}

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const pair of PAIRS) {
  const a = await render(pair, false), before = wrapped, k = await render(pair, true);
  if (wrapped === before) throw new Error(pair.id + ": the k-rate wrapper made no node");
  let peak = 0, d = 0;
  for (let i = 0; i < a.length; i++) { peak = Math.max(peak, Math.abs(a[i])); d += (a[i] - k[i]) ** 2; }
  if (!(peak > 0.01) || !(d > 0)) throw new Error(pair.id + ": silent or identical renders");
  const gain = 0.7 / peak, files = pair.kFirst ? [k, a] : [a, k];       // one gain per pair, so levels compare
  files.forEach((x, i) => fs.writeFileSync(path.join(OUT, `${pair.id}-${i + 1}.wav`), wav(x, gain)));
  console.log(`${pair.id}: ${a.length} frames, a-rate peak ${peak.toFixed(3)} (levelled to 0.7), k-rate is file ${pair.kFirst ? 1 : 2}`);
  rows.push(pair);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>k-rate detune ear test</title>
<style>
:root{color-scheme:light dark;font:16px/1.45 system-ui,sans-serif}
body{margin:0 auto;max-width:42rem;padding:1rem 16px 3rem}
h1{font-size:1.3rem;margin:.2rem 0 .6rem}
section{border-top:1px solid #8886;margin-top:1.2rem;padding-top:.6rem}
h2{font-size:1.05rem;margin:.2rem 0}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pair label{display:block;font-weight:600;margin-bottom:2px}
audio{width:100%}
details{margin-top:.5rem}
.muted{opacity:.75;font-size:.9rem}
@media (max-width:420px){.pair{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>k-rate detune ear test</h1>
<p>pocket-synth connects the vibrato oscillator (CC1) to every note's detune. Chrome normally recomputes the pitch for each audio sample (a-rate). With a <b>k-rate</b> detune it recomputes it once per 128 frames, which is cheaper, but the pitch then moves in steps 2.7 ms long (48 kHz). Each pair below is the same score through the real engine; one file is a-rate and one k-rate. Which is which is hidden until you open the answer.</p>
<p><b>How to listen.</b> Use headphones first, then the phone speaker. Play 1, then 2, then 1 again, a few times, and say whether you hear any difference and in which. Keep the volume the same for both. Note the pair, which one you picked, how sure you are, and your phone and Chrome version. If you cannot tell them apart, that is the result.</p>
<p class="muted">Rendered offline with the Node package node-web-audio-api, not Chrome, dry (no reverb), 48 kHz mono 16-bit, both files of a pair at the same gain. There a connected k-rate detune holds its first input sample for each 128-frame quantum, which is what Chrome's does too, but the oscillator itself is not Chrome's, and a phone's speaker and audio path are not this page's.</p>
${rows.map((p) => `<section id="${p.id}">
<h2>${esc(p.title)}</h2>
<p>${esc(p.listen)}</p>
<div class="pair">
<div><label>1</label><audio controls preload="none" src="${p.id}-1.wav"></audio></div>
<div><label>2</label><audio controls preload="none" src="${p.id}-2.wav"></audio></div>
</div>
<details><summary>Answer</summary><p>File ${p.kFirst ? 1 : 2} is k-rate, file ${p.kFirst ? 2 : 1} is a-rate.</p></details>
</section>`).join("\n")}
</body>
</html>
`);
console.log("wrote", OUT, "(" + fs.readdirSync(OUT).length + " files)");
process.exit(0);
