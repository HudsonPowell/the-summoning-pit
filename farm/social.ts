// Social assets, rendered at full delivery resolution.
//
// The renderer marches the capsule field per PIXEL, so it is resolution
// independent: asking for 1080x1920 gives real detail at 1080x1920, not a
// small buffer blown up. Nothing here upscales.
//
//   npx tsx farm/social.ts title      the wire title, three backgrounds
//   npx tsx farm/social.ts arena [s]  a pit full of creatures fighting
//   npx tsx farm/social.ts idles      single creatures, idling, on black
//   npx tsx farm/social.ts grid       a bestiary card
//   npx tsx farm/social.ts all
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { PixelRenderer, Camera } from '../src/render';
import { createVoid, stepVoid, spawnChar, strikeSpecOf, VoidSim, Agent } from '../src/void/sim';
import { makeCharacter, migrateCharacter, Character } from '../src/character';
import { migrateGenome, heightOf, Genome } from '../src/genome';
import * as EXEMPLARS from '../src/genome';
import { solvePose, slashWeight, Capsule, Intent } from '../src/pose';
import { WireTitle } from '../src/void/wiretitle';
import { weaponsFromWords } from '../src/smith';
import { gearFromWords } from '../src/gear';
import { rotY, v3 } from '../src/vec';

const OUT = 'farm/out/social';
const FPS = 30;

export interface Size { w: number; h: number; tag: string }
const STORY: Size = { w: 1080, h: 1920, tag: 'story' };      // 9:16
const POST: Size = { w: 1080, h: 1350, tag: 'post' };        // 4:5
const SQUARE: Size = { w: 1080, h: 1080, tag: 'square' };    // 1:1

/**
 * The soft field, in METRES.
 *
 * `blend` is a softness in PIXELS, and the whole look — bodies reading as one
 * mass, limbs melting into the torso — is that softness measured against the
 * size of a creature on screen. The pit runs a coarse buffer where 1.8px is
 * about a fiftieth of a body; asked for the same 1.8 at delivery resolution
 * it becomes a two-hundredth, and the field turns to hard-edged sticks that
 * happen to be the right shape. The number to hold constant is the WORLD
 * distance the field melts across, so blend follows the zoom.
 */
const BLEND_M = 0.030;

/** The look Jody settled on, exactly as the pit renders it. */
function pitCam(over: Partial<Camera> = {}): Camera {
  const ppm = over.ppm ?? 200;
  return {
    yaw: 0.6, pitch: 0.34, cy: 0.9, cx: 0, cz: 0,
    tile: 1, flat: true, blendShape: 0.6, blendMix: 1, blendDepth: 0.35,
    floorRadius: 12, floorPower: 2.4, floorLift: 1,
    floorSquash: Math.max(0.12, 1 + (Math.sin(0.34) - 1) * 1),
    voidColor: [0, 0, 0], floorColorA: [42, 47, 58], floorColorB: [34, 38, 47],
    ...over,
    ppm,
    blend: over.blend ?? ppm * BLEND_M,
  };
}

// --- rendering --------------------------------------------------------------

/**
 * A frame with real alpha. The renderer paints a background into every pixel
 * it does not cover, so coverage is recovered by rendering the same frame
 * against black and against white: what does not move is the creature, what
 * moves by 255 is empty air, and the in-between is a soft edge. Exact, and it
 * does not care how the background is drawn.
 */
function renderRGBA(r: PixelRenderer, w: number, h: number, caps: Capsule[], cam: Camera): Uint8ClampedArray {
  const onBlack = new Uint8ClampedArray(w * h * 4);
  const onWhite = new Uint8ClampedArray(w * h * 4);
  r.render(onBlack, caps, { ...cam, floor: false, voidColor: [0, 0, 0] }, 0);
  r.render(onWhite, caps, { ...cam, floor: false, voidColor: [255, 255, 255] }, 0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    // alpha from any channel: white-bg minus black-bg is the uncovered part
    const a = 255 - (onWhite[o] - onBlack[o]);
    out[o + 3] = a;
    if (a > 0) {                       // un-premultiply back to straight colour
      out[o] = Math.min(255, onBlack[o] * 255 / a);
      out[o + 1] = Math.min(255, onBlack[o + 1] * 255 / a);
      out[o + 2] = Math.min(255, onBlack[o + 2] * 255 / a);
    }
  }
  return out;
}

