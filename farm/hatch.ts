// Text -> creature. A local model writes a genome from a description; the
// clamps and the solver are the type-checker; CLIP is the reviewer. Nothing
// in this pipeline leaves the machine.
//
// Usage: npm run hatch -- "a cowardly bog troll with one huge arm"
// Needs: ollama serve running, with the model below pulled.

import { mkdirSync, writeFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';
import {
  defaultBiped, imp, hound, Genome, Skeleton, Gait, ChainSpec,
} from '../src/genome';
import { renderSheet } from './lib';

const MODEL = process.env.HATCH_MODEL ?? 'llama3.2:3b';
const OLLAMA = 'http://localhost:11434';

const description = process.argv[2];
if (!description) {
  console.error('usage: npm run hatch -- "<creature description>"');
  process.exit(1);
}

// --- prompt ---------------------------------------------------------------

const SCHEMA_NOTES = `
You design creatures for a game as JSON "genomes". Skeleton rules:
- "prone": true = quadruped (horizontal spine), false = upright biped-like.
- "chains" is a list of limbs. role: "leg" | "arm" | "wing" | "tail".
  attach: "hip" (rear/lower girdle) or "chest" (front/upper girdle).
  Every leg/arm/wing chain is automatically mirrored left+right, so ONE
  arm chain means TWO arms. A tail is single. seg = segment lengths in
  metres (use exactly 2 for legs/arms/wings; 2-3 for tails).
  spread = sideways offset of the pair. r = limb thickness.
- A creature MUST have at least one leg chain. Upright creatures need hip legs.
  Quadrupeds (prone: true) need BOTH a hip leg chain and a chest leg chain,
  and should have NO arm chains.
- gait numbers: cadence 0.2-2.2 (steps tempo), stride 0.2-2.4 (metres per
  cycle), lean/slump = forward hunch, armSwing 0-1, headPitch = head droop,
  flapAmp = wing beat, tailWave = tail wag. All same units as the examples.
- palette: hex colours. weapon: optional, held in the first arm pair.
Respond with ONLY a JSON object shaped exactly like the examples, with keys
name, skeleton, gait, palette, and optionally weapon. Make the numbers and
shapes express the personality in the description.`;

function exampleOf(g: Genome): string {
  return JSON.stringify(g);
}

async function askModel(desc: string): Promise<string> {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0.7, num_predict: 1400 },
      prompt:
        SCHEMA_NOTES +
        `\n\nExample biped:\n${exampleOf(defaultBiped())}` +
        `\n\nExample small winged creature:\n${exampleOf(imp())}` +
        `\n\nExample quadruped:\n${exampleOf(hound())}` +
        `\n\nNow write the genome for: "${desc}"\nJSON:`,
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status} — is \`ollama serve\` running?`);
  const data = (await res.json()) as { response: string };
  return data.response;
}

// --- validation: clamps are the type-checker ------------------------------

const clampN = (x: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof x === 'number' && isFinite(x) ? x : fallback;
  return Math.min(hi, Math.max(lo, v));
};

