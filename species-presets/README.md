# Beast Sound Check listening lab

One page has three modes, with the same 75 original Beasts and four preset buttons per Beast:

- **Species Song:** 296 unchanged Casey performances from upstream `cdcad0a4b5d6ef4f3ddb6555f3448cbb017766e1`, plus Satori's selected original lab #411 replacement in all four presets. Written #411 is exact to the original MIDI/settings; Mega, Echo and Mega + echo use Casey's complete performance behavior and matching settings banks. All play without time drift.
- **Sound Check:** 300 implemented launch candidates from the exact source revision in `manifest.json`, pending listening approval. Presets are Written, Mega, Portato and Mega/accent, with no chip echo. Cyclops is species 64 within this same 75, using the whole eight-sound original 504 sequence. Written preserves the exact 175 BPM reference; Mega accelerates the original bank, Portato shortens gates, and Mega/accent adds emphasis. All four performances are distinct and retain programs 34–41.

- **Name Song:** the existing production NamedSong recipe from pinned `4a16c58bf1738bcd3636f1e475a310b24ecbddc5`, composed locally on demand. Pick any of the canonical 69 first parts × 18 second parts, starting with Agony Bane. The recipe keeps the species theme and applies the name’s key/style; canonical names can share notes with Species Songs (Agony Bane Warlock does in every FX). Satori’s Agony Bane uses the derived C-Aeolian, low-register arrangement and earlier answer; its four effects have their full matching banks. Other Satori names use the canonical procedural recipes. Harpy/Pegasus keep their own species here, and Yeti keeps its special arrangement.

Switching modes retains the selected species, preset and chosen name. The name changes only Name Songs. All three modes reuse one pocket-synth 2.1.2 context, and the same regular card is fixed across modes/presets/names. Search, stepping, keyboard controls and pause/resume work throughout. The name is displayed beside the fixed regular artwork.

During playback the first embedded card GIF uses the production music policy: one frame per eighth note through 150 BPM, then one per quarter note above 150 BPM. Uneven native frames retain whole-step proportions; cumulative centisecond rounding and repeated frames limit timing drift. The music’s audible pass restarts it on each loop. Pause replaces just that GIF with a still; resume and visibility restoration recover its musical phase where the GIF supports it, with the production first-frame fallback otherwise. Ambient SVG/SMIL keeps running. Reduced motion holds the first GIF frame throughout. Before playback, the original native GIF timing is retained. The canonical regular artwork remains independent of sound effects.

`art-sync.mjs` is byte-identical to the production-pinned `examples/beast_consumer/art_sync.js` at `38e21a1d67b4e39103341ad8f6f961ac36d5ef7a`. `music-clock.mjs` adapts the same revision’s audible clock, browser latency compensation and pass notifications to the existing multi-selection transport. Artwork and piano roll share that clock; the music payload and synth scheduling are unchanged. Exact paths, hashes, license and adaptation notes are in `art-sync-source.json` and the accompanying Apache license/notice files. Browser GIF/image decoding can delay a replacement by one decode, as in production; browser latency is an estimate, and the upstream 17ms display lead is preserved.

The default mode is Sound Check. Existing links such as `/#64-0` still open the Species Song. Use `/#check-64-0` for the included Cyclops Sound Check, or `/#check-1-0` to start at Warlock. Use `/#name-44-0-1` for Agony Bane Satori; named links include the species, preset and official name variant (1–1242). Invalid links fall back to Sound Check Warlock. Preset 0 is a technical default, not evidence of an artistic preference.

The reviewed combined page is served locally on port 8791. To run it:

```sh
python3 -m http.server 8791 --bind 127.0.0.1 --directory species-presets
```

Port 8792 was used for testing before the approved handoff. The 8790 candidate and 8789 historical labs stay untouched.

## Sources and proof

`species-song-manifest.json`, `samples-e075863e3a5186b0.json.gz` and `cairo-proof.json` retain the original 300-Song reference and its proof unchanged. The live dataset replaces only Satori's four Song selections, with `satori-song-cairo-proof.json` binding the actual replacement MIDI/settings to Cairo. The other 296 Songs, all 300 Checks and all 75 art strings remain unchanged by that replacement.

