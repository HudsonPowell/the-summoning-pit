// A phone that locks and comes back: same key, new socket, old socket still
// open as far as the pit knows. The owner must survive it.
import WebSocket from 'ws';
const URL = 'ws://localhost:8787';
const keyOf = (ws: WebSocket) => new Promise<any>(res => {
  ws.on('open', () => ws.send(JSON.stringify({ t: 'key' })));
  ws.on('message', (raw: any) => { const m = JSON.parse(String(raw)); if (m.t === 'key') res(m); });
});
const first = new WebSocket(URL);
const a = await keyOf(first);
console.log(`first socket : owner ${a.owner}`);
// do NOT close it — that is the whole point; the pit still believes it is open
const second = new WebSocket(URL);
second.on('open', () => second.send(JSON.stringify({ t: 'key', key: a.key })));
const b = await new Promise<any>(res => second.on('message', (raw: any) => {
  const m = JSON.parse(String(raw)); if (m.t === 'key') res(m);
}));
console.log(`after reconnect: owner ${b.owner}`);
console.log(b.owner === a.owner ? 'IDENTITY SURVIVED' : 'IDENTITY LOST — the summon would be orphaned');
process.exit(0);
