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
import { createVoid, stepVoid, spawnChar, makeAgent, whoOf, VoidSim, VoidEvent, Agent } from '../src/void/sim';
import { declare } from '../src/void/pacts';
import { titleFor } from '../src/naming';
import { hatchGenome, OLLAMA_URL, HATCH_MODEL, HATCH_API_KEY } from '../src/hatch';
import { mintKey, ownerOf, looksLikeKey } from './keys';
import { sanitiseGenome } from './sanitise';
import { load as loadPit, save as savePit, SavedPit } from './persist';
import { serveStatic } from './static';
import { warm, warmModel } from './warm';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_HZ = 30;
const SNAP_HZ = 12;
const POPULATION = Number(process.env.PIT_POPULATION ?? 0);
const STATE_FILE = process.env.PIT_STATE ?? 'pit-state.json';
/** Can this pit hatch for people who have no model of their own? */
const SERVER_HATCH = process.env.PIT_HATCH !== 'off';
const SAVE_EVERY = 5;                 // seconds
const MAX_PER_OWNER = 1;              // one hero each — the pit is not a kennel
/**
 * A summon should land the moment it is typed. Measured cost is about £0.0015
 * a creature, so this was never really about credit — it is only here to stop
 * one person spamming re-rolls. Short enough that people keep playing.
 */
const SUMMON_GAP = 2;                 // seconds, only to swallow a double-press
const SHORT_LIFE = 10;                // a hero gone this fast was barely a hero
const SHORT_PENALTY = 6;              // a beat, not a punishment

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

// --- the ledger: what the pit has seen, for /stats --------------------------
// Counts only. No prompts (never stored anywhere), no keys — owner ids are
// already one-way hashes, and only the day's distinct COUNT survives the day.
interface DayRow { summons: number; kills: number; loads: number; owners: string[] }
const ledger = {
  summons: 0,
  kills: 0,
  loads: 0,
  owners: new Set<string>(),
  byDay: new Map<string, DayRow>(),
  records: {
    longestStand: { name: '', secs: 0 },
    mostKills: { name: '', kills: 0 },
  },
};
function dayKey(): string { return new Date().toISOString().slice(0, 10); }
function dayRow(): DayRow {
  let row = ledger.byDay.get(dayKey());
  if (!row) {
    row = { summons: 0, kills: 0, loads: 0, owners: [] };
    ledger.byDay.set(dayKey(), row);
    // the ledger keeps a month, not a history
    for (const k of [...ledger.byDay.keys()].sort().slice(0, -31)) ledger.byDay.delete(k);
  }
  return row;
}


function restore(): void {
  const saved = loadPit(STATE_FILE);
  if (!saved) { console.log('[pit] a fresh pit'); return; }
  sim.agents.length = 0;
  sim.t = saved.t;
  wallBase = saved.wall - saved.t * 1000;
  for (const s of saved.agents) {
    // house creatures do not come back: the pit spawns nothing of its own now,
    // and that includes resurrecting its old cast from disk
    if (!s.by) continue;
    const g = sanitiseGenome(s.genome);
    if (!g) continue;
    const a = makeAgent(makeCharacter(g, 'beast'), s.x, s.z, s.by);
    castId(a.ch);
    a.hp = s.hp; a.maxHp = s.maxHp;
    a.deeds = { kills: s.kills, spoils: s.spoils, born: s.born };
    sim.agents.push(a);
  }
  for (const p of saved.pacts) declare(sim.pacts, p.from, p.to, p.stance);
  if (Array.isArray(saved.relics)) sim.relics = saved.relics as typeof sim.relics;
  if (Array.isArray(saved.flora)) sim.flora = saved.flora as typeof sim.flora;
  const led = (saved as any).ledger;
  if (led) {
    ledger.summons = led.summons ?? 0;
    ledger.kills = led.kills ?? 0;
    ledger.loads = led.loads ?? 0;
    for (const o of led.owners ?? []) ledger.owners.add(o);
    for (const [k, v] of led.byDay ?? []) ledger.byDay.set(k, v);
    if (led.records) ledger.records = led.records;
  }
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
    relics: sim.relics,
    flora: sim.flora,
    ledger: {
      summons: ledger.summons, kills: ledger.kills, loads: ledger.loads,
      owners: [...ledger.owners], byDay: [...ledger.byDay.entries()],
      records: ledger.records,
    },
  };
}

