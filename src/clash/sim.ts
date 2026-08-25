// CLASH sim — ARENA mode. Fixed 60Hz tick, integers only, no rendering.
// The grammar: place a thing on a tile, it waits, it resolves as a cross
// along the corridors. Each class changes exactly ONE rule of that verb —
// the seven patterns below are the game.

export const GW = 32;
export const GH = 22;
export const TILE = 16;
export const SUB = 4;
export const TS = TILE * SUB;

export const enum T { FLOOR = 0, WALL = 1, BLOCK = 2 }

const HALF = 6 * SUB;
const ASSIST = 5 * SUB;
const BASE_SPEED = 3;
const MAX_SPEED = 6;
const FLAME_TTL = 30;
const MAX_RADIUS = 5;
const MAX_CANDLES_CAP = 5;
const ROUND_END = 150;
const PICKUP_CHANCE = 4;

export const PLAYER_HP = 3;
const HURT_INVULN = 60;
export const STRIKE_TICKS = 26;
const STRIKE_HIT_TICK = 14;
const STRIKE_RANGE = TS * 1.2;

export const BITE_WINDUP = 24;   // 0.4s telegraph — a human can react to this
export const BITE_TOTAL = 40;
const BITE_COOLDOWN = 50;
const BITE_RANGE = HALF * 2.6;
const INTRO_TICKS = 120;
export const WINS_TO_MATCH = 3;

export const enum Pickup { FOCUS = 0, HAND = 1, BOOTS = 2 }

/**
 * The seven. Identical damage everywhere — the differences are entirely
 * timing, visibility, and geometry, per the design doc.
 */
export const enum Pattern {
  FLAME = 0, // the Wick: the baseline damage cross
  RUNE = 1,  // the Chalk: an enemy standing still on it 0.6s scuffs it out
  VINE = 2,  // the Warden: builds temporary wall instead of destroying
  OIL = 3,   // the Still: inert puddles, lit by any flame, chaining
  CURSE = 4, // the Hex: near-invisible until it fires
  BELL = 5,  // the Peal: non-lethal shove cross, one tile wider
  IMP = 6,   // the Horn: the bomb walks three tiles, then bursts
}
export const PATTERN_NAMES = ['flame', 'rune', 'vine', 'oil', 'curse', 'bell', 'imp'] as const;

const VINE_TTL = 240;      // 4s of grown wall
const SCUFF_TICKS = 36;    // 0.6s standing still on an enemy rune
const IMP_WALK_TILES = 3;
const IMP_SPEED = 2;
const IMP_FUSE = 60;
const BELL_SHOVE = TS * 2; // pushed two tiles along the corridor

export type GameEvent =
  | { type: 'place'; owner: number }
  | { type: 'explode'; tiles: number; x: number; y: number }
  | { type: 'pickup'; kind: Pickup }
  | { type: 'hurtPlayer'; pi: number }
  | { type: 'hurtBeast' }
  | { type: 'diePlayer'; pi: number }
  | { type: 'dieBeast' }
  | { type: 'strike'; pi: number }
  | { type: 'strikeHit' }
  | { type: 'bite' }
  | { type: 'scuff' }
  | { type: 'bell'; tiles: number }
  | { type: 'vineGrow'; tiles: number }
  | { type: 'ignite' }
  | { type: 'roundOver'; winner: number }
  | { type: 'matchOver'; winner: number };

export interface Input {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  place: boolean;
  melee: boolean;
}

export interface PlayerCfg {
  fuse: number;
  radius: number;
  pattern: Pattern;
}

export interface BeastDef {
  speed: number;
  chaseR: number;
  hp: number;
}

export interface PlayerState {
  x: number; y: number;
  fx: number; fy: number;
  alive: boolean;
  deadT: number;
  hp: number;
  hurtT: number;
  strikeT: number;
  struck: boolean;
  placeCd: number; // oil cooldown
  speed: number;
  radius: number;
  maxCandles: number;
  wins: number;
  moving: boolean;
  axis: 0 | 1;
}

export interface Beast {
  x: number; y: number;
  fx: number; fy: number;
  def: number;
  hp: number;
  hurtT: number;
  deadT: number;
  moving: boolean;
  dirX: number; dirY: number;
  repathT: number;
  biteT: number;
  biteCd: number;
}

