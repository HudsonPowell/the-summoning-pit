// The five assets the kit was missing. Each proves something no other asset does.
//
//   npx tsx farm/assets.ts kill      the hit-wave, slowed — the best thing the renderer does
//   npx tsx farm/assets.ts nine      one prompt, nine creatures — proof there is no library
//   npx tsx farm/assets.ts lord      the ACTUAL reigning creature, with its real record
//   npx tsx farm/assets.ts two       one world, two watchers, frame-synced
//   npx tsx farm/assets.ts day       the floor's memory accumulating over hours
//   npx tsx farm/assets.ts all
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { PixelRenderer, Camera } from '../src/render';
import { createVoid, stepVoid, spawnChar, spawnOne, strikeSpecOf, VoidSim, Agent } from '../src/void/sim';
import { makeCharacter, migrateCharacter, Character } from '../src/character';
import { migrateGenome, heightOf, Genome } from '../src/genome';
import { solvePose, slashWeight, Capsule, Intent } from '../src/pose';
import { rotY, v3 } from '../src/vec';
import { pitCam, fitCam, writePNG, encode, frameDir, pad, roster, OUT, FPS, STORY, POST, SQUARE, FRONT, LEAD } from './social';

const A = `${OUT}/07-missing`;
mkdirSync(A, { recursive: true });

/**
 * An agent posed AND lit exactly as the live client lights it — including the
 * hit-wave, which lives in the client and had never been rendered offline.
 * Being hit is a wave, not a strobe: a pulse of the body's own colours,
 * brightened, travelling outward from the spot the blow landed and fading as
 * it goes. Without this the kill shot would show a death with no impact.
 */
function litCaps(a: Agent, lordId = -1): Capsule[] {
  // same living idle the live pit runs — parity, so an asset render of a calm
  // creature moves like the site does
  const calm = (a.strikeT >= 0 || a.guardT > 0 || a.deadT >= 0)
    ? 0 : Math.max(0, 1 - a.move * 2.2) * (1 - a.rest * 0.8);
  const it = a.idleT + a.id * 4.7;
  const f = (cy: number, ph = 0) => Math.sin(Math.PI * 2 * (cy / 20) * it + ph);
  const idle = calm > 0.01 ? {
    lookYaw: (0.42 * f(3) + 0.12 * f(7, 1.3)) * calm,
    lean: 0.16 * f(2, 0.6) * calm,
    twist: 0.14 * f(5) * calm,
    bob: 0.018 * f(4, 2.1) * calm,
    jiggle: 0.04 * f(6) * calm,
  } : { lookYaw: 0, lean: 0, twist: 0, bob: 0, jiggle: 0 };
  const mood = { tired: 0, angry: a.state === 'fight' ? 0.75 : a.state === 'approach' ? 0.35 : 0 };
  let intent: Intent | undefined;
  if (a.strikeT >= 0) {
    const spec = strikeSpecOf(a);
    const u = Math.min(1, a.strikeT / (spec?.duration ?? 0.5));
    intent = { slash: { t: u, weight: slashWeight(u), spec } };
  }
  const caps = solvePose(a.genome, mood, a.phase, a.move, a.idleT, intent,
    a.deadT >= 0 ? Math.min(1, a.deadT / 0.5)
      : Math.min(0.9, a.rest * 0.72 + (a.flinch && a.flinch.h < 0.35 ? 0.22 * (a.flinch.t / 0.5) : 0)),
    {
      weapon: a.thrownRelic != null ? undefined : a.ch.weapon,
      offhand: a.ch.offhand, gear: a.ch.gear as any, turn: a.turnRate,
      lookYaw: Math.max(-1.1, Math.min(1.1, a.sec.head + idle.lookYaw
        + (a.flinch && a.flinch.h > 0.75 ? a.flinch.side * 0.8 * (a.flinch.t / 0.5) : 0))),
      lean: a.sec.lean + idle.lean, twist: a.sec.twist + idle.twist,
      bob: a.sec.bob + idle.bob, jiggle: a.sec.jiggle + idle.jiggle,
      breatheAmp: 1 + calm * 1.2,
    });
  const wave = a.flinch;
  const waveAge = wave ? 1 - wave.t / 0.5 : 0;
  const waveR = waveAge * a.bulk * 1.9;
  const waveAmp = wave ? Math.pow(wave.t / 0.5, 0.6) * 1.5 : 0;
  const sigma = Math.max(0.12, a.bulk * 0.3);
  const spotY = wave ? a.bulk * wave.h : 0;
  const spotZ = wave ? wave.side * a.bulk * 0.18 : 0;
  const fade = a.deadT >= 0 ? Math.max(0, 1 - Math.max(0, a.deadT - 2) / 1.5) : 1;
  const yaw = -(a.heading + a.sec.spin);
  return caps.map(c => {
    const p = rotY(c.a, yaw), q = rotY(c.b, yaw);
    let col: [number, number, number] = [c.color[0] * fade, c.color[1] * fade, c.color[2] * fade];
    if (wave && waveAmp > 0.02) {
      const mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2, mz = (c.a.z + c.b.z) / 2;
      const d = Math.hypot(mx * 0.6, my - spotY, mz - spotZ);
      const g = Math.exp(-((d - waveR) * (d - waveR)) / (2 * sigma * sigma)) * waveAmp;
      if (g > 0.03) {
        const k = 1 + g;
        col = [Math.min(255, col[0] * k + 40 * g), Math.min(255, col[1] * k + 40 * g), Math.min(255, col[2] * k + 40 * g)];
      }
    }
    return { ...c, a: v3(p.x + a.x, p.y, p.z + a.z), b: v3(q.x + a.x, q.y, q.z + a.z), color: col };
  });
}

