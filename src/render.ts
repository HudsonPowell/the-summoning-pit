// The skeleton draws itself. Every visible pixel is a query against the bone
// field: nearest capsule wins, coloured by bone identity, shaded by
// cross-section and depth, then hard-cut. A threshold, not a downscale.
//
// Pure buffers in and out — no DOM — so the same renderer runs headless in
// the farm.

import { V3, v3, rotX, rotY, clamp } from './vec';
import { Capsule } from './pose';

export interface Camera {
  yaw: number;   // radians, 0 = side-on to the walk
  pitch: number; // radians, >0 looks down at the creature
  ppm: number;   // pixels per metre at the low-res buffer
  cy: number;    // world height mapped to screen centre
  cx?: number;   // world-space look-at (defaults to origin)
  cz?: number;
  tile?: number; // floor checker size in metres (default 0.5); centred on integer coords
  flat?: boolean;  // CLASH look: solid inks, no shading, no depth dim, no outlines
  floor?: boolean; // false = solid near-black ground plane (default true: checkered)
  /**
   * Soft-field blending. 0 = the hard nearest-capsule field. Above that the
   * bone field is resolved with an exponential smooth-min, so silhouettes
   * fuse at the joints and each part's ink cross-fades into its neighbours.
   */
  blend?: number;      // softness k, in pixels
  blendDepth?: number; // max view-z gap (metres) a part may bleed across
  blendMix?: number;   // 0 = keep the nearest ink, 1 = full weighted mix
  blendShape?: number; // 0 = hard silhouette (colour still blends), 1 = fully fused
  /** The pool of light the floor sits in, centred on the camera's look-at. */
  floorRadius?: number; // metres to full darkness (default 10)
  floorPower?: number;  // 1 = linear ramp, >1 tightens the pool, <1 spreads it
  floorLift?: number;   // 0..1 brightness of the lit floor
  /**
   * A circle drawn on the ground is an ellipse once the camera tilts — which
   * reads as a "sideways" pool. Squashing the depth axis by sin(pitch) makes
   * the falloff a true circle on screen instead.
   */
  floorSquash?: number;
  voidColor?: [number, number, number];   // the dark the world sits in
  floorColorA?: [number, number, number]; // lit checker, light square
  floorColorB?: [number, number, number]; // lit checker, dark square
}

interface Proj {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  r: number;
  color: [number, number, number];
}

const SHADE_LEVELS = 4;

// the old hardcoded palette, kept as the defaults so nothing else shifts
const VOID_INK: [number, number, number] = [12, 13, 18];
const FLOOR_A: [number, number, number] = [42, 47, 58];
const FLOOR_B: [number, number, number] = [34, 39, 50];

/**
 * Where the capsule's SURFACE is along this pixel's view ray, in metres.
 *
 * The axis depth alone is wrong by up to a full radius — exactly the scale at
 * which limbs overlap — so a crossing arm sorts against a torso by luck. The
 * surface bulges toward the camera by sqrt(r² - d²), and for a limb aimed at
 * the camera the near cap is what we actually see, so that endpoint is tested
 * too (its 2-D projection is a point, where the segment-closest test degrades).
 */
function surfaceZ(p: Proj, px: number, py: number, t: number, dist: number, ppm: number): number {
  let z = p.az + (p.bz - p.az) * t + Math.sqrt(Math.max(0, p.r * p.r - dist * dist)) / ppm;
  const nearIsA = p.az > p.bz;
  const ex = (nearIsA ? p.ax : p.bx) - px;
  const ey = (nearIsA ? p.ay : p.by) - py;
  const de2 = ex * ex + ey * ey;
  if (de2 < p.r * p.r) {
    const capZ = (nearIsA ? p.az : p.bz) + Math.sqrt(p.r * p.r - de2) / ppm;
    if (capZ > z) z = capZ;
  }
  return z;
}

