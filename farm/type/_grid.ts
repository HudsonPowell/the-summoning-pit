import { writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { PixelRenderer, Camera } from '../../src/render';
import { WireText } from '../../src/type/typeset';
import { drawText } from '../font';

const CH = (process.argv[2] ?? "abcdefghijklmnopqrstuvwxyz").split('');
const C = 200, R = 220, PER = 9;
const rows = Math.ceil(CH.length / PER);
const r = new PixelRenderer(C, R);
const buf = new Uint8ClampedArray(C * R * 4);
mkdirSync('farm/out', { recursive: true });
const sheet = new PNG({ width: C * PER, height: R * rows });

CH.forEach((ch, i) => {
  const t = new WireText(ch, { hand: 0, align: 'left', seed: 1 });
  t.settle();
  const ppm = 118;
  const cam: Camera = { yaw: 0, pitch: 0, ppm, cx: t.width / 2, cz: 0, cy: 0.42,
    floor: false, blend: 0.3, blendDepth: 0.5, blendMix: 1, blendShape: 0.6,
    voidColor: [10, 10, 14] };
  r.render(buf, t.capsules(), cam, 0);
  const ox = (i % PER) * C, oy = Math.floor(i / PER) * R;
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    const s = (y * C + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = buf[s]; sheet.data[d+1] = buf[s+1]; sheet.data[d+2] = buf[s+2]; sheet.data[d+3] = 255;
  }
  // baseline and x-height rules
  const line = (yEm: number, col: [number,number,number]) => {
    const py = Math.round(R / 2 - (yEm - 0.42) * ppm);
    if (py < 0 || py >= R) return;
    for (let x = 0; x < C; x += 3) {
      const d = ((oy + py) * sheet.width + ox + x) * 4;
      sheet.data[d] = col[0]; sheet.data[d+1] = col[1]; sheet.data[d+2] = col[2];
    }
  };
  line(0, [70, 60, 40]); line(0.70, [40, 55, 70]); line(1.0, [40, 55, 70]);
  drawText(sheet.data, sheet.width, sheet.height, ch === ' ' ? 'SP' : ch, ox + 6, oy + 6, [150,158,172], 1);
});
writeFileSync('farm/out/grid.png', PNG.sync.write(sheet));
console.log('farm/out/grid.png');