const scene = (sim: VoidSim, lordId = -1): Capsule[] => {
  const caps: Capsule[] = [];
  for (const pr of sim.props) caps.push(...pr.caps);
  for (const a of sim.agents) caps.push(...litCaps(a, lordId));
  return caps;
};

// ---------------------------------------------------------------- 1 · THE KILL

/**
 * The blow, at a third speed. The pit simulates at its own rate and the camera
 * samples three times as often, so the wave is seen travelling rather than
 * inferred from one bright frame.
 */
function kill(size = STORY): void {
  const cast = roster();
  const dt = 1 / FPS;
  // Left alone the pit fights on its own. Forcing state='fight' each frame
  // pinned both creatures at arm's length forever, because APPROACH is the
  // state that closes the distance — the sim was being prevented from doing
  // the one thing it was being asked for.
  const build = (seed: number) => {
    const sim = createVoid(cast, 0);
    const a = spawnChar(sim, cast[(seed * 3) % cast.length], 'A');
    const b = spawnChar(sim, cast[(seed * 5 + 1) % cast.length], 'B');
    a.x = -1.4; a.z = 0; b.x = 1.4; b.z = 0;
    a.hp = a.maxHp = 3; b.hp = b.maxHp = 14;
    return { sim, a, b };
  };

  for (let attempt = 0; attempt < 24; attempt++) {
    // find the blow first, so the camera can be there before it lands
    const probe = build(attempt);
    let killAt = -1;
    for (let f = 0; f < FPS * 90 && killAt < 0; f++) {
      stepVoid(probe.sim, dt);
      if (probe.sim.events.some(e => e.kind === 'kill')) killAt = f;
    }
    if (killAt < 0) continue;

    const { sim, a: fighterA, b: fighterB } = build(attempt);
    const { w, h } = size;
    const r = new PixelRenderer(w, h);
    const dir = frameDir('kill');
    const from = Math.max(0, killAt - FPS * 3);
    let out = 0;
    for (let f = 0; f <= killAt + FPS * 3; f++) {
      // a third speed from just before the blow until the body settles
      const slow = f >= killAt - 8 && f <= killAt + FPS * 2;
      const sub = slow ? 3 : 1;
      for (let s = 0; s < sub; s++) {
        stepVoid(sim, dt / sub);
        if (f < from) break;
        // Hold the two by REFERENCE. The pit culls a corpse a few seconds
        // after it falls, so reading sim.agents[1] mid-shot eventually reads
        // past the end — the agent object outlives its place in the array.
        const mx = (fighterA.x + fighterB.x) / 2, mz = (fighterA.z + fighterB.z) / 2;
        const sep = Math.hypot(fighterA.x - fighterB.x, fighterA.z - fighterB.z);
        const buf = new Uint8ClampedArray(w * h * 4);
        r.render(buf, scene(sim), pitCam({
          ppm: Math.max(150, Math.min(430, w / Math.max(2.1, sep + 1.8))),
          yaw: 0.45 + out * 0.0016, cx: mx, cz: mz, cy: 1.05, pitch: 0.22,
        }), 0);
        writePNG(`${dir}/${pad(out++)}.png`, w, h, buf);
      }
    }
    console.log(`kill: ${out} frames, blow at ${(killAt / FPS).toFixed(1)}s, slowed to a third through it`);
    encode(dir, `${A}/kill-${size.tag}.mp4`, 'mp4');
    return;
  }
  console.log('kill: no clean kill found in 24 attempts');
}