restore();

// the model downloads in the background; the pit opens immediately
if (SERVER_HATCH && !HATCH_API_KEY) {
  void warmModel(OLLAMA_URL, HATCH_MODEL);
}

// --- who is here ------------------------------------------------------------

const lastSummon = new Map<string, number>();   // owner id -> sim time
const penaltyUntil = new Map<string, number>(); // owner id -> sim time

function livingOf(owner: string): Agent[] {
  return sim.agents.filter(a => a.by === owner && a.deadT < 0);
}

// --- wire format ------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;

function snapshot() {
  return {
    t: 'snap',
    time: r2(sim.t),
    w: wssRef ? wssRef.clients.size : 0,
    agents: sim.agents.map(a => ({
      i: a.id,
      c: castId(a.ch),
      x: r2(a.x), z: r2(a.z), h: r2(a.heading),
      mv: r2(a.move), hp: a.hp, mx: a.maxHp, st: a.state,
      d: a.deadT >= 0 ? r2(a.deadT) : -1,
      rc: a.recalled ? 1 : 0,
      tr: r2(a.turnRate),
      tg: a.target?.id ?? 0,
      by: a.by,
      k: a.deeds.kills,
      sp: a.deeds.spoils.length,
      ...(a.thrownRelic != null ? { tw: 1 } : {}),
      ...(a.guardT > 0 ? { gd: 1 } : {}),
    })),
    shots: sim.shots.map(s => ({
      x: r2(s.x), z: r2(s.z), y: r2(s.y),
      c: s.spec.color, r: s.spec.size,
      tr: s.trail.map(p => [r2(p.x), r2(p.y), r2(p.z)]),
    })),
    relics: sim.relics.map(r => ({
      i: r.id, k: r.kind, x: r2(r.x), z: r2(r.z), yw: r2(r.yaw), s: r2(r.sink),
      ...(r.item ? { it: r.item } : {}),
    })),
    flora: sim.flora.map(f => ({
      i: f.id, k: f.kind, x: r2(f.x), z: r2(f.z), yw: r2(f.yaw),
      g: r2(f.growth), h: r2(f.hurt), sd: f.seed,
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
    pauseFor: pauseFor(),
  };
}

// --- the room ---------------------------------------------------------------

const CLIENT_DIR = process.env.PIT_CLIENT ?? 'dist';

const http = createServer((req, res) => {
  if ((req.url ?? '').split('?')[0] === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      agents: sim.agents.filter(a => a.deadT < 0).length,
      watchers: wss.clients.size,
      openFor: Math.round((Date.now() - wallBase) / 1000),
      oldest: Math.round(Math.max(0, ...sim.agents.filter(a => a.deadT < 0).map(a => sim.t - a.deeds.born))),
      model: HATCH_API_KEY ? 'hosted' : warm.ready ? 'ready' : warm.error ? `error: ${warm.error}` : warm.progress || 'starting',
      paused: pauseFor(),
    }));
    return;
  }
  const path = (req.url ?? '').split('?')[0];
  if (path === '/stats') {
    const lord = sim.agents.filter(a => a.deadT < 0)
      .sort((p, q) => q.deeds.kills - p.deeds.kills || p.deeds.born - q.deeds.born)[0];
    const days = [...ledger.byDay.entries()].sort().slice(-7)
      .map(([day, r]) => ({ day, loads: r.loads, summons: r.summons, summoners: r.owners.length, kills: r.kills }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      openForDays: Math.round((Date.now() - wallBase) / 8640000) / 10,
      watching: wss.clients.size,
      standing: sim.agents.filter(a => a.deadT < 0).length,
      lord: lord ? { name: lord.ch.name, kills: lord.deeds.kills, ageMin: Math.round((sim.t - lord.deeds.born) / 60) } : null,
      totals: { loads: ledger.loads, summons: ledger.summons, summoners: ledger.owners.size, kills: ledger.kills },
      records: ledger.records,
      days,
    }, null, 2));
    return;
  }
  if (path === '/' || path === '/void.html') { ledger.loads++; dayRow().loads++; }
  if (serveStatic(CLIENT_DIR, req, res)) return;
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

/**
 * One key, one live session. A key used to travel in the URL, so anyone who
 * shared their own link handed over their identity — and every friend who
 * opened it became the same person, sharing one hero between them. The key is
 * out of the URL now, but the copies are already in people's browsers, and
 * nobody should have to clear storage to play.
 *
 * So: if a key is already held by another open connection, the newcomer is a
 * different person using a copy. Mint them their own and tell them.
 */
const liveKeys = new Map<string, WebSocket>();

// what happened to an owner's creature while they were away, told once on
// their next arrival. Names only — never keys, never prompts.
const fates = new Map<string, { line: string; at: number }>();
function ownerOnline(owner: string): boolean {
  for (const [k, sock] of liveKeys) {
    if (ownerOf(k) === owner && sock.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

wss.on('connection', ws => {
  ws.send(JSON.stringify(hello()));

  ws.on('close', () => {
    const k = (ws as any).__key as string | undefined;
    if (k && liveKeys.get(k) === ws) liveKeys.delete(k);
  });

  ws.on('message', raw => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== 'object') return;

    // A key is minted here and sent back exactly once. It is the only proof
    // of ownership that will ever exist, and the client's job is to keep it
    // in a URL. We store the hash, never the key.
    if (m.t === 'key') {
      let key = looksLikeKey(m.key) ? m.key : mintKey();
      const holder = liveKeys.get(key);
      if (holder && holder !== ws && holder.readyState === WebSocket.OPEN) {
        console.log(`[pit] ${ownerOf(key)} is open twice — minting a fresh identity`);
        key = mintKey();
      }
      liveKeys.set(key, ws);
      (ws as any).__key = key;
      ws.send(JSON.stringify({ t: 'key', key, owner: ownerOf(key) }));
      const fate = fates.get(ownerOf(key));
      if (fate) {
        fates.delete(ownerOf(key));
        // a week-old fate is history, not news
        if (Date.now() - fate.at < 7 * 86400_000) {
          ws.send(JSON.stringify({ t: 'fate', line: fate.line }));
        }
      }
      return;
    }

    if (m.t === 'summon') {
      // A summon with no usable key returned SILENTLY, so the client sat on
      // "summoning…" forever with nothing to show for it. Anyone whose key
      // never arrived — a blocked localStorage, a socket that reconnected —
      // simply could not play, and could not be told why either.
      if (!looksLikeKey(m.key)) {
        const key = mintKey();
        ws.send(JSON.stringify({ t: 'key', key, owner: ownerOf(key) }));
        ws.send(JSON.stringify({ t: 'nope', why: 'no key — try that again' }));
        console.log('[pit] summon with no key; minted one');
        return;
      }
      void handleSummon(ws, m);
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
      // This spawned a creature for anyone who asked, with no key, no cooldown
      // and no limit — so seven watchers clicking a button filled the pit with
      // twelve house creatures and buried every real summon among them. It
      // wakes the pit now; it does not populate it.
      for (const a of sim.agents) {
        if (a.state === 'rest') { a.state = 'think'; a.stateT = 0; }
      }
    }
  });
});


/** Say no out loud. A refusal nobody can see is a bug report nobody can file. */
function refuse(ws: WebSocket, owner: string, why: string): void {
  console.log(`[pit] refused ${owner}: ${why}`);
  ws.send(JSON.stringify({ t: 'nope', why }));
}

/**
 * A summon may arrive as a BODY or as WORDS.
 *
 * A body means the player hatched it themselves, on their own machine, with
 * whatever model they like — the pit never sees the words, and a better model
 * shows up as a better-composed creature rather than better numbers, because
 * temperament is derived here from the body and mass is capped here too.
 *
 * Words are for everyone else: most people will never run a model, and a pit
 * only they can summon into is not a pit. The server hatches it and throws the
 * words away — they are never stored, never logged, never sent on.
 */
// The hosted model runs on credit, and credit runs out. When the provider
// starts answering with billing errors, the pit does not break — it PAUSES:
// summons are refused with one honest line, everyone's box says so before
// they even type, and every ten minutes one summon is allowed through to
// probe whether the account lives again. Bodies hatched on a player's own
// model are never gated — the pause is only about OUR credit.
let pausedUntil = 0;                       // wall-clock ms
const PAUSE_RETRY = 10 * 60_000;
const PAUSE_LINE = 'summoning is paused — back soon';

function pauseWorthy(msg: string): boolean {
  return /hatch api (401|402|403)/.test(msg)
    || /credit|balance|billing|payment|quota|insufficient/i.test(msg);
}

function pauseFor(): number {
  return Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000));
}

