// What a creature WEARS.
//
// A weapon is held in a hand and lives in grip space. Gear hangs off the body:
// a helmet over the skull, plates round the chest, pauldrons on the shoulders,
// a cloak off the back, a crest on top. Same primitive as everything else —
// capsules with a radius — so it blends into the body rather than sitting on
// top of it like a decal.
//
// Placement is in ANCHOR space: +x forward, +y up, +z out to the side, scaled
// by the size of the thing it is attached to. That way a helmet fits a hound
// and an ogre without either being told about the other.

export type Anchor = 'head' | 'shoulder' | 'torso' | 'back';

export interface GearPart {
  a: [number, number, number];
  b: [number, number, number];
  r: number;
  color: string;
}
export interface GearPiece {
  name: string;
  at: Anchor;
  mirror?: boolean;   // shoulders come in pairs
  parts: GearPart[];
}

const STEEL = '#8c939d';
const DARK = '#4a4f57';
const BRASS = '#b8975a';

export const HELM: GearPiece = {
  name: 'helm', at: 'head',
  parts: [
    // a dome that sits DOWN over the skull, not a hat balanced on it
    { a: [-0.1, 0.18, 0], b: [0.15, 0.1, 0], r: 0.62, color: STEEL },
    { a: [0.3, 0.02, 0], b: [0.55, -0.16, 0], r: 0.3, color: DARK },   // brow / visor
  ],
};

export const HORNED_HELM: GearPiece = {
  name: 'horned helm', at: 'head',
  parts: [
    { a: [-0.1, 0.18, 0], b: [0.12, 0.12, 0], r: 0.62, color: DARK },
    { a: [0, 0.4, 0.35], b: [-0.3, 1.1, 0.7], r: 0.16, color: '#e6e0d0' },
    { a: [0, 0.4, -0.35], b: [-0.3, 1.1, -0.7], r: 0.16, color: '#e6e0d0' },
  ],
};

export const CREST: GearPiece = {
  name: 'crest', at: 'head',
  parts: [
    { a: [-0.2, 0.5, 0], b: [0.35, 0.75, 0], r: 0.16, color: '#c2483a' },
    { a: [0.35, 0.75, 0], b: [0.6, 0.45, 0], r: 0.1, color: '#a83a30' },
  ],
};

export const HOOD: GearPiece = {
  name: 'hood', at: 'head',
  parts: [
    { a: [-0.35, 0.1, 0], b: [0.2, 0.15, 0], r: 0.78, color: '#3e3a44' },
    { a: [-0.5, -0.2, 0], b: [-0.9, -0.9, 0], r: 0.5, color: '#332f38' },  // it hangs
  ],
};

export const PAULDRON: GearPiece = {
  name: 'pauldron', at: 'shoulder', mirror: true,
  parts: [{ a: [0, 0.12, 0.1], b: [-0.1, -0.05, 0.45], r: 0.5, color: STEEL }],
};

export const PLATE: GearPiece = {
  name: 'plate', at: 'torso',
  parts: [
    // It has to stand PROUD of the chest or the blend swallows it whole — the
    // first version sat inside the body's own radius and was invisible.
    { a: [0.62, 0.2, 0], b: [0.58, -0.45, 0], r: 0.62, color: STEEL },
    { a: [0.5, 0.24, 0.5], b: [0.5, 0.24, -0.5], r: 0.34, color: STEEL },  // collar
    { a: [0.78, 0.05, 0], b: [0.78, 0.05, 0], r: 0.26, color: BRASS },     // a boss
  ],
};

export const RAGS: GearPiece = {
  name: 'rags', at: 'torso',
  parts: [
    { a: [0.4, 0.0, 0.55], b: [0.1, -1.25, 0.7], r: 0.3, color: '#5a5348' },
    { a: [0.35, -0.1, -0.6], b: [0.0, -1.45, -0.5], r: 0.26, color: '#4e483e' },
    { a: [0.45, 0.15, 0], b: [0.3, -0.7, 0.1], r: 0.34, color: '#635b4e' },
  ],
};

export const CLOAK: GearPiece = {
  name: 'cloak', at: 'back',
  parts: [
    { a: [0, 0.3, 0], b: [-0.5, -1.2, 0], r: 0.85, color: '#5b2f3a' },
    { a: [-0.5, -1.2, 0], b: [-0.7, -1.9, 0], r: 0.6, color: '#4a2530' },
  ],
};

export const SHELL: GearPiece = {
  name: 'shell', at: 'back',
  parts: [{ a: [0.25, 0.35, 0], b: [-0.35, 0.2, 0], r: 1.15, color: '#6b5a3f' }],
};

/**
 * The words say what it is wearing. Ordered so the specific wins: a horned
 * helm before a helm, a hood before a cloak.
 */
export function gearFromWords(desc: string): GearPiece[] {
  const d = desc.toLowerCase();
  const out: GearPiece[] = [];
  const has = (re: RegExp) => re.test(d);

  if (has(/horned helm|horned helmet|viking|berserker|barbarian chief/)) out.push(HORNED_HELM);
  else if (has(/helm|helmet|visor|knight|paladin|templar|man-at-arms|guard\b|legion/)) out.push(HELM);
  if (has(/plume|crest|crested|centurion|champion/)) out.push(CREST);
  if (has(/hood|hooded|cowl|cloaked|robed|monk|assassin|ranger|rogue|cultist|acolyte|necromancer|wizard|witch/)) out.push(HOOD);

  if (has(/pauldron|spaulder|armoured|armored|plate|knight|paladin|templar|golem|juggernaut/)) out.push(PAULDRON);
  if (has(/plate|breastplate|armour|armor|armoured|armored|cuirass|knight|paladin|templar/)) out.push(PLATE);
  if (has(/rags|ragged|tattered|beggar|peasant|zombie|ghoul|wretch|starv/)) out.push(RAGS);

  if (has(/cloak|cape|mantle|shroud|caped/)) out.push(CLOAK);
  if (has(/shell|carapace|tortoise|turtle|beetle|crab|armoured back/)) out.push(SHELL);

  // one of each anchor, so nothing wears two helmets
  const seen = new Set<Anchor>();
  return out.filter(g => (g.at === 'shoulder' || !seen.has(g.at)) && (seen.add(g.at), true));
}
