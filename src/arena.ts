// The proving ground: Bomberman tiles, one bred creature walking them.
// The sim is grid-honest (positions, bombs, blast lines); all the life on
// top of it comes out of the same drivers the studio calibrates. If motion
// stays readable here, the whole thesis holds.

import { v3, V3, rotY, TAU, clamp } from './vec';
import { defaultBiped, effectiveGait, Mood } from './genome';
import { solvePose, walkSpeed, Capsule } from './pose';
import { PixelRenderer, Camera } from './render';

const LOW_W = 240, LOW_H = 180;
const GW = 13, GH = 11; // tiles
const T = 1; // metres per tile

// 0 empty, 1 hard pillar, 2 soft block
const grid: number[][] = [];
for (let z = 0; z < GH; z++) {
  grid.push([]);
  for (let x = 0; x < GW; x++) {
    const border = x === 0 || z === 0 || x === GW - 1 || z === GH - 1;
    const pillar = x % 2 === 0 && z % 2 === 0;
    let v = border || pillar ? 1 : 0;
    if (v === 0 && Math.random() < 0.22) v = 2;
    grid[z].push(v);
  }
}
// keep the spawn corner walkable
for (const [x, z] of [[1, 1], [2, 1], [1, 2]]) grid[z][x] = 0;

const tx2w = (tx: number) => (tx - (GW - 1) / 2) * T;
const tz2w = (tz: number) => (tz - (GH - 1) / 2) * T;
const w2tx = (x: number) => Math.round(x / T + (GW - 1) / 2);
const w2tz = (z: number) => Math.round(z / T + (GH - 1) / 2);
const solid = (tx: number, tz: number) =>
  tx < 0 || tz < 0 || tx >= GW || tz >= GH || grid[tz][tx] !== 0;

// --- state ---------------------------------------------------------------
const genome = defaultBiped();
const mood: Mood = { tired: 0, angry: 0 };
const R = 0.27; // creature collision radius

const c = {
  x: tx2w(1), z: tz2w(1),
  heading: 0,
  phase: 0,
  move: 0, // smoothed 0..1 idle->walk
  idleT: 0,
  hurtT: 0,
};
interface Bomb { x: number; z: number; t: number }
interface Flame { tx: number; tz: number; ttl: number }
let bombs: Bomb[] = [];
let flames: Flame[] = [];

const keys = new Set<string>();
let lastInput = -10;
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
  lastInput = now();
  if (e.key === ' ') dropBomb();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
const now = () => performance.now() / 1000;

function dropBomb() {
  const tx = w2tx(c.x), tz = w2tz(c.z);
  if (bombs.some(b => w2tx(b.x) === tx && w2tz(b.z) === tz)) return;
  if (bombs.length >= 3) return;
  bombs.push({ x: tx2w(tx), z: tz2w(tz), t: 2 });
}

function explode(b: Bomb) {
  const tx = w2tx(b.x), tz = w2tz(b.z);
  flames.push({ tx, tz, ttl: 0.6 });
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let i = 1; i <= 2; i++) {
      const qx = tx + dx * i, qz = tz + dz * i;
      if (qx < 0 || qz < 0 || qx >= GW || qz >= GH) break;
      if (grid[qz][qx] === 1) break;
      flames.push({ tx: qx, tz: qz, ttl: 0.6 });
      if (grid[qz][qx] === 2) { grid[qz][qx] = 0; break; }
    }
  }
}

// --- wander AI (takes over when the keyboard goes quiet) -----------------
let aiDir: [number, number] = [1, 0];
let aiRepath = 0;
function aiStep(dt: number, blocked: boolean) {
  aiRepath -= dt;
  if (blocked || aiRepath <= 0) {
    const tx = w2tx(c.x), tz = w2tz(c.z);
    const open = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).filter(
      ([dx, dz]) => !solid(tx + dx, tz + dz),
    );
    if (open.length) {
      aiDir = open[Math.floor(Math.random() * open.length)];
      if (Math.random() < 0.12) dropBomb();
    }
    aiRepath = 1.2 + Math.random() * 1.5;
  }
}

