// The pit. One room, one sim, many watchers.
//
// The server owns the void; clients render it. Nobody drives a character, so
// there is no prediction and no rollback — the hard parts of netcode simply
// do not apply here. Two things go over the wire: POSITIONS at a steady rate,
// and EVENTS the moment they happen. Genomes travel once, by id, because the
// expensive data is the only part that never changes.

import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { Character, migrateCharacter, makeCharacter } from '../src/character';
import { defaultBiped } from '../src/genome';
import { createVoid, stepVoid, spawnOne, VoidSim, VoidEvent } from '../src/void/sim';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_HZ = 30;
const SNAP_HZ = 12;
const POPULATION = Number(process.env.PIT_POPULATION ?? 5);

// --- the cast ---------------------------------------------------------------

function loadRoster(): Character[] {
  const seen = new Set<string>();
  const out: Character[] = [];
  for (const dir of ['characters', 'genomes']) {
    let files: string[] = [];
    try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      try {
        const ch = migrateCharacter(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
        const key = ch.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ch);
      } catch { /* skip the unreadable */ }
    }
  }
  if (!out.length) out.push(makeCharacter(defaultBiped(), 'hero'));
  return out;
}

const roster = loadRoster();
/** Characters are addressed by index; clients cache them on join. */
const catalogue = new Map<Character, number>();
roster.forEach((c, i) => catalogue.set(c, i));

const sim: VoidSim = createVoid(roster, POPULATION);

// --- wire format ------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;

function snapshot() {
  return {
    t: 'snap',
    time: r2(sim.t),
    agents: sim.agents.map(a => ({
      i: a.id,
      c: catalogue.get(a.ch) ?? 0,
      x: r2(a.x), z: r2(a.z), h: r2(a.heading),
      mv: r2(a.move), hp: a.hp, st: a.state,
      d: a.deadT >= 0 ? r2(a.deadT) : -1,
      tr: r2(a.turnRate),
      tg: a.target?.id ?? 0,
      by: a.by,
    })),
    shots: sim.shots.map(s => ({
      x: r2(s.x), z: r2(s.z), y: r2(s.y),
      c: s.spec.color, r: s.spec.size,
      tr: s.trail.map(p => [r2(p.x), r2(p.y), r2(p.z)]),
    })),
  };
}

function hello() {
  // NOTE: the spread carries its own `t`, so it must come FIRST or it
  // relabels this message as a plain snapshot and the roster never lands.
  return {
    ...snapshot(),
    t: 'hello',
    cast: roster.map((c, i) => ({ id: i, ch: c })),
  };
}

// --- the room ---------------------------------------------------------------

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agents: sim.agents.length, watchers: wss.clients.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http });

function broadcast(msg: unknown): void {
  const text = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(text);
}

wss.on('connection', ws => {
  ws.send(JSON.stringify(hello()));
  ws.on('message', raw => {
    try {
      const m = JSON.parse(String(raw));
      // summoning arrives here; for now a nudge is all a watcher may do
      if (m?.t === 'stir') {
        for (const a of sim.agents) { a.target = null; a.state = 'wander'; a.stateT = 0; }
        spawnOne(sim);
      }
    } catch { /* ignore malformed */ }
  });
});

// --- the loop ---------------------------------------------------------------

let last = Date.now();
let sinceSnap = 0;

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  stepVoid(sim, dt);

  // events go out the instant they happen — they are sparse and they carry
  // the story, so they must not wait for the next position tick
  if (sim.events.length) {
    broadcast({ t: 'ev', list: sim.events as VoidEvent[] });
    for (const e of sim.events) log(e);
  }

  sinceSnap += dt;
  if (sinceSnap >= 1 / SNAP_HZ) {
    sinceSnap = 0;
    broadcast(snapshot());
  }
}, 1000 / TICK_HZ);

/** The same stream, read aloud. This is the kill feed, on the server side. */
function log(e: VoidEvent): void {
  if (e.kind === 'kill') {
    console.log(`  ${e.actor?.name ?? 'something'} felled ${e.target?.name}` +
      (e.how ? ` — ${e.how}${e.range ? ` at ${e.range.toFixed(1)}m` : ''}` : ''));
  } else if (e.kind === 'spawn') {
    console.log(`  ${e.actor?.name} enters the pit`);
  }
}

http.listen(PORT, () => {
  console.log(`the pit is open on :${PORT} — ${roster.length} creatures in the catalogue`);
});