function setPaused(on: boolean): void {
  const was = pauseFor() > 0;
  pausedUntil = on ? Date.now() + PAUSE_RETRY : 0;
  const line = { t: 'pause', for: pauseFor() };
  if (was !== (pauseFor() > 0) || on) broadcast(line);
  if (on) console.log('[pit] summoning paused — the model answered with a billing error');
}

// Owners with a summon mid-hatch. The 2s SUMMON_GAP only covers rapid-fire;
// a hosted hatch takes 5-12s, and in that window a re-sent summon passed every
// guard (nothing living yet, gap elapsed) and minted a SECOND creature for the
// same owner. One in flight each, and the refusal says so.
const hatching = new Set<string>();

async function handleSummon(ws: WebSocket, m: any): Promise<void> {
  const owner = ownerOf(m.key);
  if (hatching.has(owner)) { refuse(ws, owner, 'yours is already forming'); return; }
  const since = sim.t - (lastSummon.get(owner) ?? -1e9);
  // also used to return silently, which is indistinguishable from a dead pit
  if (since < SUMMON_GAP) { refuse(ws, owner, 'just a moment'); return; }
  const held = penaltyUntil.get(owner) ?? 0;
  if (sim.t < held) {
    refuse(ws, owner, `that one did not last — ${Math.ceil(held - sim.t)}s`);
    return;
  }
  // One hero each, and you live with it. Replacing yours on demand meant
  // killing a creature that was still fighting — which is both a strange thing
  // to watch and a strange thing to be able to do to your own champion. If
  // yours is standing, you are not summoning; you are watching.
  const yours = livingOf(owner)[0];
  if (yours) {
    const age = Math.round(sim.t - yours.deeds.born);
    refuse(ws, owner, `${yours.ch.name.split(' ')[0]} still stands — ${age}s, ${yours.hp}/${yours.maxHp}`);
    return;
  }

  let raw: unknown = m.genome;
  if (!raw && typeof m.desc === 'string' && m.desc.trim()) {
    if (!SERVER_HATCH) {
      refuse(ws, owner, 'this pit cannot hatch for you — run a model locally');
      return;
    }
    if (!HATCH_API_KEY && !warm.ready) {
      refuse(ws, owner, warm.error ? 'the pit has no mind yet' : `still waking up — ${warm.progress || 'loading'}`);
      return;
    }
    // claim the slot BEFORE the slow part, or one client can have twenty in
    // flight at once while the cooldown has not started
    if (pauseFor() > 0) {
      refuse(ws, owner, PAUSE_LINE);
      return;
    }
    lastSummon.set(owner, sim.t);
    hatching.add(owner);
    try {
      // identical words should not hatch identical bodies twice: a little
      // temperature jitter keeps repeat summons diverging
      raw = await hatchGenome(m.desc.slice(0, 200), undefined, undefined, undefined, 0.75 + Math.random() * 0.3);
      if (pausedUntil) setPaused(false);   // the probe got through: credit lives
    } catch (e) {
      lastSummon.set(owner, -1e9);
      const msg = (e as Error).message;
      if (pauseWorthy(msg)) {
        setPaused(true);
        refuse(ws, owner, PAUSE_LINE);
      } else {
        refuse(ws, owner, `nothing answered: ${msg.slice(0, 120)}`);
      }
      return;
    } finally {
      hatching.delete(owner);
    }
  }

  const g = sanitiseGenome(raw);
  if (!g) {
    refuse(ws, owner, 'that is not a creature');
    return;
  }
  g.name = titleFor(g.skeleton);
  const ch = makeCharacter(g, 'beast');
  castId(ch);
  const a = spawnChar(sim, ch, owner);
  lastSummon.set(owner, sim.t);
  ledger.summons++;
  ledger.owners.add(owner);
  const day = dayRow();
  day.summons++;
  if (!day.owners.includes(owner)) day.owners.push(owner);
  console.log(`[pit] ${owner} summoned ${g.name}`);
  ws.send(JSON.stringify({ t: 'yours', id: a.id, name: g.name, owner }));
  broadcast({ t: 'ev', list: sim.events as VoidEvent[] });
}

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
    for (const e of sim.events) {
      log(e);
      // A hero that barely arrived costs its owner a wait, so a bad summon
      // cannot be re-rolled forever at a model call a time.
      if (e.kind !== 'kill' || !e.target) continue;
      ledger.kills++;
      dayRow().kills++;
      const dead = sim.agents.find(a => a.id === e.target!.id);
      if (dead) {
        const stood = sim.t - dead.deeds.born;
        if (stood > ledger.records.longestStand.secs) {
          ledger.records.longestStand = { name: dead.ch.name, secs: Math.round(stood) };
        }
        // an absent owner hears about it when they come back
        if (dead.by && !ownerOnline(dead.by)) {
          const age = stood >= 90 ? `${Math.round(stood / 60)}m` : `${stood | 0}s`;
          const killer = e.actor?.name ? ` to ${e.actor.name.split(' ')[0]}` : '';
          fates.set(dead.by, {
            line: `while you were gone: ${dead.ch.name.split(' ')[0]} fell${killer} after ${age}`,
            at: Date.now(),
          });
        }
      }
      const victor = e.actor ? sim.agents.find(a => a.id === e.actor!.id) : undefined;
      if (victor && victor.deeds.kills > ledger.records.mostKills.kills) {
        ledger.records.mostKills = { name: victor.ch.name, kills: victor.deeds.kills };
      }
      if (!dead?.by) continue;
      if (sim.t - dead.deeds.born < SHORT_LIFE) {
        penaltyUntil.set(dead.by, sim.t + SHORT_PENALTY);
        console.log(`[pit] ${dead.by} lost ${dead.ch.name} in ${(sim.t - dead.deeds.born).toFixed(0)}s — held ${SHORT_PENALTY}s`);
      }
    }
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
    // Enough to answer "why did that die?" from the logs alone. A death with
    // no actor is the one worth noticing — it means something killed a
    // creature that nobody in the pit was responsible for.
    const standing = sim.agents.filter(a => a.deadT < 0).length;
    console.log(`  ${e.actor?.name ?? 'NOBODY'} felled ${e.target?.name}` +
      (e.how ? ` — ${e.how}` : '') +
      (e.range ? ` at ${e.range.toFixed(1)}m` : '') +
      ` | ${standing} standing, ${sim.shots.length} in flight`);
  } else if (e.kind === 'spawn') {
    console.log(`  ${e.actor?.name} enters the pit`);
  } else if (e.kind === 'despawn') {
    console.log(`  ${e.actor?.name} recalled`);
  }
}

http.listen(PORT, '0.0.0.0', () => {
  console.log(`THE SUMMONING PIT is open on :${PORT} — ${roster.length} creatures in the catalogue`);
});

// A pit that loses the last few seconds on every deploy is a pit nobody trusts
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    savePit(STATE_FILE, snapshotState());
    console.log('[pit] saved and closed');
    process.exit(0);
  });
}
