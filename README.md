# Beast Sound Check

A phone-first listening test for the onchain MIDI player ([onchain-midi-player](https://github.com/Provable-Games/onchain-midi-player)): Casey Wescott's Beast compositions, every TinyChip preset and drum, and edge cases.

Open https://provable-games.github.io/beast-sound-check/ on your phone.

It runs player 0.8.0 (engine: [pocket-synth](https://github.com/Provable-Games/pocket-synth) v2.1.0, which asks phones and tablets for a larger audio buffer and a 1 s lookahead). For an A/B on the same device, https://provable-games.github.io/beast-sound-check/old/ is the same build from onchain-midi-player `8b1ff66`, just before the re-pin (player 0.7.0, engine v2.0.1), so the two differ only in the engine.

Track 418, "Stress test: load ramps", is for finding a phone's limits: it ramps the voice count (a heavy 8-operator filtered pad, 4 voices more each second up to 56) and then the note rate (up to 112 notes per second), then both at once, over a steady hi-hat. No voice is ever stolen, so a crackle or stutter is the device falling behind, and its time tells which load and how much. Track 419 is the same with the reverb off (the convolver's share of the load), and track 420 is a phone-sized ramp (up to 24 voices and 64 notes per second) whose ceiling should land mid-track.

The **Engine test** selector under the art (or `?test=<mode>` in the URL, for example `?test=def02#420`) injects a small script into the NFT page, ahead of the engine, that sets the AudioContext latency hint and the sequencer lookahead, and paints a meter at the top left of the player: Chrome's audio underruns (`AudioContext.playbackStats`, Chrome 146 and later), the longest main-thread stall, and the lookahead in effect. Modes: `meter` (as shipped), `big1`, `big02`, `def1`, `def02` (large or default buffer, 1 s or 0.2 s lookahead); and, all with a 1 s lookahead, `bal1` (latency hint "balanced"), `n02_1` and `n05_1` (a hint of 0.02 s and 0.05 s), `def1k` (default hint) and `n05_1k` (0.05 s), the last two with every oscillator's detune AudioParam k-rate. The meter also shows the hint, the base latency in frames and the detune rate in effect. Off by default; with it off, the page is exactly as shipped.

Why k-rate: the engine connects its CC1 vibrato oscillator to every oscillator's detune, which makes Chrome compute each phase increment per sample (an `exp2` each). A k-rate detune computes it once per 128-frame quantum, which is cheaper, but the vibrato then moves in steps of 128 frames (2.7 ms at 48 kHz). The injected script wraps `AudioContext.createOscillator` and `createBufferSource` to set it (guarded; Firefox has no `automationRate`; a buffer source's detune is k-rate by the spec anyway). Whether the steps are audible is for [samples/k-rate/](https://provable-games.github.io/beast-sound-check/samples/k-rate/), a-rate and k-rate renders of the cases most likely to show them through the real engine, hidden behind an answer, made by `tools/k_rate_samples.mjs`.

Each track is the complete `animation_url` page of onchain-midi-player's reference Beast consumer ([`examples/beast_consumer`](https://github.com/Provable-Games/onchain-midi-player/tree/main/examples/beast_consumer)). The NFT owns the controls (play and pause), art sync (inline SVG seeked to the music), background audio and media-session controls. Each page is round-tripped through the spliced `token_uri` and passes the player's `validate_token_uri`.

The art is the Beasts V3 card as the renderer draws it today (beasts-v3's renderer fixtures), with each species' genesis art. The Beasts rotate through shiny and regular, animated (GIF) and static (PNG); animated ones also have a "Synced" variant: the GIF as a PNG sprite sheet stepped on the beat by SMIL, simulating [beasts-v3#132](https://github.com/Provable-Games/beasts-v3/issues/132). As shipped, a Synced frame lasts an eighth note, or a quarter note above 150 BPM (when an eighth would be under 0.2 s). The **Animation speed** row under the art (or `?speed=<step>` in the URL: `ultraslow`, `slow`, `medium`, `fast`, `ultrafast` or `shipped`) sets one note value per frame for every track: Ultra slow a whole note, Slow a half, Medium a quarter, Fast an eighth, Ultra fast a sixteenth. Until a step is chosen, each track follows the shipped policy (dashed), so the page is as built. The page retimes only the sprite's `<animate>` `dur` from the track's exact tempo (microseconds per quarter note), leaving the card-sync animations alone; the original GIF keeps its own clock as the baseline, and static Beasts have nothing to time. The info line shows the frame length at the chosen step, the shipped step and its frame length, and the GIF's own frame length. Exported results record the art and speed each track was rated with. Every card marks its art frame `data-notes-bg`, so every track draws its own MIDI as a piano roll scrolling behind the Beast ([beasts-v3#218](https://github.com/Provable-Games/beasts-v3/pull/218), onchain-midi-player's notes fragment); production Beasts draw notes only for visual presets 2 and 3. The play button sits at the art frame's top-right corner (`data-play-anchor="235 54 24 top-right"`).

## Rebuild

The page is built from three other repos, all at `main`:

| Variable | Repo | What the build takes from it |
| --- | --- | --- |
| `OMP` | [onchain-midi-player](https://github.com/Provable-Games/onchain-midi-player) | Player and engine segments, the reference Beast page (`examples/beast_consumer`), page assembly and `validate_token_uri` |
| `BEAST` | [midi_fun_contract](https://github.com/caseywescott/midi_fun_contract) | Casey's beast-sound engine: each Beast's MIDI and the TinyChip settings |
| `BEASTS3` | [beasts-v3](https://github.com/Provable-Games/beasts-v3) (private) | The Beast card template and the 75 genesis GIFs |

The engine is [pocket-synth](https://github.com/Provable-Games/pocket-synth). onchain-midi-player pins an exact signed release of it, so the sound check follows pocket-synth only through onchain-midi-player.

### Refresh end to end

0. **Wait for open PRs to land** in all five repos. A refresh should test merged code:

   ```sh
   for r in Provable-Games/pocket-synth Provable-Games/onchain-midi-player caseywescott/midi_fun_contract Provable-Games/beasts-v3 Provable-Games/beast-sound-check; do echo "== $r"; gh pr list -R $r; done
   ```

1. **pocket-synth to onchain-midi-player (only for a new engine release).** Compare `gh release view -R Provable-Games/pocket-synth` with `ENGINE_PIN` in onchain-midi-player's `scripts/engine.mjs`. If a newer signed release changes the engine, re-pin it in onchain-midi-player as "Re-pinning" in its `tests/vendor/README.md` describes: verify the tag and its reproducible build, run `vendor_engine.mjs`, choose a new `VERSION`, regenerate and run the full checks. Then merge that PR. Releases that only change CI or docs need nothing.

2. **Make clean checkouts at `main`.** Use worktrees, not working checkouts that may have local changes:

   ```sh
   git -C /workspace/onchain-midi-player fetch -q origin
   git -C /workspace/onchain-midi-player worktree add --detach /workspace/onchain-midi-player-worktrees/sound-check origin/main
   (cd /workspace/onchain-midi-player-worktrees/sound-check && npm ci)

   git -C /workspace/midi_fun_contract fetch -q origin
   git -C /workspace/midi_fun_contract worktree add --detach /workspace/midi_fun_contract-worktrees/sound-check origin/main
   (cd /workspace/midi_fun_contract-worktrees/sound-check/offchain/beast-sound && npm install)

   git -C /workspace/beasts-v3 fetch -q origin
   git -C /workspace/beasts-v3 worktree add --detach /workspace/beasts-v3-worktrees/sound-check origin/main
   ```

3. **Build** from this repo, on an up-to-date `main`:

   ```sh
   git switch main && git pull --ff-only
   (cd tools/deps && npm ci)
   export OMP=/workspace/onchain-midi-player-worktrees/sound-check
   export BEAST=/workspace/midi_fun_contract-worktrees/sound-check
   export BEASTS3=/workspace/beasts-v3-worktrees/sound-check
   PLAYER=$(sed -n 's/^export const VERSION = "\([^"]*\)".*/\1/p' $OMP/scripts/segments.mjs)
   ENGINE=$(sed -n 's/^export const ENGINE_PIN = { ref: "\([^"]*\)".*/\1/p' $OMP/scripts/engine.mjs)
   export OMP_LABEL="origin/main $(git -C $OMP rev-parse --short HEAD) (player $PLAYER, pocket-synth $ENGINE)"
   export BEAST_LABEL="origin/main $(git -C $BEAST rev-parse --short HEAD)"
   node tools/gen_tracks.mjs        # writes tools/tracks.json: expect 77 tracks and "warn []"
   node tools/build_site.mjs        # writes index.html
   ```

   `bankFail` lists client-bank presets the beast-sound engine can't map yet (three AM-modulator presets as of 2026-10). They are reported, not errors.

   If the player `VERSION` changed and you want to A/B against the outgoing page, run `mkdir -p old && cp index.html old/index.html` before building, which serves the outgoing page at `/old/`. Saved results are stored per player version, so a new version starts with a clean sheet.

   `/old/` is built with the same tools from an older player, so a change to this site's tools (the engine test, say) needs both pages rebuilt. Make a second onchain-midi-player worktree at the old commit (`8b1ff66`, player 0.7.0, pocket-synth v2.0.1), run `gen_tracks.mjs` with that as `OMP` and `OMP_LABEL="origin/main before #85 8b1ff66 (player 0.7.0, pocket-synth v2.0.1)"`, build it with `OUT=$PWD/old/index.html node tools/build_site.mjs`, then build the main page as above. Rebuilding either from unchanged sources changes only the `generated` time in its data.

4. **Smoke-test** in Chromium and WebKit at phone size. Expect every check to pass in both:

   ```sh
   PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=chromium node tools/smoke.mjs
   PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=webkit node tools/smoke.mjs
   ```

   The browsers need their system libraries; `npx playwright install-deps` installs them where you have root. The test covers:

   - every section's tracks, with background audio and media metadata
   - play-button placement, size settings and touch target
   - sprite stepping and art drift against the music
   - the animation speed: the sprite `dur` at every step, with and without card sync, at and above 150 BPM; the card-sync animations unchanged; the shipped step by default; off for the GIF and static Beasts
   - pause and resume
   - the design lab

5. **Publish and verify:**

   ```sh
   git add -A && git commit -m "Rebuild from onchain-midi-player <sha>, midi_fun_contract <sha>" && git push
   gh api repos/Provable-Games/beast-sound-check/pages/builds/latest -q '.status + " " + .commit[0:7]'
   curl -s https://provable-games.github.io/beast-sound-check/ | grep -o '"ompCommit":"[^"]*"'
   ```

6. **Remove the worktrees** by running `git worktree remove <path>` in each repo.

## Sepolia rendition sets

`renditions/<deployment>/` holds real Beasts read from a Beasts V3 Sepolia deployment: the raw `token_uri` of one Beast for each of the 75 original species at visual effects 0, 1, 2 and 3 (sound effects equal to visual effects), plus the 75 Genesis Beasts (visual 3, sound 1). Each set is versioned by its deployment (for example `renditions/sepolia-2026-10-29/`) and is never overwritten. The page does not use it yet; the Sound Check will be rebuilt on top of it.

- `manifest.json` (`schemaVersion: 1`): the deployment, the beasts-v3 record and commit, the chain id and the block every read used, the NFT, registry, renderer, art provider and Sound Manager addresses, the TinySynth class and version, the renderer's rainbow and notes masks, and per token: token ID, species, name, identity (prefix and suffix), visual and sound effects, shiny, art (Shiny or Regular GIF), notes, rainbow, the MIDI's tempo, the raw size and the SHA-256 of the raw `token_uri`.
- `tokens/<token ID>.txt.gz`: the `token_uri` string exactly as the NFT returned it, gzipped (`storage.compression` in the manifest says so; a set under 25 MB would be stored raw). The site opens one with `new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text()` and derives everything else from it.
- Each token's `tracks` is `[]` for now. A later schema version will list the tracks a token holds, one `{ editionId, trackIndex, acquisition }` per track (`manifest.trackEntryShape`), once Sound Manager editions are live on Sepolia; readers of schema 1 ignore it.

The 2026-10-29 set is 375 files, 67.8 MiB raw and 39.7 MiB gzipped: 172–206 KB raw and 103–119 KB gzipped per token, averaging 179 KB raw at preset 0 up to 196 KB at preset 3 (the notes fragment and Shiny art). The player and the art in each `token_uri` are already compressed, so gzip saves only about 40%. **Retention:** keep the latest two sets in the tree (the current deployment and the one before, for A/B listening) and remove older ones in the commit that adds a new set; Git history keeps every set.

### Regenerate after a Sepolia deploy

Run these in order after every new Beasts V3 Sepolia deployment. Use worktrees, never someone's working checkout. The RPC URL is private: pass it in a file or an environment variable, and never print or commit it.

1. **Mint the set in beasts-v3** (on a branch from `main` that has the new deployment record), as its `AGENTS.md` describes:

   ```sh
   cd /workspace/beasts-v3-worktrees/<branch>
   pnpm install --frozen-lockfile && pnpm build:sdk
   R=~/.starknet_accounts/onchain_art_sepolia_rpc.private.json
   node scripts/mint-rendition-set.mjs --record deploy/records/<deployment>.json --rpc-file $R --dry-run
   node scripts/mint-rendition-set.mjs --record deploy/records/<deployment>.json --rpc-file $R
   node scripts/mint-rendition-set.mjs --render-doc --record deploy/records/<deployment>.json
   ```

   It mints only what is missing (it is safe to rerun) and writes `deploy/records/renditions-<deployment>.json`. Commit the record and the doc there.

2. **Read the set here**, from that beasts-v3 checkout:

   ```sh
   cd /workspace/beast-sound-check-worktrees/<branch>
   BEASTS3=/workspace/beasts-v3-worktrees/<branch> node tools/sepolia_renditions.mjs --rpc-file $R
   ```

   It reads the newest `renditions-sepolia-*.json` record (or `--record <path in BEASTS3>`) and writes `renditions/<deployment>/`. It refuses to run if the record disagrees with the chain (any original species' renderer, art provider or Sound Manager, the renderer's TinySynth, or a token that is not live), and every `token_uri` must pass beasts-v3's metadata conformance checks with its exact Shiny or Regular GIF and the renderer's notes mask.

3. **Check it:**

   ```sh
   BEASTS3=/workspace/beasts-v3-worktrees/<branch> node tools/sepolia_renditions.mjs --verify renditions/<deployment>
   BEASTS3=... PLAYWRIGHT_CORE=<node_modules/playwright-core> node tools/sepolia_renditions_spot.mjs renditions/<deployment>
   ```

   The first re-hashes every stored file against the manifest and re-runs the conformance checks offline. The second opens one token per preset in Chromium: the notes fragment only on presets 2 and 3, the Shiny GIF on 1 and 3, the tempo, and a page that loads with no errors and no network requests.

4. **Commit** the new set (and remove the oldest if more than two remain).
