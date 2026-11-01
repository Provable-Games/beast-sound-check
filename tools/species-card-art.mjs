// Current listening cards are generated independently of the immutable Song archive.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { card, speciesArt } from './art.mjs';
export function speciesCardArt(species) {
  return Object.fromEntries(species.map(({ id, name }) => {
    const tier = Math.floor((id - 1) % 25 / 5) + 1, beast_type = Math.floor((id - 1) / 25);
    const svg = card({ beast: { id, tier, beast_type, level: 50, health: 200, rank: 0, prefix: 0, suffix: 0, shiny: 0 },
      art: speciesArt(id, false), tempoUs: 500000, mode: 'gif', strings: { name, type: ['Magic', 'Hunter', 'Brute'][beast_type] } });
    return [id, 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')];
  }));
}

export function speciesCardArtSource() {
  return { generator: 'tools/species-card-art.mjs', preset: 0,
    renderer: 'beasts-v3/packages/erc721/src/beast_svg.cairo',
    rendererSha256: createHash('sha256').update(fs.readFileSync((process.env.BEASTS3 || '/workspace/beasts-v3') + '/packages/erc721/src/beast_svg.cairo')).digest('hex'),
    scope: 'Current pristine regular cards; canonical unnamed headers and per-value stat layout. Historical art remains in the original Song archive.' };
}
