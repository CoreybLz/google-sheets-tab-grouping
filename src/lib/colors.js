// Colors that match Google Sheets' native tab color palette exactly
export const COLORS = [
  { name: 'Tomato',    hex: '#d50000' },
  { name: 'Flamingo',  hex: '#e67c73' },
  { name: 'Tangerine', hex: '#f4511e' },
  { name: 'Banana',    hex: '#f6bf26' },
  { name: 'Sage',      hex: '#33b679' },
  { name: 'Basil',     hex: '#0f9d58' },
  { name: 'Peacock',   hex: '#039be5' },
  { name: 'Blueberry', hex: '#3f51b5' },
  { name: 'Lavender',  hex: '#7986cb' },
  { name: 'Grape',     hex: '#8e24aa' },
  { name: 'Graphite',  hex: '#616161' },
];

export function nextAvailableColor(usedHexes) {
  const used = new Set(usedHexes);
  return (COLORS.find((c) => !used.has(c.hex)) ?? COLORS[0]).hex;
}

// Find the nearest color from our palette to a given Sheets RGB
export function nearestColor(sheetsRgb) {
  if (!sheetsRgb) return null;
  const r = (sheetsRgb.red   ?? 0) * 255;
  const g = (sheetsRgb.green ?? 0) * 255;
  const b = (sheetsRgb.blue  ?? 0) * 255;

  const hexToRgb = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  let best = null, bestDist = Infinity;
  for (const c of COLORS) {
    const [cr, cg, cb] = hexToRgb(c.hex);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) { bestDist = dist; best = c; }
  }

  // Ignore very faint/white-ish colors (threshold ~sqrt(55000) ≈ 235 units)
  return bestDist < 55000 ? best : null;
}
