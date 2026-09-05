// Three projectiles, drawn by the engine that draws the pit: a bolt, a
// fireball and a spell, each across its own launch, flight, impact and
// aftermath. node --import tsx farm/particles_preview.ts [out-dir]
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pitCam } from './social';
import { Motes, streak, muzzle, wake, impact, gather } from '../src/particles';
import { PixelRenderer } from '../src/render';
import { solvePose, Capsule } from '../src/pose';
import { defaultBiped, heightOf } from '../src/genome';
import { v3 } from '../src/vec';
import { drawText } from './font';

const out = resolve(process.argv[2] ?? 'farm/out/particles');
mkdirSync(out, { recursive: true });

const W = 260, H = 210, COLS = 8, BANNER = 46, LABEL = 20;
const renderer = new PixelRenderer(W, H);
const pixels = new Uint8ClampedArray(W * H * 4);
const dark: [number, number, number] = [0, 0, 0];

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// something to shoot at, for scale
const target = defaultBiped();
const targetH = heightOf(target);
const TARGET_X = 2.5;
const targetCaps = solvePose(target, { tired: 0, angry: 0 }, 0.2, 0, 1.4, undefined, 0, {})
  .map(c => ({ ...c, a: v3(c.a.x + TARGET_X, c.a.y, c.a.z), b: v3(c.b.x + TARGET_X, c.b.y, c.b.z) }));

interface Row { name: string; color: string; size: number; speed: number; boom: number; arc: boolean }
const ROWS: Row[] = [
  { name: 'BOLT — fast, flat, sparks', color: '#8fb8ff', size: 0.05, speed: 20, boom: 0, arc: false },
  { name: 'FIREBALL — lobbed, and it goes off', color: '#ff8a3a', size: 0.11, speed: 8.5, boom: 2.1, arc: true },
  { name: 'SPELL — slow, hanging, blooms', color: '#c9a0ff', size: 0.13, speed: 5.5, boom: 0, arc: false },
];

const ALL_ROWS = ROWS.length + 1;   // the three shots, and the draw that starts one
const sheet = new PNG({ width: W * COLS, height: (H + LABEL) * ALL_ROWS + BANNER });
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 10; sheet.data[i + 1] = 12; sheet.data[i + 2] = 16; sheet.data[i + 3] = 255;
}
drawText(sheet.data, sheet.width, sheet.height, 'PROJECTILES AND MOTES — ENGINE RENDERS', 18, 15, [223, 224, 213], 2);

ROWS.forEach((row, ri) => {
  const START = -3.4, Y0 = 0.95;
  const flight = (TARGET_X - 0.45 - START) / row.speed;
  const col = hex(row.color);
  // two in flight, one about to land, then the flash and what it leaves
  const shots = [
    flight * 0.10, flight * 0.45, flight * 0.88,
    flight + 0.03, flight + 0.12, flight + 0.34, flight + 0.80, flight + 1.60,
  ];

  const m = new Motes();
  const trail: { x: number; y: number; z: number }[] = [];
  let x = START, y = Y0, landed = false, shot = 0, peak = 0;
  const dt = 1 / 60;
  const total = flight + 1.7;

  for (let f = 0; f * dt <= total + 1e-9; f++) {
    const t = f * dt;
    if (f === 0) muzzle(m, START, Y0, 0, 1, 0, col, row.size);
    if (!landed) {
      const px = x, py = y;
      x += row.speed * dt;
      // a lobbed thing rises and falls; a bolt does not care about gravity
      if (row.arc) y = Y0 + Math.sin(Math.PI * ((x - START) / (TARGET_X - 0.45 - START))) * 0.55;
      if (f % 2 === 0) { trail.unshift({ x, y, z: 0 }); if (trail.length > 6) trail.pop(); }
      wake(m, x, y, 0, (x - px) / dt, (y - py) / dt, 0, col, row.size, dt);
      if (x >= TARGET_X - 0.45) {
        landed = true;
        impact(m, x, Math.max(0.08, y), 0, col, row.size, row.boom);
      }
    }
    m.step(dt, t);
    peak = Math.max(peak, m.count);

    if (shot < shots.length && t >= shots[shot]) {
      const caps: Capsule[] = [...targetCaps];
      if (!landed) streak(caps, x, y, 0, trail, col, row.size, dark);
      m.caps(caps, dark, t);
      renderer.render(pixels, caps, pitCam({
        ppm: (H * 0.52) / 2.1, yaw: 1.05, pitch: 0.3, cy: 0.85, cx: 0.1, cz: 0,
      }), 0);
      const ox = shot * W, oy = BANNER + ri * (H + LABEL);
      for (let py2 = 0; py2 < H; py2++) {
        sheet.data.set(pixels.subarray(py2 * W * 4, (py2 + 1) * W * 4), ((oy + py2) * sheet.width + ox) * 4);
      }
      drawText(sheet.data, sheet.width, sheet.height,
        `${(t - flight >= 0 ? '+' : '')}${(t - flight).toFixed(2)}s`,
        ox + 8, oy + H + 6, [110, 118, 128], 1);
      shot++;
    }
  }
  drawText(sheet.data, sheet.width, sheet.height, row.name, 8, BANNER + ri * (H + LABEL) - 12, [180, 186, 196], 1);
  console.log(`${row.name.padEnd(38)} peak motes ${peak}`);
});

