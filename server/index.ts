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
import { createVoid, stepVoid, spawnOne, spawnChar, makeAgent, VoidSim, VoidEvent, Agent } from '../src/void/sim';
import { declare } from '../src/void/pacts';
import { titleFor } from '../src/naming';
import { mintKey, ownerOf, looksLikeKey } from './keys';
import { sanitiseGenome } from './sanitise';
import { load as loadPit, save as savePit, SavedPit } from './persist';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_HZ = 30;
const SNAP_HZ = 12;
const POPULATION = Number(process.env.PIT_POPULATION ?? 5);
const STATE_FILE = process.env.PIT_STATE ?? 'pit-state.json';
const SAVE_EVERY = 5;                 // seconds
const MAX_PER_OWNER = 3;              // living creatures one key may hold
const SUMMON_COOLDOWN = 20;           // seconds between summons from one key

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

let wssRef: WebSocketServer | null = null;

/**
 * Characters are addressed by index and cached by clients. The cast GROWS now
 * — every summon adds one — so a new entry is broadcast the moment it appears
 * and before any agent referring to it can arrive.
 */
const cast: Character[] = [];
const catalogue = new Map<Character, number>();
function castId(ch: Character): number {
  const known = catalogue.get(ch);
  if (known !== undefined) return known;
  const id = cast.length;
  cast.push(ch);
  catalogue.set(ch, id);
  broadcast({ t: 'cast', id, ch });
  return id;
}
roster.forEach(c => castId(c));

const sim: VoidSim = createVoid(roster, POPULATION);

// --- the pit remembers ------------------------------------------------------

/** Wall-clock the pit has been running, across every restart it has had. */
let wallBase = Date.now();

function restore(): void {
  const saved = loadPit(STATE_FILE);
  if (!saved) { console.log('[pit] a fresh pit'); return; }
  sim.agents.length = 0;
  sim.t = saved.t;
  wallBase = saved.wall - saved.t * 1000;
  for (const s of saved.agents) {
    const g = sanitiseGenome(s.genome);
    if (!g) continue;
    const a = makeAgent(makeCharacter(g, 'beast'), s.x, s.z, s.by);
    castId(a.ch);
    a.hp = s.hp; a.maxHp = s.maxHp;
    a.deeds = { kills: s.kills, spoils: s.spoils, born: s.born };
    sim.agents.push(a);
  }
  for (const p of saved.pacts) declare(sim.pacts, p.from, p.to, p.stance);
  console.log(`[pit] reopened with ${sim.agents.length} standing, clock at ${(sim.t / 60).toFixed(0)}m`);
}

function snapshotState(): SavedPit {
  const pacts: SavedPit['pacts'] = [];
  for (const [from, row] of sim.pacts.by) {
    for (const [to, stance] of row) pacts.push({ from, to, stance });
  }
  return {
    v: 1,
    t: sim.t,
    wall: Date.now(),
    agents: sim.agents.filter(a => a.deadT < 0).map(a => ({
      genome: a.genome, by: a.by,
      x: a.x, z: a.z, hp: a.hp, maxHp: a.maxHp,
      kills: a.deeds.kills, spoils: a.deeds.spoils, born: a.deeds.born,
    })),
    pacts,
  };
}

restore();

// --- who is here ------------------------------------------------------------

const lastSummon = new Map<string, number>();   // owner id -> sim time

function livingOf(owner: string): Agent[] {
  return sim.agents.filter(a => a.by === owner && a.deadT < 0);
}

// --- wire format ------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;

