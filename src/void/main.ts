// THE VOID — the screensaver. Creatures off the shelf live their little
// lives in a pool of light while a camera does its best to film them.

import { Character, makeCharacter, migrateCharacter } from '../character';
import { defaultBiped, Genome } from '../genome';
import { hatchGenome } from '../hatch';
import { solvePose, slashWeight, Capsule, Intent } from '../pose';
import { rotY, v3, TAU } from '../vec';
import { Camera } from '../render';
import { makeProp, PropKind } from '../props';
import { Motes, muzzle, wake, impact, spatter, undoing, dust, streak, gather } from '../particles';
import { PixelView } from '../view';
import { createVoid, stepVoid, spawnOne, spawnChar, strikeSpecOf, rangedOf, Agent, VoidSim, Shot } from './sim';
import { Director, smoothDamp, smoothDampAngle } from './director';
import { Pit, Bank } from './voice';
import { WireTitle } from './wiretitle';
import { MuteIcon } from './icon';
import { CROWN, GearPiece } from '../gear';
import { GUARD_STANCE } from '../character';
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

// A STORED LOOK IS DATA, NOT TRUTH. One non-finite slider value, persisted
// (JSON writes NaN as null), came back and overrode a default with null —
// which is 0 in every sum and Infinity under every division — and the boot
// died on it. Every number is checked against the range its own slider
// allows; anything else is the default, silently.
const LOOK_RANGE: Partial<Record<keyof Look, [number, number]>> = {
  res: [160, 1600], zoom: [0.4, 2.4], blend: [0, 8], blendShape: [0, 1], blendMix: [0, 1],
  floorRadius: [3, 25], floorPower: [0.3, 5], floorLift: [0, 1.4], tile: [0.25, 4],
  round: [0, 1], closeness: [0, 1], response: [0.12, 1.6], lead: [0, 1.4],
  pitch: [0, 0.9], orbit: [0, 0.8], population: [0, 8], peace: [0, 1],
};
function sanitiseLook(saved: any): Look {
  const out: Look = { ...DEFAULT_LOOK };
  for (const k of Object.keys(DEFAULT_LOOK) as (keyof Look)[]) {
    const v = saved?.[k], d = DEFAULT_LOOK[k];
    if (typeof d === 'number') {
      const [lo, hi] = LOOK_RANGE[k] ?? [-Infinity, Infinity];
      if (typeof v === 'number' && Number.isFinite(v)) (out as any)[k] = Math.min(hi, Math.max(lo, v));
    } else if (typeof d === 'boolean') {
      if (typeof v === 'boolean') (out as any)[k] = v;
    } else if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
      (out as any)[k] = v;
    }
  }
  return out;
}
function loadLook(): Look {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.v === LOOK_VERSION) {
        // the drawer is not a preference — `c` opens it, and it starts shut
        return { ...sanitiseLook(saved), panel: false };
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
// The CPU fallback renders every pixel by hand: at the full buffer a portrait
// phone tops out around 40fps. Devices without WebGPU get a smaller buffer
// and their 60 back — the soft-field look hides the resolution far better
// than it hides a stutter.
const MAX_BUFFER_CPU_PX = 500_000;
/**
 * Every device is a device we have never tested. Two fixed caps — one for
 * WebGPU, one for the hand-rasterised fallback — are a guess about hardware,
 * and a guess is what leaves a phone rendering four times the pixels it can
 * afford while the pit insists everything is fine. So the buffer is governed
 * by what the frames actually COST here: it gives back resolution until the
 * frames come in on time, and takes it back the moment there is headroom.
 * The soft-field look hides a smaller buffer far better than it hides a
 * stutter, which is the whole reason this trade is available.
 */
const PERF_FLOOR = 0.3;              // never below a third of the cap
let perfScale = 1;
/**
 * The camera's ppm is PIXELS per metre — buffer pixels. So resizing the
 * buffer without touching ppm changes how many metres are on screen: the
 * governor's first step down cut the view instantly tighter, and the damping
 * then crawled it back out over two seconds. That is the little zoom-in cut,
 * once as the title died (its physics spike the frame time) and again at
 * every governor window after.
 *
 * A resize must therefore carry the camera with it. Scale ppm by exactly the
 * factor the buffer changed by and the framing is invariant — the picture
 * gets softer or sharper, and does not move at all.
 */
let sizeBasis = 0;
let camRef: Camera | null = null;
// A RESIZE MUST NOT BLINK. Setting a canvas's width or height CLEARS it —
// even to the same value — and the cleared frame reaches the screen before
// the next rAF repaints it. On a phone that is every load (the browser bar
// collapsing), every tap on the summon box (the keyboard), and every governor
// refit: a black flash each time. So: never touch a dimension that has not
// changed, and when one has, repaint synchronously in the same task so the
// cleared canvas is never the one presented.
let repaint: (() => void) | null = null;
let repainting = false;
function fitCanvas() {
  const stage = document.getElementById('stage')!;
  const w = Math.max(240, Math.round(stage.clientWidth));
  const h = Math.max(200, Math.round(stage.clientHeight));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const aspect = h / w;
  const cap = (view.mode === 'cpu' ? MAX_BUFFER_CPU_PX : MAX_BUFFER_PX) * perfScale;
  const res = Math.min(look.res, Math.floor(Math.sqrt(cap / aspect)));
  const bufH = Math.max(80, Math.round(res * aspect));
  if (view.size.W !== res || view.size.H !== bufH) view.setSize(res, bufH);
  const basis = view.size.H;
  if (sizeBasis && basis !== sizeBasis && camRef) {
    const k = basis / sizeBasis;
    camRef.ppm *= k;
    rig.vppm.v *= k;      // the damper's velocity is in the same units
  }
  sizeBasis = basis;
  // guarded: tick() itself refits on a gpu→cpu fallback, and repainting from
  // inside that repaint would recurse
  if (repaint && !repainting) {
    repainting = true;
    try { repaint(); } finally { repainting = false; }
  }
}

// the last second and a half of real frame times, and the last time we moved
const frameMs: number[] = [];
let sinceGovern = 0;
let medianMs = 0;
/**
 * Judge on the MEDIAN, not the mean: a single 300ms hitch from a hatch or a
 * garbage collection would otherwise drag the buffer down and keep it there.
 */
let badWindows = 0;
function govern(ms: number): void {
  if (ms > 0 && ms < 400) frameMs.push(ms);
  if (frameMs.length > 90) frameMs.shift();
  sinceGovern += ms;
  if (frameMs.length < 40 || sinceGovern < 1500) return;
  sinceGovern = 0;
  const sorted = frameMs.slice().sort((a, b) => a - b);
  medianMs = sorted[sorted.length >> 1];
  const was = perfScale;
  // 20ms is 50fps: below that the eye reads stutter. But one bad window is
  // usually a passing cost — a title dying, a creature hatching — and acting
  // on it changes the picture's sharpness for a stumble that is already over.
  // Two in a row is a device that genuinely cannot keep up.
  if (medianMs > 20) {
    if (++badWindows >= 2) perfScale = Math.max(PERF_FLOOR, perfScale * 0.8);
  } else {
    badWindows = 0;
    // and take them back slowly, so a lull does not start an oscillation
    if (medianMs < 11 && perfScale < 1) perfScale = Math.min(1, perfScale * 1.1);
  }
  if (perfScale !== was) {
    badWindows = 0;
    frameMs.length = 0;          // the old times describe the old buffer
    fitCanvas();
  }
}
const view = new PixelView(canvas, look.res, Math.round(look.res * 0.625));
// THE RENDERER DECIDES LATE. Picking cpu or gpu is asynchronous, and until it
// has answered, every frame drawn is a software raster of four hundred-odd
// capsules — the most expensive thing this program can do, on the one device
// least able to afford it — and all of it is thrown away the moment the gpu
// arrives, because the two modes cap the buffer differently (500k vs 851k
// pixels) and the handover resizes the buffer and rescales ppm under the
// camera. That was the load: a few enormous stuttering frames, then a jump in
// resolution and zoom. So the pit does not draw until the renderer has
// settled. The handover happens in the dark and the first frame anyone sees
// is the real one, at the real size.
let rendererReady = false;
function settleRenderer(): void {
  if (rendererReady) return;
  rendererReady = true;
  (fitCanvas as any).mode = view.mode;
  fitCanvas();
}
view.init().then(settleRenderer, settleRenderer);
// a device whose gpu probe never answers still gets a pit, on the cpu
setTimeout(settleRenderer, 2500);
fitCanvas();
addEventListener('resize', fitCanvas);
// the stage changes size whenever the drawer opens or the window moves;
// observing it is more reliable than guessing when the layout settled
new ResizeObserver(fitCanvas).observe(document.getElementById('stage')!);

const cam: Camera = {
  yaw: 0.6, pitch: look.pitch, ppm: look.zoom, cy: 0.95, cx: 0, cz: 0, tile: look.tile,
};
// from here on, a buffer resize carries the framing with it
camRef = cam;

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
/**
 * 'pit-key2', not 'pit-key': the first slot is POISONED. In the shared-URL
 * era a copied address carried its owner's key, and everyone who opened it
 * became the same person — and 'honouring old bookmarks once' kept feeding
 * that merge long after the URLs were fixed. A friend's summon would read as
 * YOURS, crown you lord of a creature you never made, and lock your box. So:
 * a key from a URL is never accepted again, and the old storage slot is
 * retired unread. Every browser mints its own identity from here on; the old
 * cast goes wild — still standing, still killable, owned by no one.
 */
const KEY_STORE = 'pit-key2';
// READING storage throws too. The write below was guarded for private windows;
// this read was not, and in a Chrome profile that blocks the site's data it
// threw here — at module scope, before boot — and the page stayed dark with
// nothing running to lift it. No key is just a first visit.
let myKey = (() => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } })();
// no key yet = never been here: the pit introduces itself, once
const FIRST_VISIT = !myKey;
let saidIntro = false;
let ME = 'local';