/** Composite straight-alpha pixels over a background painter. */
function over(rgba: Uint8ClampedArray, w: number, h: number,
              bg: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, a = rgba[o + 3] / 255;
    const [br, bg2, bb] = bg(x, y);
    out[o] = rgba[o] * a + br * (1 - a);
    out[o + 1] = rgba[o + 1] * a + bg2 * (1 - a);
    out[o + 2] = rgba[o + 2] * a + bb * (1 - a);
    out[o + 3] = 255;
  }
  return out;
}

function writePNG(path: string, w: number, h: number, rgba: Uint8ClampedArray): void {
  const png = new PNG({ width: w, height: h });
  png.data.set(rgba);
  writeFileSync(path, PNG.sync.write(png));
}

/** Frames on disk become a file people can actually post. */
function encode(dir: string, out: string, kind: 'mp4' | 'alpha-mov' | 'webm' | 'gif'): void {
  const inp = ['-y', '-framerate', String(FPS), '-i', `${dir}/%04d.png`];
  const args: Record<string, string[]> = {
    'mp4': [...inp, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-movflags', '+faststart', out],
    'alpha-mov': [...inp, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', out],
    'webm': [...inp, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '20', '-b:v', '0', out],
    'gif': [...inp, '-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse', out],
  };
  execFileSync('ffmpeg', ['-loglevel', 'error', ...args[kind]]);
  console.log(`  ${out}`);
}

const frameDir = (name: string) => {
  const d = `${OUT}/.frames-${name}`;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
};
const pad = (n: number) => String(n).padStart(4, '0');

// --- the cast ---------------------------------------------------------------

function roster(): Character[] {
  const out: Character[] = [];
  const seen = new Set<string>();
  for (const dir of ['characters', 'genomes']) {
    let files: string[] = [];
    try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      try {
        const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
        const ch = dir === 'characters'
          ? migrateCharacter(raw)
          : makeCharacter(migrateGenome(raw), 'beast');
        const key = ch.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ch);
      } catch { /* skip the unreadable */ }
    }
  }
  return out;
}

/**
 * The widest cast the repo can offer: the pit's saved creatures first, then
 * the hand-built exemplars, which carry the shapes the saved ones do not —
 * serpent, spider, hydra, hippo. Four variants of one biped make a poor set
 * of eighteen portraits.
 */
/**
 * The armoury, worn by somebody.
 *
 * The saved creatures carry whatever they happened to be summoned with, which
 * is a poor advertisement for a game whose weapons are designed per creature.
 * These are built: a loadout in words, put through the same smith and the same
 * gear tables the pit uses, on a body chosen to suit it. Nothing here is
 * special-cased for the camera — it is the armoury, worn.
 */
const LOADOUTS: [string, string][] = [
  ['knight',      'a knight in heavy plate with a greatsword and a kite shield'],
  ['ranger',      'a hooded ranger with a tall longbow and a quiver'],
  ['wizard',      'a robed wizard with a gnarled staff'],
  ['crossbowman', 'a bolt-shooter with a heavy crossbow and a helm'],
  ['spearman',    'a scaled spearman with a long spear and a buckler'],
  ['axeman',      'a horned barbarian with a great axe'],
  ['maul',        'an armoured brute with a war maul and heavy plate'],
  ['flail',       'a chained warden with a flail and a shield'],
  ['whip',        'a lean duellist with a whip and a torch'],
  ['rapier',      'a masked fencer with a rapier and a cloak'],
  ['scythe',      'a hooded reaper with a long scythe'],
  ['trident',     'a deep-sea warrior with a trident'],
  ['daggers',     'a masked cutter with twin daggers'],
  ['orb',         'a shrouded seer with a floating orb and a cloak'],
  ['tome',        'a scholar with a heavy grimoire'],
  ['katana',      'a wandering swordsman with a katana'],
  ['cleaver',     'a butcher with a huge cleaver and a lantern'],
  ['shortbow',    'a goblin raider with a shortbow'],
];

