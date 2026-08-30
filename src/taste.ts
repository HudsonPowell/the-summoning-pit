/**
 * The pit's taste. The engine always budgeted FAIRNESS — priced weapons,
 * capped tempo, banded mass — but it swallowed anything as a BODY, and a
 * model that composes six parts of nothing walks a mess into the pit.
 *
 * Two layers, cheapest first:
 *  - geomScore: deterministic anatomy checks on the posed capsules. Is it one
 *    connected thing, does it touch the floor, is it a figure and not a
 *    balloon with debris. Microseconds, no ML, catches disasters.
 *  - clipPick: the studio's judge trick — CLIP pairwise CONTRAST (absolute
 *    scores are junk; contrasts are where the signal lives) between rendered
 *    candidates. Adds taste on top of sanity. Loads lazily, fails soft.
 *
 * The summoner's words are used transiently in memory as a CLIP text axis and
 * nothing else — never stored, never logged, never on the wire.
 *
 * SERVER-ONLY module: imports pngjs and (lazily) @huggingface/transformers.
 * The browser must never bundle this.
 */
import { Genome, heightOf } from './genome';
import { makeCharacter } from './character';
import { solvePose, Capsule } from './pose';
import { PixelRenderer, Camera } from './render';

type V = { x: number; y: number; z: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Closest distance between two segments — the standard clamped-quadratic. */
function segDist(p1: V, q1: V, p2: V, q2: V): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) { /* both points */ }
  else if (a <= 1e-9) { t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) { s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  const cp = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const cq = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  const d = sub(cp, cq);
  return Math.sqrt(dot(d, d));
}

const capVol = (c: Capsule): number => {
  const d = sub(c.b as any, c.a as any);
  const len = Math.sqrt(dot(d, d));
  return Math.PI * c.r * c.r * (len + (4 / 3) * c.r);
};

export interface Anatomy {
  score: number;        // 0..1 — below ~0.55 is a mess (see CALIBRATION.md)
  connected: number;    // volume share of the largest connected component
  grounded: boolean;    // the main mass reaches the floor
  figure: number;       // 1 - (largest single capsule's volume share): 0 = one balloon
}

/** Deterministic coherence: pose it and check it holds together as a body. */
export function anatomyOf(genome: Genome): Anatomy {
  const ch = makeCharacter(genome, 'beast');
  const caps = solvePose(genome, { tired: 0, angry: 0 }, 0.22, 1, 0, undefined, 0,
    { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any });
  if (!caps.length) return { score: 0, connected: 0, grounded: false, figure: 0 };

  // union-find over capsules that touch (with a little slack for the blend)
  const parent = caps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
      const d = segDist(caps[i].a as any, caps[i].b as any, caps[j].a as any, caps[j].b as any);
      if (d <= (caps[i].r + caps[j].r) * 1.2 + 0.03) parent[find(i)] = find(j);
    }
  }
  const compVol = new Map<number, number>();
  let total = 0, biggestCap = 0;
  caps.forEach((c, i) => {
    const v = capVol(c);
    total += v;
    biggestCap = Math.max(biggestCap, v);
    const root = find(i);
    compVol.set(root, (compVol.get(root) ?? 0) + v);
  });
  let mainRoot = 0, mainVol = 0;
  for (const [root, v] of compVol) if (v > mainVol) { mainVol = v; mainRoot = root; }

  const connected = total > 0 ? mainVol / total : 0;
  let mainMinY = Infinity;
  caps.forEach((c, i) => {
    if (find(i) !== mainRoot) return;
    mainMinY = Math.min(mainMinY, (c.a as any).y - c.r, (c.b as any).y - c.r);
  });
  const h = Math.max(0.3, heightOf(genome));
  const grounded = mainMinY < h * 0.25;
  const figure = total > 0 ? 1 - biggestCap / total : 0;

  // connectivity dominates; a balloon or a floater loses the rest. Stray
  // pieces are counted as well as weighed — a cloud of specks is nearly all
  // of the main component by VOLUME and still reads as debris.
  const stray = Math.min(0.25, Math.max(0, compVol.size - 1) * 0.06);
  const score = Math.max(0,
    connected * 0.6 + (grounded ? 0.2 : 0) + Math.min(1, figure / 0.35) * 0.2 - stray);
  return { score, connected, grounded, figure };
}

// --- the taste layer: CLIP pairwise contrast on renders ---------------------

let clip: any | 'loading' | 'dead' = null;

