// The weaponsmith: say "staff" and get a staff nobody drew. A local model
// composes capsule parts in grip space; clamps keep it holdable; a small
// authored armoury answers instantly when the model is missing or wrong.

import type { WeaponSpec, WeaponPart } from './character';
import { OLLAMA_URL, HATCH_MODEL } from './ollama';

const SMITH_NOTES = `
You design a held weapon for a small game character as JSON.
Grip space: the hand is at [0,0,0]; +x runs away from the hand along the
weapon (the "blade" direction, max 1.4); +y is knuckle-side (up when held
forward); +z is out to the side. Each part is a capsule:
  { "a": [x,y,z], "b": [x,y,z], "r": radius, "color": "#rrggbb" }
- 2 to 10 connected parts. A handle must pass through [0,0,0]. Every decoration must touch the handle or another part. Use one clear functional silhouette, with at most three colours. Shaft parts thin (r 0.015-0.03), heads chunky (r up to 0.09).
- A staff: long thin shaft + something at the far end. An axe: shaft + a
  broad head offset in y. A hammer: shaft + heavy symmetric head. Be
  inventive with silhouette and colour — this is the character's signature.
Respond ONLY with JSON: { "name": "...", "parts": [ ... ] }`;

const ARMOURY: Record<string, WeaponSpec> = {
  staff: {
    name: 'staff',
    parts: [
      { a: [-0.15, 0, 0], b: [0.85, 0, 0], r: 0.022, color: '#8a6d3f' },
      { a: [0.85, 0, 0], b: [0.85, 0, 0], r: 0.055, color: '#7fd4c1' },
    ],
  },
  axe: {
    name: 'axe',
    parts: [
      { a: [0, 0, 0], b: [0.5, 0, 0], r: 0.024, color: '#6b4a2f' },
      { a: [0.42, 0, 0], b: [0.47, 0.15, 0], r: 0.052, color: '#9aa1ab' },
      { a: [0.36, 0.19, 0], b: [0.56, 0.16, 0], r: 0.025, color: '#c8cdd4' },
    ],
  },
  sword: {
    name: 'sword',
    parts: [
      { a: [0.06, 0, 0], b: [0.62, 0, 0], r: 0.028, color: '#cfd6e4' },
      { a: [0.07, 0.06, 0], b: [0.07, -0.06, 0], r: 0.02, color: '#8f5540' },
    ],
  },
  hammer: {
    name: 'hammer',
    parts: [
      { a: [0, 0, 0], b: [0.45, 0, 0], r: 0.024, color: '#6b4a2f' },
      { a: [0.42, 0.08, 0], b: [0.42, -0.08, 0], r: 0.06, color: '#7a7f8a' },
    ],
  },
  spear: {
    name: 'spear',
    parts: [
      { a: [-0.2, 0, 0], b: [0.85, 0, 0], r: 0.018, color: '#a08a63' },
      { a: [0.85, 0, 0], b: [1.0, 0, 0], r: 0.03, color: '#cfd6e4' },
    ],
  },
  club: {
    name: 'club',
    parts: [
      { a: [0, 0, 0], b: [0.34, 0, 0], r: 0.03, color: '#6b4a2f' },
      { a: [0.34, 0, 0], b: [0.52, 0, 0], r: 0.06, color: '#5a4a33' },
    ],
  },
};

const clampN = (x: unknown, lo: number, hi: number, fb: number): number => {
  const v = typeof x === 'number' && isFinite(x) ? x : fb;
  return Math.min(hi, Math.max(lo, v));
};
const hexOk = (c: unknown, fb: string) =>
  typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fb;

type Point = [number, number, number];
const point = (value: unknown): value is Point => Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number' && Number.isFinite(v));
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const product = (a: Point, b: Point) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const nearest = (p: Point, a: Point, b: Point): Point => {
  const d = minus(b, a), t = Math.max(0, Math.min(1, product(minus(p, a), d) / Math.max(1e-12, product(d, d))));
  return a.map((v, i) => v + d[i] * t) as Point;
};
const distance = (a: Point, b: Point) => Math.hypot(...minus(a, b));
function partGap(a: WeaponPart, b: WeaponPart): number {
  // Alternating projection catches interior intersections as well as end caps.
  let p = nearest(a.a, b.a, b.b), q = a.a;
  for (let i = 0; i < 8; i++) { q = nearest(p, a.a, a.b); p = nearest(q, b.a, b.b); }
  return Math.min(distance(p, q), distance(a.a, nearest(a.a, b.a, b.b)),
    distance(a.b, nearest(a.b, b.a, b.b)), distance(b.a, nearest(b.a, a.a, a.b)), distance(b.b, nearest(b.b, a.a, a.b))) - a.r - b.r;
}