// ------------------------------------------------------- 2 · NINE FROM ONE PROMPT

/** One sentence, nine bodies. The only asset that disproves a library. */
async function nine(prompt = 'a horned marsh troll with a rusted cleaver'): Promise<void> {
  const { hatchGenome } = await import('../src/hatch');
  const CELL = 460, COLS = 3;
  const sheet = new PNG({ width: CELL * COLS, height: CELL * 3 });
  // paint the ground first: a cell that fails to hatch must read as empty
  // pit, not as a white hole punched in the sheet
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = 0; sheet.data[i+1] = 0; sheet.data[i+2] = 0; sheet.data[i+3] = 255;
  }
  const r = new PixelRenderer(CELL, CELL);
  const once = (i: number, temp: number) =>
    hatchGenome(prompt, undefined, undefined, undefined, temp)
      .then(g => ({ i, g })).catch(() => null);
  const jobs = Array.from({ length: 9 }, (_, i) =>
    once(i, 0.75 + (i % 5) * 0.08).then(v => v ?? once(i, 0.85)));   // one retry each
  const done = (await Promise.all(jobs)).filter(Boolean) as { i: number; g: Genome }[];
  for (const { i, g } of done) {
    const ch = makeCharacter(g, 'beast');
    const caps = solvePose(g, { tired: 0, angry: 0 }, 0.22, 0, 1.1, undefined, 0,
      { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any });
    const buf = new Uint8ClampedArray(CELL * CELL * 4);
    r.render(buf, caps, fitCam(caps, CELL, CELL, 0.72, { yaw: 0.6 }), 0);
    const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const s = (y * CELL + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data[d] = buf[s]; sheet.data[d+1] = buf[s+1]; sheet.data[d+2] = buf[s+2]; sheet.data[d+3] = 255;
    }
  }
  writeFileSync(`${A}/nine-from-one-prompt.png`, PNG.sync.write(sheet));
  console.log(`nine: ${done.length}/9 hatched — "${prompt}"`);
  console.log(`  ${A}/nine-from-one-prompt.png`);
}

// --------------------------------------------------------------- 3 · THE LORD

/**
 * Not a demo creature: the one actually holding the pit, pulled off the live
 * wire with its real record. A specific individual with a history is the
 * difference between a tech demo and a world.
 */
