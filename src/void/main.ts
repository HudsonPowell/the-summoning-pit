// THE VOID — the screensaver. Creatures off the shelf live their little
// lives in a pool of light while a camera does its best to film them.

import { Character, makeCharacter, migrateCharacter } from '../character';
import { defaultBiped, Genome } from '../genome';
import { solvePose, slashWeight, Capsule, Intent } from '../pose';
import { rotY, v3, TAU } from '../vec';
import { Camera } from '../render';
import { PixelView } from '../view';
import { createVoid, stepVoid, spawnOne, Agent, VoidSim, Shot } from './sim';
import { Director } from './director';

const KEY = 'void-look';

interface Look {
  res: number;
  zoom: number;       // px per metre at REF_RES
  blend: number;
  blendShape: number;
  blendMix: number;
  floorRadius: number;
  floorPower: number;
  floorLift: number;
  tile: number;
  round: number;       // 0 = true circle on the ground, 1 = circle on screen
  closeness: number;
  response: number;
  lead: number;
  voidCol: string;
  floorColA: string;
  floorColB: string;
  flat: boolean;
  panel: boolean;
  pitch: number;
  orbit: number;      // radians/sec of drift
  population: number;
  peace: number;
}

const DEFAULT_LOOK: Look = {
  res: 480, zoom: 1, blend: 0.9, blendShape: 0.5, blendMix: 1,
  floorRadius: 12, floorPower: 2.4, floorLift: 1, tile: 1,
  round: 1,
  closeness: 0.72, response: 0.5, lead: 0.5,
  voidCol: '#000000', floorColA: '#2a2f3a', floorColB: '#22262f',
  flat: false, pitch: 0.34, orbit: 0.16, population: 4, peace: 0.35,
  panel: true,
};

function loadLook(): Look {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_LOOK, ...JSON.parse(raw) };
  } catch { /* fresh */ }
  return { ...DEFAULT_LOOK };
}
let look = loadLook();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* full */ } };

const REF_RES = 320;
const canvas = document.getElementById('view') as HTMLCanvasElement;
// the display canvas matches the window; the low-res buffer inside it is what
// `resolution` controls, so the pixels stay square and the frame stays full
function fitCanvas() {
  const stage = document.getElementById('stage')!;
  const w = Math.max(240, Math.round(stage.clientWidth));
  const h = Math.max(200, Math.round(stage.clientHeight));
  canvas.width = w;
  canvas.height = h;
  const aspect = h / w;
  view.setSize(look.res, Math.max(80, Math.round(look.res * aspect)));
}
const view = new PixelView(canvas, look.res, Math.round(look.res * 0.625));
view.init();
fitCanvas();
addEventListener('resize', fitCanvas);
// the stage changes size whenever the drawer opens or the window moves;
// observing it is more reliable than guessing when the layout settled
new ResizeObserver(fitCanvas).observe(document.getElementById('stage')!);

const cam: Camera = {
  yaw: 0.6, pitch: look.pitch, ppm: look.zoom, cy: 0.95, cx: 0, cz: 0, tile: look.tile,
};

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function applyLook() {
  cam.pitch = look.pitch;
  cam.tile = look.tile;
  cam.flat = look.flat;
  cam.blend = look.blend;
  cam.blendShape = look.blendShape;
  cam.blendMix = look.blendMix;
  cam.blendDepth = 0.35;
  cam.floorRadius = look.floorRadius;
  cam.floorPower = look.floorPower;
  cam.floorLift = look.floorLift;
  // a ground circle is an ellipse once the camera tilts; squashing depth by
  // sin(pitch) makes the pool read as a true circle on screen
  cam.floorSquash = Math.max(0.12, 1 + (Math.sin(look.pitch) - 1) * look.round);
  cam.voidColor = hexRgb(look.voidCol);
  cam.floorColorA = hexRgb(look.floorColA);
  cam.floorColorB = hexRgb(look.floorColB);
  document.body.style.background = look.voidCol;
}
applyLook();

// --- the cast ---------------------------------------------------------------

