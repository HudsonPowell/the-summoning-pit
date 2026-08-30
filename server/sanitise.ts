// Anything arriving over a socket is hostile until proven otherwise. The client
// hatches its own creature — which is how the prompt never reaches this
// machine at all — but that also means the genome is whatever the client felt
// like sending. Clamp it into something the renderer and the sim can survive.

import { Genome, migrateGenome } from '../src/genome';
import { fitBudget } from '../src/budget';
import { temperOf } from '../src/temper';

const num = (v: unknown, lo: number, hi: number, fb: number): number =>
  typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
const hex = (c: unknown, fb: string) =>
  typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fb;

const ROLES = new Set(['leg', 'arm', 'wing', 'tail', 'head', 'horn', 'fin', 'spike', 'tentacle']);

export function sanitiseGenome(raw: unknown): Genome | null {
  if (!raw || typeof raw !== 'object') return null;
  let g: Genome;
  try {
    g = migrateGenome(JSON.parse(JSON.stringify(raw)));
  } catch {
    return null;
  }
  const sk = g?.skeleton;
  if (!sk || !Array.isArray(sk.body) || !Array.isArray(sk.chains)) return null;

  sk.body = sk.body.slice(0, 8).map(v => num(v, 0.05, 0.8, 0.25));
  if (!sk.body.length) sk.body = [0.26, 0.24];
  sk.girth = (Array.isArray(sk.girth) ? sk.girth : []).slice(0, 10).map(v => num(v, 0.02, 0.4, 0.1));
  if (!sk.girth.length) sk.girth = [0.1];
  sk.upright = !!sk.upright;
  if (!['walk', 'slither', 'fly', 'hop'].includes(sk.locomotion)) sk.locomotion = 'walk';

  sk.chains = sk.chains
    .filter((c: any) => c && ROLES.has(c.role))
    .slice(0, 14)
    .map((c: any) => ({
      role: c.role,
      at: num(c.at, 0, 1, 0.5),
      seg: (Array.isArray(c.seg) && c.seg.length ? c.seg : [0.3, 0.3])
        .slice(0, 4).map((v: unknown) => num(v, 0.03, 0.9, 0.25)),
      r: num(c.r, 0.01, 0.15, 0.05),
      spread: num(c.spread, 0, 0.5, 0.1),
      ...(typeof c.mirror === 'boolean' ? { mirror: c.mirror } : {}),
      ...(typeof c.ink === 'number' ? { ink: Math.min(9, Math.max(0, Math.round(c.ink))) } : {}),
      ...(typeof c.angle === 'number' ? { angle: num(c.angle, -1.6, 1.6, 0) } : {}),
    }));
  if (!sk.chains.length) return null;

  const p: any = g.palette ?? {};
  g.palette = {
    torso: hex(p.torso, '#3aa7a0'), limbs: hex(p.limbs, '#2b7f8f'),
    head: hex(p.head, '#e8c39a'), accent: hex(p.accent, '#d5573b'),
    extra: Array.isArray(p.extra) ? p.extra.slice(0, 6).map((c: unknown) => hex(c, '#888888')) : undefined,
  };

  // the name is decorative here; the server renames it off the body anyway
  g.name = typeof g.name === 'string' ? g.name.slice(0, 40) : 'a thing';

  const STYLE_OK = ['swipe', 'slam', 'thrust', 'lash', 'shoot', 'cast', 'fireball', 'frost', 'zap', 'throw'];
  for (const slot of ['weapon', 'offhand'] as const) {
    const w: any = (g as any)[slot];
    if (!w || typeof w !== 'object') continue;
    if (Array.isArray(w.parts)) {
      // roomy enough for a 1.4x 'huge' weapon; still nothing absurd
      w.parts = w.parts.slice(0, 10).map((q: any) => ({
        a: [num(q?.a?.[0], -0.6, 1.7, 0), num(q?.a?.[1], -0.6, 0.6, 0), num(q?.a?.[2], -0.6, 0.6, 0)],
        b: [num(q?.b?.[0], -0.6, 1.7, 0.4), num(q?.b?.[1], -0.6, 0.6, 0), num(q?.b?.[2], -0.6, 0.6, 0)],
        r: num(q?.r, 0.01, 0.15, 0.03),
        color: hex(q?.color, '#9aa1ab'),
      }));
      if (typeof w.name === 'string') w.name = w.name.slice(0, 24);
      // how it is used is an enum, not a string off the wire
      if (typeof w.style !== 'string' || !STYLE_OK.includes(w.style)) delete w.style;
    }
  }
  // Gear is decorative but it is still geometry off a socket
  if (Array.isArray((g as any).gear)) {
    (g as any).gear = (g as any).gear.slice(0, 4).map((piece: any) => ({
      name: typeof piece?.name === 'string' ? piece.name.slice(0, 24) : 'gear',
      at: ['head', 'shoulder', 'torso', 'back', 'waist'].includes(piece?.at) ? piece.at : 'torso',
      mirror: !!piece?.mirror,
      parts: (Array.isArray(piece?.parts) ? piece.parts : []).slice(0, 6).map((q: any) => ({
        a: [num(q?.a?.[0], -2, 2, 0), num(q?.a?.[1], -2, 2, 0), num(q?.a?.[2], -2, 2, 0)],
        b: [num(q?.b?.[0], -2, 2, 0), num(q?.b?.[1], -2, 2, 0), num(q?.b?.[2], -2, 2, 0)],
        r: num(q?.r, 0.05, 1.4, 0.4),
        color: hex(q?.color, '#8c939d'),
      })),
    })).filter((piece: any) => piece.parts.length);
  } else {
    delete (g as any).gear;
  }

  // breath is an enum, not a string off the wire
  const breath = (g as any).breath;
  if (!['fire', 'frost', 'venom', 'lightning', 'shadow'].includes(breath)) delete (g as any).breath;

  // Temperament is NOT taken from the wire. It was clamped to 0..1 and
  // otherwise believed, which meant anyone could claim aggression 1, bravery 1
  // and speed 1 with no body to justify any of it — a straight cheat, and the
  // one that would have ruined a public pit fastest. It is derived here, from
  // the body, which is the only thing the server can actually see.
  delete g.temper;

  // and everyone gets the same amount of creature to spend
  const fitted = fitBudget(g);
  fitted.temper = temperOf(fitted);
  return fitted;
}
