// Depth correctness for the bone field. Two capsules that overlap on screen:
// whichever is nearer the camera must own the shared pixels — in the hard
// path AND the blended one.

import { PixelRenderer, Camera } from '../src/render';
import { Capsule } from '../src/pose';
import { v3 } from '../src/vec';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const S = 64;
const renderer = new PixelRenderer(S, S);
const buf = new Uint8ClampedArray(S * S * 4);

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];

/** Sample the centre pixel. */
function centre(): [number, number, number] {
  const i = (Math.floor(S / 2) * S + Math.floor(S / 2)) * 4;
  return [buf[i], buf[i + 1], buf[i + 2]];
}

function baseCam(extra: Partial<Camera> = {}): Camera {
  return {
    yaw: 0, pitch: 0, ppm: 100, cy: 0, floor: false, flat: true, ...extra,
  };
}

// A fat vertical bar at z = -0.2 (far) and a thin horizontal bar at z = +0.2
// (near). With yaw/pitch 0 the view axes are the world axes, and larger z is
// nearer the camera.
const far: Capsule = {
  a: v3(0, -0.25, -0.2), b: v3(0, 0.25, -0.2), r: 0.08, color: RED, part: 'far',
};
const near: Capsule = {
  a: v3(-0.25, 0, 0.2), b: v3(0.25, 0, 0.2), r: 0.05, color: BLUE, part: 'near',
};

console.log('\ndepth ordering');
{
  renderer.render(buf, [far, near], baseCam(), 0);
  const [r, , b] = centre();
  check('hard path: nearer capsule owns the overlap', b > r, `rgb ${centre().join(',')}`);
}
{
  // order in the array must not matter
  renderer.render(buf, [near, far], baseCam(), 0);
  const [r, , b] = centre();
  check('hard path: independent of draw order', b > r, `rgb ${centre().join(',')}`);
}
{
  renderer.render(buf, [far, near], baseCam({ blend: 2, blendMix: 0, blendShape: 1 }), 0);
  const [r, , b] = centre();
  check('blended path: nearer capsule owns the overlap', b > r, `rgb ${centre().join(',')}`);
}

console.log('\nsurface bulge (a limb aimed at the camera)');
{
  // A capsule pointing straight at the camera: its axis spans z, so the near
  // cap should be what we see — depth must come from the surface, not the
  // midpoint of the axis.
  const pointing: Capsule = {
    a: v3(0, 0, -0.4), b: v3(0, 0, 0.4), r: 0.06, color: RED, part: 'pointing',
  };
  const plate: Capsule = {
    a: v3(-0.3, 0, 0.3), b: v3(0.3, 0, 0.3), r: 0.05, color: BLUE, part: 'plate',
  };
  // the pointing capsule's near cap (z = 0.4 + 0.06) is in front of the plate
  renderer.render(buf, [pointing, plate], baseCam(), 0);
  const [r, , b] = centre();
  check('near cap of an aimed limb beats a nearer-axis bar', r > b, `rgb ${centre().join(',')}`);
}

console.log(failures === 0 ? '\nall green\n' : `\n${failures} FAILURES\n`);
process.exit(failures === 0 ? 0 : 1);
