// Render the same secondary motion as the preview for visual gait checks.
// node --import tsx farm/motion_preview.ts [output-directory]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { defaultBiped, spider, walkingShrine, heightOf, effectiveGait } from '../src/genome';
import { motionOf, livingMotion } from '../src/motion';
import { newSecondary, stepSecondary } from '../src/secondary';
import { solvePose } from '../src/pose';
import { PixelRenderer } from '../src/render';

const out = resolve(process.argv[2] ?? 'farm/out/motion');
mkdirSync(out, { recursive: true });
const hopper = defaultBiped(); hopper.name = 'hopper'; hopper.skeleton.locomotion = 'hop';
const hoseComparison = process.argv.includes('--hose');
const comparison = process.argv.includes('--compare') || hoseComparison;
const creatures = comparison ? [defaultBiped(), defaultBiped(), spider(), spider()] : [defaultBiped(), walkingShrine(), spider(), hopper];
const width = 240, height = 256, seconds = 12, fps = 30;
const renderer = new PixelRenderer(width, height);
const pixels = new Uint8ClampedArray(width * height * 4);
const states = creatures.map(() => ({ sec: newSecondary(), phase: 0, move: 0, speed: 0, scroll: 0 }));
const sheet = new PNG({ width: width * 6, height: height * 4 });
for (let frame = 0; frame < seconds * fps; frame++) {
  const png = new PNG({ width: width * 4, height });
  creatures.forEach((genome, row) => {
    const t = frame / fps, dt = 1 / fps, state = states[row];
    const variation = comparison && !hoseComparison && row % 2 === 0 ? 0 : 1;
    const hose = hoseComparison && row % 2 === 0 ? 0 : 1;
    const life = livingMotion(genome, t, variation);
    const gait = effectiveGait(genome.gait, { tired: 0, angry: 0 });
    state.move += ((t < 10.4 ? 1 : 0) - state.move) * (1 - Math.exp(-dt / motionOf(genome).response));
    state.speed += ((t < 10.4 ? gait.stride * gait.cadence * life.pace : 0) - state.speed) * (1 - Math.exp(-dt / motionOf(genome).response));
    const delta = state.speed * dt / gait.stride;
    state.phase = (state.phase + delta) % 1;
    state.scroll += gait.stride * delta;
    stepSecondary(state.sec, dt, {
      genome, gait, phase: state.phase, phaseDelta: delta, move: state.move,
      speed: state.speed, mass: heightOf(genome),
      turnRate: 0, lookYaw: life.gaze, dead: false,
    });
    const caps = solvePose(genome, { tired: 0, angry: 0 }, state.phase, state.move, t, undefined, 0, { ...state.sec, variation, hose });
    renderer.render(pixels, caps, { yaw: 0.5, pitch: 0.22, ppm: 78, cy: heightOf(genome) * 0.48, floor: true }, state.scroll);
    for (let y = 0; y < height; y++) {
      const slice = pixels.subarray(y * width * 4, (y + 1) * width * 4);
      png.data.set(slice, (y * png.width + row * width) * 4);
      if (frame >= 30 && frame < 60 && frame % 5 === 0) {
        const col = (frame - 30) / 5;
        sheet.data.set(slice, ((row * height + y) * sheet.width + col * width) * 4);
      }
    }
  });
  writeFileSync(resolve(out, `frame-${String(frame).padStart(3, '0')}.png`), PNG.sync.write(png));
}
writeFileSync(resolve(out, 'contact-sheet.png'), PNG.sync.write(sheet));
console.log(out);
