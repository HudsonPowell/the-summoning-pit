// The title, set in the wire type (src/type). The word coils in the dark
// under the floor, gets pulled up into the letterform glyph by glyph, hangs
// breathing for a moment, and is then cut loose — gravity takes it and it
// crumples back into the dark the way a figure goes down.
//
// The wrapper's only jobs are the lifecycle and the billboard: WireText works
// in an x/y plane, so each frame the plane is turned to face the camera.

import { WireText } from '../type/typeset';
import { Capsule } from '../pose';
import { v3, rotY } from '../vec';

const SUMMON = 4.4;   // stagger across the word + the last glyph's rise
const HOLD = 3.6;
const FALL = 1.9;

export class WireTitle {
  private wire: WireText;
  private t = 0;
  private out: Capsule[] = [];
  done = false;

  constructor(text = 'the summoning pit', size = 0.62, baseline = 0.85) {
    this.wire = new WireText(text, { size, baseline, align: 'centre' });
    // it starts as coils below the floor — the arrival IS the summoning
    this.wire.coil(1.15, 0.4);
  }

  caps(dt: number, camYaw: number): Capsule[] {
    this.t += dt;
    const t = this.t;
    if (t > SUMMON + HOLD + FALL) { this.done = true; this.out.length = 0; return this.out; }

    if (t < SUMMON) {
      this.wire.step(dt, t);
    } else if (t < SUMMON + HOLD) {
      this.wire.simulate(dt);
      this.wire.breathe(t);
    } else {
      // cut loose: no memory of home, just weight. The word dies as wire.
      this.wire.simulate(dt, { home: 0, bend: 0.12, gravity: -3.2, absorb: 0.7 });
    }

    const fall = Math.max(0, (t - SUMMON - HOLD) / FALL);
    const fade = 1 - fall * fall;

    const flat = this.wire.frame();
    this.out.length = 0;
    for (const cap of flat) {
      // below the floor is the dark it came from; stop drawing there
      if (cap.a.y < 0.015 && cap.b.y < 0.015) continue;
      // undo the view's yaw so the plane faces the camera square-on — the view
      // applies rotY(+yaw), so the billboard is rotY(-yaw), via the same helper
      // rather than a hand-rolled rotation with a sign waiting to be wrong
      const a = rotY(v3(cap.a.x, 0, cap.a.z), -camYaw);
      const b = rotY(v3(cap.b.x, 0, cap.b.z), -camYaw);
      this.out.push({
        a: v3(a.x, Math.max(0.015, cap.a.y), a.z),
        b: v3(b.x, Math.max(0.015, cap.b.y), b.z),
        r: cap.r,
        color: [cap.color[0] * fade, cap.color[1] * fade, cap.color[2] * fade],
        part: cap.part,
      });
    }
    return this.out;
  }
}