`manifest.json` records the pinned baseline, the explicit Satori Song override, all 600 sample hashes and the combined payload hash. `check-cairo-proof.json` independently binds every one of the 300 Check MIDI/settings outputs to actual captures from the complete shared Sound Check matrix (75 species × 4 effects). Cyclops Written MIDI/settings are also compared with the original 504 fixture. `tools/launch-check-reference/` contains the qualified adapter/source loader/matrix shared by the listening-room builder and the root sampler. The original raw Song reference retains its historical source/adapter metadata; current previews use the explicit approved lab pin in `tools/current-music.json`.

Regenerate the 300 actual Cairo captures in an isolated archive of a clean pinned source, then compare and build. The archive needs its normal Scarb dependencies and pinned toolchain. Add the generated module to its `beasts/beast_contracts/src/lib.cairo` as `#[cfg(test)] mod sound_check_parity;` and run it there:

```sh
node tools/sound-check-parity.mjs cairo > /path/to/archive/beasts/beast_contracts/src/sound_check_parity.cairo
# From the archive's beasts/beast_contracts directory:
snforge test --max-n-steps 4294967295 --max-threads 2 sound_check_parity --include-ignored > /path/to/parity.log 2>&1
# From this lab worktree, using the clean source of the archived revision:
BEAST=/path/to/clean-midi PARITY_OUT=/path/to/parity.json node tools/sound-check-parity.mjs compare /path/to/parity.log
# In a separate archive, repeat generation/test/compare with --satori on both node commands
# to capture the four Satori Species Songs; keep those log/proof files separately.
CHECK_BEAST=/path/to/clean-midi CHECK_REVISION=<full-reviewed-commit> CHECK_PROOF=/path/to/check-parity.json CHECK_CAIRO_LOG=/path/to/check-parity.log SATORI_PROOF=/path/to/satori-parity.json SATORI_CAIRO_LOG=/path/to/satori-parity.log node tools/build-species-presets.mjs
```

All600 complete SMFs and settings are parsed during generation. `tools/species-preset-cairo.mjs` continues to compare only the original 20 Song captures against the unchanged original segment; it does not relabel that proof as a new 600-case capture.

With the server running:

```sh
AUDITION_URL=http://127.0.0.1:8791 LD_LIBRARY_PATH=/tmp/beasts-browser-runtime/root/usr/lib/x86_64-linux-gnu node tools/species-preset-browser.mjs
```

The browser check verifies all 600 UI-to-MIDI/settings routes, 296 unchanged Songs plus the four Cairo-proven Satori replacements, mode/preset persistence, non-silent audio including all four Satori and Cyclops performances, single-context/no-overlap behavior, rapid selection, aliases/keyboard, legacy/new links, decoded art and 390px layout. `browser-proof.json` records the result. No wallet, RPC, backend service, deployment or external requests are involved.


Animation regression checks (with the candidate served locally):

```sh
node tools/art-sync-test.mjs
AUDITION_URL=http://127.0.0.1:8793 LD_LIBRARY_PATH=/tmp/beasts-browser-runtime/root/usr/lib/x86_64-linux-gnu node tools/art-sync-browser.mjs
```

The Node check covers all 600 actual tempos and decoded frame pixels, the strict 150 BPM boundary, uneven delays, GIF rotation/fallbacks, and audible pass/pause/latency semantics. The browser check covers actual low/high-tempo performances and FX changes, full loops, phase restoration on resume/visibility events, intentionally delayed/stale image loads, first-frame reduced-motion pixels, decode/resize/mobile layout, single-context playback, and no errors or external requests. The visibility event is simulated so its phase check is deterministic; background throttling and device-specific audio/display latency remain browser limits.

## Name Song build and proof

