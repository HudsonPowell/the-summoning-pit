import {
  defaultBiped, effectiveGait, migrateGenome, Mood, serializeGenome, Weapon,
  PRESETS, Skeleton, SkeletonScales, scaleSkeleton, Gait,
} from './genome';
import { solvePose, walkSpeed, Intent, slashWeight } from './pose';
import { hatchGenome } from './hatch';
import { Camera } from './render';
import { PixelView } from './view';
import { group, slider, button, toggle, select, color } from './ui';

let genome = defaultBiped();
let baseSkeleton: Skeleton = structuredClone(genome.skeleton);
const scales: SkeletonScales = { legs: 1, arms: 1, head: 1, bulk: 1, width: 1 };
const mood: Mood = { tired: 0, angry: 0 };
const cam: Camera = { yaw: 0.5, pitch: 0.22, ppm: 72, cy: 0.95 };

const canvas = document.getElementById('view') as HTMLCanvasElement;
const view = new PixelView(canvas, 176, 176);
view.init();

// --- controls -----------------------------------------------------------
const panel = document.getElementById('panel')!;
const genomeBox = document.getElementById('genome') as HTMLTextAreaElement;
const byteCount = document.getElementById('bytes')!;
const speedOut = document.getElementById('speed')!;
const fpsOut = document.getElementById('fps')!;

function refreshGenomeView() {
  const s = serializeGenome(genome, mood);
  genomeBox.value = s;
  byteCount.textContent = `${new Blob([s]).size} bytes`;
}

const slash = { active: false, t: 0, auto: false };
const SLASH_DURATION = 0.55;
let savedWeapon: Weapon | undefined = genome.weapon;

const gaitSetters: [keyof Gait, (v: number) => void][] = [];
const scaleSetters: [keyof SkeletonScales, (v: number) => void][] = [];

const paletteSetters: [keyof typeof genome.palette, (v: string) => void][] = [];

function adoptGenome(g: typeof genome) {
  genome = g;
  baseSkeleton = structuredClone(genome.skeleton);
  savedWeapon = genome.weapon;
  for (const [k, set] of scaleSetters) { scales[k] = 1; set(1); }
  for (const [k, set] of gaitSetters) set(genome.gait[k]);
  for (const [k, set] of paletteSetters) set(genome.palette[k]);
  refreshGenomeView();
}

const gCreature = group(panel, 'creature');
select(gCreature, 'preset', Object.keys(PRESETS), 'scout', name => adoptGenome(PRESETS[name]()));
button(gCreature, 'mutate', () => {
  const jitter = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v + (Math.random() * 2 - 1) * 0.12 * (hi - lo)));
  for (const [key, mn, mx] of gaitSliders) genome.gait[key] = jitter(genome.gait[key], mn, mx);
  for (const [k, set] of gaitSetters) set(genome.gait[k]);
  for (const [k, set] of scaleSetters) {
    scales[k] = jitter(scales[k], 0.7, 1.4);
    set(scales[k]);
  }
  genome.skeleton = scaleSkeleton(baseSkeleton, scales);
  refreshGenomeView();
});
for (const key of ['legs', 'arms', 'head', 'bulk', 'width'] as (keyof SkeletonScales)[]) {
  const set = slider(gCreature, `scale ${key}`, 0.5, 1.8, 0.01, 1, v => {
    scales[key] = v;
    genome.skeleton = scaleSkeleton(baseSkeleton, scales);
    refreshGenomeView();
  });
  scaleSetters.push([key, set]);
}

const gPalette = group(panel, 'palette');
for (const key of ['torso', 'limbs', 'head', 'accent'] as (keyof typeof genome.palette)[]) {
  const set = color(gPalette, key, genome.palette[key], v => {
    genome.palette[key] = v;
    refreshGenomeView();
  });
  paletteSetters.push([key, set]);
}

const gIntent = group(panel, 'intent — punctuation moves');
button(gIntent, 'slash', () => { slash.active = true; slash.t = 0; });
toggle(gIntent, 'auto-repeat', slash.auto, v => { slash.auto = v; if (v) slash.active = true; });
toggle(gIntent, 'weapon', !!genome.weapon, v => {
  if (v) genome.weapon = savedWeapon ?? { length: 0.62, r: 0.032, color: '#cfd6e4' };
  else { savedWeapon = genome.weapon; delete genome.weapon; }
  refreshGenomeView();
});

const gMood = group(panel, 'mood — adverbs, not animations');
slider(gMood, 'tired', 0, 1, 0.01, mood.tired, v => { mood.tired = v; refreshGenomeView(); });
slider(gMood, 'angry', 0, 1, 0.01, mood.angry, v => { mood.angry = v; refreshGenomeView(); });

