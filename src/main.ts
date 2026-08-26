// The FORGE: one character on screen, moving, changeable while it moves.
// Everything the character is — body, palette, behaviours, weapon, blast —
// is data on the right; the canvas never stops.

import {
  defaultBiped, effectiveGait, migrateGenome, Mood,
  PRESETS, Skeleton, SkeletonScales, scaleSkeleton, Gait, Genome,
} from './genome';
import {
  Character, Behavior, StillSpec, StrikeSpec, makeCharacter, migrateCharacter,
} from './character';
import { solvePose, walkSpeed, Intent, slashWeight, Capsule, PoseExtras } from './pose';
import { hatchGenome } from './hatch';
import { forgeWeapon, armoury } from './smith';
import { Camera } from './render';
import { PixelView } from './view';
import { group, slider, button, toggle, select, color } from './ui';
import { v3 } from './vec';

// --- state ----------------------------------------------------------------

let character: Character = makeCharacter(defaultBiped(), 'hero');
let genome = character.genome;
let baseSkeleton: Skeleton = structuredClone(genome.skeleton);
const scales: SkeletonScales = { legs: 1, arms: 1, head: 1, bulk: 1, width: 1 };
const mood: Mood = { tired: 0, angry: 0 };
const cam: Camera = { yaw: 0.5, pitch: 0.22, ppm: 72, cy: 0.95 };

// Resolution must change PIXEL DENSITY, not framing. ppm is buffer-pixels
// per metre, so leaving it fixed while the buffer grows just fits more world
// in — the figure keeps the same pixel count and only looks further away.
// Deriving ppm from the buffer size keeps the framing put, so the slider does
// the one thing its name promises: bigger pixels or smaller ones.
const REF_RES = 176;   // the resolution `zoom` is quoted against
let bufRes = REF_RES;  // current buffer edge, px
let zoomPpm = 72;      // zoom in px/metre AT the reference resolution
function applyCamScale() {
  cam.ppm = zoomPpm * (bufRes / REF_RES);
}
applyCamScale();
let activeBehavior = 'walk';
let showBlast = false;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const view = new PixelView(canvas, 176, 176);
view.init();

// --- panel plumbing --------------------------------------------------------

const panel = document.getElementById('panel')!;
const genomeBox = document.getElementById('genome') as HTMLTextAreaElement;
const byteCount = document.getElementById('bytes')!;
const speedOut = document.getElementById('speed')!;
const fpsOut = document.getElementById('fps')!;
const nameInput = document.getElementById('charname') as HTMLInputElement;
const kindSelect = document.getElementById('charkind') as HTMLSelectElement;

