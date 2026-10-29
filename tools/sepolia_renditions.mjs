#!/usr/bin/env node
// Builds a versioned rendition set from a Beasts V3 Sepolia deployment: the raw token_uri of every token in
// beasts-v3's rendition record (one Beast per original species at visual effects 0-3, sound effects equal to
// visual effects, plus the 75 Genesis Beasts), read at one block, verified, and written under
// renditions/<deployment>/ with a manifest. The raw token_uri is the ground truth; the site derives the rest.
//
//   BEASTS3=<beasts-v3 checkout with the record, `pnpm build:sdk` run> node tools/sepolia_renditions.mjs \
//     --rpc-file ~/.starknet_accounts/onchain_art_sepolia_rpc.private.json [--record deploy/records/renditions-sepolia-<date>.json]
//   node tools/sepolia_renditions.mjs --verify renditions/sepolia-<date>     # re-check a stored set offline
//
// --rpc-file is a JSON file whose "url" is a private Sepolia RPC (or set BEASTS_DEPLOY_RPC_URL). The URL is never
// printed or written: every message goes through beasts-v3's redactor. Sepolia only.
//
// It refuses to run when the record disagrees with the chain: each original species' renderer, art provider and
// sound manager (registry reads), the renderer's TinySynth class and version, and the record's token IDs.
// Each token_uri must pass beasts-v3's assertTokenMetadataConformance (the checks of `metadata:check --token-uri`)
// with its expected token ID, species, the renderer's rainbow mask and the exact canonical GIF; its notes fragment
// must match the renderer's notes mask. Over SIZE_LIMIT the files are stored gzipped (the site opens them with
// DecompressionStream("gzip")).
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(here);
export const SCHEMA = "beast-sound-check-renditions/v1";
export const SCHEMA_VERSION = 1;
export const SIZE_LIMIT = 25 * 1024 * 1024;
const RECORD_SCHEMA = "beasts-rendition-set/v1";
/** The future shape of a token's `tracks` entry; schema 1 always writes `tracks: []`. */
export const TRACK_ENTRY_SHAPE = {
  editionId: "the Sound Manager edition the track belongs to (midi_fun_contract editions)",
  trackIndex: "the track index within the token's tracks",
  acquisition: "{ kind: \"shared\" | \"purchase\", txHash, blockNumber }: how the token got the track",
};

function parseArgs(argv) {
  const o = {};
  const valued = { "--record": "record", "--rpc-file": "rpcFile", "--out": "out", "--verify": "verify", "--beasts3": "beasts3" };
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i].split(/=(.*)/s, 2);
    if (name === "--replace") o.replace = true;
    else if (valued[name]) {
      const v = inline ?? argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${name} needs a value`);
      o[valued[name]] = v;
    } else throw new Error(`unknown argument ${argv[i]}`);
  }
  return o;
}

const expand = (p) => (p.startsWith("~/") ? path.join(process.env.HOME, p.slice(2)) : p);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** beasts-v3's deploy helpers, built SDK and starknet hash, from the BEASTS3 checkout. */
async function loadBeasts(beasts3) {
  if (!beasts3) throw new Error("set BEASTS3 (or --beasts3) to a beasts-v3 checkout");
  const deploy = await import(pathToFileURL(path.join(beasts3, "scripts", "deploy-beasts.mjs")).href);
  const entry = path.join(beasts3, "sdk", "dist", "index.js");
  if (!fs.existsSync(entry)) throw new Error(`${entry} is missing; run \`pnpm build:sdk\` in BEASTS3`);
  const sdk = await import(pathToFileURL(entry).href);
  const { hash } = await import(pathToFileURL(createRequire(path.join(beasts3, "sdk", "package.json")).resolve("starknet")).href);
  return { deploy, sdk, hash };
}

/** The newest deploy/records/renditions-sepolia-*.json in BEASTS3. */
function latestRecord(beasts3) {
  const dir = path.join(beasts3, "deploy", "records");
  // Latest date, then the highest same-day number (a day's first record has none, its second is -2, its tenth -10).
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    const m = /^renditions-sepolia-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.json$/.exec(f);
    if (m) found.push({ f, date: m[1], n: m[2] === undefined ? 1 : Number(m[2]) });
  }
  if (!found.length) throw new Error(`no renditions-sepolia-*.json in ${dir}; mint the set first (scripts/mint-rendition-set.mjs)`);
  found.sort((a, b) => (a.date === b.date ? a.n - b.n : a.date < b.date ? -1 : 1));
  return path.join("deploy", "records", found.at(-1).f);
}