const gGait = group(panel, 'gait drivers');
const gaitSliders: [keyof Gait, number, number, number][] = [
  ['cadence', 0.2, 2.2, 0.01],
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
    genome.gait[key] = v;
    refreshGenomeView();
  });
  gaitSetters.push([key, set]);
}

const gCam = group(panel, 'camera — drag the canvas to orbit');
const camYawSet = slider(gCam, 'yaw', -Math.PI, Math.PI, 0.01, cam.yaw, v => { cam.yaw = v; });
const camPitchSet = slider(gCam, 'pitch', -0.1, 0.9, 0.01, cam.pitch, v => { cam.pitch = v; });
const camZoomSet = slider(gCam, 'zoom', 24, 140, 1, cam.ppm, v => { cam.ppm = v; });

const gRender = group(panel, 'render');
slider(gRender, 'resolution', 96, 400, 16, 176, v => { view.setSize(v, v); });

document.getElementById('copy')!.addEventListener('click', () => {
  navigator.clipboard.writeText(genomeBox.value);
});

// the genome box is a door, not a window: paste any genome and apply it
const applyBtn = document.getElementById('apply')!;
applyBtn.addEventListener('click', () => {
  try {
    const parsed = migrateGenome(JSON.parse(genomeBox.value));
    delete (parsed as { mood?: unknown }).mood;
    adoptGenome(parsed);
    applyBtn.textContent = 'apply ✓';
  } catch (e) {
    applyBtn.textContent = 'apply ✗';
  }
  setTimeout(() => { applyBtn.textContent = 'apply'; }, 1200);
});

// drag the canvas to orbit, wheel to zoom — the camera is a held object
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
  cam.ppm = Math.min(140, Math.max(24, cam.ppm * (e.deltaY < 0 ? 1.06 : 0.94)));
  camZoomSet(cam.ppm);
}, { passive: false });

// --- hatch: describe a creature, get a creature ---------------------------
const hatchBtn = document.getElementById('hatchbtn') as HTMLButtonElement;
const rerollBtn = document.getElementById('rerollbtn') as HTMLButtonElement;
const hatchDesc = document.getElementById('hatchdesc') as HTMLInputElement;
const hatchStatus = document.getElementById('hatchstatus')!;
let lastHatchDesc = '';
async function doHatch(desc: string, temperature: number) {
  if (!desc) return;
  hatchBtn.disabled = true;
  rerollBtn.disabled = true;
  hatchStatus.className = '';
  hatchStatus.textContent = 'hatching…';
  try {
    const g = await hatchGenome(desc, undefined, undefined, chars => {
      hatchStatus.textContent = `hatching… ${chars} chars of genome`;
    }, temperature);
    adoptGenome(g);
    lastHatchDesc = desc;
    rerollBtn.hidden = false;
    const save = await fetch('/api/genome', { method: 'POST', body: JSON.stringify(g) });
    const info = (await save.json()) as { ok: boolean; file?: string };
    hatchStatus.className = 'ok';
    hatchStatus.textContent = info.ok
      ? `✓ ${g.name} — saved to the arena pool (reroll replaces it)`
      : `✓ ${g.name} — live here (pool save failed)`;
  } catch (e) {
    hatchStatus.className = 'err';
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
// same words, new dice — a touch hotter for variety
rerollBtn.addEventListener('click', () =>
  doHatch(hatchDesc.value.trim() || lastHatchDesc, 0.9));
hatchDesc.addEventListener('keydown', e => { if (e.key === 'Enter') doHatch(hatchDesc.value.trim(), 0.7); });

refreshGenomeView();

// --- the loop: it never stops -------------------------------------------
let phase = 0;
let scroll = 0;
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsT = 0;

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}

function tick(dt: number) {
  const speed = walkSpeed(genome, mood);
  phase = (phase + effectiveGait(genome.gait, mood).cadence * dt) % 1;
  scroll += speed * dt;

  if (slash.active) {
    slash.t += dt / SLASH_DURATION;
    if (slash.t >= 1) {
      slash.t = 0;
      slash.active = slash.auto;
    }
  }
  const intent: Intent | undefined = slash.active
    ? { slash: { t: slash.t, weight: slashWeight(slash.t) } }
    : undefined;

  const caps = solvePose(genome, mood, phase, 1, 0, intent);
  view.render(caps, cam, scroll);

  speedOut.textContent = `${speed.toFixed(2)} m/s`;
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    fpsOut.textContent = `${(fpsN / fpsAcc).toFixed(0)} fps · ${view.mode}`;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}

requestAnimationFrame(frame);

// manual sim stepping for outside tooling (the pane suspends rAF when hidden)
(window as any).rig = {
  step: (dt: number) => tick(dt),
  slash: () => { slash.active = true; slash.t = 0; },
};
