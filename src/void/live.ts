// Watching a pit you are not simulating.
//
// The remote view quacks like the local one: it hands back the same agents
// and shots the renderer already knows, so the director, the pose solver and
// every look control work unchanged. Positions arrive twelve times a second
// and are interpolated; gait phase is advanced LOCALLY from each creature's
// own cadence, and strikes are started by events — so the animation stays
// smooth however sparse the wire is.

import { newPacts } from './pacts';
import { pitScenery } from '../props';
import { Character, migrateCharacter } from '../character';
import { effectiveGait } from '../genome';
import { Agent, VoidSim, VoidEvent, Shot, makeAgent, varyFor } from './sim';
import { stepSecondary, jolt } from '../secondary';

/**
 * How far behind the newest snapshot to play, as a FRACTION of the gap
 * between snapshots — never as a count of seconds.
 *
 * It was 0.15s, and the pit streams a snapshot every 0.10s. So the playback
 * clock aimed at a moment BEFORE the previous snapshot, u clamped to 0, and
 * 99.9% of frames drew the older snapshot's positions verbatim: a phone
 * rendering sixty frames a second of a world that moved ten times a second.
 * Every report of "glitchy, low fps" motion was this, and no amount of
 * rendering work could have touched it.
 *
 * Expressed as a fraction it cannot come apart again: whatever the rate, the
 * clock sits partway between the last two snapshots and always has a pair to
 * interpolate, with a little under half a gap of slack for a late packet.
 */
const LAG = 0.45;

interface Snap {
  at: number;
  time: number;
  agents: any[];
  shots: any[];
  relics?: any[];
  flora?: any[];
}

export class LiveVoid {
  sim: VoidSim;
  connected = false;
  everConnected = false;  // gates the 'far away' line: never shown before first contact
  hasWorld = false;       // a full snapshot has landed: there is something real to show
  private pauseUntil = 0;  // performance.now()/1000 when hosted summoning resumes

  /** Seconds until hosted summoning resumes; 0 when it is running. */
  pauseFor(): number { return Math.max(0, this.pauseUntil - performance.now() / 1000); }
  private ws?: WebSocket;
  private cast: Character[] = [];

  /** The pit answers about keys, summons and pacts through these. */
  onKey?: (key: string, owner: string) => void;
  onYours?: (id: number, name: string) => void;
  onNope?: (why: string) => void;
  onSworn?: (to: string, stance: string) => void;
  onFate?: (line: string) => void;
  /** Fired on every (re)connect — the key handshake must happen each time,
      or after a silent reconnect the server thinks the owner left. */
  onOpen?: () => void;
  watchers = 0;
  /** Where playback sits between the last two snapshots. 0 or 1 means broken. */
  uNow = 0;
  private prev?: Snap;
  private next?: Snap;
  private clock = 0;
  private byId = new Map<number, Agent>();
  // when each floor item was first seen, so it can arrive instead of pop
  private relicBorn = new Map<number, number>();
  private floraBorn = new Map<number, number>();

  constructor() {
    this.sim = {
      challengeT: 0,
    seed: 1337,
    props: pitScenery(1337),
    pacts: newPacts(),
    agents: [], shots: [], roster: [], events: [], relics: [], flora: [],
      t: 0, spawnT: 0, population: 0, peace: 0.35,
    };
  }

  connect(url: string): void {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.everConnected = true;
      this.onOpen?.();
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
    if (m.t === 'fate')  { this.onFate?.(m.line); return; }
    if (m.t === 'snap') { this.take(m); return; }
    if (m.t === 'ev') {
      for (const ev of m.list as VoidEvent[]) this.applyEvent(ev);
      this.sim.events.push(...m.list);
    }
  }

  private take(m: any): void {
    this.hasWorld = true;
    if (typeof m.w === 'number') this.watchers = m.w;
    this.prev = this.next;
    this.next = { at: performance.now() / 1000, time: m.time, agents: m.agents, shots: m.shots, relics: m.relics, flora: m.flora };
    if (!this.prev) {
      this.prev = this.next;
      this.clock = this.next.time - 0.06;
    }
    // NO hard resync here: snapping the clock to every arrival replayed the
    // network's jitter as visible stutter. update() eases toward the target.
  }

