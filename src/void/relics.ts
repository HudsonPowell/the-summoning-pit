// The pit floor remembers.
//
// A kill leaves bones and sometimes the weapon nobody took. They lie where
// they fell, get kicked and scattered by anything that walks through them,
// and slowly sink into the floor — the pit digests its history instead of
// hoarding it, so the ground is never clean and never cluttered.
//
// The greenery is alive too: plants grow from sprouts, get chipped and
// trampled by fights, and reseed elsewhere when they die. All of it is
// stepped by the AUTHORITATIVE sim (the server in live mode, the local sim
// solo) and mirrored to watchers through snapshots.

import { WeaponSpec } from '../character';

export interface Relic {
  id: number;
  kind: 'skull' | 'bone' | 'wpn';
  x: number; z: number;
  vx: number; vz: number;
  yaw: number; vyaw: number;
  sink: number;              // 0 fresh .. 1 swallowed by the floor
  item?: WeaponSpec;         // the weapon, for 'wpn'
}

export type FloraKind = 'fern' | 'fungus' | 'sprout' | 'tuft' | 'bloom';
const FLORA_KINDS: FloraKind[] = ['fern', 'fungus', 'sprout', 'tuft', 'bloom'];

export interface Flora {
  id: number;
  kind: FloraKind;
  x: number; z: number;
  yaw: number;
  growth: number;            // 0 sprouting .. 1 full
  hurt: number;              // 0 fine .. 1 trampled flat; decays
  seed: number;              // shape variation
}

export const MAX_RELICS = 24;
export const MAX_FLORA = 12;
const ARENA_R = 7.4;

let nextId = 1;

// --- births -----------------------------------------------------------------

/** A death seeds the floor: a skull, a bone or two, and the unclaimed weapon. */
export function leaveRemains(
  relics: Relic[],
  x: number, z: number,
  weapon: WeaponSpec | undefined,
  rnd: () => number = Math.random,
): void {
  const drop = (kind: Relic['kind'], item?: WeaponSpec) => {
    const a = rnd() * Math.PI * 2;
    const sp = 0.4 + rnd() * 0.9;
    relics.push({
      id: nextId++, kind,
      x: x + Math.cos(a) * 0.15, z: z + Math.sin(a) * 0.15,
      vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
      yaw: rnd() * Math.PI * 2, vyaw: (rnd() - 0.5) * 6,
      sink: 0, item,
    });
  };
  drop('skull');
  drop('bone');
  if (rnd() < 0.6) drop('bone');
  if (weapon) drop('wpn', weapon);
}

export function seedFlora(seed: number, count: number): Flora[] {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32);
  const out: Flora[] = [];
  for (let i = 0; i < count; i++) out.push(sprout(r, 0.4 + r() * 0.6));
  return out;
}

function sprout(rnd: () => number, growth = 0.05): Flora {
  const a = rnd() * Math.PI * 2;
  const rad = 2.2 + rnd() * (ARENA_R - 2.4);
  return {
    id: nextId++,
    kind: FLORA_KINDS[Math.floor(rnd() * FLORA_KINDS.length) % FLORA_KINDS.length],
    x: Math.cos(a) * rad, z: Math.sin(a) * rad,
    yaw: rnd() * Math.PI * 2,
    growth, hurt: 0,
    seed: (rnd() * 1e9) | 0,
  };
}

// --- the step ---------------------------------------------------------------

interface Walker { x: number; z: number; heading: number; move: number; bulk: number; deadT: number }
interface Blow { kind: string; x: number; z: number }

export function stepRelics(relics: Relic[], walkers: Walker[], dt: number): void {
  for (const r of relics) {
    // friction, then travel
    const f = Math.exp(-3 * dt);
    r.vx *= f; r.vz *= f; r.vyaw *= f;
    r.x += r.vx * dt; r.z += r.vz * dt; r.yaw += r.vyaw * dt;
    const d = Math.hypot(r.x, r.z);
    if (d > ARENA_R) { r.x *= ARENA_R / d; r.z *= ARENA_R / d; }

    // anything that walks through it kicks it — history gets shuffled, not
    // curated. Sunk relics are already part of the floor and stay put.
    if (r.sink < 0.55) {
      for (const w of walkers) {
        if (w.deadT >= 0 || w.move < 0.25) continue;
        const dx = r.x - w.x, dz = r.z - w.z;
        const reach = 0.32 + w.bulk * 0.18;
        const dd = Math.hypot(dx, dz);
        if (dd > reach || dd < 1e-4) continue;
        const kick = 1.1 + w.move * 1.4;
        r.vx = (dx / dd) * kick * 0.7 + Math.cos(w.heading) * kick * 0.45;
        r.vz = (dz / dd) * kick * 0.7 + Math.sin(w.heading) * kick * 0.45;
        r.vyaw = (Math.random() - 0.5) * 9;
        break;
      }
    }

    // the floor takes everything back eventually
    r.sink += dt / 300;
  }

  // over the cap, the oldest sink fast — the pit swallows, it never pops
  const excess = relics.length - MAX_RELICS;
  if (excess > 0) {
    const byAge = [...relics].sort((p, q) => p.id - q.id);
    for (let i = 0; i < excess; i++) byAge[i].sink += dt * 2;
  }

  for (let i = relics.length - 1; i >= 0; i--) {
    if (relics[i].sink >= 1) relics.splice(i, 1);
  }
}

export function stepFlora(
  flora: Flora[], blows: Blow[], walkers: Walker[], dt: number, t: number,
): void {
  for (const p of flora) {
    p.growth = Math.min(1, p.growth + dt * 0.005);
    p.hurt = Math.max(0, p.hurt - dt * 0.06);

    // a fight tramples what it happens next to
    for (const b of blows) {
      if (b.kind !== 'hit' && b.kind !== 'kill') continue;
      const dd = Math.hypot(p.x - b.x, p.z - b.z);
      if (dd < 1.3) {
        p.hurt = Math.min(1, p.hurt + 0.45 * (1 - dd / 1.3));
        p.growth = Math.max(0.06, p.growth - 0.16 * (1 - dd / 1.3));
      }
    }
    // heavy things brush past and bend it
    for (const w of walkers) {
      if (w.deadT >= 0 || w.move < 0.3) continue;
      const dd = Math.hypot(p.x - w.x, p.z - w.z);
      if (dd < 0.3 + w.bulk * 0.2) p.hurt = Math.min(1, p.hurt + dt * 2.2);
    }
  }

  // a plant beaten down to nothing dies, and something new sprouts elsewhere
  for (let i = flora.length - 1; i >= 0; i--) {
    const p = flora[i];
    if (p.growth <= 0.07 && p.hurt > 0.5) flora.splice(i, 1);
  }
  // slow reseeding keeps the pit green without ever crowding it
  if (flora.length < MAX_FLORA && Math.floor(t / 25) !== Math.floor((t - dt) / 25)) {
    const p = sprout(Math.random);
    // never sprout under someone's feet
    if (walkers.every(w => w.deadT >= 0 || Math.hypot(p.x - w.x, p.z - w.z) > 1.2)) flora.push(p);
  }
}
