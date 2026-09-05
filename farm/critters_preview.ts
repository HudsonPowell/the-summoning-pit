// What the wildlife actually looks like on the pit floor, at pit zoom.
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pitCam } from './social';
import { Critters, Threat } from '../src/critters';
import { PixelRenderer } from '../src/render';
import { solvePose, Capsule } from '../src/pose';
import { defaultBiped } from '../src/genome';
import { v3 } from '../src/vec';
import { drawText } from './font';

const out = resolve(process.argv[2] ?? 'farm/out/critters'); mkdirSync(out, { recursive: true });
const W = 300, H = 230, COLS = 5, BANNER = 44, ROWS = 2;
const r = new PixelRenderer(W, H);
const px = new Uint8ClampedArray(W * H * 4);

const who = defaultBiped();
const body = (x: number, z: number) => solvePose(who, { tired: 0, angry: 0 }, 0.2, 0, 1.3, undefined, 0, {})
  .map(c => ({ ...c, a: v3(c.a.x + x, c.a.y, c.a.z + z), b: v3(c.b.x + x, c.b.y, c.b.z + z) }));
const standing: Threat[] = [{ x: 0.9, z: 0.4, bulk: 1.6, deadT: -1 }];

const c = new Critters();
const sheet = new PNG({ width: W * COLS, height: H * ROWS + BANNER });
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 10; sheet.data[i + 1] = 12; sheet.data[i + 2] = 16; sheet.data[i + 3] = 255;
}
drawText(sheet.data, sheet.width, sheet.height, 'THE PIT HAS WILDLIFE — RATS, BEETLES, ANTS', 16, 14, [223, 224, 213], 2);

// run until there is something to look at, then follow it
let shots = 0, t = 0;
for (let f = 0; f < 60 * 60 * 30 && shots < COLS; f++) {
  c.step(1 / 30, standing); t += 1 / 30;
  const live = c.snapshot();
  if (!live.length) continue;
  if (f % 90) continue;
  // frame on whatever is closest to the middle of the pit
  const lead = live.reduce((a, b) => (Math.hypot(a.x, a.z) < Math.hypot(b.x, b.z) ? a : b));
  const caps: Capsule[] = [...body(0.9, 0.4)];
  c.caps(caps, t);
  const ox = shots * W;
  // top: how the pit actually sees it. bottom: close enough to judge it.
  [[90, 1.0], [300, 0.24]].forEach(([ppm, cy], row) => {
    r.render(px, caps, pitCam({ ppm, yaw: 0.7, pitch: 0.33, cy, cx: lead.x, cz: lead.z }), 0);
    const oy = BANNER + row * H;
    for (let y = 0; y < H; y++) sheet.data.set(px.subarray(y * W * 4, (y + 1) * W * 4), ((oy + y) * sheet.width + ox) * 4);
  });
  drawText(sheet.data, sheet.width, sheet.height,
    `${lead.kind}  ${t.toFixed(0)}s  ${live.length} alive`, ox + 8, BANNER + H - 12, [120, 128, 138], 1);
  shots++;
}
writeFileSync(resolve(out, 'critters.png'), PNG.sync.write(sheet));
console.log(resolve(out, 'critters.png'));