// --- and the draw that comes before one -------------------------------------
// ANTICIPATION is the only effect here that is a promise rather than a report,
// so it gets its own row: motes falling inward out of the dark and collecting
// at the hand, the flash as it lets go, and the bolt already leaving.
{
  const ri = ROWS.length;
  const color = hex('#7fd4c1'), size = 0.09, WIND = 0.8, speed = 11;
  const caster = defaultBiped();
  const CAST_X = -2.7;
  const casterCaps = solvePose(caster, { tired: 0, angry: 0 }, 0.2, 0, 1.2, undefined, 0, {})
    .map(c => ({ ...c, a: v3(c.a.x + CAST_X, c.a.y, c.a.z), b: v3(c.b.x + CAST_X, c.b.y, c.b.z) }));
  // the weapon hand, read back off the drawn body — the same move the pit makes
  let hand = { x: CAST_X, y: 0.9, z: 0 };
  for (let i = casterCaps.length - 1; i >= 0; i--) {
    if (casterCaps[i].part === 'hand') { hand = casterCaps[i].a; break; }
  }

  const flight = (TARGET_X - 0.45 - hand.x) / speed;
  const shots = [
    WIND * 0.18, WIND * 0.58, WIND * 0.94,
    WIND + 0.04, WIND + 0.14, WIND + flight * 0.65,
    WIND + flight + 0.05, WIND + flight + 0.75,
  ];
  const m = new Motes();
  const trail: { x: number; y: number; z: number }[] = [];
  let x = hand.x, shot = 0, peak = 0, gone = false;
  const dt = 1 / 60;

  for (let f = 0; f * dt <= WIND + flight + 1.0; f++) {
    const t = f * dt;
    if (t < WIND) {
      gather(m, hand.x, hand.y, hand.z, color, 0.1 + size * 1.4, t / WIND, dt);
    } else if (!gone) {
      gone = true;
      muzzle(m, hand.x, hand.y, hand.z, 1, 0, color, size);
    } else if (x < TARGET_X - 0.45) {
      const px = x;
      x += speed * dt;
      if (f % 2 === 0) { trail.unshift({ x, y: hand.y, z: 0 }); if (trail.length > 6) trail.pop(); }
      wake(m, x, hand.y, 0, (x - px) / dt, 0, 0, color, size, dt);
      if (x >= TARGET_X - 0.45) impact(m, x, hand.y, 0, color, size, 0);
    }
    m.step(dt, t);
    peak = Math.max(peak, m.count);

    if (shot < shots.length && t >= shots[shot]) {
      const caps: Capsule[] = [...casterCaps, ...targetCaps];
      if (gone && x > hand.x && x < TARGET_X - 0.45) streak(caps, x, hand.y, 0, trail, color, size, dark);
      m.caps(caps, dark, t);
      renderer.render(pixels, caps, pitCam({
        ppm: (H * 0.52) / 2.6, yaw: 1.05, pitch: 0.3, cy: 0.85, cx: -0.2, cz: 0,
      }), 0);
      const ox = shot * W, oy = BANNER + ri * (H + LABEL);
      for (let py2 = 0; py2 < H; py2++) {
        sheet.data.set(pixels.subarray(py2 * W * 4, (py2 + 1) * W * 4), ((oy + py2) * sheet.width + ox) * 4);
      }
      drawText(sheet.data, sheet.width, sheet.height,
        `${(t - WIND >= 0 ? '+' : '')}${(t - WIND).toFixed(2)}s`,
        ox + 8, oy + H + 6, [110, 118, 128], 1);
      shot++;
    }
  }
  drawText(sheet.data, sheet.width, sheet.height,
    'THE DRAW — motes gather, then it lets go', 8, BANNER + ri * (H + LABEL) - 12, [180, 186, 196], 1);
  console.log(`${'THE DRAW — gather then release'.padEnd(38)} peak motes ${peak}`);
}

writeFileSync(resolve(out, 'projectiles.png'), PNG.sync.write(sheet));
console.log(resolve(out, 'projectiles.png'));