export interface Candle {
  tx: number; ty: number;
  timer: number;   // -1 while an imp is still walking
  fuse: number;
  owner: number;
  radius: number;
  pattern: Pattern;
  scuffT: number;
  walking: boolean;
  wx: number; wy: number;
  dirX: number; dirY: number;
  walked: number;
}

export interface PickupState { tx: number; ty: number; kind: Pickup }

export interface GameCfg {
  players: PlayerCfg[];
  beastDefs: BeastDef[];
  beastBase: number;
  /** 8-way movement. The design doc's grammar is 4-way; this is the dial. */
  diagonal: boolean;
}

export interface Game {
  grid: Uint8Array;
  flame: Int16Array;
  flameOwner: Uint8Array;
  flameSoft: Uint8Array;  // 1 = non-lethal (the bell's ring)
  vine: Int16Array;       // grown-wall ticks remaining
  vineOwner: Uint8Array;
  oil: Uint8Array;        // 0 none, else owner+1
  players: PlayerState[];
  beasts: Beast[];
  candles: Candle[];
  pickups: PickupState[];
  tick: number;
  round: number;
  roundEndT: number;
  roundWinner: number;
  introT: number;
  matchWinner: number;
  matchEndT: number;
  rng: number;
  cfg: GameCfg;
  events: GameEvent[];
}

const idx = (tx: number, ty: number) => ty * GW + tx;

function rand(g: Game): number {
  g.rng = (g.rng * 1664525 + 1013904223) >>> 0;
  return g.rng;
}

// --- map ------------------------------------------------------------------

const SPAWNS: [number, number][] = [[1, 1], [GW - 3, GH - 3], [GW - 3, 1], [1, GH - 3]];

function buildGrid(g: Game): void {
  const grid = g.grid;
  grid.fill(T.FLOOR);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const border = x === 0 || y === 0 || x === GW - 1 || y === GH - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) grid[idx(x, y)] = T.WALL;
    }
  for (let y = 1; y < GH - 1; y++)
    for (let x = 1; x < GW - 1; x++) {
      if (grid[idx(x, y)] !== T.FLOOR) continue;
      const mx = GW - 1 - x, my = GH - 1 - y;
      const mirrorFloor = grid[idx(mx, my)] === T.FLOOR;
      if (mirrorFloor && (y > my || (y === my && x > mx))) continue;
      if (rand(g) % 16 < 7) {
        grid[idx(x, y)] = T.BLOCK;
        if (mirrorFloor) grid[idx(mx, my)] = T.BLOCK;
      }
    }
  for (const [sx, sy] of SPAWNS) {
    const ix = sx < GW / 2 ? 1 : -1, iy = sy < GH / 2 ? 1 : -1;
    for (const [dx, dy] of [[0, 0], [ix, 0], [2 * ix, 0], [0, iy], [0, 2 * iy]]) {
      const i = idx(sx + dx, sy + dy);
      if (grid[i] === T.BLOCK) grid[i] = T.FLOOR;
    }
  }
}

function spawnPlayers(g: Game): void {
  g.players.forEach((p, i) => {
    const [tx, ty] = SPAWNS[i % SPAWNS.length];
    const cfg = g.cfg.players[i];
    p.x = tx * TS + TS / 2;
    p.y = ty * TS + TS / 2;
    p.fx = i % 2 === 0 ? 1 : -1;
    p.fy = 0;
    p.alive = true;
    p.deadT = -1;
    p.hp = PLAYER_HP;
    p.hurtT = 0;
    p.strikeT = -1;
    p.struck = false;
    p.placeCd = 0;
    p.speed = BASE_SPEED;
    p.radius = cfg ? cfg.radius : 2;
    p.maxCandles = 1;
    p.moving = false;
    p.axis = 0;
  });
}