/**
 * The key NEVER goes in the address bar, and one arriving there is never
 * honoured (see KEY_STORE above for the scar). It is still STRIPPED, so an
 * old bookmark's URL comes clean and stays safe to pass on.
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
  ax: 0, az: 0,
  crowd: 0,   // how often the keep-in clamps have fired lately: earned zoom-out                                    // the anchor, not the creature
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
    // remembered until you say otherwise: ?model=off / ?ollama=off forgets it
    if (v === 'off') { try { localStorage.removeItem('pit-' + k); } catch { /* private */ } }
    else if (v) { try { localStorage.setItem('pit-' + k, v); } catch { /* private */ } }
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
let summonAt = 0;             // when the current summon left the box

/**
 * The status line is the pit's only voice, and it speaks in whispers: a
 * refusal, a fall, the socket going quiet. A whisper outranks the lord line
 * for its few seconds (or, for a death, until you reach for the box again);
 * with nothing to say and no hero of yours in play, the line names whoever
 * holds the pit so a first look has stakes.
 */
const whisperState = { text: '', until: 0, sticky: false };
function whisper(text: string, secs: number, sticky = false): void {
  whisperState.text = text;
  whisperState.until = performance.now() / 1000 + secs;
  whisperState.sticky = sticky;
}
function hushWhisper(): void {
  whisperState.text = '';
  whisperState.sticky = false;
}

/**
 * The box tells the whole game itself: on load the placeholder is TYPED on,
 * line by line, and the last line it types is the verb — which is exactly
 * the placeholder the box would have worn anyway, so the introduction ends
 * by becoming the interface. Timed from load on a wall clock, so a box that
 * was busy (a hero in play) while the window passed simply never plays it.
 */
// what typing looks like, shown to whoever has not typed yet: a concrete
// example beats any instruction. Cycles quietly after the introduction.
const EXAMPLES = [
  'a one-eyed marsh troll with a rusted cleaver',
  'a frost-breathing river wyrm',
  'a knight in tattered plate with a tower shield',
  'a bone spider, many-legged and small',
  'a wandering monk with a quarterstaff and satchel',
  'a fire-breathing hound in a horned helm',
  'a lean archer with a longbow and cloak',
];
function exampleText(now: number): string {
  // 6s of the verb, then 4s of one example, round and round
  const cycle = (now % 10);
  if (cycle < 6) return 'summon…';
  return EXAMPLES[Math.floor(now / 10) % EXAMPLES.length];
}
// the fall of YOUR creature is the loop's biggest beat; carry enough of it
// to say something when the agent is suddenly not there any more. The absence
// must LAST before it is called a death — a snapshot boundary can lose the
// whole cast for a frame, and that is not a funeral.
let heldMine: { name: string; kills: number; since: number; goneAt: number } | null = null;
let myKiller = '';   // who felled yours, from the kill event — revenge needs a name
let pactHinted = false;

const SUMMON_MURMURS = ['the pit listens…', 'something forms…', 'it is coming…'];

/**
 * A reign should LOOK like a reign: the crown's points grow with the hours
 * held, so a visitor arriving to a quiet pit still reads the story.
 */
function crownFor(ageSecs: number): GearPiece {
  // Straight UP and gently: scaling every axis leant the points outward and
  // an overnight lord wore antlers. A tenth per hour, capped at a third.
  const growth = 1 + Math.min(0.3, (ageSecs / 3600) * 0.1);
  if (growth < 1.02) return CROWN;
  return {
    ...CROWN,
    parts: CROWN.parts.map((part, i) => i < 2 ? part : ({
      ...part,
      b: [part.b[0], part.b[1] * growth, part.b[2]] as [number, number, number],
    })),
  };
}

