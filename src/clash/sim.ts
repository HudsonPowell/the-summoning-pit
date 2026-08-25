// CLASH sim — ARENA mode. Fixed 60Hz tick, integers only, no rendering.
// The grammar: place a thing on a tile, it waits, it resolves as a cross
// along the corridors. Everything here is delay / radius / what-resolves.
//
// Determinism is load-bearing: all positions are sub-pixels (4 per px),
// all timers are ticks, and the only randomness is the seeded LCG.

export const GW = 32;
export const GH = 22;
export const TILE = 16;        // px
export const SUB = 4;          // sub-px per px
export const TS = TILE * SUB;  // sub-px per tile

export const enum T { FLOOR = 0, WALL = 1, BLOCK = 2 }

const HALF = 6 * SUB;    // player half-extent (12px box in a 16px corridor)
const ASSIST = 5 * SUB;  // corner assist window — THE number; tune with hands on keys
const BASE_SPEED = 3;    // sub-px per tick (~2.8 tiles/s)
const MAX_SPEED = 6;
const FUSE = 150;        // 2.5s — the Wick's candle
const FLAME_TTL = 30;
const BASE_RADIUS = 2;
const MAX_RADIUS = 5;
const MAX_CANDLES_CAP = 5;
const DEAD_TICKS = 90;
const ROUND_END = 150;
const PICKUP_CHANCE = 4; // out of 16 destroyed blocks

export const enum Pickup { FOCUS = 0, HAND = 1, BOOTS = 2 }

export interface Input {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  place: boolean;
}

export interface PlayerState {
  x: number; y: number;       // sub-px, centre
  fx: number; fy: number;     // facing (unit grid dir)
  alive: boolean;
  deadT: number;              // ticks since death, -1 alive
  speed: number;
  radius: number;
  maxCandles: number;
  wins: number;
  moving: boolean;
  axis: 0 | 1;                // preferred axis when both held (last successful)
}

export interface Candle {
  tx: number; ty: number;
  timer: number;
  owner: number;
  radius: number;
}

export interface PickupState { tx: number; ty: number; kind: Pickup }

export interface Game {
  grid: Uint8Array;                 // GW*GH bytes — the whole map
  flame: Int16Array;                // per-tile flame ttl
  players: PlayerState[];
  candles: Candle[];
  pickups: PickupState[];
  tick: number;
  roundEndT: number;                // -1 running, else countdown
  roundWinner: number;              // -1 none / draw
  rng: number;
}

const idx = (tx: number, ty: number) => ty * GW + tx;

function rand(g: Game): number {
  g.rng = (g.rng * 1664525 + 1013904223) >>> 0;
  return g.rng;
}

// --- map ------------------------------------------------------------------

function buildGrid(g: Game): void {
  const grid = g.grid;
  grid.fill(T.FLOOR);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const border = x === 0 || y === 0 || x === GW - 1 || y === GH - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) grid[idx(x, y)] = T.WALL;
    }
  // destructible blocks: mirrored where the lattice parity allows (the
  // 32x22 even-even lattice is not symmetric under 180 degrees, so odd-odd
  // tiles get an independent roll at the same rate — statistically fair)
  for (let y = 1; y < GH - 1; y++)
    for (let x = 1; x < GW - 1; x++) {
      if (grid[idx(x, y)] !== T.FLOOR) continue;
      const mx = GW - 1 - x, my = GH - 1 - y;
      const mirrorFloor = grid[idx(mx, my)] === T.FLOOR;
      if (mirrorFloor && (y > my || (y === my && x > mx))) continue; // pair handled once
      if (rand(g) % 16 < 7) {
        grid[idx(x, y)] = T.BLOCK;
        if (mirrorFloor) grid[idx(mx, my)] = T.BLOCK;
      }
    }
  // clear spawn pockets: the tile plus two steps toward the interior each way
  for (const [sx, sy] of SPAWNS) {
    const ix = sx < GW / 2 ? 1 : -1, iy = sy < GH / 2 ? 1 : -1;
    for (const [dx, dy] of [[0, 0], [ix, 0], [2 * ix, 0], [0, iy], [0, 2 * iy]]) {
      const i = idx(sx + dx, sy + dy);
      if (grid[i] === T.BLOCK) grid[i] = T.FLOOR;
    }
  }
}

// all odd coordinates, so nobody spawns inside the lattice
const SPAWNS: [number, number][] = [[1, 1], [GW - 3, GH - 3], [GW - 3, 1], [1, GH - 3]];