function armouryCast(): Character[] {
  const bodies = roster();
  const out: Character[] = [];
  LOADOUTS.forEach(([tag, desc], i) => {
    const base = bodies[(i * 5 + 3) % Math.max(1, bodies.length)];
    const g: Genome = migrateGenome(JSON.parse(JSON.stringify(base.genome)));
    const arms = weaponsFromWords(desc);
    g.weapon = arms.main as any;
    g.offhand = arms.off as any;
    g.gear = gearFromWords(desc) as any;
    const ch = makeCharacter(g, 'beast');
    ch.name = tag;
    out.push(ch);
  });
  return out;
}

function idleCast(): Character[] {
  const out = roster();
  const seen = new Set(out.map(c => c.name.toLowerCase()));
  const names = ['hound', 'troll', 'ogre', 'hippo', 'serpent', 'raptor', 'spider',
    'hydra', 'imp', 'walkingShrine', 'drifter', 'lasher'] as const;
  for (const n of names) {
    const mk = (EXEMPLARS as any)[n];
    if (typeof mk !== 'function') continue;
    const g = migrateGenome(JSON.parse(JSON.stringify(mk())));
    g.name = g.name || n;
    const ch = makeCharacter(g, 'beast');
    ch.name = n;
    if (seen.has(ch.name.toLowerCase())) continue;
    seen.add(ch.name.toLowerCase());
    out.push(ch);
  }
  return out;
}

/**
 * Frame a creature by what it ACTUALLY occupies, not by its nominal height.
 * A lasher is mostly horizontal and a shrine is mostly vertical; sizing both
 * off a single number leaves one lost in the middle of the frame and the
 * other clipped. The horizontal measure is a radius about the origin, so it
 * holds however far the camera swings round.
 */
function fitCam(caps: Capsule[], w: number, h: number, fill: number, over: Partial<Camera> = {},
                bodyOnly = false): Camera {
  let reach = 0.2, minY = Infinity, maxY = -Infinity;
  for (const c of caps) {
    // A pike held out at arm's length is three times the width of the creature
    // carrying it, and fitting to that shrinks the creature to nothing while
    // the frame fills with stick. Portraits fit the BODY and let the weapon
    // run past the edge, which is how a portrait has always worked.
    if (bodyOnly && (c.part === 'weapon' || c.part === 'blade')) continue;
    for (const p of [c.a, c.b] as any[]) {
      reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
      minY = Math.min(minY, p.y - c.r);
      maxY = Math.max(maxY, p.y + c.r);
    }
  }
  const tall = Math.max(0.4, maxY - minY), wide = Math.max(0.4, reach * 2);
  const ppm = Math.min((h * fill) / tall, (w * fill) / wide);
  return pitCam({ ppm, cy: (minY + maxY) / 2, floor: false, ...over });
}

