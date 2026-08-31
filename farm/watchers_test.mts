// Presence must count PEOPLE. Two tabs of one person are one person; two
// different people are two.
import WebSocket from 'ws';
const URL = 'ws://localhost:8787';
const health = async () => (await (await fetch('http://localhost:8787/health')).json()).watchers;
const connect = (key?: string) => new Promise<any>(res => {
  const ws = new WebSocket(URL);
  ws.on('open', () => ws.send(JSON.stringify(key ? { t: 'key', key } : { t: 'key' })));
  ws.on('message', (raw: any) => { const m = JSON.parse(String(raw)); if (m.t === 'key') res({ ws, ...m }); });
});
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
console.log(`empty pit                      : ${await health()}`);
const a = await connect();                 await wait(400);
console.log(`one person, one tab            : ${await health()}   (owner ${a.owner})`);
const a2 = await connect(a.key);           await wait(400);
console.log(`SAME person, second tab        : ${await health()}   <- must stay 1`);
const b = await connect();                 await wait(400);
console.log(`a second, different person     : ${await health()}   <- must be 2`);
a.ws.close(); a2.ws.close();               await wait(600);
console.log(`first person closes both tabs  : ${await health()}   <- must be 1`);
b.ws.close();                              await wait(600);
console.log(`everyone gone                  : ${await health()}`);
process.exit(0);
