# Beast Sound Check

A phone-first listening test for the onchain MIDI player ([onchain-midi-player](https://github.com/Provable-Games/onchain-midi-player)): Casey Wescott's Beast compositions, every TinyChip preset and drum, and edge cases.

Open https://provable-games.github.io/beast-sound-check/ on your phone.

It runs player 0.8.0 (engine: [pocket-synth](https://github.com/Provable-Games/pocket-synth) v2.1.0, which asks phones and tablets for a larger audio buffer and a 1 s lookahead). For an A/B on the same device, https://provable-games.github.io/beast-sound-check/old/ is the same build from onchain-midi-player `8b1ff66`, just before the re-pin (player 0.7.0, engine v2.0.1), so the two differ only in the engine.

Track 418, "Stress test: load ramps", is for finding a phone's limits: it ramps the voice count (a heavy 8-operator filtered pad, 4 voices more each second up to 56) and then the note rate (up to 112 notes per second), then both at once, over a steady hi-hat. No voice is ever stolen, so a crackle or stutter is the device falling behind, and its time tells which load and how much. Track 419 is the same with the reverb off (the convolver's share of the load), and track 420 is a phone-sized ramp (up to 24 voices and 64 notes per second) whose ceiling should land mid-track.

The **Engine test** selector under the art (or `?test=<mode>` in the URL, for example `?test=def02#420`) injects a small script into the NFT page, ahead of the engine, that sets the AudioContext latency hint and the sequencer lookahead, and paints a meter at the top left of the player: Chrome's audio underruns (`AudioContext.playbackStats`, Chrome 146 and later), the longest main-thread stall, and the lookahead in effect. Modes: `meter` (as shipped), `big1`, `big02`, `def1`, `def02` (large or default buffer, 1 s or 0.2 s lookahead). Off by default; with it off, the page is exactly as shipped. Each track is the complete `animation_url` page of onchain-midi-player's reference Beast consumer ([`examples/beast_consumer`](https://github.com/Provable-Games/onchain-midi-player/tree/main/examples/beast_consumer)). The NFT owns the controls (play and pause), art sync (inline SVG seeked to the music), background audio and media-session controls. Each page is round-tripped through the spliced `token_uri` and passes the player's `validate_token_uri`.

The art is the Beasts V3 card as the renderer draws it today (beasts-v3's renderer fixtures), with each species' genesis art. The Beasts rotate through shiny and regular, animated (GIF) and static (PNG); animated ones also have a "Synced" variant: the GIF as a PNG sprite sheet stepped on the beat by SMIL, simulating [beasts-v3#132](https://github.com/Provable-Games/beasts-v3/issues/132). Every card marks its art frame `data-notes-bg`, so every track draws its own MIDI as a piano roll scrolling behind the Beast ([beasts-v3#218](https://github.com/Provable-Games/beasts-v3/pull/218), onchain-midi-player's notes fragment); production Beasts draw notes only for visual presets 2 and 3. The play button sits at the art frame's top-right corner (`data-play-anchor="235 54 24 top-right"`).

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
   node tools/gen_tracks.mjs        # writes tools/tracks.json: expect 74 tracks and "warn []"
   node tools/build_site.mjs        # writes index.html
   ```

   `bankFail` lists client-bank presets the beast-sound engine can't map yet (three AM-modulator presets as of 2026-10). They are reported, not errors.

   If the player `VERSION` changed and you want to A/B against the outgoing page, run `mkdir -p old && cp index.html old/index.html` before building, which serves the outgoing page at `/old/`. Saved results are stored per player version, so a new version starts with a clean sheet.

4. **Smoke-test** in Chromium and WebKit at phone size. Expect every check to pass in both:

   ```sh
   PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=chromium node tools/smoke.mjs
   PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=webkit node tools/smoke.mjs
   ```

   The browsers need their system libraries; `npx playwright install-deps` installs them where you have root. The test covers:

   - every section's tracks, with background audio and media metadata
   - play-button placement, size settings and touch target
   - sprite stepping and art drift against the music
   - pause and resume
   - the design lab

5. **Publish and verify:**

   ```sh
   git add -A && git commit -m "Rebuild from onchain-midi-player <sha>, midi_fun_contract <sha>" && git push
   gh api repos/Provable-Games/beast-sound-check/pages/builds/latest -q '.status + " " + .commit[0:7]'
   curl -s https://provable-games.github.io/beast-sound-check/ | grep -o '"ompCommit":"[^"]*"'
   ```

6. **Remove the worktrees** by running `git worktree remove <path>` in each repo.
