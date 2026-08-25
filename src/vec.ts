export type V3 = { x: number; y: number; z: number };

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: V3, s: number): V3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l < 1e-9 ? v3(0, 1, 0) : scale(a, 1 / l);
};
export const lerp = (a: V3, b: V3, t: number): V3 =>
  v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** Rotate about world Y axis. */
export const rotY = (p: V3, ang: number): V3 => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return v3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
};

/** Rotate about world X axis. */
export const rotX = (p: V3, ang: number): V3 => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return v3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
};

export const TAU = Math.PI * 2;
export const frac = (x: number): number => x - Math.floor(x);
export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