/** An agent, posed in the world, exactly as the pit poses it. */
function agentCaps(ag: Agent): Capsule[] {
  let intent: Intent | undefined;
  if (ag.strikeT >= 0) {
    const spec = strikeSpecOf(ag);
    const u = Math.min(1, ag.strikeT / (spec?.duration ?? 0.5));
    intent = { slash: { t: u, weight: slashWeight(u), spec } };
  }
  const cs = solvePose(ag.genome, { tired: 0, angry: ag.state === 'fight' ? 0.7 : 0 },
    ag.phase, ag.move, ag.idleT, intent,
    ag.deadT >= 0 ? Math.min(1, ag.deadT / 0.5) : ag.rest * 0.72,
    { weapon: ag.ch.weapon, offhand: ag.ch.offhand, gear: ag.ch.gear as any, turn: ag.turnRate,
      lookYaw: Math.max(-0.9, Math.min(0.9, ag.sec.head)),
      lean: ag.sec.lean, twist: ag.sec.twist, bob: ag.sec.bob, jiggle: ag.sec.jiggle });
  const yaw = -(ag.heading + ag.sec.spin);
  return cs.map(c => {
    const a2 = rotY(c.a, yaw), b2 = rotY(c.b, yaw);
    return { ...c, a: v3(a2.x + ag.x, a2.y, a2.z + ag.z), b: v3(b2.x + ag.x, b2.y, b2.z + ag.z) };
  });
}

// --- 1. the title -----------------------------------------------------------

/**
 * The wire title, framed as the pit frames it, delivered three ways: over
 * nothing at all (alpha, for dropping onto anything), over the pit's own
 * black, and over a black-to-white ramp.
 */
function title(size: Size = STORY): void {
  mkdirSync(OUT, { recursive: true });
  const { w, h } = size;
  // the pit's own title framing: 4.4m of pit across the shorter measure
  const reach = 4.4;
  const ppm = (h * 0.46) / reach;
  const frameW = (w * reach) / (0.46 * h);
  const r = new PixelRenderer(w, h);
  const t = new WireTitle('the summoning pit', frameW);

  const dirs = {
    alpha: frameDir('title-alpha'),
    black: frameDir('title-black'),
    gradient: frameDir('title-gradient'),
  };
  let n = 0;
  const dt = 1 / FPS;
  let yaw = 0.6;
  while (!t.done && n < FPS * 14) {
    const caps = t.caps(dt, yaw);
    yaw += dt * 0.045;                         // the pit's slow turn
    const cam = pitCam({ ppm, yaw, cy: 1.5, floor: false });
    const rgba = renderRGBA(r, w, h, caps, cam);
    writePNG(`${dirs.alpha}/${pad(n)}.png`, w, h, rgba);
    writePNG(`${dirs.black}/${pad(n)}.png`, w, h, over(rgba, w, h, () => [0, 0, 0]));
    writePNG(`${dirs.gradient}/${pad(n)}.png`, w, h, over(rgba, w, h, (_x, y) => {
      // black at the top, paper at the foot — the word rises out of the dark
      const u = y / (h - 1), k = u * u * 0.92;
      return [10 + k * 236, 9 + k * 236, 12 + k * 234];
    }));
    n++;
  }
  console.log(`title: ${n} frames at ${w}x${h}`);
  encode(dirs.black, `${OUT}/title-black-${size.tag}.mp4`, 'mp4');
  encode(dirs.gradient, `${OUT}/title-gradient-${size.tag}.mp4`, 'mp4');
  encode(dirs.alpha, `${OUT}/title-transparent-${size.tag}.mov`, 'alpha-mov');
  encode(dirs.alpha, `${OUT}/title-transparent-${size.tag}.webm`, 'webm');
  // one still of each, for a post that does not move
  writePNG(`${OUT}/title-still-transparent.png`, w, h,
    (() => { const t2 = new WireTitle('the summoning pit', frameW);
      let c: Capsule[] = []; for (let i = 0; i < FPS * 4; i++) c = t2.caps(dt, 0.6);
      return renderRGBA(r, w, h, c, pitCam({ ppm, yaw: 0.6, cy: 1.5, floor: false })); })());
  console.log(`  ${OUT}/title-still-transparent.png`);
}

// --- 2. the arena -----------------------------------------------------------

