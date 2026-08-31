// THE HOOK: words become a creature.
//
// The pit's whole claim in one shot — a sentence assembles in wire, falls, and
// the thing it described is standing where it stood. No cut, one camera, and
// the creature is built by the same smith the live game uses.
//   npx tsx farm/reveal.ts "a hooded ranger with a tall longbow"
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { PixelRenderer, Camera } from '../src/render';
import { migrateGenome, Genome } from '../src/genome';
import { makeCharacter } from '../src/character';
import { solvePose, Capsule } from '../src/pose';
import { WireTitle } from '../src/void/wiretitle';
import { weaponsFromWords } from '../src/smith';
import { gearFromWords } from '../src/gear';

const DESC = process.argv[2] ?? 'a hooded ranger with a tall longbow';
const TAG = (process.argv[3] ?? 'reveal').replace(/[^a-z0-9]/gi, '');
const W = 1080, H = 1920, FPS = 30, BLEND_M = 0.022;
const OUT = 'farm/out/social';
const dir = `${OUT}/.frames-${TAG}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const cam = (over: Partial<Camera>): Camera => ({
  yaw: 0.6, pitch: 0.34, ppm: 200, cy: 0.9, cx: 0, cz: 0, tile: 1, flat: true,
  blendShape: 0.6, blendMix: 1, blendDepth: 0.35, floor: false,
  voidColor: [0, 0, 0], ...over,
  blend: (over.ppm ?? 200) * BLEND_M,
});

// the creature the words describe, built by the pit's own smith
const base = migrateGenome(JSON.parse(readFileSync('genomes/grezaan-tall.json', 'utf8')));
const g: Genome = JSON.parse(JSON.stringify(base));
const arms = weaponsFromWords(DESC);
g.weapon = arms.main as any; g.offhand = arms.off as any; g.gear = gearFromWords(DESC) as any;
const ch = makeCharacter(g, 'beast');
const posed = (t: number): Capsule[] => solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, t, undefined, 0,
  { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any,
    lookYaw: 0.5 * Math.sin(t * 0.9), lean: 0.22 * Math.sin(t * 0.6),
    twist: 0.2 * Math.sin(t * 1.1), bob: 0.016 * Math.sin(t * 1.4), breatheAmp: 2.4 });
let reach = 0.2, minY = Infinity, maxY = -Infinity;
for (const c of posed(0)) for (const p of [c.a, c.b] as any[]) {
  reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
  minY = Math.min(minY, p.y - c.r); maxY = Math.max(maxY, p.y + c.r);
}
const bodyPpm = Math.min((H * 0.52) / (maxY - minY), (W * 0.62) / (reach * 2));

const r = new PixelRenderer(W, H);
const title = new WireTitle(DESC.toLowerCase(), (W * 4.4) / (0.46 * H), 1.15, 0.30);
const TITLE_PPM = (H * 0.46) / 4.4;
const dt = 1 / FPS;
let f = 0;
const put = (caps: Capsule[], c: Camera) => {
  const buf = new Uint8ClampedArray(W * H * 4);
  r.render(buf, caps, c, 0);
  const png = new PNG({ width: W, height: H });
  png.data.set(buf);
  writeFileSync(`${dir}/${String(f).padStart(4, '0')}.png`, PNG.sync.write(png));
  f++;
};

// 1. the words arrive, hold, and fall — the pit's own hand
let yaw = 0.6;
while (!title.done && f < FPS * 13) {
  put(title.caps(dt, yaw), cam({ ppm: TITLE_PPM, yaw, cy: 1.5 }));
  yaw += dt * 0.045;
}
// 2. and the thing they described is standing there
for (let i = 0; i < FPS * 7; i++) {
  const t = i / FPS;
  const rise = Math.min(1, t / 0.9);                    // it comes up out of the dark
  put(posed(t + 1.2), cam({ ppm: bodyPpm, yaw: yaw + t * 0.22,
    cy: (minY + maxY) / 2 + (1 - rise) * 1.6 }));
}
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS),
  '-i', `${dir}/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17',
  '-movflags', '+faststart', `${OUT}/${TAG}-story.mp4`]);
rmSync(dir, { recursive: true, force: true });
console.log(`${OUT}/${TAG}-story.mp4  (${f} frames)`);