function refreshFile() {
  const round = (_k: string, v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  const s = JSON.stringify(character, round, 1);
  genomeBox.value = s;
  byteCount.textContent = `${new Blob([s]).size} bytes`;
  try { sessionStorage.setItem('rig-character', JSON.stringify(character)); } catch { /* full */ }
}

const gaitSetters: [keyof Gait, (v: number) => void][] = [];
const scaleSetters: [keyof SkeletonScales, (v: number) => void][] = [];
const paletteSetters: [keyof Genome['palette'], (v: string) => void][] = [];
const stillSetters: [keyof StillSpec, (v: number) => void][] = [];
const strikeSetters: [Exclude<keyof StrikeSpec, 'posts'>, (v: number) => void][] = [];
let blastSetters: { core: (v: string) => void; edge: (v: string) => void } | null = null;
let blastDelaySet: (v: number) => void = () => {};
let blastRadiusSet: (v: number) => void = () => {};

function currentBehavior(): Behavior {
  return character.behaviors[activeBehavior] ?? character.behaviors.walk;
}

function refreshEditors() {
  const b = currentBehavior();
  gGait.style.display = b.type === 'gait' ? '' : 'none';
  gStill.style.display = b.type === 'still' ? '' : 'none';
  gStrike.style.display = b.type === 'strike' ? '' : 'none';
  if (b.type === 'gait') {
    genome.gait = b.gait; // solver + sliders read this reference
    for (const [k, set] of gaitSetters) set(b.gait[k]);
  }
  if (b.type === 'still') for (const [k, set] of stillSetters) set(b.still[k]);
  if (b.type === 'strike') for (const [k, set] of strikeSetters) set(b.strike[k] as number);
}

function adoptCharacter(c: Character) {
  character = c;
  genome = c.genome;
  baseSkeleton = structuredClone(genome.skeleton);
  for (const [k, set] of scaleSetters) { scales[k] = 1; set(1); }
  for (const [k, set] of paletteSetters) set(genome.palette[k]);
  nameInput.value = c.name;
  kindSelect.value = c.kind;
  blastSetters?.core(c.blast.core);
  blastSetters?.edge(c.blast.edge);
  blastDelaySet(c.blast.delay);
  blastRadiusSet(c.blast.radius);
  if (!c.behaviors[activeBehavior]) activeBehavior = 'walk';
  renderChips();
  refreshEditors();
  refreshFile();
}

// --- behaviour chips --------------------------------------------------------

const chipsEl = document.getElementById('behaviors')!;
function renderChips() {
  chipsEl.innerHTML = '';
  for (const name of Object.keys(character.behaviors)) {
    const b = document.createElement('button');
    b.className = 'chip' + (name === activeBehavior ? ' active' : '');
    b.textContent = name;
    b.addEventListener('click', () => {
      activeBehavior = name;
      strikeClock = 0;
      renderChips();
      refreshEditors();
    });
    chipsEl.appendChild(b);
  }
}

// --- identity / save --------------------------------------------------------

nameInput.addEventListener('input', () => { character.name = nameInput.value; refreshFile(); });
kindSelect.addEventListener('input', () => {
  character.kind = kindSelect.value as Character['kind'];
  refreshFile();
});
const saveBtn = document.getElementById('savebtn')!;
const saveStatus = document.getElementById('savestatus')!;
saveBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/characters', { method: 'POST', body: JSON.stringify(character) });
    const j = (await res.json()) as { ok: boolean; file?: string };
    saveStatus.className = 'status ' + (j.ok ? 'ok' : 'err');
    saveStatus.textContent = j.ok ? `✓ ${j.file}` : '✗ save failed';
  } catch {
    saveStatus.className = 'status err';
    saveStatus.textContent = '✗ save failed';
  }
  setTimeout(() => { saveStatus.textContent = ''; }, 2500);
});

// --- blast controls ---------------------------------------------------------

// each pattern changes exactly one rule of the verb — this is the game
const PATTERN_RULES: Record<string, string> = {
  flame: 'the baseline: damage cross, destroys one block per arm',
  rune: 'damage cross — but enemies can scuff it out by standing still on it',
  vine: 'builds temporary wall instead of destroying; crushes what it grows through',
  oil: 'inert puddles, harmless until ANY flame touches them — then the slick goes up',
  curse: 'damage cross, near-invisible to everyone else until it fires',
  bell: 'non-lethal: shoves everything two tiles along the corridor, one tile wider',
  imp: 'the bomb walks three tiles in your facing direction, then bursts',
};

const gBlast = document.getElementById('gBlast')!;
{
  const core = color(gBlast, 'core', character.blast.core, v => { character.blast.core = v; refreshFile(); });
  const edge = color(gBlast, 'edge', character.blast.edge, v => { character.blast.edge = v; refreshFile(); });
  blastSetters = { core, edge };
  select(gBlast, 'pattern', ['flame', 'rune', 'vine', 'oil', 'curse', 'bell', 'imp'],
    character.blast.pattern, v => {
      character.blast.pattern = v as Character['blast']['pattern'];
      patternNote.textContent = PATTERN_RULES[character.blast.pattern];
      refreshFile();
    });
  const patternNote = document.createElement('div');
  patternNote.className = 'status';
  patternNote.textContent = PATTERN_RULES[character.blast.pattern];
  gBlast.appendChild(patternNote);
  // the two gameplay numbers the CLASH grammar allows an attack to have
  blastDelaySet = slider(gBlast, 'delay (s)', 1, 4, 0.1, character.blast.delay, v => {
    character.blast.delay = v;
    refreshFile();
  });
  blastRadiusSet = slider(gBlast, 'radius', 1, 5, 1, character.blast.radius, v => {
    character.blast.radius = v;
    refreshFile();
  });
  toggle(gBlast, 'preview blast', showBlast, v => { showBlast = v; });
}

// --- creature / palette groups ----------------------------------------------

const gCreature = group(panel, 'body');
select(gCreature, 'preset', Object.keys(PRESETS), 'scout', name =>
  adoptCharacter(makeCharacter(PRESETS[name](), name === 'scout' ? 'hero' : 'beast')));
