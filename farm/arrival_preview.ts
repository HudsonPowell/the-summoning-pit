// A creature arriving: drawn out of nothing in the order a body is built.
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pitCam } from './social';
import { Motes, gather } from '../src/particles';
import { gearFromWords } from '../src/gear';
import { weaponsFromWords } from '../src/smith';
import { defaultBiped, heightOf } from '../src/genome';
import { solvePose, Capsule } from '../src/pose';
import { PixelRenderer } from '../src/render';
import { drawText } from './font';

const out = resolve(process.argv[2] ?? 'farm/out/arrival'); mkdirSync(out, { recursive: true });
const W = 230, H = 290, BANNER = 44, COLS = 8;
const r = new PixelRenderer(W, H);
const px = new Uint8ClampedArray(W * H * 4);
const BUILD: Record<string, number> = {
  body: 0, neck: 0.16, skull: 0.2, head: 0.22, thigh: 0.34, shin: 0.38, foot: 0.44,
  upperArm: 0.5, forearm: 0.54, hand: 0.6, tail: 0.62, wing: 0.62, horn: 0.66,
  fin: 0.66, spike: 0.66, tentacle: 0.66, gear: 0.76, weapon: 0.86, blade: 0.86, scar: 0.94,
};
const ARRIVING = 1.35;
const g = defaultBiped();
const gear = gearFromWords('a hooded knight in plate with a cloak');
const weapon = weaponsFromWords('a longsword').main;
const h = heightOf(g);
const accent: [number, number, number] = [201, 160, 255];

const sheet = new PNG({ width: W * COLS, height: H + BANNER });
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 9; sheet.data[i + 1] = 11; sheet.data[i + 2] = 15; sheet.data[i + 3] = 255;
}
drawText(sheet.data, sheet.width, sheet.height, 'A CREATURE ARRIVING', 16, 14, [223, 224, 213], 2);

const m = new Motes();
let col = 0;
const shots = [0.02, 0.2, 0.36, 0.52, 0.68, 0.84, 1.0, 1.45];
for (let f = 0; f * (1 / 60) <= 1.6 && col < COLS; f++) {
  const t = f / 60, u = t / ARRIVING;
  if (u < 1.05) gather(m, 0, h * 0.5, 0, accent, h * 0.85, Math.min(1, u), 1 / 60);
  m.step(1 / 60, t);
  if (t < shots[col]) continue;
  const full = solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, 1.4, undefined, 0, { gear, weapon, scars: 3 });
  const caps: Capsule[] = [];
  if (u < 1) {
    full.forEach((c, i) => {
      const at = (BUILD[c.part] ?? 0.7) + ((i * 37) % 11) * 0.006;
      const k = Math.max(0, Math.min(1, (u - at) / 0.2));
      if (k > 0.01) caps.push(k >= 1 ? c : { ...c, r: c.r * k * k });
    });
  } else caps.push(...full);
  m.caps(caps, [0, 0, 0], t);
  r.render(px, caps, pitCam({ ppm: (H * 0.4) / Math.max(0.9, h), yaw: 0.85, pitch: 0.22, cy: h * 0.52 }), 0);
  const ox = col * W;
  for (let y = 0; y < H; y++) sheet.data.set(px.subarray(y * W * 4, (y + 1) * W * 4), ((BANNER + y) * sheet.width + ox) * 4);
  drawText(sheet.data, sheet.width, sheet.height, `${t.toFixed(2)}s  ${caps.length} parts`, ox + 7, BANNER + H - 12, [110, 118, 128], 1);
  col++;
}
writeFileSync(resolve(out, 'arrival.png'), PNG.sync.write(sheet));
console.log(resolve(out, 'arrival.png'));
