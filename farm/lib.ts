// Headless side of the studio: same solver, same renderer, no DOM.
// A genome goes in, a contact-sheet PNG comes out. This is what makes
// generated creatures cheap to evaluate at scale.

import { PNG } from 'pngjs';
import { Genome, Mood } from '../src/genome';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

export const FRAME = 176;

const cam: Camera = { yaw: 0.5, pitch: 0.22, ppm: 72, cy: 0.95 };

/** Render `cols` x `rows` phases of the gait cycle into one PNG buffer. */
export function renderSheet(genome: Genome, mood: Mood, cols = 2, rows = 2): Buffer {
  const renderer = new PixelRenderer(FRAME, FRAME);
  const frame = new Uint8ClampedArray(FRAME * FRAME * 4);
  const png = new PNG({ width: FRAME * cols, height: FRAME * rows });
  const n = cols * rows;
  for (let k = 0; k < n; k++) {
    const phase = k / n;
    const caps = solvePose(genome, mood, phase);
    renderer.render(frame, caps, cam, 0);
    const gx = (k % cols) * FRAME;
    const gy = Math.floor(k / cols) * FRAME;
    for (let y = 0; y < FRAME; y++) {
      for (let x = 0; x < FRAME; x++) {
        const src = (y * FRAME + x) * 4;
        const dst = ((gy + y) * png.width + gx + x) * 4;
        png.data[dst] = frame[src];
        png.data[dst + 1] = frame[src + 1];
        png.data[dst + 2] = frame[src + 2];
        png.data[dst + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}