async function lord(size = POST): Promise<void> {
  const WebSocket = (await import('ws')).default;
  const got = await new Promise<any>(res => {
    const ws = new (WebSocket as any)('wss://thesummoningpit.com');
    let cast: any[] = [];
    const timer = setTimeout(() => { try { ws.close(); } catch {} res(null); }, 25000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'key' })));
    ws.on('message', (raw: any) => {
      const m = JSON.parse(String(raw));
      if (m.cast) cast = m.cast;
      if (!m.agents || !cast.length) return;
      const live = m.agents.filter((x: any) => x.d < 0);
      if (!live.length) return;
      const best = live.sort((p: any, q: any) => (q.k ?? 0) - (p.k ?? 0))[0];
      clearTimeout(timer); try { ws.close(); } catch {}
      // the wire sends cast entries as { id, ch } envelopes, not bare characters
      res({ row: best, ch: cast[best.c]?.ch ?? cast[best.c] });
    });
  });
  if (!got) { console.log('lord: the pit did not answer'); return; }

  const ch: Character = migrateCharacter(got.ch);
  const g = ch.genome as Genome;
  const { w, h } = size;
  const r = new PixelRenderer(w, h);
  const dir = frameDir('lord');
  const SECS = 20, LOOP = FPS * SECS;
  const posed = (u: number) => solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, u * SECS, undefined, 0,
    { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any,
      lookYaw: 0.5 * Math.sin(Math.PI * 2 * 3 * u), lean: 0.24 * Math.sin(Math.PI * 2 * 2 * u),
      twist: 0.2 * Math.sin(Math.PI * 2 * 5 * u), bob: 0.016 * Math.sin(Math.PI * 2 * 4 * u),
      breatheAmp: 2.2 });
  const probe: Capsule[] = [];
  for (let i = 0; i < 16; i++) probe.push(...posed(i / 16));
  const fitted = fitCam(probe, w, h, 0.60);
  for (let f = 0; f < LOOP; f++) {
    const u = f / LOOP;
    const buf = new Uint8ClampedArray(w * h * 4);
    r.render(buf, posed(u), { ...fitted, yaw: FRONT - LEAD + u * Math.PI * 2, voidColor: [0, 0, 0] }, 0);
    writePNG(`${dir}/${pad(f)}.png`, w, h, buf);
  }
  console.log(`lord: ${ch.name} — ${got.row.k ?? 0} kills, ${got.row.hp}/${got.row.mx} hp, ${got.row.sc ?? 0} scars`);
  writeFileSync(`${A}/lord-record.txt`,
    `${ch.name}\n${got.row.k ?? 0} kills\n${got.row.hp} of ${got.row.mx} hp\n` +
    `${got.row.sc ?? 0} scars that will not heal\n`);
  encode(dir, `${A}/lord-${size.tag}.mp4`, 'mp4');
}

// ------------------------------------------------------ 4 · TWO SCREENS, ONE WORLD

/**
 * The shared-world claim is only ever asserted. This shows it: one simulation,
 * two cameras, the same instant, side by side — each watcher framing a
 * different creature while the same blows land on both.
 */
function two(seconds = 12): void {
  const cast = roster();
  const sim = createVoid(cast, 0);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = spawnChar(sim, cast[i % cast.length], `w${i}`);
    const ang = (i / n) * Math.PI * 2;
    a.x = Math.cos(ang) * 2.2; a.z = Math.sin(ang) * 2.2;
    a.heading = ang + Math.PI; a.hp = a.maxHp = 9;
  }
  const dt = 1 / FPS;
  for (let i = 0; i < 12 * FPS; i++) {
    stepVoid(sim, dt);
    if (i % 30 === 0) for (const a of sim.agents) if (a.deadT < 0) a.hp = a.maxHp;
  }
  const HALF = 540, H = 1350;                       // two 4:5 screens, side by side
  const r = new PixelRenderer(HALF, H);
  const dir = frameDir('two');
  const total = seconds * FPS;
  const pick = () => sim.agents.filter(a => a.deadT < 0);
  let heroA = pick()[0], heroB = pick()[pick().length - 1];
  let pA = 0, pB = 0, xA = 0, zA = 0, xB = 0, zB = 0;
  for (let f = 0; f < total; f++) {
    stepVoid(sim, dt);
    const live = pick();
    if (heroA.deadT >= 0) heroA = live[0] ?? heroA;
    if (heroB.deadT >= 0) heroB = live[live.length - 1] ?? heroB;
    const frame = new PNG({ width: HALF * 2 + 2, height: H });
    [[heroA, 0], [heroB, HALF + 2]].forEach(([hero, ox]: any, idx) => {
      const foe = hero.target && hero.target.deadT < 0 ? hero.target : null;
      const cx = foe ? (hero.x + foe.x) / 2 : hero.x;
      const cz = foe ? (hero.z + foe.z) / 2 : hero.z;
      const need = (foe ? Math.hypot(hero.x - foe.x, hero.z - foe.z) : 1.6) + 3.2;
      const want = Math.max(120, Math.min(360, HALF / need));
      if (idx === 0) { pA = pA ? pA + (want - pA) * 0.06 : want; xA += (cx - xA) * 0.07; zA += (cz - zA) * 0.07; }
      else { pB = pB ? pB + (want - pB) * 0.06 : want; xB += (cx - xB) * 0.07; zB += (cz - zB) * 0.07; }
      const buf = new Uint8ClampedArray(HALF * H * 4);
      r.render(buf, scene(sim), pitCam({
        ppm: idx === 0 ? pA : pB, yaw: idx === 0 ? 0.35 : 3.6,
        cx: idx === 0 ? xA : xB, cz: idx === 0 ? zA : zB, cy: 1.2,
      }), 0);
      for (let y = 0; y < H; y++) for (let x = 0; x < HALF; x++) {
        const s = (y * HALF + x) * 4, d = (y * frame.width + ox + x) * 4;
        frame.data[d] = buf[s]; frame.data[d+1] = buf[s+1]; frame.data[d+2] = buf[s+2]; frame.data[d+3] = 255;
      }
    });
    for (let y = 0; y < H; y++) {                    // the seam between two screens
      const d = (y * frame.width + HALF) * 4;
      frame.data[d] = 90; frame.data[d+1] = 88; frame.data[d+2] = 84; frame.data[d+3] = 255;
      frame.data[d+4] = 90; frame.data[d+5] = 88; frame.data[d+6] = 84; frame.data[d+7] = 255;
    }
    writeFileSync(`${dir}/${pad(f)}.png`, PNG.sync.write(frame));
    if (f % 60 === 0) process.stdout.write(`  two ${f}/${total}\r`);
  }
  console.log(`\ntwo screens: ${total} frames at ${HALF * 2 + 2}x${H}`);
  encode(dir, `${A}/two-screens-one-world.mp4`, 'mp4');
}

