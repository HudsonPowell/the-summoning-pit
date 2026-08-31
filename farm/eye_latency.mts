import { readFileSync, readdirSync } from 'node:fs';
import { pickByEye } from '../src/taste';
const files = readdirSync('farm/out/taste').filter(f => f.endsWith('.json'));
const g = (n: string) => JSON.parse(readFileSync('farm/out/taste/' + n, 'utf8'));
const pairs: [string, string][] = [
  ['70B_hooded_pale_hunter_with_a_ta.json', 'V4_Pro_crowned_moth_queen_with_four.json'],
  ['biped.json', 'V4_Pro_rust_armoured_toad_king_trai.json'],
  ['hound.json', 'V4_Pro_hooded_pale_hunter_with_a_ta.json'],
  ['70B_censer_priest_swinging_green.json', 'V4_Pro_censer_priest_swinging_green.json'],
  ['shrine.json', 'V4_Pro_crowned_moth_queen_with_four.json'],
  ['lasher.json', 'V4_Pro_rust_armoured_toad_king_trai.json'],
];
const ts: number[] = [];
for (const [a, b] of pairs) {
  if (!files.includes(a) || !files.includes(b)) continue;
  const t0 = Date.now();
  const pick = await pickByEye([g(a), g(b)], 'a creature', 20000);
  const el = Date.now() - t0; ts.push(el);
  console.log(`${a.slice(0, 26).padEnd(28)} vs ${b.slice(0, 26).padEnd(28)} ${(el/1000).toFixed(1)}s -> ${pick === 0 ? 'first (good)' : pick === 1 ? 'SECOND (mess)' : 'no answer'}`);
}
ts.sort((x, y) => x - y);
console.log(`eye latency: p50 ${(ts[ts.length>>1]/1000).toFixed(1)}s  max ${(ts[ts.length-1]/1000).toFixed(1)}s`);
process.exit(0);