export function validateWeapon(raw: any, desc: string): WeaponSpec {
  const fallback = () => {
    const named = weaponsFromWords(desc);
    return structuredClone(named.main ?? named.off ?? armoury(desc));
  };
  let parts: WeaponPart[] = (Array.isArray(raw?.parts) ? raw.parts : []).slice(0, 12)
    .filter((p: any) => point(p?.a) && point(p?.b) && typeof p.r === 'number' && Number.isFinite(p.r) && p.r > 0)
    .map((p: any): WeaponPart => ({ a: [...p.a] as Point, b: [...p.b] as Point,
      r: clampN(p.r, 0.005, 0.13, 0.025), color: hexOk(p.color, '#9aa1ab') }));
  if (!parts.length) return fallback();
  // Uniform fitting preserves blades, bow arcs, strings and connected joints.
  let extent = 1;
  for (const part of parts) for (const p of [part.a, part.b])
    extent = Math.max(extent, p[0] / 1.4, -p[0] / 0.4, Math.abs(p[1]) / 0.9, Math.abs(p[2]) / 0.5);
  parts = parts.map(p => ({ ...p, a: p.a.map(v => v / extent) as Point, b: p.b.map(v => v / extent) as Point, r: p.r / extent }));
  const origin: Point = [0, 0, 0];
  const connected = new Set<number>();
  parts.forEach((p, i) => { if (distance(origin, nearest(origin, p.a, p.b)) <= p.r + 0.035) connected.add(i); });
  if (!connected.size) return fallback(); // nothing the hand can actually hold
  for (let pass = 0; pass < parts.length; pass++) {
    parts.forEach((p, i) => {
      if ([...connected].some(j => partGap(p, parts[j]) <= 0.045)) connected.add(i);
    });
  }
  // Floating fragments are not ornamentation. Keep the assembly attached to the grip.
  parts = parts.filter((_, i) => connected.has(i));
  if (!parts.length) return fallback();
  const name = typeof raw?.name === 'string' && raw.name.trim() && raw.name.length < 30 ? raw.name : desc.slice(0, 24);
  return { name, parts };
}

/** Deterministic fallback: nearest authored weapon to the words. */
export function armoury(desc: string): WeaponSpec {
  for (const [key, w] of Object.entries(ARMOURY)) if (desc.toLowerCase().includes(key)) return w;
  return ARMOURY.sword;
}

/** The smith's brief plus one worked example — for any model, any provider. */
export function smithPrompt(desc: string): string {
  return SMITH_NOTES + `\n\nExample staff:\n${JSON.stringify(ARMOURY.staff)}\n\nNow forge: "${desc}"\nJSON:`;
}

export async function forgeWeapon(
  desc: string,
  onProgress?: (chars: number) => void,
): Promise<WeaponSpec> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: HATCH_MODEL,
      stream: true,
      format: 'json',
      options: { temperature: 0.8, num_predict: 600 },
      prompt: SMITH_NOTES + `\n\nExample staff:\n${JSON.stringify(ARMOURY.staff)}\n\nNow forge: "${desc}"\nJSON:`,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { response?: string; done?: boolean };
      out += j.response ?? '';
      onProgress?.(out.length);
      if (j.done) return validateWeapon(JSON.parse(out), desc);
    }
  }
  return validateWeapon(JSON.parse(out), desc);
}

// --- the wider armoury ------------------------------------------------------
// A hero at this size is read by silhouette, and most of that silhouette is
// what they are holding. A greatsword, a scimitar and a crossbow being "a stick
// of length 0.6" is why every hatched hero looked like the same person.

