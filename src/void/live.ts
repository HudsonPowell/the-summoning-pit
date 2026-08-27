// Watching a pit you are not simulating.
//
// The remote view quacks like the local one: it hands back the same agents
// and shots the renderer already knows, so the director, the pose solver and
// every look control work unchanged. Positions arrive twelve times a second
// and are interpolated; gait phase is advanced LOCALLY from each creature's
// own cadence, and strikes are started by events — so the animation stays
// smooth however sparse the wire is.

import { newPacts } from './pacts';
import { scatterProps } from '../props';
import { Character, migrateCharacter } from '../character';
import { effectiveGait } from '../genome';
import { Agent, VoidSim, VoidEvent, Shot, makeAgent, varyFor } from './sim';

const DELAY = 0.12; // render this far in the past, so there is always a pair

interface Snap {
  at: number;
  time: number;
  agents: any[];
  shots: any[];
}

export class LiveVoid {
  sim: VoidSim;
  connected = false;
  everConnected = false;  // gates the 'far away' line: never shown before first contact
  private pauseUntil = 0;  // performance.now()/1000 when hosted summoning resumes

  /** Seconds until hosted summoning resumes; 0 when it is running. */
  pauseFor(): number { return Math.max(0, this.pauseUntil - performance.now() / 1000); }
  watchers = 0;
  private ws?: WebSocket;
  private cast: Character[] = [];

  /** The pit answers about keys, summons and pacts through these. */
  onKey?: (key: string, owner: string) => void;
  onYours?: (id: number, name: string) => void;
  onNope?: (why: string) => void;
  onSworn?: (to: string, stance: string) => void;
  private prev?: Snap;
  private next?: Snap;
  private clock = 0;
  private byId = new Map<number, Agent>();

  constructor() {
    this.sim = {
      challengeT: 0,
    seed: 1337,
    props: scatterProps(1337, 18),
    pacts: newPacts(),
    agents: [], shots: [], roster: [], events: [],
      t: 0, spawnT: 0, population: 0, peace: 0.35,
    };
  }

