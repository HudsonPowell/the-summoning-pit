// The mute control is drawn by the same renderer as everything else — capsules
// through the blend field — rather than as an SVG or a glyph. A flat icon in
// the corner of this would look like it came from a different program.
//
// It is its own tiny render: an orthographic camera looking straight at a
// handful of capsules, on the void's own background, so it sits in the scene
// rather than on top of it.

import { PixelRenderer, Camera } from '../render';
import { Capsule } from '../pose';
import { v3 } from '../vec';

const S = 46;                       // the icon's buffer, in pixels
// A one-colour icon reads as a glyph; parts in different inks read as a THING
// built from pieces, which is what everything else in the pit is. Same trick
// as a creature's palette: torso, limbs, accent.
const BOX: [number, number, number] = [110, 118, 130];
const CONE: [number, number, number] = [176, 184, 196];
const ARC: [number, number, number] = [110, 232, 214];
const OFF: [number, number, number] = [196, 96, 84];

function speaker(muted: boolean, t: number): Capsule[] {
  const c: Capsule[] = [];
  // The wobble: nothing in the pit sits perfectly still, so neither does its
  // furniture. Each part drifts on its own slow phase — smooth sines, no
  // noise, far too small to move the icon and just enough to make it breathe.
  let ph = 0;
  const put = (ax: number, ay: number, bx: number, by: number, r: number, col: [number, number, number]) => {
    ph += 1.7;
    const wx = Math.sin(t * 1.1 + ph) * 0.016;
    const wy = Math.cos(t * 1.4 + ph * 1.3) * 0.014;
    const wr = 1 + Math.sin(t * 1.9 + ph * 0.7) * 0.05;
    c.push({ a: v3(ax + wx, ay + wy, 0), b: v3(bx + wx * 0.6, by + wy * 0.6, 0), r: r * wr, color: col, part: 'icon' });
  };

  // the box, then the cone opening out from it — the blend fuses them but the
  // two inks keep the join visible, which is what makes it feel built
  put(-0.34, 0, -0.16, 0, 0.17, BOX);
  put(-0.05, 0.34, -0.05, -0.34, 0.13, CONE);
  put(-0.16, 0.2, -0.05, 0.3, 0.1, CONE);
  put(-0.16, -0.2, -0.05, -0.3, 0.1, CONE);

  if (muted) {
    // a bar across it. Red, because the state it describes is a loss.
    put(0.06, 0.36, 0.52, -0.36, 0.075, OFF);
  } else {
    // the waves carry the sigil teal — sound leaving the thing
    for (const [rad, seg] of [[0.26, 3], [0.44, 4]] as const) {
      for (let i = 0; i < seg; i++) {
        const a0 = -0.7 + (i / seg) * 1.4;
        const a1 = -0.7 + ((i + 1) / seg) * 1.4;
        put(0.1 + Math.cos(a0) * rad, Math.sin(a0) * rad,
            0.1 + Math.cos(a1) * rad, Math.sin(a1) * rad, 0.055, ARC);
      }
    }
  }
  return c;
}

export class MuteIcon {
  private r = new PixelRenderer(S, S);
  private buf = new Uint8ClampedArray(S * S * 4);
  private ctx: CanvasRenderingContext2D | null;

  constructor(private canvas: HTMLCanvasElement, private bg: [number, number, number]) {
    canvas.width = S;
    canvas.height = S;
    this.ctx = canvas.getContext('2d');
  }

  draw(muted: boolean, t = 0): void {
    if (!this.ctx) return;
    const cam: Camera = {
      yaw: 0, pitch: 0, ppm: S * 0.62, cy: 0,
      floor: false, blend: 0.85, blendShape: 0.55, blendMix: 0.7,
      // FLAT ink. Without it the shading lights a head-on icon to near-white
      // and the red of the muted bar disappears with everything else.
      flat: true,
      voidColor: this.bg,
    };
    this.r.render(this.buf, speaker(muted, t), cam, 0);
    const img = this.ctx.createImageData(S, S);
    img.data.set(this.buf);
    this.ctx.putImageData(img, 0, 0);
  }
}