const A2: Record<string, WeaponSpec> = {
  greatsword: { name: 'greatsword', parts: [
    { a: [0.05, 0, 0], b: [1.0, 0, 0], r: 0.036, color: '#cfd6e4' },
    { a: [0.08, 0.11, 0], b: [0.08, -0.11, 0], r: 0.022, color: '#8f5540' },
    { a: [-0.12, 0, 0], b: [0.04, 0, 0], r: 0.026, color: '#4a3a2c' },
  ]},
  dagger: { name: 'dagger', parts: [
    { a: [0.05, 0, 0], b: [0.3, 0, 0], r: 0.022, color: '#d7dde8' },
    { a: [0.05, 0.05, 0], b: [0.05, -0.05, 0], r: 0.016, color: '#4a3a2c' },
  ]},
  // a curve is two segments that disagree about where forward is
  scimitar: { name: 'scimitar', parts: [
    { a: [0.06, -0.02, 0], b: [0.42, 0.06, 0], r: 0.028, color: '#e2d6b0' },
    { a: [0.42, 0.06, 0], b: [0.7, 0.2, 0], r: 0.022, color: '#e8dfc4' },
    { a: [0.06, 0.06, 0], b: [0.06, -0.06, 0], r: 0.018, color: '#7a5a3a' },
  ]},
  rapier: { name: 'rapier', parts: [
    { a: [0.06, 0, 0], b: [0.92, 0, 0], r: 0.014, color: '#e4e9f2' },
    { a: [0.1, 0.05, 0.05], b: [0.1, -0.05, -0.05], r: 0.022, color: '#b9a06a' },
  ]},
  mace: { name: 'mace', parts: [
    { a: [0, 0, 0], b: [0.4, 0, 0], r: 0.024, color: '#4a3a2c' },
    { a: [0.44, 0, 0], b: [0.5, 0, 0], r: 0.075, color: '#8a8f99' },
  ]},
  maul: { name: 'maul', parts: [
    { a: [-0.1, 0, 0], b: [0.5, 0, 0], r: 0.03, color: '#5a4433' },
    { a: [0.5, 0.11, 0], b: [0.5, -0.11, 0], r: 0.075, color: '#6f747e' },
  ]},
  scythe: { name: 'scythe', parts: [
    { a: [-0.2, 0, 0], b: [0.8, 0, 0], r: 0.022, color: '#6b4a2f' },
    { a: [0.8, 0, 0], b: [0.86, 0.34, 0], r: 0.02, color: '#c9d2de' },
    { a: [0.86, 0.34, 0], b: [0.52, 0.46, 0], r: 0.016, color: '#dbe2ec' },
  ]},
  trident: { name: 'trident', parts: [
    { a: [-0.2, 0, 0], b: [0.78, 0, 0], r: 0.02, color: '#6b5a3f' },
    { a: [0.78, 0, 0], b: [1.0, 0, 0], r: 0.022, color: '#cfd6e4' },
    { a: [0.78, 0, -0.1], b: [0.78, 0, 0.1], r: 0.022, color: '#9aa1ab' },
    { a: [0.78, 0, -0.09], b: [0.96, 0, -0.11], r: 0.018, color: '#cfd6e4' },
    { a: [0.78, 0, 0.09], b: [0.96, 0, 0.11], r: 0.018, color: '#cfd6e4' },
  ]},
  wand: { name: 'wand', parts: [
    { a: [0.02, 0, 0], b: [0.3, 0, 0], r: 0.016, color: '#e6e0d0' },
    { a: [0.3, 0, 0], b: [0.3, 0, 0], r: 0.035, color: '#9fe6d2' },
  ]},
  cane: { name: 'cane', parts: [
    { a: [-0.05, 0, 0], b: [0.72, 0, 0], r: 0.018, color: '#3a2f26' },
    { a: [-0.05, 0, 0], b: [-0.05, 0.09, 0], r: 0.024, color: '#8a8f99' },
  ]},
  // Bows are held across the hand: limbs run in y, not x. Each one is drawn
  // with a STRING and a nocked arrow along +x — the old bow was a bare
  // stringless V and read as a bent stick in every fist that held it.
  bow: { name: 'bow', parts: [
    // riser, then recurve limbs: out, back, and the tips flare forward again
    { a: [0.05, -0.11, 0], b: [0.05, 0.11, 0], r: 0.026, color: '#7a5a34' },
    { a: [0.05, 0.11, 0], b: [-0.02, 0.36, 0], r: 0.018, color: '#7a5a34' },
    { a: [-0.02, 0.36, 0], b: [0.07, 0.52, 0], r: 0.012, color: '#6b4a2f' },
    { a: [0.05, -0.11, 0], b: [-0.02, -0.36, 0], r: 0.018, color: '#7a5a34' },
    { a: [-0.02, -0.36, 0], b: [0.07, -0.52, 0], r: 0.012, color: '#6b4a2f' },
    { a: [0.07, 0.52, 0], b: [0.07, -0.52, 0], r: 0.007, color: '#d8d2c4' },
    { a: [-0.08, 0, 0], b: [0.44, 0, 0], r: 0.011, color: '#8a7a5c' },
    { a: [0.44, 0, 0], b: [0.5, 0, 0], r: 0.017, color: '#aab2bd' },
  ]},
  longbow: { name: 'longbow', parts: [
    // one tall clean D-curve, taller than the arm that draws it
    { a: [0.02, -0.66, 0], b: [0.09, -0.3, 0], r: 0.015, color: '#5f4a30' },
    { a: [0.09, -0.3, 0], b: [0.11, 0, 0], r: 0.02, color: '#6b543a' },
    { a: [0.11, 0, 0], b: [0.09, 0.3, 0], r: 0.02, color: '#6b543a' },
    { a: [0.09, 0.3, 0], b: [0.02, 0.66, 0], r: 0.015, color: '#5f4a30' },
    { a: [0.02, 0.66, 0], b: [0.02, -0.66, 0], r: 0.006, color: '#e3ddcf' },
    { a: [-0.1, 0, 0], b: [0.52, 0, 0], r: 0.011, color: '#8a7a5c' },
    { a: [0.52, 0, 0], b: [0.58, 0, 0], r: 0.016, color: '#c8ccd4' },
  ]},
  shortbow: { name: 'shortbow', parts: [
    // stubby and sharply recurved, a rider's bow
    { a: [0.06, -0.08, 0], b: [0.06, 0.08, 0], r: 0.024, color: '#7d5b38' },
    { a: [0.06, 0.08, 0], b: [-0.04, 0.24, 0], r: 0.016, color: '#7d5b38' },
    { a: [-0.04, 0.24, 0], b: [0.09, 0.34, 0], r: 0.011, color: '#8f6f45' },
    { a: [0.06, -0.08, 0], b: [-0.04, -0.24, 0], r: 0.016, color: '#7d5b38' },
    { a: [-0.04, -0.24, 0], b: [0.09, -0.34, 0], r: 0.011, color: '#8f6f45' },
    { a: [0.09, 0.34, 0], b: [0.09, -0.34, 0], r: 0.006, color: '#d8d2c4' },
    { a: [-0.06, 0, 0], b: [0.36, 0, 0], r: 0.01, color: '#8a7a5c' },
  ]},
  greatbow: { name: 'greatbow', parts: [
    // a siege limb of dark wood and iron, arrow like a fence post
    { a: [0.05, -0.15, 0], b: [0.05, 0.15, 0], r: 0.034, color: '#3f3226' },
    { a: [0.05, 0.15, 0], b: [-0.05, 0.5, 0], r: 0.024, color: '#4a3b2c' },
    { a: [-0.05, 0.5, 0], b: [0.08, 0.7, 0], r: 0.016, color: '#8f949c' },
    { a: [0.05, -0.15, 0], b: [-0.05, -0.5, 0], r: 0.024, color: '#4a3b2c' },
    { a: [-0.05, -0.5, 0], b: [0.08, -0.7, 0], r: 0.016, color: '#8f949c' },
    { a: [0.08, 0.7, 0], b: [0.08, -0.7, 0], r: 0.008, color: '#b8b2a4' },
    { a: [-0.12, 0, 0], b: [0.56, 0, 0], r: 0.016, color: '#6e5f48' },
    { a: [0.56, 0, 0], b: [0.64, 0, 0], r: 0.024, color: '#9aa1ab' },
  ]},
  crossbow: { name: 'crossbow', parts: [
    { a: [-0.12, 0, 0], b: [0.5, 0, 0], r: 0.026, color: '#5a4433' },
    { a: [0.34, 0, -0.3], b: [0.34, 0, 0.3], r: 0.017, color: '#4a3a2c' },
    { a: [0.34, 0.06, 0], b: [0.5, 0.06, 0], r: 0.014, color: '#9aa1ab' },
  ]},
};

