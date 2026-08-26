// Fifty proper fantasy summons — heroes and beasts, the things this is
// actually for. The stress harness asks "does it survive?"; this one asks
// "is it any good?".
//
// Note what is burned into the sheet: the creature's NAME, not the prompt.
// The prompt is the summoner's business (see src/naming.ts) — it never
// reaches the genome, the wire, or a filename. The prompt→name mapping stays
// in the local report so we can judge the hatcher, and goes no further.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { hatchGenome } from '../src/hatch';
import { migrateGenome, heightOf, Genome } from '../src/genome';
import { makeCharacter } from '../src/character';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';
import { drawText, wrap } from './font';
import { fileNameFor } from '../src/naming';

const HEROES = [
  'a knight in heavy plate with a greatsword',
  'a hooded ranger with a longbow',
  'a dwarven axemaster with a braided beard',
  'an elven duellist with a slender rapier',
  'a battle-priest with a warhammer and a shield',
  'a lithe assassin with twin daggers',
  'a horned barbarian chieftain with a great axe',
  'a robed sorcerer with a crooked staff',
  'a bear-cloaked shieldmaiden with a spear',
  'a lizardfolk spearman with a crested head',
  'a gaunt necromancer with a bone wand',
  'a heavy-set siege engineer with a maul',
  'a winged celestial with a shining sword',
  'a beast-blooded monk with clawed fists',
  'a swashbuckling pirate captain with a cutlass',
  'a stone-skinned golem knight with a slab shield',
  'a desert nomad with a curved scimitar',
  'a plague doctor with a long-beaked mask and a cane',
  'a young squire with a battered shortsword',
  'a witch-hunter with a crossbow and a wide hat',
];

const BEASTS = [
  'a dire wolf with a thick ruff',
  'a mountain troll with long arms and a small head',
  'a two-headed ogre with a club',
  'a wyvern with leathery wings and a barbed tail',
  'a giant cave spider with eight legs',
  'a basilisk with a long scaled body',
  'a chimera with a lion body and a goat head',
  'a swamp hydra with three heads on long necks',
  'a horned minotaur with a great axe',
  'a griffin with an eagle head and lion legs',
  'an armoured beetle the size of a horse',
  'a giant scorpion with a raised tail',
  'a shambling bog mound with drooping arms',
  'a skeletal warhorse',
  'a bat-winged imp with a forked tail',
  'a frost giant with a club of ice',
  'a sabre-toothed cat',
  'a rotting ghoul with long fingers',
  'a stag-headed forest spirit with antlers',
  'an enormous toad with a wide mouth',
  'a coiled serpent with a hooded head',
  'a six-legged desert strider',
  'a crab-beast with two great pincers',
  'a hulking gorilla-beast with knuckles like anvils',
  'a fire drake with short wings and a heavy jaw',
  'a pale cave-crawler with no eyes and long limbs',
  'a war rhinoceros with plated hide',
  'an eel-like river horror with fins',
  'a moth-winged creature with feathered antennae',
  'a great horned owl-beast with talons',
];

const PROMPTS: [string, string][] = [
  ...HEROES.map(p => ['hero', p] as [string, string]),
  ...BEASTS.map(p => ['beast', p] as [string, string]),
];

const CELL = 260, LABEL = 26, CELL_H = CELL + LABEL, COLS = 7;
const RUNS = 'farm/out/roster';
mkdirSync(RUNS, { recursive: true });
const RUN_LABEL = (process.argv[2] ?? 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) || 'run';
const SEQ = readdirSync(RUNS).filter(d => /^\d{3}-/.test(d)).length + 1;
const OUT = `${RUNS}/${String(SEQ).padStart(3, '0')}-${RUN_LABEL}`;
mkdirSync(OUT, { recursive: true });

interface Row { cat: string; prompt: string; name: string; ok: boolean; note: string; ms: number; chains: string; locomotion: string; height: number; }

const renderer = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const rows: Row[] = [];
const cells: { data: Uint8ClampedArray; label: string; ok: boolean }[] = [];

const blank = () => {
  const d = new Uint8ClampedArray(CELL * CELL * 4);
  for (let i = 0; i < CELL * CELL; i++) { d[i*4]=10; d[i*4+1]=8; d[i*4+2]=14; d[i*4+3]=255; }
  return d;
};

