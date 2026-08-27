// Same prompt, same schema, same server pipeline — two authors.
//
// One side is llama3.2:3b running locally through the hatcher. The other is
// genomes written by Opus 5 to the same notes. BOTH go through
// sanitiseGenome(), so both are mass-capped and both have their temperament
// derived from their body: whatever the difference is, it is not stats.

import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { hatchGenome } from '../src/hatch';
import { sanitiseGenome } from '../server/sanitise';
import { migrateGenome, heightOf, Genome } from '../src/genome';
import { makeCharacter } from '../src/character';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';
import { massOf } from '../src/budget';
import { drawText, wrap } from './font';

const G = 1.05;
const BASE = {
  cadence: 1.05, stride: 1.45, stance: 0.6, lift: 0.11,
  bounce: 0.028, sway: 0.03, lean: 0.06, slump: 0, crouch: 0.03,
  pelvisTwist: 0.1, shoulderTwist: 0.14,
  armSwing: 0.42, elbowBase: 0.35, elbowAmp: 0.5, elbowLag: 1 / 6,
  headPitch: 0, flapAmp: 0.5, tailWave: 0.35, bodyWave: 0,
};

/** Written by Opus 5, from the same SCHEMA_NOTES the local model is given. */
const MINE: Record<string, Genome> = {
  'a hunched cave troll with long arms and a small head': {
    name: 'troll', skeleton: {
      upright: true,
      body: [0.30, 0.24],
      girth: [0.19, 0.23, 0.17],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0, seg: [0.30, 0.27], r: 0.082, spread: 0.15 },
        // long arms are the whole idea: nearly as long as it is tall, and
        // hung forward so they read as knuckles-down
        { role: 'arm', at: 0.96, seg: [0.42, 0.40], r: 0.072, spread: 0.21, angle: 0.35 },
        { role: 'head', at: 1, seg: [0.04, 0.085], r: 0.072, spread: 0, ink: 2, angle: 0.55 },
      ],
    },
    gait: { ...BASE, cadence: 0.62, stride: 0.95, lean: 0.34, slump: 0.42, crouch: 0.09, armSwing: 0.68, headPitch: 0.4 },
    palette: { torso: '#5f6b4a', limbs: '#4d5940', head: '#8e9070', accent: '#3a2f28' },
  },
  'a long-necked wading heron that stabs with its beak': {
    name: 'heron', skeleton: {
      upright: false,
      body: [0.16, 0.15, 0.13],
      girth: [0.05, 0.10, 0.09, 0.05],
      locomotion: 'walk',
      chains: [
        // stilts: two segments, both long, thin as wire
        { role: 'leg', at: 0.35, seg: [0.40, 0.42], r: 0.017, spread: 0.055 },
        { role: 'wing', at: 0.75, seg: [0.26, 0.22], r: 0.035, spread: 0.09, ink: 1 },
        // the point of the animal: neck, neck, then a long thin beak
        { role: 'head', at: 1, seg: [0.30, 0.24, 0.19], r: 0.038, spread: 0, ink: 2, angle: -0.15 },
        { role: 'tail', at: 0, seg: [0.13, 0.09], r: 0.026, spread: 0 },
      ],
    },
    gait: { ...BASE, cadence: 0.7, stride: 1.15, lift: 0.19, bounce: 0.012, sway: 0.02, headPitch: -0.1, tailWave: 0.15 },
    palette: { torso: '#b9c2c8', limbs: '#8f9aa2', head: '#e8e4d8', accent: '#d8a03c' },
  },
  'a heavy-set dwarven axemaster with a braided beard': {
    name: 'dwarf', skeleton: {
      upright: true,
      body: [0.17, 0.15],
      girth: [0.16, 0.185, 0.15],
      locomotion: 'walk',
      chains: [
        // short legs under a wide chest is the whole silhouette
        { role: 'leg', at: 0, seg: [0.17, 0.16], r: 0.062, spread: 0.115 },
        { role: 'arm', at: 0.95, seg: [0.24, 0.23], r: 0.058, spread: 0.175 },
        { role: 'head', at: 1, seg: [0.03, 0.085], r: 0.078, spread: 0, ink: 2 },
        // the beard, hung off the head end and pointed down: a horn is just a
        // short stiff chain, and this is what it is for
        { role: 'horn', at: 0.99, seg: [0.10, 0.08], r: 0.05, spread: 0.03, ink: 3, angle: -1.2 },
      ],
    },
    gait: { ...BASE, cadence: 0.9, stride: 0.72, lean: 0.1, crouch: 0.02, armSwing: 0.5, bounce: 0.036 },
    palette: { torso: '#7a4a30', limbs: '#5d3a26', head: '#e2b48c', accent: '#c9762c' },
  },
};