const A3: Record<string, WeaponSpec> = {
  katana: { name: 'katana', parts: [
    { a: [0.05, 0, 0], b: [0.5, 0.04, 0], r: 0.02, color: '#dfe6ef' },
    { a: [0.5, 0.04, 0], b: [0.86, 0.12, 0], r: 0.016, color: '#eef2f8' },
    { a: [0.04, 0.04, 0.04], b: [0.04, -0.04, -0.04], r: 0.02, color: '#3a3a40' },
  ]},
  greataxe: { name: 'greataxe', parts: [
    { a: [-0.12, 0, 0], b: [0.72, 0, 0], r: 0.026, color: '#5a4433' },
    { a: [0.62, 0.13, 0], b: [0.68, -0.11, 0], r: 0.06, color: '#8a8f99' },
    { a: [0.62, 0.13, 0.001], b: [0.68, -0.11, -0.001], r: 0.055, color: '#a7adb8' },
  ]},
  warpick: { name: 'warpick', parts: [
    { a: [0, 0, 0], b: [0.46, 0, 0], r: 0.024, color: '#4a3a2c' },
    { a: [0.46, 0.02, 0], b: [0.6, 0.14, 0], r: 0.028, color: '#9aa1ab' },
    { a: [0.46, 0.02, 0], b: [0.38, 0.12, 0], r: 0.02, color: '#7a7f8a' },
  ]},
  javelin: { name: 'javelin', parts: [
    { a: [-0.3, 0, 0], b: [0.7, 0, 0], r: 0.014, color: '#a08a63' },
    { a: [0.7, 0, 0], b: [0.85, 0, 0], r: 0.024, color: '#cfd6e4' },
  ]},
  tome: { name: 'tome', parts: [
    { a: [0.08, 0.05, 0], b: [0.08, -0.05, 0], r: 0.075, color: '#6b3a2f' },
    { a: [0.12, 0.05, 0], b: [0.12, -0.05, 0], r: 0.065, color: '#e6dcc4' },
  ]},
  orb: { name: 'orb', parts: [
    { a: [0.02, 0, 0], b: [0.14, 0, 0], r: 0.02, color: '#4a4550' },
    { a: [0.2, 0, 0], b: [0.2, 0, 0], r: 0.07, color: '#8fd6ff' },
  ]},
  cleaver: { name: 'cleaver', parts: [
    { a: [0, 0, 0], b: [0.2, 0, 0], r: 0.022, color: '#4a3a2c' },
    { a: [0.2, 0.07, 0], b: [0.52, 0.09, 0], r: 0.055, color: '#adb3bd' },
  ]},
  whip: { name: 'whip', parts: [
    { a: [0, 0, 0], b: [0.14, 0, 0], r: 0.024, color: '#4a3826' },
    { a: [0.14, 0, 0], b: [0.5, -0.08, 0.06], r: 0.016, color: '#5a4732' },
    { a: [0.5, -0.08, 0.06], b: [0.82, -0.2, 0.14], r: 0.011, color: '#6a5137' },
  ]},
  flail: { name: 'flail', parts: [
    { a: [0, 0, 0], b: [0.32, 0, 0], r: 0.024, color: '#4a3a2c' },
    { a: [0.32, 0, 0], b: [0.5, -0.06, 0], r: 0.012, color: '#5a5f66' },      // the chain
    { a: [0.56, -0.09, 0], b: [0.56, -0.09, 0], r: 0.065, color: '#7a7f8a' }, // the ball
    { a: [0.61, -0.05, 0], b: [0.61, -0.13, 0], r: 0.018, color: '#9aa1ab' }, // a spike
  ]},
};

