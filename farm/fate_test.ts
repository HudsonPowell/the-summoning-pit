// The pit's memory, proven end to end: it boots the real server against a save
// that holds two fates and walks in with both keys.
//
// This test exists because of a bug no unit test could have caught. The restore
// loop wrote into a `const fates` declared four hundred lines further down the
// file, so it sat in the temporal dead zone and the server died on boot — but
// only once a save actually contained a fate, which is to say only in
// production, days after the change looked fine everywhere else. Booting the
// real thing is the only way to see it, so the test boots the real thing.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { ownerOf } from '../server/keys';

const PORT = 8791;
const FRESH = 'fatetest-fresh-key-aaaa';
const STALE = 'fatetest-stale-key-bbbb';
const DAY = 86_400_000;
let bad = 0;
const ok = (name: string, pass: boolean, saw = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}   ${name}${saw ? ` — ${saw}` : ''}`);
  if (!pass) bad++;
};

const dir = mkdtempSync(join(tmpdir(), 'pit-fate-'));
const state = join(dir, 'pit.json');
writeFileSync(state, JSON.stringify({
  v: 1, t: 0, agents: [], flora: [], relics: [], pacts: [], wall: [],
  ledger: { records: { mostKills: { name: '', kills: 0 }, longestStand: { name: '', secs: 0 } } },
  fates: [
    { owner: ownerOf(FRESH), line: 'while you were away: Grezaan stood 4 minutes, then fell', at: Date.now() },
    { owner: ownerOf(STALE), line: 'a week-old fate is history, not news', at: Date.now() - 8 * DAY },
  ],
}));

const server = spawn('npx', ['tsx', 'server/index.ts'], {
  env: { ...process.env, PIT_STATE: state, PORT: String(PORT), PIT_TASTE: '0', PIT_POPULATION: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });

/** Walk in with a key and report the one line the pit says, if any. */
function walkIn(key: string): Promise<string> {
  return new Promise(res => {
    const ws = new WebSocket(`ws://localhost:${PORT}/`);
    let heard = '';
    ws.on('open', () => ws.send(JSON.stringify({ t: 'key', key })));
    ws.on('message', d => { const m = JSON.parse(String(d)); if (m.t === 'fate') heard = m.line; });
    ws.on('error', () => {});
    setTimeout(() => { try { ws.close(); } catch {} res(heard); }, 2500);
  });
}

const until = (p: () => boolean, ms: number) => new Promise<boolean>(res => {
  const t0 = Date.now();
  const tick = () => p() ? res(true) : Date.now() - t0 > ms ? res(false) : setTimeout(tick, 250);
  tick();
});

(async () => {
  console.log('\nthe pit remembers across a restart');
  const up = await until(() => /listening|reopened/i.test(log), 40_000);
  ok('the server survives booting from a save that holds fates', up,
     up ? '' : log.split('\n').filter(Boolean).slice(-3).join(' | '));

  if (up) {
    ok('a fresh fate is told to the owner who comes back',
       (await walkIn(FRESH)).includes('Grezaan'));
    ok('an eight-day-old fate is not', (await walkIn(STALE)) === '');
  }

  server.kill('SIGKILL');
  console.log(bad ? `\n${bad} failed` : '\nall green\n');
  process.exit(bad ? 1 : 0);
})();
