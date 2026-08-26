// CLASH renderer: flat colour on black at native 512x352, integer-scaled.
// Players are the characters you built in the forge — their genome walks,
// their weapon swings, their blast colours burn. Beasts come off the
// bestiary shelf. There are no sprites anywhere.

import {
  Game, GW, GH, TILE, SUB, T, Pickup, Candle, Beast, Pattern,
  STRIKE_TICKS, BITE_TOTAL, BITE_WINDUP,
} from './sim';
import { Genome, Mood, scaleSkeleton, heightOf } from '../genome';
import { Character, StrikeSpec, DEFAULT_STRIKE_LIGHT } from '../character';
import { solvePose, slashWeight, Intent, Capsule } from '../pose';
import { rotY, TAU } from '../vec';
import { PixelRenderer, Camera } from '../render';

export const NATIVE_W = GW * TILE;
export const NATIVE_H = GH * TILE;

export interface RenderSettings {
  figureStyle: 'flat' | 'shaded';
  boardTone: number; // 0.6 .. 1.5 multiplier on board inks
  blend: number;     // soft-field softness for figures, px
}
export const DEFAULT_SETTINGS: RenderSettings = { figureStyle: 'flat', boardTone: 1, blend: 0 };

const INK = {
  bg: '#050508',
  floorA: '#0d0f16',
  floorB: '#0b0d13',
  deco: '#12141d',
  wall: '#1f2230',
  wallTop: '#272b3c',
  block: '#4a5266',
  blockCut: '#343a4a',
  focus: '#e2953c',
  hand: '#d8dce6',
  boots: '#5fbf6e',
};

interface FigureState {
  phase: number;
  lastX: number;
  lastY: number;
  heading: number; // smoothed, presentation-only — the sim stays integer
}

const TURN_RATE = 16; // radians-ish per second of exponential approach
const PRESS_PX = 1.6;  // how far the body lays into a wall it cannot pass

const CELL = 34;
const CELL_H = 40;

