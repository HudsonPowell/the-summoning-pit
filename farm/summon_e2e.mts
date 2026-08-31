// A real summon over a real socket, timed from keypress to creature.
import WebSocket from 'ws';
const URL = process.argv[2] ?? 'ws://localhost:8787';
const DESCS = [
  'a hooded pale hunter with a tall silver longbow',
  'a censer priest swinging green smoke on a chain',
  'a crowned toad king in a moth-eaten velvet cloak',
];
for (const desc of DESCS) {
  await new Promise<void>(done => {
    const ws = new WebSocket(URL);
    let sent = 0;
    const timer = setTimeout(() => { console.log(`${desc.slice(0,30)}  TIMED OUT (>45s)`); ws.close(); done(); }, 45000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'key' })));
    ws.on('message', (raw: any) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'key' && !sent) { sent = Date.now(); ws.send(JSON.stringify({ t: 'summon', key: m.key, desc })); }
      if (m.t === 'yours') {
        clearTimeout(timer);
        console.log(`${desc.slice(0, 32).padEnd(34)} ${((Date.now() - sent) / 1000).toFixed(1)}s  -> ${m.name}`);
        ws.close(); done();
      }
      if (m.t === 'nope') { clearTimeout(timer); console.log(`${desc.slice(0,32).padEnd(34)} REFUSED: ${m.why}`); ws.close(); done(); }
    });
  });
}
process.exit(0);