/** Held in the off hand. A shield is most of a knight. */
const OFFHAND: Record<string, WeaponSpec> = {
  shield: { name: 'shield', parts: [
    { a: [0.04, -0.26, 0], b: [0.04, 0.26, 0], r: 0.1, color: '#6b7280' },
    { a: [0.04, 0, -0.2], b: [0.04, 0, 0.2], r: 0.1, color: '#6b7280' },
    { a: [0.09, 0, 0], b: [0.09, 0, 0], r: 0.06, color: '#b9a06a' },
  ]},
  buckler: { name: 'buckler', parts: [
    { a: [0.04, -0.12, 0], b: [0.04, 0.12, 0], r: 0.075, color: '#7a818c' },
    { a: [0.08, 0, 0], b: [0.08, 0, 0], r: 0.045, color: '#c2ab74' },
  ]},
  torch: { name: 'torch', parts: [
    { a: [0, 0, 0], b: [0.34, 0, 0], r: 0.02, color: '#4a3a2c' },
    { a: [0.36, 0, 0], b: [0.44, 0, 0], r: 0.055, color: '#ffb257' },
  ]},
};

/**
 * Longest match wins, so "greatsword" never resolves to "sword" and
 * "crossbow" never resolves to "bow". Returns what each hand holds.
 */