function spawnBeasts(g: Game): void {
  g.beasts = [];
  if (g.cfg.beastDefs.length === 0) return;
  const count = Math.min(g.cfg.beastBase + g.round - 1, 6);
  for (let i = 0; i < count; i++) {
    const def = (g.round + i) % g.cfg.beastDefs.length;
    let tx = 15, ty = 11;
    for (let tries = 0; tries < 100; tries++) {
      const cx = 1 + 2 * (rand(g) % 15);
      const cy = 1 + 2 * (rand(g) % 10);
      if (g.grid[idx(cx, cy)] !== T.FLOOR) continue;
      const farFromAll = g.players.every(
        p => Math.abs(cx * TS + TS / 2 - p.x) + Math.abs(cy * TS + TS / 2 - p.y) > TS * 7,
      );
      if (!farFromAll) continue;
      tx = cx; ty = cy;
      break;
    }
    const d = g.cfg.beastDefs[def];
    g.beasts.push({
      x: tx * TS + TS / 2, y: ty * TS + TS / 2,
      fx: 1, fy: 0, def, hp: d.hp, hurtT: 0, deadT: -1,
      moving: false, dirX: 1, dirY: 0, repathT: 0,
      biteT: -1, biteCd: 0,
    });
  }
}

export function createGame(numPlayers: number, seed: number, cfg?: Partial<GameCfg>): Game {
  const g: Game = {
    grid: new Uint8Array(GW * GH),
    flame: new Int16Array(GW * GH),
    flameOwner: new Uint8Array(GW * GH),
    flameSoft: new Uint8Array(GW * GH),
    vine: new Int16Array(GW * GH),
    vineOwner: new Uint8Array(GW * GH),
    oil: new Uint8Array(GW * GH),
    players: Array.from({ length: numPlayers }, () => ({
      x: 0, y: 0, fx: 1, fy: 0, alive: true, deadT: -1,
      hp: PLAYER_HP, hurtT: 0, strikeT: -1, struck: false, placeCd: 0,
      speed: BASE_SPEED, radius: 2, maxCandles: 1,
      wins: 0, moving: false, axis: 0 as const,
    })),
    beasts: [],
    candles: [],
    pickups: [],
    tick: 0,
    round: 1,
    roundEndT: -1,
    roundWinner: -1,
    introT: INTRO_TICKS,
    matchWinner: -1,
    matchEndT: -1,
    rng: seed >>> 0,
    cfg: {
      players: cfg?.players ?? [],
      beastDefs: cfg?.beastDefs ?? [],
      beastBase: cfg?.beastBase ?? 2,
      diagonal: cfg?.diagonal ?? true,
    },
    events: [],
  };
  buildGrid(g);
  spawnPlayers(g);
  spawnBeasts(g);
  return g;
}

function resetRound(g: Game): void {
  g.round++;
  g.candles = [];
  g.pickups = [];
  g.flame.fill(0);
  g.flameSoft.fill(0);
  g.vine.fill(0);
  g.oil.fill(0);
  buildGrid(g);
  spawnPlayers(g);
  spawnBeasts(g);
  g.roundEndT = -1;
  g.roundWinner = -1;
  g.introT = INTRO_TICKS;
}

// --- movement -------------------------------------------------------------

function solidAt(g: Game, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return true;
  const i = idx(tx, ty);
  if (g.grid[i] !== T.FLOOR) return true;
  if (g.vine[i] > 0) return true;
  for (const c of g.candles) if (!c.walking && c.tx === tx && c.ty === ty) return true;
  return false;
}

const tileOf = (v: number) => Math.floor(v / TS);

function boxOverlapsTile(x: number, y: number, tx: number, ty: number): boolean {
  return (
    Math.abs(x - (tx * TS + TS / 2)) < TS / 2 + HALF &&
    Math.abs(y - (ty * TS + TS / 2)) < TS / 2 + HALF
  );
}

function fits(g: Game, x: number, y: number, fromX: number, fromY: number): boolean {
  const x0 = tileOf(x - HALF), x1 = tileOf(x + HALF - 1);
  const y0 = tileOf(y - HALF), y1 = tileOf(y + HALF - 1);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (solidAt(g, tx, ty) && !boxOverlapsTile(fromX, fromY, tx, ty)) return false;
  return true;
}

interface Mover { x: number; y: number }