button(gCreature, 'mutate', () => {
  const jitter = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v + (Math.random() * 2 - 1) * 0.12 * (hi - lo)));
  const b = currentBehavior();
  if (b.type === 'gait') {
    for (const [key, mn, mx] of gaitSliders) b.gait[key] = jitter(b.gait[key], mn, mx);
    for (const [k, set] of gaitSetters) set(b.gait[k]);
  }
  for (const [k, set] of scaleSetters) {
    scales[k] = jitter(scales[k], 0.7, 1.4);
    set(scales[k]);
  }
  genome.skeleton = scaleSkeleton(baseSkeleton, scales);
  refreshFile();
});
for (const key of ['legs', 'arms', 'head', 'bulk', 'width'] as (keyof SkeletonScales)[]) {
  const set = slider(gCreature, `scale ${key}`, 0.5, 1.8, 0.01, 1, v => {
    scales[key] = v;
    genome.skeleton = scaleSkeleton(baseSkeleton, scales);
    refreshFile();
  });
  scaleSetters.push([key, set]);
}

const gPalette = group(panel, 'palette');
for (const key of ['torso', 'limbs', 'head', 'accent'] as (keyof Genome['palette'])[]) {
  const set = color(gPalette, key, genome.palette[key], v => {
    genome.palette[key] = v;
    refreshFile();
  });
  paletteSetters.push([key, set]);
}

// --- behaviour editors --------------------------------------------------------

const gGait = group(panel, 'gait drivers — edits the selected behaviour');
const gaitSliders: [keyof Gait, number, number, number][] = [
  ['cadence', 0.2, 2.6, 0.01],
  ['stride', 0.2, 2.4, 0.01],
  ['stance', 0.5, 0.75, 0.01],
  ['lift', 0, 0.3, 0.005],
  ['bounce', 0, 0.08, 0.001],
  ['sway', 0, 0.09, 0.001],
  ['lean', -0.2, 0.5, 0.01],
  ['slump', 0, 0.8, 0.01],
  ['crouch', 0, 0.25, 0.005],
  ['pelvisTwist', 0, 0.3, 0.005],
  ['shoulderTwist', 0, 0.4, 0.005],
  ['armSwing', 0, 1.0, 0.01],
  ['elbowBase', 0, 1.2, 0.01],
  ['elbowAmp', 0, 1.2, 0.01],
  ['elbowLag', 0, 0.4, 0.005],
  ['headPitch', -0.4, 0.8, 0.01],
  ['flapAmp', 0, 1.3, 0.01],
  ['tailWave', 0, 1.2, 0.01],
];
for (const [key, mn, mx, st] of gaitSliders) {
  const set = slider(gGait, key, mn, mx, st, genome.gait[key], v => {
    const b = currentBehavior();
    if (b.type === 'gait') b.gait[key] = v;
    refreshFile();
  });
  gaitSetters.push([key, set]);
}

const gStill = group(panel, 'stillness — edits the selected behaviour');
const stillSliders: [keyof StillSpec, number, number, number][] = [
  ['collapse', 0, 1, 0.01],
  ['tired', 0, 1, 0.01],
  ['angry', 0, 1, 0.01],
  ['breatheAmp', 0, 4, 0.05],
  ['breatheRate', 0.05, 1, 0.01],
];
for (const [key, mn, mx, st] of stillSliders) {
  const set = slider(gStill, key, mn, mx, st, 0, v => {
    const b = currentBehavior();
    if (b.type === 'still') b.still[key] = v;
    refreshFile();
  });
  stillSetters.push([key, set]);
}

const gStrike = group(panel, 'strike — edits the selected behaviour');
const strikeSliders: [Exclude<keyof StrikeSpec, 'posts'>, number, number, number][] = [
  ['duration', 0.15, 1.6, 0.01],
  ['windup', 0.1, 0.7, 0.01],
  ['strike', 0.08, 0.5, 0.01],
  ['reachMin', 0.4, 1, 0.01],
  ['reachMax', 0.5, 1, 0.01],
  ['twist', 0, 1.2, 0.01],
];
for (const [key, mn, mx, st] of strikeSliders) {
  const set = slider(gStrike, key, mn, mx, st, 0.5, v => {
    const b = currentBehavior();
    if (b.type === 'strike') b.strike[key] = v;
    refreshFile();
  });
  strikeSetters.push([key, set]);
}

// --- mood / camera / render ---------------------------------------------------

