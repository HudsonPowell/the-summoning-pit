// Scenery, built the way creatures are built: points and radii, no meshes and
// no sprites, so it goes through the same capsule field and blobs into itself
// exactly like a body does. A rock is a short chain of fat spheres; a fern is
// several thin chains bent outward; a crystal is a taper.
//
// Everything is grown from a seed, so the pit's scenery is a NUMBER — which
// means it costs nothing to send and comes back identical after a restart.

import { Capsule } from './pose';
import { V3, v3 } from './vec';

export type PropKind = 'rock' | 'boulder' | 'fern' | 'fungus' | 'shard' | 'bones' | 'stump'
  | 'roots' | 'eggs' | 'sprout' | 'tuft' | 'bloom';

/** Small deterministic generator — same seed, same rock, forever. */
function rng(seed: number) {
  // Scramble first. A plain LCG fed consecutive seeds returns nearly the same
  // first value each time — which is why three crystals in a row came out the
  // same colour: the colour is the first thing drawn from the stream.
  let s = (seed | 0) || 1;
  s = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) | 0;
  s ^= s >>> 13;
  s = Math.imul(s, 0xc2b2ae35) | 0;
  s ^= s >>> 16;
  if (s === 0) s = 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0xffffff;
  };
}

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const shade = (c: [number, number, number], k: number): [number, number, number] =>
  [c[0] * k, c[1] * k, c[2] * k];

const STONE = ['#5b5f66', '#6a6560', '#4f545c', '#726b62'];
const LEAF = ['#3d6b4a', '#2f5a3f', '#4a7a52', '#356048'];
const CAP = ['#c4785e', '#b8695c', '#d8a06a', '#8f5d6b'];
const GLOW = ['#7fd4c1', '#8fb8ff', '#c9a0ff', '#ffd68a'];
const BONE = ['#c8c2b0', '#b5ae9c'];

function pick<T>(r: () => number, a: T[]): T { return a[Math.floor(r() * a.length) % a.length]; }

