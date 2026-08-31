// How long a hosted summon actually takes, split into its parts.
import { hatchGenome } from '../src/hatch';
import { pickByEye, anatomyOf } from '../src/taste';
const P = ['a hooded pale hunter with a tall silver longbow', 'a censer priest swinging green smoke on a chain'];
for (const desc of P) {
  const t0 = Date.now();
  const pair = await Promise.allSettled([
    hatchGenome(desc, undefined, undefined, undefined, 0.8),
    hatchGenome(desc, undefined, undefined, undefined, 0.95),
  ]);
  const g = pair.filter(p => p.status === 'fulfilled').map((p: any) => p.value);
  const tHatch = Date.now() - t0;
  const t1 = Date.now();
  let eye: number | null = null;
  if (g.length === 2) eye = await pickByEye([g[0], g[1]], desc);
  const tEye = Date.now() - t1;
  const t2 = Date.now(); anatomyOf(g[0]); const tAnat = Date.now() - t2;
  console.log(`${desc.slice(0, 34).padEnd(36)} hatch ${(tHatch/1000).toFixed(1)}s  eye ${(tEye/1000).toFixed(1)}s  anatomy ${tAnat}ms  TOTAL ${((tHatch+tEye)/1000).toFixed(1)}s  (${g.length}/2 hatched, eye said ${eye})`);
}
process.exit(0);
