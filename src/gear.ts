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

export type Anchor =
  | 'head' | 'shoulder' | 'torso' | 'back' | 'waist'
  | 'hip'      // tassets, a skirt, a scabbard: below the belt, on both sides
  | 'arm'      // bracers and vambraces, on the forearm
  | 'leg';     // greaves and boots, on the shin

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
  /**
   * HOW MUCH OF THIS IS CLOTH. 0 is a helmet — welded to the skull, and it
   * should be. 1 is a cloak, which has no business holding still: it hangs
   * when the creature does, streams out behind it when it runs, swings wide
   * out of a turn and snaps when it swings a blade.
   *
   * The whole of that is a function of what the body is doing THIS FRAME —
   * speed, turn, gait phase, the weight of a strike — every one of which the
   * pose solver is already holding. So cloth needs no simulation, no memory
   * and nothing on the wire: it is the same stateless-function-of-phase rule
   * the legs run on, applied to a hem.
   */
  drape?: number;
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
  name: 'hood', at: 'head', drape: 0.35,
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
  name: 'rags', at: 'torso', drape: 0.95,
  parts: [
    { a: [0.4, 0.0, 0.55], b: [0.1, -1.25, 0.7], r: 0.3, color: '#5a5348' },
    { a: [0.35, -0.1, -0.6], b: [0.0, -1.45, -0.5], r: 0.26, color: '#4e483e' },
    { a: [0.45, 0.15, 0], b: [0.3, -0.7, 0.1], r: 0.34, color: '#635b4e' },
  ],
};

/**
 * A CAPE, NOT A LOZENGE. Two fat spheres behind a creature is a rucksack; a
 * cloak needs a yoke across the shoulders, a fall down each side and a hem
 * that is WIDER than the body — the widening is the whole silhouette, and
 * with drape it is also what billows.
 */
