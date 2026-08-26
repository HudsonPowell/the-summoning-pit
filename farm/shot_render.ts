// A frame with something in flight.
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { makeCharacter, styleFor } from '../src/character';
import { defaultBiped, hound } from '../src/genome';
import { createVoid, stepVoid, makeAgent } from '../src/void/sim';
import { solvePose, slashWeight, Capsule } from '../src/pose';
import { rotY, v3 } from '../src/vec';
import { PixelRenderer, Camera } from '../src/render';

const ag = defaultBiped(); ag.name = 'archer';
const archer = makeCharacter(ag, 'hero');
archer.weapon = { name: 'longbow', parts: [{ a: [0,-0.32,0], b: [0,0.32,0], r: 0.022, color: '#8a6d3f' }] };
Object.assign(archer.behaviors, {
  'attack-light': { type: 'strike', strike: styleFor('longbow', true, false).light },
});
const sim = createVoid([archer, makeCharacter(hound(), 'beast')], 0);
sim.peace = 0;
const a = makeAgent(archer, -3.2, 0.4);
const b = makeAgent(makeCharacter(hound(), 'beast'), 2.6, -0.3);
sim.agents.push(a, b);

// run until something is in the air, mid-flight
let guard = 0;
while ((sim.shots.length === 0 || sim.shots[0].trail.length < 4) && guard++ < 60 * 30) stepVoid(sim, 1/60);

const W = 620, H = 300;
const renderer = new PixelRenderer(W, H);
const buf = new Uint8ClampedArray(W * H * 4);
const caps: Capsule[] = [];
for (const ag2 of sim.agents) {
  const local = solvePose(ag2.genome, { tired: 0, angry: 0.6 }, ag2.phase, ag2.move, ag2.idleT,
    ag2.strikeT >= 0 ? { slash: { t: Math.min(1, ag2.strikeT / 0.6), weight: slashWeight(Math.min(1, ag2.strikeT / 0.6)),
      spec: (ag2.ch.behaviors['attack-light'] as any).strike } } : undefined, 0, { weapon: ag2.ch.weapon });
  for (const c of local) {
    const p = rotY(c.a, -ag2.heading), q = rotY(c.b, -ag2.heading);
    caps.push({ ...c, a: v3(p.x + ag2.x, p.y, p.z + ag2.z), b: v3(q.x + ag2.x, q.y, q.z + ag2.z) });
  }
}
for (const s of sim.shots) {
  const col: [number, number, number] = [143, 214, 255];
  caps.push({ a: v3(s.x, s.y, s.z), b: v3(s.x, s.y, s.z), r: s.spec.size, color: col, part: 'shot' });
  s.trail.forEach((t, i) => {
    const f = 1 - (i + 1) / (s.trail.length + 1);
    caps.push({ a: v3(t.x, t.y, t.z), b: v3(t.x, t.y, t.z), r: s.spec.size * (0.85*f+0.15),
      color: [col[0]*f, col[1]*f, col[2]*f], part: 'trail' });
  });
}
// frame whatever is actually happening
const pts = [...sim.agents.map(o => ({ x: o.x, z: o.z })), ...sim.shots.map(o => ({ x: o.x, z: o.z }))];
const cx = pts.reduce((s2, p2) => s2 + p2.x, 0) / pts.length;
const cz = pts.reduce((s2, p2) => s2 + p2.z, 0) / pts.length;
const spread = Math.max(...pts.map(p2 => Math.hypot(p2.x - cx, p2.z - cz)), 1);
const cam: Camera = { yaw: 0.25, pitch: 0.3, ppm: (W * 0.42) / (spread * 2), cy: 0.85, cx, cz,
  floorRadius: 9, floorPower: 2.4, floorLift: 1, tile: 1, floorSquash: Math.sin(0.3),
  voidColor: [0,0,0], floorColorA: [42,47,58], floorColorB: [34,39,50],
  blend: 1.2, blendShape: 0.5, blendMix: 1 };
renderer.render(buf, caps, cam, 0);
const png = new PNG({ width: W, height: H });
for (let i = 0; i < W*H*4; i++) png.data[i] = buf[i];
writeFileSync('farm/out/shot.png', PNG.sync.write(png));
console.log('shots in flight:', sim.shots.length, '- farm/out/shot.png');