/**
 * A pit full of creatures, fighting.
 *
 * Two framings, because the shape of the frame decides the shot. A 9:16 story
 * is a narrow window: nine creatures spread across a pit become nine specks in
 * it, so the story cut rides the nearest FIGHT and lets the rest of the crowd
 * pass through the edges. A square takes the whole room in and is the one to
 * use when the point is how many of them there are.
 *
 * Either way the clip opens mid-brawl. Recording from the spawn ring means
 * fifteen seconds of strangers walking toward each other.
 */
function arena(seconds = 15, sizes: Size[] = [STORY, SQUARE]): void {
  mkdirSync(OUT, { recursive: true });
  const cast = roster();
  for (const size of sizes) {
    const { w, h } = size;
    const tight = h / w > 1.2;             // a narrow frame must go in close
    const sim: VoidSim = createVoid(cast, 0);
    // as many as the pit has faces for — a crowd is the point
    const n = Number(process.env.CROWD ?? 20);
    for (let i = 0; i < n; i++) {
      const ch = cast[i % cast.length];
      const a = spawnChar(sim, ch, `crowd${i}`);
      // two rings, offset, so nobody spawns inside anybody
      const ring = i % 2, k = Math.floor(i / 2);
      const ang = (k / Math.ceil(n / 2)) * Math.PI * 2 + ring * 0.4;
      const rad = ring ? 3.0 : 1.7;
      a.x = Math.cos(ang) * rad; a.z = Math.sin(ang) * rad;
      a.heading = ang + Math.PI;
      a.hp = a.maxHp = 9;
    }
    const dt = 1 / FPS;
    // warm the pit until it is actually fighting, topping everyone up so the
    // brawl is still full when the camera opens
    for (let i = 0; i < 14 * FPS; i++) {
      stepVoid(sim, dt);
      if (i % 30 === 0) for (const a of sim.agents) if (a.deadT < 0) a.hp = a.maxHp;
    }

    const r = new PixelRenderer(w, h);
    const dir = frameDir(`arena-${size.tag}`);
    const total = seconds * FPS;
    let yaw = 0.35, camPpm = 0, camX = 0, camZ = 0;
    for (let f = 0; f < total; f++) {
      stepVoid(sim, dt);
      const live = sim.agents.filter(a => a.deadT < 0);
      // A FIGHT OUTRANKS THE CROWD — the pit's own rule, and the reason the
      // shot has a subject instead of an average.
      const duel = live.find(a => (a.state === 'fight' || a.state === 'approach')
        && a.target && a.target.deadT < 0);
      let cx: number, cz: number, need: number;
      if (duel && duel.target && tight) {
        const t2 = duel.target;
        cx = (duel.x + t2.x) / 2; cz = (duel.z + t2.z) / 2;
        need = Math.hypot(duel.x - t2.x, duel.z - t2.z) + 3.0;
      } else {
        cx = live.reduce((s, a) => s + a.x, 0) / Math.max(1, live.length);
        cz = live.reduce((s, a) => s + a.z, 0) / Math.max(1, live.length);
        const spread = live.map(a => Math.hypot(a.x - cx, a.z - cz)).sort((p, q) => p - q);
        need = (spread.length ? spread[Math.floor(spread.length * 0.8)] : 3) * 2 + 2.4;
      }
      // metres across the SHORT edge decide the size of a body on screen
      const wantPpm = Math.max(120, Math.min(430, w / Math.max(2.6, need)));
      camPpm = camPpm ? camPpm + (wantPpm - camPpm) * 0.035 : wantPpm;
      camX += (cx - camX) * 0.045;
      camZ += (cz - camZ) * 0.045;
      yaw += dt * 0.05;
      const caps: Capsule[] = [];
      for (const pr of sim.props) caps.push(...pr.caps);
      for (const a of sim.agents) caps.push(...agentCaps(a));
      const buf = new Uint8ClampedArray(w * h * 4);
      // sit the action on the frame's middle third, so a caption can live above
      r.render(buf, caps, pitCam({ ppm: camPpm, yaw, cx: camX, cz: camZ, cy: tight ? 1.5 : 1.0 }), sim.t);
      writePNG(`${dir}/${pad(f)}.png`, w, h, buf);
      if (f % 60 === 0) process.stdout.write(`  arena ${size.tag} ${f}/${total}\r`);
    }
    console.log(`\narena ${size.tag}: ${total} frames at ${w}x${h}`);
    encode(dir, `${OUT}/arena-${size.tag}.mp4`, 'mp4');
  }
}