export function weaponsFromWords(desc: string): { main?: WeaponSpec; off?: WeaponSpec } {
  const d = desc.toLowerCase();
  const SYNONYM: [RegExp, WeaponSpec][] = [
    // longest, most specific match first — "greataxe" must never fall
    // through to "axe", or the stated weapon and the drawn one disagree
    [/greataxe|great axe|battleaxe|battle axe|double[- ]headed axe/, A3.greataxe],
    [/greatsword|claymore|zweihander|great sword/, A2.greatsword],
    [/katana|nodachi|tachi|samurai sword/, A3.katana],
    [/warpick|war pick|pick(axe)? of war|military pick/, A3.warpick],
    [/javelin|throwing spear/, A3.javelin],
    [/\btome\b|grimoire|spellbook|book of/, A3.tome],
    [/\borb\b|crystal ball|sphere of/, A3.orb],
    [/cleaver|butcher/, A3.cleaver],
    [/crossbow|arbalest/, A2.crossbow],
    [/longbow|warbow/, A2.longbow],
    [/shortbow|horsebow/, A2.shortbow],
    [/greatbow|siege bow/, A2.greatbow],
    [/\bbow\b|archer/, A2.bow],
    [/scimitar|cutlass|sabre|saber|falchion/, A2.scimitar],
    [/rapier|estoc|foil\b/, A2.rapier],
    [/dagger|knive|knife|dirk|shiv|stiletto/, A2.dagger],
    [/scythe|sickle/, A2.scythe],
    [/trident|glaive|halberd|polearm/, A2.trident],
    [/warhammer|war hammer|maul|sledge/, A2.maul],
    [/\bflail\b|ball and chain/, A3.flail],
    [/\bwhip\b|lash\b|scourge/, A3.whip],
    [/\bmace\b|morningstar/, A2.mace],
    [/\bwand\b|rod\b|sceptre|scepter/, A2.wand],
    [/staff|stave|quarterstaff/, ARMOURY.staff],
    [/\bcane\b|walking stick|\bcrook\b/, A2.cane],
    [/\bhammer\b/, ARMOURY.hammer],
    [/\bsword|blade|longsword|shortsword/, ARMOURY.sword],
    [/\baxe|hatchet/, ARMOURY.axe],
    [/spear|pike|lance/, ARMOURY.spear],
    [/\bclub\b|cudgel|bludgeon/, ARMOURY.club],
  ];
  let main: WeaponSpec | undefined;
  for (const [re, w] of SYNONYM) if (re.test(d)) { main = w; break; }

  let off: WeaponSpec | undefined;
  if (/\bshield\b|shielded|shieldmaiden|slab shield/.test(d)) off = OFFHAND.shield;
  else if (/buckler/.test(d)) off = OFFHAND.buckler;
  else if (/torch|lantern/.test(d)) off = OFFHAND.torch;
  // twin ANYTHING: the off hand gets the same thing back. "two swords" was
  // silently one sword; "two shields" was not even a sentence the smith heard.
  if (!off && main && /\b(twin|dual|paired|pair of|two|double)\b.{0,24}(sword|blade|dagger|kni[fv]e|axe|hatchet|hammer|club|mace|whip|torch)/.test(d)) {
    off = main;
  }
  // two shields: a wall that walks. If a weapon was also named, one hand
  // keeps it — nobody has three hands, and the words asked for a lot.
  if (/\b(twin|dual|paired|pair of|two|double)\b.{0,20}shields/.test(d)) {
    if (!main) main = OFFHAND.shield;
    off = OFFHAND.shield;
  }

  // What the words SAY about each held thing, applied to what is held.
  // "a big shield" is bigger; "a flaming sword" burns; "a tiny frozen dagger"
  // is both. Modifiers only reach the thing they stand near.
  const dress = (spec: WeaponSpec | undefined, triggers: RegExp): WeaponSpec | undefined =>
    spec ? dressWeapon(spec, d, triggers) : spec;

  const WEAPON_WORD = /sword|blade|axe|hammer|maul|mace|club|dagger|kni[fv]e|spear|pike|lance|javelin|trident|glaive|halberd|scythe|whip|flail|staff|stave|wand|orb|tome|bow|crossbow|cleaver|katana|scimitar|rapier|pick/;
  main = dress(main, WEAPON_WORD);
  off = dress(off, /shield|buckler|torch|lantern/) ?? (off ? dress(off, WEAPON_WORD) : off);

  return { main, off };
}

