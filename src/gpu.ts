// The bone field on the GPU. Same picture as the CPU renderer — nearest
// capsule wins, quantised cross-section shading, depth dim, outlines — but
// the per-pixel loop runs in a fragment shader, so resolution is nearly free.
// The CPU renderer in render.ts stays as the reference implementation and
// the farm's headless path; if the two ever disagree, the CPU one is right.

import { V3, v3, rotX, rotY } from './vec';
import { Capsule } from './pose';
import { Camera } from './render';

const MAX_CAPS = 512;

const WGSL = /* wgsl */ `
struct U {
  res:  vec4f, // W, H, capCount, tile
  rayD: vec4f,
  rayO: vec4f,
  rayDx: vec4f,
  rayDy: vec4f,
  world: vec4f, // ccx, ccz, scroll, 0
  zr:   vec4f,  // minZ, maxZ, 0, 0
};
struct Cap { a: vec4f, b: vec4f, color: vec4f }; // a.xyz screen+depth, a.w r

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> caps: array<Cap>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn bestHit(p: vec2f) -> vec3f { // (z, q, index) — z stays -1e9 on miss
  var best = vec3f(-1e9, 0.0, -1.0);
  let n = u32(u.res.z);
  for (var i = 0u; i < n; i++) {
    let c = caps[i];
    let ab = c.b.xy - c.a.xy;
    let ap = p - c.a.xy;
    let l2 = dot(ab, ab);
    var t = 0.0;
    if (l2 > 1e-9) { t = clamp(dot(ap, ab) / l2, 0.0, 1.0); }
    let d = length(ap - t * ab);
    if (d <= c.a.w) {
      let z = c.a.z + (c.b.z - c.a.z) * t;
      if (z > best.x) { best = vec3f(z, d / c.a.w, f32(i)); }
    }
  }
  return best;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = pos.xy;
  // floor: orthographic ray onto y=0
  var col = vec3f(12.0, 13.0, 18.0);
  let o = u.rayO.xyz + pos.x * u.rayDx.xyz + pos.y * u.rayDy.xyz;
  if (abs(u.rayD.y) > 1e-4) {
    let s = -o.y / u.rayD.y;
    let rx = o.x + s * u.rayD.x;
    let rz = o.z + s * u.rayD.z;
    let wx = rx + u.world.x + u.world.z;
    let wz = rz + u.world.y;
    let dist = length(vec2f(rx, rz));
    if (dist < 10.0) {
      let tile = u.res.w;
      let ci = i32(floor(wx / tile + 0.5)) + i32(floor(wz / tile + 0.5));
      let check = ((ci % 2) + 2) % 2;
      let fade = clamp(1.0 - dist / 10.0, 0.0, 1.0);
      var base = 26.0;
      if (check == 0) { base = 34.0; }
      col = vec3f(12.0 + (base - 4.0) * fade, 13.0 + base * fade, 18.0 + (base + 6.0) * fade);
    }
  }
  // bone field
  let h = bestHit(p);
  if (h.z >= 0.0) {
    let c = caps[u32(h.z)];
    var shade = 0.5 + 0.5 * sqrt(max(0.0, 1.0 - h.y * h.y));
    shade = ceil(shade * 4.0) / 4.0;
    let dim = 1.0 - 0.22 * ((u.zr.y - h.x) / max(1e-4, u.zr.y - u.zr.x));
    var m = 1.0;
    for (var k = 0; k < 4; k++) {
      var off = vec2f(1.0, 0.0);
      if (k == 1) { off = vec2f(-1.0, 0.0); }
      if (k == 2) { off = vec2f(0.0, 1.0); }
      if (k == 3) { off = vec2f(0.0, -1.0); }
      let q = p + off;
      if (q.x < 0.0 || q.y < 0.0 || q.x >= u.res.x || q.y >= u.res.y) { m = 0.35; break; }
      let nh = bestHit(q);
      if (nh.z < 0.0) { m = 0.35; break; }
      if (nh.x > h.x + 0.1) { m = min(m, 0.55); }
    }
    col = c.color.rgb * shade * dim * m;
  }
  return vec4f(col / 255.0, 1.0);
}
`;