function moveAxis(g: Game, m: Mover, spd: number, dx: number, dy: number): boolean {
  const nx = m.x + dx * spd, ny = m.y + dy * spd;
  if (fits(g, nx, ny, m.x, m.y)) {
    m.x = nx;
    m.y = ny;
    return true;
  }
  if (dx !== 0) {
    const cy = tileOf(m.y) * TS + TS / 2;
    const d = m.y - cy;
    if (d !== 0 && Math.abs(d) <= ASSIST && fits(g, m.x + dx * spd, cy, m.x, m.y)) {
      m.y -= Math.sign(d) * Math.min(spd, Math.abs(d));
      return true;
    }
  } else if (dy !== 0) {
    const cx = tileOf(m.x) * TS + TS / 2;
    const d = m.x - cx;
    if (d !== 0 && Math.abs(d) <= ASSIST && fits(g, cx, m.y + dy * spd, m.x, m.y)) {
      m.x -= Math.sign(d) * Math.min(spd, Math.abs(d));
      return true;
    }
  }
  return false;
}

// --- damage ---------------------------------------------------------------

function damagePlayer(g: Game, pi: number): void {
  const p = g.players[pi];
  if (!p.alive || p.hurtT > 0) return;
  p.hp--;
  p.hurtT = HURT_INVULN;
  if (p.hp <= 0) {
    p.alive = false;
    p.deadT = 0;
    p.strikeT = -1;
    g.events.push({ type: 'diePlayer', pi });
  } else {
    g.events.push({ type: 'hurtPlayer', pi });
  }
}

function damageBeast(g: Game, b: Beast): void {
  if (b.deadT >= 0 || b.hurtT > 0) return;
  b.hp--;
  b.hurtT = HURT_INVULN / 2;
  if (b.hp <= 0) {
    b.deadT = 0;
    g.events.push({ type: 'dieBeast' });
  } else {
    g.events.push({ type: 'hurtBeast' });
  }
}

// --- the verb -------------------------------------------------------------

function paintOil(g: Game, pi: number, tx: number, ty: number, radius: number): void {
  const paint = (x: number, y: number) => {
    const i = idx(x, y);
    if (g.oil[i] === 0) g.oil[i] = pi + 1;
  };
  paint(tx, ty);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let r = 1; r <= radius; r++) {
      const x = tx + dx * r, y = ty + dy * r;
      if (x < 0 || y < 0 || x >= GW || y >= GH) break;
      if (g.grid[idx(x, y)] !== T.FLOOR) break;
      paint(x, y);
    }
  }
}

function place(g: Game, pi: number): void {
  const p = g.players[pi];
  const cfg = g.cfg.players[pi];
  const pattern = cfg ? cfg.pattern : Pattern.FLAME;
  const fuse = cfg ? cfg.fuse : 150;
  const tx = tileOf(p.x), ty = tileOf(p.y);
  if (g.grid[idx(tx, ty)] !== T.FLOOR) return;

  if (pattern === Pattern.OIL) {
    // two-part: the puddles go down NOW, harmless, and wait for anyone's fire
    if (p.placeCd > 0) return;
    paintOil(g, pi, tx, ty, p.radius);
    p.placeCd = fuse;
    g.events.push({ type: 'place', owner: pi });
    return;
  }

  if (g.candles.filter(c => c.owner === pi).length >= p.maxCandles) return;
  if (g.candles.some(c => !c.walking && c.tx === tx && c.ty === ty)) return;

  const walking = pattern === Pattern.IMP;
  const dirX = walking ? (p.fx !== 0 ? p.fx : 1) : 0;
  const dirY = walking ? (p.fx !== 0 ? 0 : p.fy) : 0;
  g.candles.push({
    tx, ty,
    timer: walking ? -1 : fuse,
    fuse: walking ? IMP_FUSE : fuse,
    owner: pi,
    radius: p.radius,
    pattern,
    scuffT: 0,
    walking,
    wx: p.x, wy: p.y,
    dirX, dirY,
    walked: 0,
  });
  g.events.push({ type: 'place', owner: pi });
}

/** Knockback: push a body along a direction as far as the maze allows. */
function shove(g: Game, m: Mover, fx: number, fy: number, dist = 30): void {
  const steps = Math.ceil(dist / 5);
  for (let i = 0; i < steps; i++) {
    const nx = m.x + fx * 5, ny = m.y + fy * 5;
    if (!fits(g, nx, ny, m.x, m.y)) break;
    m.x = nx;
    m.y = ny;
  }
}

