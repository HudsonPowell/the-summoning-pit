// CLASH — ARENA mode. Pick a hero you built in the forge, fight the other
// player and whatever crawled off the bestiary shelf.

import { createGame, step, Input, PLAYER_HP, GameCfg, GameEvent, Pattern, PATTERN_NAMES } from './sim';
import { ClashAudio } from './audio';
import { ClashDraw, RenderSettings, DEFAULT_SETTINGS } from './draw';
import { Character, makeCharacter, migrateCharacter } from '../character';
import { defaultBiped, walkSpeed } from './helpers';

const NUM_PLAYERS = 2;
const TICK_MS = 1000 / 60;
const CFG_KEY = 'clash-cfg';

interface SavedCfg {
  heroes: [string, string]; // slugs
  settings: RenderSettings;
  scale: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '');

function loadCfg(): SavedCfg {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const c = JSON.parse(raw) as SavedCfg;
      return {
        heroes: c.heroes ?? ['scout', 'scout'],
        settings: { ...DEFAULT_SETTINGS, ...(c.settings ?? {}) },
        scale: c.scale ?? 2,
      };
    }
  } catch { /* fresh */ }
  return { heroes: ['scout', 'scout'], settings: { ...DEFAULT_SETTINGS }, scale: 2 };
}
let saved = loadCfg();
function persist() {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(saved)); } catch { /* full */ }
}

// --- load the roster --------------------------------------------------------

async function fetchAll(api: string): Promise<any[]> {
  try {
    const r = await fetch(api);
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

async function loadRoster(): Promise<{ all: Character[]; heroes: Character[]; beasts: Character[] }> {
  const seen = new Set<string>();
  const all: Character[] = [];
  for (const raw of [...(await fetchAll('/api/characters')), ...(await fetchAll('/api/genome'))]) {
    try {
      const ch = migrateCharacter(raw);
      const key = slug(ch.name);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(ch);
    } catch { /* skip corrupt */ }
  }
  const scout = makeCharacter(defaultBiped(), 'hero');
  scout.name = 'scout';
  if (!seen.has('scout')) all.unshift(scout);
  const heroes = all.filter(c => c.kind === 'hero');
  if (heroes.length === 0) heroes.push(scout);
  const beasts = all.filter(c => c.kind === 'beast');
  return { all, heroes, beasts };
}

// --- boot -------------------------------------------------------------------

const canvas = document.getElementById('view') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const toastEl = document.getElementById('toast')!;

const held = new Set<string>();
const placedEdge = [false, false];
const meleeEdge = [false, false];
let audio: ClashAudio | null = null;
function ensureAudio() {
  if (!audio) {
    try { audio = new ClashAudio(); } catch { /* no audio here */ }
  }
  audio?.resume();
}
addEventListener('keydown', e => {
  ensureAudio();
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter', 'shift'].includes(k) ||
      ['w', 'a', 's', 'd', 'f', 'g'].includes(k)) e.preventDefault();
  if (!held.has(k)) {
    if (k === 'f' || k === ' ') placedEdge[0] = true;
    if (k === 'g') meleeEdge[0] = true;
    if (k === 'enter') placedEdge[1] = true;
    if (k === 'shift') meleeEdge[1] = true;
  }
  held.add(k);
});
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));

function readInputs(): Input[] {
  const p1: Input = {
    dx: ((held.has('d') ? 1 : 0) + (held.has('a') ? -1 : 0)) as Input['dx'],
    dy: ((held.has('s') ? 1 : 0) + (held.has('w') ? -1 : 0)) as Input['dy'],
    place: placedEdge[0],
    melee: meleeEdge[0],
  };
  const p2: Input = {
    dx: ((held.has('arrowright') ? 1 : 0) + (held.has('arrowleft') ? -1 : 0)) as Input['dx'],
    dy: ((held.has('arrowdown') ? 1 : 0) + (held.has('arrowup') ? -1 : 0)) as Input['dy'],
    place: placedEdge[1],
    melee: meleeEdge[1],
  };
  placedEdge[0] = placedEdge[1] = false;
  meleeEdge[0] = meleeEdge[1] = false;
  return [p1, p2];
}

