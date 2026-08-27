// Specimen page for PIT WIRE. Two views of the same system: the word being
// summoned, and the whole set laid flat so the hand can be judged.

import { PixelView } from '../view';
import { Camera } from '../render';
import { Capsule } from '../pose';
import { WireText, SetOptions } from './typeset';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const heroCanvas = $<HTMLCanvasElement>('hero');
const HERO_W = 760, HERO_H = 260;
const CHART_W = 760;

const hero = new PixelView(heroCanvas, HERO_W, HERO_H);
// Two sheets, not one: the GPU path draws at most 512 capsules per frame, and
// the whole set in a single buffer silently loses its last rows.
const sheets = [
  { view: new PixelView($<HTMLCanvasElement>('chart'), CHART_W, 300), h: 300,
    rows: ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ'], texts: [] as WireText[], caps: [] as Capsule[] },
  { view: new PixelView($<HTMLCanvasElement>('chart2'), CHART_W, 190), h: 190,
    rows: ['0123456789', "-.,:'!?"], texts: [] as WireText[], caps: [] as Capsule[] },
];

const VOID: [number, number, number] = [8, 8, 12];

const cfg = {
  text: 'THE SUMMONING PIT',
  gauge: 0.078,
  hand: 1,
  tracking: 0.0,
  blend: 2.2,
  shade: true,
  seed: 1740,
};

let word: WireText;
let t = 0;
let phase: 'summon' | 'hold' = 'summon';

function baseOpts(): Partial<SetOptions> {
  return { gauge: cfg.gauge, hand: cfg.hand, tracking: cfg.tracking, seed: cfg.seed, size: 1 };
}

function rebuild(resummon = true): void {
  word = new WireText(cfg.text || ' ', { ...baseOpts(), align: 'centre' });
  $('meta').textContent =
    `${word.pieces.length} pieces · ${word.rivets.length} rivets · ` +
    `${word.pieces.reduce((a, p) => a + p.rod.n, 0)} beads → ${word.capsules().length} capsules · ` +
    `${(word.wireLength * 100).toFixed(0)} cm of wire at cap-height 1 m`;
  if (resummon) summon(); else word.settle();
}

function summon(): void {
  word.coil(1.3, 0.45);
  t = 0;
  phase = 'summon';
}

// --- the specimen sheet ---------------------------------------------------

const GAP = 1.62;
function buildSheet(): void {
  for (const sh of sheets) {
    sh.texts = sh.rows.map((r, i) =>
      new WireText(r, { ...baseOpts(), align: 'centre', baseline: (sh.rows.length - 1 - i) * GAP }));
  }
}

// --- cameras --------------------------------------------------------------

function heroCam(): Camera {
  const pad = 0.86;
  const ppm = Math.min(HERO_W * pad / Math.max(0.4, word.width), HERO_H * 0.42);
  return {
    yaw: 0, pitch: 0, ppm, cy: 0.5, cx: 0, cz: 0,
    floor: false, flat: !cfg.shade,
    blend: cfg.blend, blendDepth: 0.5, blendMix: 1, blendShape: 0.62,
    voidColor: VOID,
  };
}

function chartCam(sh: typeof sheets[number]): Camera {
  const w = Math.max(0.5, ...sh.texts.map(s => s.width));
  const h = (sh.rows.length - 1) * GAP + 1;
  const ppm = Math.min(CHART_W * 0.88 / w, sh.h * 0.84 / h);
  return {
    yaw: 0, pitch: 0, ppm, cy: h / 2 - 0.06, cx: 0, cz: 0,
    floor: false, flat: !cfg.shade,
    blend: cfg.blend, blendDepth: 0.5, blendMix: 1, blendShape: 0.62,
    voidColor: VOID,
  };
}

// --- interaction ----------------------------------------------------------

let mouse: { x: number; y: number } | null = null;
heroCanvas.addEventListener('pointermove', e => {
  const r = heroCanvas.getBoundingClientRect();
  const cam = heroCam();
  const px = (e.clientX - r.left) / r.width * HERO_W;
  const py = (e.clientY - r.top) / r.height * HERO_H;
  mouse = { x: (px - HERO_W / 2) / cam.ppm, y: -(py - HERO_H / 2) / cam.ppm + cam.cy };
});
heroCanvas.addEventListener('pointerleave', () => { mouse = null; });

// --- loop -----------------------------------------------------------------

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.04, (now - last) / 1000);
  last = now;
  t += dt;

  if (phase === 'summon') {
    word.step(dt, t, { stagger: 0.075, rise: 0.95, gravity: -2.8 });
    if (t > 0.075 * cfg.text.length + 1.8) phase = 'hold';
  } else {
    // Brass is stiff. A loose hold leaves the rod trembling a couple of percent
    // of a cap height off the letter forever, which reads as a hairy edge next
    // to the same word rendered static — so hold it hard and let the spring
    // show only when something actually pushes it.
    word.simulate(dt, { home: 0.4, bend: 1 });
    word.breathe(t);
  }
  if (mouse) word.push(mouse.x, mouse.y, 0.26, 0.075);

  hero.render(word.frame(), heroCam(), 0);

  for (const sh of sheets) {
    sh.caps.length = 0;
    for (const tx of sh.texts) for (const c of tx.capsules()) sh.caps.push(c);
    sh.view.render(sh.caps, chartCam(sh), 0);
  }

  requestAnimationFrame(loop);
}

// --- wiring ---------------------------------------------------------------

function bindSlider(id: string, key: keyof typeof cfg, fmt: (v: number) => string, after: () => void): void {
  const el = $<HTMLInputElement>(id);
  const out = $(id + 'v');
  const apply = () => {
    (cfg as any)[key] = parseFloat(el.value);
    out.textContent = fmt(parseFloat(el.value));
    after();
  };
  el.addEventListener('input', apply);
  apply();
}

const rebuildAll = () => { rebuild(false); buildSheet(); };

$<HTMLInputElement>('text').addEventListener('input', e => {
  cfg.text = (e.target as HTMLInputElement).value;
  rebuild(true);
});
$('replay').addEventListener('click', () => summon());
$('drop').addEventListener('click', () => { word.slack(0.55); phase = 'hold'; });
$('reseed').addEventListener('click', () => { cfg.seed = (Math.random() * 1e6) | 0; rebuildAll(); });
$<HTMLInputElement>('shade').addEventListener('change', e => {
  cfg.shade = (e.target as HTMLInputElement).checked;
});

bindSlider('gauge', 'gauge', v => v.toFixed(3), rebuildAll);
bindSlider('hand', 'hand', v => v.toFixed(2), rebuildAll);
bindSlider('track', 'tracking', v => v.toFixed(2), rebuildAll);
bindSlider('blend', 'blend', v => v.toFixed(1), () => {});

(async () => {
  await Promise.all([hero.init(), ...sheets.map(s => s.view.init())]);
  $('mode').textContent = hero.mode.toUpperCase();
  rebuild(true);
  buildSheet();
  requestAnimationFrame(loop);
})();
