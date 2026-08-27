// just the word "pit" big, before/after tuning the p
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { WireText } from '../src/type/typeset';
import { PixelRenderer, Camera } from '../src/render';
const W = 900, H = 460;
const r = new PixelRenderer(W, H);
const buf = new Uint8ClampedArray(W * H * 4);
const wire = new WireText('pit', { size: 1, baseline: 0.35, align: 'centre' });
wire.settle();
const caps = wire.frame().map(c => ({ ...c, a: { ...c.a, y: c.a.y }, b: { ...c.b, y: c.b.y } }));
const cam: Camera = { yaw: 0, pitch: 0, ppm: 240, cy: 0.75, cx: 0, floor: false,
  blend: 3.2, blendShape: 0.6, blendMix: 1, flat: true, voidColor: [10, 8, 14] };
r.render(buf, caps as any, cam, 0);
const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) { png.data[i*4]=buf[i*4]; png.data[i*4+1]=buf[i*4+1]; png.data[i*4+2]=buf[i*4+2]; png.data[i*4+3]=255; }
writeFileSync('farm/out/pit_word.png', PNG.sync.write(png));
console.log('farm/out/pit_word.png');