function crushAt(g: Game, tx: number, ty: number): void {
  g.players.forEach((p, pi) => {
    if (p.alive && tileOf(p.x) === tx && tileOf(p.y) === ty) damagePlayer(g, pi);
  });
  for (const b of g.beasts) {
    if (b.deadT < 0 && tileOf(b.x) === tx && tileOf(b.y) === ty) damageBeast(g, b);
  }
}

/**
 * The resolution queue. Every zero-timer placeable resolves this tick; a
 * cross touching another placeable zeroes it into the same queue. What
 * "resolve" MEANS depends on the pattern — that is the whole game.
 */
function resolve(g: Game): void {
  const queue: number[] = [];
  g.candles.forEach((c, i) => {
    if (!c.walking && c.timer === 0) queue.push(i);
  });
  if (queue.length === 0) return;

  const exploded = new Set<number>();
  const flamed: [number, number][] = [];
  const softFlamed: [number, number][] = [];
  const vined: [number, number][] = [];
  const vinedOrigins = new Set<number>();
  const destroyed: number[] = [];
  let bellTiles = 0;

  while (queue.length) {
    const ci = queue.shift()!;
    if (exploded.has(ci)) continue;
    exploded.add(ci);
    const c = g.candles[ci];
    const isVine = c.pattern === Pattern.VINE;
    const isBell = c.pattern === Pattern.BELL;
    const radius = isBell ? c.radius + 1 : c.radius;

    // the origin grows wall but never crushes — you can always step out of
    // your own placement, same rule as the collision overlap allowance
    if (isVine) vinedOrigins.add(idx(c.tx, c.ty));
    if (isVine) vined.push([idx(c.tx, c.ty), c.owner]);
    else if (isBell) softFlamed.push([idx(c.tx, c.ty), c.owner]);
    else flamed.push([idx(c.tx, c.ty), c.owner]);

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = 1; r <= radius; r++) {
        const tx = c.tx + dx * r, ty = c.ty + dy * r;
        if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) break;
        const t = g.grid[idx(tx, ty)];
        if (t === T.WALL) break;
        if (t === T.BLOCK) {
          if (!isVine && !isBell) {
            destroyed.push(idx(tx, ty));
            flamed.push([idx(tx, ty), c.owner]);
          }
          break; // vine and bell stop at blocks without consuming them
        }
        if (isVine) {
          vined.push([idx(tx, ty), c.owner]);
          continue; // vines bury placeables rather than triggering them
        }
        if (isBell) {
          softFlamed.push([idx(tx, ty), c.owner]);
          bellTiles++;
          // the ring shoves everything on this tile outward along the arm
          for (const p of g.players)
            if (p.alive && tileOf(p.x) === tx && tileOf(p.y) === ty) shove(g, p, dx, dy, BELL_SHOVE);
          for (const b of g.beasts)
            if (b.deadT < 0 && tileOf(b.x) === tx && tileOf(b.y) === ty) shove(g, b, dx, dy, BELL_SHOVE);
        } else {
          flamed.push([idx(tx, ty), c.owner]);
        }
        g.candles.forEach((o, oi) => {
          if (!exploded.has(oi) && !o.walking && o.tx === tx && o.ty === ty) {
            o.timer = 0;
            queue.push(oi);
          }
        });
      }
    }
  }

  for (const i of destroyed) {
    g.grid[i] = T.FLOOR;
    if (rand(g) % 16 < PICKUP_CHANCE) {
      const kind = (rand(g) % 3) as Pickup;
      g.pickups.push({ tx: i % GW, ty: Math.floor(i / GW), kind });
    }
  }
  for (const [i, owner] of flamed) {
    g.flame[i] = FLAME_TTL;
    g.flameOwner[i] = owner;
    g.flameSoft[i] = 0;
  }
  for (const [i, owner] of softFlamed) {
    if (g.flame[i] <= 0) {
      g.flame[i] = 12;
      g.flameOwner[i] = owner;
      g.flameSoft[i] = 1;
    }
  }
  for (const [i, owner] of vined) {
    if (g.vine[i] <= 0) {
      g.vine[i] = VINE_TTL;
      g.vineOwner[i] = owner;
      if (!vinedOrigins.has(i)) crushAt(g, i % GW, Math.floor(i / GW));
    }
  }

  // oil ignition: real fire touching a puddle sets the whole slick off
  if (flamed.length) {
    const stack: number[] = [];
    for (let i = 0; i < g.oil.length; i++)
      if (g.oil[i] > 0 && g.flame[i] > 0 && g.flameSoft[i] === 0) stack.push(i);
    if (stack.length) g.events.push({ type: 'ignite' });
    while (stack.length) {
      const i = stack.pop()!;
      if (g.oil[i] === 0) continue;
      const owner = g.oil[i] - 1;
      g.oil[i] = 0;
      g.flame[i] = FLAME_TTL;
      g.flameOwner[i] = owner;
      g.flameSoft[i] = 0;
      const tx = i % GW, ty = Math.floor(i / GW);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        if (g.oil[idx(nx, ny)] > 0) stack.push(idx(nx, ny));
      }
    }
  }

  if (bellTiles) g.events.push({ type: 'bell', tiles: bellTiles });
  if (vined.length) g.events.push({ type: 'vineGrow', tiles: vined.length });
  if (flamed.length) {
    const origin = flamed[0][0];
    g.events.push({
      type: 'explode',
      tiles: flamed.length,
      x: (origin % GW) * TILE + TILE / 2,
      y: Math.floor(origin / GW) * TILE + TILE / 2,
    });
  }
  g.candles = g.candles.filter((_, i) => !exploded.has(i));
  g.pickups = g.pickups.filter(
    pk => g.flame[idx(pk.tx, pk.ty)] <= 0 || g.flameSoft[idx(pk.tx, pk.ty)] === 1,
  );
}

