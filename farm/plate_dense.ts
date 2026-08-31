// The reduced plate, at full density: every stage the system actually has,
// wired. Same language as before — black page, one rule weight, one colour,
// one face at one size, one box — but the whole machine rather than its spine.
//
// Generated rather than hand-drawn: fifty-odd boxes and a hundred wires is
// more coordinates than anyone should type, and a mistyped one is a lie.
//   npx tsx farm/plate_dense.ts
import { writeFileSync } from 'node:fs';

type Node = { id: string; label: string };
type Col = { head: string; x: number; nodes: Node[] };

const BW = 158, BH = 40, VGAP = 17, COLGAP = 40;
const X0 = 74, Y0 = 250;

const COLUMNS: { head: string; nodes: [string, string][] }[] = [
  { head: 'ASKED', nodes: [
    ['box', 'SUMMON BOX'], ['key', 'KEY'], ['pact', 'PACT'], ['gap', 'COOLDOWN 2S'],
  ]},
  { head: 'COMPOSED', nodes: [
    ['schema', 'JSON SCHEMA'], ['a', '70B · A'], ['b', '70B · B'],
    ['arm', 'ARMOURY'], ['gear', 'GEAR WORDS'], ['breath', 'BREATH WORDS'],
  ]},
  { head: 'JUDGED', nodes: [
    ['draw', 'RENDER 224'], ['eye', 'THE EYE'], ['anat', 'ANATOMY'],
    ['conn', 'CONNECTED'], ['gnd', 'GROUNDED'], ['stray', 'STRAY PARTS'],
  ]},
  { head: 'PRICED', nodes: [
    ['vol', 'VOLUME'], ['tempo', 'TEMPO·REACH'], ['shot', 'SHOT POWER'],
    ['mass', 'MASS BAND'], ['floor2', 'DURATION'],
  ]},
  { head: 'GUARDED', nodes: [
    ['san', 'SANITISE'], ['clamp', 'CLAMP'], ['white', 'WHITELIST'], ['mig', 'MIGRATE'],
  ]},
  { head: 'ALIVE', nodes: [
    ['tick', 'TICK 30HZ'], ['wander', 'WANDER'], ['think', 'THINK'], ['appr', 'APPROACH'],
    ['fight', 'FIGHT'], ['flee', 'FLEE'], ['rest', 'REST'], ['down', 'DOWN'],
  ]},
  { head: 'FOUGHT', nodes: [
    ['strike', 'STRIKE'], ['guard', 'GUARD'], ['feint', 'FEINT'], ['inter', 'INTERRUPT'],
    ['rip', 'RIPOSTE'], ['spot', 'SPOT · IK'], ['scar', 'SCARS'], ['deed', 'DEEDS'],
  ]},
  { head: 'KEPT', nodes: [
    ['relic', 'RELICS'], ['flora', 'FLORA'], ['ledger', 'LEDGER'],
    ['save', 'SAVE 5S'], ['ident', 'IDENTITY'], ['beat', 'HEARTBEAT'],
  ]},
  { head: 'SENT', nodes: [
    ['snap', 'SNAP 15HZ'], ['ev', 'EVENTS'], ['cast', 'CAST ONCE'],
  ]},
  { head: 'DRAWN', nodes: [
    ['clock', 'CLOCK 0.45'], ['lerp', 'INTERPOLATE'], ['pose', 'POSE · IK'],
    ['sec', 'SECONDARY'], ['field', 'THE FIELD'], ['blend', 'SMOOTH MIN'],
    ['line', 'OUTLINES'], ['ground', 'GROUND'], ['gov', 'GOVERNOR'], ['cam', 'CAMERA'],
  ]},
];

const EDGES: [string, string][] = [
  ['box', 'schema'], ['key', 'ident'], ['pact', 'ident'], ['gap', 'box'],
  ['schema', 'a'], ['schema', 'b'],
  ['arm', 'a'], ['gear', 'a'], ['breath', 'a'], ['arm', 'b'], ['gear', 'b'], ['breath', 'b'],
  ['a', 'draw'], ['b', 'draw'],
  ['draw', 'eye'], ['draw', 'anat'],
  ['conn', 'anat'], ['gnd', 'anat'], ['stray', 'anat'],
  ['eye', 'vol'], ['anat', 'vol'],
  ['vol', 'san'], ['tempo', 'san'], ['shot', 'san'], ['mass', 'san'], ['floor2', 'san'],
  ['san', 'clamp'], ['clamp', 'white'], ['white', 'mig'], ['mig', 'tick'],
  ['tick', 'wander'], ['wander', 'think'], ['think', 'appr'], ['appr', 'fight'],
  ['fight', 'flee'], ['flee', 'rest'], ['fight', 'down'],
  ['fight', 'strike'], ['strike', 'guard'], ['guard', 'feint'], ['feint', 'inter'],
  ['inter', 'rip'], ['strike', 'spot'], ['down', 'scar'], ['down', 'deed'],
  ['deed', 'scar'],
  ['down', 'relic'], ['tick', 'flora'], ['deed', 'ledger'], ['ledger', 'save'],
  ['relic', 'save'], ['flora', 'save'], ['ident', 'beat'],
  ['tick', 'snap'], ['strike', 'ev'], ['guard', 'ev'], ['down', 'ev'],
  ['relic', 'snap'], ['flora', 'snap'], ['scar', 'snap'], ['mig', 'cast'],
  ['snap', 'clock'], ['clock', 'lerp'], ['ev', 'lerp'], ['cast', 'pose'],
  ['lerp', 'pose'], ['pose', 'sec'], ['sec', 'field'], ['pose', 'field'],
  ['field', 'blend'], ['blend', 'line'], ['line', 'ground'], ['gov', 'cam'],
  ['cam', 'field'], ['gov', 'field'],
  // the state machine's real returns, and the combat triangle closing on itself
  ['rest', 'wander'], ['flee', 'wander'], ['wander', 'rest'], ['think', 'wander'],
  ['guard', 'rip'], ['feint', 'strike'], ['spot', 'strike'], ['inter', 'fight'],
  ['rip', 'strike'], ['guard', 'strike'],
  ['ev', 'pose'], ['blend', 'ground'], ['field', 'line'],
  ['ident', 'snap'], ['save', 'tick'], ['beat', 'snap'],
];

