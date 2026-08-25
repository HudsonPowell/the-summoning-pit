// The judge: a local vision model scores motion against plain-language
// descriptions. If this works, "breed me something that moves like it's
// guilty" is a runnable command. This script is the validation experiment:
// three known walks x three descriptions — we want the diagonal to win.

import { pipeline } from '@huggingface/transformers';

const SHEETS = ['neutral', 'tired', 'angry'];

// Pairwise contrast: each quality is a two-way question, and the fitness of a
// walk on that quality is P(positive) against its opposite. Absolute scores
// from CLIP-family models are junk; contrasts are where the signal lives.
const AXES: { name: string; pos: string; neg: string }[] = [
  {
    name: 'tired',
    pos: 'a figure slumped over, hunched, head hanging down, shuffling wearily',
    neg: 'a figure standing tall and upright, striding energetically',
  },
  {
    name: 'angry',
    pos: 'a figure charging forward aggressively, leaning into it, fists raised to fight',
    neg: 'a figure strolling calmly and peacefully with arms relaxed at its sides',
  },
];

const classify = await pipeline(
  'zero-shot-image-classification',
  'Xenova/clip-vit-base-patch32',
);

const pad = (s: string, n: number) => s.padEnd(n);
console.log('\nP(quality) per walk — each column should peak on its own row\n');
console.log(pad('', 10) + AXES.map(a => pad(a.name, 10)).join(''));

const table: number[][] = [];
for (const sheet of SHEETS) {
  const row: number[] = [];
  for (const axis of AXES) {
    const out = (await classify(`farm/out/${sheet}.png`, [axis.pos, axis.neg])) as {
      label: string;
      score: number;
    }[];
    row.push(out.find(o => o.label === axis.pos)!.score);
  }
  table.push(row);
}
for (let r = 0; r < SHEETS.length; r++) {
  console.log(
    pad(SHEETS[r], 10) +
      table[r]
        .map((v, c) => {
          const best = Math.max(...table.map(row => row[c]));
          return pad(v.toFixed(3) + (v === best ? ' *' : '  '), 10);
        })
        .join(''),
  );
}
console.log('\n(* = the walk this axis scores highest — want tired* on tired row, angry* on angry row)');