// --- 3. single creatures, idling, on black ----------------------------------

/** One creature, breathing, turning slowly, on nothing. Stills and a loop. */
function idles(size: Size = POST, count = 8): void {
  mkdirSync(OUT, { recursive: true });
  const { w, h } = size;
  const cast = armouryCast().slice(0, count);
  const r = new PixelRenderer(w, h);
  const sheetCols = 4, cell = 420;
  const rSheet = new PixelRenderer(cell, cell);
  const rows = Math.ceil(cast.length / sheetCols);
  const sheet = new PNG({ width: cell * sheetCols, height: cell * rows });

  cast.forEach((ch, i) => {
    const g = ch.genome as Genome;
    const height = Math.max(0.5, heightOf(g));
    const still = solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, 1.4, undefined, 0,
      { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any });
    // portrait framing: the creature stands in the lower third, air above
    const cam = fitCam(still, w, h, 0.66, { yaw: 0.6 });
    const rgba = renderRGBA(r, w, h, still, cam);
    const name = ch.name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    writePNG(`${OUT}/idle-${name}-${size.tag}.png`, w, h, over(rgba, w, h, () => [0, 0, 0]));
    writePNG(`${OUT}/idle-${name}-alpha.png`, w, h, rgba);
    // and into the contact sheet
    const cellCam = fitCam(still, cell, cell, 0.76, { yaw: 0.6 });
    const cbuf = new Uint8ClampedArray(cell * cell * 4);
    rSheet.render(cbuf, still, cellCam, 0);
    const ox = (i % sheetCols) * cell, oy = Math.floor(i / sheetCols) * cell;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const s = (y * cell + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data[d] = cbuf[s]; sheet.data[d+1] = cbuf[s+1]; sheet.data[d+2] = cbuf[s+2]; sheet.data[d+3] = 255;
    }
    console.log(`  idle: ${ch.name}`);
  });
  writeFileSync(`${OUT}/bestiary-grid.png`, PNG.sync.write(sheet));
  console.log(`  ${OUT}/bestiary-grid.png`);

  for (const ch2 of armouryCast().slice(0, LOOPS)) idleLoop(ch2, size);
}

/**
 * A TRUE loop, not a loop that nearly closes.
 *
 * Idle motion is three sines of idleT — breath at 0.35Hz, a sway at 0.6, a
 * limb drift at 0.3 — so the pose only returns to exactly where it began when
 * all three come home together. Their periods are 20/7, 5/3 and 10/3 seconds,
 * which first coincide at TWENTY seconds. Cut at six, or eight, or any of the
 * round numbers one would reach for, and the loop jumps: not badly, just
 * enough to see, forever, every time it wraps.
 *
 * So the loop is twenty seconds, the camera turns exactly once in that time,
 * and the last frame is the first frame. Verified by comparing them.
 */
const LOOPS = Number(process.env.LOOPS ?? 18);

/**
 * A creature standing still is not a creature doing nothing. The pit's own
 * idle is three faint sines and reads, on a turntable, as a statue on a
 * plinth — so this drives the parts that make a body look inhabited: the head
 * looking about, weight moving from one leg to the other, the torso turning a
 * little after the head, and a deeper breath than the game bothers with.
 *
 * Every frequency is a whole number of cycles per loop, which is the only
 * reason the performance can be this busy and still close perfectly. Nothing
 * here is random: randomness cannot loop.
 */