const gMood = group(panel, 'mood — adverbs on top of the behaviour');
slider(gMood, 'tired', 0, 1, 0.01, mood.tired, v => { mood.tired = v; });
slider(gMood, 'angry', 0, 1, 0.01, mood.angry, v => { mood.angry = v; });

const gCam = group(panel, 'camera — drag the canvas to orbit');
const camYawSet = slider(gCam, 'yaw', -Math.PI, Math.PI, 0.001, cam.yaw, v => { cam.yaw = v; });
const camPitchSet = slider(gCam, 'pitch', -0.1, 0.9, 0.001, cam.pitch, v => { cam.pitch = v; });
const camZoomSet = slider(gCam, 'zoom', 24, 140, 1, zoomPpm, v => { zoomPpm = v; applyCamScale(); });

const gRender = group(panel, 'render');
slider(gRender, 'resolution', 96, 400, 16, REF_RES, v => {
  bufRes = v;
  view.setSize(v, v);
  applyCamScale();
});
toggle(gRender, 'CLASH flat look', false, v => { cam.flat = v; });

// soft field: 0 keeps the hard nearest-capsule look; above that the parts
// fuse at the joints and their inks cross-fade into each other
slider(gRender, 'blend', 0, 8, 0.1, 0, v => { cam.blend = v; });
slider(gRender, 'blend depth', 0.05, 1.5, 0.05, 0.35, v => { cam.blendDepth = v; });
slider(gRender, 'colour mix', 0, 1, 0.02, 1, v => { cam.blendMix = v; });
slider(gRender, 'shape fuse', 0, 1, 0.02, 1, v => { cam.blendShape = v; });

// --- hatch --------------------------------------------------------------------

const hatchBtn = document.getElementById('hatchbtn') as HTMLButtonElement;
const rerollBtn = document.getElementById('rerollbtn') as HTMLButtonElement;
const hatchDesc = document.getElementById('hatchdesc') as HTMLInputElement;
const hatchStatus = document.getElementById('hatchstatus')!;
let lastHatchDesc = '';
async function doHatch(desc: string, temperature: number) {
  if (!desc) return;
  hatchBtn.disabled = true;
  rerollBtn.disabled = true;
  hatchStatus.className = 'status';
  hatchStatus.textContent = 'hatching…';
  try {
    const g = await hatchGenome(desc, undefined, undefined, chars => {
      hatchStatus.textContent = `hatching… ${chars} chars of genome`;
    }, temperature);
    adoptCharacter(makeCharacter(g, 'beast'));
    lastHatchDesc = desc;
    rerollBtn.hidden = false;
    hatchStatus.className = 'status ok';
    hatchStatus.textContent = `✓ ${g.name} — save it to keep it`;
  } catch (e) {
    hatchStatus.className = 'status err';
    const msg = e instanceof Error ? e.message : String(e);
    hatchStatus.textContent = msg.includes('fetch')
      ? '✗ cannot reach ollama — run `ollama serve` and retry'
      : '✗ ' + msg.slice(0, 90) + ' — try reroll';
    if (lastHatchDesc || hatchDesc.value.trim()) rerollBtn.hidden = false;
  }
  hatchBtn.disabled = false;
  rerollBtn.disabled = false;
}
hatchBtn.addEventListener('click', () => doHatch(hatchDesc.value.trim(), 0.7));
rerollBtn.addEventListener('click', () => doHatch(hatchDesc.value.trim() || lastHatchDesc, 0.9));
hatchDesc.addEventListener('keydown', e => { if (e.key === 'Enter') doHatch(hatchDesc.value.trim(), 0.7); });

// --- weaponsmith --------------------------------------------------------------

const forgeBtn = document.getElementById('forgebtn') as HTMLButtonElement;
const unarmBtn = document.getElementById('unarmbtn') as HTMLButtonElement;
const weaponDesc = document.getElementById('weapondesc') as HTMLInputElement;
const weaponStatus = document.getElementById('weaponstatus')!;
async function doForge() {
  const desc = weaponDesc.value.trim();
  if (!desc) return;
  forgeBtn.disabled = true;
  weaponStatus.className = 'status';
  weaponStatus.textContent = 'forging…';
  try {
    character.weapon = await forgeWeapon(desc, chars => {
      weaponStatus.textContent = `forging… ${chars}`;
    });
    weaponStatus.className = 'status ok';
    weaponStatus.textContent = `✓ ${character.weapon.name} (${character.weapon.parts.length} parts)`;
  } catch {
    character.weapon = armoury(desc);
    weaponStatus.className = 'status ok';
    weaponStatus.textContent = `✓ ${character.weapon.name} — from the armoury (ollama unreachable)`;
  }
  refreshFile();
  forgeBtn.disabled = false;
}
forgeBtn.addEventListener('click', doForge);
weaponDesc.addEventListener('keydown', e => { if (e.key === 'Enter') doForge(); });
unarmBtn.addEventListener('click', () => {
  character.weapon = undefined;
  weaponStatus.className = 'status';
  weaponStatus.textContent = 'unarmed';
  refreshFile();
});