async function fetchAll(api: string): Promise<any[]> {
  try {
    const r = await fetch(api);
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

async function loadRoster(): Promise<Character[]> {
  const seen = new Set<string>();
  const out: Character[] = [];
  for (const raw of [...(await fetchAll('/api/characters')), ...(await fetchAll('/api/genome'))]) {
    try {
      const ch = migrateCharacter(raw);
      const key = ch.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ch);
    } catch { /* skip */ }
  }
  if (out.length === 0) out.push(makeCharacter(defaultBiped(), 'hero'));
  return out;
}

// --- camera: a operator who likes the action centred and slightly circled ---

const director = new Director();

function driveCamera(sim: VoidSim, dt: number) {
  const f = director.update(sim, dt, {
    closeness: look.closeness,
    response: look.response,
    lead: look.lead,
    sway: look.orbit,
    pitch: look.pitch,
  }, view.size.W, view.size.H);
  cam.cx = f.x;
  cam.cz = f.z;
  cam.ppm = f.ppm * look.zoom;
  cam.yaw = f.yaw;
  cam.cy = f.cy;
}

// --- drawing ----------------------------------------------------------------

function hexRgb3(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A shot is its head plus the trail that makes it read as fast. */
function shotCapsules(s: Shot): Capsule[] {
  const col = hexRgb3(s.spec.color);
  const out: Capsule[] = [{
    a: v3(s.x, s.y, s.z), b: v3(s.x, s.y, s.z),
    r: s.spec.size, color: col, part: 'shot',
  }];
  s.trail.forEach((t, i) => {
    const f = 1 - (i + 1) / (s.trail.length + 1);
    out.push({
      a: v3(t.x, t.y, t.z), b: v3(t.x, t.y, t.z),
      r: s.spec.size * (0.85 * f + 0.15),
      color: [col[0] * f, col[1] * f, col[2] * f],
      part: 'trail',
    });
  });
  return out;
}

function agentCapsules(a: Agent, t: number): Capsule[] {
  const mood = {
    tired: 0,
    angry: a.state === 'fight' ? 0.75 : a.state === 'approach' ? 0.35 : 0,
  };
  let intent: Intent | undefined;
  if (a.strikeT >= 0) {
    const spec = (a.ch.behaviors[a.heavy ? 'attack-heavy' : 'attack-light'] as any)?.strike;
    const u = Math.min(1, a.strikeT / (spec?.duration ?? 0.5));
    intent = { slash: { t: u, weight: slashWeight(u), spec } };
  }
  const look = a.target && a.deadT < 0
    ? Math.atan2(a.target.z - a.z, a.target.x - a.x) - a.heading
    : 0;
  const caps = solvePose(
    a.genome, mood, a.phase, a.move, a.idleT, intent,
    a.deadT >= 0 ? Math.min(1, a.deadT / 0.5) : 0,
    {
      weapon: a.ch.weapon,
      turn: a.turnRate,
      // heads track what they are dealing with, up to a believable angle
      lookYaw: Math.max(-0.9, Math.min(0.9, Math.atan2(Math.sin(look), Math.cos(look)))),
    },
  );
  const flash = a.hurtT > 0 && Math.sin(t * 40) > 0;
  const fade = a.deadT >= 0 ? Math.max(0, 1 - Math.max(0, a.deadT - 2) / 1.5) : 1;
  return caps.map(c => {
    const p = rotY(c.a, -a.heading);
    const q = rotY(c.b, -a.heading);
    const col: [number, number, number] = flash
      ? [255, 235, 235]
      : [c.color[0] * fade, c.color[1] * fade, c.color[2] * fade];
    return {
      ...c,
      a: v3(p.x + a.x, p.y, p.z + a.z),
      b: v3(q.x + a.x, q.y, q.z + a.z),
      color: col,
    };
  });
}

// --- boot -------------------------------------------------------------------

async function boot() {
  const roster = await loadRoster();
  const sim = createVoid(roster, look.population);
  sim.peace = look.peace;

  buildPanel(sim);

  let last = performance.now();
  function tick(dt: number) {
    stepVoid(sim, dt);
    for (const e of sim.events) {
      if (e.type === 'die') director.punch(1);
      else if (e.type === 'hit' || e.type === 'impact') director.punch(0.45);
    }
    driveCamera(sim, dt);

    const caps: Capsule[] = [];
    for (const a of sim.agents) caps.push(...agentCapsules(a, sim.t));
    for (const s of sim.shots) caps.push(...shotCapsules(s));
    view.render(caps, cam, 0);

  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // the browser pane suspends rAF while hidden, so tooling drives it by hand
  (window as any).voidScene = {
    sim, cam, look, director,
    tick,
    refit: fitCanvas,
    run: (seconds: number, dt = 1 / 60) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) tick(dt);
    },
  };
}

// --- the control drawer -----------------------------------------------------

function buildPanel(sim: VoidSim) {
  const panel = document.getElementById('panelInner')!;
  const row = (label: string, el: HTMLElement, val?: HTMLElement) => {
    const r = document.createElement('label');
    r.className = 'row';
    const s = document.createElement('span');
    s.textContent = label;
    r.append(s, el);
    if (val) r.append(val);
    panel.appendChild(r);
    return r;
  };
  const head = (t: string) => {
    const h = document.createElement('h2');
    h.textContent = t;
    panel.appendChild(h);
  };
  const sl = (
    label: string, min: number, max: number, step: number, get: () => number,
    set: (v: number) => void,
  ) => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(get());
    const val = document.createElement('em');
    val.textContent = get().toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      set(v);
      val.textContent = v.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0);
      applyLook();
      persist();
    });
    row(label, input, val);
  };

  const colour = (label: string, get: () => string, set: (v: string) => void) => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = get();
    input.addEventListener('input', () => { set(input.value); applyLook(); persist(); });
    row(label, input);
  };

  head('the void');
  sl('cast size', 1, 8, 1, () => look.population, v => { look.population = v; sim.population = v; });
  sl('peace', 0, 1, 0.05, () => look.peace, v => { look.peace = v; sim.peace = v; });

  head('camera');
  sl('closeness', 0, 1, 0.02, () => look.closeness, v => { look.closeness = v; });
  sl('zoom', 0.4, 2.4, 0.05, () => look.zoom, v => { look.zoom = v; });
  sl('pitch', 0, 0.9, 0.01, () => look.pitch, v => { look.pitch = v; });
  sl('smoothing', 0.12, 1.6, 0.02, () => look.response, v => { look.response = v; });
  sl('anticipate', 0, 1.4, 0.05, () => look.lead, v => { look.lead = v; });
  sl('sway', 0, 0.8, 0.02, () => look.orbit, v => { look.orbit = v; });

  head('the pool of light');
  sl('radius', 3, 25, 0.5, () => look.floorRadius, v => { look.floorRadius = v; });
  sl('falloff', 0.3, 5, 0.1, () => look.floorPower, v => { look.floorPower = v; });
  sl('lift', 0, 1.4, 0.05, () => look.floorLift, v => { look.floorLift = v; });
  sl('grid', 0.25, 4, 0.25, () => look.tile, v => { look.tile = v; });
  sl('circularity', 0, 1, 0.05, () => look.round, v => { look.round = v; });
  colour('dark', () => look.voidCol, v => { look.voidCol = v; });
  colour('floor a', () => look.floorColA, v => { look.floorColA = v; });
  colour('floor b', () => look.floorColB, v => { look.floorColB = v; });

  head('figures');
  sl('resolution', 160, 1600, 20, () => look.res, v => {
    look.res = v;
    fitCanvas();
  });
  sl('blend', 0, 8, 0.1, () => look.blend, v => { look.blend = v; });
  sl('shape fuse', 0, 1, 0.02, () => look.blendShape, v => { look.blendShape = v; });
  sl('colour mix', 0, 1, 0.02, () => look.blendMix, v => { look.blendMix = v; });

  const flatBox = document.createElement('input');
  flatBox.type = 'checkbox';
  flatBox.checked = look.flat;
  flatBox.addEventListener('input', () => { look.flat = flatBox.checked; applyLook(); persist(); });
  row('flat ink', flatBox);

  const btns = document.createElement('div');
  btns.className = 'btns';
  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };
  mk('capture', capture);
  mk('stir', () => { for (const a of sim.agents) { a.target = null; a.state = 'wander'; a.stateT = 0; } spawnOne(sim); });
  mk('reset look', () => { look = { ...DEFAULT_LOOK }; persist(); location.reload(); });
  panel.appendChild(btns);

  const links = document.createElement('div');
  links.id = 'links';
  for (const [label, href] of [['FORGE', '/'], ['BESTIARY', '/bestiary.html'], ['ARENA', '/clash.html']]) {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    links.appendChild(a);
  }
  panel.appendChild(links);
}

/** Straight off the display canvas, so what you see is what you save. */
function capture() {
  const a = document.createElement('a');
  a.download = `void-${Date.now()}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

// --- chrome: hide it all for a clean grab ------------------------------------

const shell = document.getElementById('shell')!;
shell.classList.toggle('open', look.panel);

function setPanel(open: boolean) {
  look.panel = open;
  shell.classList.toggle('open', open);
  persist();
  fitCanvas();
}

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'c' || e.key === 'C') setPanel(!look.panel);
  if (e.key === 'p' || e.key === 'P') capture();
});

boot();
