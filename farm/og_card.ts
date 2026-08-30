// The social card, drawn by the pit's own hand: the wire title on the dark,
// 1200x630, written to public/og.png. Run once per rebrand, committed.
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { WireText } from '../src/type/typeset';
import { PixelRenderer, Camera } from '../src/render';

const W = 1200, H = 630;
const r = new PixelRenderer(W, H);
const buf = new Uint8ClampedArray(W * H * 4);

const EARTH: [number, number, number][] = [
  [146, 112, 78], [104, 84, 64], [156, 146, 132], [88, 80, 70], [58, 52, 46],
];
const line1 = new WireText('the summoning', { size: 1, baseline: 1.6, align: 'centre', inks: EARTH });
const line2 = new WireText('pit', { size: 1, baseline: 0.35, align: 'centre', inks: EARTH });
line1.settle(); line2.settle();
const caps = [...line1.frame(), ...line2.frame()];

const cam: Camera = {
  yaw: 0, pitch: 0, ppm: 116, cy: 1.32, cx: 0, floor: false,
  blend: 3.0, blendShape: 0.6, blendMix: 1, flat: true, voidColor: [8, 9, 12],
};
r.render(buf, caps as any, cam, 0);

const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) {
  png.data[i * 4] = buf[i * 4];
  png.data[i * 4 + 1] = buf[i * 4 + 1];
  png.data[i * 4 + 2] = buf[i * 4 + 2];
  png.data[i * 4 + 3] = 255;
}
writeFileSync('public/og.png', PNG.sync.write(png));
console.log('public/og.png written');

// the touch icon: just the p, square, same hand
const W2 = 180, H2 = 180;
const r2 = new PixelRenderer(W2, H2);
const buf2 = new Uint8ClampedArray(W2 * H2 * 4);
const pWord = new WireText('p', { size: 1, baseline: 0.3, align: 'centre', inks: EARTH });
pWord.settle();
const cam2: Camera = {
  yaw: 0, pitch: 0, ppm: 110, cy: 0.72, cx: 0, floor: false,
  blend: 3.0, blendShape: 0.6, blendMix: 1, flat: true, voidColor: [8, 9, 12],
};
r2.render(buf2, pWord.frame() as any, cam2, 0);
const png2 = new PNG({ width: W2, height: H2 });
for (let i = 0; i < W2 * H2; i++) {
  png2.data[i * 4] = buf2[i * 4];
  png2.data[i * 4 + 1] = buf2[i * 4 + 1];
  png2.data[i * 4 + 2] = buf2[i * 4 + 2];
  png2.data[i * 4 + 3] = 255;
}
writeFileSync('public/icon-180.png', PNG.sync.write(png2));
console.log('public/icon-180.png written');