/** A prop in its own space: +y up, roughly a metre across at scale 1. */
export function makeProp(kind: PropKind, seed: number): Capsule[] {
  const r = rng(seed);
  const caps: Capsule[] = [];
  const put = (a: V3, b: V3, rad: number, col: [number, number, number], part = 'prop') =>
    caps.push({ a, b, r: rad, color: col, part });

  switch (kind) {
    case 'rock':
    case 'boulder': {
      const big = kind === 'boulder';
      const base = hex(pick(r, STONE));
      const n = 2 + Math.floor(r() * 3);
      const s = big ? 1.0 : 0.5;
      for (let i = 0; i < n; i++) {
        const rad = (big ? 0.24 : 0.13) * (0.6 + r() * 0.8);
        const x = (r() - 0.5) * 0.5 * s, z = (r() - 0.5) * 0.5 * s;
        const y = rad * (0.62 + r() * 0.25);
        // squat: a rock sits into the ground rather than balancing on it
        put(v3(x, y, z), v3(x + (r() - 0.5) * 0.1, y * 0.86, z + (r() - 0.5) * 0.1),
          rad, shade(base, 0.82 + r() * 0.32));
      }
      break;
    }
    case 'stump': {
      const wood = hex('#5a4433');
      // squat and wide, or it is just a post. The roots have to clear the
      // trunk's own radius or the blend swallows them whole.
      const h = 0.14 + r() * 0.1, wide = 0.17 + r() * 0.06;
      put(v3(0, 0.02, 0), v3((r() - 0.5) * 0.05, h, (r() - 0.5) * 0.05), wide, wood);
      put(v3(0, h, 0), v3(0, h + 0.015, 0), wide * 0.92, shade(wood, 1.22));  // cut face
      for (let i = 0; i < 4 + Math.floor(r() * 3); i++) {
        const a = r() * Math.PI * 2, len = wide + 0.14 + r() * 0.2;
        put(v3(Math.cos(a) * wide * 0.7, 0.05, Math.sin(a) * wide * 0.7),
          v3(Math.cos(a) * len, 0.028, Math.sin(a) * len),
          0.04 + r() * 0.022, shade(wood, 0.82));
      }
      break;
    }
    case 'fern': {
      const leaf = hex(pick(r, LEAF));
      const n = 4 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.5;
        const out = 0.12 + r() * 0.18, up = 0.3 + r() * 0.3;
        // each frond is two capsules so it can BEND — one straight line reads
        // as a stick, two read as a leaf
        const midX = Math.cos(a) * out * 0.45, midZ = Math.sin(a) * out * 0.45;
        put(v3(0, 0.02, 0), v3(midX, up * 0.62, midZ), 0.022, shade(leaf, 0.9));
        put(v3(midX, up * 0.62, midZ), v3(Math.cos(a) * out, up, Math.sin(a) * out),
          0.03 + r() * 0.02, leaf);
      }
      break;
    }
    case 'fungus': {
      const capCol = hex(pick(r, CAP));
      const stalk = hex('#e2dcc8');
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const x = (r() - 0.5) * 0.3, z = (r() - 0.5) * 0.3;
        const h = 0.16 + r() * 0.22, wide = 0.08 + r() * 0.09;
        put(v3(x, 0.02, z), v3(x + (r() - 0.5) * 0.05, h, z), 0.026 + r() * 0.014, stalk);
        // the cap: a wide flat capsule laid across the top of the stalk
        put(v3(x - wide * 0.5, h, z), v3(x + wide * 0.5, h + 0.01, z), wide * 0.62,
          shade(capCol, 0.9 + r() * 0.25));
      }
      break;
    }
    case 'shard': {
      const glow = hex(pick(r, GLOW));
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        // Mostly UP. A crystal that leans as far as it rises is a gold blob
        // with spikes in it — the whole read is height against a thin base.
        const lean = 0.05 + r() * 0.14, h = 0.45 + r() * 0.5;
        const mx = Math.cos(a) * lean * 0.35, mz = Math.sin(a) * lean * 0.35;
        put(v3(0, 0.02, 0), v3(mx, h * 0.5, mz), 0.032 + r() * 0.016, shade(glow, 0.7));
        put(v3(mx, h * 0.5, mz), v3(Math.cos(a) * lean, h, Math.sin(a) * lean),
          0.014, shade(glow, 1.25));
      }
      break;
    }
    case 'bones': {
      const bone = hex(pick(r, BONE));
      // a ribcage arc, half buried
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1);
        const x = -0.22 + t * 0.44;
        const h = 0.1 + Math.sin(Math.PI * t) * 0.16;
        put(v3(x, 0.01, -0.1), v3(x, h, 0), 0.022, bone);
        put(v3(x, h, 0), v3(x, 0.01, 0.1), 0.022, shade(bone, 0.88));
      }
      // and something long lying beside it
      const a = r() * Math.PI;
      put(v3(Math.cos(a) * -0.2, 0.03, Math.sin(a) * -0.2 + 0.22),
        v3(Math.cos(a) * 0.2, 0.03, Math.sin(a) * 0.2 + 0.22), 0.032, bone);
      break;
    }
    case 'roots': {
      // an old root breaking the floor and diving back in, like a sea serpent
      const wood = hex('#4e3b2c');
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, off = r() * 0.3;
        const x0 = Math.cos(a) * off, z0 = Math.sin(a) * off;
        const dx = Math.cos(a + 1.2), dz = Math.sin(a + 1.2);
        const h = 0.1 + r() * 0.14, len = 0.25 + r() * 0.25;
        put(v3(x0, 0.0, z0), v3(x0 + dx * len * 0.5, h, z0 + dz * len * 0.5),
          0.04 + r() * 0.02, shade(wood, 0.85 + r() * 0.3));
        put(v3(x0 + dx * len * 0.5, h, z0 + dz * len * 0.5), v3(x0 + dx * len, 0.0, z0 + dz * len),
          0.035, shade(wood, 0.8));
      }
      break;
    }
    case 'eggs': {
      // a clutch of leathery eggs — whose? the pit does not say
      const shell = hex(r() < 0.5 ? '#c9bfa5' : '#a8b39a');
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, off = r() * 0.16;
        const x = Math.cos(a) * off, z = Math.sin(a) * off;
        const rad = 0.07 + r() * 0.05;
        put(v3(x, rad * 0.75, z), v3(x, rad * 1.15, z), rad, shade(shell, 0.85 + r() * 0.3));
      }
      break;
    }
    case 'sprout': {
      // a single hopeful shoot with two small leaves
      const leaf = hex(pick(r, LEAF));
      const lean = (r() - 0.5) * 0.1;
      put(v3(0, 0.01, 0), v3(lean, 0.28 + r() * 0.12, 0), 0.02, shade(leaf, 0.8));
      put(v3(lean, 0.2, 0), v3(lean + 0.12, 0.3, 0.06), 0.028, leaf);
      put(v3(lean, 0.26, 0), v3(lean - 0.1, 0.34, -0.06), 0.026, shade(leaf, 1.12));
      break;
    }
    case 'tuft': {
      // coarse pit-grass in a clump
      const grass = hex(r() < 0.5 ? '#5d6b48' : '#6a7550');
      const n = 5 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, off = r() * 0.12;
        const lean = 0.06 + r() * 0.12, h = 0.18 + r() * 0.2;
        put(v3(Math.cos(a) * off, 0.01, Math.sin(a) * off),
          v3(Math.cos(a) * (off + lean), h, Math.sin(a) * (off + lean)),
          0.014 + r() * 0.008, shade(grass, 0.75 + r() * 0.5));
      }
      break;
    }
    case 'bloom': {
      // one pale flower on a crooked stem — the only bright thing down here
      const stem = hex('#55604a');
      const petal = hex(pick(r, ['#d8c8e8', '#e8d0c0', '#c8d8e0', '#e0c8d0']));
      const lean = (r() - 0.5) * 0.16, h = 0.3 + r() * 0.2;
      put(v3(0, 0.01, 0), v3(lean * 0.6, h * 0.6, 0), 0.018, stem);
      put(v3(lean * 0.6, h * 0.6, 0), v3(lean, h, 0), 0.016, shade(stem, 0.85));
      const n = 4 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        put(v3(lean, h, 0), v3(lean + Math.cos(a) * 0.08, h + 0.04, Math.sin(a) * 0.08),
          0.035, shade(petal, 0.85 + r() * 0.3));
      }
      put(v3(lean, h + 0.03, 0), v3(lean, h + 0.04, 0), 0.03, hex('#e8d888'));
      break;
    }
  }
  return caps;
}

