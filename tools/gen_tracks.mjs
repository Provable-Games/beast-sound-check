#!/usr/bin/env node
// Stage 1 of the listening-test site: builds tracks.json, the engine tests (one real animation_url page per track:
// TinyChip presets, drums, edge cases, stress ramps and the client chip bank). The real Beasts, section 1 of the
// page, are not built here: the page reads them from a Sepolia rendition set (renditions/, tools/rendition_set.mjs).
//
//   OMP=<onchain-midi-player checkout> BEAST=<midi_fun_contract checkout> BEASTS3=<beasts-v3 checkout> node gen_tracks.mjs
//
// OMP     an onchain-midi-player checkout at the player under test (0.7.0+), with `npm ci` run in it.
// BEAST   a midi_fun_contract checkout (main); offchain/beast-sound needs `npm install` (@scure/starknet).
//         Run installs in worktrees, never in someone's working checkout.
// BEASTS3 a beasts-v3 checkout for the card template and genesis GIFs (art.mjs).
// OMP_LABEL / BEAST_LABEL name those commits in the page's footer.
// BEAST_SONGS (optional) a midi_fun_contract checkout of Casey's branch whose Species Songs section 6 plays (the branch beast-editions at
//         the time of writing), with `npm install` in offchain/beast-sound; BEAST_SONGS_LABEL names the branch and commit. Without it
//         there is no section 6.
//
// Every page is the complete NFT-owned document of onchain-midi-player's reference Beast consumer
// (examples/beast_consumer: scripts/composition.mjs consumerPieces with the example's ALIGN options):
// head ++ gunzip ++ player ++ trusted body ++ art ++ D(settings, midi) ++ notes ++ footer (bootstrap: controls,
// art sync, background audio, media session). Each page is round-tripped through the spliced token_uri
// and decodeTokenUri, and the token_uri passes scripts/validate_token_uri.mjs, so the bytes are what a
// 0.7.0 Beast's animation_url would carry.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const need = (k) => process.env[k] || (console.error(`set ${k} (see the header)`), process.exit(2));
const OMP = need("OMP");
const BEAST = need("BEAST");
const BS = BEAST + "/offchain/beast-sound";
const imp = (p) => import(p);

const SEG = await imp(OMP + "/scripts/segments.mjs");
const CMP = await imp(OMP + "/scripts/composition.mjs");
const { ALIGN } = await imp(OMP + "/examples/beast_consumer/scripts/reference.mjs");
const { validateTokenUri } = await imp(OMP + "/scripts/validate_token_uri.mjs");
const SF = await imp(OMP + "/scripts/settings_fixtures.mjs");
const RW = await imp(OMP + "/scripts/reference_waves.mjs");
const SS = await imp(BS + "/onchain/tinychip/synth_settings.mjs");
const ES = await imp(BS + "/onchain/tinychip/essentials.mjs");
// Casey's branch for section 6 (its own copy of beast-sound: engine, lab, settings generator)
const BEAST_SONGS = process.env.BEAST_SONGS || "";
const SONGS = BEAST_SONGS && {
  label: need("BEAST_SONGS_LABEL"),
  idx: await imp(BEAST_SONGS + "/offchain/beast-sound/src/index.js"), v11: await imp(BEAST_SONGS + "/offchain/beast-sound/src/engine_v11.js"),
  lab: await imp(BEAST_SONGS + "/offchain/beast-sound/src/lab.js"), ss: await imp(BEAST_SONGS + "/offchain/beast-sound/onchain/tinychip/synth_settings.mjs"),
};

import * as ART from "./art.mjs";
const { TABLES } = await imp(BS + "/src/index.js");
const { genesisTier, genesisType } = await imp(BS + "/src/engine.js");
const bank = ES.loadBank();
const DATA = ES.bankData(bank);
const ESSENTIALS = ES.ESSENTIALS;
const DRUM_KEYS = Object.keys(DATA.drums).map(Number);
const pname = (id) => bank.PRESETS[id].name;
const dname = (k) => bank.DRUMS[k][0];

