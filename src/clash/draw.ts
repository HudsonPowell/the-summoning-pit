// CLASH renderer: flat colour on black at native 512x352, integer-scaled.
// Value hierarchy is a rule: walls dark (recede), blocks mid (readable as
// breakable), interactive bright. The figures are not sprites — they are
// rig genomes rendered flat at ~22px through the bone-field renderer.

import { Game, GW, GH, TILE, SUB, T, Pickup, Candle } from './sim';
import { Genome, defaultBiped, scaleSkeleton, Mood } from '../genome';
import { solvePose } from '../pose';
import { PixelRenderer, Camera } from '../render';

export const NATIVE_W = GW * TILE; // 512
export const NATIVE_H = GH * TILE; // 352

// the sixteen inks (subset in use); players are the brightest things on screen
const INK = {
  bg: '#050508',
  floorA: '#0d0f16',
  floorB: '#0b0d13',
  wall: '#1f2230',
  wallTop: '#272b3c',
  block: '#4a5266',
  blockCut: '#343a4a',
  flame: '#ffd25e',
  flameCore: '#fff3c4',
  focus: '#e2953c',
  hand: '#d8dce6',
  boots: '#5fbf6e',
};

const PLAYER_INKS: [string, string][] = [
  ['#3ec5c9', '#9fe8ea'], // the Wick — cyan
  ['#e2c93c', '#f4e9a0'], // the Chalk's ink (same class mechanically, v1)
  ['#c94ec9', '#eaa0ea'],
  ['#e8e8e8', '#ffffff'],
];

interface FigureState {
  phase: number;
  lastX: number;
  lastY: number;
}

const CELL = 30; // figure render cell, px
const PPM = 13;  // scout (~1.7m) -> ~22px tall

export class ClashDraw {
  private ctx: CanvasRenderingContext2D;
  private native: HTMLCanvasElement;
  private nctx: CanvasRenderingContext2D;
  private figRenderer = new PixelRenderer(CELL, CELL + 6);
  private figBuf = new Uint8ClampedArray(CELL * (CELL + 6) * 4);
  private figCanvas: HTMLCanvasElement;
  private figCtx: CanvasRenderingContext2D;
  private figs: FigureState[] = [];
  private genomes: Genome[];

  constructor(display: HTMLCanvasElement, numPlayers: number) {
    this.ctx = display.getContext('2d')!;
    this.native = document.createElement('canvas');
    this.native.width = NATIVE_W;
    this.native.height = NATIVE_H;
    this.nctx = this.native.getContext('2d')!;
    this.figCanvas = document.createElement('canvas');
    this.figCanvas.width = CELL;
    this.figCanvas.height = CELL + 6;
    this.figCtx = this.figCanvas.getContext('2d')!;
    this.genomes = Array.from({ length: numPlayers }, (_, i) => {
      const g = defaultBiped();
      // chunkier at sprite scale: thin limbs vanish at 22px
      g.skeleton = scaleSkeleton(g.skeleton, { legs: 1, arms: 1, head: 1.15, bulk: 1.7, width: 1 });
      g.palette = {
        torso: PLAYER_INKS[i][0],
        limbs: PLAYER_INKS[i][0],
        head: PLAYER_INKS[i][1],
        accent: PLAYER_INKS[i][1],
      };
      delete g.weapon;
      return g;
    });
    this.figs = Array.from({ length: numPlayers }, () => ({ phase: 0, lastX: 0, lastY: 0 }));
  }

