// THE VOID — the screensaver. Creatures off the shelf live their little
// lives in a pool of light while a camera does its best to film them.

import { Character, makeCharacter, migrateCharacter } from '../character';
import { defaultBiped, Genome } from '../genome';
import { hatchGenome } from '../hatch';
import { solvePose, slashWeight, Capsule, Intent } from '../pose';
import { rotY, v3, TAU } from '../vec';
import { Camera } from '../render';
import { PixelView } from '../view';
import { createVoid, stepVoid, spawnOne, spawnChar, Agent, VoidSim, Shot } from './sim';
import { Director, smoothDamp, smoothDampAngle } from './director';
import { LiveVoid } from './live';

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
  panel: false,
};

function loadLook(): Look {
  try {
    const raw = localStorage.getItem(KEY);
    // the drawer is not a preference — `c` opens it, and it starts shut
    if (raw) return { ...DEFAULT_LOOK, ...JSON.parse(raw), panel: false };
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

// --- yours ------------------------------------------------------------------
// Your creature is the one the camera cares about. You can pull the camera off
// it — drag to orbit, wheel to zoom — but it drifts back, because losing your
// own summon in a crowd is the one thing that must not happen.

// No account, no name, no handle. An id that lives as long as the tab does,
// which is enough to know which creatures are yours and to be the thing a
// pact link points at.
const ME = (() => {
  const k = 'void-me';
  let v = sessionStorage.getItem(k);
  if (!v) { v = Math.random().toString(36).slice(2, 10); sessionStorage.setItem(k, v); }
  return v;
})();

let yours: Agent | null = null;
const orbit = { yaw: 0, zoom: 0, idle: 99 };

// The camera's own inertia. Chasing the creature frame by frame is what made
// it sickening: a beast in a fight circles, jockeys and backs off constantly,
// and a camera that honours all of that is a camera being shaken. So the rig
// follows an ANCHOR that only moves when the creature genuinely leaves, and
// everything else is critically damped over most of a second.
const rig = {
  ax: 0, az: 0,                                    // the anchor, not the creature
  vx: { v: 0 }, vz: { v: 0 }, vy: { v: 0 },
  vppm: { v: 0 }, vyaw: { v: 0 },
};
const DEADZONE = 0.9;   // metres of jockeying the camera simply ignores

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
let camCold = true;

/** The most recent thing you summoned that is still standing. */
function yourAgent(sim: VoidSim): Agent | null {
  const mine = sim.agents.filter(a => a.by === ME && a.deadT < 0);
  if (mine.length) { yours = mine[mine.length - 1]; return yours; }
  // Nothing of yours is standing. Hold on the body rather than throwing the
  // camera back to the roaming director in the middle of a fight — watching
  // your own creature go down is the point, and the cut was sickening.
  if (yours && sim.agents.includes(yours)) return yours;
  yours = null;
  return null;
}

// --- the summoning box ------------------------------------------------------
// The one verb. You type, something that has never existed walks into the pit.
// The words are yours and stay yours — nothing keeps them, and the creature is
// named by its body, not by what you typed (see src/naming.ts).

function buildSummon(sim: VoidSim): void {
  const box = document.getElementById('summonBox') as HTMLInputElement;
  const status = document.getElementById('summonStatus')!;

  let busy = false;
  async function summon() {
    const desc = box.value.trim();
    if (!desc || busy) return;
    busy = true;
    box.value = '';
    status.textContent = 'summoning…';
    try {
      const g = await hatchGenome(desc, undefined, undefined, chars => {
        status.textContent = `summoning… ${chars}`;
      });
      const a = spawnChar(sim, makeCharacter(g, 'beast'), ME);
      yours = a;
      status.textContent = `${a.ch.name} answers`;
      director.punch(0.7);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status.textContent = msg.includes('fetch')
        ? 'nothing answered — is ollama running?'
        : 'nothing answered';
    }
    busy = false;
  }

  box.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') summon();
    if (e.key === 'Escape') box.blur();
  });
  // `/` reaches for the box from anywhere, the way a chat box does
  addEventListener('keydown', e => {
    if (e.key !== '/' || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    if (!look.panel) setPanel(true);
    box.focus();
  });
}

// --- camera: a operator who likes the action centred and slightly circled ---

const director = new Director();

function driveCamera(sim: VoidSim, dt: number) {
  const you = yourAgent(sim);
  if (camCold) {
    // damping in from a cold camera means a second of looking at nothing
    camCold = false;
    const f0 = director.update(sim, dt, {
      closeness: look.closeness, response: look.response, lead: look.lead,
      sway: look.orbit, pitch: look.pitch,
    }, view.size.W, view.size.H);
    cam.cx = rig.ax = you ? you.x : f0.x;
    cam.cz = rig.az = you ? you.z : f0.z;
    cam.cy = you ? you.bulk * 0.55 : f0.cy;
    cam.ppm = you ? (view.size.H * 0.26 / Math.max(0.7, you.bulk)) * look.zoom : f0.ppm * look.zoom;
    cam.yaw = you ? 0.5 : f0.yaw;
    return;
  }
  if (you) {
    orbit.idle += dt;
    if (orbit.idle > 2) {
      // a hand on the camera holds it; take it off and it comes home slowly
      orbit.yaw = smoothDamp(orbit.yaw, 0, { v: 0 }, 2.4, dt);
      orbit.zoom = smoothDamp(orbit.zoom, 0, { v: 0 }, 2.4, dt);
    }

    // the anchor only gives when the creature has actually gone somewhere
    const dx = you.x - rig.ax, dz = you.z - rig.az;
    const d = Math.hypot(dx, dz);
    if (d > DEADZONE) {
      const pull = (d - DEADZONE) / d;
      rig.ax += dx * pull;
      rig.az += dz * pull;
    }

    cam.cx = smoothDamp(cam.cx ?? rig.ax, rig.ax, rig.vx, 0.75, dt);
    cam.cz = smoothDamp(cam.cz ?? rig.az, rig.az, rig.vz, 0.75, dt);
    // height comes off its SIZE, never off its bob — following the bounce is
    // following a spring with a camera bolted to it
    cam.cy = smoothDamp(cam.cy, you.bulk * 0.55, rig.vy, 1.1, dt);
    const want = (view.size.H * 0.26 / Math.max(0.7, you.bulk)) * look.zoom * Math.exp(orbit.zoom);
    cam.ppm = smoothDamp(cam.ppm, want, rig.vppm, 1.3, dt);
    // The director leaves cam.yaw unwrapped — it had wound to 17 radians by
    // the time a creature died and came back. Interpolating that linearly to
    // 0.5 spins the camera two and a half times, which is exactly the thing
    // that makes people feel ill. Always take the short way round.
    cam.yaw = smoothDampAngle(wrapAngle(cam.yaw), 0.5 + orbit.yaw, rig.vyaw, 1.1, dt);
    return;
  }
  const f = director.update(sim, dt, {
    closeness: look.closeness,
    response: look.response,
    lead: look.lead,
    sway: look.orbit,
    pitch: look.pitch,
  }, view.size.W, view.size.H);
  // The director cuts between shots, which is right when it is running the
  // show on its own and very wrong the moment it takes the camera back off a
  // creature you were watching. Everything it asks for goes through the same
  // damping the follow rig uses, so a hand-off is a move rather than a jump.
  cam.cx = smoothDamp(cam.cx ?? f.x, f.x, rig.vx, 0.5, dt);
  cam.cz = smoothDamp(cam.cz ?? f.z, f.z, rig.vz, 0.5, dt);
  cam.cy = smoothDamp(cam.cy, f.cy, rig.vy, 0.7, dt);
  cam.ppm = smoothDamp(cam.ppm, f.ppm * look.zoom, rig.vppm, 0.8, dt);
  cam.yaw = smoothDampAngle(wrapAngle(cam.yaw), f.yaw, rig.vyaw, 0.7, dt);
  rig.ax = cam.cx;
  rig.az = cam.cz;
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

  const caps = solvePose(
    a.genome, mood, a.phase, a.move, a.idleT, intent,
    a.deadT >= 0 ? Math.min(1, a.deadT / 0.5) : 0,
    {
      weapon: a.ch.weapon,
      offhand: a.ch.offhand,
      turn: a.turnRate,
      // the head has already been through its own spring — it arrives late
      // and goes past, rather than snapping onto the target
      lookYaw: Math.max(-0.9, Math.min(0.9, a.sec.head)),
      lean: a.sec.lean,
      twist: a.sec.twist,
      bob: a.sec.bob,
      jiggle: a.sec.jiggle,
    },
  );
  const flash = a.hurtT > 0 && Math.sin(t * 40) > 0;
  const fade = a.deadT >= 0 ? Math.max(0, 1 - Math.max(0, a.deadT - 2) / 1.5) : 1;
  const yaw = -(a.heading + a.sec.spin);
  return caps.map(c => {
    const p = rotY(c.a, yaw);
    const q = rotY(c.b, yaw);
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

/**
 * A sigil: a small pip hovering over anything with an owner, in that owner's
 * colour. No typography, readable at any zoom, and it survives the creature
 * being a two-headed blob in a scrum of six others — which a name floating in
 * 5px type would not.
 */
const SIGIL: Record<string, [number, number, number]> = {};
function sigilColor(by: string): [number, number, number] {
  if (by === ME) return [110, 232, 214];
  if (SIGIL[by]) return SIGIL[by];
  // a stable colour per owner, so a friend is the same colour every session
  let h = 0;
  for (let i = 0; i < by.length; i++) h = (Math.imul(h, 31) + by.charCodeAt(i)) >>> 0;
  const hue = (h % 360) / 360;
  const f = (n: number) => {
    const k = (n + hue * 6) % 6;
    return Math.round(255 * (0.45 + 0.5 * Math.max(0, Math.min(1, Math.min(k, 4 - k, 1)))));
  };
  SIGIL[by] = [f(5), f(3), f(1)];
  return SIGIL[by];
}

function sigilCapsules(a: Agent, t: number): Capsule[] {
  if (!a.by || a.deadT >= 0) return [];
  const col = sigilColor(a.by);
  const y = a.bulk * 1.16 + 0.1 + Math.sin(t * 2.2 + a.id) * 0.025;
  const r = Math.max(0.035, a.bulk * 0.035);
  return [
    { a: v3(a.x, y, a.z), b: v3(a.x, y, a.z), r, color: col, part: 'sigil' },
    { a: v3(a.x, y - r * 2.4, a.z), b: v3(a.x, y - r * 1.1, a.z), r: r * 0.34, color: col, part: 'sigil' },
  ];
}

// --- the feed: the same event stream, read aloud ----------------------------

const feedLines: string[] = [];
function narrate(e: import('./sim').VoidEvent): string | null {
  const who = e.actor?.name ?? 'something';
  const whom = e.target?.name ?? 'something';
  const at = e.range ? ` at ${e.range.toFixed(1)}m` : '';
  switch (e.kind) {
    // the drama was happening and nothing said so
    case 'spoil': return `${who} takes the ${e.how} of ${whom}`;
    case 'kill': return `${who} felled ${whom} — ${e.how ?? 'a blow'}${at}`;
    case 'spawn': return `${who} enters the pit`;
    case 'flee': return `${who} breaks and runs`;
    case 'notice': return `${who} sets upon ${whom}`;
    default: return null;
  }
}
function pushFeed(events: import('./sim').VoidEvent[]) {
  const el = document.getElementById('feed');
  if (!el) return;
  let changed = false;
  for (const e of events) {
    const line = narrate(e);
    if (!line) continue;
    feedLines.unshift(line);
    changed = true;
  }
  if (!changed) return;
  feedLines.length = Math.min(feedLines.length, 14);
  el.innerHTML = feedLines.map((l, i) =>
    `<div style="opacity:${(1 - i / 16).toFixed(2)}">${l}</div>`).join('');
}

// --- boot -------------------------------------------------------------------

const LIVE = new URLSearchParams(location.search).has('live');
const PIT_URL = new URLSearchParams(location.search).get('pit')
  ?? `ws://${location.hostname}:8787`;

async function boot() {
  const live = LIVE ? new LiveVoid() : null;
  if (live) live.connect(PIT_URL);
  const roster = live ? [] : await loadRoster();
  const sim = live ? live.sim : createVoid(roster, look.population);
  sim.peace = look.peace;

  buildPanel(sim, live);
  buildSummon(sim);

  let last = performance.now();
  function tick(dt: number) {
    if (live) live.update(dt); else stepVoid(sim, dt);
    pushFeed(sim.events);
    if (live) sim.events.length = 0;
    for (const e of sim.events) {
      if (e.kind === 'kill') director.punch(1);
      else if (e.kind === 'hit') director.punch(0.45);
    }
    driveCamera(sim, dt);

    const caps: Capsule[] = [];
    for (const a of sim.agents) {
      caps.push(...agentCapsules(a, sim.t));
      caps.push(...sigilCapsules(a, sim.t));
    }
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
    sim, cam, look, director, live,
    tick,
    refit: fitCanvas,
    run: (seconds: number, dt = 1 / 60) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) tick(dt);
    },
  };
}

// --- the control drawer -----------------------------------------------------

function buildPanel(sim: VoidSim, live: LiveVoid | null) {
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

  head(LIVE ? 'the pit — live' : 'the void');
  if (!LIVE) {
    sl('cast size', 1, 8, 1, () => look.population, v => { look.population = v; sim.population = v; });
    sl('peace', 0, 1, 0.05, () => look.peace, v => { look.peace = v; sim.peace = v; });
  }

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
  mk('stir', () => {
    if (live) { live.send({ t: 'stir' }); return; }
    for (const a of sim.agents) { a.target = null; a.state = 'wander'; a.stateT = 0; }
    spawnOne(sim);
  });
  mk('reset look', () => { look = { ...DEFAULT_LOOK }; persist(); location.reload(); });
  panel.appendChild(btns);

  const feedHead = document.createElement('h2');
  feedHead.textContent = 'the feed';
  panel.appendChild(feedHead);
  const feed = document.createElement('div');
  feed.id = 'feed';
  panel.appendChild(feed);

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

// dragging the stage orbits; the wheel pushes in and out
(() => {
  const stage = document.getElementById('stage')!;
  let down = false, lastX = 0;
  stage.addEventListener('pointerdown', e => {
    if (e.target instanceof HTMLInputElement) return;
    down = true; lastX = e.clientX; orbit.idle = 0;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!down) return;
    orbit.yaw = Math.max(-Math.PI, Math.min(Math.PI, orbit.yaw + (e.clientX - lastX) * 0.006));
    lastX = e.clientX;
    orbit.idle = 0;
  });
  const up = () => { down = false; orbit.idle = 0; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.zoom = Math.max(-1.1, Math.min(1.1, orbit.zoom - e.deltaY * 0.0016));
    orbit.idle = 0;
  }, { passive: false });
})();

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === 'c') setPanel(!look.panel);
  if (k === 'p') capture();
});

boot();
