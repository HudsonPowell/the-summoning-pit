// THE VOID — the screensaver. Creatures off the shelf live their little
// lives in a pool of light while a camera does its best to film them.

import { Character, makeCharacter, migrateCharacter } from '../character';
import { defaultBiped, Genome } from '../genome';
import { hatchGenome } from '../hatch';
import { solvePose, slashWeight, Capsule, Intent } from '../pose';
import { rotY, v3, TAU } from '../vec';
import { Camera } from '../render';
import { PixelView } from '../view';
import { createVoid, stepVoid, spawnOne, spawnChar, strikeSpecOf, Agent, VoidSim, Shot } from './sim';
import { Director, smoothDamp, smoothDampAngle } from './director';
import { Pit, Bank } from './voice';
import { WireTitle } from './wiretitle';
import { MuteIcon } from './icon';
import { CROWN } from '../gear';
import { LiveVoid } from './live';

const KEY = 'void-look';

declare const __BUILD__: string;
{
  const tag = document.getElementById('buildTag');
  if (tag) tag.textContent = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
}

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

// The look Jody settled on, baked in: chunkier pixels, a much softer blend so
// bodies read as one mass, and flat ink so the figures sit as silhouettes
// rather than shaded forms.
const DEFAULT_LOOK: Look = {
  res: 1120, zoom: 1, blend: 1.8, blendShape: 0.6, blendMix: 1,
  floorRadius: 12, floorPower: 2.4, floorLift: 1, tile: 1,
  round: 1,
  closeness: 0.72, response: 0.5, lead: 0.5,
  voidCol: '#000000', floorColA: '#2a2f3a', floorColB: '#22262f',
  flat: true, pitch: 0.34, orbit: 0.16, population: 0, peace: 0.35,
  panel: false,
};

/**
 * Bumped whenever the baked-in look changes. A stored look is a preference and
 * should win — but only until the defaults move underneath it, or someone who
 * nudged one slider months ago is stuck with an old look forever and every
 * change we make is invisible to exactly the people using it most.
 */
const LOOK_VERSION = 2;

function loadLook(): Look {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.v === LOOK_VERSION) {
        // the drawer is not a preference — `c` opens it, and it starts shut
        return { ...DEFAULT_LOOK, ...saved, panel: false };
      }
    }
  } catch { /* fresh */ }
  return { ...DEFAULT_LOOK };
}
let look = loadLook();
const persist = () => {
  try { localStorage.setItem(KEY, JSON.stringify({ ...look, v: LOOK_VERSION })); }
  catch { /* full */ }
};

const REF_RES = 320;
const canvas = document.getElementById('view') as HTMLCanvasElement;
// the display canvas matches the window; the low-res buffer inside it is what
// `resolution` controls, so the pixels stay square and the frame stays full
/**
 * The buffer is capped by AREA, not width. `res` is horizontal resolution, so
 * a portrait phone (aspect ~2) was quietly rendering res * 2 rows — at 1120
 * that is a 1120x2240 buffer, ~10x the pixels the look was tuned on, on the
 * weakest hardware we run on. Landscape was fine, portrait crawled, which is
 * exactly the report. The cap keeps total pixels constant whatever the shape.
 */
