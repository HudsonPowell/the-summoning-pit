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
  world: vec4f, // ccx, ccz, scroll, ppm
  zr:   vec4f,  // minZ, maxZ, flags (1=flat, 2=nofloor), 0
  blend: vec4f, // softness k (px), depth gate, colour mix, shape fuse
  floor: vec4f, // radius, power, lift, depth-squash
  voidCol: vec4f,
  floorA: vec4f,
  floorB: vec4f,
};
struct Cap { a: vec4f, b: vec4f, color: vec4f }; // a.xyz screen+depth, a.w r

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> caps: array<Cap>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}

// The capsule SURFACE along this pixel's ray (metres), not its axis: the
// bulge is up to a full radius, which is the scale limbs overlap at. The near
// cap is tested too, for limbs aimed at the camera.
fn surfaceZ(c: Cap, p: vec2f, t: f32, dist: f32) -> f32 {
  let ppm = u.world.w;
  var z = c.a.z + (c.b.z - c.a.z) * t + sqrt(max(0.0, c.a.w * c.a.w - dist * dist)) / ppm;
  var nearXY = c.b.xy;
  var nearZ = c.b.z;
  if (c.a.z > c.b.z) { nearXY = c.a.xy; nearZ = c.a.z; }
  let e = nearXY - p;
  let de2 = dot(e, e);
  if (de2 < c.a.w * c.a.w) {
    let capZ = nearZ + sqrt(c.a.w * c.a.w - de2) / ppm;
    if (capZ > z) { z = capZ; }
  }
  return z;
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
      let z = surfaceZ(c, p, t, d);
      if (z > best.x) { best = vec3f(z, d / c.a.w, f32(i)); }
    }
  }
  return best;
}

var<private> softCol: vec3f;