/**
 * Apply the words' modifiers to a held thing, wherever it came from — the
 * armoury or the model's own hand. Size words scale it, element words blend
 * the steel and hang a glow off the far end. Modifiers only count when they
 * stand within a few words of the thing they describe.
 */
export function dressWeapon(spec: WeaponSpec, desc: string, triggers?: RegExp): WeaponSpec {
  const d = desc.toLowerCase();
  const re = triggers ?? /sword|blade|axe|hammer|maul|mace|club|dagger|kni[fv]e|spear|pike|lance|javelin|trident|glaive|halberd|scythe|whip|flail|staff|stave|wand|orb|tome|bow|crossbow|cleaver|katana|scimitar|rapier|pick|shield|buckler|torch|nunchuck|nunchak|chain|net\b/;
  const m = d.match(re);
  if (!m || m.index === undefined) return spec;
  const before = d.slice(Math.max(0, m.index - 40), m.index);
  let scale = 1;
  if (/\b(huge|massive|giant|colossal|enormous|great|big|tower|oversized)\b/.test(before)) scale = 1.4;
  else if (/\b(small|tiny|little|short)\b/.test(before)) scale = 0.75;
  const element =
    /\b(flaming|burning|fiery|fire|blazing)\b/.test(before) ? '#ff8a3a'
    : /\b(frost|frozen|icy|ice)\b/.test(before) ? '#bfe6ff'
    : /\b(venom|poison(ous)?|toxic)\b/.test(before) ? '#9fe07a'
    : /\b(lightning|storm|charged|crackling)\b/.test(before) ? '#f2f0b0'
    : /\b(shadow|void|black-flame|cursed)\b/.test(before) ? '#8a6fb8'
    : /\b(holy|blessed|radiant|golden)\b/.test(before) ? '#ffd88a'
    : null;
  if (scale === 1 && !element) return spec;
  const parts = spec.parts.map(part => ({
    a: [part.a[0] * scale, part.a[1] * scale, part.a[2] * scale] as [number, number, number],
    b: [part.b[0] * scale, part.b[1] * scale, part.b[2] * scale] as [number, number, number],
    r: part.r * scale,
    color: element ? blendHex(part.color, element, 0.55) : part.color,
  }));
  if (element) {
    const tip = parts.reduce((m2, q) => Math.max(m2, q.b[0], q.a[0]), 0);
    parts.push({
      a: [tip * 0.55, 0, 0] as [number, number, number],
      b: [tip * 0.95, 0, 0] as [number, number, number],
      r: Math.min(0.11, 0.05 * scale + 0.03), color: element,
    });
  }
  return { ...spec, parts };
}

/**
 * The fairness budget for held things: total capsule volume is capped, so the
 * model may invent ANY shape but never a mountain. Oversized designs keep
 * their silhouette and lose thickness.
 */
export function priceWeapon(spec: WeaponSpec): WeaponSpec {
  const BUDGET = 0.012;
  const vol = spec.parts.reduce((v, q) => {
    const len = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]) + q.r;
    return v + len * q.r * q.r;
  }, 0);
  if (vol <= BUDGET) return spec;
  const k = Math.cbrt(BUDGET / vol);
  return { ...spec, parts: spec.parts.map(q => ({ ...q, a: q.a.map(v => v * k) as Point, b: q.b.map(v => v * k) as Point, r: q.r * k })) };
}

/** Mix two #rrggbb colours; t=1 is all the second. */
function blendHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 255, vb = (pb >> sh) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