// --- melee ----------------------------------------------------------------

function strikeHit(g: Game, pi: number): void {
  const p = g.players[pi];
  const fx = p.fx, fy = p.fy;
  const tx = tileOf(p.x) + fx, ty = tileOf(p.y) + fy;
  if (tx >= 0 && ty >= 0 && tx < GW && ty < GH && g.grid[idx(tx, ty)] === T.BLOCK)
    g.grid[idx(tx, ty)] = T.FLOOR;
  const inArc = (ox: number, oy: number) => {
    const dist = Math.abs(ox) + Math.abs(oy);
    return dist < STRIKE_RANGE && (ox * fx + oy * fy > 0 || dist < HALF * 2);
  };
  let connected = false;
  g.players.forEach((o, oi) => {
    if (oi === pi || !o.alive) return;
    if (inArc(o.x - p.x, o.y - p.y)) {
      damagePlayer(g, oi);
      shove(g, o, fx, fy);
      connected = true;
    }
  });
  for (const b of g.beasts) {
    if (b.deadT >= 0) continue;
    if (inArc(b.x - p.x, b.y - p.y)) {
      damageBeast(g, b);
      shove(g, b, fx, fy);
      connected = true;
    }
  }
  if (connected) g.events.push({ type: 'strikeHit' });
}

// --- beasts ---------------------------------------------------------------

