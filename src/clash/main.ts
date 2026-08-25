// CLASH — ARENA mode. Two players, one keyboard, one class. If this isn't
// fun, nothing built on top of it will be.

import { createGame, step, Input } from './sim';
import { ClashDraw } from './draw';

const NUM_PLAYERS = 2;
const TICK_MS = 1000 / 60;

const game = createGame(NUM_PLAYERS, 0xC1A54);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const draw = new ClashDraw(canvas, NUM_PLAYERS);
const status = document.getElementById('status')!;
const toastEl = document.getElementById('toast')!;

// --- input: local multiplayer on one keyboard is a first-class feature ----
const held = new Set<string>();
const placedEdge = [false, false]; // place fires on press, not hold
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter'].includes(e.key.toLowerCase()) ||
      ['w', 'a', 's', 'd', 'f'].includes(k)) e.preventDefault();
  if (!held.has(k)) {
    if (k === 'f' || k === ' ') placedEdge[0] = true;
    if (k === 'enter') placedEdge[1] = true;
  }
  held.add(k);
});
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));

function readInputs(): Input[] {
  const p1: Input = {
    dx: (held.has('d') ? 1 : 0) + (held.has('a') ? -1 : 0) as Input['dx'],
    dy: (held.has('s') ? 1 : 0) + (held.has('w') ? -1 : 0) as Input['dy'],
    place: placedEdge[0],
  };
  const p2: Input = {
    dx: (held.has('arrowright') ? 1 : 0) + (held.has('arrowleft') ? -1 : 0) as Input['dx'],
    dy: (held.has('arrowdown') ? 1 : 0) + (held.has('arrowup') ? -1 : 0) as Input['dy'],
    place: placedEdge[1],
  };
  placedEdge[0] = placedEdge[1] = false;
  return [p1, p2];
}

// --- loop: fixed 60Hz sim, render on rAF ----------------------------------
let acc = 0;
let last = performance.now();
let lastWinner = -2;

function frame(now: number) {
  acc += Math.min(250, now - last);
  last = now;
  while (acc >= TICK_MS) {
    step(game, readInputs());
    acc -= TICK_MS;
  }
  draw.render(game);

  if (game.roundEndT > 0 && lastWinner !== game.roundWinner) {
    lastWinner = game.roundWinner;
    toast(game.roundWinner === -1 ? 'DRAW' : `PLAYER ${game.roundWinner + 1} TAKES IT`);
  }
  if (game.roundEndT < 0) lastWinner = -2;

  const p = game.players;
  status.innerHTML =
    `<b class="p1">P1</b> ${p[0].wins}  ·  <b class="p2">P2</b> ${p[1].wins}` +
    `  &nbsp; r${p[0].radius}/${p[1].radius} c${p[0].maxCandles}/${p[1].maxCandles}`;
  requestAnimationFrame(frame);
}

function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1600);
}

requestAnimationFrame(frame);

// deterministic outside control: tests and hidden-pane verification
(window as any).clash = {
  game,
  step: (n = 1, inputs?: Input[]) => {
    for (let i = 0; i < n; i++)
      step(game, inputs ?? [{ dx: 0, dy: 0, place: false }, { dx: 0, dy: 0, place: false }]);
    draw.render(game);
  },
  state: () => ({
    tick: game.tick,
    players: game.players.map(p => ({
      tx: Math.floor(p.x / 64), ty: Math.floor(p.y / 64),
      x: p.x, y: p.y, alive: p.alive, wins: p.wins,
      radius: p.radius, candles: p.maxCandles, speed: p.speed,
    })),
    candles: game.candles.length,
    flames: Array.from(game.flame).filter(f => f > 0).length,
    blocks: Array.from(game.grid).filter(t => t === 2).length,
    pickups: game.pickups.length,
    roundEndT: game.roundEndT,
    winner: game.roundWinner,
  }),
};
