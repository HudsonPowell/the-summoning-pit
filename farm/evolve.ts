// Breeding walks from words. Start from the neutral genome, mutate raw gait
// drivers and body proportions, and let a text description supply the
// selection pressure, regularised by "still walks like a person".
//
// Usage: npm run farm:evolve -- <target>   (default: tired)

import { mkdirSync, writeFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';
import { defaultBiped, Body, Gait, Genome } from '../src/genome';
import { renderSheet } from './lib';

interface Target {
  pos: string;
  neg: string;
  palette: Genome['palette'];
  bodySeed?: Partial<Record<keyof Body, number>>; // multipliers on the base body
}

const TARGETS: Record<string, Target> = {
  tired: {
    pos: 'a figure slumped over, hunched, head hanging down, shuffling wearily',
    neg: 'a figure standing tall and upright, striding energetically',
    palette: { torso: '#3aa7a0', limbs: '#2b7f8f', head: '#e8c39a', accent: '#d5573b' },
  },
  skittish: {
    pos: 'a nervous jittery creature creeping low and cautiously, ready to bolt',
    neg: 'a calm confident figure strolling upright at ease',
    palette: { torso: '#9b8fc4', limbs: '#6f679e', head: '#d9d3ee', accent: '#e8e26e' },
    bodySeed: { thigh: 0.9, shin: 0.95, headR: 1.15, torsoR: 0.85, shoulderWidth: 0.85 },
  },
  brute: {
    pos: 'a huge heavy lumbering brute stomping slowly with massive arms',
    neg: 'a small light nimble figure stepping quickly',
    palette: { torso: '#8a6d3f', limbs: '#5f4a2c', head: '#c4a077', accent: '#3f7d4e' },
    bodySeed: { upperArm: 1.3, forearm: 1.3, shoulderWidth: 1.35, torsoR: 1.35, limbR: 1.4, headR: 0.9, thigh: 1.05 },
  },
  strut: {
    pos: 'a proud strutting figure marching with chest out and head high',
    neg: 'a meek figure shuffling with head down',
    palette: { torso: '#c4574e', limbs: '#8f3b3b', head: '#e8c39a', accent: '#e2b33c' },
  },
};

const PLAUSIBLE = {
  pos: 'a humanoid figure walking on two legs',
  neg: 'a broken contorted tangle of limbs',
};

const targetName = process.argv[2] ?? 'tired';
const target = TARGETS[targetName];
if (!target) {
  console.error(`unknown target "${targetName}" — options: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

const POP = 12;
const GENERATIONS = 5;
const ELITE = 3;
const MUT_RATE = 0.5;
const MUT_SCALE = 0.25;

const GAIT_BOUNDS: Record<keyof Gait, [number, number]> = {
  cadence: [0.2, 2.2],
  stride: [0.2, 2.4],
  stance: [0.5, 0.75],
  lift: [0, 0.3],
  bounce: [0, 0.08],
  sway: [0, 0.09],
  lean: [-0.2, 0.5],
  slump: [0, 0.8],
  crouch: [0, 0.25],
  pelvisTwist: [0, 0.3],
  shoulderTwist: [0, 0.4],
  armSwing: [0, 1.0],
  elbowBase: [0, 1.2],
  elbowAmp: [0, 1.2],
  elbowLag: [0, 0.4],
  headPitch: [-0.4, 0.8],
};
const BODY_BOUNDS: Partial<Record<keyof Body, [number, number]>> = {
  thigh: [0.25, 0.65],
  shin: [0.25, 0.65],
  upperArm: [0.18, 0.55],
  forearm: [0.18, 0.55],
  hipWidth: [0.14, 0.42],
  shoulderWidth: [0.2, 0.62],
  headR: [0.07, 0.22],
  torsoR: [0.06, 0.18],
  limbR: [0.03, 0.11],
};

type Candidate = { gait: Gait; body: Body };

const clampN = (x: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, x));
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function mutate(c: Candidate): Candidate {
  const gait = { ...c.gait };
  for (const k of Object.keys(GAIT_BOUNDS) as (keyof Gait)[]) {
    if (Math.random() < MUT_RATE) {
      const b = GAIT_BOUNDS[k];
      gait[k] = clampN(gait[k] + gauss() * MUT_SCALE * (b[1] - b[0]), b);
    }
  }
  const body = { ...c.body };
  for (const k of Object.keys(BODY_BOUNDS) as (keyof Body)[]) {
    const b = BODY_BOUNDS[k]!;
    if (Math.random() < MUT_RATE * 0.6) {
      body[k] = clampN(body[k] + gauss() * MUT_SCALE * 0.6 * (b[1] - b[0]), b);
    }
  }
  return { gait, body };
}

const classify = await pipeline(
  'zero-shot-image-classification',
  'Xenova/clip-vit-base-patch32',
);

mkdirSync('farm/out/evolve', { recursive: true });
const base = defaultBiped();
delete base.weapon; // bred creatures are unarmed
base.palette = target.palette;
for (const [k, mult] of Object.entries(target.bodySeed ?? {})) {
  const key = k as keyof Body;
  base.body[key] = clampN(base.body[key] * (mult as number), BODY_BOUNDS[key] ?? [0, 10]);
}
const mood = { tired: 0, angry: 0 };

async function contrast(path: string, pair: { pos: string; neg: string }): Promise<number> {
  const out = (await classify(path, [pair.pos, pair.neg])) as { label: string; score: number }[];
  return out.find(o => o.label === pair.pos)!.score;
}

async function fitness(c: Candidate, tag: string): Promise<number> {
  const genome: Genome = { ...base, gait: c.gait, body: c.body };
  const png = renderSheet(genome, mood);
  const path = `farm/out/evolve/${targetName}_${tag}.png`;
  writeFileSync(path, png);
  const t = await contrast(path, target);
  const p = await contrast(path, PLAUSIBLE);
  return t * p;
}

const seed: Candidate = { gait: base.gait, body: base.body };
let pop: Candidate[] = [seed, ...Array.from({ length: POP - 1 }, () => mutate(seed))];
let best: { c: Candidate; f: number } = { c: seed, f: -1 };

for (let gen = 0; gen < GENERATIONS; gen++) {
  const scored: { c: Candidate; f: number }[] = [];
  for (let i = 0; i < pop.length; i++) {
    scored.push({ c: pop[i], f: await fitness(pop[i], `g${gen}_${i}`) });
  }
  scored.sort((a, b) => b.f - a.f);
  if (scored[0].f > best.f) best = scored[0];
  console.log(
    `[${targetName}] gen ${gen}: best ${scored[0].f.toFixed(3)}  median ${scored[Math.floor(POP / 2)].f.toFixed(3)}  (all-time ${best.f.toFixed(3)})`,
  );
  const elites = scored.slice(0, ELITE).map(s => s.c);
  pop = [
    ...elites,
    ...Array.from({ length: POP - ELITE }, () => mutate(elites[Math.floor(Math.random() * ELITE)])),
  ];
}

const winner: Genome = { ...base, name: `bred-${targetName}`, gait: best.c.gait, body: best.c.body };
writeFileSync(`farm/out/evolve/${targetName}_winner.png`, renderSheet(winner, mood));
writeFileSync(`genomes/bred-${targetName}.json`, JSON.stringify(winner, null, 2));
console.log(`[${targetName}] winner ${best.f.toFixed(3)} -> genomes/bred-${targetName}.json`);