// --- character file apply / copy ---------------------------------------------

document.getElementById('copy')!.addEventListener('click', () => {
  navigator.clipboard.writeText(genomeBox.value);
});
const applyBtn = document.getElementById('apply')!;
applyBtn.addEventListener('click', () => {
  try {
    adoptCharacter(migrateCharacter(JSON.parse(genomeBox.value)));
    applyBtn.textContent = 'apply ✓';
  } catch {
    applyBtn.textContent = 'apply ✗';
  }
  setTimeout(() => { applyBtn.textContent = 'apply'; }, 1200);
});

// --- camera orbit -------------------------------------------------------------

let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  cam.yaw += (e.clientX - lastX) * 0.008;
  cam.pitch = Math.min(0.9, Math.max(-0.1, cam.pitch + (e.clientY - lastY) * 0.004));
  lastX = e.clientX; lastY = e.clientY;
  camYawSet(cam.yaw); camPitchSet(cam.pitch);
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomPpm = Math.min(140, Math.max(24, zoomPpm * (e.deltaY < 0 ? 1.06 : 0.94)));
  applyCamScale();
  camZoomSet(zoomPpm);
}, { passive: false });

// Arrow keys orient the figure precisely: held for smooth continuous turning,
// tapped for a single fine step, shift for eighth-of-that. Two arrows at once
// pan diagonally, and [ ] snap to the eight compass views.
const orbitHeld = new Set<string>();
const ORBIT_RATE = 1.4;   // radians per second held
const ORBIT_STEP = 0.045; // radians per tap
addEventListener('keydown', e => {
  const k = e.key;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '[', ']'].includes(k)) return;
  if (document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement) return;
  e.preventDefault();
  if (k === '[' || k === ']') {
    const eighth = Math.PI / 4;
    const dir = k === ']' ? 1 : -1;
    cam.yaw = Math.round(cam.yaw / eighth + dir) * eighth;
    camYawSet(cam.yaw);
    return;
  }
  if (!orbitHeld.has(k)) {
    // the tap: one precise nudge before the hold takes over
    const fine = e.shiftKey ? 0.125 : 1;
    if (k === 'ArrowLeft') cam.yaw -= ORBIT_STEP * fine;
    if (k === 'ArrowRight') cam.yaw += ORBIT_STEP * fine;
    if (k === 'ArrowUp') cam.pitch = Math.min(0.9, cam.pitch + ORBIT_STEP * fine);
    if (k === 'ArrowDown') cam.pitch = Math.max(-0.1, cam.pitch - ORBIT_STEP * fine);
    camYawSet(cam.yaw);
    camPitchSet(cam.pitch);
  }
  orbitHeld.add(k);
});
addEventListener('keyup', e => orbitHeld.delete(e.key));
addEventListener('blur', () => orbitHeld.clear());

function orbitTick(dt: number) {
  if (orbitHeld.size === 0) return;
  const rate = ORBIT_RATE * dt * (orbitHeld.has('Shift') ? 0.125 : 1);
  if (orbitHeld.has('ArrowLeft')) cam.yaw -= rate;
  if (orbitHeld.has('ArrowRight')) cam.yaw += rate;
  if (orbitHeld.has('ArrowUp')) cam.pitch = Math.min(0.9, cam.pitch + rate * 0.6);
  if (orbitHeld.has('ArrowDown')) cam.pitch = Math.max(-0.1, cam.pitch - rate * 0.6);
  while (cam.yaw > Math.PI) cam.yaw -= Math.PI * 2;
  while (cam.yaw < -Math.PI) cam.yaw += Math.PI * 2;
  camYawSet(cam.yaw);
  camPitchSet(cam.pitch);
}