function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1600);
}

function applyScale(scale: number) {
  canvas.style.width = `${512 * scale}px`;
  canvas.style.height = `${352 * scale}px`;
}

async function boot() {
  const { heroes, beasts } = await loadRoster();

  const pick = (want: string, fallbackIdx: number): Character =>
    heroes.find(h => slug(h.name) === want) ?? heroes[fallbackIdx % heroes.length];
  const heroChars: Character[] = [pick(saved.heroes[0], 0), pick(saved.heroes[1], 1)];

  const cfg: Partial<GameCfg> = {
    players: heroChars.map(h => ({
      fuse: Math.round(h.blast.delay * 60),
      radius: Math.round(h.blast.radius),
      pattern: Math.max(0, PATTERN_NAMES.indexOf(h.blast.pattern as never)) as Pattern,
    })),
    beastDefs: beasts.map(b => ({
      speed: Math.max(2, Math.min(4, Math.round(walkSpeed(b.genome, { tired: 0, angry: 0 }) * 1.6))),
      chaseR: 64 * 4 * 4, // 4 tiles
      hp: 2,
    })),
    beastBase: 2,
  };

  const game = createGame(NUM_PLAYERS, 0xC1A54, cfg);
  const draw = new ClashDraw(canvas, heroChars, beasts, saved.settings);
  applyScale(saved.scale);

  // --- settings bar ---------------------------------------------------------
  const heroSel = [
    document.getElementById('hero1') as HTMLSelectElement,
    document.getElementById('hero2') as HTMLSelectElement,
  ];
  heroSel.forEach((sel, i) => {
    for (const h of heroes) {
      const o = document.createElement('option');
      o.value = slug(h.name);
      o.textContent = h.name;
      sel.appendChild(o);
    }
    sel.value = slug(heroChars[i].name);
    sel.addEventListener('input', () => {
      saved.heroes[i] = sel.value as string;
      persist();
      location.reload(); // clean deterministic restart with the new hero
    });
  });
  const styleSel = document.getElementById('figstyle') as HTMLSelectElement;
  styleSel.value = saved.settings.figureStyle;
  styleSel.addEventListener('input', () => {
    saved.settings.figureStyle = styleSel.value as RenderSettings['figureStyle'];
    persist();
  });
  const blendInput = document.getElementById('figblend') as HTMLInputElement | null;
  if (blendInput) {
    blendInput.value = String(saved.settings.blend);
    blendInput.addEventListener('input', () => {
      saved.settings.blend = parseFloat(blendInput.value);
      persist();
    });
  }
  const toneInput = document.getElementById('tone') as HTMLInputElement;
  toneInput.value = String(saved.settings.boardTone);
  toneInput.addEventListener('input', () => {
    saved.settings.boardTone = parseFloat(toneInput.value);
    persist();
  });
  const scaleSel = document.getElementById('scale') as HTMLSelectElement;
  scaleSel.value = String(saved.scale);
  scaleSel.addEventListener('input', () => {
    saved.scale = parseInt(scaleSel.value, 10);
    applyScale(saved.scale);
    persist();
  });
  document.getElementById('resetlook')!.addEventListener('click', () => {
    saved = { heroes: ['scout', 'scout'], settings: { ...DEFAULT_SETTINGS }, scale: 2 };
    persist();
    location.reload();
  });

  // --- loop -----------------------------------------------------------------
  let acc = 0;
  let last = performance.now();
  let lastWinner = -2;
  let freeze = 0;       // hit-stop frames
  let shake = 0;        // decaying shake amplitude, native px
  let lastCount = -1;   // countdown state
  let lastFrame = performance.now();

  const hearts = (hp: number) =>
    '♥'.repeat(Math.max(0, hp)) + '·'.repeat(Math.max(0, PLAYER_HP - hp));

  function frame(now: number) {
    acc += Math.min(250, now - last);
    last = now;
    const frameEvents: GameEvent[] = [];
    if (freeze > 0) {
      freeze--;
      acc = 0; // don't bank time during hit-stop
    } else {
      while (acc >= TICK_MS) {
        step(game, readInputs());
        frameEvents.push(...game.events);
        acc -= TICK_MS;
      }
    }

    for (const e of frameEvents) {
      if (e.type === 'strikeHit') freeze = Math.max(freeze, 4);
      if (e.type === 'diePlayer' || e.type === 'dieBeast') freeze = Math.max(freeze, 8);
      if (e.type === 'explode') shake = Math.max(shake, Math.min(4, 1.5 + e.tiles / 6));
      if (e.type === 'diePlayer') shake = Math.max(shake, 3);
      if (e.type === 'matchOver')
        toast(`${heroChars[e.winner].name.toUpperCase()} WINS THE MATCH`);
    }
    audio?.handle(frameEvents);
    audio?.updateFuses(game);

    // countdown: 3.. 2.. 1.. GO
    const count = game.introT > 0 ? Math.ceil(game.introT / 40) : 0;
    if (count !== lastCount) {
      if (count > 0) {
        toast(String(count));
        audio?.countdownTick(count);
      } else if (lastCount > 0) {
        toast('GO');
        audio?.countdownTick(0);
      }
      lastCount = count;
    }

    shake *= 0.82;
    const sx = shake > 0.3 ? (Math.random() * 2 - 1) * shake : 0;
    const sy = shake > 0.3 ? (Math.random() * 2 - 1) * shake : 0;
    draw.render(game, sx, sy, Math.min(0.05, (now - lastFrame) / 1000));
    lastFrame = now;

    if (game.roundEndT > 0 && lastWinner !== game.roundWinner) {
      lastWinner = game.roundWinner;
      toast(game.roundWinner === -1 ? 'DRAW' : `${heroChars[game.roundWinner].name.toUpperCase()} TAKES IT`);
    }
    if (game.roundEndT < 0) lastWinner = -2;

    const p = game.players;
    status.innerHTML =
      `<b class="p1">${heroChars[0].name}</b> <i>${heroChars[0].blast.pattern}</i> ${hearts(p[0].hp)} ${p[0].wins}w` +
      ` &nbsp;·&nbsp; <b class="p2">${heroChars[1].name}</b> <i>${heroChars[1].blast.pattern}</i> ${hearts(p[1].hp)} ${p[1].wins}w` +
      ` &nbsp;·&nbsp; beasts ${game.beasts.filter(b => b.deadT < 0).length}`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  (window as any).clash = {
    game,
    step: (n = 1, inputs?: Input[]) => {
      for (let i = 0; i < n; i++)
        step(game, inputs ?? [
          { dx: 0, dy: 0, place: false, melee: false },
          { dx: 0, dy: 0, place: false, melee: false },
        ]);
      draw.render(game);
    },
    state: () => ({
      tick: game.tick,
      round: game.round,
      players: game.players.map(pp => ({
        tx: Math.floor(pp.x / 64), ty: Math.floor(pp.y / 64),
        hp: pp.hp, alive: pp.alive, wins: pp.wins, strikeT: pp.strikeT,
      })),
      beasts: game.beasts.map(b => ({
        tx: Math.floor(b.x / 64), ty: Math.floor(b.y / 64), hp: b.hp, dead: b.deadT >= 0, def: b.def,
      })),
      candles: game.candles.length,
      flames: Array.from(game.flame).filter(f => f > 0).length,
      pickups: game.pickups.length,
      roundEndT: game.roundEndT,
      winner: game.roundWinner,
    }),
  };
}

boot();
