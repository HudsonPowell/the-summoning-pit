/**
 * The pit's taste. The engine always budgeted FAIRNESS — priced weapons,
 * capped tempo, banded mass — but it swallowed anything as a BODY, and a
 * model that composes six parts of nothing walks a mess into the pit.
 *
 * Two layers, cheapest first:
 *  - anatomyOf: deterministic checks on the posed capsules. Is it one
 *    connected thing, does it touch the floor, is it a figure and not a
 *    balloon with debris. Microseconds, no ML, catches disasters.
 *  - pickByEye: a HOSTED vision model compares the rendered candidates and
 *    names the more coherent one. The pit already trusts its hatching
 *    provider with the summoner's words, so the judge rides the same pipe —
 *    no local weights, no native code, nothing to crash or fill a disk.
 *    (Local CLIP was tried: it filled the Railway volume to ENOSPC, then its
 *    native runtime died silently under the platform sandbox. Never again.)
 *
 * The summoner's words appear transiently in the judging prompt to the SAME
 * provider that hatched them — never stored, never logged, never on the wire.
 *
 * SERVER-ONLY module: imports pngjs. The browser must never bundle this.
 */
import { Genome, heightOf } from './genome';
import { makeCharacter } from './character';
import { solvePose, Capsule } from './pose';
import { PixelRenderer, Camera } from './render';
import { HATCH_API_KEY, HATCH_API_URL } from './ollama';

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
  score: number;        // 0..1 — relative only; the judge is a picker, not a gate
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

// --- the eye: a hosted vision model compares the candidates -----------------

/** The judge that looks. Env-swappable; must be serverless on the hatch host. */
const EYE_MODEL = (typeof process !== 'undefined' && process.env?.PIT_EYE_MODEL) || 'Qwen/Qwen3.8-Flash';

export function eyeReady(): boolean {
  return !!HATCH_API_KEY;
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

async function pngDataUri(genome: Genome): Promise<string> {
  const { PNG } = await import('pngjs');
  const png = new PNG({ width: CELL, height: CELL });
  png.data.set(renderCandidate(genome));
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

/**
 * Ask the eye which of two candidates reads better. The model streams (it is
 * a thinking model and its host demands SSE); only the verdict is kept.
 * Returns 0 or 1, or null when the eye is closed or unreadable.
 */
export async function pickByEye(genomes: [Genome, Genome], desc?: string): Promise<number | null> {
  if (!eyeReady()) return null;
  const [a, b] = await Promise.all([pngDataUri(genomes[0]), pngDataUri(genomes[1])]);
  const brief = desc
    ? `Two renders of a game creature summoned from the words "${desc.slice(0, 140)}", A then B.`
    : 'Two renders of game creatures, A then B.';
  const res = await fetch(`${HATCH_API_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${HATCH_API_KEY}` },
    body: JSON.stringify({
      model: EYE_MODEL, max_tokens: 400, temperature: 0, stream: true,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `${brief} Which looks more like a single coherent creature with a readable body — not scattered shapes, debris, or a bare stick — and better fits the words? End your answer with exactly VERDICT: A or VERDICT: B.` },
        { type: 'text', text: 'A:' },
        { type: 'image_url', image_url: { url: a } },
        { type: 'text', text: 'B:' },
        { type: 'image_url', image_url: { url: b } },
      ] }],
    }),
  });
  if (!res.ok || !res.body) return null;
  let text = '';
  const reader = (res.body as any).getReader();
  const dec = new TextDecoder();
  let carry = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        text += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? '';
      } catch { /* keep-alive or partial frame */ }
    }
  }
  const m = /VERDICT:\s*([AB])/i.exec(text);
  return m ? (m[1].toUpperCase() === 'A' ? 0 : 1) : null;
}

/**
 * The full judgment: the eye picks when it can; anatomy breaks the fall.
 * Never throws, never refuses — SOME candidate always walks in.
 */
export async function pickBest(genomes: Genome[], desc?: string): Promise<number> {
  if (genomes.length < 2) return 0;
  try {
    const eyed = await pickByEye([genomes[0], genomes[1]], desc);
    if (eyed != null) {
      console.log(`[taste] the eye chose ${eyed === 0 ? 'the first' : 'the second'}`);
      return eyed;
    }
  } catch (e) {
    console.log(`[taste] the eye blinked: ${(e as Error).message.slice(0, 60)}`);
  }
  try {
    const scores = genomes.map(g => anatomyOf(g).score);
    const best = scores[1] > scores[0] ? 1 : 0;
    console.log(`[taste] anatomy kept ${scores[best].toFixed(2)} over ${scores[1 - best].toFixed(2)}`);
    return best;
  } catch {
    return 0;
  }
}
