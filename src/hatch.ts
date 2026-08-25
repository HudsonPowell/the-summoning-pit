// Text -> genome, shared by the studio (browser) and the farm CLI (node).
// A local model writes the genome; the clamps are the type-checker; the
// structural repairs guarantee it can stand. Everything stays on-machine.

import {
  defaultBiped, imp, hound, Genome, Skeleton, Gait, ChainSpec,
} from './genome';

export const HATCH_MODEL = 'llama3.2:3b';
export const OLLAMA_URL = 'http://localhost:11434';

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
- SIZE MATTERS. Leg seg lengths set the height: tiny creature legs 0.1-0.18
  each, small/dwarf/stocky 0.2-0.3, human-sized 0.4-0.5, huge/towering
  0.55-0.7. Match thickness r to bulk: wiry 0.02-0.04, average 0.05,
  massive/heavy-set 0.08-0.12. Stocky = short legs + wide hipW/chestW + big r.
- Use exactly ONE arm chain and ONE hip leg chain unless the description
  explicitly asks for extra limbs (four arms, six legs, etc.).
- If the description mentions a held weapon (axe, club, sword, spear, hammer),
  you MUST include the "weapon" object.
- gait numbers: cadence 0.2-2.2 (steps tempo; small quick things high, heavy
  things low), stride 0.2-2.4 (metres per cycle, roughly leg length x 1.5),
  lean/slump = forward hunch, armSwing 0-1, headPitch = head droop,
  flapAmp = wing beat, tailWave = tail wag. All same units as the examples.
- palette: hex colours that match the description's material and mood.
  weapon: optional, held in the first arm pair.
Respond with ONLY a JSON object shaped exactly like the examples, with keys
name, skeleton, gait, palette, and optionally weapon. Make the numbers and
shapes express the personality in the description.`;

export function buildPrompt(desc: string): string {
  return (
    SCHEMA_NOTES +
    `\n\nExample biped:\n${JSON.stringify(defaultBiped())}` +
    `\n\nExample small winged creature:\n${JSON.stringify(imp())}` +
    `\n\nExample quadruped:\n${JSON.stringify(hound())}` +
    `\n\nNow write the genome for: "${desc}"\nJSON:`
  );
}

export async function askOllama(
  desc: string,
  model = HATCH_MODEL,
  url = OLLAMA_URL,
  onProgress?: (chars: number) => void,
  temperature = 0.7,
): Promise<string> {
  // streamed, not buffered: a silent 20s connection gets culled by some
  // environments, and streaming gives live progress for free
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      format: 'json',
      options: { temperature, num_predict: 1400 },
      prompt: buildPrompt(desc),
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama ${res.status} — is \`ollama serve\` running?`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { response?: string; done?: boolean };
      out += j.response ?? '';
      onProgress?.(out.length);
      if (j.done) return out;
    }
  }
  return out;
}

const clampN = (x: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof x === 'number' && isFinite(x) ? x : fallback;
  return Math.min(hi, Math.max(lo, v));
};

export function validateGenome(raw: any, desc: string): Genome {
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
        .map((c: ChainSpec) =>
          c.seg.length < 2 && c.role !== 'tail'
            ? { ...c, seg: [c.seg[0] ?? 0.3, c.seg[0] ?? 0.3] }
            : c,
        )
    : [];

  // unless the words ask for extra limbs, one chain per role is the law —
  // a 3B model ignores prose rules often enough that this must be code
  const wantsExtra = /\b(three|four|six|eight|many|multiple|extra|\d+)[- ]?(arm|leg|wing|tail|limb|head)/i.test(desc);
  if (!wantsExtra) {
    const seen = new Set<string>();
    chains = chains.filter(c => {
      const key = c.role === 'leg' ? `leg@${c.attach}` : c.role;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const prone = !!sk.prone;
  // upright creatures don't grow legs from their chest — that's model error,
  // unless there are no hip legs at all (then it's a mislabel: move them down)
  if (!prone) {
    const hasHipLegs = chains.some(c => c.role === 'leg' && c.attach === 'hip');
    chains = chains.flatMap(c => {
      if (c.role !== 'leg' || c.attach !== 'chest') return [c];
      return hasHipLegs ? [] : [{ ...c, attach: 'hip' as const }];
    });
  }
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

  // name from the DESCRIPTION, not the model: rerolling the same words then
  // overwrites the dud in genomes/ instead of spamming the pool
  const name = 'hatched-' + desc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

  const genome: Genome = { name, skeleton, gait, palette };
  const canHold = !prone && chains.some(c => c.role === 'arm');
  if (raw?.weapon && canHold) {
    genome.weapon = {
      length: clampN(raw.weapon.length, 0.15, 0.9, 0.5),
      r: clampN(raw.weapon.r, 0.02, 0.09, 0.035),
      color: hexOk(raw.weapon.color, '#cfd6e4'),
    };
  }
  // weapon backstop: if the words name a weapon, the creature gets one even
  // when the model forgets — forged from the vocabulary, not the vibes
  if (!genome.weapon && canHold) {
    const FORGE: [RegExp, { length: number; r: number; color: string }][] = [
      [/axe|hatchet/i, { length: 0.42, r: 0.055, color: '#9aa1ab' }],
      [/club|cudgel/i, { length: 0.5, r: 0.07, color: '#6b4a2f' }],
      [/sword|blade|sabre|saber/i, { length: 0.6, r: 0.032, color: '#cfd6e4' }],
      [/spear|pike|lance/i, { length: 0.85, r: 0.024, color: '#a08a63' }],
      [/hammer|maul|mace/i, { length: 0.4, r: 0.065, color: '#7a7f8a' }],
      [/staff|stave|wand/i, { length: 0.75, r: 0.026, color: '#8a6d3f' }],
    ];
    for (const [re, w] of FORGE) {
      if (re.test(desc)) { genome.weapon = { ...w }; break; }
    }
  }
  return genome;
}

export async function hatchGenome(
  desc: string,
  model = HATCH_MODEL,
  url = OLLAMA_URL,
  onProgress?: (chars: number) => void,
  temperature = 0.7,
): Promise<Genome> {
  const text = await askOllama(desc, model, url, onProgress, temperature);
  return validateGenome(JSON.parse(text), desc);
}
