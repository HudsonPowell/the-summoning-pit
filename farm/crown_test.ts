import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { defaultBiped, hound, heightOf, Genome } from '../src/genome';
import { makeCharacter } from '../src/character';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';
import { CROWN } from '../src/gear';

const W = 300, COLS = 2;
const r = new PixelRenderer(W, W);
const buf = new Uint8ClampedArray(W * W * 4);
const sheet = new PNG({ width: W * COLS, height: W });
[defaultBiped(), hound()].forEach((g: Genome, i) => {
  const ch = makeCharacter(g, 'beast');
  const caps = solvePose(g, { tired: 0, angry: 0 }, 0.22, 1, 0, undefined, 0,
    { weapon: ch.weapon, gear: [CROWN] as any });
  let reach = 0.2, minY = Infinity, maxY = -Infinity;
  for (const c of caps) for (const p of [c.a, c.b]) {
    reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
    minY = Math.min(minY, p.y - c.r); maxY = Math.max(maxY, p.y + c.r);
  }
  const cam: Camera = { yaw: 0.5, pitch: 0.16, ppm: (W * 0.85) / Math.max(reach * 2, maxY - minY),
    cy: (minY + maxY) / 2, floor: false, blend: 1.1, blendShape: 0.5, blendMix: 1, voidColor: [10, 8, 14] };
  r.render(buf, caps, cam, 0);
  const ox = i * W;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = (y * sheet.width + ox + x) * 4;
    sheet.data[d] = buf[s]; sheet.data[d+1] = buf[s+1]; sheet.data[d+2] = buf[s+2]; sheet.data[d+3] = 255;
  }
});
writeFileSync('farm/out/crown.png', PNG.sync.write(sheet));
console.log('farm/out/crown.png');
