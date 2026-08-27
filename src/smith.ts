// The weaponsmith: say "staff" and get a staff nobody drew. A local model
// composes capsule parts in grip space; clamps keep it holdable; a small
// authored armoury answers instantly when the model is missing or wrong.

import { WeaponSpec, WeaponPart } from './character';
import { OLLAMA_URL, HATCH_MODEL } from './ollama';

const SMITH_NOTES = `
You design a held weapon for a small game character as JSON.
Grip space: the hand is at [0,0,0]; +x runs away from the hand along the
weapon (the "blade" direction, max 1.1); +y is knuckle-side (up when held
forward); +z is out to the side. Each part is a capsule:
  { "a": [x,y,z], "b": [x,y,z], "r": radius, "color": "#rrggbb" }
- 2 to 6 parts. Shaft parts thin (r 0.015-0.03), heads chunky (r up to 0.09).
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
      { a: [0.42, 0.09, 0], b: [0.46, -0.07, 0], r: 0.05, color: '#9aa1ab' },
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

export function validateWeapon(raw: any, desc: string): WeaponSpec {
  const parts: WeaponPart[] = (Array.isArray(raw?.parts) ? raw.parts : [])
    .slice(0, 6)
    .map((p: any): WeaponPart => ({
      a: [clampN(p?.a?.[0], -0.3, 1.1, 0), clampN(p?.a?.[1], -0.25, 0.25, 0), clampN(p?.a?.[2], -0.25, 0.25, 0)],
      b: [clampN(p?.b?.[0], -0.3, 1.1, 0.4), clampN(p?.b?.[1], -0.25, 0.25, 0), clampN(p?.b?.[2], -0.25, 0.25, 0)],
      r: clampN(p?.r, 0.012, 0.09, 0.025),
      color: hexOk(p?.color, '#9aa1ab'),
    }));
  if (parts.length < 1) return armoury(desc);
  const name =
    typeof raw?.name === 'string' && raw.name.length < 30 && raw.name.length > 0
      ? raw.name
      : desc.slice(0, 24);
  return { name, parts };
}

/** Deterministic fallback: nearest authored weapon to the words. */
export function armoury(desc: string): WeaponSpec {
  for (const [key, w] of Object.entries(ARMOURY)) if (desc.toLowerCase().includes(key)) return w;
  return ARMOURY.sword;
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
  // the bow is held across the hand: its limbs run in y, not x
  bow: { name: 'bow', parts: [
    { a: [0.06, 0, 0], b: [0.1, 0.34, 0], r: 0.018, color: '#7a5a34' },
    { a: [0.06, 0, 0], b: [0.1, -0.34, 0], r: 0.018, color: '#7a5a34' },
    { a: [0.1, 0.34, 0], b: [0.02, 0.46, 0], r: 0.014, color: '#6b4a2f' },
    { a: [0.1, -0.34, 0], b: [0.02, -0.46, 0], r: 0.014, color: '#6b4a2f' },
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
    [/longbow|shortbow|\bbow\b|archer/, A2.bow],
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
  // twin blades: the off hand gets the same weapon back
  if (!off && main && /twin|dual|two (daggers|blades|swords)|paired/.test(d)) off = main;
  return { main, off };
}