export class GpuRenderer {
  readonly canvas: HTMLCanvasElement;
  private device: any;
  private ctx: any;
  private pipeline: any;
  private ubuf: any;
  private cbuf: any;
  private bindGroup: any;
  private uData = new Float32Array(28);
  private cData = new Float32Array(MAX_CAPS * 12);
  W: number;
  H: number;

  private constructor(device: any, W: number, H: number) {
    this.device = device;
    this.W = W;
    this.H = H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('webgpu');
    const format = (navigator as any).gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format, alphaMode: 'opaque' });
    const module = device.createShaderModule({ code: WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.ubuf = device.createBuffer({ size: this.uData.byteLength, usage: 0x40 | 0x8 }); // UNIFORM | COPY_DST
    this.cbuf = device.createBuffer({ size: this.cData.byteLength, usage: 0x80 | 0x8 }); // STORAGE | COPY_DST
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.ubuf } },
        { binding: 1, resource: { buffer: this.cbuf } },
      ],
    });
  }

  static async create(W: number, H: number): Promise<GpuRenderer | null> {
    try {
      const gpu = (navigator as any).gpu;
      if (!gpu) return null;
      const adapter = await gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      return new GpuRenderer(device, W, H);
    } catch {
      return null;
    }
  }

  resize(W: number, H: number): void {
    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;
  }

  render(caps: Capsule[], cam: Camera, scroll: number): void {
    const { W, H } = this;
    const ccx = cam.cx ?? 0, ccz = cam.cz ?? 0;
    const view = (p: V3) => rotX(rotY(v3(p.x - ccx, p.y, p.z - ccz), cam.yaw), cam.pitch);
    let minZ = 1e9, maxZ = -1e9;
    const n = Math.min(caps.length, MAX_CAPS);
    for (let i = 0; i < n; i++) {
      const c = caps[i];
      const a = view(c.a), b = view(c.b);
      const o = i * 12;
      this.cData[o] = W / 2 + a.x * cam.ppm;
      this.cData[o + 1] = H / 2 - (a.y - cam.cy) * cam.ppm;
      this.cData[o + 2] = a.z;
      this.cData[o + 3] = c.r * cam.ppm;
      this.cData[o + 4] = W / 2 + b.x * cam.ppm;
      this.cData[o + 5] = H / 2 - (b.y - cam.cy) * cam.ppm;
      this.cData[o + 6] = b.z;
      this.cData[o + 7] = 0;
      this.cData[o + 8] = c.color[0];
      this.cData[o + 9] = c.color[1];
      this.cData[o + 10] = c.color[2];
      this.cData[o + 11] = 0;
      minZ = Math.min(minZ, a.z, b.z);
      maxZ = Math.max(maxZ, a.z, b.z);
    }

    const invView = (p: V3) => rotY(rotX(p, -cam.pitch), -cam.yaw);
    const d = invView(v3(0, 0, 1));
    const o00 = invView(v3(-W / 2 / cam.ppm, H / 2 / cam.ppm + cam.cy, 0));
    const oDx = invView(v3(1 / cam.ppm, 0, 0));
    const oDy = invView(v3(0, -1 / cam.ppm, 0));

    const u = this.uData;
    u.set([W, H, n, cam.tile ?? 0.5], 0);
    u.set([d.x, d.y, d.z, 0], 4);
    u.set([o00.x, o00.y, o00.z, 0], 8);
    u.set([oDx.x, oDx.y, oDx.z, 0], 12);
    u.set([oDy.x, oDy.y, oDy.z, 0], 16);
    u.set([ccx, ccz, scroll, 0], 20);
    u.set([minZ, maxZ, 0, 0], 24);

    this.device.queue.writeBuffer(this.ubuf, 0, u);
    this.device.queue.writeBuffer(this.cbuf, 0, this.cData, 0, n * 12);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 12 / 255, g: 13 / 255, b: 18 / 255, a: 1 },
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
