# Beast Sound Check

A phone-first listening test for the onchain MIDI player ([onchain-midi-player](https://github.com/Provable-Games/onchain-midi-player)): Casey Wescott's Beast compositions, every TinyChip preset and drum, and edge cases.

Open https://provable-games.github.io/beast-sound-check/ on your phone.

- **`/`**: player 0.7.0 (engine: [pocket-synth](https://github.com/Provable-Games/pocket-synth) v2.0.1). Each track is the complete `animation_url` page of onchain-midi-player's reference Beast consumer ([`examples/beast_consumer`](https://github.com/Provable-Games/onchain-midi-player/tree/main/examples/beast_consumer)). The NFT owns the controls (play and pause), art sync (inline SVG seeked to the music), background audio and media-session controls. Each page is round-tripped through the spliced `token_uri` and passes the player's `validate_token_uri`.
- **`/old/`**: the previous build (player 0.3.0, `origin/main 500da1b`), kept for A/B listening. Its results are stored separately.

The art is the Beasts V3 card with each species' genesis GIF, plus a "Synced" variant: the GIF as a PNG sprite sheet stepped on the beat by SMIL. Each card carries `data-play-anchor="235 58 24 top-right"`: the play button sits at the art frame's top-right corner, 24 card units across (proportional to the card, within the page's 16–128 px limits). That variant simulates [beasts-v3#132](https://github.com/Provable-Games/beasts-v3/issues/132); the shipped renderer still embeds the GIF.

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

   If the player `VERSION` changed and you want to A/B against the outgoing page, run `cp index.html old/index.html` before building. Saved results are stored per player version, so a new version starts with a clean sheet.

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
