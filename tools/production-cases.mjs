// The complete production parity matrix, shared by the generator and release guard.
export function cases() {
  const out = [], add = (sid, kind, fx, name = 0, edition = 0, seed = '1') => out.push({ sid, kind, fx, name, edition, seed });
  for (let sid = 1; sid <= 75; sid++) for (let fx = 0; fx < 4; fx++) {
    add(sid, 'check', fx); add(sid, 'species', fx);
    add(sid, 'name', fx, 1 + sid * 17 % 1242);
    add(sid, 'purchase', fx, 1 + sid * 17 % 1242, 0, String(sid * 7919));
  }
  for (let e = 1; e <= 23; e++) for (const sid of [1, 39, 68]) for (let fx = 0; fx < 4; fx++) add(sid, 'edition', fx, 0, e, '18364758544493064720');
  for (const sid of [1, 2, 3, 37, 39, 40, 68, 73, 75]) for (const seed of ['0', '1', '2', '18446744073709551615', '3618502788666131213697322783095070105623107215331596699973092056135872020480']) {
    add(sid, 'purchase', sid % 4, seed === '0' ? 0 : 1242, 0, seed);
    add(sid, 'edition', sid % 4, 1242, 47, seed);
    add(sid, 'check', sid % 4, 1242);
  }
  // Explicit approved reference paths: named Cyclops and Satori/Agony Bane bases.
  for (const fx of [0, 1, 2, 3]) {
    for (const name of [1, 1242]) add(64, 'check', fx, name);
    for (const name of [0, 1]) add(44, 'name', fx, name);
    for (const seed of ['0', '1']) add(44, 'purchase', fx, 1, 0, seed);
  }
  return out;
}
