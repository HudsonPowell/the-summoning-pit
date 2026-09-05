// The pit through a day, and through weather. node --import tsx farm/weather_preview.ts [dir]
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pitCam } from './social';
import { conditionsAt, rainCaps } from '../src/conditions';
import { gearFromWords } from '../src/gear';
import { defaultBiped, heightOf } from '../src/genome';
import { solvePose, Capsule } from '../src/pose';
import { scatterProps } from '../src/props';
import { PixelRenderer } from '../src/render';
import { v3 } from '../src/vec';
import { drawText } from './font';

const out = resolve(process.argv[2] ?? 'farm/out/weather'); mkdirSync(out, { recursive: true });
const W = 300, H = 250, BANNER = 44, LABEL = 20;
const r = new PixelRenderer(W, H);
const px = new Uint8ClampedArray(W * H * 4);
const props = scatterProps(1337, 10, 2, 6.5);
const propCaps: Capsule[] = props.flatMap(p => p.caps);
const cloakGear = gearFromWords('a hooded figure in a long cloak');
const h = heightOf(defaultBiped());

// eight moments across one pit-day, so dawn, noon, dusk and night all show
const DAY = 16 * 60;
const SHOTS = [0.04, 0.15, 0.28, 0.42, 0.55, 0.68, 0.82, 0.94].map(u => u * DAY);
const sheet = new PNG({ width: W * SHOTS.length, height: (H + LABEL) * 2 + BANNER });
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 8; sheet.data[i + 1] = 10; sheet.data[i + 2] = 14; sheet.data[i + 3] = 255;
}
drawText(sheet.data, sheet.width, sheet.height, 'A DAY IN THE PIT — LIGHT, WIND AND RAIN', 16, 14, [223, 224, 213], 2);

function frame(row: number, col: number, t: number, forceRain: number | null) {
  const c0 = conditionsAt(t);
  const c = forceRain === null ? c0 : { ...c0, rain: forceRain, light: c0.light * (1 - forceRain * 0.28) };
  const caps: Capsule[] = [...propCaps];
  const wf = c.windX, ws = c.windZ;
  caps.push(...solvePose(defaultBiped(), { tired: 0, angry: 0 }, 0.3, 0.6, t, undefined, 0, {
    gear: cloakGear, windFwd: wf, windSide: ws,
  }));
  rainCaps(caps, t, c, 0, 0, 1);
  const lit = c.light;
  const dim = (q: [number, number, number]): [number, number, number] =>
    [q[0] * lit * (0.78 + 0.22 * lit), q[1] * lit * (0.86 + 0.14 * lit), q[2] * lit * (0.96 + 0.04 * lit)];
  r.render(px, caps, pitCam({
    ppm: (H * 0.4) / 1.9, yaw: 0.8, pitch: 0.3, cy: h * 0.55,
    floorColorA: dim([42, 47, 58]), floorColorB: dim([34, 38, 47]),
    floorLift: 0.5 + 0.5 * lit, floorRadius: 12 * (0.72 + 0.28 * lit),
  }), 0);
  const ox = col * W, oy = BANNER + row * (H + LABEL);
  for (let y = 0; y < H; y++) sheet.data.set(px.subarray(y * W * 4, (y + 1) * W * 4), ((oy + y) * sheet.width + ox) * 4);
  drawText(sheet.data, sheet.width, sheet.height,
    `${(c.hour * 24).toFixed(0).padStart(2, '0')}h  light ${c.light.toFixed(2)}  wind ${Math.hypot(c.windX, c.windZ).toFixed(1)}  rain ${c.rain.toFixed(2)}`,
    ox + 6, oy + H + 6, [110, 118, 128], 1);
}

SHOTS.forEach((t, i) => frame(0, i, t, null));
SHOTS.forEach((t, i) => frame(1, i, t, i / (SHOTS.length - 1)));   // the same day, rained on
writeFileSync(resolve(out, 'weather.png'), PNG.sync.write(sheet));
console.log(resolve(out, 'weather.png'));
