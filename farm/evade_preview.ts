// The three ways out of the way. node --import tsx farm/evade_preview.ts [dir]
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pitCam } from './social';
import { gearFromWords } from '../src/gear';
import { weaponsFromWords } from '../src/smith';
import { defaultBiped, heightOf } from '../src/genome';
import { solvePose, Capsule } from '../src/pose';
import { PixelRenderer } from '../src/render';
import { v3 } from '../src/vec';
import { drawText } from './font';

const out = resolve(process.argv[2] ?? 'farm/out/evade'); mkdirSync(out, { recursive: true });
const W = 220, H = 260, COLS = 6, BANNER = 44, LABEL = 20;
const r = new PixelRenderer(W, H);
const px = new Uint8ClampedArray(W * H * 4);
const g = defaultBiped();
const h = heightOf(g);
const gear = gearFromWords('a hooded fighter in a cloak');
const weapon = weaponsFromWords('a sword').main;

const KINDS = ['duck', 'jump', 'dodge'] as const;
const sheet = new PNG({ width: W * COLS, height: (H + LABEL) * KINDS.length + BANNER });
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 9; sheet.data[i+1] = 11; sheet.data[i+2] = 15; sheet.data[i+3] = 255;
}
drawText(sheet.data, sheet.width, sheet.height, 'GETTING OUT OF THE WAY', 16, 14, [223,224,213], 2);

KINDS.forEach((kind, row) => {
  for (let col = 0; col < COLS; col++) {
    const evadeT = (col / (COLS - 1)) * 0.5;
    const u = Math.min(1, evadeT / 0.5);
    const arc = Math.sin(Math.PI * Math.pow(u, 0.7));
    const duck = kind === 'duck' ? arc * 0.5 : 0;
    const hop = kind === 'jump' ? arc * 0.42 : 0;
    const slip = kind === 'dodge' ? arc : 0;
    const caps = solvePose(g, { tired: 0, angry: 0 }, 0.25, 0.15, 2, undefined,
      Math.min(0.9, duck), { gear, weapon, lean: slip * 0.5 })
      .map(c => ({ ...c,
        a: v3(c.a.x, c.a.y + hop, c.a.z + slip * 0.55),
        b: v3(c.b.x, c.b.y + hop, c.b.z + slip * 0.55) }));
    r.render(px, caps, pitCam({ ppm: (H * 0.36) / Math.max(0.9, h), yaw: 0.9, pitch: 0.2, cy: h * 0.5 }), 0);
    const ox = col * W, oy = BANNER + row * (H + LABEL);
    for (let y = 0; y < H; y++) sheet.data.set(px.subarray(y*W*4,(y+1)*W*4), ((oy+y)*sheet.width + ox)*4);
    drawText(sheet.data, sheet.width, sheet.height,
      col === 0 ? kind.toUpperCase() : `${evadeT.toFixed(2)}s`, ox + 8, oy + H + 6, [110,118,128], 1);
  }
});
writeFileSync(resolve(out, 'evade.png'), PNG.sync.write(sheet));
console.log(resolve(out, 'evade.png'));
