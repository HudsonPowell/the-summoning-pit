// The proving ground: Bomberman tiles, creatures walking them.
// The sim is grid-honest (positions, bombs, blast lines); all the life on
// top of it comes out of the same drivers the studio calibrates.
//
// The enemy is genomes/bred-tired.json — the creature the farm evolved from
// the words "slumped, exhausted, shuffling". The farm's output walks into
// the game unedited.

import { v3, V3, rotY, TAU, clamp } from './vec';
import { defaultBiped, effectiveGait, migrateGenome, Genome, Mood, imp, hound, troll, ogre } from './genome';
import { solvePose, walkSpeed, Capsule, Intent, slashWeight } from './pose';
import { Camera } from './render';
import { PixelView } from './view';

// every genome the farm has bred is an enemy candidate, automatically —
// plus the authored monsters
const genomePool: Genome[] = [
  ...Object.entries(
    import.meta.glob('../genomes/*.json', { eager: true }) as Record<string, { default: unknown }>,
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, m]) => migrateGenome(m.default)),
  imp(), hound(), troll(), ogre(),
];

// how a creature behaves when the player is near — keyed by genome name
const BEHAVIOR: Record<string, { style: 'chase' | 'flee'; radius: number; speed: number }> = {
  'bred-tired': { style: 'chase', radius: 3.2, speed: 1 },
  'bred-brute': { style: 'chase', radius: 4.2, speed: 0.8 },
  'bred-skittish': { style: 'flee', radius: 2.6, speed: 1.35 },
  imp: { style: 'chase', radius: 2.8, speed: 1.4 },
  hound: { style: 'chase', radius: 4.5, speed: 1.2 },
  troll: { style: 'chase', radius: 3.6, speed: 0.85 },
  ogre: { style: 'chase', radius: 3.4, speed: 0.75 },
};
const DEFAULT_BEHAVIOR = { style: 'chase' as const, radius: 3.2, speed: 1 };

const LOW_W = 240, LOW_H = 180;
const GW = 13, GH = 11; // tiles
const T = 1; // metres per tile
const SLASH_DURATION = 0.55;
let pace = 1.5; // global tempo multiplier — drives speed AND cycle rate together

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
// keep both spawn corners walkable
for (const [x, z] of [[1, 1], [2, 1], [1, 2], [GW - 2, GH - 2], [GW - 3, GH - 2], [GW - 2, GH - 3]])
  grid[z][x] = 0;

const tx2w = (tx: number) => (tx - (GW - 1) / 2) * T;
const tz2w = (tz: number) => (tz - (GH - 1) / 2) * T;
const w2tx = (x: number) => Math.round(x / T + (GW - 1) / 2);
const w2tz = (z: number) => Math.round(z / T + (GH - 1) / 2);
const solid = (tx: number, tz: number) =>
  tx < 0 || tz < 0 || tx >= GW || tz >= GH || grid[tz][tx] !== 0;

// --- creatures -----------------------------------------------------------
const R = 0.27; // collision radius

interface Creature {
  genome: Genome;
  mood: Mood;
  x: number; z: number;
  heading: number;
  phase: number;
  move: number;
  idleT: number;
  hurtT: number;
  hp: number;
  deadT: number; // -1 alive, else seconds into the collapse
  slashT: number; // -1 idle, else 0..1 through the move
  struck: boolean; // strike event already fired this slash
  ai: { dir: [number, number]; repathT: number };
}

function makeCreature(genome: Genome, tx: number, tz: number, hp: number): Creature {
  return {
    genome, mood: { tired: 0, angry: 0 },
    x: tx2w(tx), z: tz2w(tz), heading: 0,
    phase: 0, move: 0, idleT: Math.random() * 5, hurtT: 0,
    hp, deadT: -1,
    slashT: -1, struck: false,
    ai: { dir: [1, 0], repathT: 0 },
  };
}

const PLAYER_HP = 5;
let playerWasDead = false;
const player = makeCreature(defaultBiped(), 1, 1, PLAYER_HP);
let enemies: Creature[] = [];
let round = 0;
const allCreatures = () => [player, ...enemies];

function openTileFarFromPlayer(): [number, number] {
  for (let tries = 0; tries < 200; tries++) {
    const tx = 1 + Math.floor(Math.random() * (GW - 2));
    const tz = 1 + Math.floor(Math.random() * (GH - 2));
    if (grid[tz][tx] !== 0) continue;
    if (Math.hypot(tx2w(tx) - player.x, tz2w(tz) - player.z) < 4) continue;
    return [tx, tz];
  }
  return [GW - 2, GH - 2];
}

function toast(msg: string) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1400);
}