function snapshot() {
  return {
    t: 'snap',
    time: r2(sim.t),
    agents: sim.agents.map(a => ({
      i: a.id,
      c: castId(a.ch),
      x: r2(a.x), z: r2(a.z), h: r2(a.heading),
      mv: r2(a.move), hp: a.hp, st: a.state,
      d: a.deadT >= 0 ? r2(a.deadT) : -1,
      tr: r2(a.turnRate),
      tg: a.target?.id ?? 0,
      by: a.by,
      k: a.deeds.kills,
      sp: a.deeds.spoils.length,
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
    cast: cast.map((c, i) => ({ id: i, ch: c })),
  };
}

// --- the room ---------------------------------------------------------------

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      agents: sim.agents.filter(a => a.deadT < 0).length,
      watchers: wss.clients.size,
      openFor: Math.round((Date.now() - wallBase) / 1000),
      oldest: Math.round(Math.max(0, ...sim.agents.filter(a => a.deadT < 0).map(a => sim.t - a.deeds.born))),
    }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http });
wssRef = wss;

function broadcast(msg: unknown): void {
  // the cast is registered while the module is still loading, before there is
  // a socket server to shout at, let alone anyone listening
  if (!wssRef) return;
  const text = JSON.stringify(msg);
  for (const c of wssRef.clients) if (c.readyState === WebSocket.OPEN) c.send(text);
}

wss.on('connection', ws => {
  ws.send(JSON.stringify(hello()));

  ws.on('message', raw => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== 'object') return;

    // A key is minted here and sent back exactly once. It is the only proof
    // of ownership that will ever exist, and the client's job is to keep it
    // in a URL. We store the hash, never the key.
    if (m.t === 'key') {
      const key = looksLikeKey(m.key) ? m.key : mintKey();
      ws.send(JSON.stringify({ t: 'key', key, owner: ownerOf(key) }));
      return;
    }

    if (m.t === 'summon') {
      if (!looksLikeKey(m.key)) return;
      const owner = ownerOf(m.key);
      const since = sim.t - (lastSummon.get(owner) ?? -1e9);
      if (since < SUMMON_COOLDOWN) {
        ws.send(JSON.stringify({ t: 'nope', why: `wait ${Math.ceil(SUMMON_COOLDOWN - since)}s` }));
        return;
      }
      if (livingOf(owner).length >= MAX_PER_OWNER) {
        ws.send(JSON.stringify({ t: 'nope', why: 'you already have three in the pit' }));
        return;
      }
      const g = sanitiseGenome(m.genome);
      if (!g) {
        ws.send(JSON.stringify({ t: 'nope', why: 'that is not a creature' }));
        return;
      }
      // the body names itself here too — whatever the client called it is
      // discarded, so a name cannot smuggle in the words that made it
      g.name = titleFor(g.skeleton);
      const ch = makeCharacter(g, 'beast');
      castId(ch);
      const a = spawnChar(sim, ch, owner);
      lastSummon.set(owner, sim.t);
      ws.send(JSON.stringify({ t: 'yours', id: a.id, name: g.name, owner }));
      broadcast({ t: 'ev', list: sim.events as VoidEvent[] });
      return;
    }

    if (m.t === 'pact') {
      if (!looksLikeKey(m.key)) return;
      const to = typeof m.to === 'string' ? m.to.slice(0, 16) : '';
      const stance = m.stance === 'feud' ? 'feud' : m.stance === 'none' ? 'none' : 'ally';
      if (!to) return;
      declare(sim.pacts, ownerOf(m.key), to, stance);
      ws.send(JSON.stringify({ t: 'sworn', to, stance }));
      return;
    }

    if (m.t === 'stir') {
      for (const a of sim.agents) { a.target = null; a.state = 'wander'; a.stateT = 0; }
      spawnOne(sim);
    }
  });
});

// --- the loop ---------------------------------------------------------------

let last = Date.now();
let sinceSnap = 0;
let sinceSave = 0;

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  stepVoid(sim, dt);

  sinceSave += dt;
  if (sinceSave >= SAVE_EVERY) {
    sinceSave = 0;
    savePit(STATE_FILE, snapshotState());
  }

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

// A pit that loses the last few seconds on every deploy is a pit nobody trusts
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    savePit(STATE_FILE, snapshotState());
    console.log('[pit] saved and closed');
    process.exit(0);
  });
}
