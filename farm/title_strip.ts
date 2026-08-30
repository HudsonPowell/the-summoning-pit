// The title's arrival and death, laid out as frames — the only way to SEE
// whether the letters vary or merely claim to. Each row is one fresh load:
// the same word, a different manner of arriving and of leaving.
//   npx tsx farm/title_strip.ts [rows]
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { WireTitle } from '../src/void/wiretitle';
import { PixelRenderer, Camera } from '../src/render';

const ROWS = Number(process.argv[2] ?? 3);
const W = 260, H = 150;
// seconds into the title's life to sample: through the arrival, the hold,
// then through the fall
const SHOTS = [0.5, 1.2, 1.9, 2.6, 3.4, 4.6, 6.6, 7.3, 8.0, 8.7];
const DT = 1 / 60;

mkdirSync('farm/out', { recursive: true });
const r = new PixelRenderer(W, H);
const buf = new Uint8ClampedArray(W * H * 4);
const sheet = new PNG({ width: W * SHOTS.length, height: H * ROWS });

for (let row = 0; row < ROWS; row++) {
  const title = new WireTitle('the summoning pit', 12);
  const cam: Camera = {
    yaw: 0.6, pitch: 0.34, ppm: (H * 0.46) / 4.4 * 2.2, cy: 1.6, cx: 0, cz: 0,
    // the pit's own ground is near-black and the title's inks are old iron;
    // the contact sheet lifts the ground so the letters read on a bright screen
    floor: false, blend: 1.8, blendShape: 0.6, blendMix: 1, voidColor: [30, 27, 36],
  };
  let t = 0, shot = 0;
  while (shot < SHOTS.length) {
    const caps = title.caps(DT, cam.yaw);
    t += DT;
    if (t >= SHOTS[shot]) {
      r.render(buf, caps, cam, 0);
      const ox = shot * W, oy = row * H;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
        sheet.data[d] = buf[s]; sheet.data[d + 1] = buf[s + 1]; sheet.data[d + 2] = buf[s + 2]; sheet.data[d + 3] = 255;
      }
      shot++;
    }
    if (t > 14) break;   // it should be long done; do not spin forever
  }
  // the seed is the clock, so a row needs a moment of its own
  const until = Date.now() + 25;
  while (Date.now() < until) { /* let the clock move */ }
}
writeFileSync('farm/out/title_strip.png', PNG.sync.write(sheet));
console.log(`farm/out/title_strip.png — ${ROWS} loads x ${SHOTS.length} moments (${SHOTS.join('s, ')}s)`);