const MAX_BUFFER_PX = 1120 * 760;
function fitCanvas() {
  const stage = document.getElementById('stage')!;
  const w = Math.max(240, Math.round(stage.clientWidth));
  const h = Math.max(200, Math.round(stage.clientHeight));
  canvas.width = w;
  canvas.height = h;
  const aspect = h / w;
  const res = Math.min(look.res, Math.floor(Math.sqrt(MAX_BUFFER_PX / aspect)));
  view.setSize(res, Math.max(80, Math.round(res * aspect)));
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
// The URL is the account. `?k=` is a secret the pit minted for you and the
// only proof any creature is yours — bookmark it and you are you, lose it and
// your creatures carry on without anyone able to claim them. The OWNER id is a
// hash of it: safe to hand out, and what a pact link points at.
const KEY_STORE = 'pit-key';
let myKey = new URLSearchParams(location.search).get('k')
  ?? localStorage.getItem(KEY_STORE)
  ?? '';
let ME = 'local';

/**
 * The key NEVER goes in the address bar.
 *
 * It used to: "the URL is the account, bookmark it and you are you". But
 * sharing a link is how this game spreads, and anyone who copied their own
 * address bar to send to a friend sent their identity with it. Everyone who
 * opened that link became the same person — one owner, one hero between them,
 * so the first to summon silently blocked the rest. That is exactly what "only
 * one summon at a time" and "my friend gets nothing" looked like from outside.
 *
 * A key that arrives in a URL is still honoured once, for old bookmarks, and
 * then stripped immediately so the visible link is always safe to pass on.
 */
function keepKey(key: string, owner: string): void {
  myKey = key;
  ME = owner;
  try { localStorage.setItem(KEY_STORE, key); } catch { /* private window */ }
  const u = new URL(location.href);
  if (!u.searchParams.has('k') && !u.searchParams.has('pact') && !u.searchParams.has('feud')) return;
  u.searchParams.delete('k');
  u.searchParams.delete('pact');
  u.searchParams.delete('feud');
  history.replaceState(null, '', u.toString());
}

let yours: Agent | null = null;

// The title, set in the wire type: it coils under the floor, is pulled up
// into the letterform, breathes a moment, and is cut loose to fall back into
// the dark. The page opens with a summoning. Built AFTER the canvas has been
// fitted, because its size depends on how much world the frame can show.
let title: WireTitle | null = null;

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
let watchYaw = 0.5;   // the observer's slow circle, accumulated

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

/**
 * Bring your own model. `?model=` and `?ollama=` are remembered, so a summoner
 * with something better than llama3.2:3b on their own machine uses it — and
 * gets a better creature for it, in the only way the pit allows: a better
 * COMPOSED body. It cannot buy better numbers. Temperament is derived from the
 * body on the server, and mass is capped there, so what a good model wins you
 * is proportion, coherence, a weapon that suits and limbs that make sense —
 * not stats. See server/sanitise.ts.
 */
function myModel(): { model?: string; url?: string } {
  const q = new URLSearchParams(location.search);
  for (const k of ['model', 'ollama'] as const) {
    const v = q.get(k);
    if (v) { try { localStorage.setItem('pit-' + k, v); } catch { /* private */ } }
  }
  const get = (k: string) => {
    try { return localStorage.getItem('pit-' + k) ?? undefined; } catch { return undefined; }
  };
  return { model: get('model'), url: get('ollama') };
}

/**
 * The input field is the state, and it only has three:
 *
 *   active      — you have no hero; type and summon.
 *   summoning   — disabled while the pit hatches.
 *   in play     — disabled, carrying your hero's name, until it falls.
 *
 * The line under it says exactly one thing: whether you are Pit Lord. No
 * chatter, no refusal dialogs, no "X answers" — the creature walking in IS the
 * answer, and the disabled field already says why you cannot type.
 */
let summoning = false;

function summonUI(sim: VoidSim): void {
  const box = document.getElementById('summonBox') as HTMLInputElement | null;
  const status = document.getElementById('summonStatus');
  if (!box || !status) return;

  const mine = sim.agents.find(a => a.by === ME && a.deadT < 0) ?? null;
  if (mine) yours = mine;

  const state = summoning ? 'summoning' : mine ? 'inplay' : 'active';
  if (box.dataset.state !== state) {
    box.dataset.state = state;
    box.disabled = state !== 'active';
    box.placeholder =
      state === 'summoning' ? 'summoning…'
      : state === 'inplay' ? `${mine!.ch.name} is in play`
      : 'summon…';
  }

  const lordText = mine
    ? (mine.id === lordId ? 'YOU ARE PIT LORD' : 'you are not pit lord')
    : '';
  if (status.textContent !== lordText) status.textContent = lordText;
  status.classList.toggle('lord', !!mine && mine.id === lordId);
}

function buildSummon(sim: VoidSim, live: LiveVoid | null): void {
  const box = document.getElementById('summonBox') as HTMLInputElement;

  let settle = 0;
  function done(): void {
    clearTimeout(settle);
    summoning = false;
  }

  async function summon() {
    const desc = box.value.trim();
    if (!desc || summoning) return;
    summoning = true;
    box.value = '';
    box.blur();          // the phone keyboard goes away the moment you commit
    // a lost packet must not wedge the field shut forever
    settle = window.setTimeout(done, 45000);
    try {
      const mine = myModel();
      let g;
      try {
        g = await hatchGenome(desc, mine.model, mine.url);
      } catch {
        // No local model — the words go to the pit and it hatches for them.
        if (!live) { done(); return; }
        live.send({ t: 'summon', key: myKey, desc });
        return;
      }
      if (live) {
        // Hatched HERE; only the body crosses the wire.
        live.send({ t: 'summon', key: myKey, genome: g });
      } else {
        const a = spawnChar(sim, makeCharacter(g, 'beast'), ME);
        yours = a;
        director.punch(0.7);
        done();
      }
    } catch {
      done();
    }
  }
  (buildSummon as any).finish = done;

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
    cam.cx = rig.ax = you ? you.x : 0;
    cam.cz = rig.az = you ? you.z : 0;
    cam.cy = you ? you.bulk * 0.55 : 0.9;
    cam.ppm = (view.size.H * (you ? 0.26 / Math.max(0.7, you.bulk) : 0.34 / 5)) * look.zoom;
    cam.yaw = you ? 0.5 : watchYaw;
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
  // NOTHING OF YOURS IS IN THERE. You are not in the fight, so the camera
  // stops pretending you are: it pulls back to take in the whole pool of light
  // and circles it slowly. An observer's view, not an operator's — the
  // director's close cutting is for when you have a stake in what it finds.
  const live = sim.agents.filter(a => a.deadT < 0);
  let cx = 0, cz = 0;
  for (const a of live) { cx += a.x; cz += a.z; }
  if (live.length) { cx /= live.length; cz /= live.length; }

  // Far enough out to take the pit in, but one creature wandering to the edge
  // should not shrink everyone else to specks: frame the bulk of the cast and
  // let a stray sit outside the frame until it comes back.
  const spread = live.map(a => Math.hypot(a.x - cx, a.z - cz)).sort((p, q) => p - q);
  // an empty pit frames the TITLE, not a guess about absent creatures
  const most = spread.length ? spread[Math.floor(spread.length * 0.7)] : 2.8;
  const reach = Math.max(2.6, Math.min(5.4, most + 1.6));

  watchYaw = (watchYaw + dt * 0.045) % (Math.PI * 2);   // a turn every 2.3 min

  cam.cx = smoothDamp(cam.cx ?? cx, cx, rig.vx, 2.2, dt);
  cam.cz = smoothDamp(cam.cz ?? cz, cz, rig.vz, 2.2, dt);
  cam.cy = smoothDamp(cam.cy, 0.9, rig.vy, 1.6, dt);
  const wide = (view.size.H * 0.46 / reach) * look.zoom * Math.exp(orbit.zoom);
  cam.ppm = smoothDamp(cam.ppm, wide, rig.vppm, 1.8, dt);
  cam.yaw = smoothDampAngle(wrapAngle(cam.yaw), wrapAngle(watchYaw + orbit.yaw), rig.vyaw, 1.2, dt);
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

/**
 * Who holds the pit. Most kills, and the older one wins a tie — a champion who
 * has been standing there for hours has earned it over a newcomer who matched
 * them this afternoon.
 */
let lordId = -1;
function findLord(sim: VoidSim): void {
  let best: Agent | null = null;
  for (const a of sim.agents) {
    // the lord is whoever HOLDS the pit — a lone first summon qualifies
    if (a.deadT >= 0) continue;
    if (!best || a.deeds.kills > best.deeds.kills
      || (a.deeds.kills === best.deeds.kills && a.deeds.born < best.deeds.born)) best = a;
  }
  lordId = best ? best.id : -1;
}

function agentCapsules(a: Agent, t: number): Capsule[] {
  const mood = {
    tired: 0,
    angry: a.state === 'fight' ? 0.75 : a.state === 'approach' ? 0.35 : 0,
  };
  let intent: Intent | undefined;
  if (a.strikeT >= 0) {
    const spec = strikeSpecOf(a);
    const u = Math.min(1, a.strikeT / (spec?.duration ?? 0.5));
    intent = { slash: { t: u, weight: slashWeight(u), spec } };
  }

  const caps = solvePose(
    a.genome, mood, a.phase, a.move, a.idleT, intent,
    // Dead is a full collapse; resting is most of one. A RECALL is neither —
    // the creature is not beaten, its summoner replaced it, so it stays on its
    // feet and simply goes.
    a.deadT >= 0 ? (a.recalled ? 0 : Math.min(1, a.deadT / 0.5)) : a.rest * 0.72,
    {
      weapon: a.ch.weapon,
      offhand: a.ch.offhand,
      // the crown belongs to the title, not to the creature
      gear: a.id === lordId ? [...(a.ch.gear ?? []), CROWN] : a.ch.gear,
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
  const fade = a.deadT >= 0
    ? (a.recalled ? Math.max(0, 1 - a.deadT / 0.9) : Math.max(0, 1 - Math.max(0, a.deadT - 2) / 1.5))
    : 1;
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
  const mine = a.by === ME;
  const y = a.bulk * 1.16 + 0.1 + Math.sin(t * 2.2 + a.id) * 0.025;
  const r = Math.max(0.035, a.bulk * 0.035) * (mine ? 1.35 : 1);
  const out: Capsule[] = [
    { a: v3(a.x, y, a.z), b: v3(a.x, y, a.z), r, color: col, part: 'sigil' },
    { a: v3(a.x, y - r * 2.4, a.z), b: v3(a.x, y - r * 1.1, a.z), r: r * 0.34, color: col, part: 'sigil' },
  ];
  if (!mine) return out;

  // YOURS. A pip above the head is not enough to find in a scrum of twelve, so
  // your own creature also stands in a ring on the floor — a shape nothing else
  // in the pit makes, readable at any zoom and from directly overhead, which is
  // where the camera usually is.
  const rad = Math.max(0.28, a.bulk * 0.42);
  const seg = 14;
  const spin = t * 0.5;
  for (let i = 0; i < seg; i++) {
    // a dashed ring: gaps make it read as a marker rather than a puddle
    if (i % 2) continue;
    const a0 = spin + (i / seg) * TAU;
    const a1 = spin + ((i + 1) / seg) * TAU;
    out.push({
      a: v3(a.x + Math.cos(a0) * rad, 0.015, a.z + Math.sin(a0) * rad),
      b: v3(a.x + Math.cos(a1) * rad, 0.015, a.z + Math.sin(a1) * rad),
      r: 0.028, color: col, part: 'sigil',
    });
  }
  return out;
}

/**
 * Health, built out of the same thing everything else is built out of: two
 * capsules in the world, so it sits in the blend field and blobs at its ends
 * like a body does. No overlay, no canvas text, nothing that would break if
 * you moved the camera.
 *
 * It is laid along the camera's right, so it reads as a bar from wherever you
 * are standing rather than foreshortening into a dot.
 */
function healthCapsules(a: Agent, mine: boolean): Capsule[] {
  if (a.deadT >= 0) return [];
  const frac = Math.max(0, Math.min(1, a.hp / Math.max(1, a.maxHp)));
  // yours is always legible; everything else earns its bar by bleeding
  const wounded = frac < 1 || a.hurtT > 0;
  if (!mine && !wounded) return [];

  const w = Math.max(0.34, Math.min(0.78, a.bulk * 0.46));
  const y = a.bulk * 1.16 + (mine ? 0.26 : 0.1);
  // the camera's right, in world terms
  const rx = Math.cos(-cam.yaw), rz = Math.sin(-cam.yaw);
  const half = w / 2;
  const lx = a.x - rx * half, lz = a.z - rz * half;
  const r = Math.max(0.022, a.bulk * 0.026);

  const out: Capsule[] = [{
    a: v3(lx, y, lz), b: v3(a.x + rx * half, y, a.z + rz * half),
    r, color: [26, 22, 30], part: 'hpTrack',
  }];
  if (frac > 0.001) {
    // red when it is nearly over, and it does not change hue before then
    const col: [number, number, number] = frac > 0.34
      ? (mine ? [110, 232, 214] : [206, 214, 224])
      : [226, 96, 78];
    out.push({
      a: v3(lx, y, lz),
      b: v3(lx + rx * w * frac, y, lz + rz * w * frac),
      r: r * 0.72, color: col, part: 'hpFill',
    });
  }
  return out;
}

// --- the pit, heard ---------------------------------------------------------
// The event stream already says who did what to whom, at what range. That was
// always going to feed sound; this is it finally doing so.

const pit = new Pit();
let voicesReady = false;

// The mute control, drawn by the same renderer as the creatures. Its state
// outlives the tab, because being silenced by a page you reopen is a small
// betrayal.
const MUTE_KEY = 'pit-muted';
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();
const muteCanvas = document.getElementById('muteIcon') as HTMLCanvasElement | null;
const muteIcon = muteCanvas ? new MuteIcon(muteCanvas, hexRgb(look.voidCol)) : null;
let muteFrame = 0;
const flicker = { next: 3, until: 0, len: 0, depth: 0, now: 1 };
function paintMute(): void { muteIcon?.draw(muted); }
paintMute();
muteCanvas?.addEventListener('pointerdown', e => {
  e.stopPropagation();
  e.preventDefault();
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* private */ }
  pit.mute(muted);
  paintMute();
  if (!muted) void wakeAudio();
});

async function wakeAudio(): Promise<void> {
  if (voicesReady) { pit.resume(); return; }
  voicesReady = true;
  try {
    const res = await fetch('voices/manifest.json');
    const names: string[] = res.ok ? await res.json() : [];
    if (names.length) await pit.start(names);
    pit.mute(muted);
  } catch { /* no voices is a silent pit, not a broken one */ }
}
// browsers will not make a sound until a person has done something
for (const ev of ['pointerdown', 'keydown'] as const) {
  addEventListener(ev, () => void wakeAudio(), { once: false });
}

const BANK_OF: Partial<Record<string, Bank>> = {
  strike: 'call', loose: 'call', hit: 'hurt', kill: 'die',
  notice: 'growl', flee: 'hurt', spawn: 'call', spoil: 'growl',
};

function voiceFor(a: Agent | undefined) {
  const sk = a?.genome.skeleton;
  return {
    mass: a ? a.bulk : 1,
    girth: sk ? Math.max(...sk.girth, 0.06) : 0.1,
    grit: a ? a.temper.aggression : 0.4,
  };
}

/**
 * A creature alone in the pit made no sound at all, because every voice hung
 * off a fight — and one creature alone is what the pit is nearly always doing.
 * So a thing that is not fighting still breathes, grumbles, and mutters at
 * nothing, rarely and quietly. That is the difference between an empty room
 * and an occupied one.
 */
const nextIdle = new Map<number, number>();
function idleVoices(sim: VoidSim, dt: number): void {
  for (const a of sim.agents) {
    if (a.deadT >= 0) continue;
    const due = (nextIdle.get(a.id) ?? 4 + Math.random() * 10) - dt;
    if (due > 0) { nextIdle.set(a.id, due); continue; }
    // sleeping things breathe slower and quieter than restless ones
    const asleep = a.state === 'rest';
    nextIdle.set(a.id, (asleep ? 9 : 5) + Math.random() * (asleep ? 22 : 14));
    if (a.state === 'fight' || a.state === 'approach') continue;
    const { pan, dist } = placeOf(a.x, a.z);
    pit.say(asleep ? 'die' : 'growl', voiceFor(a), pan, dist, asleep ? 0.18 : 0.3);
  }
}

/**
 * Footfalls, taken from the gait rather than guessed at. Phase 0 and 0.5 are
 * when the two sides plant — the same instants the foot-planting fix is built
 * around — so the sound lands exactly when the foot does, and a creature that
 * stops walking stops making noise without anything being told to stop it.
 */
const lastPhase = new Map<number, number>();
function footfalls(sim: VoidSim): void {
  for (const a of sim.agents) {
    const prev = lastPhase.get(a.id);
    lastPhase.set(a.id, a.phase);
    if (prev === undefined || a.deadT >= 0 || a.move < 0.12) continue;
    // did the phase cross a plant this frame? (it wraps, so mind the seam)
    const crossed = (p: number) =>
      prev < p ? a.phase >= p && a.phase - prev < 0.5 : a.phase < prev - 0.5 && a.phase >= 0;
    if (!crossed(0.5) && !(prev > a.phase && a.phase >= 0)) continue;
    const { pan, dist } = placeOf(a.x, a.z);
    if (dist > 0.95) continue;
    pit.step(a.bulk, pan, dist, 0.35 + a.move * 0.5);
  }
}

/** Where it happened, relative to what the camera is looking at. */
function placeOf(x: number, z: number): { pan: number; dist: number } {
  const dx = x - (cam.cx ?? 0), dz = z - (cam.cz ?? 0);
  const c = Math.cos(-cam.yaw), s = Math.sin(-cam.yaw);
  const sx = dx * c - dz * s;
  const d = Math.hypot(dx, dz);
  return { pan: Math.max(-1, Math.min(1, sx / 4)), dist: Math.min(1, d / 9) };
}

function speak(sim: VoidSim, e: import('./sim').VoidEvent): void {
  const bank = BANK_OF[e.kind];
  if (!bank) return;
  // a hit is voiced by whoever TOOK it, everything else by whoever did it
  const id = e.kind === 'hit' || e.kind === 'kill' ? e.target?.id : e.actor?.id;
  const who = sim.agents.find(a => a.id === id);
  const { pan, dist } = placeOf(e.x, e.z);
  const force = e.kind === 'kill' ? 1.15 : e.kind === 'hit' ? 0.9 : 0.7;
  pit.say(bank, voiceFor(who), pan, dist, force);
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
    case 'hit': return e.how === 'blocked' ? `${whom} takes it on the shield` : null;
    // a creature vanishing with nothing said about it reads as a bug
    case 'despawn': return `${who} is recalled`;
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

// The shared pit is the DEFAULT, not a flag. `?live` was a development
// switch, and leaving it opt-in meant anyone opening the deployed link got
// their own private simulation — two people on the same URL watched two
// different worlds and neither could see the other. A dev server has no pit
// behind it unless one is running, so there the old opt-in still applies.
const DEV_PORT = location.port === '5180' || location.port === '5173';
const LIVE = new URLSearchParams(location.search).has('solo')
  ? false
  : DEV_PORT
    ? new URLSearchParams(location.search).has('live')
    : true;
// Same origin by default, so a deployed pit needs no configuration at all and
// gets wss:// wherever the page got https://. The dev server is on another
// port, so there it falls back to the local pit.
const PIT_URL = new URLSearchParams(location.search).get('pit') ?? (() => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return DEV_PORT ? `ws://${location.hostname}:8787` : `${proto}//${location.host}`;
})();

async function boot() {
  const live = LIVE ? new LiveVoid() : null;
  if (live) live.connect(PIT_URL);
  const roster = live ? [] : await loadRoster();
  const sim = live ? live.sim : createVoid(roster, look.population);
  sim.peace = look.peace;

  if (live) {
    live.onKey = keepKey;
    // No dialogs. The field's state and the creature walking in are the whole
    // conversation; refusals just release the field.
    live.onYours = (id) => {
      const a = sim.agents.find(x => x.id === id);
      if (a) yours = a;
      (buildSummon as any).finish?.();
      director.punch(0.7);
    };
    live.onNope = why => {
      console.log('[pit]', why);
      (buildSummon as any).finish?.();
    };
    live.onSworn = () => { /* pacts are silent by design */ };
    live.send({ t: 'key', key: myKey || undefined });
    // a pact link is spent the moment it is opened, and leaves no trace in
    // the address bar — see keepKey
    const q = new URLSearchParams(location.search);
    const ally = q.get('pact'), feud = q.get('feud');
    if (ally || feud) {
      setTimeout(() => live.send({
        t: 'pact', key: myKey, to: ally ?? feud, stance: ally ? 'ally' : 'feud',
      }), 700);
    }
  }

  buildPanel(sim, live);
  buildSummon(sim, live);

  // how many metres of world the empty-pit observer will show across
  const frameW = (view.size.W * 4.4) / (0.46 * view.size.H);
  title = new WireTitle('the summoning pit', frameW);

  let last = performance.now();
  function tick(dt: number) {
    if (live) live.update(dt); else stepVoid(sim, dt);
    pushFeed(sim.events);
    for (const e of sim.events) {
      if (e.kind === 'kill') director.punch(1);
      else if (e.kind === 'hit') director.punch(0.45);
      speak(sim, e);
    }
    // DRAIN LAST. Clearing before this loop meant every event was thrown away
    // unread in live mode: no voices, and no camera shake on a kill either.
    // The ambience kept working and hid it, because footfalls come from the
    // gait rather than from events. Second time this exact ordering has bitten.
    if (live) sim.events.length = 0;
    footfalls(sim);
    idleVoices(sim, dt);
    driveCamera(sim, dt);

    // Blend is a PIXEL radius, and both the zoom and the mobile buffer cap
    // change how many pixels a metre is — so a fixed value read as soup up
    // close and as nothing zoomed out or on a phone. Tie it to ppm and the
    // softness is a property of the world again. 42 px/m is where 1.8 was
    // tuned.
    cam.blend = Math.min(6, Math.max(0.35, look.blend * (cam.ppm / 42)));

    // THE LIGHT IS A FLAME, not a fixture. Mostly it holds steady; every so
    // often it catches a draught and gutters for half a second — layered
    // sines, no noise, so the wavering is smooth. The audio's wind and the
    // pit's drips already say "underground"; the light now agrees.
    flicker.next -= dt;
    if (flicker.until > 0) {
      flicker.until -= dt;
      const w = Math.sin(sim.t * 31) * 0.5 + Math.sin(sim.t * 47 + 1.7) * 0.35 + Math.sin(sim.t * 13) * 0.15;
      const depth = flicker.depth * Math.sin(Math.PI * Math.min(1, 1 - flicker.until / flicker.len));
      flicker.now += ((1 - depth * (0.5 + 0.5 * w)) - flicker.now) * Math.min(1, 22 * dt);
    } else {
      flicker.now += (1 - flicker.now) * Math.min(1, 8 * dt);
      if (flicker.next <= 0) {
        flicker.len = 0.35 + Math.random() * 0.9;
        flicker.until = flicker.len;
        flicker.depth = 0.18 + Math.random() * 0.22;
        flicker.next = 4 + Math.random() * 12;
      }
    }
    cam.floorLift = look.floorLift * flicker.now;

    // the icon idles along with everything else, at half rate — it is 46px
    muteFrame = (muteFrame + 1) & 1;
    if (muteFrame === 0) muteIcon?.draw(muted, sim.t);

    findLord(sim);
    summonUI(sim);
    const caps: Capsule[] = [];
    if (title && !title.done) caps.push(...title.caps(dt, cam.yaw));
    else title = null;
    // scenery first: it never moves, so it is the same list every frame
    for (const pr of sim.props) caps.push(...pr.caps);
    for (const a of sim.agents) {
      caps.push(...agentCapsules(a, sim.t));
      caps.push(...sigilCapsules(a, sim.t));
      caps.push(...healthCapsules(a, a.by === ME));
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
    sim, cam, look, director, live, pit, get title() { return title; },
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

// dragging the stage orbits; the wheel pushes in and out; two fingers pinch
(() => {
  const stage = document.getElementById('stage')!;
  let down = false, lastX = 0;
  // pinch state: the wheel does not exist on a phone
  const touches = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  stage.addEventListener('pointerdown', e => {
    // The controls live INSIDE the stage, and this handler captures the
    // pointer — so a click on the mute icon was swallowed by the orbit drag
    // and never reached the icon at all. Anything that is a control is not a
    // place to start dragging the camera from.
    const t = e.target as HTMLElement | null;
    if (t instanceof HTMLInputElement || t?.id === 'muteIcon' || t?.closest?.('#summonBar')) return;
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
