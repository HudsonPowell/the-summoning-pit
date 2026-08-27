// Watch two things fight, frame by frame. Numbers do not tell you that a swing
// is boring; a strip of frames does.

import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createVoid, stepVoid, spawnChar, strikeSpecOf, VoidSim, Agent } from '../src/void/sim';
import { makeCharacter } from '../src/character';
import { solvePose, slashWeight, Capsule, Intent } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';
import { rotY, v3 } from '../src/vec';
import { drawText } from './font';
import * as G from '../src/genome';

const W = 190, H = 190, COLS = 10, LABEL = 14;
const OUT = 'farm/out/fight';
mkdirSync(OUT, { recursive: true });

const which = (process.argv[2] ?? 'ogre') as keyof typeof G;
const other = (process.argv[3] ?? 'hound') as keyof typeof G;

const sim: VoidSim = createVoid([], 0);
const a = spawnChar(sim, makeCharacter((G as any)[which]()), 'A');
const b = spawnChar(sim, makeCharacter((G as any)[other]()), 'B');
a.x = -0.9; a.z = 0; b.x = 0.9; b.z = 0;
a.hp = a.maxHp = 99; b.hp = b.maxHp = 99;

function caps(ag: Agent): Capsule[] {
  let intent: Intent | undefined;
  if (ag.strikeT >= 0) {
    const spec = strikeSpecOf(ag);
    const u = Math.min(1, ag.strikeT / (spec?.duration ?? 0.5));
    intent = { slash: { t: u, weight: slashWeight(u), spec } };
  }
  const cs = solvePose(ag.genome, { tired: 0, angry: 0 }, ag.phase, ag.move, ag.idleT, intent,
    ag.deadT >= 0 ? Math.min(1, ag.deadT / 0.5) : ag.rest * 0.72,
    { weapon: ag.ch.weapon, offhand: ag.ch.offhand, turn: ag.turnRate,
      lookYaw: Math.max(-0.9, Math.min(0.9, ag.sec.head)),
      lean: ag.sec.lean, twist: ag.sec.twist, bob: ag.sec.bob, jiggle: ag.sec.jiggle });
  const yaw = -(ag.heading + ag.sec.spin);
  return cs.map(c => ({ ...c,
    a: v3(rotY(c.a, yaw).x + ag.x, rotY(c.a, yaw).y, rotY(c.a, yaw).z + ag.z),
    b: v3(rotY(c.b, yaw).x + ag.x, rotY(c.b, yaw).y, rotY(c.b, yaw).z + ag.z) }));
}

const r = new PixelRenderer(W, H);
const buf = new Uint8ClampedArray(W * H * 4);
const frames: { d: Uint8ClampedArray; tag: string }[] = [];

// run until we catch a strike, then grab every other frame through it
let grabbing = 0, tag = '';
for (let i = 0; i < 60 * 90 && frames.length < COLS * 4; i++) {
  a.target = b; b.target = a;
  if (a.state !== 'fight') { a.state = 'fight'; a.stateT = 1; }
  if (b.state !== 'fight') { b.state = 'fight'; b.stateT = 1; }
  stepVoid(sim, 1 / 60);
  for (const e of sim.events) {
    if (e.kind === 'strike' && grabbing <= 0) {
      grabbing = 44;
      tag = `${e.actor?.name?.split(' ')[0] ?? '?'} ${e.how ?? ''}`;
    }
  }
  if (grabbing > 0) {
    grabbing--;
    if (grabbing % 4 === 0) {
      const cs = [...caps(a), ...caps(b)];
      const cam: Camera = { yaw: 0.62, pitch: 0.2, ppm: W * 0.3, cx: 0, cz: 0, cy: 0.85,
        floor: false, blend: 1.0, blendShape: 0.5, blendMix: 1, voidColor: [10, 8, 14] };
      r.render(buf, cs, cam, 0);
      frames.push({ d: new Uint8ClampedArray(buf), tag: frames.length % COLS === 0 ? tag : '' });
    }
  }
}

const rows = Math.ceil(frames.length / COLS);
const sheet = new PNG({ width: W * COLS, height: (H + LABEL) * rows });
frames.forEach((f, i) => {
  const ox = (i % COLS) * W, oy = Math.floor(i / COLS) * (H + LABEL);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = f.d[s]; sheet.data[d+1] = f.d[s+1]; sheet.data[d+2] = f.d[s+2]; sheet.data[d+3] = 255;
  }
  for (let y = H; y < H + LABEL; y++) for (let x = 0; x < W; x++) {
    const d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = 6; sheet.data[d+1] = 6; sheet.data[d+2] = 9; sheet.data[d+3] = 255;
  }
  if (f.tag) drawText(sheet.data, sheet.width, sheet.height, f.tag.toUpperCase().slice(0, 30), ox + 4, oy + H + 4, [150, 160, 172], 1);
});
writeFileSync(`${OUT}/${which}-v-${other}.png`, PNG.sync.write(sheet));
console.log(`${frames.length} frames → ${OUT}/${which}-v-${other}.png`);
