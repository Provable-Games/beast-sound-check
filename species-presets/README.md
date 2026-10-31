# Species Song preset audition

Open `http://127.0.0.1:8791/` while the local server is running. Every original species has four as-written raw composer performances: 0 Written, 1 Mega, 2 Echo, 3 Mega + echo. Selecting a preset restarts that performance in one persistent pocket-synth 2.1.2 context. The regular card stays fixed across presets.

Music is pinned to Casey's upstream `cdcad0a4b5d6ef4f3ddb6555f3448cbb017766e1`. Names are variant 0, and the shared Harpy/Pegasus source swap is applied once. This bypasses the SoundManager's shared-Song preset policy for audition purposes only. Preset 0's technical default does not establish an artistic preference.

Serve just this directory:

```sh
python3 -m http.server 8791 --bind 127.0.0.1 --directory species-presets
```

Regenerate from a clean pinned MIDI checkout with its existing offchain dependencies:

```sh
BEAST=/path/to/pinned/midi_fun_contract node tools/build-species-presets.mjs
```

The builder validates all 300 complete SMFs and settings, distinct preset bytes, performance tempos, echo note counts and mega settings. `manifest.json` records source and content hashes. `cairo-proof.json` records 20 exact native Cairo MIDI/settings comparisons covering Warlock, Harpy, Pegasus, Satori and Yeti in all four presets. `tools/species-preset-cairo.mjs cairo` prints the temporary test module for an isolated MIDI checkout; `compare <log>` checks its capture against this dataset.

With the server running, `node tools/species-preset-browser.mjs` checks Chromium controls, actual non-silent audio, single-context switching, fixed art, mobile layout, aliases, keyboard navigation and local-only requests. This environment uses `LD_LIBRARY_PATH=/tmp/beasts-browser-runtime/root/usr/lib/x86_64-linux-gnu` for Chromium. `browser-proof.json` records the result and screenshot paths. No wallet, RPC, backend service or chain actions are involved.
