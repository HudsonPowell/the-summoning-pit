// `blend` is in PIXELS, so the same number is a different LOOK at a different
// resolution. This finds the world-space softness that matches the pit.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { migrateGenome } from '../src/genome';
import { makeCharacter } from '../src/character';
import { solvePose, Capsule } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const g = migrateGenome(JSON.parse(readFileSync('genomes/grezaan-tall.json', 'utf8')));
const ch = makeCharacter(g, 'beast');
const caps: Capsule[] = solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, 1.2, undefined, 0,
  { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any });
let reach = 0.2, minY = Infinity, maxY = -Infinity;
for (const c of caps) for (const p of [c.a, c.b] as any[]) {
  reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
  minY = Math.min(minY, p.y - c.r); maxY = Math.max(maxY, p.y + c.r);
}
const tall = maxY - minY;
const cam = (ppm: number, blend: number): Camera => ({
  yaw: 0.6, pitch: 0.34, ppm, cy: (minY + maxY) / 2, cx: 0, cz: 0, tile: 1, flat: true,
  blend, blendShape: 0.6, blendMix: 1, blendDepth: 0.35, floor: false, voidColor: [0, 0, 0],
});
const S = 420;
// every panel shows the creature at the same SIZE; only the pixel density and
// the blend differ, which is exactly the thing being judged
const REF_PPM = (S * 0.8) / tall * 0.25;       // the pit's own coarse buffer
const ASSET_PPM = (S * 0.8) / tall;
const panels: [string, number, number][] = [
  ['the pit (coarse buffer)', REF_PPM, 1.8],
  ['asset, blend 1.8px', ASSET_PPM, 1.8],
  ['asset, 0.018 m', ASSET_PPM, ASSET_PPM * 0.018],
  ['asset, 0.026 m', ASSET_PPM, ASSET_PPM * 0.026],
  ['asset, 0.034 m', ASSET_PPM, ASSET_PPM * 0.034],
];
const sheet = new PNG({ width: S * panels.length, height: S });
panels.forEach(([tag, ppm, blend], i) => {
  const small = Math.max(40, Math.round(S * ppm / ASSET_PPM));
  const rr = new PixelRenderer(small, small);
  const b2 = new Uint8ClampedArray(small * small * 4);
  rr.render(b2, caps, cam(ppm, blend), 0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const sx = Math.floor(x * small / S), sy = Math.floor(y * small / S);
    const s = (sy * small + sx) * 4, d = (y * sheet.width + i * S + x) * 4;
    sheet.data[d] = b2[s]; sheet.data[d+1] = b2[s+1]; sheet.data[d+2] = b2[s+2]; sheet.data[d+3] = 255;
  }
  console.log(`${tag}  ppm ${ppm.toFixed(0)} blend ${blend.toFixed(1)}px`);
});
mkdirSync('farm/out/social', { recursive: true });
writeFileSync('farm/out/social/blend_compare.png', PNG.sync.write(sheet));