const CELL = 300, LAB = 34, COLS = 2;
const OUT = 'farm/out/bakeoff';
mkdirSync(OUT, { recursive: true });
const r = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);

interface Cell { d: Uint8ClampedArray; label: string; ok: boolean }
const cells: Cell[] = [];
const rows: string[] = [];

function shoot(g: Genome, tag: string): Cell {
  const clean = sanitiseGenome(g);
  if (!clean) return { d: new Uint8ClampedArray(CELL * CELL * 4), label: tag + ' — rejected', ok: false };
  const ch = makeCharacter(clean, 'beast');
  const caps = solvePose(clean, { tired: 0, angry: 0 }, 0.24, 1, 0, undefined, 0,
    { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear });
  let reach = 0.2, minY = Infinity, maxY = -Infinity;
  for (const c of caps) for (const p of [c.a, c.b]) {
    reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
    minY = Math.min(minY, p.y - c.r); maxY = Math.max(maxY, p.y + c.r);
  }
  const cam: Camera = {
    yaw: 0.55, pitch: 0.2, ppm: (CELL * 0.84) / Math.max(reach * 2, maxY - minY),
    cy: (minY + maxY) / 2, floor: false, blend: 1.1, blendShape: 0.5, blendMix: 1,
    voidColor: [10, 8, 14],
  };
  r.render(buf, caps, cam, 0);
  const t = clean.temper!;
  rows.push(`| ${tag} | ${clean.skeleton.chains.map(c => c.role[0]).join('')} | ${massOf(clean.skeleton).toFixed(3)} | ${heightOf(clean).toFixed(2)}m | ${t.aggression.toFixed(2)} | ${t.bravery.toFixed(2)} | ${t.speed.toFixed(2)} |`);
  return { d: new Uint8ClampedArray(buf), label: tag, ok: true };
}

const prompts = Object.keys(MINE);
for (const p of prompts) {
  let llama: Genome | null = null;
  try { llama = migrateGenome(await hatchGenome(p)); } catch { /* offline */ }
  cells.push(llama ? shoot(llama, 'llama3.2:3b') : { d: new Uint8ClampedArray(CELL * CELL * 4), label: 'llama3.2:3b — no answer', ok: false });
  cells.push(shoot(MINE[p], 'opus 5'));
  console.log('done:', p);
}

const ROWS = prompts.length;
const sheet = new PNG({ width: CELL * COLS, height: (CELL + LAB) * ROWS });
cells.forEach((c, i) => {
  const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * (CELL + LAB);
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const s = (y * CELL + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = c.d[s]; sheet.data[d+1] = c.d[s+1]; sheet.data[d+2] = c.d[s+2]; sheet.data[d+3] = 255;
  }
  for (let y = CELL; y < CELL + LAB; y++) for (let x = 0; x < CELL; x++) {
    const d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = 6; sheet.data[d+1] = 6; sheet.data[d+2] = 9; sheet.data[d+3] = 255;
  }
  drawText(sheet.data, sheet.width, sheet.height, c.label.toUpperCase(), ox + 6, oy + CELL + 5,
    c.ok ? [196, 186, 160] : [213, 87, 59], 1);
  if (i % COLS === 0) {
    wrap(prompts[Math.floor(i / COLS)], CELL * 2 - 12, 1).slice(0, 1).forEach(l =>
      drawText(sheet.data, sheet.width, sheet.height, l, ox + 6, oy + CELL + 17, [110, 118, 128], 1));
  }
});
writeFileSync(`${OUT}/bakeoff.png`, PNG.sync.write(sheet));
writeFileSync(`${OUT}/bakeoff.md`, [
  '| author | chains | mass | height | aggression | bravery | speed |',
  '|---|---|---|---|---|---|---|', ...rows,
].join('\n'));
console.log('\nfarm/out/bakeoff/bakeoff.png');