function stepBeast(g: Game, b: Beast): void {
  if (b.deadT >= 0) {
    b.deadT++;
    b.moving = false;
    return;
  }
  if (b.hurtT > 0) b.hurtT--;
  const d = g.cfg.beastDefs[b.def];

  let best = -1, bestDist = 1e9;
  g.players.forEach((p, pi) => {
    if (!p.alive) return;
    const dist = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
    if (dist < bestDist) { bestDist = dist; best = pi; }
  });

  if (best >= 0 && bestDist < d.chaseR) {
    const p = g.players[best];
    const dx = p.x - b.x, dy = p.y - b.y;
    if (Math.abs(dx) > Math.abs(dy)) { b.dirX = Math.sign(dx); b.dirY = 0; }
    else { b.dirX = 0; b.dirY = Math.sign(dy); }
  } else {
    b.repathT--;
    if (b.repathT <= 0) {
      const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const open = dirs.filter(([dx, dy]) => !solidAt(g, tileOf(b.x) + dx, tileOf(b.y) + dy));
      if (open.length) {
        const [dx, dy] = open[rand(g) % open.length];
        b.dirX = dx; b.dirY = dy;
      }
      b.repathT = 60 + (rand(g) % 90);
    }
  }

  if (b.biteT >= 0 && b.biteT < BITE_WINDUP) {
    b.moving = false; // still telegraphing — stand and rear
  } else {
    b.moving = moveAxis(g, b, d.speed, b.dirX, b.dirY);
  }
  if (!b.moving && b.biteT < 0) b.repathT = 0;
  if (b.dirX !== 0 || b.dirY !== 0) { b.fx = b.dirX; b.fy = b.dirY; }

  if (b.biteCd > 0) b.biteCd--;
  if (b.biteT < 0 && b.biteCd <= 0) {
    const near = g.players.some(
      p => p.alive && Math.abs(p.x - b.x) < HALF * 2.2 && Math.abs(p.y - b.y) < HALF * 2.2,
    );
    if (near) {
      b.biteT = 0;
      g.events.push({ type: 'bite' });
    }
  }
  if (b.biteT >= 0) {
    b.biteT++;
    if (b.biteT === BITE_WINDUP) {
      g.players.forEach((p, pi) => {
        if (!p.alive) return;
        if (Math.abs(p.x - b.x) < BITE_RANGE && Math.abs(p.y - b.y) < BITE_RANGE) damagePlayer(g, pi);
      });
    }
    if (b.biteT >= BITE_TOTAL) {
      b.biteT = -1;
      b.biteCd = BITE_COOLDOWN;
    }
  }
}

// --- tick -----------------------------------------------------------------

