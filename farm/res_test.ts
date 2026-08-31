// Three ways to reach 1080 wide, side by side, so the choice is made by eye.
//   A  native buffer, nearest-neighbour upscale  (the pit's own look, crisp)
//   B  rendered straight at 1080                 (fine detail, softer read)
//   C  rendered at 2160 and averaged down        (anti-aliased, smoothest)
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { hound } from '../src/genome';
import { makeCharacter } from '../src/character';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const OUT = 'farm/out/social';
mkdirSync(OUT, { recursive: true });

const g = JSON.parse(JSON.stringify(hound()));
const ch = makeCharacter(g, 'beast');
const caps = solvePose(g, { tired: 0, angry: 0 }, 0.22, 1, 0, undefined, 0,
  { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any });

const TILE = 360;                       // each panel, square
function shot(w: number, h: number, ppm: number): Uint8ClampedArray {
  const r = new PixelRenderer(w, h);
  const buf = new Uint8ClampedArray(w * h * 4);
  const cam: Camera = {
    yaw: 0.6, pitch: 0.2, ppm, cy: 0.62, cx: 0, cz: 0,
    floor: false, blend: 1.6, blendShape: 0.6, blendMix: 1, voidColor: [10, 8, 14],
  };
  r.render(buf, caps, cam, 0);
  return buf;
}
const near = (src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number) => {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const s = ((y * sh / dh | 0) * sw + (x * sw / dw | 0)) * 4, d = (y * dw + x) * 4;
    out[d] = src[s]; out[d+1] = src[s+1]; out[d+2] = src[s+2]; out[d+3] = 255;
  }
  return out;
};
const box = (src: Uint8ClampedArray, sw: number, sh: number, k: number) => {
  const dw = sw / k | 0, dh = sh / k | 0;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    let r = 0, g2 = 0, b = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      const s = ((y * k + j) * sw + x * k + i) * 4;
      r += src[s]; g2 += src[s+1]; b += src[s+2];
    }
    const n = k * k, d = (y * dw + x) * 4;
    out[d] = r / n; out[d+1] = g2 / n; out[d+2] = b / n; out[d+3] = 255;
  }
  return out;
};

const PPM = TILE * 0.42;                       // same framing in all three
const a = near(shot(90, 90, PPM * 90 / TILE), 90, 90, TILE, TILE);   // 4x upscale
const b = shot(TILE, TILE, PPM);
const c = box(shot(TILE * 2, TILE * 2, PPM * 2), TILE * 2, TILE * 2, 2);

const sheet = new PNG({ width: TILE * 3, height: TILE });
[a, b, c].forEach((src, i) => {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const s = (y * TILE + x) * 4, d = (y * sheet.width + i * TILE + x) * 4;
    sheet.data[d] = src[s]; sheet.data[d+1] = src[s+1]; sheet.data[d+2] = src[s+2]; sheet.data[d+3] = 255;
  }
});
writeFileSync(`${OUT}/res_compare.png`, PNG.sync.write(sheet));
console.log(`${OUT}/res_compare.png  —  A native+nearest | B direct | C supersampled`);
