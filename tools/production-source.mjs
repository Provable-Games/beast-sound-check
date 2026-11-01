import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { productionSource as sharedSource } from './launch-check-reference/production-source.mjs';
export { sha256 } from './launch-check-reference/production-source.mjs';

const musicPaths = ['beasts/beast_composer', 'beasts/beast_contracts', 'core', 'offchain/beast-sound/src', 'offchain/beast-sound/onchain/tinychip', 'Scarb.toml', 'Scarb.lock'];
// An explicit lab source pin: this does not retarget a deployed Manager or historical rendition.
export function assertCanonicalMusic(root) {
  const pin = JSON.parse(fs.readFileSync(new URL('./current-music.json', import.meta.url), 'utf8'));
  const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (revision !== pin.revision) throw new Error(`Current lab music must use approved ${pin.revision}, got ${revision}`);
  if (execFileSync('git', ['-C', root, 'status', '--porcelain', '--', ...musicPaths], { encoding: 'utf8' }).trim()) throw new Error('Current preview music checkout has local changes');
  return pin;
}
export async function productionSource() {
  const root = process.env.BEAST || '/workspace/midi_fun_contract';
  assertCanonicalMusic(root);
  return sharedSource();
}