function nextRound() {
  round++;
  if (round > 1) toast(`ROUND ${round}`);
  // regrow some cover
  for (let z = 1; z < GH - 1; z++)
    for (let x = 1; x < GW - 1; x++)
      if (grid[z][x] === 0 && Math.random() < 0.08 &&
          Math.hypot(tx2w(x) - player.x, tz2w(z) - player.z) > 2) grid[z][x] = 2;
  const n = Math.min(1 + round, 5);
  for (let i = 0; i < n; i++) {
    const genome = genomePool[(round + i) % genomePool.length];
    const [tx, tz] = openTileFarFromPlayer();
    enemies.push(makeCreature(genome, tx, tz, 3));
  }
}

function damage(cr: Creature) {
  if (cr.hurtT > 0 || cr.deadT >= 0) return;
  cr.hp--;
  cr.hurtT = 0.7;
  if (cr.hp <= 0) { cr.deadT = 0; cr.slashT = -1; }
}

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
  if (e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'j') triggerSlash(player);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
const now = () => performance.now() / 1000;

function triggerSlash(cr: Creature) {
  if (cr.slashT < 0) { cr.slashT = 0; cr.struck = false; }
}

function dropBomb() {
  const tx = w2tx(player.x), tz = w2tz(player.z);
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

// --- movement ------------------------------------------------------------
function tryMove(cr: Creature, dx: number, dz: number): boolean {
  let moved = false;
  for (const [mx, mz] of [[dx, 0], [0, dz]]) {
    if (mx === 0 && mz === 0) continue;
    const nx = cr.x + mx, nz = cr.z + mz;
    const tx0 = w2tx(nx - R), tx1 = w2tx(nx + R);
    const tz0 = w2tz(nz - R), tz1 = w2tz(nz + R);
    let ok = true;
    for (let tz = tz0; tz <= tz1; tz++)
      for (let tx = tx0; tx <= tx1; tx++)
        if (solid(tx, tz)) {
          const cx = clamp(nx, tx2w(tx) - T / 2, tx2w(tx) + T / 2);
          const cz = clamp(nz, tz2w(tz) - T / 2, tz2w(tz) + T / 2);
          if (Math.hypot(nx - cx, nz - cz) < R) ok = false;
        }
    if (ok) { cr.x = nx; cr.z = nz; moved = true; }
  }
  return moved;
}

function aiStep(cr: Creature, dt: number, blocked: boolean) {
  cr.ai.repathT -= dt;
  if (blocked || cr.ai.repathT <= 0) {
    const tx = w2tx(cr.x), tz = w2tz(cr.z);
    const open = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).filter(
      ([dx, dz]) => !solid(tx + dx, tz + dz),
    );
    if (open.length) {
      cr.ai.dir = open[Math.floor(Math.random() * open.length)];
      if (cr === player && Math.random() < 0.12) dropBomb();
    }
    cr.ai.repathT = 1.2 + Math.random() * 1.5;
  }
}

interface CreatureInput { dx: number; dz: number }

function updateCreature(cr: Creature, dt: number, input: CreatureInput) {
  if (cr.deadT >= 0) {
    cr.deadT += dt;
    cr.move += (0 - cr.move) * Math.min(1, 8 * dt);
    return { moving: false, moved: false, wantMove: false };
  }
  const { dx, dz } = input;
  const wantMove = dx !== 0 || dz !== 0;
  const hurtMood: Mood = cr.hurtT > 0 ? { tired: 0.6, angry: 0.4 } : cr.mood;
  const speed = walkSpeed(cr.genome, hurtMood) * pace * (cr.hurtT > 0 ? 0.45 : 1);
  let moved = false;
  if (wantMove) {
    const l = Math.hypot(dx, dz);
    const step = speed * dt;
    moved = tryMove(cr, (dx / l) * step, (dz / l) * step);
    if (dx !== 0 && dz === 0) cr.z += (tz2w(w2tz(cr.z)) - cr.z) * Math.min(1, 6 * dt);
    if (dz !== 0 && dx === 0) cr.x += (tx2w(w2tx(cr.x)) - cr.x) * Math.min(1, 6 * dt);
    const target = Math.atan2(dz, dx);
    let d = target - cr.heading;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    cr.heading += d * Math.min(1, 18 * dt);
  }

  const g = effectiveGait(cr.genome.gait, hurtMood);
  const moving = wantMove && moved;
  cr.move += ((moving ? 1 : 0) - cr.move) * Math.min(1, 8 * dt);
  if (moving) cr.phase = (cr.phase + (speed / g.stride) * dt) % 1;
  cr.idleT += dt;
  if (cr.hurtT > 0) cr.hurtT -= dt;

  // slash timeline + strike event (attack speed rides the pace)
  if (cr.slashT >= 0) {
    cr.slashT += (dt / SLASH_DURATION) * pace;
    if (!cr.struck && cr.slashT >= 0.55) {
      cr.struck = true;
      strike(cr);
    }
    if (cr.slashT >= 1) cr.slashT = -1;
  }

  return { moving, moved, wantMove };
}