// ---- lay out ---------------------------------------------------------------
const cols: Col[] = COLUMNS.map((c, i) => ({
  head: c.head,
  x: X0 + i * (BW + COLGAP),
  nodes: c.nodes.map(([id, label]) => ({ id, label })),
}));
const at = new Map<string, { x: number; y: number; col: number }>();
cols.forEach((c, ci) => c.nodes.forEach((n, ri) => {
  at.set(n.id, { x: c.x, y: Y0 + ri * (BH + VGAP), col: ci });
}));

const W = X0 + cols.length * (BW + COLGAP) - COLGAP + X0;
const tallest = Math.max(...cols.map(c => c.nodes.length));
const UNDER = Y0 + tallest * (BH + VGAP) + 30;   // the return bus
const H = UNDER + 200;

const out: string[] = [];
const push = (s: string) => out.push('  ' + s);

// wires first, so boxes sit on top of them and the joins read clean
for (const [from, to] of EDGES) {
  const f = at.get(from), t = at.get(to);
  if (!f || !t) { console.error('unknown node', from, to); continue; }
  if (t.col > f.col) {
    // forward: out of the right face, along a bus in the gutter, into the left
    const x1 = f.x + BW, y1 = f.y + BH / 2;
    const x2 = t.x, y2 = t.y + BH / 2;
    const bus = x1 + COLGAP / 2 + ((from.length * 7) % (COLGAP / 2 - 6)) - 4;
    push(`<path class="r" d="M${x1},${y1} H${bus} V${y2} H${x2}"/>`);
  } else if (t.col === f.col) {
    // within a column: down the left margin and back in
    const side = f.x - 13;
    push(`<path class="r" d="M${f.x},${f.y + BH / 2} H${side} V${t.y + BH / 2} H${t.x}"/>`);
  } else {
    // backward: under the row, returning
    const x1 = f.x, y1 = f.y + BH / 2, x2 = t.x + BW, y2 = t.y + BH / 2;
    const under = UNDER;
    push(`<path class="r" d="M${x1},${y1} H${x1 - 20} V${under} H${x2 + 20} V${y2} H${x2}"/>`);
  }
}
// boxes and their names
cols.forEach(c => {
  push(`<text class="t" x="${c.x}" y="${Y0 - 34}">${c.head}</text>`);
  c.nodes.forEach(n => {
    const p = at.get(n.id)!;
    push(`<rect class="r f" x="${p.x}" y="${p.y}" width="${BW}" height="${BH}"/>`);
    push(`<text class="t" x="${p.x + 12}" y="${p.y + BH / 2 + 4}">${n.label}</text>`);
  });
});

const svg = `<title>The Whole Machine</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Michroma&display=swap">
<style>
  :root { --ink:#ffffff; --page:#000000; }
  html, body { margin:0; background:var(--page); }
  svg { display:block; width:100%; height:auto; }
  .r { stroke:var(--ink); stroke-width:1; fill:none; }
  .f { fill:var(--page); }
  .t { font-family:Michroma,Helvetica,Arial,sans-serif; font-size:10px;
       letter-spacing:.1em; fill:var(--ink); text-transform:uppercase; }
</style>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The Summoning Pit: every stage of the system, wired.">
  <rect class="r" x="34" y="34" width="${W - 68}" height="${H - 68}"/>
  <text class="t" x="${X0}" y="120">THE SUMMONING PIT</text>
  <text class="t" x="${W - X0}" y="120" text-anchor="end">THE WHOLE MACHINE</text>
  <line class="r" x1="${X0}" y1="150" x2="${W - X0}" y2="150"/>
  <text class="t" x="${X0}" y="186">${cols.reduce((n, c) => n + c.nodes.length, 0)} STAGES · ${EDGES.length} CONNECTIONS · ONE AUTHORITY</text>
${out.join('\n')}
  <line class="r" x1="${X0}" y1="${H - 150}" x2="${W - X0}" y2="${H - 150}"/>
  <text class="t" x="${X0}" y="${H - 110}">THE MODEL COMPOSES · THE ENGINE BUDGETS · THE SERVER DECIDES · EVERY SCREEN AGREES</text>
  <text class="t" x="${X0}" y="${H - 80}">PROMPTS ARE NEVER STORED, LOGGED OR EXPOSED</text>
</svg>
`;
writeFileSync('public/pit-dense.html', `<!doctype html><html><head><meta charset="utf-8">${svg}</head></html>`);
console.log(`public/pit-dense.html — ${cols.reduce((n, c) => n + c.nodes.length, 0)} boxes, ${EDGES.length} wires, ${W}x${H}`);
