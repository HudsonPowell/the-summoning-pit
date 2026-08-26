import { writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { makeProp, PropKind } from '../src/props';
import { PixelRenderer, Camera } from '../src/render';
import { drawText } from './font';

const KINDS: PropKind[] = ['rock', 'boulder', 'fern', 'fungus', 'shard', 'bones', 'stump'];
const W = 210, H = 210, LAB = 14, COLS = 7, ROWS = 3;
const r = new PixelRenderer(W, H);
const buf = new Uint8ClampedArray(W * H * 4);
mkdirSync('farm/out', { recursive: true });
const sheet = new PNG({ width: W * COLS, height: (H + LAB) * ROWS });

for (let row = 0; row < ROWS; row++) {
  KINDS.forEach((kind, i) => {
    const caps = makeProp(kind, 100 + row * 31 + i * 977);
    const cam: Camera = { yaw: 0.55, pitch: 0.26, ppm: W * 0.55, cx: 0, cz: 0, cy: 0.28,
      floor: false, blend: 1.0, blendShape: 0.5, blendMix: 1, voidColor: [11, 10, 14] };
    r.render(buf, caps, cam, 0);
    const ox = i * W, oy = row * (H + LAB);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data[d] = buf[s]; sheet.data[d+1] = buf[s+1]; sheet.data[d+2] = buf[s+2]; sheet.data[d+3] = 255;
    }
    for (let y = H; y < H + LAB; y++) for (let x = 0; x < W; x++) {
      const d = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data[d] = 6; sheet.data[d+1] = 6; sheet.data[d+2] = 9; sheet.data[d+3] = 255;
    }
    if (row === 0) drawText(sheet.data, sheet.width, sheet.height, kind.toUpperCase(), ox + 5, oy + H + 4, [150, 160, 172], 1);
  });
}
writeFileSync('farm/out/props.png', PNG.sync.write(sheet));
console.log('farm/out/props.png');
