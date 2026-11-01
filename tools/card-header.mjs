// Port of beasts-v3/packages/erc721/src/beast_svg.cairo's ASCII name/rank header.
// Keep its fixed-point rounding, VT323 fitting and final-digit ink alignment.
const esc = s => String(s).replace(/[&<>']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;' }[c]));
const coordinate = value => {
  const milli = Math.floor((value + 64) / 128), fraction = milli % 1000;
  return Math.floor(milli / 1000) + (fraction ? '.' + String(fraction).padStart(3, '0').replace(/0+$/, '') : '');
};
const rightBearing = digit => ({ 0: 135, 1: 155, 2: 114, 3: 114, 4: 74, 5: 74, 6: 104, 7: 114, 8: 135, 9: 104 })[digit];
function fittedSize(text, base, rank) {
  if (!text.length) return base;
  const rankWidth = rank ? Math.max(88 * String(rank).length, 261) : 0;
  const halfWidth = Math.min(2350 - rankWidth - 80 - 1255, 891);
  return Math.min(base, Math.floor((2 * halfWidth - 10 * text.length) / (4 * text.length)));
}
export function cardHeader({ name, prefix = '', suffix = '', rank = 0 }) {
  let header = '';
  if (rank) {
    const digits = String(rank), x = coordinate(30080000 + rightBearing(digits.at(-1)) * 1375);
    const color = ['#ffffff', '#e6c56e', '#c0c0c0', '#cd7f32'][rank] || '#ffffff';
    header += `<text x='236.078' y='23.96' text-anchor='end' class='label' style='font-size:16px'>RANK</text><text x='${x}' y='46' text-anchor='end' style='fill:${color};font-size:22px'>${rank}</text>`;
  }
  const named = !!(prefix || suffix);
  if (named) {
    const affix = '"' + [prefix, suffix].filter(Boolean).join(' ') + '"';
    const size = fittedSize(affix, 14, rank), y = coordinate((1500 + 56 * size) * 1280);
    header += `<text x='125.5' y='${y}' text-anchor='middle' style='fill:#fff;font-size:${size}px;letter-spacing:1px'>${esc(affix)}</text>`;
  }
  return header + `<text x='125.5' y='46' text-anchor='middle' style='fill:#fff;font-size:${fittedSize(name, named ? 30 : 34, rank)}px;letter-spacing:1px'>${esc(name)}</text>`;
}

// The header is contiguous in both canonical fixture templates and rebuilt cards.
export function withCardHeader(svg, fields) {
  const re = /(?:<text x='[0-9.]+' y='23\.96'[^>]*>RANK<\/text><text x='[0-9.]+' y='46'[^>]*>[0-9]+<\/text>)?(?:<text x='125\.5' y='[0-9.]+'[^>]*>[^<]*<\/text>){1,2}/g;
  let count = 0;
  const result = svg.replace(re, () => { count++; return cardHeader(fields); });
  if (count !== 1) throw new Error('Expected one card header, found ' + count);
  return result;
}

// A permutation modulo 1242 (757 is coprime to it): repeatable illustrative ranks,
// unique for all 75 species and independent of every audio input and shared URL.
export const previewRank = speciesId => ((speciesId - 1) * 757 + 613) % 1242 + 1;
