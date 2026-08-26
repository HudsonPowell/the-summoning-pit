// Two watchers, one pit. They must see the same creatures in the same places.
import { WebSocket } from 'ws';

const URL_ = process.env.PIT ?? 'ws://localhost:8787';

interface View { hello: boolean; cast: number; snaps: number; events: string[]; last: any }
function watch(name: string): Promise<View> {
  return new Promise(resolve => {
    const v: View = { hello: false, cast: 0, snaps: 0, events: [], last: null };
    const ws = new WebSocket(URL_);
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.t === 'hello') { v.hello = true; v.cast = m.cast.length; v.last = m; }
      else if (m.t === 'snap') { v.snaps++; v.last = m; }
      else if (m.t === 'ev') for (const e of m.list) if (e.kind === 'kill' || e.kind === 'spawn')
        v.events.push(`${e.kind}:${e.actor?.name}`);
    });
    setTimeout(() => { ws.close(); resolve(v); }, 4000);
  });
}

const [a, b] = await Promise.all([watch('A'), watch('B')]);

const idsA = (a.last?.agents ?? []).map((r: any) => r.i).sort().join(',');
const idsB = (b.last?.agents ?? []).map((r: any) => r.i).sort().join(',');

console.log(`watcher A: hello=${a.hello} cast=${a.cast} snaps=${a.snaps} events=${a.events.length}`);
console.log(`watcher B: hello=${b.hello} cast=${b.cast} snaps=${b.snaps} events=${b.events.length}`);
console.log(`same creatures in the pit: ${idsA === idsB ? 'YES' : 'NO'}  (${idsA} | ${idsB})`);
console.log(`snapshot rate: ~${(a.snaps / 4).toFixed(1)} Hz`);
const bytes = JSON.stringify(a.last).length;
console.log(`snapshot size: ${bytes} bytes → ~${((bytes * a.snaps / 4) / 1024).toFixed(1)} KB/s per watcher`);

const ok = a.hello && b.hello && a.cast > 0 && idsA === idsB && a.snaps > 20;
console.log(ok ? '\ntwo browsers, one pit — confirmed\n' : '\nFAILED\n');
process.exit(ok ? 0 : 1);
