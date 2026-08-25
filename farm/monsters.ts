// Contact sheets for the authored monsters.
import { mkdirSync, writeFileSync } from 'node:fs';
import { imp, hound, troll, ogre } from '../src/genome';
import { renderSheet } from './lib';

mkdirSync('farm/out', { recursive: true });
for (const make of [imp, hound, troll, ogre]) {
  const g = make();
  writeFileSync(`farm/out/${g.name}.png`, renderSheet(g, { tired: 0, angry: 0 }));
  console.log(`farm/out/${g.name}.png`);
}