export class PixelRenderer {
  readonly W: number;
  readonly H: number;
  private depth: Float32Array;
  private q: Float32Array;
  private colR: Float32Array;
  private colG: Float32Array;
  private colB: Float32Array;
  private hit: Uint8Array;
  // soft-field scratch (only touched when cam.blend > 0)
  private minS: Float32Array;
  private bestR: Float32Array;
  private winR: Float32Array;
  private winG: Float32Array;
  private winB: Float32Array;
  private sumW: Float32Array;
  private insideHit: Uint8Array;

  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    const n = W * H;
    this.depth = new Float32Array(n);
    this.q = new Float32Array(n);
    this.colR = new Float32Array(n);
    this.colG = new Float32Array(n);
    this.colB = new Float32Array(n);
    this.hit = new Uint8Array(n);
    this.minS = new Float32Array(n);
    this.bestR = new Float32Array(n);
    this.winR = new Float32Array(n);
    this.winG = new Float32Array(n);
    this.winB = new Float32Array(n);
    this.sumW = new Float32Array(n);
    this.insideHit = new Uint8Array(n);
  }

  /**
   * Two sweeps over the capsules. The first finds, per pixel, the nearest
   * surface (signed distance, depth, radius, ink). The second accumulates
   * exp(-(s - minS)/k) from every part close enough in depth, which gives
   * both the smooth-min silhouette and the colour cross-fade for free:
   *   smin = minS - k·ln(ΣW)   and   q = 1 + smin/r
   * With k → 0 this collapses exactly onto the hard nearest-capsule field.
   */
  private blendedField(
    projs: Proj[], cam: Camera, minZ: number, maxZ: number, zRange: number,
  ): void {
    const { W, H } = this;
    const k = cam.blend ?? 0;
    const depthGate = cam.blendDepth ?? 0.35;
    const mix = cam.blendMix ?? 1;
    const shapeAmt = cam.blendShape ?? 1;
    const margin = k * 6; // beyond this the weight is numerically nothing
    void minZ;

    this.minS.fill(1e9);
    this.sumW.fill(0);
    this.insideHit.fill(0);
    this.colR.fill(0);
    this.colG.fill(0);
    this.colB.fill(0);

    const sweep = (accumulate: boolean) => {
      for (const p of projs) {
        const pad = p.r + margin + 1;
        const x0 = Math.max(0, Math.floor(Math.min(p.ax, p.bx) - pad));
        const x1 = Math.min(W - 1, Math.ceil(Math.max(p.ax, p.bx) + pad));
        const y0 = Math.max(0, Math.floor(Math.min(p.ay, p.by) - pad));
        const y1 = Math.min(H - 1, Math.ceil(Math.max(p.ay, p.by) + pad));
        const dx = p.bx - p.ax, dy = p.by - p.ay;
        const segLen2 = dx * dx + dy * dy;
        for (let py = y0; py <= y1; py++) {
          for (let px = x0; px <= x1; px++) {
            const rx = px + 0.5 - p.ax, ry = py + 0.5 - p.ay;
            const t = segLen2 > 1e-9 ? clamp((rx * dx + ry * dy) / segLen2, 0, 1) : 0;
            const ex = rx - t * dx, ey = ry - t * dy;
            const dist = Math.hypot(ex, ey);
            const s = dist - p.r; // signed: <0 inside
            if (s > margin) continue;
            const i = py * W + px;
            const z = surfaceZ(p, px + 0.5, py + 0.5, t, Math.min(dist, p.r), cam.ppm);
            if (!accumulate) {
              if (s < this.minS[i]) this.minS[i] = s; // smooth-min needs the true min
              // ...but the pixel BELONGS to whatever is in front of it. Picking
              // by smallest s instead sorts by "deepest inside", which lets a
              // fat far limb paint over a thin near one.
              const inside = s < 0;
              const better = inside
                ? this.insideHit[i] === 0 || z > this.depth[i]
                : this.insideHit[i] === 0 && z > this.depth[i];
              if (better) {
                this.depth[i] = z;
                this.bestR[i] = p.r;
                this.winR[i] = p.color[0];
                this.winG[i] = p.color[1];
                this.winB[i] = p.color[2];
                if (inside) this.insideHit[i] = 1;
              }
            } else {
              if (Math.abs(z - this.depth[i]) > depthGate) continue;
              const w = Math.exp(-(s - this.minS[i]) / k);
              this.sumW[i] += w;
              this.colR[i] += p.color[0] * w;
              this.colG[i] += p.color[1] * w;
              this.colB[i] += p.color[2] * w;
            }
          }
        }
      }
    };
    sweep(false);
    sweep(true);

    for (let i = 0; i < W * H; i++) {
      const w = this.sumW[i];
      if (w <= 0) { this.hit[i] = 0; continue; }
      const sminFull = this.minS[i] - k * Math.log(w);
      // fusing inflates the surface; shapeAmt dials that back toward the
      // original hard silhouette while leaving the colour blend alone
      const smin = this.minS[i] + (sminFull - this.minS[i]) * shapeAmt;
      if (smin >= 0) { this.hit[i] = 0; continue; }
      this.hit[i] = 1;
      this.q[i] = clamp(1 + smin / Math.max(0.5, this.bestR[i]), 0, 1);
      const mr = this.colR[i] / w, mg = this.colG[i] / w, mb = this.colB[i] / w;
      let cr = this.winR[i] + (mr - this.winR[i]) * mix;
      let cg = this.winG[i] + (mg - this.winG[i]) * mix;
      let cb = this.winB[i] + (mb - this.winB[i]) * mix;
      if (!cam.flat) {
        const depthDim = 1 - 0.22 * ((maxZ - this.depth[i]) / zRange);
        let shade = 0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - this.q[i] * this.q[i]));
        shade = Math.ceil(shade * SHADE_LEVELS) / SHADE_LEVELS;
        const sh = shade * depthDim;
        cr *= sh; cg *= sh; cb *= sh;
      }
      this.colR[i] = cr;
      this.colG[i] = cg;
      this.colB[i] = cb;
    }
  }

  render(out: Uint8ClampedArray, caps: Capsule[], cam: Camera, scroll: number): void {
    const { W, H } = this;
    const n = W * H;
    this.depth.fill(-1e9); // larger view-z = closer to camera
    this.hit.fill(0);

    const ccx = cam.cx ?? 0, ccz = cam.cz ?? 0;
    const view = (p: V3) => rotX(rotY(v3(p.x - ccx, p.y, p.z - ccz), cam.yaw), cam.pitch);
    const toScreen = (p: V3) => {
      const v = view(p);
      return {
        x: W / 2 + v.x * cam.ppm,
        y: H / 2 - (v.y - cam.cy) * cam.ppm,
        z: v.z,
      };
    };

    // --- floor: orthographic ray through each pixel onto y=0 ------------
    const invView = (p: V3) => rotY(rotX(p, -cam.pitch), -cam.yaw);
    const d = invView(v3(0, 0, 1));
    const o00 = invView(v3(-W / 2 / cam.ppm, H / 2 / cam.ppm + cam.cy, 0));
    const oDx = invView(v3(1 / cam.ppm, 0, 0)); // per-pixel steps (directions, so
    const oDy = invView(v3(0, -1 / cam.ppm, 0)); // rotation only — no offset)
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const i = py * W + px;
        const ox = o00.x + px * oDx.x + py * oDy.x;
        const oy = o00.y + px * oDx.y + py * oDy.y;
        const oz = o00.z + px * oDx.z + py * oDy.z;
        const vc = cam.voidColor ?? VOID_INK;
        let r = vc[0], g = vc[1], b = vc[2];
        if (cam.floor !== false && Math.abs(d.y) > 1e-4) {
          const s = -oy / d.y;
          {
            const rx = ox + s * d.x, rz = oz + s * d.z;
            const wx = rx + ccx + scroll;
            const wz = rz + ccz;
            const squash = cam.floorSquash ?? 1;
            const dist = Math.hypot(rx, rz * squash);
            const radius = cam.floorRadius ?? 10;
            if (dist < radius) {
              const tile = cam.tile ?? 0.5;
              const check =
                ((Math.floor(wx / tile + 0.5) + Math.floor(wz / tile + 0.5)) & 1) === 0;
              const power = cam.floorPower ?? 1;
              const lin = clamp(1 - dist / radius, 0, 1);
              const fade = (power === 1 ? lin : Math.pow(lin, power)) * (cam.floorLift ?? 1);
              const fc = check ? (cam.floorColorA ?? FLOOR_A) : (cam.floorColorB ?? FLOOR_B);
              r = vc[0] + (fc[0] - vc[0]) * fade;
              g = vc[1] + (fc[1] - vc[1]) * fade;
              b = vc[2] + (fc[2] - vc[2]) * fade;
            }
          }
        }
        const o4 = i * 4;
        // floor:false renders sprite-style: background transparent for compositing
        out[o4] = r; out[o4 + 1] = g; out[o4 + 2] = b;
        out[o4 + 3] = cam.floor === false ? 0 : 255;
      }
    }

    // --- bone field ------------------------------------------------------
    const projs: Proj[] = [];
    let minZ = 1e9, maxZ = -1e9;
    for (const c of caps) {
      const a = toScreen(c.a), b2 = toScreen(c.b);
      minZ = Math.min(minZ, a.z, b2.z);
      maxZ = Math.max(maxZ, a.z, b2.z);
      projs.push({ ax: a.x, ay: a.y, az: a.z, bx: b2.x, by: b2.y, bz: b2.z, r: c.r * cam.ppm, color: c.color });
    }
    const zRange = Math.max(1e-4, maxZ - minZ);

    if ((cam.blend ?? 0) > 0.01) {
      this.blendedField(projs, cam, minZ, maxZ, zRange);
    } else
    for (const p of projs) {
      const x0 = Math.max(0, Math.floor(Math.min(p.ax, p.bx) - p.r - 1));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(p.ax, p.bx) + p.r + 1));
      const y0 = Math.max(0, Math.floor(Math.min(p.ay, p.by) - p.r - 1));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(p.ay, p.by) + p.r + 1));
      const dx = p.bx - p.ax, dy = p.by - p.ay;
      const segLen2 = dx * dx + dy * dy;
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const rx = px + 0.5 - p.ax, ry = py + 0.5 - p.ay;
          const t = segLen2 > 1e-9 ? clamp((rx * dx + ry * dy) / segLen2, 0, 1) : 0;
          const ex = rx - t * dx, ey = ry - t * dy;
          const dist = Math.hypot(ex, ey);
          if (dist > p.r) continue;
          const z = surfaceZ(p, px + 0.5, py + 0.5, t, dist, cam.ppm);
          const i = py * W + px;
          if (z > this.depth[i]) {
            this.depth[i] = z;
            this.q[i] = dist / p.r;
            this.hit[i] = 1;
            let s = 1;
            if (!cam.flat) {
              const depthDim = 1 - 0.22 * ((maxZ - z) / zRange);
              let shade = 0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - this.q[i] * this.q[i]));
              shade = Math.ceil(shade * SHADE_LEVELS) / SHADE_LEVELS;
              s = shade * depthDim;
            }
            this.colR[i] = p.color[0] * s;
            this.colG[i] = p.color[1] * s;
            this.colB[i] = p.color[2] * s;
          }
        }
      }
    }

    // --- composite + outlines -------------------------------------------
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const i = py * W + px;
        if (!this.hit[i]) continue;
        if (cam.flat) {
          const o4 = i * 4;
          out[o4] = this.colR[i];
          out[o4 + 1] = this.colG[i];
          out[o4 + 2] = this.colB[i];
          out[o4 + 3] = 255;
          continue;
        }
        let m = 1;
        // silhouette edge, and interior edges where another limb sits in front
        for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const qx = px + nx, qy = py + ny;
          if (qx < 0 || qx >= W || qy < 0 || qy >= H) { m = 0.35; break; }
          const j = qy * W + qx;
          if (!this.hit[j]) { m = 0.35; break; }
          if (this.depth[j] > this.depth[i] + 0.1) m = Math.min(m, 0.55);
        }
        const o4 = i * 4;
        out[o4] = this.colR[i] * m;
        out[o4 + 1] = this.colG[i] * m;
        out[o4 + 2] = this.colB[i] * m;
        out[o4 + 3] = 255;
      }
    }
  }
}
