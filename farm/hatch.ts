// CLI wrapper around the shared hatch pipeline (src/hatch.ts), plus the
// CLIP reviewer and file output. The studio has the same hatch box in-UI.
//
// Usage: npm run hatch -- "a cowardly bog troll with one huge arm"
// Needs: ollama serve running, with the model pulled.

import { mkdirSync, writeFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';
import { hatchGenome, HATCH_MODEL } from '../src/hatch';
import { renderSheet } from './lib';

const description = process.argv[2];
if (!description) {
  console.error('usage: npm run hatch -- "<creature description>"');
  process.exit(1);
}

mkdirSync('farm/out/hatch', { recursive: true });
console.log(`hatching: "${description}" via ${process.env.HATCH_MODEL ?? HATCH_MODEL}...`);

const genome = await hatchGenome(description, process.env.HATCH_MODEL ?? HATCH_MODEL);

const slug = genome.name.replace(/[^a-z0-9-]/gi, '');
writeFileSync(`genomes/${slug}.json`, JSON.stringify(genome, null, 2));
const sheetPath = `farm/out/hatch/${slug}.png`;
writeFileSync(sheetPath, renderSheet(genome, { tired: 0, angry: 0 }));

// the reviewer: does the walking result read as the description?
const classify = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
const out = (await classify(sheetPath, [
  `pixel art of ${description}`,
  'pixel art of a generic humanoid figure',
])) as { label: string; score: number }[];
const score = out[0].label.includes('generic') ? out[1].score : out[0].score;

console.log(`\nhatched -> genomes/${slug}.json`);
console.log(`sheet   -> ${sheetPath}`);
console.log(`chains  -> ${genome.skeleton.chains.map(c => `${c.role}@${c.at.toFixed(2)}`).join(', ')} ${genome.skeleton.locomotion}`);
console.log(`judge   -> reads-as-description ${score.toFixed(3)} (vs generic humanoid)`);
