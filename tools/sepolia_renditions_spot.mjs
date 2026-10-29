#!/usr/bin/env node
// Spot check of a stored rendition set: for one token per visual preset (0-3), decodes the stored token_uri's
// animation_url and checks the notes fragment (presets in the renderer's notes mask only), the Shiny or Regular
// GIF (the card's art against beasts-v3's canonical genesis files), the tempo, and that the page parses and
// starts in a real browser without errors.
//
//   BEASTS3=<beasts-v3 checkout> PLAYWRIGHT_CORE=<node_modules/playwright-core or playwright> \
//     node tools/sepolia_renditions_spot.mjs renditions/sepolia-<date> [species per preset, default 1,26,51,75]
//
// Chromium needs its system libraries (`npx playwright install-deps` where you have root).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import zlib from "node:zlib";
import { inspect } from "./sepolia_renditions.mjs";

const dir = path.resolve(process.argv[2] ?? "");
const species = (process.argv[3] ?? "1,26,51,75").split(",").map(Number);
const beasts3 = process.env.BEASTS3;
if (!beasts3 || !process.env.PLAYWRIGHT_CORE) {
  console.error("set BEASTS3 and PLAYWRIGHT_CORE (see the header)");
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const notesFragment = fs.readFileSync(path.join(beasts3, "assets", "player-page", "notes.html"), "utf8");
const genesis = JSON.parse(fs.readFileSync(path.join(beasts3, "assets", "genesis", "manifest.json"), "utf8"));
const genesisArt = new Map(genesis.assets.filter((a) => a.mime === "image/gif").map((a) => [a.sha256, a]));
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const browser = await pw.chromium.launch({ env: process.env });
console.log(`chromium ${browser.version()}; set ${manifest.deployment} at block ${manifest.blockNumber}`);

const results = [];
for (const [preset, speciesId] of [0, 1, 2, 3].map((p, i) => [p, species[i]])) {
  const t = manifest.tokens.find((x) => x.kind === "rendition" && x.visualEffects === preset && x.speciesId === speciesId);
  if (!t) throw new Error(`no rendition of species ${speciesId} at preset ${preset}`);
  const stored = fs.readFileSync(path.join(dir, t.file));
  const uri = (manifest.storage.compression === "gzip" ? zlib.gunzipSync(stored) : stored).toString("utf8");
  const seen = inspect(uri, { notesFragment, genesisArt });
  const wantNotes = ((manifest.renderer.notesPresets >> preset) & 1) === 1;
  const wantArt = preset & 1 ? "shiny-gif" : "regular-gif";

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  const external = [];
  page.on("request", (r) => { if (!/^(data|blob|about):/.test(r.url())) external.push(r.url()); });
  await page.setContent(seen.page, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const dom = await page.evaluate(() => ({
    doctype: document.doctype?.name ?? null,
    art: document.querySelectorAll("img#beast-art").length,
    artLoaded: (() => { const i = document.querySelector("img#beast-art"); return !!i && i.complete && i.naturalWidth > 0; })(),
    midiData: document.querySelectorAll("script#onchain-midi-data").length,
    settings: document.querySelectorAll("script#onchain-midi-settings").length,
    notesScript: document.querySelectorAll("script#beast-notes").length,
    notesApi: typeof window.OnchainMidiNotes,
    play: document.querySelectorAll("button").length,
  }));
  await ctx.close();

  const checks = {
    notes: seen.notes === wantNotes && dom.notesScript === (wantNotes ? 1 : 0),
    art: seen.art.provider === wantArt && t.art === wantArt,
    tempo: !!seen.tempo && seen.tempo.microsecondsPerQuarter === t.tempo.microsecondsPerQuarter,
    parses: dom.doctype === "html" && dom.art === 1 && dom.artLoaded && dom.midiData === 1 && dom.settings === 1 && dom.play >= 1 && errors.length === 0 && external.length === 0,
  };
  const pass = Object.values(checks).every(Boolean);
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} preset ${preset} ${t.name} ${t.tokenId}`);
  console.log(`  notes: ${seen.notes ? "fragment present" : "no fragment"} (want ${wantNotes ? "present" : "absent"}), beast-notes scripts ${dom.notesScript}, OnchainMidiNotes ${dom.notesApi}`);
  console.log(`  art: ${seen.art.source} (want ${wantArt})`);
  console.log(`  tempo: ${seen.tempo?.bpm} BPM (${seen.tempo?.microsecondsPerQuarter} us/quarter, division ${seen.tempo?.division})`);
  console.log(`  page: ${seen.page.length} bytes, doctype ${dom.doctype}, beast-art ${dom.art} (loaded ${dom.artLoaded}), midi ${dom.midiData}, settings ${dom.settings}, buttons ${dom.play}, errors ${errors.length ? errors.join(" | ") : "none"}, external requests ${external.length}`);
}
await browser.close();
if (!results.every(Boolean)) process.exitCode = 1;
