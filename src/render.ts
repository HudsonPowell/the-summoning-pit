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
}

interface Proj {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  r: number;
  color: [number, number, number];
}

const SHADE_LEVELS = 4;

export class PixelRenderer {
  readonly W: number;
  readonly H: number;
  private depth: Float32Array;
  private q: Float32Array;
  private colR: Float32Array;
  private colG: Float32Array;
  private colB: Float32Array;
  private hit: Uint8Array;

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
        let r = 12, g = 13, b = 18; // void
        if (cam.floor !== false && Math.abs(d.y) > 1e-4) {
          const s = -oy / d.y;
          {
            const rx = ox + s * d.x, rz = oz + s * d.z;
            const wx = rx + ccx + scroll;
            const wz = rz + ccz;
            const dist = Math.hypot(rx, rz);
            if (dist < 10) {
              const tile = cam.tile ?? 0.5;
              const check =
                ((Math.floor(wx / tile + 0.5) + Math.floor(wz / tile + 0.5)) & 1) === 0;
              const fade = clamp(1 - dist / 10, 0, 1);
              const base = check ? 34 : 26;
              r = 12 + (base - 4) * fade;
              g = 13 + base * fade;
              b = 18 + (base + 6) * fade;
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
          let t = segLen2 > 1e-9 ? clamp((rx * dx + ry * dy) / segLen2, 0, 1) : 0;
          const ex = rx - t * dx, ey = ry - t * dy;
          const dist = Math.hypot(ex, ey);
          if (dist > p.r) continue;
          const z = p.az + (p.bz - p.az) * t;
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