// --- movement ------------------------------------------------------------
function tryMove(dx: number, dz: number): boolean {
  // axis-separated collision against solid tiles
  let moved = false;
  for (const [mx, mz] of [[dx, 0], [0, dz]]) {
    if (mx === 0 && mz === 0) continue;
    const nx = c.x + mx, nz = c.z + mz;
    const tx0 = w2tx(nx - R), tx1 = w2tx(nx + R);
    const tz0 = w2tz(nz - R), tz1 = w2tz(nz + R);
    let ok = true;
    for (let tz = tz0; tz <= tz1; tz++)
      for (let tx = tx0; tx <= tx1; tx++)
        if (solid(tx, tz)) {
          // circle vs tile square
          const cx = clamp(nx, tx2w(tx) - T / 2, tx2w(tx) + T / 2);
          const cz = clamp(nz, tz2w(tz) - T / 2, tz2w(tz) + T / 2);
          if (Math.hypot(nx - cx, nz - cz) < R) ok = false;
        }
    if (ok) { c.x = nx; c.z = nz; moved = true; }
  }
  return moved;
}

// --- rendering -----------------------------------------------------------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const lowC = document.createElement('canvas');
lowC.width = LOW_W; lowC.height = LOW_H;
const lowCtx = lowC.getContext('2d')!;
const img = lowCtx.createImageData(LOW_W, LOW_H);
const renderer = new PixelRenderer(LOW_W, LOW_H);
const cam: Camera = { yaw: 0.0, pitch: 0.62, ppm: 40, cy: 0.55, cx: c.x, cz: c.z, tile: 1 };

const PILLAR: [number, number, number] = [72, 78, 96];
const SOFT: [number, number, number] = [150, 106, 66];
const BOMB: [number, number, number] = [40, 42, 52];
const FLAME: [number, number, number] = [255, 176, 64];

function worldCapsules(): Capsule[] {
  const caps: Capsule[] = [];
  const vx = cam.cx ?? 0, vz = cam.cz ?? 0;
  for (let tz = 0; tz < GH; tz++)
    for (let tx = 0; tx < GW; tx++) {
      const g = grid[tz][tx];
      if (g === 0) continue;
      const x = tx2w(tx), z = tz2w(tz);
      if (Math.abs(x - vx) > 5.5 || Math.abs(z - vz) > 4.5) continue;
      if (g === 1)
        caps.push({ a: v3(x, 0.14, z), b: v3(x, 0.44, z), r: 0.33, color: PILLAR, part: 'wall' });
      else
        caps.push({ a: v3(x, 0.12, z), b: v3(x, 0.3, z), r: 0.35, color: SOFT, part: 'soft' });
    }
  for (const b of bombs) {
    const pulse = 0.26 + 0.03 * Math.sin(TAU * (2 - b.t) * (b.t < 0.6 ? 8 : 3));
    caps.push({ a: v3(b.x, pulse, b.z), b: v3(b.x, pulse, b.z), r: pulse, color: BOMB, part: 'bomb' });
    caps.push({ a: v3(b.x, pulse * 2 + 0.04, b.z), b: v3(b.x, pulse * 2 + 0.04, b.z), r: 0.05, color: FLAME, part: 'fuse' });
  }
  for (const f of flames) {
    const x = tx2w(f.tx), z = tz2w(f.tz);
    const r = 0.32 * Math.sin(Math.PI * clamp(f.ttl / 0.6, 0, 1)) + 0.12;
    caps.push({ a: v3(x, 0.3, z), b: v3(x, 0.3, z), r, color: FLAME, part: 'flame' });
  }
  return caps;
}

// --- loop ----------------------------------------------------------------
const hud = document.getElementById('hud')!;
let last = now();

function frame() {
  const t = now();
  step(Math.min(0.05, t - last), t);
  last = t;
  requestAnimationFrame(frame);
}

