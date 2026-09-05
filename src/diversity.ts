import { Genome, ChainSpec, defaultBiped } from './genome';

/** Repeatable design exploration, independent of animation randomness. */
export function designRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRUCTURES = [
  'a tall narrow column with low hanging appendages',
  'a low wide body with a tiny raised head',
  'a long segmented ribbon with scattered supports',
  'a top-heavy bulb on a few thin supports',
  'a tiny core surrounded by long radial appendages',
  'a compact body with one dramatically oversized limb',
  'two unequal body masses joined by a thin waist',
  'a head-dominated silhouette with a vestigial body',
  'an arching body suspended between widely separated supports',
  'a legless floating body with hanging tendrils',
  'a long neck rising out of a squat body',
  'an asymmetric arrangement with an offset head and counterweight tail',
];
const ACCENTS = ['a fan of fins', 'one enormous curved horn', 'a forked tail', 'a crown of small heads',
  'a trailing curtain of tendrils', 'a single broad crest', 'a row of tall spines', 'a pair of unusually long ears made from fins'];

export function variationBrief(seed: number): string {
  const r = designRandom(seed), pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  return `DESIGN STUDY ${seed >>> 0}: In unspecified anatomy, explore ${pick(STRUCTURES)}.
Secondary silhouette idea: ${pick(ACCENTS)}. Choose one dominant feature; make its size relationship unmistakable.
The request outranks these suggestions: preserve its species, explicit limb counts, body plan and equipment.
Do not copy an example or merely recolour it. Change mass distribution, attachment layout and negative space.
Use side/yaw for single offset appendages and taper for a blunt, pointed or clubbed ending.`;
}

/** Combinatorial examples, not a fixed menu that the model repeatedly copies. */
export function anatomyStudy(seed: number): Genome {
  const r = designRandom(seed), range = (lo: number, hi: number) => lo + r() * (hi - lo);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const g = defaultBiped(); delete g.weapon;
  const family = Math.floor(r() * 8);
  g.name = `anatomy study ${seed >>> 0}`;
  const upright = family === 0 || family === 3 || family === 6;
  const count = family === 2 ? 6 : family === 4 ? 1 : Math.floor(range(2, 5));
  g.skeleton = { upright, locomotion: family === 5 ? 'fly' : family === 2 ? 'slither' : family === 4 ? 'hop' : 'walk',
    body: Array.from({ length: count }, () => range(0.09, family === 2 ? 0.34 : 0.24)),
    girth: Array.from({ length: count + 1 }, (_, i) =>
      family === 4 ? 0.29 : (i % 2 ? range(0.035, 0.1) : range(0.13, 0.29))), chains: [] };
  const profiles: number[][] = [
    [0.08,0.2,0.12,0.055], [0.08,0.16,0.12,0.085], [0.035,0.065,0.08,0.05],
    [0.045,0.24,0.2], [0.27,0.3], [0.23,0.18,0.05], [0.14,0.17,0.085], [0.065,0.14,0.09,0.045],
  ];
  g.skeleton.girth = profiles[family].map(v => v * range(0.85,1.15));
  g.skeleton.body = g.skeleton.body.map(v => family === 2 ? v * 1.3 : family === 1 || family === 7 ? v * 1.6 : v);
  const chains = g.skeleton.chains;
  const chain = (role: ChainSpec['role'], at: number, seg: number[], extra: Partial<ChainSpec> = {}) =>
    chains.push({ role, at, seg, r: range(0.02, 0.065), spread: range(0.05, 0.14), ...extra });
  const legPairs = family === 2 || family === 5 ? 0 : family === 1 || family === 7 ? Math.floor(range(3, 7)) : upright ? 1 : 2;
  for (let i = 0; i < legPairs; i++) {
    const long = family === 3 ? range(0.38, 0.65) : range(0.16, 0.34);
    chain('leg', legPairs === 1 ? 0 : i / Math.max(1, legPairs - 1), [long, long * range(0.55, 1.3)],
      { mirror: !(family === 7 && i % 2), side: i % 2 ? -1 : 1 });
  }
  const heads = pick([0, 1, 1, 2, 3]);
  for (let i = 0; i < heads; i++) chain('head', range(0.55, 1), [range(0.05, family === 6 ? 0.55 : 0.2), range(0.05, 0.22)],
    { r: range(0.06, family === 4 ? 0.28 : 0.17), mirror: false, side: heads === 1 ? range(-0.7, 0.7) : (i / (heads - 1) * 2 - 1),
      yaw: range(-0.7, 0.7), taper: range(0.2, 1.4), angle: range(-0.5, 0.9) });
  if (upright) {
    const arms = pick([1, 1, 2, 3]);
    for (let i = 0; i < arms; i++) chain('arm', 0.6 + i * 0.13, [range(0.12, 0.48), range(0.14, 0.38)],
      { mirror: i === 0, side: i % 2 ? -1 : 1, r: range(0.035, 0.08) });
  }
  const ornament = pick(['horn', 'fin', 'spike', 'tentacle'] as const);
  const ornaments = family === 5 ? Math.floor(range(4, 8)) : Math.floor(range(1, 5));
  for (let i = 0; i < ornaments; i++) chain(family === 5 ? 'tentacle' : ornament, range(0.1, 1),
    [range(0.08, 0.32), range(0.07, 0.25), range(0.04, 0.16)],
    { mirror: false, side: i % 2 ? -1 : 1, yaw: range(-2.5, 2.5), angle: range(-0.4, 1.5), taper: range(0.12, 0.7), ink: 3 });
  if (family === 2 || r() < 0.5) chain('tail', range(0, 0.2), [range(0.15, 0.4), range(0.1, 0.3), 0.12],
    { mirror: r() < 0.3, yaw: range(-0.8, 0.8), taper: range(0.12, 0.8) });
  g.gait = { ...g.gait, cadence: range(0.5, 1.8), stride: range(0.25, 0.8), crouch: 0.015,
    bodyWave: family === 2 ? 0.9 : range(0, 0.15), tailWave: range(0.2, 0.9), lean: range(-0.08, 0.18) };
  g.palette = pick([
    { torso: '#c99f74', limbs: '#625c72', head: '#dfcfaf', accent: '#c94538' },
    { torso: '#477c77', limbs: '#294b57', head: '#a8c5a3', accent: '#efb843' },
    { torso: '#86527e', limbs: '#4c3e65', head: '#d3a69b', accent: '#a9c65a' },
    { torso: '#b9b6a0', limbs: '#686f75', head: '#dbd7bf', accent: '#ee7346' },
  ]);
  return g;
}