export function step(g: Game, inputs: Input[]): void {
  g.tick++;
  g.events.length = 0;

  if (g.introT > 0) g.introT--;
  const frozen = g.introT > 0;

  if (g.roundEndT >= 0) {
    g.roundEndT--;
    if (g.roundEndT <= 0) resetRound(g);
  }

  g.players.forEach((p, pi) => {
    if (!p.alive) {
      p.deadT++;
      return;
    }
    if (p.hurtT > 0) p.hurtT--;
    if (p.placeCd > 0) p.placeCd--;
    const inp = frozen
      ? { dx: 0 as const, dy: 0 as const, place: false, melee: false }
      : inputs[pi] ?? { dx: 0, dy: 0, place: false, melee: false };
    if (inp.place) place(g, pi);
    if (inp.melee && p.strikeT < 0) {
      p.strikeT = 0;
      p.struck = false;
      g.events.push({ type: 'strike', pi });
    }
    if (p.strikeT >= 0) {
      p.strikeT++;
      if (!p.struck && p.strikeT >= STRIKE_HIT_TICK) {
        p.struck = true;
        strikeHit(g, pi);
      }
      if (p.strikeT >= STRIKE_TICKS) p.strikeT = -1;
    }

    p.moving = false;
    if (g.cfg.diagonal && inp.dx !== 0 && inp.dy !== 0) {
      // both axes in the same tick, each collision-checked on its own so you
      // slide along a wall instead of sticking. Per-axis step is scaled by
      // ~1/sqrt(2) (181/256, integer) so a diagonal isn't a speed exploit.
      const ds = Math.max(1, (p.speed * 181) >> 8);
      const movedX = moveAxis(g, p, ds, inp.dx, 0);
      const movedY = moveAxis(g, p, ds, 0, inp.dy);
      p.moving = movedX || movedY;
      p.fx = inp.dx;
      p.fy = inp.dy;
      p.axis = movedX ? 0 : 1;
    } else {
      const want: [number, number][] = [];
      if (inp.dx !== 0) want.push([inp.dx, 0]);
      if (inp.dy !== 0) want.push([0, inp.dy]);
      if (want.length === 2 && p.axis === 1) want.reverse();
      // facing answers the key even when the way is blocked — turning on the
      // spot is most of what "in control" feels like
      if (want.length) { p.fx = want[0][0]; p.fy = want[0][1]; }
      for (const [dx, dy] of want) {
        if (moveAxis(g, p, p.speed, dx, dy)) {
          p.moving = true;
          p.fx = dx; p.fy = dy;
          p.axis = dx !== 0 ? 0 : 1;
          break;
        }
      }
    }

    const tx = tileOf(p.x), ty = tileOf(p.y);
    g.pickups = g.pickups.filter(pk => {
      if (pk.tx !== tx || pk.ty !== ty) return true;
      if (pk.kind === Pickup.FOCUS) p.radius = Math.min(MAX_RADIUS, p.radius + 1);
      if (pk.kind === Pickup.HAND) p.maxCandles = Math.min(MAX_CANDLES_CAP, p.maxCandles + 1);
      if (pk.kind === Pickup.BOOTS) p.speed = Math.min(MAX_SPEED, p.speed + 1);
      g.events.push({ type: 'pickup', kind: pk.kind });
      return false;
    });
  });

  if (!frozen) for (const b of g.beasts) stepBeast(g, b);
  g.beasts = g.beasts.filter(b => b.deadT < 100);

  // the Horn's imps waddle, then arm
  for (const c of g.candles) {
    if (!c.walking) continue;
    const m: Mover = { x: c.wx, y: c.wy };
    const moved = moveAxis(g, m, IMP_SPEED, c.dirX, c.dirY);
    c.wx = m.x;
    c.wy = m.y;
    if (moved) c.walked += IMP_SPEED;
    c.tx = tileOf(c.wx);
    c.ty = tileOf(c.wy);
    if (!moved || c.walked >= IMP_WALK_TILES * TS) {
      c.walking = false;
      c.timer = IMP_FUSE;
      c.wx = c.tx * TS + TS / 2;
      c.wy = c.ty * TS + TS / 2;
    }
  }

  // the Chalk's runes can be scuffed: an enemy standing still on one erases it
  for (const c of g.candles) {
    if (c.pattern !== Pattern.RUNE || c.walking) continue;
    const scuffing = g.players.some(
      (p, pi) =>
        pi !== c.owner && p.alive && !p.moving &&
        tileOf(p.x) === c.tx && tileOf(p.y) === c.ty,
    );
    c.scuffT = scuffing ? c.scuffT + 1 : 0;
  }
  const beforeScuff = g.candles.length;
  g.candles = g.candles.filter(c => c.scuffT < SCUFF_TICKS);
  if (g.candles.length < beforeScuff) g.events.push({ type: 'scuff' });

  for (const c of g.candles) if (!c.walking && c.timer > 0) c.timer--;
  resolve(g);

  // the Warden's walls rot on schedule
  for (let i = 0; i < g.vine.length; i++) if (g.vine[i] > 0) g.vine[i]--;

  for (let i = 0; i < g.flame.length; i++) {
    if (g.flame[i] > 0) {
      g.flame[i]--;
      if (g.flame[i] === 0) g.flameSoft[i] = 0;
    }
  }
  g.players.forEach((p, pi) => {
    if (!p.alive) return;
    const i = idx(tileOf(p.x), tileOf(p.y));
    if (g.flame[i] > 0 && g.flameSoft[i] === 0) damagePlayer(g, pi);
  });
  for (const b of g.beasts) {
    if (b.deadT >= 0) continue;
    const i = idx(tileOf(b.x), tileOf(b.y));
    if (g.flame[i] > 0 && g.flameSoft[i] === 0) damageBeast(g, b);
  }

  if (g.roundEndT < 0 && g.matchWinner < 0) {
    const alive = g.players.filter(p => p.alive);
    if (alive.length <= 1 && g.players.length > 1) {
      g.roundEndT = ROUND_END;
      if (alive.length === 1) {
        g.roundWinner = g.players.indexOf(alive[0]);
        alive[0].wins++;
        g.events.push({ type: 'roundOver', winner: g.roundWinner });
        if (alive[0].wins >= WINS_TO_MATCH) {
          g.matchWinner = g.roundWinner;
          g.matchEndT = 360;
          g.roundEndT = -1;
          g.events.push({ type: 'matchOver', winner: g.matchWinner });
        }
      } else {
        g.roundWinner = -1;
        g.events.push({ type: 'roundOver', winner: -1 });
      }
    }
  }
  if (g.matchWinner >= 0) {
    g.matchEndT--;
    if (g.matchEndT <= 0) {
      for (const p of g.players) p.wins = 0;
      g.round = 0;
      g.matchWinner = -1;
      resetRound(g);
    }
  }
}
