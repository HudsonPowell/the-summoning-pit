// Replay a client interpolation clock against a real wire and record u — the
// fraction between the two snapshots it is actually drawing. Healthy playback
// sweeps u across the middle continuously; pinned at 0 means the phone is
// being shown snapshot positions and nothing in between.
//   npx tsx farm/u_probe.mts [old|new] [url] [secs]
import WebSocket from 'ws';
const MODE = process.argv[2] ?? 'new';
const URL = process.argv[3] ?? 'wss://thesummoningpit.com';
const SECS = Number(process.argv[4] ?? 25);
const DELAY = 0.15;
const LAG = Number(process.env.LAG ?? 0.55);
const EASE = Number(process.env.EASE ?? 3);

let prev: any = null, next: any = null, clock = 0;
const us: number[] = [];
const ws = new WebSocket(URL);
ws.on('open', () => ws.send(JSON.stringify({ t: 'key' })));
ws.on('message', (raw: any) => {
  const m = JSON.parse(String(raw));
  if (!m.agents) return;
  prev = next;
  next = { at: performance.now() / 1000, time: m.time };
  if (!prev) { prev = next; clock = MODE === 'old' ? next.at - DELAY : next.time - 0.06; }
});

// real elapsed time, exactly as the render loop measures it — a fixed 1/60
// here drifts against a setInterval that fires late, and invents a lag the
// browser would never have
let lastFrame = performance.now();
const timer = setInterval(() => {
  const nowMs = performance.now();
  const dt = (nowMs - lastFrame) / 1000;
  lastFrame = nowMs;
  if (!prev || !next) return;
  let u: number;
  if (MODE === 'old') {
    clock += dt;
    clock += ((next.at - DELAY) - clock) * Math.min(1, dt * 4);
    const span = Math.max(1e-3, next.at - prev.at);
    u = Math.max(0, Math.min(1.3, (clock - prev.at) / span));
  } else {
    const span = Math.max(1e-3, next.time - prev.time);
    clock += dt;
    const target = next.time - span * LAG;
    if (Math.abs(target - clock) > span * 8) clock = target;
    else clock += (target - clock) * Math.min(1, dt * EASE);
    u = Math.max(0, Math.min(1.25, (clock - prev.time) / span));
  }
  us.push(u);
}, 1000 / 60);

await new Promise(r => setTimeout(r, SECS * 1000));
clearInterval(timer);
const pin0 = us.filter(u => u <= 0.001).length / us.length * 100;
const pinTop = us.filter(u => u >= 1.24).length / us.length * 100;
const mid = 100 - pin0 - pinTop;
const mean = us.reduce((a, b) => a + b, 0) / us.length;
console.log(`${MODE.toUpperCase()} clock on ${URL} — ${us.length} frames`);
console.log(`  frozen on old snapshot (u=0) : ${pin0.toFixed(1)}%`);
console.log(`  run off the end              : ${pinTop.toFixed(1)}%`);
console.log(`  interpolating                : ${mid.toFixed(1)}%   mean u ${mean.toFixed(2)}`);
process.exit(0);
