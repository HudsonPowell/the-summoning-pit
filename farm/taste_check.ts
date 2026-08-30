// Calibrate the pit's taste: score known-good bodies, 70B hatches and
// V4-Pro's abstract messes with both layers. The good and the bad must
// separate or the judge is noise. Constants go to CALIBRATION.md.
//   HATCH_API_KEY=... HATCH_API_URL=... npx tsx farm/taste_check.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { anatomyOf, tasteScores, warmTaste, tasteReady, renderCandidate } from '../src/taste';
import { hatchGenome } from '../src/hatch';
import { defaultBiped, hound, walkingShrine, drifter, lasher, Genome } from '../src/genome';

mkdirSync('farm/out/taste', { recursive: true });
function keep(label: string, g: Genome) {
  const slug = label.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  const rgba = renderCandidate(g);
  const png = new PNG({ width: 224, height: 224 });
  png.data.set(rgba);
  writeFileSync(`farm/out/taste/${slug}.png`, PNG.sync.write(png));
  writeFileSync(`farm/out/taste/${slug}.json`, JSON.stringify(g));
}

const PROMPTS = [
  'a hooded pale hunter with a tall silver longbow',
  'a rust-armoured toad king trailing a moth-eaten cloak',
  'a censer priest swinging green smoke on a chain',
  'a crowned moth queen with four wings and a curved horn bow',
];

warmTaste();
while (!tasteReady()) await new Promise(r => setTimeout(r, 500));

async function judge(label: string, g: Genome, desc?: string) {
  keep(label, g);
  const a = anatomyOf(g);
  const [total] = await tasteScores([g], desc);
  console.log(`${label.padEnd(34)} anatomy ${a.score.toFixed(2)} (conn ${a.connected.toFixed(2)} gnd ${a.grounded ? 'y' : 'N'} fig ${a.figure.toFixed(2)})  total ${total.toFixed(2)}`);
  return { anatomy: a.score, total };
}

console.log('--- known-good bodies');
const goods: number[] = [];
for (const [name, mk] of [['biped', defaultBiped], ['hound', hound], ['shrine', walkingShrine], ['drifter', drifter], ['lasher', lasher]] as const) {
  goods.push((await judge(name, JSON.parse(JSON.stringify(mk())))).total);
}

for (const [tag, model] of [['70B', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'], ['V4-Pro', 'deepseek-ai/DeepSeek-V4-Pro-0813']] as const) {
  console.log(`--- ${tag} hatches`);
  for (const p of PROMPTS) {
    try {
      const g = await hatchGenome(p, model, undefined, undefined, 0.85);
      await judge(`${tag}: ${p.slice(2, 30)}`, g, p);
    } catch (e: any) {
      console.log(`${tag}: ${p.slice(2, 30)} FAILED ${String(e?.message ?? e).slice(0, 40)}`);
    }
  }
}
console.log(`good floor: ${Math.min(...goods).toFixed(2)}`);
process.exit(0);
