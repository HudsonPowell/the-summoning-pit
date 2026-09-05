// What the pit is LIKE right now.
//
// Wind, the hour of the day, and whether it is raining. Three things that
// have nothing to do with each other mechanically and everything to do with
// each other in the eye: rain falls sideways in a gale, a cloak and a column
// of ants lean the same way, and all of it looks different at dusk.
//
// THE WHOLE OF IT IS A PURE FUNCTION OF THE PIT'S CLOCK. That clock is the
// server's, it is already in every snapshot, and it has been running for days
// — so every screen watching the pit computes the same weather at the same
// moment without a single byte being sent about it, and a creature's cloak
// streams the same way on your phone as on mine. No state, no sync, no
// protocol. The same trick the gait runs on, applied to the sky.

import { smoothNoise } from './motion';

export interface Conditions {
  /** Metres per second, on the ground plane. Gusts are already in it. */
  windX: number;
  windZ: number;
  /** How hard it is blowing, 0..1, for things that only care about strength. */
  gust: number;
  /** 0 the dead of night, 1 the middle of the day. */
  light: number;
  /** 0 dry, 1 the worst of it. */
  rain: number;
  /** 0..1 across a full day, for anything that wants the hour itself. */
  hour: number;
}

/**
 * A day in the pit. Short enough that a visitor sees the light change while
 * they are watching, long enough that it is not a strobe: the pit should feel
 * like it has weather, not like it is being switched.
 */
const DAY = 16 * 60;        // seconds
const WEATHER = 7 * 60;     // how fast fronts come through

/** Night is dimmer and bluer, never dark: this is a place you have to read. */
const NIGHT_FLOOR = 0.42;

export function conditionsAt(t: number): Conditions {
  const hour = ((t % DAY) + DAY) % DAY / DAY;

  // one smooth rise and fall, with dawn and dusk taking their time
  const day = 0.5 - 0.5 * Math.cos(hour * Math.PI * 2);
  const light = NIGHT_FLOOR + (1 - NIGHT_FLOOR) * Math.pow(day, 0.75);

  // WIND WANDERS. A direction that turns slowly, a strength that breathes,
  // and gusts on top of both — a steady breeze reads as a bug, not weather.
  const dir = smoothNoise(t / 90, 0x51ed) * Math.PI * 2 + t * 0.004;
  const strength = Math.max(0, 0.34 + smoothNoise(t / 70, 0x2f9a) * 0.66);
  const gustNoise = Math.max(0, smoothNoise(t / 7.5, 0x77c1));
  const gust = Math.min(1.4, strength * (1 + gustNoise * 0.85));

  // Fronts come through: mostly dry, occasionally not, and it takes a while to
  // arrive and a while to clear.
  //
  // THE SHAPE MATTERS MORE THAN THE THRESHOLD. A straight ramp off the front
  // spent half the pit's life in rain and reached a full downpour whenever the
  // noise merely went above average, which is often — the pit was standing in
  // a wall of water most of the time anyone looked at it. Squaring a late,
  // narrow ramp gives the distribution weather actually has: usually dry, a
  // shower you notice now and then, and a real downpour only when the front
  // goes near its own maximum, which is rare.
  const front = smoothNoise(t / WEATHER, 0x9e37);
  const wet = Math.max(0, Math.min(1, (front - 0.6) * 2.4));
  const rain = wet * wet;

  // rain arrives on the wind, and hard
  const push = gust * (1 + rain * 0.8);
  return {
    windX: Math.cos(dir) * push,
    windZ: Math.sin(dir) * push,
    gust,
    light: light * (1 - rain * 0.28),      // a downpour darkens the place
    rain,
    hour,
  };
}

/**
 * RAIN IS NOT PARTICLES. A downpour needs hundreds of streaks at once, which
 * would swallow the mote pool whole and starve every spark in the pit. It is
 * also the one thing here that genuinely does not need memory: a raindrop has
 * no history worth keeping, only a position, so each streak is a pure function
 * of its own index and the clock, wrapping from the top when it lands. Hundreds
 * of them cost one loop and no allocation at all.
 *
 * Drawn in a box that follows the camera, because rain nobody can see is the
 * most expensive rain there is.
 */
export function rainCaps(
  out: { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number };
    r: number; color: [number, number, number]; part: string }[],
  t: number, c: Conditions, cx: number, cz: number, budget = 1,
): void {
  if (c.rain <= 0.02) return;
  // 90 at the worst of it. This was 150, and 230 before that, and both were
  // wrong in the same way: rain drawn dense enough to be unmistakable stops
  // being weather and becomes a curtain hung between the viewer and the
  // fight. It also lands on top of a pit already drawing seven hundred
  // capsules, and must never be the thing that costs a phone its frame rate.
  const n = Math.round(90 * c.rain * budget);
  if (n <= 0) return;
  const SPAN = 11;                       // metres of pit the rain covers
  const TOP = 5.4;
  const fall = 13 + c.rain * 5;          // metres per second
  // it comes down at an angle, and the streak lies along the way it travels
  const dx = c.windX * 0.09, dz = c.windZ * 0.09;
  // Pale, not bright. Rain the colour of lit water on a dark pit reads as
  // scratches on the lens; it should sit just above the floor it falls on.
  const lit = 92 + c.rain * 34;
  const col: [number, number, number] = [lit * 0.62, lit * 0.72, lit * 0.9];

  for (let i = 0; i < n; i++) {
    // a hash per drop: its lane, its lifetime offset, its length
    const h = Math.imul(i + 1, 0x9e3779b1);
    const a = ((h >>> 8) & 0xffff) / 0xffff;
    const b = ((h >>> 20) & 0xfff) / 0xfff;
    const speed = fall * (0.82 + b * 0.36);
    // how far down it is, wrapping: the drop does not exist between falls
    const u = ((t * speed + a * 1000) % TOP) / TOP;
    const y = TOP * (1 - u);
    const x = cx + (a - 0.5) * SPAN + dx * y;
    const z = cz + (b - 0.5) * SPAN + dz * y;
    const len = 0.24 + b * 0.26 + c.gust * 0.1;
    out.push({
      a: { x: x - dx * len, y: y + len, z: z - dz * len },
      b: { x, y, z },
      r: 0.0095 + c.rain * 0.004,
      color: col,
      part: 'rain',
    });
  }
}