  /** Events drive the things that must not wait for the next position packet. */
  private applyEvent(ev: VoidEvent): void {
    const a = ev.actor ? this.byId.get(ev.actor.id) : undefined;
    // the dead swing nothing: a late strike event landing on a corpse had it
    // re-playing the start of its last draw forever — the dead man's bow
    // A LOOSE IS THE MIDDLE OF A SWING, NOT THE START OF ONE. Both kinds used
    // to reset the clock, so a ranged attack played its draw, and then at the
    // exact moment the arrow left the server's hand the client started the
    // draw AGAIN — the release pose never once coincided with the shot
    // appearing. The windup is announced by 'strike'; 'loose' only restarts
    // anything if this screen never saw the windup at all.
    if ((ev.kind === 'strike' || (ev.kind === 'loose' && a && a.strikeT < 0)) && a && a.deadT < 0) {
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
      if (t) {
        t.hurtT = 0.55;
        // the struck part carries the blow on every screen
        if (typeof ev.spotH === 'number') {
          t.flinch = { h: ev.spotH, side: ev.spotS ?? 1, t: 0.5 };
        }
        // and so does the WEIGHT of it: the event carries where the blow
        // came from, which is all the springs need to be knocked about the
        // same way the sim knocks its own
        // WHICH WAY THE BLOW CAME FROM. A hit event carries the position of
        // the creature that was HIT — so this used to read atan2(0, 0) and
        // shake the body in a direction that had nothing to do with the blow.
        // The attacker is in the event too, by id, and the client already
        // knows where it is standing.
        const src = ev.actor ? this.byId.get(ev.actor.id) : undefined;
        const fy = src
          ? Math.atan2(t.z - src.z, t.x - src.x) - t.heading
          : -t.heading;
        // a block, a parry, a broken guard, a clean blow — each shakes the
        // body its own amount, the sim's own numbers for the same moments
        const force = ev.how === 'guard-broken' ? 0.34
          : ev.how === 'parried' ? 0.24
          : ev.how === 'blocked' ? 0.18 : 0.3;
        jolt(t.sec, force, fy, t.bulk);
        // a parry rings the ATTACKER's arms too
        if (ev.how === 'parried' && ev.actor) {
          const by = this.byId.get(ev.actor.id);
          if (by) jolt(by.sec, 0.3, Math.atan2(t.z - by.z, t.x - by.x) - by.heading, by.bulk);
        }
      }
    }
    // death lands harder than the blow that caused it: the sim jolts 0.55
    // on a kill where a plain hit gives 0.3; the hit event already put its
    // 0.3 in, so the kill tops it up to the same total
    if (ev.kind === 'kill' && ev.target) {
      const t = this.byId.get(ev.target.id);
      if (t) jolt(t.sec, 0.25, Math.atan2(t.z - ev.z, t.x - ev.x) - t.heading, t.bulk);
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
    // The clock runs in SERVER time, which is spaced exactly and evenly by a
    // machine doing nothing else. Arrival times were the old basis, and they
    // carry the network's jitter straight into how fast the world appears to
    // move; the server's own clock carries none of it.
    const span = Math.max(1e-3, this.next.time - this.prev.time);
    this.clock += dt;
    const target = this.next.time - span * LAG;
    // a tab that was asleep, or a pit that restarted, is caught up at once
    // rather than crawled toward over a minute
    if (Math.abs(target - this.clock) > span * 8) this.clock = target;
    else this.clock += (target - this.clock) * Math.min(1, dt * 3);

    // a late packet no longer freezes the world at u=1: motion carries on a
    // short way along its last known line, then holds
    const u = Math.max(0, Math.min(1.25, (this.clock - this.prev.time) / span));
    this.uNow = u;
    this.sim.t = this.prev.time + (this.next.time - this.prev.time) * u;

    const prevById = new Map<number, any>(this.prev.agents.map((r: any) => [r.i, r]));
    const live = new Set<number>();

    for (const row of this.next.agents) {
      live.add(row.i);
      const a = this.agentFor(row);
      if (!a) continue;
      const p = prevById.get(row.i) ?? row;

      const wasX = a.x, wasZ = a.z;
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
      a.thrownRelic = row.tw ? 1 : null;
      a.guardT = row.gd ? 0.3 : 0;
      a.scars = row.sc ?? 0;
      a.deadT = row.d;
      a.recalled = row.rc === 1;
      a.by = row.by;
      a.target = row.tg ? this.byId.get(row.tg) ?? null : null;

      // the parts the wire never sends, advanced locally so they stay smooth.
      // The legs cycle on DISTANCE, exactly as the sim's own do — the wire
      // client kept them on a clock long after the sim learned better, so
      // every watcher saw strafing and backing-off as skating. One cycle is
      // one stride travelled, whatever the speed; backing up runs it in
      // reverse, and the feet lift whenever the body actually goes anywhere.
      const eff = effectiveGait(a.genome.gait, { tired: 0, angry: a.state === 'fight' ? 0.7 : 0 });
      const ddx = a.x - wasX, ddz = a.z - wasZ;
      const fwd = ddx * Math.cos(a.heading) + ddz * Math.sin(a.heading);
      const lat = -ddx * Math.sin(a.heading) + ddz * Math.cos(a.heading);
      const stride = Math.max(0.08, eff.stride);
      // a first appearance or a respawn is a teleport, not a sprint
      const adv = Math.max(-0.5, Math.min(0.5, (fwd + Math.abs(lat) * 0.5) / stride));
      a.phase = (a.phase + adv + 1) % 1;
      if (dt > 1e-4) {
        const spd = Math.hypot(ddx, ddz) / dt;
        a.move = Math.max(a.move, Math.min(1, spd / Math.max(0.2, stride * eff.cadence)));
      }
      // THE SPRINGS RUN HERE TOO. stepSecondary only ever ran inside the
      // sim's own tick, which a live client never takes — so on every real
      // screen the banking into turns, the head arriving late, the landing
      // weight and the jolt of being hit sat frozen at zero from the day
      // they were written. The wire already carries everything the drive
      // needs: turn rate, move and state; speed comes from the client's own
      // interpolated displacement, and phase is the same one the legs use.
      let rel = 0;
      if (a.target && a.target.deadT < 0 && (a.state === 'fight' || a.state === 'approach')) {
        rel = Math.atan2(a.target.z - a.z, a.target.x - a.x) - a.heading;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
      }
      stepSecondary(a.sec, dt, {
        genome: a.genome, gait: eff, phaseDelta: adv,
        turnRate: a.turnRate,
        move: a.move,
        speed: dt > 1e-4 ? Math.hypot(ddx, ddz) / dt : 0,
        mass: a.bulk,
        lookYaw: Math.max(-1.0, Math.min(1.0, rel)),
        phase: a.phase,
        dead: a.deadT >= 0,
      });
      a.idleT += dt;
      // settling and standing back up, at the sim's own rates — without this
      // a lone lord SAID it was resting while every watcher saw it bolt
      // upright, because rest never crosses the wire
      a.rest = a.state === 'rest'
        ? Math.min(1, a.rest + dt * 0.35)
        : Math.max(0, a.rest - dt * 1.6);
      if (a.hurtT > 0) a.hurtT -= dt;
      if (a.flinch && (a.flinch.t -= dt) <= 0) a.flinch = null;
      if (a.deadT >= 0 && a.strikeT >= 0) { a.strikeT = -1; a.swing = null; }
      if (a.strikeT >= 0) {
        a.strikeT += dt;
        const spec = a.swing ?? (a.ch.behaviors['attack-light'] as any)?.strike;
        // the feint turns on every screen at the same beat
        if (a.swing?.feintPosts && spec && a.strikeT >= spec.duration * spec.windup) {
          a.swing = { ...a.swing, posts: a.swing.feintPosts, feintPosts: undefined, feinted: true };
        }
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

    // shots ride the same interpolated clock as the bodies that loosed them.
    // Stamped raw from the packet they popped along at 12Hz, a quarter-second
    // AHEAD of their archer — arrows materialising beside whoever stood there
    const prevShot = new Map<number, any>(((this.prev.shots ?? []) as any[]).map(s => [s.i, s]));
    this.sim.shots = (this.next.shots as any[]).map((s): Shot => {
      const p = prevShot.get(s.i) ?? s;
      const x = p.x + (s.x - p.x) * u, z = p.z + (s.z - p.z) * u, y = p.y + (s.y - p.y) * u;
      // the trail rides with the head, or it would trail IN FRONT of it
      const ox = x - s.x, oz = z - s.z, oy = y - s.y;
      return {
        id: s.i, x, z, y,
        vx: 0, vz: 0, life: 1,
        // the blast radius is a FACT about the projectile, not a look: it is
        // what tells a watching screen whether that was an arrow ticking off
        // the floor or a fireball going off. Everything else about the
        // effect — how fast, how big, what colour — the client already has.
        spec: {
          speed: 0, range: 0, size: s.r, color: s.c, arcing: false, trail: s.tr.length,
          ...(typeof s.b === 'number' ? { boom: s.b } : {}),
        },
        from: this.sim.agents[0],
        trail: s.tr.map((t: number[]) => ({ x: t[0] + ox, y: t[1] + oy, z: t[2] + oz })),
      };
    });

    // the floor's memory rides the same snapshots. Positions lerp so a kicked
    // bone skitters instead of teleporting between packets.
    // NOTHING POPS. The first snapshot lands a whole floor's worth of bones
    // and plants at once, fully formed — on load the pit flashed into being.
    // The floor already has the right dials: a relic first seen here starts
    // swallowed (sink 1) and rises to its true depth; a plant grows in from
    // nothing. Mid-session drops get the same treatment and it reads as the
    // floor yielding them up, fast enough not to blunt a kill's scatter.
    if (this.next.relics) {
      const prevRelic = new Map<number, any>(((this.prev?.relics ?? []) as any[]).map(r => [r.i, r]));
      this.sim.relics = (this.next.relics as any[]).map(r => {
        const p = prevRelic.get(r.i) ?? r;
        let dy = r.yw - p.yw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        let born = this.relicBorn.get(r.i);
        if (born === undefined) { born = this.clock; this.relicBorn.set(r.i, born); }
        const arrive = Math.min(1, Math.max(0, (this.clock - born) / 0.45));
        return {
          id: r.i, kind: r.k,
          x: p.x + (r.x - p.x) * u, z: p.z + (r.z - p.z) * u,
          vx: 0, vz: 0, yaw: p.yw + dy * u, vyaw: 0,
          sink: 1 - (1 - r.s) * arrive, item: r.it,
        };
      });
      if (this.relicBorn.size > 128) {
        const keep = new Set((this.next.relics as any[]).map(r => r.i));
        for (const id of this.relicBorn.keys()) if (!keep.has(id)) this.relicBorn.delete(id);
      }
    }
    if (this.next.flora) {
      this.sim.flora = (this.next.flora as any[]).map(f => {
        let born = this.floraBorn.get(f.i);
        if (born === undefined) { born = this.clock; this.floraBorn.set(f.i, born); }
        const arrive = Math.min(1, Math.max(0, (this.clock - born) / 0.7));
        return {
          id: f.i, kind: f.k, x: f.x, z: f.z, yaw: f.yw,
          growth: f.g * arrive, hurt: f.h, seed: f.sd,
        };
      });
      if (this.floraBorn.size > 128) {
        const keep = new Set((this.next.flora as any[]).map(f => f.i));
        for (const id of this.floraBorn.keys()) if (!keep.has(id)) this.floraBorn.delete(id);
      }
    }
  }
}