function strike(cr: Creature) {
  const fx = Math.cos(cr.heading), fz = Math.sin(cr.heading);
  // soft block directly ahead crumbles
  const tx = w2tx(cr.x + fx * T), tz = w2tz(cr.z + fz * T);
  if (tx >= 0 && tz >= 0 && tx < GW && tz < GH && grid[tz][tx] === 2) grid[tz][tx] = 0;
  // other creatures in front get hurt and knocked back
  for (const other of allCreatures()) {
    if (other === cr) continue;
    const ox = other.x - cr.x, oz = other.z - cr.z;
    const dist = Math.hypot(ox, oz);
    if (dist < 1.15 && ox * fx + oz * fz > dist * 0.4) {
      damage(other);
      tryMove(other, fx * 0.35, fz * 0.35);
    }
  }
}

// --- rendering -----------------------------------------------------------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const view = new PixelView(canvas, LOW_W, LOW_H);
view.init();
const cam: Camera = { yaw: 0.0, pitch: 0.62, ppm: 26, cy: 0.55, cx: player.x, cz: player.z, tile: 1 };

// play-mode render controls
const zoomInput = document.getElementById('zoom') as HTMLInputElement | null;
const resInput = document.getElementById('res') as HTMLInputElement | null;
const paceInput = document.getElementById('pace') as HTMLInputElement | null;
zoomInput?.addEventListener('input', () => { cam.ppm = parseFloat(zoomInput.value); });
resInput?.addEventListener('input', () => {
  const w = parseInt(resInput.value, 10);
  view.setSize(w, Math.round(w * 0.75));
});
paceInput?.addEventListener('input', () => { pace = parseFloat(paceInput.value); });

const PILLAR: [number, number, number] = [72, 78, 96];
const SOFT: [number, number, number] = [150, 106, 66];
const BOMB: [number, number, number] = [40, 42, 52];
const FLAME: [number, number, number] = [255, 176, 64];