  connect(url: string): void {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.everConnected = true;
      // anything said while the socket was still opening is said now — the
      // first thing the client ever sends is its key, and dropping that
      // silently means it never gets one
      const queued = this.outbox.splice(0);
      for (const m of queued) ws.send(JSON.stringify(m));
    };
    ws.onclose = () => {
      this.connected = false;
      // the pit outlives any one connection; keep trying to get back in
      setTimeout(() => this.connect(url), 1500);
    };
    ws.onmessage = e => this.receive(JSON.parse(e.data as string));
  }

  private outbox: unknown[] = [];

  send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (this.outbox.length < 16) this.outbox.push(msg);
  }

  private receive(m: any): void {
    if (m.t === 'pause') {
      this.pauseUntil = performance.now() / 1000 + (m.for ?? 0);
      return;
    }
    if (m.t === 'hello') {
      this.pauseUntil = performance.now() / 1000 + (m.pauseFor ?? 0);
      this.cast = m.cast.map((c: any) => {
        try { return migrateCharacter(c.ch); } catch { return null; }
      }).filter(Boolean) as Character[];
      this.sim.roster = this.cast;
      this.take(m);
      return;
    }
    // the cast grows: every summon anyone makes adds one, and it arrives
    // before any agent that refers to it
    if (m.t === 'cast') {
      try { this.cast[m.id] = migrateCharacter(m.ch); this.sim.roster = this.cast.filter(Boolean); }
      catch { /* a creature we cannot read is one we do not draw */ }
      return;
    }
    if (m.t === 'key')   { this.onKey?.(m.key, m.owner); return; }
    if (m.t === 'yours') { this.onYours?.(m.id, m.name); return; }
    if (m.t === 'nope')  { this.onNope?.(m.why); return; }
    if (m.t === 'sworn') { this.onSworn?.(m.to, m.stance); return; }
    if (m.t === 'snap') { this.take(m); return; }
    if (m.t === 'ev') {
      for (const ev of m.list as VoidEvent[]) this.applyEvent(ev);
      this.sim.events.push(...m.list);
    }
  }

  private take(m: any): void {
    this.prev = this.next;
    this.next = { at: performance.now() / 1000, time: m.time, agents: m.agents, shots: m.shots };
    if (!this.prev) this.prev = this.next;
    this.clock = this.next.at - DELAY;
  }

  /** Events drive the things that must not wait for the next position packet. */
  private applyEvent(ev: VoidEvent): void {
    const a = ev.actor ? this.byId.get(ev.actor.id) : undefined;
    if ((ev.kind === 'strike' || ev.kind === 'loose') && a) {
      a.strikeT = 0;
      a.struck = false;
      a.heavy = false;
      // The variation is cosmetic — damage was settled on the server — so the
      // client rolls its own rather than putting a whole spec on the wire.
      a.swing = varyFor(a, false, ((ev.t * 9301 + a.id * 49297) % 233280) / 233280);
    }
    if (ev.kind === 'hit' && ev.target) {
      const t2 = this.byId.get(ev.target.id);
      if (t2) { t2.strikeT = -1; t2.swing = null; }
    }
    if (ev.kind === 'hit' && ev.target) {
      const t = this.byId.get(ev.target.id);
      if (t) t.hurtT = 0.55;
    }
  }

  private agentFor(row: any): Agent | null {
    let a = this.byId.get(row.i);
    if (!a) {
      const ch = this.cast[row.c] ?? this.cast[0];
      if (!ch) return null; // roster not in yet — skip until hello lands
      a = makeAgent(ch, row.x, row.z, row.by);
      a.id = row.i;
      a.by = row.by;
      this.byId.set(row.i, a);
      this.sim.agents.push(a);
    }
    return a;
  }

  update(dt: number): void {
    // events arrive between frames, so they are drained by the caller AFTER
    // it has read them — clearing here would destroy them unread
    if (!this.next || !this.prev) return;
    this.clock += dt;

    const span = Math.max(1e-3, this.next.at - this.prev.at);
    const u = Math.max(0, Math.min(1, (this.clock - this.prev.at) / span));
    this.sim.t = this.prev.time + (this.next.time - this.prev.time) * u;

    const prevById = new Map<number, any>(this.prev.agents.map((r: any) => [r.i, r]));
    const live = new Set<number>();

    for (const row of this.next.agents) {
      live.add(row.i);
      const a = this.agentFor(row);
      if (!a) continue;
      const p = prevById.get(row.i) ?? row;

      a.x = p.x + (row.x - p.x) * u;
      a.z = p.z + (row.z - p.z) * u;
      // headings wrap, so interpolate the short way round
      let dh = row.h - p.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      a.heading = p.h + dh * u;
      a.move = p.mv + (row.mv - p.mv) * u;
      a.turnRate = row.tr;
      a.hp = row.hp;
      // maxHp GROWS as a creature takes trophies, and it used to stay behind on
      // the server — so every client divided a champion's 12 hp by the 4 it was
      // born with, got 3, clamped it to full, and drew every health bar as
      // untouched. A creature that could not be shown losing looked invincible.
      if (typeof row.mx === 'number') a.maxHp = row.mx;
      // deeds cross the wire so a veteran reads as one on every screen
      if (typeof row.k === 'number') a.deeds.kills = row.k;
      a.state = row.st;
      a.deadT = row.d;
      a.recalled = row.rc === 1;
      a.by = row.by;
      a.target = row.tg ? this.byId.get(row.tg) ?? null : null;

      // the parts the wire never sends, advanced locally so they stay smooth
      const eff = effectiveGait(a.genome.gait, { tired: 0, angry: a.state === 'fight' ? 0.7 : 0 });
      a.phase = (a.phase + eff.cadence * a.move * dt) % 1;
      a.idleT += dt;
      if (a.hurtT > 0) a.hurtT -= dt;
      if (a.strikeT >= 0) {
        a.strikeT += dt;
        const spec = (a.ch.behaviors['attack-light'] as any)?.strike;
        if (a.strikeT > (spec?.duration ?? 0.5)) a.strikeT = -1;
      }
    }

    // anything the pit has forgotten
    for (const [id, a] of this.byId) {
      if (live.has(id)) continue;
      this.byId.delete(id);
      const i = this.sim.agents.indexOf(a);
      if (i >= 0) this.sim.agents.splice(i, 1);
    }

    this.sim.shots = (this.next.shots as any[]).map((s): Shot => ({
      x: s.x, z: s.z, y: s.y, vx: 0, vz: 0, life: 1,
      spec: { speed: 0, range: 0, size: s.r, color: s.c, arcing: false, trail: s.tr.length },
      from: this.sim.agents[0],
      trail: s.tr.map((t: number[]) => ({ x: t[0], y: t[1], z: t[2] })),
    }));
  }
}