function summonUI(sim: VoidSim, net: LiveVoid | null): void {
  const box = document.getElementById('summonBox') as HTMLInputElement | null;
  const status = document.getElementById('summonStatus');
  if (!box || !status) return;

  // company, counted quietly: only when someone else is actually here
  const eyes = document.getElementById('watchTag');
  if (eyes) {
    const n = net?.watchers ?? 0;
    const line = n >= 2 ? `${n} watching` : '';
    if (eyes.textContent !== line) eyes.textContent = line;
  }

  const mine = sim.agents.find(a => a.by === ME && a.deadT < 0) ?? null;
  if (mine) yours = mine;
  const now = performance.now() / 1000;

  // watch for the fall — but never while the socket is down, when the whole
  // cast can flicker out of the snapshot without anyone having died
  if (!net || net.connected) {
    if (mine) {
      if (!heldMine || heldMine.name !== mine.ch.name) heldMine = { name: mine.ch.name, kills: 0, since: now, goneAt: 0 };
      heldMine.kills = mine.deeds.kills;
      heldMine.goneAt = 0;
      // once per sitting, the pit mentions pacts — after yours has stood a while
      if (!pactHinted && now - heldMine.since > 45 && net) {
        pactHinted = true;
        whisper('allies exist — tap this line to copy a pact link', 8);
      }
    } else if (heldMine && !summoning) {
      if (!heldMine.goneAt) heldMine.goneAt = now;
      if (now - heldMine.goneAt > 1) {
        const stood = heldMine.goneAt - heldMine.since;
        const age = stood >= 90 ? `${Math.round(stood / 60)}m` : `${stood | 0}s`;
        const glory = heldMine.kills === 1 ? '1 kill' : `${heldMine.kills} kills`;
        const by = myKiller ? ` to ${myKiller}` : '';
        whisper(`${heldMine.name} fell${by} — ${glory}, stood ${age}`, 30, true);
        heldMine = null;
        myKiller = '';
      }
    }
  }

  // the pause only gates the pit's own model — with credit gone the box says
  // so up front instead of letting people type into a wall of refusals
  const paused = !mine && !summoning && (net?.pauseFor() ?? 0) > 0;
  const state = summoning ? 'summoning' : mine ? 'inplay' : paused ? 'paused' : 'active';
  if (box.dataset.state !== state) {
    box.dataset.state = state;
    box.disabled = state !== 'active';
    box.placeholder =
      state === 'summoning' ? 'summoning…'
      : state === 'inplay' ? `${mine!.ch.name.split(' ')[0]} stands — yours`
      : state === 'paused' ? 'summoning paused — back soon'
      : 'summon…';
  }
  // the wait is a ritual, not a spinner: the placeholder murmurs while it lasts
  if (state === 'summoning') {
    const murmur = SUMMON_MURMURS[Math.floor((now - summonAt) / 2.8) % SUMMON_MURMURS.length];
    if (box.placeholder !== murmur) box.placeholder = murmur;
  }
  // the placeholder is the verb, with the occasional worked example — the
  // introduction lives in the pit itself now, in wire type
  if (state === 'active') {
    const line = document.activeElement === box ? 'summon…' : exampleText(now);
    if (box.placeholder !== line) box.placeholder = line;
  }

  let lordText = '';
  let amLord = false;
  if (whisperState.text && (whisperState.sticky || now < whisperState.until)) {
    lordText = whisperState.text;
  } else if (net?.everConnected && !net.connected) {
    lordText = 'the pit is far away…';
  } else if (mine) {
    amLord = mine.id === lordId;
    lordText = amLord ? 'YOU ARE PIT LORD' : 'you are not pit lord';
  } else {
    const lord = sim.agents.find(a => a.id === lordId && a.deadT < 0);
    if (lord) {
      const glory = lord.deeds.kills === 1 ? '1 kill' : `${lord.deeds.kills} kills`;
      lordText = `${lord.ch.name} holds the pit — ${glory}`;
    }
  }
  if (status.textContent !== lordText) status.textContent = lordText;
  status.classList.toggle('lord', amLord);
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
    summonAt = performance.now() / 1000;
    hushWhisper();
    box.value = '';
    box.blur();          // the phone keyboard goes away the moment you commit
    // a lost packet must not wedge the field shut forever
    settle = window.setTimeout(done, 45000);
    try {
      const mine = myModel();
      // A PUBLIC PAGE DOES NOT KNOCK ON LOCALHOST. Without a model of your
      // own named, this used to try a local Ollama first on EVERY summon and
      // only then send the words to the pit — a silent failure on a dev box,
      // but on the live site Chrome now asks every visitor whether the pit
      // may "access other apps and services on this device". Bring-your-own
      // stays exactly as it was; it just has to be asked for.
      let g;
      // (a dev page on localhost is already local: it keeps the old default)
      if (!mine.model && !mine.url && !DEV_PORT) {
        if (!live) { done(); return; }
        live.send({ t: 'summon', key: myKey, desc });
        return;
      }
      try {
        g = await hatchGenome(desc, mine.model, mine.url);
      } catch {
        // the model you named is not answering — the pit hatches for you
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

  // Your pact link carries only your OWNER id — a one-way hash, safe to hand
  // out. Tap the status line while yours stands and it is on the clipboard.
  const statusEl = document.getElementById('summonStatus');
  statusEl?.addEventListener('click', () => {
    if (!ME || ME === 'local' || !yours || yours.deadT >= 0) return;
    const link = `${location.origin}/?pact=${ME}`;
    navigator.clipboard?.writeText(link).then(
      () => whisper('pact link copied — send it to a friend', 6),
      () => whisper(link, 10),
    );
  });

  box.addEventListener('focus', hushWhisper);
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
  // A CAMERA THAT HAS GONE NON-FINITE HEALS ITSELF. One NaN in the rig and
  // every projection is NaN — a black canvas — and it feeds NaN into every
  // pan and distance the sound asks for. Rather than trust it never happens,
  // check, and if it has, start the camera cold again: one clean cut beats a
  // dead page.
  if (![cam.cx ?? 0, cam.cz ?? 0, cam.yaw, cam.ppm, cam.cy].every(Number.isFinite)) {
    console.warn('[pit] camera went non-finite; restarting it cold');
    cam.cx = 0; cam.cz = 0; cam.cy = 0.9; cam.yaw = 0.6; cam.ppm = look.zoom * 40;
    rig.ax = 0; rig.az = 0;
    rig.vx.v = 0; rig.vz.v = 0; rig.vy.v = 0; rig.vppm.v = 0; rig.vyaw.v = 0;
    camCold = true;
  }
  const you = yourAgent(sim);
  // While the title stands the camera frames the stage for EVERYONE — the
  // follow rig was still dragging owners off to their hero mid-word.
  const titleUp = !!(title && !title.done);
  // A portrait phone shows barely half the metres a desktop does when the
  // framing is sized off HEIGHT alone — the hero kept walking out of the
  // sides. Frame off whichever dimension is actually the tight one. The title
  // keeps the height basis it was tuned against.
  const frameH = Math.min(view.size.H, view.size.W * 1.2);
  if (camCold) {
    // damping in from a cold camera means a second of looking at nothing
    camCold = false;
    cam.cx = rig.ax = you && !titleUp ? you.x : 0;
    cam.cz = rig.az = you && !titleUp ? you.z : 0;
    cam.cy = you && !titleUp ? you.bulk * 0.55 : 0.9;
    cam.ppm = ((titleUp ? view.size.H : frameH) * (you && !titleUp ? 0.26 / Math.max(0.7, you.bulk) : 0.34 / 5)) * look.zoom;
    cam.yaw = you && !titleUp ? 0.5 : watchYaw;
    return;
  }
  if (you && !titleUp) {
    orbit.idle += dt;
    if (orbit.idle > 2) {
      // a hand on the camera holds it; take it off and it comes home slowly
      orbit.yaw = smoothDamp(orbit.yaw, 0, { v: 0 }, 2.4, dt);
      orbit.zoom = smoothDamp(orbit.zoom, 0, { v: 0 }, 2.4, dt);
    }

    // THE FIGHT IS THE FRAME. When yours is engaged, its opponent must be
    // on screen too — a duel with one fencer visible is nothing. The anchor
    // drifts toward the pair's midpoint (biased to yours), and the zoom
    // backs out below until both fit.
    const foeSep = (o: Agent) => Math.hypot(o.x - you.x, o.z - you.z);
    // engagement begins at the DECISION, not at sword-length: two creatures
    // stalking each other from across the pit are already a duel
    const foe =
      (you.target && you.target.deadT < 0 && foeSep(you.target) < 12) ? you.target
      : sim.agents.find(o => o !== you && o.deadT < 0 && o.target === you && foeSep(o) < 12) ?? null;
    const aimX = foe ? you.x + (foe.x - you.x) * 0.42 : you.x;
    const aimZ = foe ? you.z + (foe.z - you.z) * 0.42 : you.z;

    // the anchor only gives when the creature has actually gone somewhere.
    // The deadzone is WORLD metres, but 'has gone somewhere' is a question
    // about the SCREEN: 0.9m was 50px of slack on a desktop and most of the
    // width on a zoomed-in phone, which is exactly a creature parked on the
    // bezel with the camera calling it centred.
    const dead = Math.min(DEADZONE, (view.size.W * 0.18) / cam.ppm);
    const dx = aimX - rig.ax, dz = aimZ - rig.az;
    const d = Math.hypot(dx, dz);
    if (d > dead) {
      const pull = (d - dead) / d;
      rig.ax += dx * pull;
      rig.az += dz * pull;
    }

    // the chase quickens with the distance fallen behind: calm jockeying is
    // still ignored, but a hero sprinting off no longer outruns the frame
    const lag = Math.hypot(rig.ax - (cam.cx ?? rig.ax), rig.az - (cam.cz ?? rig.az));
    const chase = Math.max(0.32, 0.75 - lag * 0.16);
    cam.cx = smoothDamp(cam.cx ?? rig.ax, rig.ax, rig.vx, chase, dt);
    cam.cz = smoothDamp(cam.cz ?? rig.az, rig.az, rig.vz, chase, dt);
    // height comes off its SIZE, never off its bob — following the bounce is
    // following a spring with a camera bolted to it
    cam.cy = smoothDamp(cam.cy, you.bulk * 0.55, rig.vy, 1.1, dt);
    // a creature that keeps hitting the frame's edge earns a wider frame;
    // calm ones get the close-up back as the memory decays
    rig.crowd = (rig.crowd ?? 0) * Math.exp(-dt * 0.5);
    let want = (frameH * 0.26 / Math.max(0.7, you.bulk)) * look.zoom * Math.exp(orbit.zoom)
      * (1 - Math.min(0.35, rig.crowd ?? 0));
    if (foe) {
      // zoom out until the whole duel fits, whatever the damps are doing
      const sep = foeSep(foe);
      const fit = (Math.min(view.size.W, view.size.H) * 0.42) / (sep * 0.5 + 1.5);
      want = Math.min(want, Math.max(fit, 20));
    }
    // the cut to duel-framing is a CUT, not a drift — while the zoom lags,
    // the two keep-in clamps are geometrically unsatisfiable
    cam.ppm = smoothDamp(cam.ppm, want, rig.vppm, foe ? 0.35 : 1.3, dt);
    // The director leaves cam.yaw unwrapped — it had wound to 17 radians by
    // the time a creature died and came back. Interpolating that linearly to
    // 0.5 spins the camera two and a half times, which is exactly the thing
    // that makes people feel ill. Always take the short way round.
    cam.yaw = smoothDampAngle(wrapAngle(cam.yaw), 0.5 + orbit.yaw, rig.vyaw, 1.1, dt);
    // A guarantee, not a tendency: however far the damps lag, the fighters do
    // not leave the frame. This runs LAST, against the frame's final yaw and
    // zoom — clamping before the yaw damp let the rotated axes leak
    // depth-slack back into the horizontal. The foe's clamp runs FIRST and
    // looser, so when both pull, yours wins.
    const keepIn = (px: number, pz: number, fx: number, fz: number) => {
      const off = rotY(v3(px - (cam.cx ?? 0), 0, pz - (cam.cz ?? 0)), cam.yaw);
      const mx = (view.size.W * fx) / cam.ppm;
      const mz = (view.size.H * fz) / cam.ppm;
      const ex = off.x - Math.max(-mx, Math.min(mx, off.x));
      const ez = off.z - Math.max(-mz, Math.min(mz, off.z));
      if (ex || ez) {
        const back = rotY(v3(ex, 0, ez), -cam.yaw);
        cam.cx = (cam.cx ?? 0) + back.x;
        cam.cz = (cam.cz ?? 0) + back.z;
        // the clamp firing means the zoom is too tight for this creature's
        // speed — remember it, and the framing eases wider (see want)
        rig.crowd = Math.min(0.4, (rig.crowd ?? 0) + Math.hypot(ex, ez) * 0.6);
      }
    };
    if (foe) keepIn(foe.x, foe.z, 0.42, 0.34);
    keepIn(you.x, you.z, 0.3, 0.26);
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
  let reach = Math.max(2.6, Math.min(5.4, most + 1.6));
  // A FIGHT OUTRANKS THE CENTROID: two creatures duelling at the pit's edge
  // were being averaged with the sleepers and clipped off screen. Centre on
  // the pair and take both in.
  const brawler = live.find(a => (a.state === 'fight' || a.state === 'approach')
    && a.target && a.target.deadT < 0);
  if (brawler && brawler.target) {
    const t2 = brawler.target;
    cx = (brawler.x + t2.x) / 2;
    cz = (brawler.z + t2.z) / 2;
    const sep = Math.hypot(brawler.x - t2.x, brawler.z - t2.z);
    reach = Math.max(2.6, Math.min(5.4, sep * 0.5 + 2.2));
  }
  // While the title stands, the title IS the show. The observer used to chase
  // whatever creature was wandering the far side of the pit, and on a phone
  // the whole opening played off-screen. The camera holds the stage until the
  // word has died, then goes back to its cast.
  if (titleUp) { cx = 0; cz = 0; reach = 4.4; }

  watchYaw = (watchYaw + dt * 0.045) % (Math.PI * 2);   // a turn every 2.3 min

  cam.cx = smoothDamp(cam.cx ?? cx, cx, rig.vx, 2.2, dt);
  cam.cz = smoothDamp(cam.cz ?? cz, cz, rig.vz, 2.2, dt);
  cam.cy = smoothDamp(cam.cy, 0.9, rig.vy, 1.6, dt);
  const wide = ((titleUp ? view.size.H : frameH) * 0.46 / reach) * look.zoom * Math.exp(orbit.zoom);
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
/**
 * A PROJECTILE IS A STREAK, NOT A STRING OF BEADS. The trail was one sphere
 * per remembered position, sampled at the sim's rate — so at bolt speed the
 * beads sat a third of a metre apart and read as a dotted line chasing a ball.
 * Drawn as a CHAIN instead, each segment starting where the last ended, the
 * distance field fuses it into a single tapering ribbon and the gaps close.
 * Same capsule count, and now it reads as something moving fast.
 */
function shotCapsules(s: Shot): Capsule[] {
  const out: Capsule[] = [];
  streak(out, s.x, s.y, s.z, s.trail, hexRgb3(s.spec.color), s.spec.size, hexRgb(look.voidCol));
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
  // THE IDLE IS ALIVE. A creature with nothing to do rocks its weight
  // between its feet, sweeps its head with a second thought inside the
  // sweep, and breathes deeper — the same drives the social portraits use.
  // Time runs from sim.t plus the creature's own offset, so a pit of ten
  // never metronomes. It fades with movement rather than switching, and a
  // strike, a guard or death takes the body back outright.
  const calm = (a.strikeT >= 0 || a.guardT > 0 || a.deadT >= 0)
    ? 0 : Math.max(0, 1 - a.move * 2.2) * (1 - a.rest * 0.8);
  const it = t + a.id * 4.7;
  const f = (cy: number, ph = 0) => Math.sin(Math.PI * 2 * (cy / 20) * it + ph);
  // at crowd scale, not hero scale: the social kit's portrait amplitudes sit
  // on top of live springs here, and a pit of ten heads sweeping 45° apiece
  // read as necks gone wrong rather than creatures looking about
  const idle = calm > 0.01 ? {
    lookYaw: (0.42 * f(3) + 0.12 * f(7, 1.3)) * calm,
    lean: 0.16 * f(2, 0.6) * calm,
    twist: 0.14 * f(5) * calm,
    bob: 0.018 * f(4, 2.1) * calm,
    jiggle: 0.04 * f(6) * calm,
  } : { lookYaw: 0, lean: 0, twist: 0, bob: 0, jiggle: 0 };
  const mood = {
    tired: 0,
    angry: a.state === 'fight' ? 0.75 : a.state === 'approach' ? 0.35 : 0,
  };
  let intent: Intent | undefined;
  if (a.strikeT >= 0) {
    const spec = strikeSpecOf(a);
    const u = Math.min(1, a.strikeT / (spec?.duration ?? 0.5));
    intent = { slash: { t: u, weight: slashWeight(u), spec } };
  } else if (a.guardT > 0) {
    // the block is held, not swung: the guard stance frozen at mid-arc
    intent = { slash: { t: 0.5, weight: Math.min(1, a.guardT * 6), spec: GUARD_STANCE } };
  }

  const caps = solvePose(
    a.genome, mood, a.phase, a.move, a.idleT, intent,
    // Dead is a full collapse; resting is most of one. A RECALL is neither —
    // the creature is not beaten, its summoner replaced it, so it stays on its
    // feet and simply goes.
    // a blow to the LEGS buckles them for a beat — a fraction of the
    // collapse blend, decaying with the flinch
    a.deadT >= 0 ? (a.recalled ? 0 : Math.min(1, a.deadT / 0.5))
      : Math.min(0.9, a.rest * 0.72
        + (a.flinch && a.flinch.h < 0.35 ? 0.22 * (a.flinch.t / 0.5) : 0)),
    {
      // a thrown spear is in the FLOOR, not the hand — the relic renders it
      weapon: a.thrownRelic != null ? undefined : a.ch.weapon,
      offhand: a.ch.offhand,
      // the crown belongs to the title, not to the creature
      gear: a.id === lordId ? [...(a.ch.gear ?? []), crownFor(t - a.deeds.born)] : a.ch.gear,
      turn: a.turnRate,
      // the head has already been through its own spring — it arrives late
      // and goes past, rather than snapping onto the target
      // a blow to the head SNAPS it aside; the spring brings it back
      lookYaw: Math.max(-1.1, Math.min(1.1, a.sec.head + idle.lookYaw
        + (a.flinch && a.flinch.h > 0.75 ? a.flinch.side * 0.8 * (a.flinch.t / 0.5) : 0))),
      lean: a.sec.lean + idle.lean,
      twist: a.sec.twist + idle.twist,
      bob: a.sec.bob + idle.bob,
      jiggle: a.sec.jiggle + idle.jiggle,
      breatheAmp: 1 + calm * 1.2,
      // the rubber hose is a cost the governor can spend: a device that has
      // had to step the resolution down gets stiffer limbs before it gets
      // fewer pixels again (1.0 → 0.64 on the scale maps hose 1 → 0)
      hose: Math.max(0, Math.min(1, (perfScale - 0.64) / 0.36)),
    },
  );
  // BEING HIT IS A WAVE, not a strobe. The blow lands somewhere; a pulse of
  // the body's OWN colours, brightened, travels outward from that spot
  // through the limbs and fades as it goes — a chain reaction in light
  // instead of a white flash.
  const wave = a.flinch;
  const waveAge = wave ? 1 - wave.t / 0.5 : 0;
  const waveR = waveAge * a.bulk * 1.9;
  const waveAmp = wave ? Math.pow(wave.t / 0.5, 0.6) * 1.5 : 0;
  const sigma = Math.max(0.12, a.bulk * 0.3);
  const spotY = wave ? a.bulk * wave.h : 0;
  const spotZ = wave ? wave.side * a.bulk * 0.18 : 0;
  const fade = a.deadT >= 0
    ? (a.recalled ? Math.max(0, 1 - a.deadT / 0.9) : Math.max(0, 1 - Math.max(0, a.deadT - 2) / 1.5))
    : 1;
  const yaw = -(a.heading + a.sec.spin);
  const world = caps.map(c => {
    const p = rotY(c.a, yaw);
    const q = rotY(c.b, yaw);
    let col: [number, number, number] = [c.color[0] * fade, c.color[1] * fade, c.color[2] * fade];
    if (wave && waveAmp > 0.02) {
      const mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2, mz = (c.a.z + c.b.z) / 2;
      const d = Math.hypot(mx * 0.6, my - spotY, mz - spotZ);
      const g = Math.exp(-((d - waveR) * (d - waveR)) / (2 * sigma * sigma)) * waveAmp;
      if (g > 0.03) {
        const k = 1 + g;
        col = [Math.min(255, col[0] * k + 40 * g), Math.min(255, col[1] * k + 40 * g), Math.min(255, col[2] * k + 40 * g)];
      }
    }
    return {
      ...c,
      a: v3(p.x + a.x, p.y, p.z + a.z),
      b: v3(q.x + a.x, q.y, q.z + a.z),
      color: col,
    };
  });
  // THE HAND, IN WORLD SPACE. Only the pose solver knows where it ended up —
  // it is the far end of a swing, a carry pose, two springs and a living
  // idle — so anything that belongs AT the hand has to read it back out of
  // the body that was drawn. The last one is the weapon hand; a one-armed
  // thing has only the one.
  for (let i = world.length - 1; i >= 0; i--) {
    if (world[i].part === 'hand') { handAt.set(a.id, world[i].a); break; }
  }
  return world;
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
  // desaturated greys, not the owner's hue — the pit is candle-lit, and a
  // saturated ring read as neon in it. The dashes alternate three greys so
  // the turn is still legible.
  const GREYS: [number, number, number][] = [[128, 132, 138], [96, 100, 106], [148, 152, 158]];
  for (let i = 0; i < seg; i++) {
    // a dashed ring: gaps make it read as a marker rather than a puddle
    if (i % 2) continue;
    const a0 = spin + (i / seg) * TAU;
    const a1 = spin + ((i + 1) / seg) * TAU;
    out.push({
      a: v3(a.x + Math.cos(a0) * rad, 0.015, a.z + Math.sin(a0) * rad),
      b: v3(a.x + Math.cos(a1) * rad, 0.015, a.z + Math.sin(a1) * rad),
      r: 0.028, color: GREYS[(i >> 1) % 3], part: 'sigil',
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
  // the reign's open wounds: the far end of the track healing can no longer
  // reach, sealed off in dried-blood dark. An old lord wears its history.
  const scarFrac = Math.min(0.6, a.scars / Math.max(1, a.maxHp));
  if (scarFrac > 0.001) {
    out.push({
      a: v3(lx + rx * w * (1 - scarFrac), y, lz + rz * w * (1 - scarFrac)),
      b: v3(a.x + rx * half, y, a.z + rz * half),
      r: r * 0.82, color: [64, 34, 36], part: 'hpScar',
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
    // THE SAME CROSSING THAT MAKES THE SOUND MAKES THE DUST. One event, two
    // senses — and heavy things kick up more of it, which is the cheapest
    // way there is to say a thing is heavy.
    if (a.bulk > 0.75 || a.move > 0.5) {
      dust(motes, a.x, a.z, a.bulk, Math.min(1.2, a.move * a.bulk), hexRgb(look.floorColA));
    }
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
  // a camera that has gone non-finite must not reach an AudioParam — Chrome
  // throws on a NaN there, and that throw was the whole page
  const pan = Math.max(-1, Math.min(1, sx / 4)), dist = Math.min(1, d / 9);
  return { pan: Number.isFinite(pan) ? pan : 0, dist: Number.isFinite(dist) ? dist : 1 };
}

/**
 * The pit's motes. Never on the wire, never in the sim: the server says what
 * happened and every screen draws its own version of it. Budgeted, because
 * the gpu walks every capsule for every pixel and a fireball must not be the
 * thing that costs a phone its frame rate.
 */
const motes = new Motes();

/** Where each creature's weapon hand is this frame, read off the drawn body. */
const handAt = new Map<number, { x: number; y: number; z: number }>();

/**
 * Shots are watched rather than told about. A projectile arriving in the
 * snapshots gets a wake behind it; one that VANISHES has landed, and the
 * client knows where, what colour, how big and whether it goes off — so an
 * explosion needs no message of its own.
 */
const shotSeen = new Map<number, { x: number; y: number; z: number; c: [number, number, number]; r: number; boom: number }>();
function shotEffects(sim: VoidSim, dt: number): void {
  const alive = new Set<number>();
  for (const s of sim.shots) {
    alive.add(s.id);
    const col = hexRgb3(s.spec.color);
    const was = shotSeen.get(s.id);
    if (was && dt > 1e-4) {
      // speed comes from the shot's own travel, so a client needs no more of
      // the spec than it already has to tell a bolt from a spell
      wake(motes, s.x, s.y, s.z,
        (s.x - was.x) / dt, (s.y - was.y) / dt, (s.z - was.z) / dt,
        col, s.spec.size, dt);
    }
    shotSeen.set(s.id, {
      x: s.x, y: s.y, z: s.z, c: col, r: s.spec.size, boom: s.spec.boom ?? 0,
    });
  }
  for (const [id, last] of shotSeen) {
    if (alive.has(id)) continue;
    impact(motes, last.x, Math.max(0.06, last.y), last.z, last.c, last.r, last.boom);
    shotSeen.delete(id);
  }
}

/** What an event throws off. The sim decides what happened; this decides how it looked. */
function sparks(sim: VoidSim, e: import('./sim').VoidEvent): void {
  const at = (id?: number) => sim.agents.find(a => a.id === id);
  if (e.kind === 'loose') {
    const a = at(e.actor?.id);
    if (!a) return;
    const dx = Math.cos(a.heading), dz = Math.sin(a.heading);
    // at the hand the gather has been filling, in the shot's own colour, so
    // the flash is plainly the release of the thing that was building
    const hand = handAt.get(a.id);
    const r = rangedOf(a);
    muzzle(motes,
      hand?.x ?? a.x + dx * a.bulk * 0.34,
      hand?.y ?? a.bulk * 0.62,
      hand?.z ?? a.z + dz * a.bulk * 0.34,
      dx, dz, hexRgb3(r?.color ?? a.ch.genome.palette.accent), r?.size ?? 0.05);
    return;
  }
  if (e.kind === 'hit') {
    const t = at(e.target?.id);
    if (!t) return;
    const src = at(e.actor?.id);
    // away from whoever swung, and in the struck creature's OWN colours —
    // the same rule the hit-wave follows, so a stone thing sheds grit
    const dx = src ? t.x - src.x : 0, dz = src ? t.z - src.z : 0;
    const force = e.how === 'blocked' || e.how === 'parried' ? 0.5
      : e.how === 'guard-broken' ? 0.85 : 1;
    spatter(motes, t.x, t.bulk * (e.spotH ?? 0.55), t.z, dx, dz,
      hexRgb3(t.ch.genome.palette.torso), force);
    return;
  }
  if (e.kind === 'kill') {
    const t = at(e.target?.id);
    if (t) undoing(motes, t.x, 0.1, t.z, hexRgb3(t.ch.genome.palette.accent), t.bulk);
  }
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

// --- the floor's memory: bones, dropped arms, living greenery ---------------

const BONE_INK: [number, number, number] = [206, 198, 178];

function relicCapsules(r: import('./relics').Relic): Capsule[] {
  const caps: Capsule[] = [];
  const fade = Math.max(0.25, 1 - r.sink * 0.8);
  const y = Math.max(0.012, 0.05 - r.sink * 0.05);
  const ink: [number, number, number] = [BONE_INK[0] * fade, BONE_INK[1] * fade, BONE_INK[2] * fade];
  const c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
  const at = (lx: number, ly: number, lz: number) =>
    v3(r.x + lx * c - lz * sn, Math.max(0.012, ly + y - 0.05), r.z + lx * sn + lz * c);

  if (r.kind === 'skull') {
    caps.push({ a: at(-0.02, 0.09, 0), b: at(0.04, 0.1, 0), r: 0.085, color: ink, part: 'relic' });
    caps.push({ a: at(0.1, 0.045, 0), b: at(0.16, 0.04, 0), r: 0.045, color: ink, part: 'relic' });   // snout
    caps.push({ a: at(0.02, 0.02, 0), b: at(0.12, 0.02, 0), r: 0.028,
      color: [ink[0] * 0.85, ink[1] * 0.85, ink[2] * 0.85], part: 'relic' });                          // jaw
  } else if (r.kind === 'bone') {
    caps.push({ a: at(-0.14, 0.03, 0), b: at(0.14, 0.03, 0), r: 0.024, color: ink, part: 'relic' });
    caps.push({ a: at(-0.15, 0.035, 0.02), b: at(-0.15, 0.035, -0.02), r: 0.034, color: ink, part: 'relic' });
    caps.push({ a: at(0.15, 0.035, 0.02), b: at(0.15, 0.035, -0.02), r: 0.034, color: ink, part: 'relic' });
  } else if (r.item) {
    // the weapon exactly as it was carried, laid flat where it fell
    for (const part of r.item.parts) {
      caps.push({
        a: at(part.a[0] - 0.3, 0.03 + part.a[1] * 0.25, part.a[2]),
        b: at(part.b[0] - 0.3, 0.03 + part.b[1] * 0.25, part.b[2]),
        r: part.r,
        color: (() => { const q = hexRgb3(part.color); return [q[0] * fade, q[1] * fade, q[2] * fade] as [number, number, number]; })(),
        part: 'relic',
      });
    }
  }
  return caps;
}

// a plant's base geometry is pure (kind, seed) — building it fresh every
// frame for every plant was a steady drip of allocation the phones felt
const floraBase = new Map<string, Capsule[]>();

function floraCapsules(f: import('./relics').Flora): Capsule[] {
  const grown = 0.3 + 0.7 * f.growth;
  const bend = f.hurt;                     // trampled plants lean and flatten
  const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
  const key = f.kind + ':' + f.seed;
  let base = floraBase.get(key);
  if (!base) {
    if (floraBase.size > 96) floraBase.clear();  // reseeds retire old keys
    base = makeProp(f.kind as PropKind, f.seed);
    floraBase.set(key, base);
  }
  return base.map(cp => {
    const bendAt = (p: { x: number; y: number; z: number }) => {
      // height shrinks with damage and the top shears sideways — a plant
      // pressed down, not a plant scaled down
      const y = p.y * grown * (1 - bend * 0.55);
      const shear = p.y * bend * 0.6;
      const lx = p.x * grown + shear, lz = p.z * grown;
      return v3(f.x + lx * c - lz * sn, Math.max(0.01, y), f.z + lx * sn + lz * c);
    };
    return { ...cp, a: bendAt(cp.a), b: bendAt(cp.b), r: cp.r * grown * (1 - bend * 0.3) };
  });
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
      whisper(why, 7);
      (buildSummon as any).finish?.();
    };
    live.onSworn = () => { /* pacts are silent by design */ };
    live.onFate = line => whisper(line, 12);
    // every connect, not just the first: a reconnected socket that never
    // re-identifies looks like an absent owner to the server
    live.onOpen = () => live.send({ t: 'key', key: myKey || undefined });
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
  const caps: Capsule[] = [];
  const propCaps: Capsule[] = [];
  const add = (list: Capsule[]): void => { for (let i = 0; i < list.length; i++) caps.push(list[i]); };
  let ticking = false;
  function tick(dt: number) {
    ticking = true;
    try { tickBody(dt); } finally { ticking = false; }
  }
  function tickBody(dt: number) {
    if (live) live.update(dt); else stepVoid(sim, dt);
    pushFeed(sim.events);
    for (const e of sim.events) {
      if (e.kind === 'kill') {
        director.punch(1);
        // remember who felled YOURS, for the fall line
        if (e.target && yours && e.target.id === yours.id && e.actor?.name) {
          myKiller = e.actor.name.split(' ')[0];
        }
      } else if (e.kind === 'hit') director.punch(0.45);
      sparks(sim, e);
      speak(sim, e);
    }
    // DRAIN LAST. Clearing before this loop meant every event was thrown away
    // unread in live mode: no voices, and no camera shake on a kill either.
    // The ambience kept working and hid it, because footfalls come from the
    // gait rather than from events. Second time this exact ordering has bitten.
    if (live) sim.events.length = 0;
    footfalls(sim);
    idleVoices(sim, dt);
    // MOTES GO BEFORE PIXELS. They are the most decorative thing the pit
    // draws and the cheapest to do without, so the governor spends them
    // first — a phone that has begun to struggle loses sparks long before
    // it loses sharpness, and loses them gradually rather than all at once.
    motes.budget = Math.max(0, Math.min(1, (perfScale - 0.5) / 0.5));
    // THE DRAW, BEFORE THE SHOT. A ranged creature announces its windup —
    // 'strike' fires when the swing begins and 'loose' when it lets go — so
    // a watching screen has the whole draw to fill the hand with light. It
    // is the one effect in the pit that is a promise rather than a report.
    for (const a of sim.agents) {
      if (a.deadT >= 0 || a.strikeT < 0) continue;
      const r = rangedOf(a);
      if (!r) continue;
      const spec = strikeSpecOf(a);
      const release = spec.duration * (spec.windup + spec.strike * 0.5);
      const charge = a.strikeT / Math.max(0.05, release);
      const hand = handAt.get(a.id);
      if (!hand || charge >= 1) continue;      // let go: the wake has it now
      gather(motes, hand.x, hand.y, hand.z, hexRgb3(r.color), 0.1 + r.size * 1.4, charge, dt);
    }
    shotEffects(sim, dt);
    motes.step(dt, sim.t);
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

    // the renderer decides cpu/gpu asynchronously after boot; when the mode
    // settles differently than the buffer was sized for, size it again
    if ((fitCanvas as any).mode !== view.mode) {
      (fitCanvas as any).mode = view.mode;
      fitCanvas();
    }
    findLord(sim);
    summonUI(sim, live);
    // ONE array, emptied and refilled. A fresh array every frame, filled with
    // `push(...list)` for every creature, relic, plant and shot, was hundreds
    // of throwaway objects and dozens of throwaway arrays per frame — sixty
    // times a second, on a phone, which pays for it in collections mid-fight.
    caps.length = 0;
    // ACTORS FIRST. The gpu draws at most MAX_CAPS capsules and silently drops
    // the rest of the array — and this array used to open with the title (up
    // to 496 capsules) and the scenery (337 since the rim), so for the whole
    // ten seconds of the title every creature, relic and plant was past the
    // cut, and the cut moved every frame as the letters arrived. THAT was the
    // load: the pit flickering in and out of existence behind its own name.
    // The cap is now far above anything the pit produces and the renderer
    // culls what is off-screen before it counts, but the order stays as a
    // budget rule — if it is ever hit again, the scenery goes, not the fight.
    for (const a of sim.agents) {
      add(agentCapsules(a, sim.t));
      add(sigilCapsules(a, sim.t));
      add(healthCapsules(a, a.by === ME));
    }
    for (const s of sim.shots) add(shotCapsules(s));
    // with the fight, not with the scenery: if the budget ever bites, the
    // rocks go before the sparks do
    motes.caps(caps, hexRgb(look.voidCol), sim.t);
    for (const r of sim.relics) add(relicCapsules(r));
    for (const f of sim.flora) add(floraCapsules(f));
    if (title && !title.done) add(title.caps(dt, cam.yaw));
    else if (title) {
      // the title has died. A first visitor gets the introduction NEXT, in
      // the same wire hand, standing where the title stood — the pit says
      // its three lines itself instead of borrowing the summon box.
      title = null;
      if (FIRST_VISIT && !saidIntro) {
        saidIntro = true;
        const frameW = (view.size.W * 4.4) / (0.46 * view.size.H);
        title = new WireTitle('one pit, all of us. pit lord survives.', frameW * 0.5, 1.4, 0.44);
      }
    }
    // the scenery never moves: it is flattened once and appended whole
    if (propCaps.length !== sim.props.reduce((n, p) => n + p.caps.length, 0)) {
      propCaps.length = 0;
      for (const pr of sim.props) for (const c of pr.caps) propCaps.push(c);
    }
    add(propCaps);
    // the sim, the camera and the live clock all keep running while the
    // renderer decides — only the drawing waits, so the first visible frame
    // is a world already in motion rather than one starting from cold
    if (rendererReady) view.render(caps, cam, 0);

  }

  // ?fps puts the numbers on the glass — the only way to learn what a phone
  // we do not own is actually doing, without asking its owner to describe it
  const fpsTag = new URLSearchParams(location.search).has('fps')
    ? (() => {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:8px;top:8px;z-index:9;font:10px ui-monospace,monospace;color:#8a9099;letter-spacing:.06em;pointer-events:none';
        document.getElementById('stage')!.appendChild(el);
        return el;
      })()
    : null;
  let tagAt = 0;

  // NOTHING IS SHOWN HALF-LOADED. The stage sits at opacity 0 while the fonts
  // land, the buffer finds its size and the first snapshot arrives — every
  // load-order flicker happens in the dark — then the whole scene fades up
  // once, complete. One dial instead of an ease per system. If the pit cannot
  // be reached, the stage still lifts after a few seconds so the 'far away'
  // state has somewhere to be seen.
  // Three things must be true, and the type is one of them: text reflowing
  // from a fallback face into Michroma is as much a flicker as anything else.
  let lit = false;
  let fontsIn = false;
  document.fonts.ready.then(() => { fontsIn = true; }, () => { fontsIn = true; });
  const bootAt = performance.now();
  // A FRAME THAT FAILS MUST NOT KILL THE PIT. One throw inside a tick used to
  // end the loop for good — no more frames, ever — and the whole page died on
  // whichever bad number reached it first. The frame is caught, reported once
  // where the lord line goes (with where it happened), and the next frame runs.
  let frameFault = false;
  function frame(now: number) {
    const raw = now - last;
    const dt = Math.min(0.05, raw / 1000);
    last = now;
    try { tick(dt); } catch (e) {
      if (!frameFault) {
        frameFault = true;
        console.error('[pit] a frame failed', e);
        // on the build tag, not the lord line: the loop rewrites that one
        // every frame, and a diagnosis that lasts one frame is no diagnosis
        const w = document.getElementById('buildTag');
        const where = String((e as Error)?.stack ?? '').split('\n')[1]?.trim() ?? '';
        if (w) w.textContent = `A FRAME FAILED — ${(e as Error)?.message ?? e} ${where} · ${w.textContent}`.slice(0, 240);
      }
    }
    if (!lit && rendererReady
      && (((live ? live.hasWorld : true) && fontsIn) || now - bootAt > 4000)) {
      lit = true;
      document.getElementById('stage')!.classList.add('lit');
      // AND THE DEVICE IS JUDGED ON WHAT IT DOES NEXT, not on the boot. A
      // shader compiling, the first creature hatching and the type settling
      // are one-off costs; letting them into the governor's window dropped
      // the resolution seconds after the pit appeared — a resize, in view.
      frameMs.length = 0;
      sinceGovern = 0;
      badWindows = 0;
    }
    govern(raw);
    if (fpsTag && now - tagAt > 500) {
      tagAt = now;
      fpsTag.textContent =
        `${medianMs ? Math.round(1000 / medianMs) : 0}fps  ${medianMs.toFixed(1)}ms  ${view.mode}  `
        + `${view.size.W}x${view.size.H}  x${perfScale.toFixed(2)}  ${view.drawn}/${caps.length}caps  ${motes.count}mote`;
    }
    requestAnimationFrame(frame);
  }
  // a resize can now redraw the world without waiting for the next rAF;
  // a refit from INSIDE a tick (the gpu→cpu fallback) skips it — that tick
  // is about to render anyway
  repaint = () => { if (!ticking) tick(0); };
  requestAnimationFrame(frame);

  // the browser pane suspends rAF while hidden, so tooling drives it by hand
  (window as any).voidScene = {
    sim, cam, look, director, live, pit, view, motes, get title() { return title; },
    get perf() { return { medianMs, fps: medianMs ? 1000 / medianMs : 0, scale: perfScale, mode: view.mode, buffer: view.size, caps: caps.length, drawn: view.drawn }; },
    govern,
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
      if (!Number.isFinite(v)) return;   // a bad value is not a value
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

  // Safari's own page-pinch fires proprietary gesture events that ignore
  // touch-action entirely; if they are not cancelled, iOS zooms the page and
  // the game's pinch never hears a thing. Likewise touchmove must be
  // non-passive or the document rubber-bands instead of orbiting.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, e => e.preventDefault());
  }
  stage.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
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
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // second finger down: the drag becomes a pinch, and the yaw drag must
      // let go or the camera lurches sideways while you zoom
      const [a, b] = [...touches.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      down = false;
    } else {
      down = true; lastX = e.clientX;
    }
    orbit.idle = 0;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    const held = touches.get(e.pointerId);
    if (held) { held.x = e.clientX; held.y = e.clientY; }
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) orbit.zoom = Math.max(-1.1, Math.min(1.1, orbit.zoom + (d - pinchDist) * 0.005));
      pinchDist = d;
      orbit.idle = 0;
      return;
    }
    if (!down) return;
    orbit.yaw = Math.max(-Math.PI, Math.min(Math.PI, orbit.yaw + (e.clientX - lastX) * 0.006));
    lastX = e.clientX;
    orbit.idle = 0;
  });
  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    pinchDist = 0;
    down = false;
    orbit.idle = 0;
  };
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
