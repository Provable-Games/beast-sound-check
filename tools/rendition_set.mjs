// Reads a stored Sepolia rendition set (renditions/<deployment>/) and rebuilds each token's exact raw token_uri.
// Runs unchanged in a browser (DecompressionStream, crypto.subtle, TextEncoder, btoa) and in Node 22.
//
// Most of a Beast's token_uri is the same across tokens: the player, gunzip, notes and bootstrap scripts, the
// card's style (its embedded font), the species' GIF and many MIDI files. A set therefore stores:
//   fragments.json.gz        { "<sha256 of the fragment's UTF-8>": "<fragment text>", ... }, shared by the set
//   tokens/<token ID>.json.gz one skeleton per token: the token_uri taken apart at its three base64 data URIs
//     { uri: "data:application/json;base64,", json: <metadata JSON text>,
//       image: "data:image/svg+xml;base64,", svg: <card SVG text>,
//       page: "data:text/html;base64,", html: <animation_url page text> }
// In json, svg and html, NUL <64 hex> NUL stands for that fragment, NUL "I" NUL for the image data URI and
// NUL "P" NUL for the animation_url data URI. Rebuilding: svg -> image URI; html (with the image) -> page URI;
// json (with both) -> token_uri. The manifest's sha256 is of the raw token_uri, and every read checks it.
//
//   import { openRenditionSet } from "./tools/rendition_set.mjs";
//   const set = await openRenditionSet((p) => fetch(`renditions/sepolia-2026-10-29/${p}`).then((r) => r.arrayBuffer()));
//   const uri = await set.tokenUri(set.manifest.tokens[0].tokenId);   // throws on any mismatch

export const NUL = "\u0000";
export const IMAGE = `${NUL}I${NUL}`;
export const PAGE = `${NUL}P${NUL}`;
const REF = /\u0000([0-9a-f]{64})\u0000/g;

/** Standard padded base64 of a string's UTF-8 bytes. */
export function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A text with its fragment references replaced; an unknown reference throws. */
export function expand(text, fragments) {
  return text.replace(REF, (_, h) => {
    if (!Object.hasOwn(fragments, h)) throw new Error(`fragment ${h} is missing from the set`);
    return fragments[h];
  });
}

/** The exact token_uri a skeleton and the set's fragments describe. */
export function rebuildTokenUri(skeleton, fragments) {
  for (const k of ["uri", "json", "image", "svg", "page", "html"]) if (typeof skeleton[k] !== "string") throw new Error(`skeleton has no ${k}`);
  const image = skeleton.image + base64Utf8(expand(skeleton.svg, fragments));
  const page = skeleton.page + base64Utf8(expand(skeleton.html, fragments).split(IMAGE).join(image));
  const json = expand(skeleton.json, fragments).split(IMAGE).join(image).split(PAGE).join(page);
  if (json.includes(NUL)) throw new Error("rebuilt metadata still holds a placeholder");
  return skeleton.uri + base64Utf8(json);
}

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function gunzipText(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * Opens a set through `read(path)`, which returns a file's bytes (ArrayBuffer or Uint8Array) relative to the
 * set's directory. `tokenUri(tokenId)` rebuilds a token's raw token_uri and checks its length and SHA-256
 * against the manifest; any difference throws.
 */
export async function openRenditionSet(read) {
  const manifest = JSON.parse(new TextDecoder().decode(await read("manifest.json")));
  if (manifest.schema !== "beast-sound-check-renditions/v1") throw new Error(`not a rendition set: ${manifest.schema}`);
  if (manifest.storage?.layout !== "deduplicated" || manifest.storage.compression !== "gzip") throw new Error(`unsupported storage ${JSON.stringify(manifest.storage?.layout)}`);
  const fragments = JSON.parse(await gunzipText(await read(manifest.storage.fragments)));
  const byId = new Map(manifest.tokens.map((t) => [BigInt(t.tokenId), t]));
  async function tokenUri(tokenId) {
    const t = byId.get(BigInt(tokenId));
    if (!t) throw new Error(`token ${tokenId} is not in the set`);
    const uri = rebuildTokenUri(JSON.parse(await gunzipText(await read(t.file))), fragments);
    const bytes = new TextEncoder().encode(uri);
    if (bytes.length !== t.bytes || (await sha256Hex(bytes)) !== t.sha256) throw new Error(`${t.file}: the rebuilt token_uri differs from the manifest's raw bytes or sha256`);
    return uri;
  }
  return { manifest, fragments, tokenUri };
}