export interface Prop {
  kind: PropKind;
  x: number; z: number;
  yaw: number;
  scale: number;
  radius: number;      // how far a creature must stay out of it
  caps: Capsule[];     // already in world space: scenery never moves
}

const KINDS: PropKind[] = ['rock', 'rock', 'shard', 'bones', 'stump', 'boulder', 'roots', 'eggs'];

// the pit's rim is quieter than its floor: stone, grass, old bones — no
// glowing things, nothing that competes with the fight for the eye
const EDGE_KINDS: PropKind[] = ['rock', 'rock', 'rock', 'tuft', 'tuft', 'fern', 'bones', 'boulder'];

/** Lay out the pit's scenery. Same seed, same pit, every time it reopens. */
export function scatterProps(
  seed: number, count: number, inner = 1.8, outer = 7.5, kinds: PropKind[] = KINDS,
  blocks = true,
): Prop[] {
  const r = rng(seed);
  const out: Prop[] = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(r() * kinds.length) % kinds.length];
    // a ring: the middle of the pit is where things fight
    const a = r() * Math.PI * 2;
    const rad = inner + r() * (outer - inner);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const yaw = r() * Math.PI * 2;
    const scale = 0.7 + r() * 0.75;
    const local = makeProp(kind, (seed * 7919 + i * 104729) | 0);
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    const place = (p: V3): V3 => v3(
      x + (p.x * ca - p.z * sa) * scale,
      p.y * scale,
      z + (p.x * sa + p.z * ca) * scale,
    );
    let reach = 0.1;
    const caps = local.map(c => {
      reach = Math.max(reach, Math.hypot(c.a.x, c.a.z) + c.r, Math.hypot(c.b.x, c.b.z) + c.r);
      return { ...c, a: place(c.a), b: place(c.b), r: c.r * scale };
    });
    // things you push past rather than climb: only solid props block
    const solid = blocks && (kind === 'rock' || kind === 'boulder' || kind === 'stump');
    out.push({ kind, x, z, yaw, scale, radius: solid ? reach * scale * 0.8 : 0, caps });
  }
  return out;
}

/**
 * The whole pit's scenery in ONE place, so every screen and the server agree
 * capsule for capsule. (They used to each call scatterProps with their own
 * count — the live client drew six props the server never collided with.)
 * The floor scatter keeps the middle clear for fighting; the rim ring sits
 * OUTSIDE the wall creatures are held behind, so it defines the edge without
 * ever being in anyone's way (blocks=false: a big rim boulder's collision
 * reach would otherwise poke inside the wall and shove whoever is pinned
 * against it) — and it costs the wire nothing, because all of this is still
 * just the seed.
 */
export function pitScenery(seed: number): Prop[] {
  return [
    ...scatterProps(seed, 12),
    ...scatterProps((seed ^ 0x5bd1e995) | 0, 36, 7.7, 8.6, EDGE_KINDS, false),
  ];
}