/** A Standard MIDI File's division and tempo map (FF 51 03 meta events), from its bytes. */
export function midiTempo(bytes) {
  const b = Buffer.from(bytes);
  if (b.toString("latin1", 0, 4) !== "MThd") throw new Error("MIDI data is not an SMF");
  const division = b.readUInt16BE(12);
  const tempos = [];
  let pos = 8 + b.readUInt32BE(4);
  for (let track = 0; pos + 8 <= b.length; track++) {
    if (b.toString("latin1", pos, pos + 4) !== "MTrk") throw new Error(`chunk ${track} is not MTrk`);
    const end = pos + 8 + b.readUInt32BE(pos + 4);
    let p = pos + 8, tick = 0, running = 0;
    const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
    while (p < end) {
      tick += vlq();
      let status = b[p];
      if (status & 0x80) p++; else status = running;
      if (status === 0xff) {
        const type = b[p++], len = vlq();
        if (type === 0x51 && len === 3) tempos.push({ track, tick, microsecondsPerQuarter: b.readUIntBE(p, 3) });
        p += len;
      } else if (status === 0xf0 || status === 0xf7) p += vlq();
      else {
        running = status;
        p += (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
      }
    }
    pos = end;
  }
  tempos.sort((x, y) => x.tick - y.tick);
  const first = tempos[0]?.microsecondsPerQuarter ?? 500000;
  return { division, microsecondsPerQuarter: first, bpm: Math.round((60e6 / first) * 1000) / 1000, tempoChanges: tempos.length };
}

/** What a stored token_uri shows: metadata, the player page, its MIDI tempo, notes and art. */
export function inspect(uri, { notesFragment, genesisArt }) {
  const meta = JSON.parse(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8"));
  const trait = (t) => meta.attributes.find((a) => a.trait_type === t)?.value;
  const page = meta.animation_url ? Buffer.from(meta.animation_url.slice(meta.animation_url.indexOf(",") + 1), "base64").toString("utf8") : null;
  const midiB64 = page && /<script type="text\/plain" id="onchain-midi-data">([^<]*)<\/script>/.exec(page)?.[1];
  const svg = Buffer.from(meta.image.slice(meta.image.indexOf(",") + 1), "base64").toString("utf8");
  const gif = /data:image\/gif;base64,([A-Za-z0-9+/=]+)/.exec(svg)?.[1];
  const artSha = gif ? sha256(Buffer.from(gif, "base64")) : null;
  const art = genesisArt.get(artSha) ?? null;
  return {
    meta, page, svg,
    tokenId: BigInt(trait("Token ID")),
    tempo: midiB64 ? midiTempo(Buffer.from(midiB64, "base64")) : null,
    notes: page ? page.includes(notesFragment) && page.includes('<script id="beast-notes">') : false,
    notesScript: page ? page.includes('<script id="beast-notes">') : false,
    art: art ? { provider: art.provider, source: art.source, sha256: artSha } : { provider: null, source: null, sha256: artSha },
  };
}

function genesisArtIndex(beasts3) {
  const m = JSON.parse(fs.readFileSync(path.join(beasts3, "assets", "genesis", "manifest.json"), "utf8"));
  return new Map(m.assets.filter((a) => a.mime === "image/gif").map((a) => [a.sha256, a]));
}

function artUriFor(beasts3, genesisArt, speciesId, shiny) {
  const a = [...genesisArt.values()].find((x) => x.speciesId === speciesId && x.provider === (shiny ? "shiny-gif" : "regular-gif"));
  return `data:image/gif;base64,${fs.readFileSync(path.join(beasts3, a.source)).toString("base64")}`;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function fetchSet(o) {
  const beasts3 = path.resolve(o.beasts3 ?? process.env.BEASTS3 ?? "");
  const { deploy, sdk, hash } = await loadBeasts(beasts3);
  const recordRel = o.record ?? latestRecord(beasts3);
  const rec = JSON.parse(fs.readFileSync(path.join(beasts3, recordRel), "utf8"));
  if (rec.schema !== RECORD_SCHEMA) throw new Error(`${recordRel} is not a ${RECORD_SCHEMA} record`);
  if (rec.network !== "sepolia" || rec.chainId !== "SN_SEPOLIA") throw new Error(`${recordRel} is not a Sepolia record`);
  const { record: base } = deploy.recordWithAddenda(path.join(beasts3, rec.baseRecord));
  const url = o.rpcFile ? JSON.parse(fs.readFileSync(expand(o.rpcFile), "utf8")).url : process.env.BEASTS_DEPLOY_RPC_URL;
  if (!url) throw new Error("pass --rpc-file <json with \"url\"> or set BEASTS_DEPLOY_RPC_URL");
  const redact = deploy.createRedactor([url]);
  try {
    return await fetchWith({ o, beasts3, deploy, sdk, hash, rec, recordRel, base, rpc: deploy.createRpc(url, { redact }), redact });
  } catch (e) {
    e.message = redact(e.message);
    throw e;
  }
}

async function fetchWith({ o, beasts3, deploy, sdk, hash, rec, recordRel, base, rpc, redact }) {
  const { toHex, u256, decodeByteArray, decodeShortString } = deploy;
  const log = (s) => console.log(redact(s));
  const chainId = decodeShortString(await rpc("starknet_chainId", []));
  if (chainId !== "SN_SEPOLIA") throw new Error(`the RPC serves ${chainId}, not SN_SEPOLIA`);
  const block = Number(await rpc("starknet_blockNumber", []));
  const at = { block_number: block };
  const sel = new Map();
  const call = async (address, fn, calldata = []) => {
    if (!sel.has(fn)) sel.set(fn, hash.getSelectorFromName(fn));
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await rpc("starknet_call", [{ contract_address: toHex(address), entry_point_selector: sel.get(fn), calldata: calldata.map(toHex) }, at]);
        return r.map((x) => BigInt(x));
      } catch (e) {
        // createRpc already retries HTTP 429/5xx; also retry a transient node error a few times.
        if (attempt >= 4 || !/timeout|timed out|rate|503|502|504|ECONNRESET|internal/i.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  };

  // The record must describe this chain: the base record (with its addenda) and the rendition record agree, and
  // every original species routes through the recorded renderer, art provider and sound manager.
  const c = rec.contracts;
  const same = (a, b) => BigInt(a) === BigInt(b);
  const want = {
    beasts_nft: base.contracts.beasts_nft.address, beast_registry: base.contracts.beast_registry.address,
    beasts_renderer_classic: base.contracts.beasts_renderer_classic.address, original_art_provider: base.contracts.original_art_provider.address,
    originals_sound_manager: base.config.soundManager,
  };
  for (const [k, v] of Object.entries(want)) if (!same(c[k], v)) throw new Error(`${recordRel} names ${k} ${c[k]}, but ${rec.baseRecord} with its addenda holds ${v}`);
  const bad = [];
  for (let s = 1; s <= 75; s++) {
    const [renderer] = await call(c.beast_registry, "get_renderer", [s]);
    const [art] = await call(c.beast_registry, "get_art_provider", [s]);
    const [sound] = await call(c.beast_registry, "get_sound_manager", [s]);
    if (!same(renderer, c.beasts_renderer_classic)) bad.push(`species ${s} renderer ${toHex(renderer)}`);
    if (!same(art, c.original_art_provider)) bad.push(`species ${s} art provider ${toHex(art)}`);
    if (!same(sound, c.originals_sound_manager)) bad.push(`species ${s} sound manager ${toHex(sound)}`);
  }
  if (bad.length) throw new Error(`the chain disagrees with ${recordRel} at block ${block}: ${bad.slice(0, 6).join("; ")}${bad.length > 6 ? ` (+${bad.length - 6})` : ""}; refusing`);
  const [tinysynthClass] = await call(c.beasts_renderer_classic, "get_tinysynth_class_hash");
  const tinysynthVersion = decodeShortString((await call(c.beasts_renderer_classic, "get_tinysynth_version"))[0]);
  if (!same(tinysynthClass, rec.tinysynth.classHash) || tinysynthVersion !== rec.tinysynth.version) throw new Error(`the renderer's TinySynth is ${toHex(tinysynthClass)} ${tinysynthVersion}, the record's ${rec.tinysynth.classHash} ${rec.tinysynth.version}; refusing`);
  const rainbow = Number((await call(c.beasts_renderer_classic, "get_rainbow_presets"))[0]);
  const notesMask = Number((await call(c.beasts_renderer_classic, "get_notes_presets"))[0]);
  log(`block ${block}: record ${recordRel} matches the chain (75 species), TinySynth ${tinysynthVersion}, rainbow mask ${rainbow}, notes mask ${notesMask}`);

  const tokens = [
    ...rec.tokens.map((t) => ({ ...t, kind: "rendition" })),
    ...rec.genesis.map((t) => ({ ...t, kind: "genesis", prefix: 0, suffix: 0 })),
  ];
  for (const t of tokens) {
    const id = (await call(c.beasts_nft, "get_token_id_by_affixes", [t.speciesId, t.prefix, t.suffix]))[0];
    if (t.kind === "genesis" ? !same((await call(c.beasts_nft, "get_genesis_token_id", [t.speciesId]))[0], t.tokenId) : !same(id, t.tokenId)) {
      throw new Error(`${t.name} (${t.tokenId}) is not live at block ${block}; refusing`);
    }
  }

  const notesFragment = fs.readFileSync(path.join(beasts3, "assets", "player-page", "notes.html"), "utf8");
  const genesisArt = genesisArtIndex(beasts3);
  const species = new Map(sdk.originalSpeciesCatalog().map((s) => [Number(s.speciesId), s.name]));
  const setName = path.basename(rec.baseRecord, ".json");
  const outDir = path.resolve(o.out ?? path.join(ROOT, "renditions", setName));
  if (fs.existsSync(outDir) && !o.replace) throw new Error(`${path.relative(ROOT, outDir)} exists; a set is never overwritten (pass --replace to rebuild it on purpose)`);

  let done = 0;
  const uris = await pool(tokens, 4, async (t) => {
    const felts = await call(c.beasts_nft, "token_uri", u256(BigInt(t.tokenId)));
    const uri = decodeByteArray(felts).bytes.toString("utf8");
    if (++done % 25 === 0) log(`  ${done}/${tokens.length} token_uri read`);
    return uri;
  });

  const entries = tokens.map((t, i) => {
    const uri = uris[i];
    const shiny = (t.visualEffects & 1) === 1;
    const validated = sdk.assertTokenMetadataConformance(uri, {
      tokenId: BigInt(t.tokenId), speciesName: species.get(t.speciesId), rainbowPresets: rainbow,
      artDataUri: artUriFor(beasts3, genesisArt, t.speciesId, shiny),
    });
    const seen = inspect(uri, { notesFragment, genesisArt });
    const wantNotes = ((notesMask >> t.visualEffects) & 1) === 1;
    if (seen.notes !== wantNotes || seen.notesScript !== wantNotes) throw new Error(`${t.name}: notes ${seen.notes}, want ${wantNotes} (preset ${t.visualEffects})`);
    if (seen.art.provider !== (shiny ? "shiny-gif" : "regular-gif") || seen.art.source !== artUriSource(genesisArt, t.speciesId, shiny)) throw new Error(`${t.name}: art ${seen.art.source}, want the ${shiny ? "Shiny" : "Regular"} GIF`);
    if (!seen.tempo) throw new Error(`${t.name}: no MIDI in its animation_url`);
    const b = validated.beast;
    if (Number(b.visualEffects) !== t.visualEffects || Number(b.soundEffects) !== t.soundEffects) throw new Error(`${t.name}: token ID presets differ from the record`);
    const bytes = Buffer.from(uri, "utf8");
    return {
      t, bytes,
      row: {
        tokenId: toHex(BigInt(t.tokenId)),
        kind: t.kind,
        speciesId: t.speciesId,
        species: species.get(t.speciesId),
        name: validated.metadata.name,
        identity: { prefix: b.prefix, suffix: b.suffix },
        visualEffects: Number(b.visualEffects),
        soundEffects: Number(b.soundEffects),
        shiny,
        art: seen.art.provider,
        notes: seen.notes,
        rainbow: ((rainbow >> Number(b.visualEffects)) & 1) === 1,
        tempo: seen.tempo,
        bytes: bytes.length,
        sha256: sha256(bytes),
        tracks: [],
      },
    };
  });

  const rawBytes = entries.reduce((s, e) => s + e.bytes.length, 0);
  const gzip = rawBytes > SIZE_LIMIT;
  fs.mkdirSync(path.join(outDir, "tokens"), { recursive: true });
  let storedBytes = 0;
  for (const e of entries) {
    const file = `tokens/${e.row.tokenId}.txt${gzip ? ".gz" : ""}`;
    const data = gzip ? zlib.gzipSync(e.bytes, { level: 9, mtime: 0 }) : e.bytes;
    fs.writeFileSync(path.join(outDir, file), data);
    e.row.file = file;
    e.row.storedBytes = data.length;
    storedBytes += data.length;
  }
  const beastsCommit = gitHead(beasts3);
  const manifest = {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    deployment: setName,
    record: { path: recordRel, sha256: sha256(fs.readFileSync(path.join(beasts3, recordRel))), baseRecord: rec.baseRecord, addenda: rec.addendaApplied, mintedWithCommit: rec.beastsCommit },
    beastsCommit,
    network: rec.network,
    chainId,
    blockNumber: block,
    generatedAt: new Date().toISOString(),
    contracts: { ...rec.contracts, tinysynth: { classHash: toHex(tinysynthClass), version: tinysynthVersion } },
    renderer: { rainbowPresets: rainbow, notesPresets: notesMask },
    storage: {
      encoding: "utf-8",
      compression: gzip ? "gzip" : "none",
      note: gzip ? "each file is the gzip of the raw token_uri string (open with DecompressionStream(\"gzip\")); sha256 is of the raw string" : "each file is the raw token_uri string; sha256 is of its bytes",
      sizeLimit: SIZE_LIMIT,
      rawBytes,
      storedBytes,
      tokens: entries.length,
    },
    trackEntryShape: TRACK_ENTRY_SHAPE,
    tokens: entries.map((e) => e.row),
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`wrote ${path.relative(ROOT, outDir)}: ${entries.length} tokens, ${(rawBytes / 1048576).toFixed(2)} MiB raw, ${(storedBytes / 1048576).toFixed(2)} MiB stored (${manifest.storage.compression})`);
  verifySet(outDir, { beasts3, sdk, quiet: false });
  return manifest;
}

const artUriSource = (genesisArt, speciesId, shiny) => [...genesisArt.values()].find((x) => x.speciesId === speciesId && x.provider === (shiny ? "shiny-gif" : "regular-gif")).source;

function gitHead(dir) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Re-reads a stored set: every file's raw bytes hash to its manifest entry and still pass the conformance checks. */
export function verifySet(dir, { beasts3, sdk, quiet = true } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (manifest.schema !== SCHEMA) throw new Error(`${dir} is not a ${SCHEMA} set`);
  let n = 0;
  for (const t of manifest.tokens) {
    const stored = fs.readFileSync(path.join(dir, t.file));
    const raw = manifest.storage.compression === "gzip" ? zlib.gunzipSync(stored) : stored;
    if (raw.length !== t.bytes || sha256(raw) !== t.sha256) throw new Error(`${t.file}: bytes or sha256 differ from the manifest`);
    if (sdk) sdk.assertTokenMetadataConformance(raw.toString("utf8"), { tokenId: BigInt(t.tokenId), rainbowPresets: manifest.renderer.rainbowPresets });
    n++;
  }
  if (!quiet) console.log(`verified ${n} stored token_uri files against the manifest${sdk ? " and the conformance checks" : ""}`);
  return n;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.verify) {
    const beasts3 = o.beasts3 ?? process.env.BEASTS3;
    const sdk = beasts3 ? (await loadBeasts(path.resolve(beasts3))).sdk : null;
    verifySet(path.resolve(o.verify), { sdk, quiet: false });
    return;
  }
  await fetchSet(o);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exitCode = 1;
  });
}
