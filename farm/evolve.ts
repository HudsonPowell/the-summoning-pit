// Breeding walks from words. Start from the neutral genome, mutate raw gait
// drivers (the mood system is not used — that's the point), and let a text
// description supply the selection pressure. If the winner visibly trudges,
// "generate, watch, judge, retain" is closed-loop and local.

import { mkdirSync, writeFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';
import { defaultBiped, Gait, Genome } from '../src/genome';
import { renderSheet } from './lib';

const TARGET = {
  pos: 'a figure slumped over, hunched, head hanging down, shuffling wearily',
  neg: 'a figure standing tall and upright, striding energetically',
};

// plausibility regulariser: the walk must still read as a person walking,
// or optimisation happily breeds expressive pretzels
const PLAUSIBLE = {
  pos: 'a humanoid figure walking on two legs',
  neg: 'a broken contorted tangle of limbs',
};

const POP = 12;
const GENERATIONS = 5;
const ELITE = 3;
const MUT_RATE = 0.5; // chance each param mutates
const MUT_SCALE = 0.25; // fraction of the param's range

// same ranges the studio sliders expose — the searchable driver space
const BOUNDS: Record<keyof Gait, [number, number]> = {
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
const KEYS = Object.keys(BOUNDS) as (keyof Gait)[];

const clamp = (x: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, x));
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function mutate(g: Gait): Gait {
  const out = { ...g };
  for (const k of KEYS) {
    if (Math.random() < MUT_RATE) {
      const [lo, hi] = BOUNDS[k];
      out[k] = clamp(out[k] + gauss() * MUT_SCALE * (hi - lo), BOUNDS[k]);
    }
  }
  return out;
}

const classify = await pipeline(
  'zero-shot-image-classification',
  'Xenova/clip-vit-base-patch32',
);

mkdirSync('farm/out/evolve', { recursive: true });
const base = defaultBiped();
const mood = { tired: 0, angry: 0 };

async function contrast(path: string, pair: { pos: string; neg: string }): Promise<number> {
  const out = (await classify(path, [pair.pos, pair.neg])) as {
    label: string;
    score: number;
  }[];
  return out.find(o => o.label === pair.pos)!.score;
}

async function fitness(gait: Gait, tag: string): Promise<number> {
  const genome: Genome = { ...base, gait };
  const png = renderSheet(genome, mood);
  const path = `farm/out/evolve/${tag}.png`;
  writeFileSync(path, png);
  const target = await contrast(path, TARGET);
  const plausible = await contrast(path, PLAUSIBLE);
  return target * plausible;
}

let pop: Gait[] = [base.gait, ...Array.from({ length: POP - 1 }, () => mutate(base.gait))];
let best: { gait: Gait; f: number } = { gait: base.gait, f: -1 };

for (let gen = 0; gen < GENERATIONS; gen++) {
  const scored: { gait: Gait; f: number }[] = [];
  for (let i = 0; i < pop.length; i++) {
    const f = await fitness(pop[i], `g${gen}_${i}`);
    scored.push({ gait: pop[i], f });
  }
  scored.sort((a, b) => b.f - a.f);
  if (scored[0].f > best.f) best = scored[0];
  console.log(
    `gen ${gen}: best ${scored[0].f.toFixed(3)}  median ${scored[Math.floor(POP / 2)].f.toFixed(3)}  (all-time ${best.f.toFixed(3)})`,
  );
  const elites = scored.slice(0, ELITE).map(s => s.gait);
  pop = [
    ...elites,
    ...Array.from({ length: POP - ELITE }, () => mutate(elites[Math.floor(Math.random() * ELITE)])),
  ];
}

const winner: Genome = { ...base, name: 'bred-tired', gait: best.gait };
writeFileSync('farm/out/evolve/winner.png', renderSheet(winner, mood));
writeFileSync('genomes/bred-tired.json', JSON.stringify(winner, null, 2));
console.log(`\nwinner fitness ${best.f.toFixed(3)} -> farm/out/evolve/winner.png, genomes/bred-tired.json`);
console.log('baseline (neutral genome) was scored in gen 0 as g0_0');