function toneHex(hexCol: string, tone: number): string {
  const n = parseInt(hexCol.slice(1), 16);
  const c = (v: number) => Math.min(255, Math.round(v * tone));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export class ClashDraw {
  private ctx: CanvasRenderingContext2D;
  private native: HTMLCanvasElement;
  private nctx: CanvasRenderingContext2D;
  private figRenderer = new PixelRenderer(CELL, CELL_H);
  private figBuf = new Uint8ClampedArray(CELL * CELL_H * 4);
  private figCanvas: HTMLCanvasElement;
  private figCtx: CanvasRenderingContext2D;
  private playerFigs: FigureState[] = [];
  private beastFigs = new Map<Beast, FigureState>();
  private heroes: Character[];
  private heroGenomes: Genome[];
  private beastChars: Character[];
  private beastGenomes: Genome[];
  settings: RenderSettings;
  private dt = 1 / 60;

  constructor(
    display: HTMLCanvasElement,
    heroes: Character[],
    beasts: Character[],
    settings: RenderSettings,
  ) {
    this.ctx = display.getContext('2d')!;
    this.native = document.createElement('canvas');
    this.native.width = NATIVE_W;
    this.native.height = NATIVE_H;
    this.nctx = this.native.getContext('2d')!;
    this.figCanvas = document.createElement('canvas');
    this.figCanvas.width = CELL;
    this.figCanvas.height = CELL_H;
    this.figCtx = this.figCanvas.getContext('2d')!;
    this.settings = settings;
    this.heroes = heroes;
    this.heroGenomes = heroes.map(h => this.bulked(h.genome));
    this.beastChars = beasts;
    this.beastGenomes = beasts.map(b => this.bulked(b.genome));
    this.playerFigs = heroes.map(() => ({ phase: 0, lastX: 0, lastY: 0, heading: 0 }));
  }

  private bulked(g: Genome): Genome {
    return { ...g, skeleton: scaleSkeleton(g.skeleton, { legs: 1, arms: 1, head: 1.1, bulk: 1.6, width: 1 }) };
  }


  private tileHash(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) >>> 0;
  }

  render(g: Game, shakeX = 0, shakeY = 0, dt = 1 / 60): void {
    this.dt = dt;
    const c = this.nctx;
    const tone = this.settings.boardTone;
    c.fillStyle = INK.bg;
    c.fillRect(0, 0, NATIVE_W, NATIVE_H);

    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const t = g.grid[y * GW + x];
        const px = x * TILE, py = y * TILE;
        if (t === T.FLOOR) {
          c.fillStyle = toneHex((x + y) % 2 === 0 ? INK.floorA : INK.floorB, tone);
          c.fillRect(px, py, TILE, TILE);
          const h = this.tileHash(x, y);
          if (h % 11 === 0) {
            c.fillStyle = toneHex(INK.deco, tone);
            c.fillRect(px + (h % 12), py + ((h >> 4) % 12), 2, 2);
          }
        } else if (t === T.WALL) {
          c.fillStyle = toneHex(INK.wall, tone);
          c.fillRect(px, py, TILE, TILE);
          c.fillStyle = toneHex(INK.wallTop, tone);
          c.fillRect(px, py, TILE, 4);
        } else {
          c.fillStyle = toneHex(INK.block, tone);
          c.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          c.fillStyle = toneHex(INK.blockCut, tone);
          c.fillRect(px + 4, py + 4, 3, 3);
          c.fillRect(px + 9, py + 8, 4, 3);
          c.fillRect(px + 3, py + 11, 3, 2);
        }
      }

    for (const pk of g.pickups) {
      const px = pk.tx * TILE + 8, py = pk.ty * TILE + 8;
      if (pk.kind === Pickup.FOCUS) {
        c.fillStyle = INK.focus;
        c.beginPath();
        c.moveTo(px, py - 5); c.lineTo(px + 5, py); c.lineTo(px, py + 5); c.lineTo(px - 5, py);
        c.fill();
      } else if (pk.kind === Pickup.HAND) {
        c.fillStyle = INK.hand;
        c.fillRect(px - 5, py - 3, 4, 6);
        c.fillRect(px + 1, py - 3, 4, 6);
      } else {
        c.fillStyle = INK.boots;
        c.fillRect(px - 5, py - 4, 4, 8);
        c.fillRect(px - 5, py + 2, 8, 2);
      }
    }

    // the Still's slicks lie on the floor, waiting
    for (let i = 0; i < g.oil.length; i++) {
      if (g.oil[i] === 0) continue;
      const hero = this.heroes[g.oil[i] - 1];
      const px = (i % GW) * TILE, py = Math.floor(i / GW) * TILE;
      c.fillStyle = hero?.blast.edge ?? '#3a2a4a';
      c.globalAlpha = 0.35;
      c.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      c.globalAlpha = 1;
      c.fillStyle = hero?.blast.core ?? '#6a5a7a';
      c.fillRect(px + 5, py + 6, 3, 2);
      c.fillRect(px + 9, py + 9, 2, 2);
    }

    // the Warden's grown walls
    for (let i = 0; i < g.vine.length; i++) {
      const ttl = g.vine[i];
      if (ttl <= 0) continue;
      const hero = this.heroes[g.vineOwner[i]];
      const px = (i % GW) * TILE, py = Math.floor(i / GW) * TILE;
      const dying = ttl < 60 && (g.tick >> 2) % 2 === 0;
      c.fillStyle = dying ? (hero?.blast.core ?? '#9fe0a0') : (hero?.blast.edge ?? '#4a8a4e');
      c.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      c.fillStyle = hero?.blast.core ?? '#9fe0a0';
      c.fillRect(px + 3, py + 3, 2, TILE - 6);
      c.fillRect(px + 7, py + 5, 2, TILE - 8);
      c.fillRect(px + 11, py + 2, 2, TILE - 5);
    }

    for (const cd of g.candles) this.drawCandle(cd, g);
    this.drawFlames(g);

    for (const b of g.beasts) this.drawBeast(g, b);
    g.players.forEach((_, pi) => this.drawPlayer(g, pi));

    // wins as pips
    g.players.forEach((p, pi) => {
      c.fillStyle = this.heroes[pi]?.blast.edge ?? '#fff';
      const left = pi % 2 === 0;
      for (let w = 0; w < p.wins; w++) {
        const x = left ? 4 + w * 6 : NATIVE_W - 8 - w * 6;
        c.fillRect(x, 4, 4, 4);
      }
    });

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = INK.bg;
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    const sx = Math.round(shakeX * (this.ctx.canvas.width / NATIVE_W));
    const sy = Math.round(shakeY * (this.ctx.canvas.height / NATIVE_H));
    this.ctx.drawImage(this.native, sx, sy, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  private drawCandle(cd: Candle, g: Game): void {
    const c = this.nctx;
    const hero = this.heroes[cd.owner];
    const edge = hero?.blast.edge ?? '#ffd25e';
    const core = hero?.blast.core ?? '#fff3c4';
    const px = cd.walking ? Math.round(cd.wx / SUB) - TILE / 2 : cd.tx * TILE;
    const py = cd.walking ? Math.round(cd.wy / SUB) - TILE / 2 : cd.ty * TILE;
    const frac = Math.max(0, cd.timer) / cd.fuse;
    if (cd.pattern === Pattern.CURSE) {
      // hidden information: a faint smudge only, until the instant it fires
      c.globalAlpha = 0.22;
      c.fillStyle = edge;
      c.fillRect(px + 7, py + 7, 2, 2);
      c.globalAlpha = 1;
      return;
    }
    if (cd.walking) {
      // the Horn's imp waddles with a bobbing body
      const bob = (g.tick >> 2) % 2;
      c.fillStyle = edge;
      c.fillRect(px + 4, py + 5 + bob, 8, 7);
      c.fillStyle = core;
      c.fillRect(px + 6, py + 3 + bob, 4, 3);
      c.fillRect(px + 5, py + 12, 2, 2);
      c.fillRect(px + 9, py + 12, 2, 2);
      return;
    }
    if (cd.pattern === Pattern.BELL) {
      const r = 3 + Math.round(4 * (1 - frac));
      c.fillStyle = edge;
      c.fillRect(px + 8 - r, py + 8 - r, r * 2, r * 2);
      c.fillStyle = core;
      c.fillRect(px + 7, py + 5, 2, 6);
      return;
    }
    if (cd.pattern === Pattern.RUNE) {
      // scuff progress reads as the sigil being rubbed away
      const scuffed = cd.scuffT > 0;
      c.fillStyle = edge;
      c.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
      c.fillStyle = scuffed
        ? '#1a1c24'
        : frac < 0.3 && (g.tick >> 2) % 2 === 0
        ? core
        : toneHex(core, 0.5 + 0.5 * (1 - frac));
      c.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
      return;
    }
    if (false) {
      // a sigil that brightens as it arms
      c.fillStyle = edge;
      c.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
      c.fillStyle = frac < 0.3 && (g.tick >> 2) % 2 === 0 ? core : toneHex(core, 0.5 + 0.5 * (1 - frac));
      c.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
    } else if (cd.pattern === Pattern.VINE) {
      const h = 3 + Math.round(9 * (1 - frac));
      c.fillStyle = edge;
      c.fillRect(px + 7, py + TILE - 2 - h, 3, h);
      c.fillStyle = core;
      c.fillRect(px + 5, py + TILE - 2 - Math.max(2, h - 3), 2, 2);
      c.fillRect(px + 10, py + TILE - 2 - Math.max(3, h - 1), 2, 2);
    } else {
      const bodyH = 3 + Math.round(7 * frac);
      c.fillStyle = edge;
      c.fillRect(px + 6, py + TILE - 2 - bodyH, 4, bodyH);
      const pulse = (g.tick >> (frac > 0.3 ? 3 : 1)) % 2 === 0;
      c.fillStyle = pulse ? core : edge;
      c.fillRect(px + 7, py + TILE - 4 - bodyH, 2, 2);
    }
  }

  private drawFlames(g: Game): void {
    const c = this.nctx;
    for (let i = 0; i < g.flame.length; i++) {
      const ttl = g.flame[i];
      if (ttl <= 0) continue;
      const hero = this.heroes[g.flameOwner[i]];
      const core = hero?.blast.core ?? '#fff3c4';
      const edge = hero?.blast.edge ?? '#ffd25e';
      const pattern = hero?.blast.pattern ?? 'flame';
      const px = (i % GW) * TILE, py = Math.floor(i / GW) * TILE;
      if (g.flameSoft[i] === 1) {
        // the Peal's ring: a bright hoop that pushes but never kills
        c.strokeStyle = core;
        c.lineWidth = 2;
        c.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        continue;
      }
      if (pattern === 'rune') {
        c.fillStyle = edge;
        c.beginPath();
        c.arc(px + 8, py + 8, 7, 0, Math.PI * 2);
        c.fill();
        if (ttl > 10) {
          c.fillStyle = core;
          c.beginPath();
          c.arc(px + 8, py + 8, 4, 0, Math.PI * 2);
          c.fill();
        }
      } else if (pattern === 'vine') {
        c.fillStyle = edge;
        for (const off of [2, 7, 12]) c.fillRect(px + off, py + 2, 3, TILE - 4);
        if (ttl > 10) {
          c.fillStyle = core;
          c.fillRect(px + 7, py + 4, 3, TILE - 8);
        }
      } else {
        c.fillStyle = edge;
        c.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        if (ttl > 10) {
          c.fillStyle = core;
          c.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
        }
      }
    }
  }

  /**
   * The figure is turned to its actual heading and drawn by one fixed camera,
   * instead of being snapped between four hand-picked camera yaws. Any angle
   * works, so diagonals orient properly and turns read as turns.
   */
  private figCam(g: Genome): Camera {
    const h = heightOf(g);
    const ppm = Math.min(15, 24 / h);
    return {
      yaw: 0, pitch: 0.3, ppm, cy: h * 0.47,
      flat: this.settings.figureStyle === 'flat', floor: false,
      blend: this.settings.blend, blendDepth: 0.35, blendMix: 1, blendShape: 0.5,
    };
  }

  /**
   * Turn the body toward what the hands asked for — including diagonals the
   * four-way maze will never actually let you walk. Pressing left while
   * running up a corridor keeps you moving up but swings the body round to
   * lean into the wall. Exponential, so the rate is the same at any fps.
   */
  private turn(f: FigureState, fx: number, fy: number): void {
    if (fx === 0 && fy === 0) return;
    const target = Math.atan2(fy, fx);
    let d = target - f.heading;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    f.heading += d * (1 - Math.exp(-TURN_RATE * this.dt));
  }

  private oriented(caps: Capsule[], heading: number): Capsule[] {
    return caps.map(c => ({ ...c, a: rotY(c.a, -heading), b: rotY(c.b, -heading) }));
  }

  private shadow(pxf: number, pyf: number, w = 10): void {
    const c = this.nctx;
    c.fillStyle = '#06070b';
    c.fillRect(Math.round(pxf) - w / 2, Math.round(pyf) + 3, w, 3);
  }

  private blit(pxf: number, pyf: number, flip: boolean): void {
    const img = new ImageData(new Uint8ClampedArray(this.figBuf), CELL, CELL_H);
    this.figCtx.clearRect(0, 0, CELL, CELL_H);
    this.figCtx.putImageData(img, 0, 0);
    const c = this.nctx;
    const dy = Math.round(pyf) - CELL_H + 12;
    if (flip) {
      c.save();
      c.translate(Math.round(pxf), 0);
      c.scale(-1, 1);
      c.drawImage(this.figCanvas, -CELL / 2, dy);
      c.restore();
    } else {
      c.drawImage(this.figCanvas, Math.round(pxf) - CELL / 2, dy);
    }
  }

  private drawPlayer(g: Game, pi: number): void {
    const p = g.players[pi];
    const f = this.playerFigs[pi];
    const hero = this.heroes[pi];
    const genome = this.heroGenomes[pi];
    if (!genome || (!p.alive && p.deadT > 90)) return;

    const pxf = p.x / SUB, pyf = p.y / SUB;
    const dist = Math.hypot(pxf - f.lastX, pyf - f.lastY);
    f.lastX = pxf; f.lastY = pyf;
    if (p.moving) f.phase = (f.phase + dist / 22) % 1;

    const hurtFlash = p.hurtT > 0 && (g.tick >> 2) % 2 === 0;
    const mood: Mood = { tired: 0, angry: p.strikeT >= 0 ? 0.5 : 0 };
    const collapse = p.alive ? 0 : Math.min(1, p.deadT / 27);
    let intent: Intent | undefined;
    if (p.strikeT >= 0) {
      const spec: StrikeSpec =
        (hero?.behaviors['attack-light'] as { strike?: StrikeSpec } | undefined)?.strike ??
        DEFAULT_STRIKE_LIGHT;
      const t = p.strikeT / STRIKE_TICKS;
      intent = { slash: { t, weight: slashWeight(t), spec } };
    }
    const caps = solvePose(genome, mood, f.phase, p.moving ? 1 : 0, g.tick / 60, intent, collapse, {
      weapon: hero?.weapon,
      offhand: hero?.offhand,
    });
    if (hurtFlash)
      for (const cp of caps) cp.color = [255, 235, 235];

    // the body follows intent; gameplay (strike arc, imp direction) still
    // reads the four-way p.fx/p.fy, so the grammar is untouched
    this.turn(f, p.ix, p.iy);
    const leanX = p.pressX * PRESS_PX;
    const leanY = p.pressY * PRESS_PX;
    this.shadow(pxf, pyf);
    this.figRenderer.render(this.figBuf, this.oriented(caps, f.heading), this.figCam(genome), 0);
    this.blit(pxf + leanX, pyf + leanY, false);
  }

  private drawBeast(g: Game, b: Beast): void {
    const ch = this.beastChars[b.def];
    const genome = this.beastGenomes[b.def];
    if (!genome || b.deadT > 90) return;
    let f = this.beastFigs.get(b);
    if (!f) {
      f = { phase: Math.random(), lastX: b.x / SUB, lastY: b.y / SUB, heading: Math.atan2(b.fy, b.fx) };
      this.beastFigs.set(b, f);
    }
    const pxf = b.x / SUB, pyf = b.y / SUB;
    const dist = Math.hypot(pxf - f.lastX, pyf - f.lastY);
    f.lastX = pxf; f.lastY = pyf;
    if (b.moving) f.phase = (f.phase + dist / 22) % 1;

    const collapse = b.deadT >= 0 ? Math.min(1, b.deadT / 27) : 0;
    const hurtFlash = b.hurtT > 0 && (g.tick >> 2) % 2 === 0;
    let intent;
    if (b.biteT >= 0) {
      const spec =
        (ch?.behaviors['attack-light'] as { strike?: StrikeSpec } | undefined)?.strike ??
        DEFAULT_STRIKE_LIGHT;
      const t = b.biteT / BITE_TOTAL;
      intent = { slash: { t, weight: slashWeight(t), spec } };
    }
    const caps = solvePose(
      genome,
      { tired: 0, angry: b.biteT >= 0 ? 1 : 0.3 },
      f.phase,
      b.moving ? 1 : 0,
      g.tick / 60,
      intent,
      collapse,
      { weapon: ch?.weapon, offhand: ch?.offhand },
    );
    if (hurtFlash)
      for (const cp of caps) cp.color = [255, 235, 235];
    this.turn(f, b.fx, b.fy);
    this.shadow(pxf, pyf, 12);
    this.figRenderer.render(this.figBuf, this.oriented(caps, f.heading), this.figCam(genome), 0);
    this.blit(pxf, pyf, false);
    // the telegraph everyone can read: ! over a beast about to lunge
    if (b.biteT >= 0 && b.biteT < BITE_WINDUP) {
      const c = this.nctx;
      c.fillStyle = '#ffd25e';
      const bx = Math.round(pxf), by = Math.round(pyf) - CELL_H + 6;
      c.fillRect(bx - 1, by, 2, 5);
      c.fillRect(bx - 1, by + 7, 2, 2);
    }
  }
}
