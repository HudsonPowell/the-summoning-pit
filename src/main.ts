import {
  defaultBiped, effectiveGait, Mood, serializeGenome, Weapon,
  PRESETS, Skeleton, SkeletonScales, scaleSkeleton, Gait,
} from './genome';
import { solvePose, walkSpeed, Intent, slashWeight } from './pose';
import { PixelRenderer, Camera } from './render';
import { group, slider, button, toggle, select } from './ui';

const LOW = 176; // low-res buffer size; the pixel look is born here

let genome = defaultBiped();
let baseSkeleton: Skeleton = structuredClone(genome.skeleton);
const scales: SkeletonScales = { legs: 1, arms: 1, head: 1, bulk: 1, width: 1 };
const mood: Mood = { tired: 0, angry: 0 };
const cam: Camera = { yaw: 0.5, pitch: 0.22, ppm: 72, cy: 0.95 };

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const low = document.createElement('canvas');
low.width = LOW;
low.height = LOW;
const lowCtx = low.getContext('2d')!;
const img = lowCtx.createImageData(LOW, LOW);
const renderer = new PixelRenderer(LOW, LOW);

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

const gCreature = group(panel, 'creature');
select(gCreature, 'preset', Object.keys(PRESETS), 'scout', name => {
  genome = PRESETS[name]();
  baseSkeleton = structuredClone(genome.skeleton);
  savedWeapon = genome.weapon;
  for (const [k, set] of scaleSetters) { scales[k] = 1; set(1); }
  for (const [k, set] of gaitSetters) set(genome.gait[k]);
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

const gCam = group(panel, 'camera — 3d, viewed flat');
slider(gCam, 'yaw', -Math.PI, Math.PI, 0.01, cam.yaw, v => { cam.yaw = v; });
slider(gCam, 'pitch', -0.1, 0.9, 0.01, cam.pitch, v => { cam.pitch = v; });
slider(gCam, 'zoom', 24, 140, 1, cam.ppm, v => { cam.ppm = v; });

document.getElementById('copy')!.addEventListener('click', () => {
  navigator.clipboard.writeText(genomeBox.value);
});

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
  renderer.render(img.data, caps, cam, scroll);
  lowCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(low, 0, 0, canvas.width, canvas.height);

  speedOut.textContent = `${speed.toFixed(2)} m/s`;
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    fpsOut.textContent = `${(fpsN / fpsAcc).toFixed(0)} fps`;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}

requestAnimationFrame(frame);

// manual sim stepping for outside tooling (the pane suspends rAF when hidden)
(window as any).rig = {
  step: (dt: number) => tick(dt),
  slash: () => { slash.active = true; slash.t = 0; },
};