function worldCapsules(): Capsule[] {
  const caps: Capsule[] = [];
  const vx = cam.cx ?? 0, vz = cam.cz ?? 0;
  const cullX = view.size.W / 2 / cam.ppm + 1.2;
  const cullZ = view.size.H / 2 / cam.ppm / Math.cos(cam.pitch) + 1.2;
  for (let tz = 0; tz < GH; tz++)
    for (let tx = 0; tx < GW; tx++) {
      const g = grid[tz][tx];
      if (g === 0) continue;
      const x = tx2w(tx), z = tz2w(tz);
      if (Math.abs(x - vx) > cullX || Math.abs(z - vz) > cullZ) continue;
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

function creatureCapsules(cr: Creature): Capsule[] {
  const hurtMood: Mood = cr.hurtT > 0 && cr.deadT < 0 ? { tired: 0.6, angry: 0.4 } : cr.mood;
  const intent: Intent | undefined =
    cr.slashT >= 0 ? { slash: { t: cr.slashT, weight: slashWeight(cr.slashT) } } : undefined;
  const collapse = cr.deadT >= 0 ? clamp(cr.deadT / 0.45, 0, 1) : 0;
  const local = solvePose(cr.genome, hurtMood, cr.phase, cr.move, cr.idleT, intent, collapse);
  const place = (p: V3): V3 => {
    const r = rotY(p, -cr.heading);
    return v3(r.x + cr.x, r.y, r.z + cr.z);
  };
  const flash = cr.hurtT > 0 && cr.deadT < 0 && Math.sin(TAU * 10 * cr.hurtT) > 0;
  const fade = cr.deadT >= 0 ? Math.max(0.25, 1 - Math.max(0, cr.deadT - 0.8) / 0.8) : 1;
  return local.map(cp => ({
    ...cp,
    a: place(cp.a),
    b: place(cp.b),
    color: flash
      ? ([255, 235, 235] as [number, number, number])
      : ([cp.color[0] * fade, cp.color[1] * fade, cp.color[2] * fade] as [number, number, number]),
  }));
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
  // player input
  let dx = 0, dz = 0;
  const manual = t - lastInput < 2.5;
  if (manual) {
    if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
    if (keys.has('arrowright') || keys.has('d')) dx += 1;
    if (keys.has('arrowup') || keys.has('w')) dz -= 1;
    if (keys.has('arrowdown') || keys.has('s')) dz += 1;
  } else {
    dx = player.ai.dir[0]; dz = player.ai.dir[1];
  }
  const pres = updateCreature(player, dt, { dx, dz });
  if (!manual && player.deadT < 0) aiStep(player, dt, pres.wantMove && !pres.moved);

  // enemies: each genome brings its own temperament
  for (const enemy of enemies) {
    const b = BEHAVIOR[enemy.genome.name] ?? DEFAULT_BEHAVIOR;
    const pdx = player.x - enemy.x, pdz = player.z - enemy.z;
    const pdist = Math.hypot(pdx, pdz);
    const engaged = pdist < b.radius && enemy.hurtT <= 0 && player.deadT < 0;
    enemy.mood.angry = engaged && b.style === 'chase' ? 1 : 0;
    enemy.mood.tired = 0;
    let edx: number, edz: number;
    if (engaged) {
      const sign = b.style === 'chase' ? 1 : -1; // flee inverts the pursuit
      if (Math.abs(pdx) > Math.abs(pdz)) { edx = sign * Math.sign(pdx); edz = 0; }
      else { edx = 0; edz = sign * Math.sign(pdz); }
      if (b.style === 'chase' && pdist < 1.0) triggerSlash(enemy);
    } else {
      edx = enemy.ai.dir[0]; edz = enemy.ai.dir[1];
    }
    const eres = updateCreature(enemy, dt, { dx: edx * b.speed, dz: edz * b.speed });
    if (!engaged && enemy.deadT < 0) aiStep(enemy, dt, eres.wantMove && !eres.moved);
  }

  // deaths: enemies fade out, the player gets back up
  enemies = enemies.filter(e => e.deadT < 1.6);
  if (player.deadT >= 0 && !playerWasDead) { playerWasDead = true; toast('DOWN'); }
  if (player.deadT > 1.6) {
    playerWasDead = false;
    player.deadT = -1;
    player.hp = PLAYER_HP;
    player.hurtT = 1.0; // brief grace
    const [tx, tz] = openTileFarFromPlayer();
    player.x = tx2w(tx); player.z = tz2w(tz);
  }
  if (enemies.length === 0) nextRound();

  // bombs & flames
  for (const b of bombs) b.t -= dt;
  for (const b of bombs.filter(b => b.t <= 0)) explode(b);
  bombs = bombs.filter(b => b.t > 0);
  for (const f of flames) f.ttl -= dt;
  flames = flames.filter(f => f.ttl > 0);
  for (const cr of allCreatures())
    for (const f of flames)
      if (Math.hypot(tx2w(f.tx) - cr.x, tz2w(f.tz) - cr.z) < 0.55) damage(cr);

  // render
  const caps: Capsule[] = [];
  for (const cr of allCreatures()) caps.push(...creatureCapsules(cr));
  caps.push(...worldCapsules());

  cam.cx! += (player.x - cam.cx!) * Math.min(1, 4 * dt);
  cam.cz! += (player.z + 0.4 - cam.cz!) * Math.min(1, 4 * dt);

  view.render(caps, cam, 0);

  const heartsEl = document.getElementById('hearts');
  const statusEl = document.getElementById('status');
  if (heartsEl && statusEl) {
    heartsEl.innerHTML =
      '♥'.repeat(Math.max(0, player.hp)) +
      `<span class="empty">${'♥'.repeat(Math.max(0, PLAYER_HP - player.hp))}</span>`;
    statusEl.innerHTML =
      `round <b>${round}</b> · enemies <b>${enemies.length}</b> · ${view.mode}` +
      (manual ? '' : ' · <b>wandering</b>');
  }
}
requestAnimationFrame(frame);

// debug/tooling hook — the running sim is inspectable and pokeable from
// outside; this is the seed of the MCP-drivable instrument
(window as any).rig = {
  state: () => ({
    round,
    player: { x: player.x, z: player.z, hp: player.hp, hurtT: player.hurtT, deadT: player.deadT, slashT: player.slashT },
    enemies: enemies.map(e => ({
      name: e.genome.name, x: e.x, z: e.z, hp: e.hp, angry: e.mood.angry, hurtT: e.hurtT, deadT: e.deadT,
    })),
    bombs: bombs.length, flames: flames.length,
  }),
  drop: dropBomb,
  slash: () => triggerSlash(player),
  hurt: (i: number) => { if (enemies[i]) damage(enemies[i]); },
  hurtPlayer: () => damage(player),
  step: (dt: number) => step(dt, now()),
};