function livingIdle(t: number, secs: number) {
  const TAU = Math.PI * 2;
  const f = (cycles: number, phase = 0) => Math.sin(TAU * (cycles / secs) * t + phase);
  return {
    // the head leads: a slow sweep with a smaller second thought inside it
    lookYaw: 0.62 * f(3) + 0.17 * f(7, 1.3),
    lean: 0.30 * f(2, 0.6),          // weight rocking between the feet
    twist: 0.26 * f(5),              // the torso following the head, late
    bob: 0.018 * f(4, 2.1),          // settling
    jiggle: 0.04 * f(6),             // mass carrying on
    breatheAmp: 2.4,                 // a breath you can actually see
    breatheRate: 0.35,               // 7 breaths per loop — already commensurate
  };
}

function idleLoop(ch: Character, size: Size): void {
  const { w, h } = size;
  const g = ch.genome as Genome;
  const height = Math.max(0.5, heightOf(g));
  const r = new PixelRenderer(w, h);
  const name = ch.name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const dir = frameDir(`idle-${name}`);
  const SECS = 20;                        // where breath, sway and drift agree
  const LOOP = FPS * SECS;
  // black IS the background here, so one render does it — no alpha key needed
  const posed = (u: number) => solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, u * SECS, undefined, 0,
    { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any, ...livingIdle(u * SECS, SECS) });
  // frame off the widest the performance ever gets, so nothing swings out of
  // shot halfway through — sampled, because the extremes are not at u=0
  const probe: Capsule[] = [];
  for (let i = 0; i < 24; i++) probe.push(...posed(i / 24));
  const fitted = fitCam(probe, w, h, 0.68);   // one framing, weapon and all, held all the way round
  const frame = (u: number): Uint8ClampedArray => {
    const buf = new Uint8ClampedArray(w * h * 4);
    r.render(buf, posed(u), { ...fitted, yaw: 0.6 + u * Math.PI * 2, voidColor: [0, 0, 0] }, 0);
    return buf;
  };
  let firstPx: Uint8ClampedArray | null = null;
  for (let f = 0; f < LOOP; f++) {
    const px = frame(f / LOOP);
    if (f === 0) firstPx = px.slice();
    writePNG(`${dir}/${pad(f)}.png`, w, h, px);
  }
  // the proof: the frame one PAST the end must be the frame we started on
  const lastPx = frame(1);
  let worst = 0;
  if (firstPx && lastPx) for (let i = 0; i < firstPx.length; i++) {
    worst = Math.max(worst, Math.abs(firstPx[i] - lastPx[i]));
  }
  console.log(`  idle loop ${ch.name}: wrap error ${worst}/255 ${worst <= 1 ? '(seamless)' : '(VISIBLE JUMP)'}`);
  encode(dir, `${OUT}/idle-loop-${name}-${size.tag}.mp4`, 'mp4');
}

// --- 4. cinematic ------------------------------------------------------------

/**
 * The pit shot like a film rather than a diagram. The in-game camera exists to
 * keep everything legible; these exist to make one thing matter — close, low,
 * and moving, with the crowd allowed to run out of frame.
 */
