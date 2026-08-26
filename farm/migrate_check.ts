// Every creature ever saved must still load. v1, v2 and v3 all land in v3.
import { readdirSync, readFileSync } from 'node:fs';
import { migrateGenome, heightOf } from '../src/genome';
import { migrateCharacter } from '../src/character';
import { solvePose } from '../src/pose';

let ok = 0, bad = 0;
for (const dir of ['genomes', 'characters']) {
  let files: string[] = [];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
      const g = dir === 'characters' ? migrateCharacter(raw).genome : migrateGenome(raw);
      const caps = solvePose(g, { tired: 0, angry: 0 }, 0.2);
      const h = heightOf(g);
      if (!caps.length || !isFinite(h) || h <= 0) throw new Error('degenerate');
      for (const c of caps) if (!isFinite(c.a.x) || !isFinite(c.b.y)) throw new Error('NaN joint');
      ok++;
    } catch (e) {
      bad++;
      console.log(`  FAIL ${dir}/${f}: ${(e as Error).message}`);
    }
  }
}
console.log(`${ok} creatures migrate and pose cleanly, ${bad} broken`);
process.exit(bad === 0 ? 0 : 1);
