// Render contact sheets for the three canonical moods. Sanity check for the
// headless pipeline: if these look like the studio, the farm sees what we see.

import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultBiped } from '../src/genome';
import { renderSheet } from './lib';

mkdirSync('farm/out', { recursive: true });

const genome = defaultBiped();
const moods = {
  neutral: { tired: 0, angry: 0 },
  tired: { tired: 1, angry: 0 },
  angry: { tired: 0, angry: 1 },
};

for (const [name, mood] of Object.entries(moods)) {
  const png = renderSheet(genome, mood);
  writeFileSync(`farm/out/${name}.png`, png);
  console.log(`farm/out/${name}.png`);
}