function validate(raw: any, desc: string): Genome {
  const base = defaultBiped();
  const sk = raw?.skeleton ?? {};
  const roles = new Set(['leg', 'arm', 'wing', 'tail']);

  let chains: ChainSpec[] = Array.isArray(sk.chains)
    ? sk.chains
        .filter((c: any) => roles.has(c?.role))
        .slice(0, 6)
        .map((c: any): ChainSpec => ({
          role: c.role,
          attach: c.attach === 'chest' ? 'chest' : 'hip',
          seg: (Array.isArray(c.seg) ? c.seg : [0.3, 0.3])
            .slice(0, c.role === 'tail' ? 3 : 2)
            .map((s: unknown) => clampN(s, 0.08, 0.8, 0.3)),
          r: clampN(c.r, 0.015, 0.12, 0.05),
          spread: clampN(c.spread, 0, 0.45, 0.12),
        }))
        .map((c: ChainSpec) => (c.seg.length < 2 && c.role !== 'tail' ? { ...c, seg: [c.seg[0] ?? 0.3, c.seg[0] ?? 0.3] } : c))
    : [];

  const prone = !!sk.prone;
  if (!chains.some(c => c.role === 'leg' && c.attach === 'hip'))
    chains.push({ role: 'leg', attach: 'hip', seg: [0.35, 0.35], r: 0.05, spread: 0.11 });
  if (prone && !chains.some(c => c.role === 'leg' && c.attach === 'chest'))
    chains.push({ role: 'leg', attach: 'chest', seg: [0.32, 0.32], r: 0.045, spread: 0.11 });
  if (prone) chains = chains.filter(c => c.role !== 'arm');

  const skeleton: Skeleton = {
    prone,
    spine: clampN(sk.spine, 0.15, 0.9, 0.5),
    neck: clampN(sk.neck, 0.02, 0.35, 0.09),
    headR: clampN(sk.headR, 0.05, 0.28, 0.115),
    hipW: clampN(sk.hipW, 0.08, 0.5, 0.22),
    chestW: clampN(sk.chestW, 0.1, 0.7, 0.36),
    torsoR: clampN(sk.torsoR, 0.04, 0.2, 0.1),
    chains,
  };

  const g = raw?.gait ?? {};
  const gait: Gait = {
    cadence: clampN(g.cadence, 0.2, 2.2, base.gait.cadence),
    stride: clampN(g.stride, 0.2, 2.4, base.gait.stride),
    stance: clampN(g.stance, 0.5, 0.75, base.gait.stance),
    lift: clampN(g.lift, 0, 0.3, base.gait.lift),
    bounce: clampN(g.bounce, 0, 0.08, base.gait.bounce),
    sway: clampN(g.sway, 0, 0.09, base.gait.sway),
    lean: clampN(g.lean, -0.2, 0.5, base.gait.lean),
    slump: clampN(g.slump, 0, 0.8, base.gait.slump),
    crouch: clampN(g.crouch, 0, 0.25, base.gait.crouch),
    pelvisTwist: clampN(g.pelvisTwist, 0, 0.3, base.gait.pelvisTwist),
    shoulderTwist: clampN(g.shoulderTwist, 0, 0.4, base.gait.shoulderTwist),
    armSwing: clampN(g.armSwing, 0, 1, base.gait.armSwing),
    elbowBase: clampN(g.elbowBase, 0, 1.2, base.gait.elbowBase),
    elbowAmp: clampN(g.elbowAmp, 0, 1.2, base.gait.elbowAmp),
    elbowLag: clampN(g.elbowLag, 0, 0.4, base.gait.elbowLag),
    headPitch: clampN(g.headPitch, -0.4, 0.8, base.gait.headPitch),
    flapAmp: clampN(g.flapAmp, 0, 1.3, base.gait.flapAmp),
    tailWave: clampN(g.tailWave, 0, 1.2, base.gait.tailWave),
  };

  const hexOk = (c: unknown, fb: string) =>
    typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fb;
  const p = raw?.palette ?? {};
  const palette = {
    torso: hexOk(p.torso, base.palette.torso),
    limbs: hexOk(p.limbs, base.palette.limbs),
    head: hexOk(p.head, base.palette.head),
    accent: hexOk(p.accent, base.palette.accent),
  };

  const name =
    typeof raw?.name === 'string' && raw.name.length > 0 && raw.name.length < 40
      ? raw.name
      : desc.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);

  const genome: Genome = { name: `hatched-${name}`, skeleton, gait, palette };
  if (raw?.weapon && !prone && chains.some(c => c.role === 'arm')) {
    genome.weapon = {
      length: clampN(raw.weapon.length, 0.15, 0.9, 0.5),
      r: clampN(raw.weapon.r, 0.02, 0.09, 0.035),
      color: hexOk(raw.weapon.color, '#cfd6e4'),
    };
  }
  return genome;
}

// --- hatch ----------------------------------------------------------------

mkdirSync('farm/out/hatch', { recursive: true });
console.log(`hatching: "${description}" via ${MODEL}...`);
const text = await askModel(description);
let parsed: any;
try {
  parsed = JSON.parse(text);
} catch {
  console.error('model returned unparseable JSON:\n' + text.slice(0, 400));
  process.exit(1);
}
const genome = validate(parsed, description);

const slug = genome.name.replace(/[^a-z0-9-]/gi, '');
writeFileSync(`genomes/${slug}.json`, JSON.stringify(genome, null, 2));
const sheet = renderSheet(genome, { tired: 0, angry: 0 });
const sheetPath = `farm/out/hatch/${slug}.png`;
writeFileSync(sheetPath, sheet);

// the reviewer: does the walking result read as the description?
const classify = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
const out = (await classify(sheetPath, [
  `pixel art of ${description}`,
  'pixel art of a generic humanoid figure',
])) as { label: string; score: number }[];
const score = out.find(o => o.label.startsWith('pixel art of ' + description.slice(0, 8)))?.score ?? out[0].score;

console.log(`\nhatched -> genomes/${slug}.json`);
console.log(`sheet   -> ${sheetPath}`);
console.log(`chains  -> ${genome.skeleton.chains.map(c => `${c.role}@${c.attach}`).join(', ')}${genome.skeleton.prone ? ' (prone)' : ''}`);
console.log(`judge   -> reads-as-description ${score.toFixed(3)} (vs generic humanoid)`);