function spawnPlayers(g: Game): void {
  g.players.forEach((p, i) => {
    const [tx, ty] = SPAWNS[i % SPAWNS.length];
    p.x = tx * TS + TS / 2;
    p.y = ty * TS + TS / 2;
    p.fx = i % 2 === 0 ? 1 : -1;
    p.fy = 0;
    p.alive = true;
    p.deadT = -1;
    p.speed = BASE_SPEED;
    p.radius = BASE_RADIUS;
    p.maxCandles = 1;
    p.moving = false;
    p.axis = 0;
  });
}

export function createGame(numPlayers: number, seed: number): Game {
  const g: Game = {
    grid: new Uint8Array(GW * GH),
    flame: new Int16Array(GW * GH),
    players: Array.from({ length: numPlayers }, () => ({
      x: 0, y: 0, fx: 1, fy: 0, alive: true, deadT: -1,
      speed: BASE_SPEED, radius: BASE_RADIUS, maxCandles: 1,
      wins: 0, moving: false, axis: 0 as const,
    })),
    candles: [],
    pickups: [],
    tick: 0,
    roundEndT: -1,
    roundWinner: -1,
    rng: seed >>> 0,
  };
  buildGrid(g);
  spawnPlayers(g);
  return g;
}

function resetRound(g: Game): void {
  g.candles = [];
  g.pickups = [];
  g.flame.fill(0);
  buildGrid(g);
  spawnPlayers(g);
  g.roundEndT = -1;
  g.roundWinner = -1;
}

// --- movement -------------------------------------------------------------

function solidAt(g: Game, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return true;
  if (g.grid[idx(tx, ty)] !== T.FLOOR) return true;
  for (const c of g.candles) if (c.tx === tx && c.ty === ty) return true;
  return false;
}

const tileOf = (v: number) => Math.floor(v / TS);

function boxOverlapsTile(x: number, y: number, tx: number, ty: number): boolean {
  return (
    Math.abs(x - (tx * TS + TS / 2)) < TS / 2 + HALF &&
    Math.abs(y - (ty * TS + TS / 2)) < TS / 2 + HALF
  );
}

/**
 * Can the player's box sit at (x, y)? A solid tile the box ALREADY overlaps
 * (from its current position) never blocks — you can always walk out of a
 * thing, never back into it. This is how "pass through your own fresh
 * placement until you step off it" falls out for free, with no owner flag.
 */
function fits(g: Game, x: number, y: number, fromX: number, fromY: number): boolean {
  const x0 = tileOf(x - HALF), x1 = tileOf(x + HALF - 1);
  const y0 = tileOf(y - HALF), y1 = tileOf(y + HALF - 1);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (solidAt(g, tx, ty) && !boxOverlapsTile(fromX, fromY, tx, ty)) return false;
  return true;
}

/**
 * One axis of grid movement with corner assist: if the pushed direction is
 * blocked but the player is within ASSIST of the corridor's centre line on
 * the perpendicular axis — and the aligned position could go — spend the
 * tick sliding onto the line instead.
 */
function moveAxis(g: Game, p: PlayerState, dx: number, dy: number): boolean {
  const spd = p.speed;
  const nx = p.x + dx * spd, ny = p.y + dy * spd;
  if (fits(g, nx, ny, p.x, p.y)) {
    p.x = nx;
    p.y = ny;
    return true;
  }
  // corner assist on the perpendicular axis
  if (dx !== 0) {
    const cy = tileOf(p.y) * TS + TS / 2;
    const d = p.y - cy;
    if (d !== 0 && Math.abs(d) <= ASSIST && fits(g, p.x + dx * spd, cy, p.x, p.y)) {
      p.y -= Math.sign(d) * Math.min(spd, Math.abs(d));
      return true;
    }
  } else if (dy !== 0) {
    const cx = tileOf(p.x) * TS + TS / 2;
    const d = p.x - cx;
    if (d !== 0 && Math.abs(d) <= ASSIST && fits(g, cx, p.y + dy * spd, p.x, p.y)) {
      p.x -= Math.sign(d) * Math.min(spd, Math.abs(d));
      return true;
    }
  }
  return false;
}

// --- the verb -------------------------------------------------------------

function place(g: Game, pi: number): void {
  const p = g.players[pi];
  const tx = tileOf(p.x), ty = tileOf(p.y);
  if (g.candles.filter(c => c.owner === pi).length >= p.maxCandles) return;
  if (g.candles.some(c => c.tx === tx && c.ty === ty)) return;
  if (g.grid[idx(tx, ty)] !== T.FLOOR) return;
  g.candles.push({ tx, ty, timer: FUSE, owner: pi, radius: p.radius });
}