function step(dt: number, t: number) {
  // input -> desired velocity
  let dx = 0, dz = 0;
  const manual = t - lastInput < 2.5;
  if (manual) {
    if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
    if (keys.has('arrowright') || keys.has('d')) dx += 1;
    if (keys.has('arrowup') || keys.has('w')) dz -= 1;
    if (keys.has('arrowdown') || keys.has('s')) dz += 1;
  } else {
    dx = aiDir[0]; dz = aiDir[1];
  }

  const wantMove = dx !== 0 || dz !== 0;
  const speed = walkSpeed(genome, mood) * (c.hurtT > 0 ? 0.45 : 1);
  let moved = false;
  if (wantMove) {
    const l = Math.hypot(dx, dz);
    const step = speed * dt;
    moved = tryMove((dx / l) * step, (dz / l) * step);
    // lane assist: drift the perpendicular axis toward the tile centre
    if (dx !== 0 && dz === 0) c.z += (tz2w(w2tz(c.z)) - c.z) * Math.min(1, 6 * dt);
    if (dz !== 0 && dx === 0) c.x += (tx2w(w2tx(c.x)) - c.x) * Math.min(1, 6 * dt);
    // snappy facing with a whisker of smoothing
    const target = Math.atan2(dz, dx);
    let d = target - c.heading;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    c.heading += d * Math.min(1, 18 * dt);
  }
  if (!manual) aiStep(dt, wantMove && !moved);

  // locomotion state
  const g = effectiveGait(genome.gait, mood);
  const moving = wantMove && moved;
  c.move += ((moving ? 1 : 0) - c.move) * Math.min(1, 8 * dt);
  if (moving) c.phase = (c.phase + (speed / g.stride) * dt) % 1;
  c.idleT += dt;
  if (c.hurtT > 0) c.hurtT -= dt;

  // bombs & flames
  for (const b of bombs) b.t -= dt;
  for (const b of bombs.filter(b => b.t <= 0)) explode(b);
  bombs = bombs.filter(b => b.t > 0);
  for (const f of flames) f.ttl -= dt;
  flames = flames.filter(f => f.ttl > 0);
  if (c.hurtT <= 0)
    for (const f of flames)
      if (Math.hypot(tx2w(f.tx) - c.x, tz2w(f.tz) - c.z) < 0.55) c.hurtT = 0.7;

  // hurt is an adverb too: crouched, head down, slow — not an animation
  const hurtMood: Mood = c.hurtT > 0 ? { tired: 0.6, angry: 0.4 } : mood;

  // pose in creature space, then place in the world
  const local = solvePose(genome, hurtMood, c.phase, c.move, c.idleT);
  const place = (p: V3): V3 => {
    const r = rotY(p, -c.heading);
    return v3(r.x + c.x, r.y, r.z + c.z);
  };
  const caps: Capsule[] = local.map(cp => ({
    ...cp,
    a: place(cp.a),
    b: place(cp.b),
    color:
      c.hurtT > 0 && Math.sin(TAU * 10 * c.hurtT) > 0
        ? [255, 235, 235]
        : cp.color,
  }));
  caps.push(...worldCapsules());

  // camera follows
  cam.cx! += (c.x - cam.cx!) * Math.min(1, 4 * dt);
  cam.cz! += (c.z + 0.4 - cam.cz!) * Math.min(1, 4 * dt);

  renderer.render(img.data, caps, cam, 0);
  lowCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(lowC, 0, 0, canvas.width, canvas.height);

  hud.textContent = manual ? 'wasd / arrows · space = bomb' : 'wandering — press any key to take over';
}
requestAnimationFrame(frame);

// debug/tooling hook — this is also the seed of the MCP-drivable studio:
// the running sim is inspectable and pokeable from outside
(window as any).rig = {
  state: () => ({
    x: c.x, z: c.z, heading: c.heading, move: c.move, hurtT: c.hurtT,
    bombs: bombs.length, flames: flames.length,
  }),
  drop: dropBomb,
  step: (dt: number) => step(dt, now()),
};