function cinematic(sizes: Size[] = [STORY]): void {
  mkdirSync(OUT, { recursive: true });
  const cast = roster();
  for (const size of sizes) {
    const { w, h } = size;
    const shots: { tag: string; secs: number; pitch: number;
      frame: (a: Agent, foe: Agent | null, u: number) => { need: number; cy: number; yaw: number } }[] = [
      // in tight on a duel, near eye level: two bodies and nothing else
      { tag: 'duel-close', secs: 8, pitch: 0.20,
        frame: (a, foe, u) => ({
          need: (foe ? Math.hypot(a.x - foe.x, a.z - foe.z) : 1.5) + 1.7,
          cy: 1.15, yaw: 0.5 + u * 0.5 }) },
      // low and looking up, so the creature stands over the viewer
      { tag: 'low-angle', secs: 7, pitch: 0.08,
        frame: (_a, _f, u) => ({ need: 2.5, cy: 1.0, yaw: 1.2 + u * 0.7 }) },
      // a slow push from the room to one face
      { tag: 'push-in', secs: 9, pitch: 0.30,
        frame: (_a, _f, u) => ({ need: 9.5 - u * 6.6, cy: 1.4 - u * 0.3, yaw: 0.3 + u * 0.4 }) },
    ];

    for (const shot of shots) {
      const sim: VoidSim = createVoid(cast, 0);
      const n = Number(process.env.CROWD ?? 20);
      for (let i = 0; i < n; i++) {
        const a = spawnChar(sim, cast[i % cast.length], `crowd${i}`);
        const ring = i % 2, k = Math.floor(i / 2);
        const ang = (k / Math.ceil(n / 2)) * Math.PI * 2 + ring * 0.4;
        const rad = ring ? 3.0 : 1.7;
        a.x = Math.cos(ang) * rad; a.z = Math.sin(ang) * rad;
        a.heading = ang + Math.PI;
        a.hp = a.maxHp = 9;
      }
      const dt = 1 / FPS;
      for (let i = 0; i < 14 * FPS; i++) {
        stepVoid(sim, dt);
        if (i % 30 === 0) for (const a of sim.agents) if (a.deadT < 0) a.hp = a.maxHp;
      }
      const r = new PixelRenderer(w, h);
      const dir = frameDir(`cine-${shot.tag}-${size.tag}`);
      const total = shot.secs * FPS;
      let camPpm = 0, camX = 0, camZ = 0;
      // lock onto one fighter for the whole shot, so the camera has a subject
      let hero = sim.agents.find(a => a.deadT < 0 && a.target) ?? sim.agents[0];
      for (let f = 0; f < total; f++) {
        stepVoid(sim, dt);
        if (hero.deadT >= 0) hero = sim.agents.find(a => a.deadT < 0 && a.target) ?? hero;
        const foe = hero.target && hero.target.deadT < 0 ? hero.target : null;
        const u = f / total;
        const want = shot.frame(hero, foe, u);
        const cx = foe ? (hero.x + foe.x) / 2 : hero.x;
        const cz = foe ? (hero.z + foe.z) / 2 : hero.z;
        const wantPpm = Math.max(110, Math.min(560, w / Math.max(1.9, want.need)));
        camPpm = camPpm ? camPpm + (wantPpm - camPpm) * 0.06 : wantPpm;
        camX += (cx - camX) * 0.07;
        camZ += (cz - camZ) * 0.07;
        const caps: Capsule[] = [];
        for (const pr of sim.props) caps.push(...pr.caps);
        for (const a of sim.agents) caps.push(...agentCaps(a));
        const buf = new Uint8ClampedArray(w * h * 4);
        r.render(buf, caps, pitCam({ ppm: camPpm, yaw: want.yaw, cx: camX, cz: camZ,
          cy: want.cy, pitch: shot.pitch }), sim.t);
        writePNG(`${dir}/${pad(f)}.png`, w, h, buf);
      }
      console.log(`cinematic ${shot.tag} ${size.tag}: ${total} frames`);
      encode(dir, `${OUT}/cine-${shot.tag}-${size.tag}.mp4`, 'mp4');
    }
  }
}

// --- run --------------------------------------------------------------------

const what = process.argv[2] ?? 'all';
mkdirSync(OUT, { recursive: true });
if (what === 'title' || what === 'all') title(STORY);
if (what === 'arena' || what === 'all') arena(Number(process.argv[3] ?? 15));
if (what === 'idles' || what === 'grid' || what === 'all') idles(POST);
if (what === 'cine' || what === 'all') cinematic([STORY]);
console.log(`\neverything in ${OUT}/`);
