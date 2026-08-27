// Four colours have to read as four colours.
//
// Small models pick a mood and give you four shades of it — an orange creature
// with orange limbs, an orange head and an orange accent, which renders as one
// undifferentiated lump whatever the shape underneath is doing. The genome is
// fine; the reading is ruined. So the palette is pushed apart until the parts
// can be told from each other, keeping whatever hue was intended.

import { Palette } from './genome';

type HSL = [number, number, number];

function toHsl(hex: string): HSL {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

function toHex([h, s, l]: HSL): string {
  s = Math.min(1, Math.max(0, s));
  l = Math.min(0.92, Math.max(0.06, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h * 6) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg < 0 ? seg + 6 : seg];
  const q = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${q(r)}${q(g)}${q(b)}`;
}

/**
 * Keeps the intent, forces the contrast. Limbs go darker than the torso, the
 * head goes lighter and warmer, and the accent is thrown across the wheel —
 * that last one is what makes a creature look designed rather than dyed.
 */
export function separate(p: Palette): Palette {
  const torso = toHsl(p.torso);
  const limbs = toHsl(p.limbs);
  const head = toHsl(p.head);
  const accent = toHsl(p.accent);

  // limbs read as the same material, one clear step down
  if (Math.abs(limbs[2] - torso[2]) < 0.1) {
    limbs[2] = torso[2] > 0.5 ? torso[2] - 0.16 : torso[2] + 0.14;
    limbs[1] = Math.min(1, torso[1] * 0.85);
  }
  // a head has to be findable at a glance
  if (Math.abs(head[2] - torso[2]) < 0.14) {
    head[2] = torso[2] > 0.45 ? torso[2] - 0.2 : torso[2] + 0.24;
  }
  // and the accent is the one that is allowed to disagree
  const hueGap = Math.min(Math.abs(accent[0] - torso[0]), 1 - Math.abs(accent[0] - torso[0]));
  if (hueGap < 0.14) {
    accent[0] = (torso[0] + 0.42) % 1;
    accent[1] = Math.max(0.5, accent[1]);
    accent[2] = Math.min(0.68, Math.max(0.4, accent[2]));
  }
  return {
    ...p,
    torso: toHex(torso), limbs: toHex(limbs), head: toHex(head), accent: toHex(accent),
  };
}