// ---------------------------------------------------------------------------------------------
// A small SMF writer (format 1, 480 ppq): tempo track plus one track per channel used.
// ---------------------------------------------------------------------------------------------
const PPQ = 480, BEAT = 480, BAR = 1920, SEC120 = 960; // ticks per second at 120 BPM
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const chunk = (type, data) => [...type].map((c) => c.charCodeAt(0)).concat([(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255], data);

class Song {
  constructor(bpm = 120) { this.tempoUs = Math.round(60e6 / bpm); this.tempos = []; this.ch = Array.from({ length: 16 }, () => []); this.maxOff = 0; }
  push(ch, t, prio, bytes) { this.ch[ch].push({ t: Math.round(t), prio, bytes }); }
  on(ch, t, n, v, dur) { this.push(ch, t, 2, [0x90 | ch, n, v]); this.push(ch, t + dur, 0, [0x80 | ch, n, 64]); this.maxOff = Math.max(this.maxOff, t + dur); }
  cc(ch, t, c, v) { this.push(ch, t, 1, [0xb0 | ch, c, v]); }
  pc(ch, t, p) { this.push(ch, t, 1, [0xc0 | ch, p]); }
  bend(ch, t, v) { v = Math.max(0, Math.min(16383, Math.round(v))); this.push(ch, t, 1, [0xe0 | ch, v & 127, v >> 7]); }
  tempo(t, bpm) { this.tempos.push({ t, us: Math.round(60e6 / bpm) }); }
  setup(ch, program, { vol = 100, pan = 64 } = {}) { if (ch !== 9) this.pc(ch, 0, program); this.cc(ch, 0, 7, vol); this.cc(ch, 0, 10, pan); }
  // drum hit: note-on only (hits are one-shots)
  hit(t, n, v) { this.push(9, t, 2, [0x99, n, v]); }
  bytes(end) {
    if (this.maxOff > end) throw new Error(`note ends at ${this.maxOff}, after the loop end ${end}`);
    const track = (events, first) => {
      const data = []; let t = 0;
      for (const e of events) { data.push(...vlq(e.t - t), ...e.bytes); t = e.t; }
      data.push(...vlq(end - t), 0xff, 0x2f, 0x00);
      return data;
    };
    const tempoEv = [{ t: 0, bytes: [0xff, 0x51, 0x03, (this.tempoUs >> 16) & 255, (this.tempoUs >> 8) & 255, this.tempoUs & 255] },
      ...this.tempos.map((x) => ({ t: x.t, bytes: [0xff, 0x51, 0x03, (x.us >> 16) & 255, (x.us >> 8) & 255, x.us & 255] }))];
    const tracks = [track(tempoEv)];
    this.ch.forEach((evs) => {
      if (!evs.length) return;
      evs.sort((a, b) => a.t - b.t || a.prio - b.prio);
      tracks.push(track(evs));
    });
    const header = chunk("MThd", [0, 1, 0, tracks.length, PPQ >> 8, PPQ & 255]);
    return Uint8Array.from(header.concat(...tracks.map((d) => chunk("MTrk", d))));
  }
}

// ---------------------------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------------------------
const PALETTE = { beast: "#7a3b1e", preset: "#2b5d8a", drum: "#8a2b4f", edge: "#2e6b4f", bank: "#5b4a8a" };
const plainArt = (title, sub, color) => `<svg xmlns='http://www.w3.org/2000/svg' width='350' height='350' viewBox='0 0 350 350'><rect width='350' height='350' fill='${color}'/><text x='175' y='165' text-anchor='middle' fill='#fff' font-family='monospace' font-size='20'>${esc(title)}</text><text x='175' y='195' text-anchor='middle' fill='#ddd' font-family='monospace' font-size='14'>${esc(sub)}</text></svg>`;
function esc(s) { return String(s).replace(/[<>&']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;" }[c])); }

// 150 BPM: an eighth note is 0.2 s. Eight frames, each lit for exactly 0.2 s, period 1.6 s = one bar.
function syncArt() {
  const frames = 8, dt = 0.2;
  const cells = Array.from({ length: frames }, (_, i) => {
    const vals = Array.from({ length: frames }, (_, j) => (j === i ? "visible" : "hidden")).join(";");
    const x = 20 + i * 40;
    return `<g><rect x='${x}' y='60' width='36' height='60' fill='#333'/><text x='${x + 18}' y='160' text-anchor='middle' fill='#aaa' font-family='monospace' font-size='16'>${i + 1}</text>` +
      `<rect x='${x}' y='60' width='36' height='60' fill='${i % 2 ? "#3aa0ff" : "#ffd24a"}' visibility='hidden'><animate attributeName='visibility' values='${vals}' dur='${frames * dt}s' calcMode='discrete' repeatCount='indefinite'/></rect></g>`;
  }).join("");
  const big = Array.from({ length: frames }, (_, i) => {
    const vals = Array.from({ length: frames }, (_, j) => (j === i ? "visible" : "hidden")).join(";");
    return `<text x='175' y='290' text-anchor='middle' fill='#fff' font-family='monospace' font-size='96' visibility='hidden'>${i + 1}<animate attributeName='visibility' values='${vals}' dur='${frames * dt}s' calcMode='discrete' repeatCount='indefinite'/></text>`;
  }).join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' width='350' height='350' viewBox='0 0 350 350'><rect width='350' height='350' fill='#111'/>${cells}<text x='175' y='30' text-anchor='middle' fill='#fff' font-family='monospace' font-size='14'>150 BPM: 1 frame = 1 eighth = 0.2 s</text><text x='175' y='200' text-anchor='middle' fill='#ffd24a' font-family='monospace' font-size='13'>kick on 1 + 5, snare on 3 + 7, hat on every frame</text>${big}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Track registry
// ---------------------------------------------------------------------------------------------
const tracks = [];
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const warn = [];
// ---- Beast art allocation: every track gets its own genesis species (75), the card shows that Beast.
// Section 1 and the tempo lab pick species up front; the other tracks take the rest in order, alternating
// regular and shiny. Tracks beyond the 75 species reuse a species with the other variant.
const TYPE_NAMES = ["Magic", "Hunter", "Brute"];
const sp = (id) => ({ tier: genesisTier(id), type: genesisType(id), name: TABLES.species[id - 1] });
const reserved = new Set([1, 53]); // e2e Warlock and e2e heaviest
const cardBeast = (id, shiny, extra = {}, animated = true) => {
  const t = sp(id), level = 20 + ((id * 7) % 60);
  const prefix = 1 + ((id * 7) % 69), suffix = 1 + ((id * 11) % 18);
  return { id, prefix, suffix, rank: 100 + id * 7, level, health: 100 + ((id * 13) % 300), shiny: shiny ? 1 : 0, animated: animated ? 1 : 0, tier: t.tier, beast_type: t.type, ...extra };
};
let artQueue = null; const usedArt = [], dealt = [];
function nextArt(prefN) {
  if (!artQueue) throw new Error("art queue not built");
  if (!artQueue.length) artQueue = dealt.splice(0).map((q) => ({ id: q.id, shiny: !q.shiny, animated: q.animated })); // all dealt: the other variants
  let k = prefN ? artQueue.findIndex((q) => ART.speciesArt(q.id, q.shiny, q.animated).n === prefN) : 0;
  if (k < 0) k = 0;
  const a = artQueue.splice(k, 1)[0]; if (!a) throw new Error("art queue empty");
  dealt.push(a);
  return a;
}
// Tracks are specified first (the Beast art is allocated in call order) and built at the end, so that the
// music of two tracks can be swapped without touching their art or position (SWAP below).
const specs = [];
function add({ section, title, blurb, checks, settings, midi, beast: beastIn, strings: stringsIn, pref, lean }) {
  const id = `${section[0]}${String(specs.filter((t) => t.section[0] === section[0]).length + 1).padStart(2, "0")}`;
  const pick = beastIn ? { beast: beastIn, shiny: !!beastIn.shiny } : nextArt(pref);
  specs.push({ id, section, title, blurb, checks, settings, midi, pick, stringsIn, lean });
  return id;
}
function build({ id, section, title, blurb, checks, settings, midi, pick, stringsIn, lean }) {
  const beast = pick.beast || cardBeast(pick.id, pick.shiny, {}, pick.animated !== false);
  const art = ART.speciesArt(beast.id, !!beast.shiny, beast.animated !== 0);
  const tempoUs = ART.midiTempoUs(midi), bpm = 60e6 / tempoUs;
  const bpmText = `${+bpm.toFixed(2)} BPM`;
  // the card shows the Beast's canonical name; the test label is the site's track title
  const strings = stringsIn || { name: TABLES.species[beast.id - 1], type: TYPE_NAMES[beast.beast_type], prefix: TABLES.prefixes[beast.prefix - 1], suffix: TABLES.suffixes[beast.suffix - 1] };
  if (!stringsIn) title = `${title} \u00b7 ${bpmText}`;
  usedArt.push({ id: beast.id, shiny: !!beast.shiny, track: id });
  // lean: the original GIF only (one page, not three), for a section of many tracks; its title already names the Beast
  const variants = (lean ? [["gif", false]] : [["gif", false], ["synced", false], ["synced", true]]).map(([mode, cardSync]) => ART.card({ beast, art, tempoUs, mode, cardSync, strings, mediaTitle: lean ? title : `${title} (${strings.name})` }));
  const anchor = (/data-play-anchor="([^"]*)"/.exec(variants[lean ? 0 : 1]) || [])[1];
  if (!anchor || (playAnchor && anchor !== playAnchor)) throw new Error(`${title}: the art's data-play-anchor differs between tracks`);
  playAnchor = anchor;
  const { d, settings_len } = SEG.dFragment(midi, settings);
  const mem = `"name":"${jsonText(title)}","description":"${jsonText(blurb)}","attributes":[{"trait_type":"Track","value":"${id}"}]`;
  const pages = variants.map((svg, vi) => {
    const p = CMP.consumerPieces(mem, svg, { midi, settings, ...ALIGN });
    if (p.d !== d) throw new Error(`${title}: data fragment differs`);
    // what a marketplace decodes from the spliced token_uri must be the composed document
    if (!SEG.decodeTokenUri(p.uri).htmlBytes.equals(Buffer.from(p.html, "utf8"))) throw new Error(`${title}: token_uri round trip differs from the composed page`);
    if (vi === (lean ? 0 : 1)) {
      const r = validateTokenUri({ uri: p.uri });
      const fails = r.checks.filter((c) => c.level === "fail");
      if (fails.length) throw new Error(`${title}: validate_token_uri: ` + fails.map((c) => `${c.id}: ${c.message}`).join("; "));
      for (const c of r.checks) if (c.level === "warn" && !/attributes/.test(c.id)) warn.push(`${id} ${c.id}: ${c.message}`);
    }
    const sp = splitPage(p.html, p.art, d, title);
    return lean ? { ...sp, ...cutFont(sp.art) } : sp;
  });
  const fl = ART.frameUs(art.n, tempoUs);
  const sub = tempoUs / 2 < 200000 ? "quarter note (the eighth would be under 0.2 s)" : "eighth note";
  const notesCheck = "Notes: the song's own MIDI scrolls right to left behind the Beast in the art frame, one colour per channel, drums as ticks along the bottom; each note sounds as it reaches the playhead near the left edge. They stand still before play, freeze on pause, and loop with the music.";
  const artChecks = lean ? [notesCheck, `Art: the ${strings.name}'s ${beast.shiny ? "shiny" : "regular"} genesis GIF (${art.n} frames), an isolated image in the card's art frame on its own clock; this section has no Synced variant (one art variant keeps the page small).`] : !art.animated ? [notesCheck, `Static Beast: ${strings.name}, ${beast.shiny ? "shiny" : "regular"} (the genesis PNG, no animation). The art buttons all show the same picture.`] : [notesCheck,
    `At the shipped animation speed, art frames flip on the eighth notes (quarter notes above 150 BPM); the Animation speed row tries others. Synced art, the default: ${strings.name}, ${beast.shiny ? "shiny" : "regular"}, ${art.n} frames, one per ${sub} at ${bpm.toFixed(2)} BPM (${(fl / 1000).toFixed(1)} ms); ${art.n === 5 ? "5 frames cycle every 5 steps and realign only at the loop; " : art.n === 3 || art.n === 6 ? "the " + art.n + "-frame cycle does not divide a bar, so a downbeat falls on different frames within a pass; " : ""}no drift to the end of the pass.`,
    `The art snaps cleanly at each loop and looks identical to the GIF apart from timing. Tap "Original GIF" above to compare (its frames run at the GIF's own 0.2 s and slide against the music).${art.delays.some((x) => x !== art.delays[0]) ? " This species' GIF has uneven frame delays (" + art.delays.map((x) => x * 10).join("/") + " ms); the sprite uses regular frames." : ""}`,
  ];
  tracks.push({
    id, sectionId: section[0], section: section.slice(2), title, blurb, checks: [...checks, ...artChecks],
    midiBytes: midi.length, settingsBytes: settings_len,
    art: { id: beast.id, name: strings.name, shiny: !!beast.shiny, animated: !!art.animated, frames: art.n, gifBytes: art.gif ? art.gif.length : 0, spriteBytes: art.png.length, bpm: +bpm.toFixed(2), frameMs: +(fl / 1000).toFixed(1),
      // the exact tempo the sprite was timed with (the page retimes it for the Animation speed control) and the GIF's own frame delays
      tempoUs, gifMs: art.animated ? art.delays.map((x) => x * 10) : [] },
    d, pages,
  });
  return id;
}
// A lean track (one art variant: section 6) keeps its art with the card's embedded font cut out. The font is the same in
// every card (14.7 KB of base64 inside the SVG, which is base64 itself inside the art) but sits at one of three alignments of
// the outer base64, so `fonts` holds the three runs once and a page stores [position, alignment]; build_site.mjs puts it back
// by concatenation. It is most of a card's bytes and does not compress (gzip's window is smaller than a track), so this keeps
// 75 more tracks from adding about 1.2 MB to the download.
const FONTS = {};
function cutFont(art) {
  const m = /src="data:image\/svg\+xml;base64,([^"]+)"/.exec(art), at = m.index + 'src="data:image/svg+xml;base64,'.length;
  const buf = Buffer.from(m[1], "base64"), key = Buffer.from("font/woff2;base64,"), s0 = buf.indexOf(key) + key.length;
  if (s0 < key.length || buf.indexOf(key, s0) >= 0) throw new Error("the card does not embed exactly one font");
  const L = buf.indexOf(0x27, s0) - s0, k = Math.ceil(s0 / 3) * 3, shift = k - s0, n = Math.floor((L - shift) / 3) * 3;
  const run = buf.subarray(k, k + n).toString("base64"), pos = at + (k / 3) * 4;
  if (art.slice(pos, pos + run.length) !== run) throw new Error("the font run is not where its alignment says");
  if (FONTS[shift] !== undefined && FONTS[shift] !== run) throw new Error("the card's font differs between tracks");
  FONTS[shift] = run;
  const cut = { art: art.slice(0, pos) + art.slice(pos + run.length), f: [pos, shift] };
  if (cut.art.slice(0, pos) + FONTS[shift] + cut.art.slice(pos) !== art) throw new Error("the cut font does not restore the art");
  return cut;
}
// The composed page is FIXED.head ++ ws ++ FIXED.gunzip ++ ws ++ FIXED.player ++ FIXED.body ++ art ++ D ++ ws
// ++ FIXED.notes ++ ws ++ FIXED.footer, where each ws is the alignment whitespace consumerPieces adds (it depends
// on the token's JSON and art lengths). FIXED.notes (the notes drawn behind the art, onchain-midi-player #83) is
// there when the example's ALIGN asks for it; otherwise it is empty, with no ws. The fixed fragments are stored
// once; each track keeps its art, D and ws lengths.
const FIXED = {
  head: CMP.ownedFragment("head"), gunzip: SEG.fixedFragment("gunzip"), player: SEG.fixedFragment("player"),
  body: CMP.ownedFragment(ALIGN.trustedArt ? "trusted_body" : "body"), notes: ALIGN.notes ? CMP.ownedFragment("notes") : "",
  footer: CMP.ownedFragment("footer"),
};
let playAnchor = ""; // the art's data-play-anchor, the same on every card (art.mjs)
const jsonText = (x) => x.replace(/[\\"]/g, "\\$&").replace(/[\u0000-\u001f]/g, " ");
function splitPage(html, art, d, title) {
  const ws = [];
  let at = 0;
  const take = (frag, gap) => {
    if (gap) { let n = 0; while (html[at + n] === " ") n++; if (n % 9) throw new Error(`${title}: odd alignment gap ${n}`); ws.push(n / 9); at += n; }
    if (!html.startsWith(frag, at)) throw new Error(`${title}: page layout differs from head ++ gunzip ++ player ++ body ++ art ++ D ++ notes ++ footer at byte ${at}`);
    at += frag.length;
  };
  take(FIXED.head); take(FIXED.gunzip, true); take(FIXED.player, true); take(FIXED.body); take(art); take(d); if (FIXED.notes) take(FIXED.notes, true); take(FIXED.footer, true);
  if (at !== html.length) throw new Error(`${title}: trailing bytes`);
  return { art, ws };
}

const SEC = { preset: "2 TinyChip presets", drum: "3 Drums", edge: "4 General range and edge cases", bank: "5 Client chip bank (not onchain)" };
if (SONGS) SEC.songs = `6 Original species songs (production ${SONGS.label})`;

// =============================================================================================
// Section 1 is the real Beasts (Beasts on Sepolia), which the page reads from renditions/ at run time; it has no
// tracks here. Casey's compositions on the reference page, which used to be section 1, were removed, but the species
// they reserved stay reserved, so the engine tests below keep their art (the art queue deals the rest in order):
// the e2e Warlock and heaviest (1 and 53), and for each former composition slot [family, mega, tier, sections] the
// first genesis species of that family and tier (or of that family when no species has the tier).
// =============================================================================================
const SLOTS = [
  [0, 0, 5, 1], [1, 0, 4, 1], [2, 0, 3, 2], [0, 0, 2, 3], [1, 0, 1, 4], [2, 0, 2, 5], [1, 0, 3, 2],
  [0, 1, 4, 1], [1, 1, 5, 2], [2, 1, 1, 3], [0, 1, 3, 4], [1, 1, 2, 5], [2, 1, 4, 2], [0, 1, 2, 3],
];
for (const [type, , tier] of SLOTS) {
  let id = 1; while (id <= 75 && (reserved.has(id) || sp(id).type !== type || sp(id).tier !== tier)) id++;
  if (id > 75) { id = 1; while (reserved.has(id) || sp(id).type !== type) id++; }
  reserved.add(id);
}

// ---- the species queue for the other tracks: remaining species in order, alternating regular and shiny
// (each track gets its own species while they last; nextArt then deals the other variants), alternating shiny
// and regular, all animated: beasts-v3 has no static original art since #253
{
  const rest = []; for (let id = 1; id <= 75; id++) if (!reserved.has(id)) rest.push(id);
  artQueue = rest.map((id, i) => ({ id, shiny: i % 2 === 0, animated: true })); // every original is animated (beasts-v3 #228, #253)
}
// Tempo spread for raw-sound checks whose content does not depend on tempo, with a spread of frame counts
const TEMPOS = [90, 100, 120, 127.66, 131.87, 150, 175];
let tcycle = 0;
const nextTempo = () => { const i = tcycle++; return { bpm: TEMPOS[i % 7], pref: TEMPOS[i % 7] === 127.66 && !nextTempo.used5 ? (nextTempo.used5 = 5) : [2, 3, 4, 6][i % 4] }; };

// =============================================================================================
// 2. TinyChip onchain presets
// =============================================================================================
const WAVE_TEXT = { nP06: "6.25% pulse", nP12: "12.5% pulse", nP25: "25% pulse", nP37: "37.5% pulse", nP50: "50% pulse (square)", nTRI: "4-bit stepped triangle (NES)", nSAW: "4-bit saw", nN16: "N163 wavetable", triangle: "triangle", sine: "sine", square: "square", sawtooth: "saw" };
function presetFacts(ops) {
  const facts = [];
  const car = ops.filter((o) => !o.g);
  const mods = ops.filter((o) => o.g);
  const waves = [...new Set(car.map((o) => WAVE_TEXT[o.w] || o.w))];
  facts.push(`Sound: ${waves.join(" + ")}${car.length > 1 ? " layered" : ""}.`);
  const main = car[0];
  for (const m of mods) {
    if (m.t === 0 || m.t === undefined) facts.push(`Vibrato: ${m.f} Hz LFO, fading in over about ${(m.a ?? 0).toFixed(2)} s, so a short note stays straight and a held note starts to waver.`);
  }
  const dec = main.d ?? 0.01, sus = main.s ?? 0;
  if (sus === 0) facts.push(`Plucked: dies away in about ${(dec + (main.h ?? 0.01)).toFixed(2)} s even if the key is held; the held notes should not sustain.`);
  else if (sus < 1) facts.push(`Decays to ${(sus * 100).toFixed(0)}% level while held (about ${dec.toFixed(2)} s).`);
  else facts.push("Sustains at full level for as long as the key is held.");
  return facts;
}
const REG = { lead: 60, low: 48, mid: 60 };
function presetPhrase(song, id, base, { end, stac = 40 }) {
  song.setup(0, id);
  const major = [0, 2, 4, 5, 7, 9, 11, 12];
  let t = 0; const e = 240; // eighths
  // A (0:00): scale up and down, eighths
  [...major, ...major.slice(0, -1).reverse()].forEach((s, i) => song.on(0, t + i * e, base + s, 96, 200));
  // B (0:04): two held notes
  song.on(0, 4 * SEC120, base + 4, 100, 2 * SEC120 - 60);
  song.on(0, 6 * SEC120, base + 7, 100, 2 * SEC120 - 60);
  // C (0:08): arpeggio Am, eighths, two bars
  const arp = [9, 12, 16, 21, 16, 12, 9, 12, 16, 21, 24, 21, 16, 12, 9, 4];
  arp.forEach((s, i) => song.on(0, 8 * SEC120 + i * e, base - 12 + s, 96, 200));
  // D (0:12): staccato, 40-tick notes (about 42 ms) on eighths
  const st = [0, 4, 7, 12, 7, 4, 0, 4, 7, 12, 7, 4, 0, 7, 12, 4];
  st.forEach((s, i) => song.on(0, 12 * SEC120 + i * e, base + s, 100, stac));
  return end;
}
const PRESET_END = 16 * SEC120;
const presetSettings = new Map();
const settingsFor = (programs, drums = []) => SS.beastSynthSettings(DATA, programs, drums);
for (const id of ESSENTIALS) {
  const ops = DATA.presets[id];
  const { bpm, pref } = nextTempo(), f = 120 / bpm, T = (x) => fmtT(x * f);
  const song = new Song(bpm);
  const low = [14, 15, 16, 18].includes(id);
  const base = low ? 48 : 60;
  presetPhrase(song, id, base, { end: PRESET_END, stac: Math.round(40 * bpm / 120) });
  const slowAttack = ops.some((o) => o.g && (o.a ?? 0) >= 0.08);
  const checks = [
    ...presetFacts(ops),
    `${T(0)} scale: ${low ? "C3" : "C4"} up and down in eighths: steps are even and in tune.`,
    `${T(4)} held notes: two ${(2 * f).toFixed(1)}-second notes show the sustain or decay character.`,
    `${T(8)} arpeggio: Am broken chord, each note clean, no overlap smear.`,
    `${T(12)} staccato: very short notes (~40 ms). They must all sound as clean, short blips of pitch (none silent, none clicking)${slowAttack ? ", and straight in pitch (the vibrato has not faded in yet)" : ""}.`,
    `Loop at ${T(16)}: no gap, no click.`,
  ];
  if (SS.TIMBRE_TRIM[id]) checks.splice(checks.length - 1, 0, `Level: this pluck is trimmed (x${SS.TIMBRE_TRIM[id]}, ${(20 * Math.log10(SS.TIMBRE_TRIM[id])).toFixed(1)} dB) so its attack peaks at the same level as the other plucks (within about 0.4 dB), not louder than the lead presets: compare with a neighbouring pluck track.`);
  add({
    pref, section: "2 " + SEC.preset.slice(2), title: `${pname(id)} (${id})`,
    blurb: `Bank program ${id}; ${ops.length} operator${ops.length > 1 ? "s" : ""}; ${low ? "low register" : "mid register"} demo.`,
    checks, settings: settingsFor([id]), midi: song.bytes(PRESET_END),
    svg: plainArt(pname(id), `program ${id}`, PALETTE.preset),
  });
}

// =============================================================================================
// 3. Drums
// =============================================================================================
const DRUM_SETTINGS = settingsFor([], DRUM_KEYS);
function drumFact(k) {
  const waves = [...new Set(DATA.drums[k].map((o) => o.w))];
  const noisy = waves.filter((w) => w === "nNOI" || w === "nMET");
  const parts = waves.map((w) => ({ nNOI: "white noise (long LFSR)", nMET: "metallic noise (short LFSR, 93 steps)", nTRI: "stepped triangle body with a falling pitch", nP50: "50% pulse body" }[w] || w));
  return { noisy: noisy.length > 0, text: `${k} ${dname(k)}: ${parts.join(" + ")}` };
}
{
  // groove: 4 bars of rock beat, then a tom fill into a crash
  const { bpm: gbpm, pref: gpref } = nextTempo(), gf = 120 / gbpm, GT = (x) => fmtT(x * gf);
  const song = new Song(gbpm), END = 8 * BAR;
  song.setup(9, 0);
  for (let bar = 0; bar < 8; bar++) {
    const o = bar * BAR;
    for (let i = 0; i < 8; i++) song.hit(o + i * 240, i === 7 && bar % 4 === 3 ? 46 : 42, i % 2 ? 52 : 80);
    song.hit(o, 36, 120); song.hit(o + 960, 36, 100); song.hit(o + 480, 38, 110); song.hit(o + 1440, 38, 110);
    if (bar % 4 === 3) { [50, 48, 47, 45].forEach((k, i) => song.hit(o + 1440 + i * 120, k, 100 + i * 5)); }
    if (bar % 4 === 0) song.hit(o, 49, 100);
  }
  song.hit(0, 51, 70);
  add({
    section: "3 " + SEC.drum.slice(2), pref: gpref, title: "Rock groove with fill", blurb: `Chip drum kit: 8 bars at ${gbpm} BPM.`,
    checks: [
      "Kick (36) is a short low thump with a falling pitch, not a smooth boom.",
      "Snare (38) is a noise burst over a short pitched pulse body; it is crisp, not hissy.",
      "Closed hat (42) is crisp metallic noise with no pitch; open hat (46) rings longer, at the end of bars 4 and 8.",
      `${GT(7)} and ${GT(15)} the tom fill descends high to low (50, 48, 47, 45) and each tom is a distinct pitch.`,
      `Crash (49) on the downbeat at ${GT(0)} and ${GT(8)}; ride (51) tick on the first beat is quiet.`,
      `Loop at ${GT(16)}: groove restarts on the beat with no gap or click.`,
    ], settings: DRUM_SETTINGS, midi: song.bytes(END), svg: plainArt("Rock groove", "chip kit", PALETTE.drum),
  });
}
function hitsTrack(title, keys, extra) {
  const { bpm, pref } = nextTempo(), f = 120 / bpm, T = (x) => fmtT(x * f);
  const song = new Song(bpm); song.setup(9, 0);
  const slot = 3 * SEC120; // 3 s: loud hit at 0, soft hit at +1.5 s
  keys.forEach((k, i) => { song.hit(i * slot, k, 115); song.hit(i * slot + 1440, k, 45); });
  const end = keys.length * slot;
  const checks = keys.map((k, i) => `${T(i * 3)} ${drumFact(k).text}: hit loud, then ${(1.5 * f).toFixed(1)} s later soft (velocity 45), ${drumFact(k).noisy ? "noise: no pitch" : "pitched: hear its tone"}.`);
  checks.push(`Loop at ${T(keys.length * 3)}: no click.`);
  if (extra) checks.unshift(extra);
  add({ pref, section: "3 " + SEC.drum.slice(2), title, blurb: `${keys.length} drum notes, each loud then soft.`, checks, settings: DRUM_SETTINGS, midi: song.bytes(end), svg: plainArt(title, `${keys.length} hits`, PALETTE.drum) });
}
hitsTrack("Hits: kicks, snares, clap", [35, 36, 37, 38, 39, 40], "Soft hits must be clearly quieter, same tone (velocity squared loudness). Side stick (37) is a short metallic tick; snares and clap (38-40) are noise bursts over a pulse body.");
hitsTrack("Hits: toms", [41, 43, 45, 47, 48, 50], "Six toms, low to high: pitch rises evenly with a short downward sweep; no noise.");
hitsTrack("Hits: hats and cymbals", [42, 44, 46, 49, 51, 57, 59], "LFSR noise kit: all are noise. White noise (49, 57 crashes) is hissy and wide; metallic noise (42, 44, 46, 51, 59) is dry and ringy but has no melodic pitch.");
{
  // LFSR sample-wave kit from onchain-midi-player's reference settings
  const S = SF.REFERENCE_WAVES_SETTINGS;
  const song = new Song(120), END = 4 * BAR; song.setup(9, 0);
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * BAR;
    for (let i = 0; i < 8; i++) song.hit(o + i * 240, 42, i % 2 ? 60 : 90);
    song.hit(o, 36, 120); song.hit(o + 960, 36, 110); song.hit(o + 480, 38, 110); song.hit(o + 1440, 38, 110);
  }
  add({
    section: "3 " + SEC.drum.slice(2), title: "LFSR sample-wave kit", blurb: "Reference kit: stepped-triangle kick, short-LFSR snare and hat, as Samples waves.",
    checks: [
      "The hi-hat (42) is crisp noise with no pitch: the 93-step short LFSR stepped at a high rate.",
      "The snare (38) is a short-LFSR burst plus a pulse body; it should differ from Casey's white-noise snare.",
      "The kick (36) is a 4-bit stepped triangle falling 160 to 45 Hz: gritty, not smooth.",
      "Loop at 0:08: no gap or click.",
    ], settings: S, midi: song.bytes(END), svg: plainArt("LFSR kit", "Samples waves", PALETTE.drum),
  });
  // long LFSR (32,767-step) snare
  const L = SF.longLfsr();
  const s2 = new Song(120), END2 = 4 * BAR; s2.setup(9, 0);
  for (let i = 0; i < 16; i++) s2.hit(i * 480, 38, i % 4 === 0 ? 120 : 80);
  add({
    section: "3 " + SEC.drum.slice(2), title: "Long LFSR snare (32,767 steps)", blurb: "One 32,767-sample Samples wave: SETTINGS about 150 KB. Tests that the page accepts it.",
    checks: [
      "Page loads and the play button is enabled (large SETTINGS parse): note any delay before the page is ready.",
      "Snare is white-noise-like: a bright burst with no pitch, steadier than the short-LFSR one.",
      "16 hits at 0.5 s: even spacing, no dropouts. Loop at 0:08: no click.",
    ], settings: L, midi: s2.bytes(END2), svg: plainArt("Long LFSR", "32,767 steps", PALETTE.drum),
  });
}

// =============================================================================================
// 4. General range and edge cases
// =============================================================================================
const edge = (title, o) => add({ section: "4 " + SEC.edge.slice(2), svg: plainArt(title, o.sub || "", PALETTE.edge), ...o, title });
const Op = SF.op;
const baseSettings = SF.DEFAULT_SETTINGS;
const voice = (slot, wave, f = {}) => ({ drum: false, slot, operators: [Op({ wave, volume: 3500, attack: 30, hold: 0, decay: 100, sustain: 10000, release: 150, ...f })] });
const S = (timbres, f = {}) => ({ ...baseSettings, reverb: 0, timbres, ...f });
const TRI = S([voice(0, "Triangle")]);

// Dense polyphony
{
  const song = new Song(120), END = 14 * BAR / 1;
  const progs = [4, 5, 6, 48, 49, 50, 52, 61, 62, 80, 81, 88, 89, 94, 95];
  const chans = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  chans.forEach((c, i) => song.setup(c, progs[i], { vol: 100, pan: 20 + ((i * 7) % 90) }));
  let n = 0;
  const hold = 11 * BAR;
  for (let beat = 0; beat < 12; beat++) for (let k = 0; k < 8; k++, n++) {
    const pitch = 36 + ((n * 7) % 60); const ch = chans[n % chans.length];
    const t = beat * 480; song.on(ch, t, pitch, 100, hold - t);
  }
  edge("Dense polyphony: 64 voices", {
    sub: `${n} notes`, blurb: "96 sustained notes on 15 channels, voice limit 64, FM sounds.",
    checks: [
      `${n} notes pile up, 8 per beat, all held to 0:22. The 65th note arrives at 0:04 (beat 8).`,
      "From 0:04 older notes are stolen: you should hear notes dropping out, never a pop, click or crackle.",
      "No crackle or stutter when all 64 voices sound; no clipping or harsh distortion at the loudest point (0:08-0:20).",
      "All notes release together at 0:22; the tail fades smoothly. Loop at 0:28 is clean.",
      "Note any phone lag, glitches in audio or UI freezing while it plays.",
    ], settings: { ...baseSettings }, midi: song.bytes(END),
  });
  const s2 = new Song(120); s2.setup(0, 0);
  const END2 = 8 * BAR;
  for (let i = 0; i < 32; i++) s2.on(0, i * 240, 48 + (i % 4) * 4 + (i >> 2) * 2, 100, 3 * 480);
  edge("Voice limit 4: stealing", {
    sub: "voices = 4", blurb: "Overlapping arpeggio with only 4 voices.",
    checks: ["Each note is held 3 beats but only 4 can sound: the oldest is cut as each new one arrives.", "The cut should be tidy (a quick fade), with no click and no stuck note.", "Loop at 0:16 is clean; nothing carries over."],
    settings: { ...TRI, voices: 4 }, midi: s2.bytes(END2),
  });
}

// Pitch bend
{
  const song = new Song(120), END = 24 * SEC120;
  song.setup(0, 0);
  const C = 60;
  // 0:00 note held 3 s, smooth bend up to +2 semitones and back (128 steps each)
  song.on(0, 0, C, 100, 4 * SEC120 - 100);
  for (let i = 0; i <= 128; i++) song.bend(0, SEC120 * 0.5 + (i / 128) * 1.5 * SEC120, 8192 + (i / 128) * 8191);
  for (let i = 0; i <= 128; i++) song.bend(0, 2 * SEC120 + (i / 128) * 1.5 * SEC120, 16383 - (i / 128) * 8191);
  song.bend(0, 3.9 * SEC120, 8192);
  // 4:00 bend down, -2 semitones
  song.on(0, 4 * SEC120, C, 100, 4 * SEC120 - 100);
  for (let i = 0; i <= 128; i++) song.bend(0, 4.5 * SEC120 + (i / 128) * 1.5 * SEC120, 8192 - (i / 128) * 8192);
  for (let i = 0; i <= 128; i++) song.bend(0, 6 * SEC120 + (i / 128) * 1.5 * SEC120, (i / 128) * 8192);
  song.bend(0, 7.9 * SEC120, 8192);
  // 8:00 stepped bends (jumps) on a repeated note: +0, +1, +2 semitones
  [0, 4096, 8191, 4096, 0, -4096].forEach((b, i) => { song.bend(0, 8 * SEC120 + i * 480, 8192 + b); song.on(0, 8 * SEC120 + i * 480, C, 100, 440); });
  song.bend(0, 11 * SEC120, 8192);
  // 12:00 RPN: bend range +-12 semitones, a sweep up one octave and down
  song.cc(0, 12 * SEC120 - 10, 101, 0); song.cc(0, 12 * SEC120 - 9, 100, 0); song.cc(0, 12 * SEC120 - 8, 6, 12); song.cc(0, 12 * SEC120 - 7, 38, 0);
  song.on(0, 12 * SEC120, C, 100, 6 * SEC120 - 100);
  for (let i = 0; i <= 256; i++) song.bend(0, 12 * SEC120 + (i / 256) * 3 * SEC120, 8192 + (i / 256) * 8191);
  for (let i = 0; i <= 256; i++) song.bend(0, 15 * SEC120 + (i / 256) * 3 * SEC120, 16383 - (i / 256) * 8191);
  song.bend(0, 18.1 * SEC120, 8192);
  // 18:00 back to the default range 2: a note starts bent and a new note takes the current bend
  song.cc(0, 18.2 * SEC120, 101, 0); song.cc(0, 18.2 * SEC120 + 1, 100, 0); song.cc(0, 18.2 * SEC120 + 2, 6, 2); song.cc(0, 18.2 * SEC120 + 3, 38, 0);
  song.bend(0, 19 * SEC120 - 5, 16383); song.on(0, 19 * SEC120, C, 100, 2 * SEC120); song.bend(0, 21 * SEC120 - 5, 8192);
  edge("Pitch bend", {
    sub: "triangle", blurb: "Triangle voice; smooth bends, steps, RPN range 12 and a note started already bent.",
    checks: [
      "0:00 the note glides smoothly up two semitones from 0:00.5 and back, with no zipper noise or stepping.",
      "0:04 glide down two semitones and back, same smoothness.",
      "0:08 six notes with an instant bend before each: +0, +1, +2, +1, 0, -1 semitone, each a clean pitch step.",
      "0:12 after RPN bend range 12: one smooth octave glide up over 3 s and back down; ends exactly on pitch.",
      "0:19 a note that starts with the bend already up (range back to 2): it sounds about 2 semitones high (D) for its whole 2 s, with no glide.",
      "Loop at 0:24: the next pass starts in tune and at the default range (this song itself centres the bend at 0:21 and restores range 2 at 0:18; pitch bend and RPN carry over between passes).",
    ], settings: TRI, midi: (() => { const b = song.bytes(END); return b; })(),
  });
}

// Sustain pedal
{
  const song = new Song(120), END = 16 * SEC120;
  song.setup(0, 0);
  const notes = [60, 64, 67, 72];
  // 0:00 pedal down, four short notes, pedal up at 0:03
  song.cc(0, 0, 64, 127);
  notes.forEach((n, i) => song.on(0, i * 480, n, 100, 120));
  song.cc(0, 3 * SEC120, 64, 0);
  // 0:04 same notes with no pedal
  notes.forEach((n, i) => song.on(0, 4 * SEC120 + i * 480, n, 100, 120));
  // 0:08 pedal pressed after the notes started: notes already released do not return; the held key rings
  song.on(0, 8 * SEC120, 55, 100, 480);
  song.cc(0, 8 * SEC120 + 120, 64, 127);
  song.on(0, 8 * SEC120 + 960, 62, 100, 120);
  song.cc(0, 11 * SEC120, 64, 0);
  // 0:12 half pedal threshold: value 63 does not sustain, 64 does
  song.cc(0, 12 * SEC120, 64, 63); song.on(0, 12 * SEC120, 60, 100, 120);
  song.cc(0, 13 * SEC120, 64, 64); song.on(0, 13 * SEC120, 67, 100, 120);
  song.cc(0, 15 * SEC120, 64, 0);
  edge("Sustain pedal", {
    sub: "CC64", blurb: "Triangle, short notes with and without the pedal.",
    checks: [
      "0:00 pedal down: four 0.12 s notes keep ringing (each one added to the last) until the pedal lifts at 0:03, then all stop together.",
      "0:04 no pedal: the same four notes are short blips (0.12 s each), no ringing.",
      "0:08 a G is released after the pedal went down, so it keeps ringing; a short D at 0:09 rings too; both stop together at 0:11 when the pedal lifts.",
      "0:12 pedal value 63: that C is a short blip. 0:13 pedal value 64: that G rings until 0:15.",
      "No clicks when the pedal lifts. Loop at 0:16: nothing carries over.",
    ], settings: TRI, midi: song.bytes(END),
  });
}

// CC7 / CC11 volume sweeps
{
  const song = new Song(120), END = 16 * SEC120;
  song.setup(0, 0); song.setup(1, 0, { pan: 64, vol: 127 });
  const chord = [48, 55, 60, 64];
  chord.forEach((n) => song.on(0, 0, n, 100, 8 * SEC120 - 100));
  for (let i = 0; i <= 64; i++) song.cc(0, i * 2 * SEC120 / 16, 7, Math.round(127 * Math.abs(1 - i / 32)));
  song.cc(0, 8 * SEC120 - 20, 7, 100);
  chord.forEach((n) => song.on(1, 8 * SEC120, n, 100, 8 * SEC120 - 100));
  for (let i = 0; i <= 64; i++) song.cc(1, 8 * SEC120 + i * 2 * SEC120 / 16, 11, Math.round(127 * Math.abs(1 - i / 32)));
  song.cc(1, 16 * SEC120 - 40, 11, 127);
  edge("CC volume sweeps", {
    sub: "CC7 then CC11", blurb: "A held chord with CC7 (volume) and then CC11 (expression) fading out and in.",
    checks: [
      "0:00-0:08 CC7: the chord starts at full level, fades to silence at 0:04 and is back at full at 0:08 in smooth steps (no zipper noise, no click).",
      "0:08-0:16 CC11: same fade out and in with expression; it should sound the same shape.",
      "Quadratic curve: the quietest part is close to silent; the fade should not stop suddenly.",
      "Loop at 0:16: back at full level, no click.",
    ], settings: TRI, midi: song.bytes(END),
  });
}

// Pan
{
  const song = new Song(120), END = 16 * SEC120;
  song.setup(0, 0, { pan: 0 }); song.setup(1, 0, { pan: 127 });
  // 0:00 hard left / hard right ping-pong
  for (let i = 0; i < 8; i++) song.on(i % 2, i * 480, 72 + (i % 2) * 7, 100, 400);
  // 0:04 pan sweep L -> R -> L under a repeated note on channel 2
  song.setup(2, 0, { pan: 0 });
  for (let i = 0; i < 32; i++) song.on(2, 4 * SEC120 + i * 240, 67 + (i % 4) * 2, 100, 220);
  for (let i = 0; i <= 64; i++) song.cc(2, 4 * SEC120 + (i / 64) * 8 * SEC120, 10, Math.round(127 * (1 - Math.abs(1 - i / 32))));
  edge("Pan sweep", {
    sub: "CC10", blurb: "Ping-pong between hard left and hard right, then a pan sweep.",
    checks: [
      "Use headphones or stereo speakers: a phone speaker is mono and will not show this.",
      "0:00 alternating notes: even notes in the left ear only, odd notes in the right ear only.",
      "0:04 the repeated pattern moves smoothly from left to centre to right (0:08) and back to left (0:12) with no jumps.",
      "No crackle or level change as it moves. Loop at 0:16: clean.",
    ], settings: TRI, midi: song.bytes(END),
  });
}

// Modulation
{
  const song = new Song(120), END = 12 * SEC120;
  song.setup(0, 0);
  song.on(0, 0, 64, 100, 6 * SEC120 - 100);
  for (let i = 0; i <= 32; i++) song.cc(0, i * 6 * SEC120 / 32 * 0.5, 1, i * 4 - (i === 32 ? 1 : 0));
  song.cc(0, 3 * SEC120 + 10, 1, 127);
  song.on(0, 6 * SEC120, 64, 100, 6 * SEC120 - 100);
  song.cc(0, 6 * SEC120 - 5, 1, 0);
  edge("Modulation vibrato", {
    sub: "CC1", blurb: "A held note with modulation rising from 0 to 127.",
    checks: [
      "0:00 a steady note with vibrato that deepens gradually (5 Hz) up to +/- 100 cents at 0:03.",
      "The vibrato is smooth with no stepping.",
      "0:06 the same note again with modulation back at 0: pure steady pitch.",
      "Loop at 0:12: clean.",
    ], settings: TRI, midi: song.bytes(END),
  });
}

// Filters
{
  const FS = SF.FILTER_SETTINGS;
  const raw = voice(4, "Sawtooth");
  const settings = { ...FS, timbres: [...FS.timbres, raw] };
  const song = new Song(120), END = 40 * 480 * 2 / 2 + 0; const E2 = 20 * BAR / 2; // 20 beats*... placeholder
  const scale = [0, 2, 4, 5, 7, 9, 11, 12];
  const order = [4, 0, 1, 2, 3]; // raw, LP, HP, BP, LP key-tracked
  order.forEach((prog, k) => {
    const ch = k; song.setup(ch, prog);
    scale.forEach((s, i) => song.on(ch, k * 4 * SEC120 + i * 240, 60 + s + (prog === 3 ? 0 : 0), 100, 220));
    scale.slice().reverse().forEach((s, i) => song.on(ch, k * 4 * SEC120 + 8 * 240 + i * 240, 60 + s, 100, 220));
  });
  // key-tracked LP across three octaves
  song.setup(5, 3);
  [36, 48, 60, 72, 84, 96].forEach((n, i) => song.on(5, 20 * SEC120 + i * 480, n, 100, 440));
  // hats groove
  song.setup(9, 0);
  for (let i = 0; i < 16; i++) song.hit(24 * SEC120 + i * 240, i % 8 === 7 ? 46 : 42, 90);
  const END3 = 28 * SEC120;
  edge("Filters: LP, HP, BP", {
    sub: "saw through filters", blurb: "The same 16-note saw scale: raw, low-pass 1 kHz, high-pass 1 kHz, band-pass 1 kHz Q4, key-tracked low-pass; then filtered hats.",
    checks: [
      "0:00 raw sawtooth scale: bright and buzzy, the reference.",
      "0:04 low-pass at 1 kHz: duller, no fizz; hear the cutoff as a soft muffle.",
      "0:08 high-pass at 1 kHz: thin, nasal buzz with the body of the note gone.",
      "0:12 band-pass at 1 kHz, Q 4: a vocal, nasal 'wow'; the scale's timbre changes with pitch.",
      "0:16 low-pass at 4x the note frequency (key-tracked): the brightness stays constant across the scale.",
      "0:20 the same key-tracked low-pass on C2 to C7: steady brightness; no silence at the lowest or highest note.",
      "0:24 hi-hats: closed and open, high-passed at 3 kHz, crisp noise with no low thud; loop at 0:28 clean.",
    ], settings, midi: song.bytes(END3),
  });
}

// Custom waves
{
  const waves = [
    { Harmonics: [100] },
    { Harmonics: [100, 0, 55, 0, 32, 0, 18, 0, 10, 0, 6] },
    { Harmonics: [100, 50, 33, 25, 20, 16, 14, 12, 11, 10] },
    { Samples: RW.triangle4() },
    { Samples: RW.pulse(1) },
    { Samples: RW.pulse(2) },
    { Samples: RW.saw4() },
    { Samples: RW.lfsr("short") },
  ];
  const names = ["Harmonics [100] (a pure sine)", "Harmonics odd 100,55,32,18,10,6 (square-like, soft)", "Harmonics 1/n series (saw-like, band-limited)", "Samples: 4-bit stepped triangle", "Samples: 12.5% pulse", "Samples: 25% pulse", "Samples: 4-bit saw", "Samples: short LFSR (93 steps), a buzzy metallic tone"];
  const timbres = waves.map((_, i) => voice(i, { Custom: i }));
  const song = new Song(120), END = 8 * 4 * SEC120 / 2 * 2 / 2 * 2;
  waves.forEach((_, i) => { song.setup(i, i); [0, 2, 4, 7, 12, 7, 4, 0].forEach((s, j) => song.on(i, i * 3 * SEC120 + j * 360, 60 + s, 100, 300)); });
  const E3 = waves.length * 3 * SEC120;
  edge("Custom harmonic and sample waves", {
    sub: "Harmonics and Samples", blurb: "Eight custom waves, each plays the same phrase for 3 s.",
    checks: names.map((n, i) => `${fmtT(i * 3)} ${n}.`).concat([
      "Pitch is the same C-major phrase on every wave: Samples waves play one cycle per note, so the pitch must match the Harmonics ones.",
      "Stepped waves (triangle4, saw4, pulses) sound gritty and chip-like; the Harmonics waves are smooth.",
      "Loop at 0:24: clean.",
    ]), settings: S(timbres, { waves }), midi: song.bytes(E3),
  });
}

// Very low and very high notes
{
  const notes = [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 127];
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const song = new Song(120), slot = 3 * SEC120 / 2; // 1.5 s per note
  song.setup(0, 0); song.setup(1, 1);
  notes.forEach((n, i) => song.on(0, i * slot, n, 100, slot - 240));
  notes.forEach((n, i) => song.on(1, (notes.length + i) * slot, n, 100, slot - 240));
  const END = 2 * notes.length * slot;
  const per = (i) => `${fmtT(i * 1.5)}`;
  edge("Very low and high notes", {
    sub: "notes 0 to 127", blurb: "Octave steps from MIDI note 0 (8 Hz) to 127 (12.5 kHz), sine then sawtooth.",
    checks: [
      "Phone speakers cannot reproduce below about 150 Hz: use headphones for the lowest notes (0 to 36). Silence there on a phone is expected, not a bug.",
      ...notes.map((n, i) => `${per(i)} sine note ${n} (${hz(n).toFixed(hz(n) < 100 ? 1 : 0)} Hz)${n >= 120 ? ": very high, may be faint or inaudible" : n <= 12 ? ": below hearing; may be silent or a click-free rumble" : ""}.`),
      `${fmtT(notes.length * 1.5)} the same notes as a sawtooth: high notes must not alias into lower inharmonic tones or get louder; no clicks.`,
      `Loop at ${fmtT(END / SEC120)}: clean.`,
    ], settings: S([voice(0, "Sine"), voice(1, "Sawtooth", { volume: 2500 })]), midi: song.bytes(END),
  });
}

// Long track
{
  const SET = SS.beastSynthSettings(DATA, [0, 15, 17], [36, 38, 42, 46, 49]);
  const song = new Song(120), BARS = 36, END = BARS * BAR;
  song.setup(0, 0, { pan: 50 }); song.setup(1, 15, { pan: 40 }); song.setup(2, 17, { pan: 80 }); song.setup(9, 0);
  const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  const roots = [45, 41, 36, 43];
  for (let bar = 0; bar < BARS; bar++) {
    const o = bar * BAR, c = bar % 4, ch = prog[c];
    // bass: eighth notes (ends before the bar line)
    for (let i = 0; i < 8; i++) song.on(1, o + i * 240, roots[c] + (i % 4 === 2 ? 7 : 0), 100, 200);
    // harp: sixteenth arpeggio from bar 2
    if (bar >= 1) for (let i = 0; i < 16; i++) song.on(2, o + i * 120, ch[i % 3] + (i % 6 > 2 ? 12 : 0) + 12, 70, 100);
    // lead: from bar 5, a held note and a turn
    if (bar >= 4 && !(bar >= 24 && bar < 28)) {
      song.on(0, o, ch[1] + 24, 100, 960 - 40);
      song.on(0, o + 960, ch[2] + 24, 100, 480 - 40);
      song.on(0, o + 1440, ch[1] + 24, 100, 240 - 20);
      song.on(0, o + 1680, ch[0] + 24, 100, 240 - 20);
    }
    // drums from bar 9; break bars 25-28 only hats
    if (bar >= 8) for (let i = 0; i < 8; i++) {
      song.hit(o + i * 240, 42, i % 2 ? 50 : 76);
      if (!(bar >= 24 && bar < 28)) { if (i === 0 || i === 4) song.hit(o + i * 240, 36, 110); if (i === 2 || i === 6) song.hit(o + i * 240, 38, 100); }
    }
    if (bar === 0 || bar === 16) song.hit(o, 49, 100);
  }
  const m = (b) => fmtT(b * 2);
  edge("Long track: loop and seam", {
    sub: "72 seconds", blurb: "36 bars at 120 BPM: Am F C G, bass, harp, lead, drums, a break.",
    checks: [
      `One pass is ${m(BARS)} (${BARS} bars). Let it loop at least once to hear the seam.`,
      `${m(0)} bass and crash (the crash returns at ${m(16)}); ${m(1)} harp arpeggio enters; ${m(4)} lead enters; ${m(8)} drums enter; ${m(24)} the drum break (hats only); ${m(28)} the lead, kick and snare return (during the break, 0:48-0:56, the lead is silent too).`,
      `The loop at ${m(BARS)}: the next pass starts on the beat with the bass, crash cymbal and Am chord. There must be no gap, no double hit, no click and no cut-off notes at the seam.`,
      "Timing stays even for the whole minute (no drift or tempo wobble) and nothing cuts in or out unexpectedly.",
      "Last bar is G (resolves back to Am): the loop should sound like a musical repeat.",
      "Background the tab or lock the screen for 30 s and come back: playback continues or resumes cleanly (note which).",
    ], settings: SET, midi: song.bytes(END),
  });
}

// Quiet vs loud
{
  const SET = SS.beastSynthSettings(DATA, [0, 17, 15], [36, 38, 42]);
  const song = new Song(120), BARS = 12, END = BARS * BAR;
  song.setup(0, 0); song.setup(1, 17); song.setup(2, 15); song.setup(9, 0);
  const prof = [{ v: 22, c: 45, d: 0 }, { v: 70, c: 85, d: 0 }, { v: 127, c: 127, d: 1 }];
  for (let bar = 0; bar < BARS; bar++) {
    const o = bar * BAR, { v, c, d } = prof[Math.floor(bar / 4)];
    if (bar % 4 === 0) [0, 1, 2].forEach((ch) => song.cc(ch, o, 7, c));
    const ch = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]][bar % 4];
    for (let i = 0; i < 4; i++) song.on(0, o + i * 480, ch[(i + 1) % 3] + 24, v, 440);
    for (let i = 0; i < 16; i++) song.on(1, o + i * 120, ch[i % 3] + 12, Math.max(1, v - 20), 100);
    for (let i = 0; i < 2; i++) song.on(2, o + i * 960, ch[0] - 12, v, 900);
    if (d) for (let i = 0; i < 8; i++) { song.hit(o + i * 240, 42, 100); if (i % 4 === 0) song.hit(o + i * 240, 36, 127); if (i % 4 === 2) song.hit(o + i * 240, 38, 127); }
  }
  edge("Quiet and loud passages", {
    sub: "level steps", blurb: "The same four-bar loop three times: quiet, medium, then loud with drums.",
    checks: [
      "Phone volume to about 50% first. 0:00-0:08 quiet (velocity 22, CC7 45): audible and clean, no hiss or grain, and still clearly musical.",
      "0:08-0:16 medium: a clear, comfortable step up.",
      "0:16-0:24 loud (velocity 127, CC7 127) with kick, snare and hats: full, but with no clipping, harsh distortion or pumping.",
      "Level steps are each noticeably louder than the last (loudness follows velocity squared).",
      "Loop at 0:24 from loud back to quiet: no pop; note how much quieter the start feels.",
    ], settings: SET, midi: song.bytes(END),
  });
}

// GM tours
const FAMILIES = ["Piano", "Chromatic percussion", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass", "Reed", "Pipe", "Synth lead", "Synth pad", "Synth effects", "Ethnic", "Percussive", "Sound effects"];
function gmTour(title, from, to, quality, per) {
  const song = new Song(120), n = to - from + 1;
  song.setup(0, from);
  for (let p = from; p <= to; p++) {
    const t = (p - from) * per;
    if (p > from) song.pc(0, t, p);
    [0, 4, 7].forEach((s, i) => song.on(0, t + i * Math.round(per * 0.12), 72 + s, 100, Math.round(per * 0.1)));
    song.on(0, t + Math.round(per * 0.4), 76, 100, Math.round(per * 0.45));
  }
  const END = n * per;
  const fam = [];
  for (let f = Math.floor(from / 8); f <= Math.floor(to / 8); f++) fam.push(`${fmtT(((f * 8 - from) * per) / SEC120)} programs ${f * 8}-${f * 8 + 7}: ${FAMILIES[f]}`);
  edge(title, {
    sub: `quality ${quality}`, blurb: `General MIDI programs ${from}-${to} at quality ${quality} (${quality ? "FM" : "chip-tune"}), one program per ${(per / SEC120).toFixed(1)} s.`,
    checks: [
      ...fam.map((f) => f + "."),
      "Each program plays the same short arpeggio then a held note: every one should make sound; flag any that are silent, painfully loud or clip.",
      quality ? "FM sounds: tonal, with attack and decay that fit the family name." : "Chip-tune sounds: one oscillator per note, thinner than FM; each family still distinct.",
      "Loop: no click at the seam.",
    ], settings: { ...baseSettings, quality }, midi: song.bytes(END),
  });
}
gmTour("GM tour A (0-63), FM", 0, 63, 1, SEC120);
gmTour("GM tour B (64-127), FM", 64, 127, 1, SEC120);
gmTour("GM tour (0-127), chip-tune", 0, 127, 0, SEC120 / 2);
const GMKIT_N = 47;
const GMKIT = "Acoustic Bass Drum,Bass Drum 1,Side Stick,Acoustic Snare,Hand Clap,Electric Snare,Low Floor Tom,Closed Hi-Hat,High Floor Tom,Pedal Hi-Hat,Low Tom,Open Hi-Hat,Low-Mid Tom,Hi-Mid Tom,Crash Cymbal 1,High Tom,Ride Cymbal 1,Chinese Cymbal,Ride Bell,Tambourine,Splash Cymbal,Cowbell,Crash Cymbal 2,Vibraslap,Ride Cymbal 2,Hi Bongo,Low Bongo,Mute Hi Conga,Open Hi Conga,Low Conga,High Timbale,Low Timbale,High Agogo,Low Agogo,Cabasa,Maracas,Short Whistle,Long Whistle,Short Guiro,Long Guiro,Claves,Hi Wood Block,Low Wood Block,Mute Cuica,Open Cuica,Mute Triangle,Open Triangle".split(",");
if (GMKIT.length !== GMKIT_N) throw new Error("GM kit names " + GMKIT.length);
for (const quality of [1, 0]) {
  const song = new Song(120); song.setup(9, 0);
  const per = SEC120 / 2;
  GMKIT.forEach((_, i) => song.hit(i * per, 35 + i, 110));
  const END = GMKIT.length * per;
  edge(`GM drum kit tour, ${quality ? "FM" : "chip-tune"}`, {
    sub: `notes 35-81, quality ${quality}`, blurb: "All 47 General MIDI percussion notes, one per half second.",
    checks: [
      `Notes 35 to 81 in order, 0.5 s each: ${GMKIT.slice(0, 6).join(", ")}, ... ${GMKIT.slice(-3).join(", ")}.`,
      "0:00-0:10 kicks, snares, toms and hats are distinct and in the right order; cymbals (49, 51, 52, 55, 57, 59) ring and fade.",
      "Percussion after 0:10 (bongos, congas, whistles, guiro, claves, cuica, triangle) all sound; flag any silent note.",
      `Count: 47 hits, last at ${fmtT(46 * 0.5)}. Loop at ${fmtT(END / SEC120)}: clean.`,
    ], settings: { ...baseSettings, quality }, midi: song.bytes(END),
  });
}

// Stress: timed load ramps, so the time a phone starts to crackle or stutter tells which load and how
// much. No voice is ever stolen (at most 56 melodic voices plus drum hits, under the 64 limit), so any
// click is the device, not the voice limit. The pad is the heaviest legal timbre: 8 operators, 4 audio
// outputs through low-pass filters, each frequency-modulated by its own operator (20 nodes per voice).
// The variants keep the timeline, so their times compare: reverb off (the convolver's share of the load)
// and a phone-sized ramp whose ceiling lands mid-track.
function stressTrack({ title, step, pads, arps, every, burst, reverb }) {
  const song = new Song(120), T = (s) => Math.round(s * SEC120);
  const pad = { drum: false, slot: 0, operators: [
    ...[0, 1, 2, 3].map((k) => Op({ route: 0, wave: ["Sawtooth", "Square", "Triangle", "Sawtooth"][k], volume: 220, ratio: [10000, 20000, 5000, 30000][k], offset_hz: k * 15000, attack: 2000, hold: 0, decay: 5000, sustain: 7000, release: 2000, filter: SF.filter("LowPass", 30000 + k * 10000, 9000, true) })),
    ...[1, 2, 3, 4].map((target, k) => Op({ route: target, wave: "Sine", volume: 600 + k * 200, ratio: [10000, 15000, 20000, 7000][k], attack: 1000, hold: 0, decay: 8000, sustain: 5000, release: 2000 })),
  ] };
  // The arpeggio lead: 2 operators with a short release, so the fast notes' tails stay short and the
  // voice count stays under the limit.
  const lead = { drum: false, slot: 1, operators: [
    Op({ route: 0, wave: "Square", volume: 1500, attack: 20, hold: 0, decay: 400, sustain: 6000, release: 250 }),
    Op({ route: 1, wave: "Sine", volume: 900, ratio: 20000, attack: 0, hold: 0, decay: 600, sustain: 3000, release: 250 }),
  ] };
  const PADS = [0, 1, 2, 3, 4, 5, 6, 7], ARPS = [8, 10, 11, 12, 13, 14, 15].slice(0, arps);
  PADS.forEach((c, i) => song.setup(c, 0, { vol: 40, pan: 16 + i * 13 }));
  ARPS.forEach((c, i) => song.setup(c, 1, { vol: 50, pan: 100 - i * 12 }));
  song.setup(9, 0);
  const CHORD = [0, 4, 7, 11, 14]; // C major 9, spread over five octaves
  const padPitch = (i) => 36 + CHORD[i % 5] + 12 * (Math.floor(i / 5) % 5);
  // Phase 1, 0:02-0:20: `step` more pad voices every second up to `pads`, held to 0:20.
  for (let i = 0; i < pads; i++) { const at = T(2 + Math.floor(i / step)); song.on(PADS[i % 8], at, padPitch(i), 100, T(20) - at); }
  // Phases 2 and 3: 32nd-note arpeggios (16 notes per second per channel) on the lead; in phase 2
  // (0:21-0:37) one more channel starts every `every` seconds.
  const ARP = [0, 4, 7, 12, 16, 12, 7, 4];
  ARPS.forEach((c, k) => { for (let t = T(21 + every * k); t < T(45); t += 60) song.on(c, t, 60 + k * 2 + ARP[(t / 60) % 8], 90, 40); });
  // Phase 3, 0:37-0:45: `burst` pad voices start together over all the arpeggios.
  for (let i = 0; i < burst; i++) song.on(PADS[i % 8], T(37), padPitch(i + 3), 100, T(45) - T(37));
  // A hi-hat on every beat (a kick on each bar) to 0:45, the timing reference: a stutter shows as an uneven hat.
  for (let t = 0; t < T(45); t += 480) song.hit(t, t % 1920 ? 42 : 36, t % 1920 ? 70 : 100);
  const full = 2 + pads / step - 1, lastArp = 21 + every * (arps - 1), END = T(48);
  edge(title, {
    sub: `${pads} voices, ${16 * arps} notes/s${reverb ? "" : ", no reverb"}`,
    blurb: `Timed ramps of audio load and note rate over a steady hi-hat${reverb ? "" : ", with the reverb off"}: the time it first crackles or stutters tells which load and how much. Compare with /old/ on the same phone.`,
    checks: [
      "0:00-0:02 baseline, hi-hat only: if this crackles, the problem is not load.",
      `0:02-0:20 voice ramp: a heavy filtered FM pad gains ${step} voices every second (${step} at 0:02, ${2 * step} at 0:03, ... ${pads} from ${fmtT(full)} to 0:20). Note the time of the first crackle: ${step} x (seconds - 1) is the phone's voice ceiling.`,
      `0:21-0:37 note-rate ramp: fast arpeggios, 16 more notes per second every ${every} s (16 at 0:21 up to ${16 * arps} at ${fmtT(lastArp)}). Note the time the hi-hat first goes uneven or the arpeggios stumble.`,
      `0:37-0:45 both at once: ${burst} pad voices start together over all the arpeggios. Note any crackle, dropout or stutter, and whether it recovers.`,
      reverb ? "Reverb on, as on every other track." : "Reverb off: compare with track 418 (the same with reverb). Crackling later here than there means the reverb takes a real share of the phone's audio budget.",
      "No voice is ever stolen here: a click or pop is the device falling behind, not the voice limit.",
      "0:45-0:48 tail; loop at 0:48 should be clean. Note any UI freeze or lag while it plays.",
    ], settings: { ...baseSettings, reverb, timbres: [pad, lead] }, midi: song.bytes(END),
  });
}
stressTrack({ title: "Stress test: load ramps", step: 4, pads: 56, arps: 7, every: 2, burst: 40, reverb: baseSettings.reverb });
stressTrack({ title: "Stress test: load ramps, reverb off", step: 4, pads: 56, arps: 7, every: 2, burst: 40, reverb: 0 });
stressTrack({ title: "Stress test: phone-sized ramps", step: 2, pads: 24, arps: 4, every: 4, burst: 16, reverb: baseSettings.reverb });

// =============================================================================================
// 5. Client chip bank: the 80 presets that are not onchain essentials (77 map to SETTINGS)
// =============================================================================================
const bankFail = [];
function bankData2(ids) {
  const presets = {};
  for (const id of ids) {
    const pr = bank.PRESETS[id], k = (bank.LOUDNESS[id] ?? 1) * ((bank.MIX_TRIM || {})[id] ?? 1);
    const DEF = { g: 0, w: "sine", t: 1, f: 0, v: 0.5, a: 0, h: 0.01, d: 0.01, s: 0, r: 0.05, p: 1, q: 1, k: 0 };
    const r6 = (x) => (typeof x === "number" ? +x.toPrecision(6) : x);
    presets[id] = pr.p.map((o) => {
      const op = { ...o };
      if ((op.g ?? 0) === 0 || op.g > 10) op.v = (op.v ?? DEF.v) * k;
      return Object.fromEntries(Object.entries(op).filter(([key, val]) => val !== DEF[key]).map(([key, val]) => [key, r6(val)]));
    });
  }
  return { presets, drums: {} };
}
const cats = {};
for (const [id, p] of Object.entries(bank.PRESETS)) {
  const n = Number(id);
  if (ESSENTIALS.includes(n)) continue;
  try { SS.timbreOperators(bankData2([n]).presets[n], 1, Object.keys(SS.STEPS)); } catch (e) { bankFail.push(`${n} ${p.name}: ${e.message}`); continue; }
  (cats[p.category] ??= []).push(n);
}
const catBase = { Bass: 43, Pad: 55 };
for (const [cat, ids] of Object.entries(cats)) {
  const { bpm, pref } = nextTempo(), f = 120 / bpm, T = (x) => fmtT(x * f);
  const song = new Song(bpm);
  const d = bankData2(ids);
  const settings = SS.beastSynthSettings(d, ids, []);
  const base = catBase[cat] ?? 60, long = cat === "Pad" || cat === "Arp/FX" || cat === "Noise";
  ids.forEach((id, i) => {
    const t = i * 5 * SEC120; if (i === 0) song.setup(0, id); else song.pc(0, t, id);
    [0, 4, 7, 12].forEach((s, j) => song.on(0, t + j * 480, base + s, 100, 440));
    song.on(0, t + 4 * 480, base + 7, 100, 1100);
    [0, 4, 7, 12].forEach((s, j) => song.on(0, t + 3.5 * SEC120 + j * 240, base + s, 100, Math.round(40 * bpm / 120)));
  });
  const END = ids.length * 5 * SEC120;
  add({
    section: "5 " + SEC.bank.slice(2), title: `Bank: ${cat}`, blurb: `${ids.length} presets, 5 s each: four quarter notes, one held note, four staccato blips.`,
    checks: [
      "These come from the client-side bank (tinysynth-chip.js), not the 20 onchain essentials; they only need to sound sensible, not be shipped.",
      ...ids.map((id, i) => `${T(i * 5)} ${id} ${pname(id)}: four notes from ${base === 60 ? "C4" : base === 43 ? "G2" : "G3"}, a held note at +${(2 * f).toFixed(1)} s, then four 40 ms staccato blips at +${(3.5 * f).toFixed(1)} s${bank.PRESETS[id].p.some((o) => !o.g && (o.a ?? 0) >= 0.05) ? " (slow-attack timbre: the blips must still sound, quieter, not vanish)" : ""}.`),
      "Flag any preset that is silent, clipped, much louder than the rest, or clicks on note start or release.",
      `Loop at ${T(END / SEC120)}: clean.`,
    ], pref, settings, midi: song.bytes(END), svg: plainArt(cat, `${ids.length} bank presets`, PALETTE.bank),
  });
}

// =============================================================================================
// 6. Original species songs (Casey's branch, BEAST_SONGS): the Species Song of each of the 75 original species, as
// the Originals Sound Manager publishes it. The manager stores, for each species, the Genesis Track of genesis_swap(id)
// as ComposerInputs::Song(get_generation_inputs({ composition_seed: 0 }, 0, { species_id: genesis_swap(id), name 0, ... })
// .base_song) and plays compose(inputs, sound_effects) with the token's sound effects. Here: sound effects 0 (as
// written: not mega, no echo, no drift) for the regular Beast. The notes are lab.js genesisMidi(id, false), which the
// branch's parity scripts hold byte-identical to its Cairo; the settings are synth_settings.mjs's family settings
// (the Yeti's for species 68), hashed against the Cairo constants. Each track is the species' own unnamed Beast
// (level 50, health 200, as the song composes it) with the original GIF only (lean: one page, not three).
// =============================================================================================
if (SONGS) {
  const { idx: SI, v11: SV, lab: SL, ss: SSS } = SONGS;
  const E6 = SI.engine, V6 = SV.createEngineV11(E6);
  const FAMILY = ["Magic", "Hunter", "Brute"];
  for (let id = 1; id <= 75; id++) {
    const swap = SL.GENESIS_SWAPS[id] || id; // Harpy (39) and Pegasus (40) publish each other's Genesis Track
    const type = SL.speciesType(swap), tier = SL.speciesTier(swap), yeti = swap === 68;
    const { midi, info } = SL.genesisMidi(id, false, E6, V6);
    const settings = SSS.beastSynthSettings(undefined, SSS.variantPrograms({ type, mega: false, yeti }));
    const name = TABLES.species[id - 1], partner = TABLES.species[swap - 1], bpm = +(60e6 / ART.midiTempoUs(midi)).toFixed(2);
    const own = swap === id ? "" : `${name} plays ${partner}'s Genesis Track (the default swap of Harpy and Pegasus, as the Originals Sound Manager publishes it). `;
    add({
      lean: true, section: SEC.songs, title: swap === id ? name : `${name} (${partner}'s song)`,
      blurb: `The Species Song of the ${name}: the track every ${name} plays by default (its Genesis Track), from the production composer ${SONGS.label}. ${own}${FAMILY[type]} family, tier ${tier}; ${info.key}, ${bpm} BPM, ${info.sections} sections, ${info.channels.length} channels. As written (sound effects 0): not mega, no echo, no drift.`,
      checks: [
        `Tap the round play button on the card: the music starts within about half a second, with no error text at the bottom of the player. It is the ${partner}'s Species Song in ${info.key} at ${bpm} BPM: ${info.sections} sections, then the loop.`,
        `Voices: ${info.channels.join(", ")}. The sounds are the ${FAMILY[type]} family's TinyChip presets (three leads, three plucks)${yeti ? " and Pulse 12.5% Pluck, the Yeti's avalanche," : ""} and the chip drum kit, with reverb 30: the settings the contract returns for this song, not hand-picked presets.`,
        ...(swap === id ? [] : [`${name} and ${partner} swap songs: the card shows the ${name}, the music is the ${partner}'s.`]),
        ...(yeti ? ["The Yeti has its own arrangement: a rock tempo (175 BPM) with an avalanche on the pluck, not a canon like the other species."] : []),
        "Let it loop at least once: no gap and no click at the seam, and the play button still matches what you hear.",
      ],
      settings, midi,
      beast: cardBeast(id, false, { prefix: 0, suffix: 0, rank: 0, level: 50, health: 200 }, true),
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Per-track Beast overrides (the user asked for these pairings; everything else about the track, its music,
// description, checks and the synced frame length, follows its own MIDI): #301 (Drums, the rock groove) shows
// Yeti (species 68, regular), #510 (client bank, Game Boy) shows Minotaur (species 30, shiny).
const BEAST_OVERRIDE = { "301": { id: 68, shiny: false }, "510": { id: 30, shiny: true } };
for (const [id, pick] of Object.entries(BEAST_OVERRIDE)) {
  const sp = specs.find((x) => x.id === id);
  console.log(`#${id} "${sp.title}": Beast ${sp.pick.id}${sp.pick.shiny ? " shiny" : ""} -> ${pick.id}${pick.shiny ? " shiny" : ""}`);
  sp.pick = pick;
}
for (const sp of specs) build(sp);
const meta = {
  generated: new Date().toISOString(), playerVersion: SEG.VERSION, fixedBytes: Object.values(FIXED).reduce((n, f) => n + f.length, 0),
  beastCommit: need("BEAST_LABEL"), ompCommit: need("OMP_LABEL"), songsCommit: SONGS ? SONGS.label : "",
  bankFail, warn,
  usedArt, playAnchor,
};
fs.writeFileSync(path.join(here, "tracks.json"), JSON.stringify({ meta, fixed: FIXED, tracks, fonts: FONTS }));
const counts = {};
tracks.forEach((t) => { counts[t.section] = (counts[t.section] || 0) + 1; });
console.log(counts, "total", tracks.length, "bankFail", bankFail, "warn", warn);