  private tileHash(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) >>> 0;
  }

  render(g: Game): void {
    const c = this.nctx;
    c.fillStyle = INK.bg;
    c.fillRect(0, 0, NATIVE_W, NATIVE_H);

    // floor -> props ------------------------------------------------------
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const t = g.grid[y * GW + x];
        const px = x * TILE, py = y * TILE;
        if (t === T.FLOOR) {
          c.fillStyle = (x + y) % 2 === 0 ? INK.floorA : INK.floorB;
          c.fillRect(px, py, TILE, TILE);
          // per-tile decoration seeded from coordinates — texture with no data
          const h = this.tileHash(x, y);
          if (h % 11 === 0) {
            c.fillStyle = '#12141d';
            c.fillRect(px + (h % 12), py + ((h >> 4) % 12), 2, 2);
          }
        } else if (t === T.WALL) {
          c.fillStyle = INK.wall;
          c.fillRect(px, py, TILE, TILE);
          c.fillStyle = INK.wallTop;
          c.fillRect(px, py, TILE, 4);
        } else {
          // destructible: mid value, detail as negative space
          c.fillStyle = INK.block;
          c.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          c.fillStyle = INK.blockCut;
          c.fillRect(px + 4, py + 4, 3, 3);
          c.fillRect(px + 9, py + 8, 4, 3);
          c.fillRect(px + 3, py + 11, 3, 2);
        }
      }

    // pickups (bright: you can act on them) -------------------------------
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

    // placeables ----------------------------------------------------------
    for (const cd of g.candles) this.drawCandle(cd, g);

    // effects: the cross --------------------------------------------------
    for (let i = 0; i < g.flame.length; i++) {
      const ttl = g.flame[i];
      if (ttl <= 0) continue;
      const px = (i % GW) * TILE, py = Math.floor(i / GW) * TILE;
      c.fillStyle = INK.flame;
      c.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      if (ttl > 10) {
        c.fillStyle = INK.flameCore;
        c.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
      }
    }

    // players -------------------------------------------------------------
    g.players.forEach((p, pi) => this.drawPlayer(g, pi));

    // UI: wins as pips in the corners -------------------------------------
    g.players.forEach((p, pi) => {
      c.fillStyle = PLAYER_INKS[pi][0];
      const left = pi % 2 === 0;
      for (let w = 0; w < p.wins; w++) {
        const x = left ? 4 + w * 6 : NATIVE_W - 8 - w * 6;
        c.fillRect(x, 4, 4, 4);
      }
    });

    // integer upscale to the display canvas
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.native, 0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  private drawCandle(cd: Candle, g: Game): void {
    const c = this.nctx;
    const ink = PLAYER_INKS[cd.owner][0];
    const px = cd.tx * TILE, py = cd.ty * TILE;
    // the timer is an object on the board: the candle visibly shortens
    const frac = Math.max(0, cd.timer) / 150;
    const bodyH = 3 + Math.round(7 * frac);
    c.fillStyle = ink;
    c.fillRect(px + 6, py + TILE - 2 - bodyH, 4, bodyH);
    // flame tip pulses faster as it burns down
    const pulse = (g.tick >> (frac > 0.3 ? 3 : 1)) % 2 === 0;
    c.fillStyle = pulse ? INK.flameCore : INK.flame;
    c.fillRect(px + 7, py + TILE - 4 - bodyH, 2, 2);
  }

  private drawPlayer(g: Game, pi: number): void {
    const p = g.players[pi];
    const f = this.figs[pi];
    if (!p.alive && p.deadT > 90) return;

    const pxf = p.x / SUB; // sub-px -> native px
    const pyf = p.y / SUB;
    // advance gait phase from actual distance travelled
    const dist = Math.hypot(pxf - f.lastX, pyf - f.lastY);
    f.lastX = pxf;
    f.lastY = pyf;
    if (p.moving) f.phase = (f.phase + dist / 22) % 1;

    const mood: Mood = { tired: 0, angry: 0 };
    const collapse = p.alive ? 0 : Math.min(1, p.deadT / 27);
    const caps = solvePose(this.genomes[pi], mood, f.phase, p.moving ? 1 : 0, g.tick / 60, undefined, collapse);

    // facing: the creature walks along its local +x; rotY maps +x to view
    // (cos yaw, 0, -sin yaw), and larger view-z is nearer the camera. So:
    // right = slight 3/4 profile; up (away) = +1.35 rear 3/4; down (toward)
    // = -1.35 front 3/4; left = the right profile mirrored by canvas flip.
    let yaw = 0.45;
    let flip = false;
    if (p.fy < 0) yaw = 1.35;
    else if (p.fy > 0) yaw = -1.35;
    else if (p.fx < 0) flip = true;

    const cam: Camera = { yaw, pitch: 0.28, ppm: PPM, cy: 0.8, flat: true, floor: false };
    this.figRenderer.render(this.figBuf, caps, cam, 0);
    const img = new ImageData(new Uint8ClampedArray(this.figBuf), CELL, CELL + 6);
    this.figCtx.clearRect(0, 0, CELL, CELL + 6);
    this.figCtx.putImageData(img, 0, 0);

    const c = this.nctx;
    const dx = Math.round(pxf) - CELL / 2;
    const dy = Math.round(pyf) - (CELL + 6) + 10; // feet near the tile's base
    if (flip) {
      c.save();
      c.translate(Math.round(pxf), 0);
      c.scale(-1, 1);
      c.drawImage(this.figCanvas, -CELL / 2, dy);
      c.restore();
    } else {
      c.drawImage(this.figCanvas, dx, dy);
    }
  }
}