for (let i = 0; i < PROMPTS.length; i++) {
  const [cat, prompt] = PROMPTS[i];
  const t0 = Date.now();
  let ok = false, note = '', chains = '-', locomotion = '-', height = 0, name = '-';
  let cell = blank();
  try {
    const g: Genome = migrateGenome(await hatchGenome(prompt));
    const caps = solvePose(g, { tired: 0, angry: 0 }, 0.2, 1, 0, undefined, 0,
      { weapon: makeCharacter(g).weapon, offhand: makeCharacter(g).offhand });
    height = heightOf(g);
    name = g.name;
    if (!caps.length) throw new Error('no body');
    for (const c of caps) {
      if (![c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z, c.r].every(Number.isFinite))
        throw new Error('NaN joint');
    }
    if (!Number.isFinite(height) || height <= 0.05) throw new Error('degenerate height');
    chains = g.skeleton.chains.map(c => c.role[0]).join('');
    locomotion = g.skeleton.locomotion;
    // Frame the creature we actually got, not the one we assumed. Zooming by
    // height alone made every long animal overflow sideways and read as a
    // plank — a framing bug that looked exactly like a modelling bug. Measured
    // as a radius in the ground plane, so the fit holds at any yaw.
    let reach = 0.2, minY = Infinity, maxY = -Infinity;
    for (const c of caps) for (const pt of [c.a, c.b]) {
      reach = Math.max(reach, Math.hypot(pt.x, pt.z) + c.r);
      minY = Math.min(minY, pt.y - c.r); maxY = Math.max(maxY, pt.y + c.r);
    }
    const cam: Camera = {
      yaw: 0.5, pitch: 0.22,
      ppm: (CELL * 0.86) / Math.max(reach * 2, maxY - minY),
      cy: (minY + maxY) / 2,
      floor: false, blend: 1.1, blendShape: 0.5, blendMix: 1,
      voidColor: [10, 8, 14],
    };
    renderer.render(buf, caps, cam, 0);
    cell = new Uint8ClampedArray(buf);
    ok = true;
    note = `${g.skeleton.chains.length} chains`;
    // the creatures themselves are kept — a shelf, not just a picture of one
    writeFileSync(`${OUT}/${String(i+1).padStart(2,'0')}-${fileNameFor(g)}.json`,
      JSON.stringify(g, null, 2));
  } catch (e) {
    note = (e as Error).message.slice(0, 60);
  }
  const ms = Date.now() - t0;
  rows.push({ cat, prompt, name, ok, note, ms, chains, locomotion, height });
  cells.push({ data: cell, label: ok ? name : 'FAILED', ok });
  console.log(`${String(i+1).padStart(2)}/50 [${cat}] ${ok ? 'ok  ' : 'FAIL'} ${(ms/1000).toFixed(1)}s ${chains.padEnd(8)} ${name.padEnd(26)} ${prompt.slice(0, 40)}`);

  const one = new PNG({ width: CELL, height: CELL_H });
  for (let p = 0; p < CELL * CELL; p++) {
    one.data[p*4] = cell[p*4]; one.data[p*4+1] = cell[p*4+1];
    one.data[p*4+2] = cell[p*4+2]; one.data[p*4+3] = 255;
  }
  for (let p = CELL * CELL; p < CELL * CELL_H; p++) {
    one.data[p*4] = 6; one.data[p*4+1] = 6; one.data[p*4+2] = 9; one.data[p*4+3] = 255;
  }
  wrap(cells[i].label, CELL - 10, 1).forEach((line, li) =>
    drawText(one.data, CELL, CELL_H, line, 5, CELL + 6 + li * 9,
      ok ? [196, 186, 160] : [213, 87, 59], 1));
  writeFileSync(`${OUT}/${String(i+1).padStart(2,'0')}-${cat}.png`, PNG.sync.write(one));
}

const ROWS = Math.ceil(cells.length / COLS);
const sheet = new PNG({ width: CELL * COLS, height: CELL_H * ROWS });
cells.forEach((c, i) => {
  const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * CELL_H;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const s = (y * CELL + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = c.data[s]; sheet.data[d+1] = c.data[s+1];
    sheet.data[d+2] = c.data[s+2]; sheet.data[d+3] = 255;
  }
  for (let y = CELL; y < CELL_H; y++) for (let x = 0; x < CELL; x++) {
    const d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = 6; sheet.data[d+1] = 6; sheet.data[d+2] = 9; sheet.data[d+3] = 255;
  }
  wrap(c.label, CELL - 10, 1).forEach((line, li) =>
    drawText(sheet.data, sheet.width, sheet.height, line, ox + 5, oy + CELL + 6 + li * 9,
      c.ok ? [196, 186, 160] : [213, 87, 59], 1));
});
writeFileSync(`${OUT}/_sheet.png`, PNG.sync.write(sheet));

const okCount = rows.filter(r => r.ok).length;
writeFileSync(`${OUT}/_report.md`, [
  `# roster: ${okCount}/${rows.length}`,
  '',
  'The prompt column exists ONLY here, in the local farm, so the hatcher can be',
  'judged. It is not on the genome, not in a filename, and never on the wire.',
  '',
  '| # | cat | prompt | name | chains | locomotion | height | ms |',
  '|---|-----|--------|------|--------|------------|--------|----|',
  ...rows.map((r, i) => `| ${i+1} | ${r.cat} | ${r.prompt} | ${r.ok ? r.name : 'FAIL ' + r.note} | ${r.chains} | ${r.locomotion} | ${r.height.toFixed(2)} | ${r.ms} |`),
].join('\n'));
console.log(`\n${okCount}/${rows.length}. sheet: ${OUT}/_sheet.png`);