export const CLOAK: GearPiece = {
  name: 'cloak', at: 'back', drape: 1,
  parts: [
    { a: [-0.1, 0.5, 0.52], b: [-0.1, 0.5, -0.52], r: 0.26, color: '#6a3743' },  // the yoke
    { a: [-0.15, 0.35, 0], b: [-0.5, -1.45, 0], r: 0.44, color: '#5b2f3a' },     // centre fall
    { a: [-0.15, 0.3, 0.45], b: [-0.5, -1.3, 0.6], r: 0.3, color: '#542b36' },   // left fall
    { a: [-0.15, 0.3, -0.45], b: [-0.5, -1.3, -0.6], r: 0.3, color: '#542b36' }, // right fall
    { a: [-0.55, -1.35, 0.52], b: [-0.55, -1.35, -0.52], r: 0.24, color: '#4a2530' }, // the hem
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
  name: 'banner', at: 'back', drape: 0.45,
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


const CLOTH = '#6b5f52';
const WOOL = '#59504a';
const LEATHER = '#5a4732';

/** A robe to the floor. The most cloth a creature can be wearing. */
export const ROBE: GearPiece = {
  name: 'robe', at: 'torso', drape: 1,
  parts: [
    { a: [0.1, 0.3, 0], b: [0, -1.45, 0], r: 0.7, color: '#3f3a52' },
    { a: [0.12, -0.5, 0.48], b: [0.02, -1.65, 0.66], r: 0.3, color: '#48415e' },
    { a: [0.12, -0.5, -0.48], b: [0.02, -1.65, -0.66], r: 0.3, color: '#48415e' },
    { a: [0.05, -1.6, 0.6], b: [0.05, -1.6, -0.6], r: 0.26, color: '#443e5a' },   // the hem it sweeps
    { a: [0.35, 0.2, 0], b: [0.3, -0.55, 0], r: 0.26, color: '#4e4766' },        // the front it opens on
  ],
};

/** A surcoat: a panel down the front and another down the back. */
export const TABARD: GearPiece = {
  name: 'tabard', at: 'torso', drape: 0.75,
  parts: [
    { a: [0.5, 0.35, 0], b: [0.42, -1.15, 0], r: 0.42, color: '#7a2f38' },
    { a: [-0.45, 0.3, 0], b: [-0.4, -1.05, 0], r: 0.4, color: '#6a2830' },
    { a: [0.5, 0.05, 0], b: [0.45, -0.05, 0], r: 0.16, color: BRASS },
  ],
};

/** Tassets — the plates that hang off a belt and swing when you walk. */
export const TASSETS: GearPiece = {
  name: 'tassets', at: 'hip', mirror: true, drape: 0.4,
  parts: [
    { a: [0.1, -0.1, 0.1], b: [0.05, -0.85, 0.25], r: 0.3, color: STEEL },
    { a: [-0.15, -0.15, 0.12], b: [-0.2, -0.7, 0.28], r: 0.24, color: DARK },
  ],
};

/** A long skirt, split so the legs still read through it. */
export const SKIRT: GearPiece = {
  name: 'skirt', at: 'waist', drape: 0.9,
  parts: [
    { a: [0.35, -0.1, 0.3], b: [0.3, -1.4, 0.45], r: 0.34, color: CLOTH },
    { a: [-0.3, -0.1, 0.32], b: [-0.28, -1.35, 0.48], r: 0.32, color: WOOL },
    { a: [0.35, -0.1, -0.3], b: [0.3, -1.4, -0.45], r: 0.34, color: CLOTH },
    { a: [-0.3, -0.1, -0.32], b: [-0.28, -1.35, -0.48], r: 0.32, color: WOOL },
  ],
};

export const GREAVES: GearPiece = {
  name: 'greaves', at: 'leg', mirror: true,
  parts: [
    { a: [0.1, 0.35, 0], b: [0.12, -0.5, 0], r: 0.62, color: STEEL },
    { a: [0.3, -0.55, 0], b: [0.45, -0.7, 0], r: 0.4, color: DARK },
  ],
};

export const BRACERS: GearPiece = {
  name: 'bracers', at: 'arm', mirror: true,
  parts: [
    { a: [0, 0.3, 0], b: [0, -0.35, 0], r: 0.72, color: LEATHER },
    { a: [0, 0.32, 0], b: [0, 0.2, 0], r: 0.8, color: BRASS },
  ],
};

/** A neck plate. Small, but it is what makes armour read as a SUIT. */
export const GORGET: GearPiece = {
  name: 'gorget', at: 'torso',
  parts: [
    { a: [0.2, 0.72, 0.3], b: [0.2, 0.72, -0.3], r: 0.3, color: STEEL },
    { a: [-0.15, 0.66, 0], b: [0.25, 0.7, 0], r: 0.26, color: DARK },
  ],
};

/** Fur or feathers over the shoulders — heavy cloth, barely swings. */
export const MANTLE: GearPiece = {
  name: 'mantle', at: 'shoulder', mirror: true, drape: 0.45,
  parts: [
    { a: [0, 0.25, 0], b: [-0.2, -0.55, 0.35], r: 0.85, color: '#6b6157' },
    { a: [-0.1, -0.3, 0.2], b: [-0.3, -0.95, 0.4], r: 0.5, color: '#5c534a' },
  ],
};

/** A scarf: almost no mass and almost all motion. */
export const SCARF: GearPiece = {
  name: 'scarf', at: 'torso', drape: 1,
  parts: [
    { a: [0.3, 0.68, 0.35], b: [0.3, 0.68, -0.35], r: 0.26, color: '#8c3f3a' },
    { a: [0.1, 0.6, -0.3], b: [-0.35, -0.7, -0.55], r: 0.2, color: '#7e3833' },
    { a: [-0.35, -0.7, -0.55], b: [-0.6, -1.5, -0.7], r: 0.14, color: '#71322e' },
  ],
};

export const SASH: GearPiece = {
  name: 'sash', at: 'waist', drape: 0.8,
  parts: [
    { a: [0.45, 0.15, 0.1], b: [-0.35, -0.2, 0.15], r: 0.24, color: '#8a5a2e' },
    { a: [-0.3, -0.2, 0.2], b: [-0.5, -1.1, 0.3], r: 0.16, color: '#7d5029' },
  ],
};

/** Mail: not plates but a hanging weight of rings. */
export const MAIL: GearPiece = {
  name: 'mail', at: 'torso', drape: 0.3,
  parts: [
    { a: [0.15, 0.5, 0], b: [0.1, -0.75, 0], r: 0.86, color: '#6e747c' },
    { a: [0.1, -0.7, 0.35], b: [0.08, -1.05, 0.4], r: 0.4, color: '#61666d' },
    { a: [0.1, -0.7, -0.35], b: [0.08, -1.05, -0.4], r: 0.4, color: '#61666d' },
  ],
};

/** A wide brim. Reads instantly at any zoom, which is most of the job. */
export const WIDE_HAT: GearPiece = {
  name: 'wide hat', at: 'head',
  parts: [
    { a: [0.05, 0.34, 0.85], b: [0.05, 0.34, -0.85], r: 0.24, color: '#4a3f33' },
    { a: [0.85, 0.34, 0], b: [-0.75, 0.34, 0], r: 0.24, color: '#4a3f33' },
    { a: [0, 0.36, 0], b: [-0.05, 0.85, 0], r: 0.45, color: '#564939' },
  ],
};

export const WITCH_HAT: GearPiece = {
  name: 'pointed hat', at: 'head',
  parts: [
    { a: [0.05, 0.34, 0.8], b: [0.05, 0.34, -0.8], r: 0.22, color: '#2f2b3c' },
    { a: [0.8, 0.34, 0], b: [-0.7, 0.34, 0], r: 0.22, color: '#2f2b3c' },
    { a: [0, 0.4, 0], b: [-0.35, 1.7, 0], r: 0.3, color: '#3a3550' },
  ],
};

export const MASK: GearPiece = {
  name: 'mask', at: 'head',
  parts: [
    { a: [0.45, 0.12, 0.28], b: [0.45, 0.12, -0.28], r: 0.34, color: '#cfc6b0' },
    { a: [0.5, 0.3, 0.16], b: [0.52, 0.06, 0.18], r: 0.09, color: '#2b2722' },
    { a: [0.5, 0.3, -0.16], b: [0.52, 0.06, -0.18], r: 0.09, color: '#2b2722' },
  ],
};

/** A veil: the only head piece that is properly cloth. */
export const VEIL: GearPiece = {
  name: 'veil', at: 'head', drape: 0.9,
  parts: [
    { a: [-0.1, 0.3, 0], b: [-0.35, -0.9, 0], r: 0.6, color: '#4c4450' },
    { a: [-0.3, -0.8, 0], b: [-0.45, -1.5, 0], r: 0.4, color: '#443c48' },
  ],
};

/**
 * The words say what it is wearing. Ordered so the specific wins: a horned
 * helm before a helm, a hood before a cloak.
 */
export function gearFromWords(desc: string): GearPiece[] {
  const d = desc.toLowerCase();
  const out: GearPiece[] = [];
  const has = (re: RegExp) => re.test(d);

  // HEAD — the specific wins over the general, always
  if (has(/horned helm|horned helmet|viking|berserker|barbarian chief/)) out.push(HORNED_HELM);
  else if (has(/pointed hat|witch hat|wizard hat|conical hat|sorcer|warlock|witch\b/)) out.push(WITCH_HAT);
  else if (has(/wide[- ]brim|broad[- ]brim|straw hat|sun hat|\bhat\b|gunslinger|farmer|scarecrow/)) out.push(WIDE_HAT);
  else if (has(/\bmask|masked|plague doctor|carnival|porcelain face/)) out.push(MASK);
  else if (has(/\bveil|veiled|widow|mourner|bride/)) out.push(VEIL);
  else if (has(/helm|helmet|visor|knight|paladin|templar|man-at-arms|guard\b|legion/)) out.push(HELM);
  else if (has(/hood|hooded|cowl|cloaked|robed|monk|assassin|ranger|rogue|cultist|acolyte|necromancer|wizard|witch/)) out.push(HOOD);
  if (has(/plume|crest|crested|centurion|champion/)) out.push(CREST);

  // SHOULDERS — armour or fur, and a creature may wear both
  if (has(/pauldron|spaulder|armoured|armored|plate|knight|paladin|templar|golem|juggernaut/)) out.push(PAULDRON);
  if (has(/mantle|fur|pelt|feathered|shaman|chieftain|jarl|druid/)) out.push(MANTLE);

  // TORSO — one layer only, heaviest claim first
  if (has(/robe|robed|wizard|sorcer|warlock|monk|priest|cleric|acolyte|scholar/)) out.push(ROBE);
  else if (has(/tabard|surcoat|crusad|herald|order of/)) out.push(TABARD);
  else if (has(/chainmail|chain mail|\bmail\b|hauberk|ringmail/)) out.push(MAIL);
  else if (has(/plate|breastplate|armour|armor|armoured|armored|cuirass|knight|paladin|templar/)) out.push(PLATE);
  else if (has(/rags|ragged|tattered|beggar|peasant|zombie|ghoul|wretch|starv/)) out.push(RAGS);
  else if (has(/scarf|muffler|aviator|courier/)) out.push(SCARF);
  if (has(/gorget|full plate|knight|paladin/)) out.push(GORGET);

  // BACK — the thing that streams behind it
  if (has(/cloak|cape|mantle|shroud|caped|vampire|highwayman/)) out.push(CLOAK);
  if (has(/shell|carapace|tortoise|turtle|beetle|crab|armoured back/)) out.push(SHELL);
  if (has(/banner|standard|war ?flag|herald|crusad/)) out.push(BANNER);
  if (has(/\bpack\b|backpack|rucksack|knapsack|travell?er|wanderer|nomad|pilgrim|merchant|peddler/)) out.push(PACK);

  // WAIST and HIP
  if (has(/skirt|kilt|dress|gown|robed|priestess/)) out.push(SKIRT);
  else if (has(/sash|obi|samurai|ronin|corsair|pirate/)) out.push(SASH);
  else if (has(/satchel|\bbag\b|courier|scavenger|looter/)) out.push(SATCHEL);
  else if (has(/\bbelt\b|girdle|bandolier|pouch|utility/)) out.push(BELT);
  if (has(/tasset|faulds|full plate|knight|paladin|templar|juggernaut/)) out.push(TASSETS);

  // LIMBS
  if (has(/greave|shin ?guard|boots|armoured legs|knight|paladin|juggernaut|legion/)) out.push(GREAVES);
  if (has(/bracer|vambrace|gauntlet|wrist|archer|ranger|duellist|duelist/)) out.push(BRACERS);

  // one of each anchor, so nothing wears two helmets
  const seen = new Set<Anchor>();
  return out.filter(g => (g.at === 'shoulder' || !seen.has(g.at)) && (seen.add(g.at), true));
}
