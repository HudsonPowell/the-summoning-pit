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

export type Anchor = 'head' | 'shoulder' | 'torso' | 'back' | 'waist';

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

/**
 * The pit lord's crown. Not part of any genome — it is drawn onto whoever
 * currently holds the pit, and it moves the moment someone takes the title.
 * Worn ABOVE the skull rather than around it, so it reads at a distance and on
 * a body of any shape, including ones with no obvious head to sit on.
 */
export const CROWN: GearPiece = {
  name: 'crown', at: 'head',
  parts: [
    // the band, crossed so it reads as a ring from any angle
    // dark iron, not gold — the pit does not award treasure, it awards the
    // fact that you are still standing
    { a: [-0.34, 0.62, 0], b: [0.34, 0.62, 0], r: 0.17, color: '#2f3338' },
    { a: [0, 0.62, -0.34], b: [0, 0.62, 0.34], r: 0.17, color: '#282c31' },
    // the points catch a little more light so the shape still reads
    { a: [0.3, 0.66, 0], b: [0.36, 1.0, 0], r: 0.08, color: '#4a5058' },
    { a: [-0.3, 0.66, 0], b: [-0.36, 1.0, 0], r: 0.08, color: '#4a5058' },
    { a: [0, 0.66, 0.3], b: [0, 1.0, 0.36], r: 0.08, color: '#4a5058' },
    { a: [0, 0.66, -0.3], b: [0, 1.0, -0.36], r: 0.08, color: '#4a5058' },
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

export const BELT: GearPiece = {
  name: 'belt', at: 'waist',
  parts: [
    // the band, crossed so it rings the body from any angle
    { a: [0.5, 0, 0], b: [-0.5, 0, 0], r: 0.5, color: '#4a3826' },
    { a: [0, 0, 0.5], b: [0, 0, -0.5], r: 0.5, color: '#42311f' },
    { a: [0.58, 0.02, 0], b: [0.58, 0.02, 0], r: 0.16, color: BRASS },        // buckle
    { a: [0.2, -0.15, 0.5], b: [0.15, -0.45, 0.55], r: 0.2, color: '#5a4732' }, // pouch on the hip
  ],
};

export const PACK: GearPiece = {
  name: 'pack', at: 'back',
  parts: [
    { a: [-0.15, 0.45, 0], b: [-0.35, -0.4, 0], r: 0.62, color: '#6a5137' },   // the pack itself
    { a: [-0.2, 0.62, 0.3], b: [-0.2, 0.62, -0.3], r: 0.26, color: '#57422c' }, // bedroll on top
    { a: [0.15, 0.35, 0.42], b: [-0.1, -0.3, 0.5], r: 0.09, color: '#3d2f1e' }, // straps
    { a: [0.15, 0.35, -0.42], b: [-0.1, -0.3, -0.5], r: 0.09, color: '#3d2f1e' },
  ],
};

export const SATCHEL: GearPiece = {
  name: 'satchel', at: 'waist',
  parts: [
    { a: [0, 0.5, -0.35], b: [0.1, -0.1, 0.5], r: 0.09, color: '#4a3826' },    // the strap across
    { a: [0.12, -0.2, 0.55], b: [0.05, -0.5, 0.6], r: 0.3, color: '#6a5137' }, // the bag on the hip
  ],
};

export const BANNER: GearPiece = {
  name: 'banner', at: 'back',
  parts: [
    // a pole rising well over the shoulder — read at a distance, like the crown
    { a: [-0.2, -0.4, 0.15], b: [-0.35, 1.9, 0.2], r: 0.06, color: '#4e3b2c' },
    { a: [-0.34, 1.85, 0.2], b: [-0.05, 1.6, 0.2], r: 0.16, color: '#7a2f2f' },  // the cloth
    { a: [-0.1, 1.62, 0.2], b: [-0.15, 1.35, 0.2], r: 0.12, color: '#6a2828' }, // its tail
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
  if (has(/banner|standard|war ?flag|herald|crusad/)) out.push(BANNER);
  if (has(/\bpack\b|backpack|rucksack|knapsack|travell?er|wanderer|nomad|pilgrim|merchant|peddler/)) out.push(PACK);
  if (has(/satchel|\bbag\b|courier|scavenger|looter/)) out.push(SATCHEL);
  if (has(/\bbelt\b|girdle|bandolier|pouch|utility/)) out.push(BELT);

  // one of each anchor, so nothing wears two helmets
  const seen = new Set<Anchor>();
  return out.filter(g => (g.at === 'shoulder' || !seen.has(g.at)) && (seen.add(g.at), true));
}
