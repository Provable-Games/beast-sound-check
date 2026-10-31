# Beast Sound Check

A phone-first listening test for the proposed production sound of all 75 original Beasts. The default **Sample all 75 Beasts** panel composes official Sound Checks, Species Songs, named songs and generated custom tracks on your device. Deployed Sepolia token pages and the synthetic engine tests remain available as references.

The sampler uses midi_fun_contract `e9b0f66` (v1.0.0) and onchain-midi-player 0.12.0 / pocket-synth v2.1.2. Its adapter is checked against the actual Cairo composer: **1,611 cases have identical MIDI bytes and synth-settings hashes**. The existing 75 Species Songs also match this production composer.
Open https://provable-games.github.io/beast-sound-check/ on your phone.

The engine tests run player 0.12.0 (engine: [pocket-synth](https://github.com/Provable-Games/pocket-synth) v2.1.2, with a k-rate detune on every oscillator). For an A/B on the same device, https://provable-games.github.io/beast-sound-check/old/ is the same build from onchain-midi-player `8b1ff66`, just before the re-pin (player 0.7.0, engine v2.0.1), so the two differ only in the engine. (`/old/` predates section 1: it still has Casey's compositions on the reference page in its place. It has no section 6.)

## Sampling proposed production sound

The sampler opens on the Warlock's Species Song. Every control updates the sample; tap the card's round play button to listen. Previous/Next species, including the bottom navigation bar, keep the current track, name, effects, edition and seed so you can compare the same treatment across all 75 Beasts.

- **Sound Check:** the short official scale/preset test, with or without a special name.
- **Species Song:** the shared song as written; applies the Harpy/Pegasus swap exactly once.
- **Name Song:** the species' theme with any of the 69 × 18 special names. Without a name this is its unswapped base song.
- **Custom canon:** the edition 0 purchase path, including its seeded treatment, channel selection and purchase shape.
- **Edition track:** all 23 style engines. The edition number supports later passes through the styles; changing style preserves the current pass. As in production, edition tracks use the low 64 bits of the supplied seed and their music is independent of the special name.

Effects 0–3 use the composer's actual performance rules (tempo, velocity ceiling, articulation, mega and chip echo). Sound Checks have no chip echo. Seeds accept decimal or hexadecimal Starknet felts, including zero, without passing through a JavaScript Number. Next seed and Random seed explore more variations. These are reproducible previews as written, not owned tracks or live chain simulations; the seed is the variation identity passed to `generate_inputs`, not a claim that a purchase occurred.

The sampler follows the latest stored Sepolia rendition set's visual preset notes mask: presets 0 and 1 have no MIDI visualization; presets 2 and 3 show the active track’s MIDI behind the Beast. Its effects selector pairs visual and sound effects, matching the rendition tokens. It uses the current Beasts V3 head/body/notes/footer fragments, verified against `assets/player-page/manifest.json`, including the redraw fix for initially hidden or paused cards. The GIF follows the music’s beat and holds on pause. Deployed Sepolia reference pages remain the exact token pages, using each token's own visual effects.

Composition runs in a Web Worker from the pinned reference modules, with a small local adapter for purchase shape, performance and channel selection. The worker and one compressed art/settings bundle are static assets under `production/`; the bundle is fetched once, checked against its SHA-256 and cached in memory. There is no wallet, RPC or new backend. Changing samples replaces the single player, stopping previous audio. A delayed composition cannot replace a newer selection. Errors are explicit and failed compositions cannot be rated.

Pass/Fail and notes belong to the exact normalized sample and the content-addressed production build. Exports include species, track kind, effects, name ID, edition, full seed, composer revision and player version. Share the URL to reopen the same sample. Existing engine/Sepolia ratings and `#601`–`#675` links are preserved; new builds retain older sample records in the export, without treating them as ratings of changed audio.

### Refresh the production sampler

Use a clean pinned `BEAST` checkout with its `offchain/beast-sound` dependencies installed, plus `OMP` and `BEASTS3` as below. Run the following from this repository. The Cairo fixture runs in a temporary source copy, leaving the working checkout unchanged:

```sh
# Generate and run the actual production composition paths.
AUDIT_DIR=$(mktemp -d /tmp/beast-sound-parity.XXXXXX)
git -C "$BEAST" archive HEAD | tar -x -C "$AUDIT_DIR"
node tools/production-parity.mjs cairo > "$AUDIT_DIR/beasts/beast_contracts/src/production_parity.cairo"
printf '\n#[cfg(test)] mod production_parity;\n' >> "$AUDIT_DIR/beasts/beast_contracts/src/lib.cairo"
(cd "$AUDIT_DIR/beasts/beast_contracts" && snforge test --max-n-steps 4294967295 --max-threads 2 production_parity --include-ignored > "$AUDIT_DIR/parity.log" 2>&1)
node tools/production-parity.mjs compare "$AUDIT_DIR/parity.log"
node tools/build_production.mjs
# Rebuild tracks.json with BEAST_SONGS="$BEAST", then build the site as below.
BEAST_SONGS="$BEAST" node tools/gen_tracks.mjs
node tools/build_site.mjs
```

The comparison requires exactly all 1,611 distinct cases, byte-identical MIDI and matching Cairo settings hashes. It writes `production/parity.json`; `build_production.mjs` refuses to build a changed composer revision or adapter without a fresh successful comparison. Coverage includes every species and effects code for checks/songs/named/purchased tracks, all styles in all three families with every effects code, the Yeti, song swaps, name 1242, later editions, and zero/u64/felt boundary seeds. Regenerate the content-addressed worker/data, manifest, parity record and `index.html` together. The build retains upstream license texts in `production/NOTICE.txt`.

Run `node tools/production-smoke.mjs` with `PLAYWRIGHT_CORE` pointing to an installed Playwright package; `PLAYWRIGHT_BROWSER=webkit` runs the same checks in WebKit. This verifies browser worker output, all styles/effects, actual playback, stable comparisons, large seeds, shared links, ratings, stale requests and deployed-reference switching. The pre-existing `tools/smoke.mjs` covers the deployed pages and engine controls.

## Section 1: Beasts on Sepolia

Each real Beast is a token's exact `animation_url` page from the newest rendition set in `renditions/` (see [Sepolia rendition sets](#sepolia-rendition-sets)): the deployed TinySynth (0.12.0 for the `sepolia-2026-10-30-2` set), the Beasts renderer's card with the token's Shiny or Regular GIF as an isolated `<img>` (no `data-trusted-art`, so it runs on its own clock), the Originals Sound Manager's music, and the notes behind the art on presets 2 and 3 only. The page fetches the set from its own `renditions/<deployment>/` path when it opens (only a summary of each set is in `index.html`), rebuilds the raw `token_uri` with [`tools/rendition_set.mjs`](tools/rendition_set.mjs), checks its length and SHA-256 against the manifest, decodes `token_uri` to the metadata JSON to `animation_url` to the HTML, and loads that, byte for byte, in the same sandboxed frame as the engine tests. A token that fails the check shows an error and does not play. The check needs `crypto.subtle` (the https site or localhost) and `DecompressionStream`; without them the section says so and the engine tests still work.

The picker is the species (all 75, by name) and the variant (its Genesis Beast, or presets 0 to 3; every Beast has sound effects equal to its visual preset); the default is the Genesis Warlock, and Prev and Next step through all 375 before the engine tests. Each variant shows its facts (token ID, name, preset, shiny, notes, rainbow, tempo and block) and its own checks. With more than one set in `renditions/`, a selector offers the older ones (the newest, by block, is the default). The list's section 1 has one row per species with its rated variants.

The **Page footer** selector splices another footer fragment into a real Beast's page: **As deployed** (the default: the page untouched, with Beasts' vendored footer: onchain-midi-player `38e21a1`'s, which since [#88](https://github.com/Provable-Games/onchain-midi-player/pull/88) freezes the isolated GIF while the music is paused and since [#93](https://github.com/Provable-Games/onchain-midi-player/pull/93) retimes it to the music's beat, with Beasts' local adaptation of [beasts-v3#268](https://github.com/Provable-Games/beasts-v3/pull/268), which redraws the notes when the artwork becomes visible); and **Upstream main** (onchain-midi-player `origin/main`'s `examples/beast_consumer/fixtures/footer.html`, which is that same file without Beasts' adaptation). The build accepts a deployed footer that differs from onchain-midi-player's file at its manifest's source revision only when beasts-v3's player-page manifest declares the difference (`localAdaptation`), and names it in the footer's description. The footer is the page's last fragment, so the splice replaces exactly the deployed footer's bytes at the end of the page, and refuses unless they occur exactly once and last. The alternatives are baked into the build with their commits, from the list `FOOTER_CHOICES` in `tools/build_site.mjs`: another footer (an open PR's, say) is one more entry there and one more checkout. A saved choice that is no longer offered (the "Pause-freeze PR" option this page had until #88 merged) falls back to As deployed. A non-default footer shows a "not the deployed page" banner. With either footer, the art plays on the beat, holds still on pause and moves again on play.

**Tuning the retimed GIF.** The **Animation speed** row drives the retimed GIF on real Beasts too, when the chosen footer retimes it (the build marks a footer that does). Since beasts-v3 [#247](https://github.com/Provable-Games/beasts-v3/pull/247) the deployed footer retimes too, so the row works As deployed: at the shipped step the page is untouched, and any other step changes the deployed footer's policy (a banner then says the speed is not the shipped one). The footer times each frame with its frame-length policy, `frameUs`: an eighth note, or a quarter note above 150 BPM, the same policy as the engine tests' Synced art. At the shipped step (dashed) the footer is unchanged: upstream's file byte for byte, or as deployed the deployed one. Any other step (Ultra slow to Ultra fast: a whole, half, quarter, eighth or sixteenth note per frame) replaces that one expression in the footer's text, which in the built footer reads `i=t=>t/2<2e5?t:Math.round(t/2)`, with `i=t=>Math.round(t*q)`, `q` quarter notes per frame. The substitution must match exactly once: the build checks it, and the page re-checks it and refuses to play with a clear message otherwise. The speed is a setting of the page (shared with the engine tests, and `?speed=` sets it too); the banner says when it is not the shipped one. A GIF frame shows at least 2 cs (browsers show 0 and 1 cs as 100 ms, and the retimer never writes less than 2 cs), so a step whose frame would be under 20 ms at a Beast's tempo is turned off for that Beast, and a chosen one plays at the shipped speed instead. That cannot happen in the `sepolia-2026-10-30-2` set, whose fastest tempo (201.4 BPM) makes a sixteenth 74.5 ms. The info line shows the tempo, the frame length at the chosen step, the shipped step and its frame length, and the GIF's own frame length.

Each real Beast's result records the set, block, token ID, name, preset, the page footer it was rated with and its commit, and the speed (a step of the retimed GIF, or the GIF's own timing); the export lists them under "Beasts on Sepolia", and the engine tests keep their own summary below. Results are keyed by set and token ID, so engine-test results saved before this change still load.

## Engine tests

Track 418, "Stress test: load ramps", is for finding a phone's limits: it ramps the voice count (a heavy 8-operator filtered pad, 4 voices more each second up to 56) and then the note rate (up to 112 notes per second), then both at once, over a steady hi-hat. No voice is ever stolen, so a crackle or stutter is the device falling behind, and its time tells which load and how much. Track 419 is the same with the reverb off (the convolver's share of the load), and track 420 is a phone-sized ramp (up to 24 voices and 64 notes per second) whose ceiling should land mid-track.

The **Engine test** selector under the art of an engine test (or `?test=<mode>` in the URL, for example `?test=def02#420`) injects a small script into the NFT page, ahead of the engine, that sets the AudioContext latency hint and the sequencer lookahead, and paints a meter at the top left of the player: Chrome's audio underruns (`AudioContext.playbackStats`, Chrome 146 and later), the longest main-thread stall, and the lookahead in effect. Modes: `meter` (as shipped), `big1`, `big02`, `def1`, `def02` (large or default buffer, 1 s or 0.2 s lookahead); and, all with a 1 s lookahead, `bal1` (latency hint "balanced"), `n02_1` and `n05_1` (a hint of 0.02 s and 0.05 s), `def1k` (default hint) and `n05_1k` (0.05 s), the last two with every oscillator's detune AudioParam k-rate. The meter also shows the hint, the base latency in frames and the detune rate in effect. Off by default; with it off, the page is exactly as shipped.

Why k-rate: the engine connects its CC1 vibrato oscillator to every oscillator's detune, which makes Chrome compute each phase increment per sample (an `exp2` each). A k-rate detune computes it once per 128-frame quantum, which is cheaper, but the vibrato then moves in steps of 128 frames (2.7 ms at 48 kHz). The injected script wraps `AudioContext.createOscillator` and `createBufferSource` to set it (guarded; Firefox has no `automationRate`; a buffer source's detune is k-rate by the spec anyway). Whether the steps are audible is for [samples/k-rate/](https://provable-games.github.io/beast-sound-check/samples/k-rate/), a-rate and k-rate renders of the cases most likely to show them through the real engine, hidden behind an answer, made by `tools/k_rate_samples.mjs`.

Each engine test is the complete `animation_url` page of onchain-midi-player's reference Beast consumer ([`examples/beast_consumer`](https://github.com/Provable-Games/onchain-midi-player/tree/main/examples/beast_consumer)). The NFT owns the controls (play and pause), art sync (inline SVG seeked to the music), background audio and media-session controls. Each page is round-tripped through the spliced `token_uri` and passes the player's `validate_token_uri`.

Its art is the Beasts V3 card template as the renderer draws it (beasts-v3's renderer fixtures), with a species' genesis art; these are not real Beasts. The Beasts alternate shiny and regular, all animated (GIF), as every original is now (beasts-v3 #228 and #253, which removed the static PNG art); each also has a "Synced" variant: the GIF as a PNG sprite sheet stepped on the beat by SMIL, simulating [beasts-v3#132](https://github.com/Provable-Games/beasts-v3/issues/132). As shipped, a Synced frame lasts an eighth note, or a quarter note above 150 BPM (when an eighth would be under 0.2 s). The **Animation speed** row under the art (or `?speed=<step>` in the URL: `ultraslow`, `slow`, `medium`, `fast`, `ultrafast` or `shipped`) sets one note value per frame for every track: Ultra slow a whole note, Slow a half, Medium a quarter, Fast an eighth, Ultra fast a sixteenth. Until a step is chosen, each track follows the shipped policy (dashed), so the page is as built. The page retimes only the sprite's `<animate>` `dur` from the track's exact tempo (microseconds per quarter note), leaving the card-sync animations alone; the original GIF keeps its own clock as the baseline. The info line shows the frame length at the chosen step, the shipped step and its frame length, and the GIF's own frame length. Exported results record the art and speed each track was rated with. Every card marks its art frame `data-notes-bg`, so every track draws its own MIDI as a piano roll scrolling behind the Beast ([beasts-v3#218](https://github.com/Provable-Games/beasts-v3/pull/218), onchain-midi-player's notes fragment); production Beasts draw notes only for visual presets 2 and 3. The play button sits at the art frame's top-right corner (`data-play-anchor="235 54 24 top-right"`).

## Section 6: Original species songs

Section 6 (tracks 6.01 to 6.75, ids `601` to `675`, for example `#601`) has one track for each of the 75 original species: its **Species Song**, the track every Beast of that species plays by default (its Genesis Track), as the production composer in [midi_fun_contract](https://github.com/caseywescott/midi_fun_contract) composes it. The section's title names the pinned composer commit (`BEAST_SONGS`, the same source as `BEAST`). Section 1 plays the music of the `sepolia-2026-10-30-2` deployment, whose `BeastPureComposer` is built from midi_fun_contract `e9b0f66` (`v1.0.0`, `main` after the beast-editions merge, [PR #28](https://github.com/caseywescott/midi_fun_contract/pull/28)); section 6 is now built from the same `e9b0f66` production composer. It remains the stable effects-0 baseline; use the sampler for other effects and track types.

- **What the song is.** The Originals Sound Manager stores, for each species, `ComposerInputs::Song(get_generation_inputs({ composition_seed: 0 }, 0, { species_id: genesis_swap(id), name_variant_id: 0, tier, family }).base_song)` (beasts-v3's `deploy/records/sound-sepolia-*.json`, `sharedTracks.derivation`) and plays `BeastPureComposer.compose(inputs, sound_effects)`, which returns the MIDI and the TinySynth settings. Harpy (39) and Pegasus (40) publish each other's song (`genesis_swap`); their titles say so.
- **What a track plays.** The song as written (`sound_effects` 0: not mega, no chip echo, no drift) for the species' regular Beast: level 50, health 200, no special name, as the song composes it; its card has the species' regular genesis GIF as an isolated image, on the same reference Beast page as the engine tests (`consumerPieces`, `validate_token_uri`).
- **What it leaves out.** Monthly Track Editions (a purchase in edition 1 or later of species 1 to 75 plays the edition's style engine on the species' theme: a bought track, not the original's default), Drift (the Live mode's day, week and month changes, `compose_drift`), sound effects 1 to 3 (mega and chip echo; the Sepolia Genesis Beasts in section 1 are mega), name tracks and bought songs.
- **Where the notes and sounds come from.** The notes are lab.js's `genesisMidi(id, false)` in that checkout, which the branch holds byte-identical to its Cairo; the sounds are `synth_settings.mjs`'s settings for the song's family (the Yeti's for species 68), the settings the contract returns. `tools/species_songs_check.mjs` runs the branch's own Cairo for all 75 species (`get_generation_inputs`, then `compose_sound(.., 0)`, under snforge) and requires every MIDI to be byte-identical and every settings hash equal. At `e9b0f66` all 75 are, including the bytes embedded in the previous `5c40273` build. The branch moves, so rerun the check when you rebuild from a newer commit (its header has the commands).
- **Size.** 75 tracks with three art variants each would add about 7 MB. A track here has the original GIF page only (`lean` in `gen_tracks.mjs`; the art buttons, Card synced and the speed row are off for it), and the card's embedded font, the same 14.7 KB in every card and most of its bytes, is cut out and kept once (`cutFont`; `pageOf` puts it back by concatenation). That is +1.27 MB raw and +0.25 MB gzipped in `index.html`, for 75 tracks.

## Rebuild

The page is built from three other repos, from clean worktrees at `main` (the footer alternative comes from one more onchain-midi-player checkout, and section 6 from the same production MIDI source), plus the rendition sets in `renditions/` and the production sampler assets in `production/`:

| Variable | Repo | What the build takes from it |
| --- | --- | --- |
| `OMP` | [onchain-midi-player](https://github.com/Provable-Games/onchain-midi-player) | The engine tests: player and engine segments, the reference Beast page (`examples/beast_consumer`), page assembly and `validate_token_uri` |
| `BEAST` | [midi_fun_contract](https://github.com/caseywescott/midi_fun_contract) | Casey's beast-sound engine: the TinyChip settings and bank, and the species names, for the engine tests |
| `BEASTS3` | [beasts-v3](https://github.com/Provable-Games/beasts-v3) (private) | The engine tests' card template and the 75 genesis GIFs; the deployed page footer (`assets/player-page/footer.html`, checked against its manifest and against onchain-midi-player's file at the manifest's source revision, unless the manifest declares a `localAdaptation`) |
| `OMP_MAIN` | onchain-midi-player at `origin/main` | The "Upstream main" page footer (`examples/beast_consumer/fixtures/footer.html`) and its commit |
| `BEAST_SONGS` (optional) | [midi_fun_contract](https://github.com/caseywescott/midi_fun_contract) at the same pinned production commit as `BEAST` | Section 6: the 75 Species Songs (`genesisMidi`) and their family settings. `BEAST_SONGS_LABEL` names the branch and commit in the section title. Without `BEAST_SONGS` there is no section 6 |

`build_site.mjs` bakes in each footer's text, commit and SHA-256 and a summary of each set in `renditions/`; it does not embed the sets. `OMP` may be a different commit from `OMP_MAIN`: the engine tests follow `OMP`, the footer selector follows `OMP_MAIN`. Rebuild when it moves or a set is added. To offer an open PR's footer, add `{ key, env, label, title }` to `FOOTER_CHOICES` and a checkout of its branch in that variable.

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

   # the upstream page footer (no install needed)
   git -C /workspace/onchain-midi-player worktree add --detach /workspace/onchain-midi-player-worktrees/sound-check-footer-main origin/main

   # section 6: the same pinned production source as BEAST
   git -C /workspace/midi_fun_contract worktree add --detach /workspace/midi_fun_contract-worktrees/sound-check-songs origin/main
   (cd /workspace/midi_fun_contract-worktrees/sound-check-songs/offchain/beast-sound && npm install)
   ```

3. **Build** from this repo, on an up-to-date `main`:

   ```sh
   git switch main && git pull --ff-only
   (cd tools/deps && npm ci)
   export OMP=/workspace/onchain-midi-player-worktrees/sound-check
   export BEAST=/workspace/midi_fun_contract-worktrees/sound-check
   export BEASTS3=/workspace/beasts-v3-worktrees/sound-check
   export OMP_MAIN=/workspace/onchain-midi-player-worktrees/sound-check-footer-main
   export BEAST_SONGS=/workspace/midi_fun_contract-worktrees/sound-check-songs
   PLAYER=$(sed -n 's/^export const VERSION = "\([^"]*\)".*/\1/p' $OMP/scripts/segments.mjs)
   ENGINE=$(sed -n 's/^export const ENGINE_PIN = { ref: "\([^"]*\)".*/\1/p' $OMP/scripts/engine.mjs)
   export OMP_LABEL="origin/main $(git -C $OMP rev-parse --short HEAD) (player $PLAYER, pocket-synth $ENGINE)"
   export BEAST_LABEL="origin/main $(git -C $BEAST rev-parse --short HEAD)"
   export BEAST_SONGS_LABEL="production $(git -C $BEAST_SONGS rev-parse --short HEAD)"
   node tools/gen_tracks.mjs        # writes tools/tracks.json: expect 136 tracks (61 engine tests and 75 species songs) and "warn []"
   node tools/build_production.mjs # first refresh the Cairo parity record as described above
   node tools/build_site.mjs        # writes index.html (the engine tests, the footers and a summary of renditions/)
   ```

   `bankFail` lists client-bank presets the beast-sound engine can't map yet (three AM-modulator presets as of 2026-10). They are reported, not errors.

   If the player `VERSION` changed and you want to A/B against the outgoing page, run `mkdir -p old && cp index.html old/index.html` before building, which serves the outgoing page at `/old/`. Saved results are stored per player version, so a new version starts with a clean sheet.

   `/old/` is built with the same tools from an older player, so a change to this site's tools (the engine test, say) needs both pages rebuilt. It was last built before section 1 became the real Beasts, and nothing in it depends on them; rebuilding it with today's tools gives it the same section 1 (which plays the deployed pages, whatever `OMP` is) and needs `OMP_MAIN` too. Make a second onchain-midi-player worktree at the old commit (`8b1ff66`, player 0.7.0, pocket-synth v2.0.1), run `gen_tracks.mjs` with that as `OMP` and `OMP_LABEL="origin/main before #85 8b1ff66 (player 0.7.0, pocket-synth v2.0.1)"`, build it with `OUT=$PWD/old/index.html node tools/build_site.mjs`, then build the main page as above. Rebuilding either from unchanged sources changes only the `generated` time in its data.

4. **Smoke-test** in Chromium and WebKit at phone size. Expect every check to pass in both:

   ```sh
   BEASTS3=$BEASTS3 PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=chromium node tools/smoke.mjs
   BEASTS3=$BEASTS3 PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=webkit node tools/smoke.mjs
   ```

   It serves the site on 127.0.0.1 itself (a `file://` page cannot fetch the set, and `crypto.subtle` needs a secure context). `BEASTS3` is optional: with it, each real Beast's GIF is also checked against its canonical genesis file. `SHOTS=<dir>` saves phone-width screenshots of the picker and the footer banner, light and dark; `PLAYWRIGHT_EXECUTABLE` overrides the browser's launcher. The browsers need their system libraries; `npx playwright install-deps` installs them where you have root. The test covers:

   - real Beasts: each variant (Genesis, presets 0 to 3) loads byte-identical to the `animation_url` Node rebuilds from the set, plays, has the notes fragment only on Genesis and presets 2 and 3, and shows its Shiny or Regular GIF; the facts; a SHA-256 mismatch refuses to play; a page without `crypto.subtle` says why
   - the page footer: as deployed is the rebuilt page, its GIF holds still while paused, and the speed row drives its retimed GIF (the shipped step leaves the page untouched; Slow replaces its policy once and shows a speed banner); upstream main is spliced in byte for byte at the shipped step, shows the banner, freezes the art on pause (no change over 2 s) and animates after resume
   - the retimed GIF's speed: the GIF's frame period measured at the shipped step, Medium and Slow (the slope of its changes against the beat grid, from screenshots timed by the audible music position as in upstream's `page_check`; the median of the pairwise slopes, because headless WebKit adds misplaced changes for a GIF inside an SVG image), and the footer's policy replaced exactly once at the other steps
   - the choice, the speed and a rating persist across a reload; a saved footer that is gone falls back to As deployed; the export records set, block, token ID, name, preset, footer with its commit and speed

   - every engine-test section's tracks, with background audio and media metadata
   - play-button placement, size settings and touch target
   - sprite stepping and art drift against the music
   - the animation speed: the sprite `dur` at every step, with and without card sync, at and above 150 BPM; the card-sync animations unchanged; the shipped step by default; off for the GIF; every engine-test Beast animated (none static since beasts-v3 #253)
   - pause and resume
   - the design lab
   - no horizontal scroll at 390 px, no console errors, no requests beyond the page and its set

5. **Publish and verify:**

   ```sh
   git add -A && git commit -m "Rebuild from onchain-midi-player <sha>, midi_fun_contract <sha>" && git push
   gh api repos/Provable-Games/beast-sound-check/pages/builds/latest -q '.status + " " + .commit[0:7]'
   curl -s https://provable-games.github.io/beast-sound-check/ | grep -o '"ompCommit":"[^"]*"'
   ```

6. **Remove the worktrees** by running `git worktree remove <path>` in each repo.

## Sepolia rendition sets

`renditions/<deployment>/` holds real Beasts read from a Beasts V3 Sepolia deployment: the raw `token_uri` of one Beast for each of the 75 original species at visual effects 0, 1, 2 and 3 (sound effects equal to visual effects), plus the 75 Genesis Beasts (visual 3, sound 3 on the current deployment; the Genesis presets are the deployment's). Each set is versioned by its deployment (for example `renditions/sepolia-2026-10-30-2/`) and is never overwritten. Section 1 of the page plays them: `build_site.mjs` lists the sets it finds here (newest block first), and the page fetches the chosen one when it opens.

- `manifest.json` (`schemaVersion: 1`): the deployment; the beasts-v3 record (its path and SHA-256, the deployment's release commit, and the branch head the mint script ran from); the beasts-v3 checkout the set was read with (`beasts3BranchHead`, a branch head, not necessarily on `main`); the chain id and the block every read used; the NFT, registry, renderer, art provider and Sound Manager addresses; the TinySynth class and version; the renderer's rainbow and notes masks; and per token: token ID, species, name, identity (prefix and suffix), visual and sound effects, shiny, art (Shiny or Regular GIF), notes, rainbow, the MIDI's tempo, and the length and SHA-256 of the raw `token_uri`.
- The raw `token_uri` exactly as the NFT returned it is the ground truth, stored deduplicated. Most of it is the same across tokens (the player, gunzip, notes and bootstrap scripts, the card's style with its embedded font, each species' GIF, many MIDI files), so `fragments.json.gz` holds each shared piece once and `tokens/<token ID>.json.gz` holds one skeleton per token: the `token_uri` taken apart at its three base64 data URIs (metadata, card SVG, player page), with references to the shared pieces. [`tools/rendition_set.mjs`](tools/rendition_set.mjs) rebuilds the exact string and checks its length and SHA-256 against the manifest, failing on any difference; it runs unchanged in the browser (`DecompressionStream`, `crypto.subtle`, which needs the https site or localhost) and in Node:

  ```js
  import { openRenditionSet } from "./tools/rendition_set.mjs";
  const set = await openRenditionSet((p) => fetch(`renditions/sepolia-2026-10-30-2/${p}`).then((r) => r.arrayBuffer()));
  const uri = await set.tokenUri(set.manifest.tokens[0].tokenId);
  ```
- Each token's `tracks` is `[]` for now. A later schema version will list the tracks a token holds, one `{ editionId, trackIndex, acquisition }` per track (`manifest.trackEntryShape`), once Sound Manager editions are live on Sepolia; readers of schema 1 ignore it.
- A set is a snapshot at its block. The Originals Sound Manager's music evolves over time: between two reads 550 blocks apart on 2026-10-29, every one of the 375 `token_uri`s changed, and 335 tempos.

The `sepolia-2026-10-30-2` set is 375 tokens: 71.4 MiB of raw `token_uri`s (182–219 KB each), 41.7 MiB if each were gzipped on its own, and **1.9 MiB deduplicated**: 0.30 MiB of shared fragments (239) plus 3–7 KB per token. **Retention:** only the current deployment's set stays in the tree; the commit that adds a new set removes the previous one, and Git history keeps every set (the 2026-10-29 set, TinySynth 0.7.0, is in `renditions/sepolia-2026-10-29/` at `37bb19d`).

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

   It reads the newest `renditions-sepolia-*.json` record (or `--record <path in BEASTS3>`) and writes `renditions/<deployment>/`; it never overwrites a set unless you pass `--replace`, which rebuilds that set from scratch. It refuses to run if the record disagrees with the chain (any original species' renderer, art provider or Sound Manager, the renderer's TinySynth, or a token that is not live), and every `token_uri` must pass beasts-v3's metadata conformance checks with its exact Shiny or Regular GIF and the renderer's notes mask.

3. **Check it:**

   ```sh
   BEASTS3=/workspace/beasts-v3-worktrees/<branch> node tools/sepolia_renditions.mjs --verify renditions/<deployment>
   BEASTS3=... PLAYWRIGHT_CORE=<node_modules/playwright-core> node tools/sepolia_renditions_spot.mjs renditions/<deployment>
   ```

   The first rebuilds every `token_uri` from the stored files, checks its length and SHA-256 against the manifest and re-runs the conformance checks offline. The second, for one token per preset, rebuilds it again with the same loader inside Chromium, then opens its page: the notes fragment only on presets 2 and 3, the Shiny GIF on 1 and 3, the tempo, and a page that loads with no errors and no network requests.

4. **Rebuild `index.html`** ([Rebuild](#rebuild), step 3): the page only offers the sets it was built with, and picks the newest by block. Run the smoke test.

5. **Commit** the new set and the page, and remove the previous set.
