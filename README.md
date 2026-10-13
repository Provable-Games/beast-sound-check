# Beast Sound Check

A phone-first listening test for the onchain MIDI player ([onchain-midi-player](https://github.com/Provable-Games/onchain-midi-player)): Casey Wescott's Beast compositions, every TinyChip preset and drum, and edge cases.

Open https://provable-games.github.io/beast-sound-check/ on your phone.

- **`/`**: player 0.7.0 (engine: [pocket-synth](https://github.com/Provable-Games/pocket-synth) v2.0.1). Each track is the complete `animation_url` page of onchain-midi-player's reference Beast consumer ([`examples/beast_consumer`](https://github.com/Provable-Games/onchain-midi-player/tree/main/examples/beast_consumer)). The NFT owns the controls (play and pause), art sync (inline SVG seeked to the music), background audio and media-session controls. Each page is round-tripped through the spliced `token_uri` and passes the player's `validate_token_uri`.
- **`/old/`**: the previous build (player 0.3.0, `origin/main 500da1b`), kept for A/B listening. Its results are stored separately.

The art is the Beasts V3 card with each species' genesis GIF, plus a "Synced" variant: the GIF as a PNG sprite sheet stepped on the beat by SMIL. Each card carries `data-play-anchor="235 58 24 top-right"`: the play button sits at the art frame's top-right corner, 24 card units across (proportional to the card, within the page's 16–128 px limits). That variant simulates [beasts-v3#132](https://github.com/Provable-Games/beasts-v3/issues/132); the shipped renderer still embeds the GIF.

## Rebuild

`tools/` holds the generator. You need three checkouts, ideally as worktrees:

- **onchain-midi-player** at the player under test, with `npm ci`.
- **midi_fun_contract** for the music, with `npm install` in `offchain/beast-sound`.
- **beasts-v3** for the card template and genesis GIFs.

```sh
(cd tools/deps && npm ci)
OMP=<onchain-midi-player> BEAST=<midi_fun_contract> BEASTS3=<beasts-v3> \
  OMP_LABEL="origin/main <sha> (player <ver>, pocket-synth <ver>)" BEAST_LABEL="origin/main <sha>" \
  node tools/gen_tracks.mjs        # writes tools/tracks.json
node tools/build_site.mjs          # writes index.html
PLAYWRIGHT_CORE=<node_modules/playwright-core> PLAYWRIGHT_BROWSER=chromium|webkit node tools/smoke.mjs
```

The smoke test drives the page at phone size and covers:

- every section's tracks
- background audio and media metadata
- play-button placement
- sprite stepping
- art drift against the music
- pause and resume

Saved results are kept per player version, so a new version starts with a clean sheet.
