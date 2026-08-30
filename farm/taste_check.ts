// Calibrate the pit's taste: for each prompt, hatch one candidate from the
// good model and one from a known mess-maker, and check the judge picks the
// good one. 5/5 on 2026-08-31 (see CALIBRATION.md).
//   HATCH_API_KEY=... HATCH_API_URL=... npx tsx farm/taste_check.ts
import { anatomyOf, pickBest } from '../src/taste';
import { hatchGenome } from '../src/hatch';
import { defaultBiped, hound, walkingShrine, drifter, lasher } from '../src/genome';

const PROMPTS = [
  'a hooded pale hunter with a tall silver longbow',
  'a rust-armoured toad king trailing a moth-eaten cloak',
  'a censer priest swinging green smoke on a chain',
  'a crowned moth queen with four wings and a curved horn bow',
];
const GOOD = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
const MESSY = 'deepseek-ai/DeepSeek-V4-Pro-0813';

console.log('--- known-good bodies (anatomy only)');
for (const [name, mk] of [['biped', defaultBiped], ['hound', hound], ['shrine', walkingShrine], ['drifter', drifter], ['lasher', lasher]] as const) {
  const a = anatomyOf(JSON.parse(JSON.stringify(mk())));
  console.log(`${name.padEnd(10)} anatomy ${a.score.toFixed(2)} (conn ${a.connected.toFixed(2)} gnd ${a.grounded ? 'y' : 'N'})`);
}

console.log('--- judged pairs (good vs messy, shuffled)');
let right = 0, ran = 0;
for (const p of PROMPTS) {
  try {
    const [good, messy] = await Promise.all([
      hatchGenome(p, GOOD, undefined, undefined, 0.85),
      hatchGenome(p, MESSY, undefined, undefined, 0.85),
    ]);
    const goodFirst = Math.random() < 0.5;
    const pair = goodFirst ? [good, messy] : [messy, good];
    const pick = await pickBest(pair, p);
    const choseGood = (pick === 0) === goodFirst;
    ran++; right += choseGood ? 1 : 0;
    console.log(`${p.slice(0, 44).padEnd(46)} -> ${choseGood ? 'chose the good one' : 'CHOSE THE MESS'}`);
  } catch (e: any) {
    console.log(`${p.slice(0, 44)} FAILED ${String(e?.message ?? e).slice(0, 50)}`);
  }
}
console.log(`${right}/${ran}`);
process.exit(0);
