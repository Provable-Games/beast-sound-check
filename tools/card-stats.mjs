// Port of beasts-v3 beast_svg.cairo append_large_panel: center the combined
// VT323 digit ink + 4px gap + icon, using its 128000 units/px and .001px rounding.
const coordinate = value => {
  const milli = Math.floor((value + 64) / 128);
  return String(milli / 1000);
};
const leftBearing = [135,156,115,115,74,115,104,115,135,104];
const rightBearing = [135,155,114,114,74,74,104,114,135,104];
export function largePanel(value, health = false) {
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Expected u16 card stat');
  const text = String(value), left = leftBearing[text[0]] * 1500, right = rightBearing[text.at(-1)] * 1500;
  const inkWidth = 1228800 * text.length - left - right, iconWidth = health ? 2007936 : 752640;
  const start = Math.floor((13568000 - iconWidth - 512000 - inkWidth) / 2);
  const textX = coordinate(start + iconWidth + 512000 - left);
  const iconX = coordinate(start - (health ? 239040 : 107520));
  return `<g transform='translate(${health ? 129 : 15} 280)'><rect width='106' height='55' rx='5' fill='url(#panel)'/><text x='53.25' y='19.7' text-anchor='middle' class='label'>${health ? 'HEALTH' : 'POWER'}</text><text x='${textX}' y='43.14' text-anchor='start' class='valL' style='font-size:24px'>${text}</text><g transform='translate(${iconX},${health ? '25.962' : '28.86'}) scale(${health ? '0.747' : '0.84'})'><use href='#${health ? 'heart' : 'bolt'}' pointer-events='none'/></g></g>`;
}
export function withCardStats(svg, { power, health }) {
  for (const [value, isHealth] of [[power, false], [health, true]]) {
    const re = new RegExp(`<g transform='translate\\(${isHealth ? 129 : 15} 280\\)'>[\\s\\S]*?<use href='#${isHealth ? 'heart' : 'bolt'}'[^>]*\\/><\\/g><\\/g>`, 'g');
    let count = 0;
    svg = svg.replace(re, () => { count++; return largePanel(value, isHealth); });
    if (count !== 1) throw new Error('Expected one ' + (isHealth ? 'health' : 'power') + ' panel, found ' + count);
  }
  return svg;
}