// Soft field: smooth-min silhouette + weighted ink, matching render.ts.
// Returns (smin, q, filled) in .xyz and the blended colour via the out param.
fn softHit(p: vec2f, k: f32, gate: f32, mixAmt: f32, shapeAmt: f32) -> vec4f {
  var minS = 1e9;
  var bestZ = -1e9;
  var bestR = 1.0;
  var winCol = vec3f(0.0);
  var insideHit = false;
  let n = u32(u.res.z);
  let margin = k * 6.0;
  for (var i = 0u; i < n; i++) {
    let c = caps[i];
    let ab = c.b.xy - c.a.xy;
    let ap = p - c.a.xy;
    let l2 = dot(ab, ab);
    var t = 0.0;
    if (l2 > 1e-9) { t = clamp(dot(ap, ab) / l2, 0.0, 1.0); }
    let dist = length(ap - t * ab);
    let s = dist - c.a.w;
    if (s > margin) { continue; }
    minS = min(minS, s);
    let z = surfaceZ(c, p, t, min(dist, c.a.w));
    let inside = s < 0.0;
    var better = false;
    if (inside) { better = !insideHit || z > bestZ; }
    else { better = !insideHit && z > bestZ; }
    if (better) {
      bestZ = z;
      bestR = c.a.w;
      winCol = c.color.rgb;
      if (inside) { insideHit = true; }
    }
  }
  if (minS > margin) { return vec4f(1.0, 0.0, 0.0, -1e9); }
  var sumW = 0.0;
  var acc = vec3f(0.0);
  for (var i = 0u; i < n; i++) {
    let c = caps[i];
    let ab = c.b.xy - c.a.xy;
    let ap = p - c.a.xy;
    let l2 = dot(ab, ab);
    var t = 0.0;
    if (l2 > 1e-9) { t = clamp(dot(ap, ab) / l2, 0.0, 1.0); }
    let dist2 = length(ap - t * ab);
    let s = dist2 - c.a.w;
    if (s > margin) { continue; }
    let z = surfaceZ(c, p, t, min(dist2, c.a.w));
    if (abs(z - bestZ) > gate) { continue; }
    let w = exp(-(s - minS) / k);
    sumW += w;
    acc += c.color.rgb * w;
  }
  if (sumW <= 0.0) { return vec4f(1.0, 0.0, 0.0, -1e9); }
  let sminFull = minS - k * log(sumW);
  let smin = minS + (sminFull - minS) * shapeAmt;
  let q = clamp(1.0 + smin / max(0.5, bestR), 0.0, 1.0);
  softCol = mix(winCol, acc / sumW, mixAmt);
  return vec4f(smin, q, 1.0, bestZ);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = pos.xy;
  let flags = u32(u.zr.z);
  // floor: orthographic ray onto y=0
  var col = u.voidCol.rgb;
  let o = u.rayO.xyz + pos.x * u.rayDx.xyz + pos.y * u.rayDy.xyz;
  if ((flags & 2u) == 0u && abs(u.rayD.y) > 1e-4) {
    let s = -o.y / u.rayD.y;
    let rx = o.x + s * u.rayD.x;
    let rz = o.z + s * u.rayD.z;
    let wx = rx + u.world.x + u.world.z;
    let wz = rz + u.world.y;
    let dist = length(vec2f(rx, rz * u.floor.w));
    let radius = u.floor.x;
    if (dist < radius) {
      let tile = u.res.w;
      let ci = i32(floor(wx / tile + 0.5)) + i32(floor(wz / tile + 0.5));
      let check = ((ci % 2) + 2) % 2;
      let lin = clamp(1.0 - dist / radius, 0.0, 1.0);
      let fade = pow(lin, u.floor.y) * u.floor.z;
      var fc = u.floorB.rgb;
      if (check == 0) { fc = u.floorA.rgb; }
      col = mix(u.voidCol.rgb, fc, fade);
    }
  }
  // bone field
  let k = u.blend.x;
  if (k > 0.01) {
    let sh = softHit(p, k, u.blend.y, u.blend.z, u.blend.w);
    if (sh.z > 0.0 && sh.x < 0.0) {
      var col2 = softCol;
      if ((flags & 1u) == 0u) {
        var shade = 0.5 + 0.5 * sqrt(max(0.0, 1.0 - sh.y * sh.y));
        shade = ceil(shade * 4.0) / 4.0;
        let dim = 1.0 - 0.22 * ((u.zr.y - sh.w) / max(1e-4, u.zr.y - u.zr.x));
        var m = 1.0;
        for (var kk = 0; kk < 4; kk++) {
          var off = vec2f(1.0, 0.0);
          if (kk == 1) { off = vec2f(-1.0, 0.0); }
          if (kk == 2) { off = vec2f(0.0, 1.0); }
          if (kk == 3) { off = vec2f(0.0, -1.0); }
          let q2 = p + off;
          if (q2.x < 0.0 || q2.y < 0.0 || q2.x >= u.res.x || q2.y >= u.res.y) { m = 0.35; break; }
          let nh = softHit(q2, k, u.blend.y, u.blend.z, u.blend.w);
          if (nh.z <= 0.0 || nh.x >= 0.0) { m = 0.35; break; }
          if (nh.w > sh.w + 0.1) { m = min(m, 0.55); }
        }
        col2 = col2 * shade * dim * m;
      }
      return vec4f(col2 / 255.0, 1.0);
    }
    return vec4f(col / 255.0, 1.0);
  }
  let h = bestHit(p);
  if (h.z >= 0.0) {
    let c = caps[u32(h.z)];
    if ((flags & 1u) != 0u) {
      return vec4f(c.color.rgb / 255.0, 1.0); // CLASH look: solid ink
    }
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
  private uData = new Float32Array(48);
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
    u.set([ccx, ccz, scroll, cam.ppm], 20);
    const flags = (cam.flat ? 1 : 0) | (cam.floor === false ? 2 : 0);
    u.set([minZ, maxZ, flags, 0], 24);
    u.set([cam.blend ?? 0, cam.blendDepth ?? 0.35, cam.blendMix ?? 1, cam.blendShape ?? 1], 28);
    u.set([cam.floorRadius ?? 10, cam.floorPower ?? 1, cam.floorLift ?? 1, cam.floorSquash ?? 1], 32);
    const vc = cam.voidColor ?? [12, 13, 18];
    const fa = cam.floorColorA ?? [42, 47, 58];
    const fb = cam.floorColorB ?? [34, 39, 50];
    u.set([vc[0], vc[1], vc[2], 0], 36);
    u.set([fa[0], fa[1], fa[2], 0], 40);
    u.set([fb[0], fb[1], fb[2], 0], 44);

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