// --- startup: restore or ?load= -----------------------------------------------

async function startup() {
  const wanted = new URLSearchParams(location.search).get('load');
  if (wanted) {
    try {
      const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '');
      for (const api of ['/api/characters', '/api/genome']) {
        const list = (await (await fetch(api)).json()) as any[];
        const hit = list.find(c => slug(String(c.name ?? '')) === wanted);
        if (hit) { adoptCharacter(migrateCharacter(hit)); return; }
      }
    } catch { /* fall through */ }
  }
  try {
    const saved = sessionStorage.getItem('rig-character');
    if (saved) { adoptCharacter(migrateCharacter(JSON.parse(saved))); return; }
  } catch { /* corrupt */ }
  adoptCharacter(character);
}

// --- blast preview ------------------------------------------------------------

function hexc(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blastCapsules(t: number): Capsule[] {
  const caps: Capsule[] = [];
  const b = character.blast;
  const core = hexc(b.core), edge = hexc(b.edge);
  const T = 0.62;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]) {
    for (let k = dx === 0 && dz === 0 ? 0 : 1; k <= (dx === 0 && dz === 0 ? 0 : 2); k++) {
      const x = dx * k * T, z = dz * k * T;
      const col = k <= 1 ? core : edge;
      if (b.pattern === 'flame') {
        const r = 0.16 + 0.05 * Math.sin(t * 7 + k * 1.7);
        caps.push({ a: v3(x, 0.14 + 0.05 * Math.sin(t * 5 + k), z), b: v3(x, 0.3 + r, z), r, color: col, part: 'blast' });
      } else if (b.pattern === 'rune') {
        const r = 0.2 + 0.03 * ((Math.floor(t * 6) + k) % 2);
        caps.push({ a: v3(x, 0.03, z), b: v3(x, 0.05, z), r, color: col, part: 'blast' });
      } else {
        const h = 0.32 + 0.1 * Math.sin(t * 3 + k * 2.1);
        caps.push({ a: v3(x + 0.05 * Math.sin(t * 2 + k), 0.02, z), b: v3(x, h, z), r: 0.06, color: col, part: 'blast' });
      }
    }
  }
  return caps;
}

// --- the loop: it never stops ---------------------------------------------------

let phase = 0;
let scroll = 0;
let idleT = 0;
let strikeClock = 0;
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsT = 0;

function tick(dt: number) {
  orbitTick(dt);
  const b = currentBehavior();
  const extras: PoseExtras = { weapon: character.weapon };
  let caps: Capsule[];
  let speed = 0;

  if (b.type === 'gait') {
    genome.gait = b.gait;
    const eff = effectiveGait(b.gait, mood);
    speed = eff.stride * eff.cadence;
    phase = (phase + eff.cadence * dt) % 1;
    scroll += speed * dt;
    caps = solvePose(genome, mood, phase, 1, 0, undefined, 0, extras);
  } else if (b.type === 'still') {
    idleT += dt;
    extras.breatheAmp = b.still.breatheAmp;
    extras.breatheRate = b.still.breatheRate;
    const m: Mood = {
      tired: Math.min(1, b.still.tired + mood.tired),
      angry: Math.min(1, b.still.angry + mood.angry),
    };
    caps = solvePose(genome, m, 0, 0, idleT, undefined, b.still.collapse, extras);
  } else {
    strikeClock += dt;
    const cycle = b.strike.duration + 0.5;
    const t = Math.min(1, (strikeClock % cycle) / b.strike.duration);
    const intent: Intent = { slash: { t, weight: slashWeight(t), spec: b.strike } };
    caps = solvePose(genome, mood, 0.12, 0, idleT += dt, intent, 0, extras);
  }

  if (showBlast) caps.push(...blastCapsules(performance.now() / 1000));
  view.render(caps, cam, scroll);

  speedOut.textContent = b.type === 'gait' ? `${speed.toFixed(2)} m/s` : activeBehavior;
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    fpsOut.textContent = `${(fpsN / fpsAcc).toFixed(0)} fps · ${view.mode}`;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}

startup().then(() => requestAnimationFrame(frame));

// manual stepping for outside tooling (the pane suspends rAF when hidden)
(window as any).rig = {
  step: (dt: number) => tick(dt),
  behavior: (name: string) => {
    activeBehavior = name;
    strikeClock = 0;
    renderChips();
    refreshEditors();
  },
  character: () => character,
  cam: () => cam,
};