The qualified source is available on the [launch-review fork branch](https://github.com/loothero/midi_fun_contract/tree/feat/beast-sound-check-launch-review), pinned to commit `4a16c58bf1738bcd3636f1e475a310b24ecbddc5`.

`names/manifest.json` separately pins the proposed production source, adapter, source-tree digest, official name table, worker and compressed settings-bank hashes. It leaves the existing 600 samples, their manifest/proofs, settings installer, synth, artwork, MIDI roll and production art helper unchanged. The browser verifies the worker and bank SHA-256 before use. All assets are relative static files, including when served under `/species-presets/`; no RPC, wallet, remote API or backend is involved.

Name metadata initializes only when that mode is selected. A missing or aborted Name manifest leaves the 600 baseline choices available; named deep links show a Name-only unavailable state, and Play retries without reload. While composition is pending or unavailable, the roll hides previous note content and labels the selected name/status. Reduced motion retains the production first-frame still throughout these states.

One worker composes only requested Name Songs. It keeps at most one running request and one queued latest selection, plus a 24-result cache. The player initializes/resumes its persistent context synchronously during the user gesture, using an existing safe bank while composition is pending. It installs the canonical returned settings before loading the generated MIDI. Selection and playback tokens prevent older worker, image or resume results from starting or replacing a newer selection. Failed named composition leaves the 600 static choices usable and can be retried. A generated track’s real MIDI header/duration drives the piano roll and existing production art clock.

Rebuild with a clean source checkout at exactly the pinned revision and installed Node dependencies:

```sh
BEAST=/path/to/clean-pinned-midi OMP=/path/to/onchain-midi-player node tools/build-name-song.mjs
```

To regenerate the independent Cairo proof, archive that revision into a separate temporary directory, then generate/add/run the test module there. Do not change a live composer checkout:

```sh
node tools/name-song-parity.mjs cairo > /path/to/archive/beasts/beast_contracts/src/name_song_parity.cairo
# Append #[cfg(test)] mod name_song_parity; to that archive’s src/lib.cairo.
# In the archive’s beasts/beast_contracts directory:
snforge test --max-n-steps 4294967295 --max-threads 2 name_song_parity --include-ignored > /path/to/named-parity.log 2>&1
# Back in the lab, pointing BEAST at the same clean pinned revision:
BEAST=/path/to/clean-pinned-midi node tools/name-song-parity.mjs compare /path/to/named-parity.log
```

`names/preservation-proof.json` records the byte-identical hashes of all 21 retained baseline assets/proof sources, covering the 600 sample payload, 75 artwork strings, settings/synth/clock/art modules and qualified source adapter.

`names/parity.json` records 332 actual Cairo captures as MIDI fingerprints and settings hashes, with the source manifest and capture-log hash. Coverage includes 75 species × four FX with deterministic valid names, official string lookups for Agony Bane/Blood Shadow Warlocks, Satori name 1 and another name, both sides of the shared-song swap, Yeti and name 1242 in every FX. This is stratified qualification, not an assertion that all 372,600 combinations were exhaustively run through Cairo.

With a static server rooted at this repository (the isolated candidate uses port 8794), run:

```sh
AUDITION_URL=http://127.0.0.1:8794/species-presets LD_LIBRARY_PATH=/tmp/beasts-browser-runtime/root/usr/lib/x86_64-linux-gnu node tools/name-song-browser.mjs
```

The browser compares the actual shipped worker outputs/settings to all 332 Cairo capture fingerprints, routes all 300 stratified choices through the real UI/piano roll, and checks first-click audio while the worker is delayed, non-silent playback, bounded worker/cache, selector/name/FX/mode persistence, stale worker/resume/image results, stop while composing, retry after transport failure, a real full named Yeti loop, exact art beat policy, reduced motion, invalid/share/reload URLs, 390px layout, one AudioContext, no JavaScript errors and no external requests. `names/browser-proof.json` records these results. Existing browser/art/MIDI-roll suites continue to cover the unchanged 600 static performances.

Name loading/error regressions can be run independently:

```sh
AUDITION_URL=http://127.0.0.1:8794/species-presets LD_LIBRARY_PATH=/tmp/beasts-browser-runtime/root/usr/lib/x86_64-linux-gnu node tools/name-song-loading-browser.mjs
```

This check covers 404/aborted Name manifests, base-mode recovery and named deep links, retry without reload, reduced-motion artwork during a delayed/failed composition, and hidden stale piano-roll content with accurate selected-name/status text. Results are in `names/loading-browser-proof.json`.
