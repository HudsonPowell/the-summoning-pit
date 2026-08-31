// What the phone actually receives: how evenly snapshots ARRIVE, how evenly
// the server's own clock advances inside them, and how many bytes it costs.
import WebSocket from 'ws';
const URL = process.argv[2] ?? 'wss://thesummoningpit.com';
const SECS = Number(process.argv[3] ?? 40);

const arr: number[] = [];      // ms between arrivals (local)
const srv: number[] = [];      // ms between server clocks (inside the packet)
let bytes = 0, snaps = 0, lastAt = 0, lastTime = 0;

const ws = new WebSocket(URL);
ws.on('open', () => ws.send(JSON.stringify({ t: 'key' })));
ws.on('message', (raw: any) => {
  bytes += raw.length ?? String(raw).length;
  const m = JSON.parse(String(raw));
  if (!m.agents) return;
  snaps++;
  const now = performance.now();
  if (lastAt) { arr.push(now - lastAt); srv.push((m.time - lastTime) * 1000); }
  lastAt = now; lastTime = m.time;
});

await new Promise(r => setTimeout(r, SECS * 1000));
const stat = (v: number[], name: string) => {
  if (!v.length) return `${name}: none`;
  const s = v.slice().sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return `${name}: mean ${mean.toFixed(1)}ms  sd ${sd.toFixed(1)}  min ${s[0].toFixed(0)}  p50 ${s[s.length >> 1].toFixed(0)}  p95 ${s[Math.floor(s.length * 0.95)].toFixed(0)}  max ${s[s.length - 1].toFixed(0)}`;
};
console.log(`${URL} — ${snaps} snapshots in ${SECS}s (${(snaps / SECS).toFixed(1)}/s), ${(bytes / SECS / 1024).toFixed(1)} KB/s`);
console.log(stat(arr, 'arrival gap '));
console.log(stat(srv, 'server clock'));
// how far each arrival strays from the server's own spacing — this is the
// jitter the client currently bakes straight into playback speed
const err = arr.map((a, i) => a - srv[i]);
console.log(stat(err.map(Math.abs), '|arrival - server|'));
process.exit(0);