/** Start loading CLIP in the background. Safe to call more than once. */
export function warmTaste(cacheDir?: string): void {
  if (clip) return;
  clip = 'loading';
  // The download can die as an unhandled STREAM error (ENOSPC did, and took
  // the whole pit down with it) — no try/catch sees those. While the judge
  // is being seated, a process-level net catches whatever falls; it comes
  // down the moment loading resolves either way.
  const fell = (e: Error) => {
    clip = 'dead';
    console.log(`[taste] the judge fell on the stairs: ${e.message.slice(0, 80)}`);
  };
  if (typeof process !== 'undefined') process.on('uncaughtException', fell);
  void (async () => {
    try {
      const tf: any = await import('@huggingface/transformers');
      if (cacheDir) tf.env.cacheDir = cacheDir;
      const p = await tf.pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
      if (clip === 'loading') { clip = p; console.log('[taste] the judge is seated'); }
    } catch (e) {
      clip = 'dead';
      console.log(`[taste] no judge today: ${(e as Error).message.slice(0, 80)}`);
    } finally {
      if (typeof process !== 'undefined') process.removeListener('uncaughtException', fell);
    }
  })();
}

export function tasteReady(): boolean {
  return !!clip && clip !== 'loading' && clip !== 'dead';
}

const CELL = 224;
const renderer = new PixelRenderer(CELL, CELL);
const rbuf = new Uint8ClampedArray(CELL * CELL * 4);

export function renderCandidate(genome: Genome): Uint8ClampedArray {
  const ch = makeCharacter(genome, 'beast');
  const caps = solvePose(genome, { tired: 0, angry: 0 }, 0.22, 1, 0, undefined, 0,
    { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any });
  let reach = 0.2, minY = Infinity, maxY = -Infinity;
  for (const c of caps) for (const p of [c.a, c.b] as any[]) {
    reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
    minY = Math.min(minY, p.y - c.r); maxY = Math.max(maxY, p.y + c.r);
  }
  const cam: Camera = {
    yaw: 0.5, pitch: 0.2, ppm: (CELL * 0.8) / Math.max(reach * 2, maxY - minY, heightOf(genome)),
    cy: (minY + maxY) / 2, floor: false, blend: 1.1, blendShape: 0.5, blendMix: 1, voidColor: [10, 8, 14],
  };
  renderer.render(rbuf, caps, cam, 0);
  return rbuf;
}

/** P(pos) against neg for one render — the pairwise contrast primitive. */
async function contrast(img: any, pos: string, neg: string): Promise<number> {
  const out = await clip(img, [pos, neg]);
  return (out as { label: string; score: number }[]).find(o => o.label === pos)?.score ?? 0.5;
}

// Calibrated 2026-08-31 against exemplars + 70B goods + V4-Pro messes (see
// CALIBRATION.md): STANDING is the axis that separates — worst good 0.98,
// best mess 0.65. CREATURE backs it up (catches fragment clouds the standing
// axis is lenient on). Feeding CLIP a RawImage from our buffer scored every
// render identically — it judges a PNG FILE and nothing else.
const STANDING: [string, string] = ['a living character standing on legs', 'random floating debris'];
const CREATURE: [string, string] = ['a small creature or monster with a body and limbs', 'scattered disconnected abstract shapes'];

/**
 * Score candidates: anatomy always, CLIP when the judge is seated. `desc` is
 * held in memory for one text-embed and released — never stored or logged.
 * Returns per-candidate totals, higher is better.
 */
export async function tasteScores(genomes: Genome[], desc?: string): Promise<number[]> {
  const anatomies = genomes.map(g => {
    try { return anatomyOf(g); } catch { return { score: 0, connected: 0, grounded: false, figure: 0 }; }
  });
  const totals = anatomies.map(a2 => a2.score * 0.8);
  if (!tasteReady()) return totals;
  const { writeFileSync, unlinkSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { PNG } = await import('pngjs');
  const dir = mkdtempSync(join(tmpdir(), 'taste-'));
  try {
    for (let i = 0; i < genomes.length; i++) {
      const rgba = renderCandidate(genomes[i]);
      const png = new PNG({ width: CELL, height: CELL });
      png.data.set(rgba);
      const file = join(dir, `${i}.png`);
      writeFileSync(file, PNG.sync.write(png));
      const standing = await contrast(file, ...STANDING);
      const creature = await contrast(file, ...CREATURE);
      const fits = desc ? await contrast(file, desc.slice(0, 140), CREATURE[1]) : 0.5;
      totals[i] += standing * 0.5 + creature * 0.25 + fits * 0.25;
      unlinkSync(file);
    }
  } catch (e) {
    console.log(`[taste] judge stumbled, anatomy stands: ${(e as Error).message.slice(0, 60)}`);
  }
  return totals;
}