/**
 * The resolution queue. Everything whose timer hit zero resolves this tick;
 * a cross touching another placeable zeroes it and pushes it onto the same
 * queue. Chains are free and deterministic. Damage happens after ALL
 * crosses are computed — simultaneous deaths are genuinely simultaneous.
 */
function resolve(g: Game): void {
  const queue: number[] = [];
  g.candles.forEach((c, i) => {
    if (c.timer <= 0) queue.push(i);
  });
  if (queue.length === 0) return;

  const exploded = new Set<number>();
  const flamed: number[] = [];
  const destroyed: number[] = [];

  while (queue.length) {
    const ci = queue.shift()!;
    if (exploded.has(ci)) continue;
    exploded.add(ci);
    const c = g.candles[ci];
    flamed.push(idx(c.tx, c.ty));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = 1; r <= c.radius; r++) {
        const tx = c.tx + dx * r, ty = c.ty + dy * r;
        if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) break;
        const t = g.grid[idx(tx, ty)];
        if (t === T.WALL) break;
        if (t === T.BLOCK) {
          destroyed.push(idx(tx, ty));
          flamed.push(idx(tx, ty));
          break; // exactly one block per direction
        }
        flamed.push(idx(tx, ty));
        g.candles.forEach((o, oi) => {
          if (!exploded.has(oi) && o.tx === tx && o.ty === ty) {
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
  for (const i of flamed) g.flame[i] = FLAME_TTL;
  g.candles = g.candles.filter((_, i) => !exploded.has(i));
  // flame eats pickups lying in the open
  g.pickups = g.pickups.filter(pk => g.flame[idx(pk.tx, pk.ty)] <= 0);
}

// --- tick -----------------------------------------------------------------

export function step(g: Game, inputs: Input[]): void {
  g.tick++;

  // round countdown / reset
  if (g.roundEndT >= 0) {
    g.roundEndT--;
    if (g.roundEndT <= 0) resetRound(g);
  }

  // players
  g.players.forEach((p, pi) => {
    if (!p.alive) {
      p.deadT++;
      return;
    }
    const inp = inputs[pi] ?? { dx: 0, dy: 0, place: false };
    if (inp.place) place(g, pi);

    p.moving = false;
    const want: [number, number][] = [];
    if (inp.dx !== 0) want.push([inp.dx, 0]);
    if (inp.dy !== 0) want.push([0, inp.dy]);
    if (want.length === 2 && p.axis === 1) want.reverse();
    for (const [dx, dy] of want) {
      if (moveAxis(g, p, dx, dy)) {
        p.moving = true;
        p.fx = dx; p.fy = dy;
        p.axis = dx !== 0 ? 0 : 1;
        break;
      }
    }

    const tx = tileOf(p.x), ty = tileOf(p.y);
    // pickups
    g.pickups = g.pickups.filter(pk => {
      if (pk.tx !== tx || pk.ty !== ty) return true;
      if (pk.kind === Pickup.FOCUS) p.radius = Math.min(MAX_RADIUS, p.radius + 1);
      if (pk.kind === Pickup.HAND) p.maxCandles = Math.min(MAX_CANDLES_CAP, p.maxCandles + 1);
      if (pk.kind === Pickup.BOOTS) p.speed = Math.min(MAX_SPEED, p.speed + 1);
      return false;
    });
  });

  // fuses
  for (const c of g.candles) c.timer--;
  resolve(g);

  // flames + damage (after resolution: simultaneous is simultaneous)
  for (let i = 0; i < g.flame.length; i++) if (g.flame[i] > 0) g.flame[i]--;
  const dying: number[] = [];
  g.players.forEach((p, pi) => {
    if (!p.alive) return;
    if (g.flame[idx(tileOf(p.x), tileOf(p.y))] > 0) dying.push(pi);
  });
  for (const pi of dying) {
    g.players[pi].alive = false;
    g.players[pi].deadT = 0;
  }

  // round end
  if (g.roundEndT < 0) {
    const alive = g.players.filter(p => p.alive);
    if (alive.length <= 1 && g.players.length > 1) {
      g.roundEndT = ROUND_END;
      if (alive.length === 1) {
        g.roundWinner = g.players.indexOf(alive[0]);
        alive[0].wins++;
      } else {
        g.roundWinner = -1; // simultaneous deaths: a draw, and it should be possible
      }
    }
  }
}

export const DEAD_TICKS_TOTAL = DEAD_TICKS;
