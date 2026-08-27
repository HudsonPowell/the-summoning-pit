// Specimen sheet for PIT WIRE, rendered headless through the same capsule
// field the game uses. `npm run type` → farm/out/type.png
import { writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { PixelRenderer, Camera } from '../src/render';
import { Capsule } from '../src/pose';
import { WireText } from '../src/type/typeset';
import { drawText } from './font';

const W = 1600;
const BAND = 210;
const VOID: [number, number, number] = [9, 9, 13];

interface Band { label: string; text: string; blend: number; hand: number; gauge?: number }

const BANDS: Band[] = [
  { label: 'THE NAME, LOWERCASE', text: 'the summoning pit', blend: 2.6, hand: 1 },
  { label: 'THE NAME, CAPS', text: 'THE SUMMONING PIT', blend: 2.6, hand: 1 },
  { label: 'FIGURES — THE PLATE ITSELF, UNTOUCHED', text: '1234567890', blend: 0.4, hand: 1 },
  { label: 'a-m — EVERY STROKE CUT OFF THE PLATE', text: 'abcdefghijklm', blend: 0.4, hand: 1 },
  { label: 'n-z', text: 'nopqrstuvwxyz', blend: 0.4, hand: 1 },
  { label: 'A-M', text: 'ABCDEFGHIJKLM', blend: 0.4, hand: 1 },
  { label: 'N-Z', text: 'NOPQRSTUVWXYZ', blend: 0.4, hand: 1 },
  { label: "MARKS", text: "-.,:'!?", blend: 0.4, hand: 1 },
  { label: 'HAND 0 / 1 / 2.4', text: 'hammered', blend: 0.4, hand: 0 },
  { label: '', text: 'hammered', blend: 0.4, hand: 1 },
  { label: '', text: 'hammered', blend: 0.4, hand: 2.4 },
  { label: 'BLUR 0 / 2.2 / 5.5 — THE FIELD DOING THE WORK', text: 'pit', blend: 0, hand: 1 },
  { label: '', text: 'pit', blend: 2.2, hand: 1 },
  { label: '', text: 'pit', blend: 5.5, hand: 1 },
];

const r = new PixelRenderer(W, BAND);
const buf = new Uint8ClampedArray(W * BAND * 4);
mkdirSync('farm/out', { recursive: true });
const sheet = new PNG({ width: W, height: BAND * BANDS.length });

BANDS.forEach((b, i) => {
  const t = new WireText(b.text, { hand: b.hand, gauge: b.gauge ?? 0.078, align: 'centre', seed: 1740 });
  t.settle();
  const caps: Capsule[] = t.capsules();
  const ppm = Math.min(W * 0.82 / Math.max(0.5, t.width), BAND * 0.44);
  const cam: Camera = {
    yaw: 0, pitch: 0, ppm, cx: 0, cz: 0, cy: 0.44,
    floor: false, blend: b.blend, blendDepth: 0.5, blendMix: 1, blendShape: 0.62,
    voidColor: VOID,
  };
  r.render(buf, caps, cam, 0);
  const oy = i * BAND;
  for (let y = 0; y < BAND; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = ((oy + y) * W + x) * 4;
    sheet.data[d] = buf[s]; sheet.data[d + 1] = buf[s + 1];
    sheet.data[d + 2] = buf[s + 2]; sheet.data[d + 3] = 255;
  }
  if (b.label) drawText(sheet.data, W, sheet.height, b.label, 14, oy + 12, [92, 100, 116], 1);
  drawText(sheet.data, W, sheet.height,
    `${caps.length} CAPSULES`, W - 130, oy + 12, [70, 76, 90], 1);
});

writeFileSync('farm/out/type.png', PNG.sync.write(sheet));
console.log('farm/out/type.png');
