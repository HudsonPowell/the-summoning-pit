// The weaponsmith: say "staff" and get a staff nobody drew. A local model
// composes capsule parts in grip space; clamps keep it holdable; a small
// authored armoury answers instantly when the model is missing or wrong.

import { WeaponSpec, WeaponPart } from './character';
import { OLLAMA_URL, HATCH_MODEL } from './hatch';

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