// ------------------------------------------------------------ 5 · A DAY IN THE PIT

/**
 * Persistence is invisible in fifteen seconds and obvious in a compressed day.
 * The floor keeps everything: bones collect, dropped arms sink, plants are
 * trampled and grow back. Sampled every few sim-minutes.
 */
function day(hours = 6, size = SQUARE): void {
  const cast = roster();
  const sim = createVoid(cast, 0);
  for (let i = 0; i < 6; i++) spawnOne(sim, true);
  const { w, h } = size;
  const r = new PixelRenderer(w, h);
  const dir = frameDir('day');
  const dt = 1 / 20;                              // coarse steps; nobody is watching closely
  const total = hours * 3600;
  const every = 6;                                // one frame per 6 sim-seconds
  let shot = 0, since = 0;
  for (let t = 0; t < total; t += dt) {
    stepVoid(sim, dt);
    // keep the pit populated, the way summoners do
    if (sim.agents.filter(a => a.deadT < 0).length < 4 && Math.random() < dt * 0.4) spawnOne(sim, true);
    since += dt;
    if (since < every) continue;
    since = 0;
    const buf = new Uint8ClampedArray(w * h * 4);
    r.render(buf, scene(sim), pitCam({ ppm: (h * 0.46) / 6.2, yaw: 0.3 + t * 0.00002, cy: 1.0 }), 0);
    writePNG(`${dir}/${pad(shot++)}.png`, w, h, buf);
    if (shot % 120 === 0) process.stdout.write(`  day ${(t / 3600).toFixed(1)}h / ${hours}h\r`);
  }
  console.log(`\nday: ${shot} frames — ${hours}h compressed to ${(shot / FPS).toFixed(0)}s, relics ${sim.relics.length}, flora ${sim.flora.length}`);
  encode(dir, `${A}/a-day-in-the-pit.mp4`, 'mp4');
}

// --------------------------------------------------------------------- run

const what = process.argv[2] ?? 'all';
if (what === 'kill' || what === 'all') kill();
if (what === 'two' || what === 'all') two();
if (what === 'day' || what === 'all') day(Number(process.argv[3] ?? 6));
if (what === 'nine' || what === 'all') await nine(process.argv[3]);
if (what === 'lord' || what === 'all') await lord();
console.log(`\nin ${A}/`);
