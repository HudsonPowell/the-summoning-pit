// Does the creature have what the words asked for?
//
// The instinct is to hand the genome back to the model and ask it to check its
// own work. That is the wrong tool: the failures are not subtle, they are
// STRUCTURAL and enumerable — no wings on a winged thing, one head on a
// two-headed thing, no axe on an axeman — and a 3B model re-reading its own
// JSON is less reliable than a list of ifs that is right every time and costs
// nothing.
//
// So: a checklist finds it, and where the fix is obvious the checklist makes
// it. What a checklist CANNOT judge is whether the thing looks like a hippo,
// and that is what the CLIP judge in farm/judge.ts is for.

import { Genome, ChainSpec } from './genome';

export interface Claim {
  want: string;
  met: boolean;
  fixed?: boolean;
}

const has = (g: Genome, role: string) => g.skeleton.chains.some(c => c.role === role);
const count = (g: Genome, role: string) => g.skeleton.chains.filter(c => c.role === role).length;

export function auditGenome(g: Genome, desc: string, repair = true): Claim[] {
  const d = desc.toLowerCase();
  const out: Claim[] = [];
  const add = (want: string, met: boolean, fix?: () => void) => {
    if (met) { out.push({ want, met: true }); return; }
    if (repair && fix) { fix(); out.push({ want, met: true, fixed: true }); }
    else out.push({ want, met: false });
  };
  const push = (c: ChainSpec) => g.skeleton.chains.push(c);
  const scale = Math.max(...g.skeleton.girth, 0.06);

  if (/\bwing|winged|flying|flies|bat-|feathered/.test(d)) {
    add('wings', has(g, 'wing'), () =>
      push({ role: 'wing', at: 0.72, seg: [0.34, 0.28], r: 0.03, spread: 0.1, mirror: true, ink: 1 }));
  }
  if (/\bhorn|horned|antler|tusk/.test(d)) {
    add('horns', has(g, 'horn'), () =>
      push({ role: 'horn', at: 0.97, seg: [0.13, 0.08], r: scale * 0.3, spread: 0.05, mirror: true, ink: 3, angle: 0.6 }));
  }
  if (/\btail|tailed|stinger|barbed/.test(d)) {
    add('a tail', has(g, 'tail'), () =>
      push({ role: 'tail', at: 0, seg: [0.2, 0.16, 0.12], r: scale * 0.32, spread: 0 }));
  }
  if (/\bfin|finned|dorsal|aquatic|eel|fish/.test(d)) {
    add('fins', has(g, 'fin'), () =>
      push({ role: 'fin', at: 0.5, seg: [0.16], r: 0.02, spread: 0, mirror: false, ink: 3 }));
  }
  if (/two[- ]head|twin[- ]head|double[- ]head|two heads/.test(d)) {
    const h = g.skeleton.chains.find(c => c.role === 'head');
    add('two heads', count(g, 'head') > 1 || !!h?.mirror, () => {
      if (h) { h.mirror = true; h.spread = Math.max(h.spread, 0.13); }
    });
  }
  if (/four[- ]arm|4 arms|extra arms/.test(d)) {
    const arms = g.skeleton.chains.filter(c => c.role === 'arm');
    add('four arms', arms.length >= 2, () => {
      if (arms[0]) push({ ...JSON.parse(JSON.stringify(arms[0])), at: Math.max(0.6, arms[0].at - 0.16) });
    });
  }
  if (/six[- ]leg|eight[- ]leg|many legs|spider|insect|centipede|scuttl/.test(d)) {
    add('many legs', count(g, 'leg') >= 3, () => {
      const l = g.skeleton.chains.find(c => c.role === 'leg');
      if (!l) return;
      for (const at of [0.45, 0.7]) push({ ...JSON.parse(JSON.stringify(l)), at });
    });
  }

  // a weapon in the name and nothing in the hand is the one people notice
  if (/axe|sword|blade|spear|hammer|maul|mace|bow\b|staff|dagger|scythe|club|lance|rapier|cutlass|scimitar|trident|wand/.test(d)) {
    // repaired upstream by weaponsFromWords; this only reports
    add('something in its hands', !!g.weapon && has(g, 'arm'));
  }
  if (/armour|armor|armoured|armored|plate|helm|helmet|hood|cloak|robed|ragged|shell/.test(d)) {
    add('something worn', Array.isArray(g.gear) && g.gear.length > 0);
  }
  if (/long neck|long-necked|swan|heron|giraffe|serpentine neck/.test(d)) {
    const h = g.skeleton.chains.find(c => c.role === 'head');
    const neck = h ? h.seg.reduce((a, b) => a + b, 0) : 0;
    add('a long neck', neck > 0.34, () => { if (h) h.seg = [0.26, 0.2, ...h.seg.slice(2)]; });
  }
  return out;
}

/** How badly it missed, 0 = everything the words asked for is there. */
export function auditScore(claims: Claim[]): number {
  if (!claims.length) return 0;
  return claims.filter(c => !c.met).length / claims.length;
}
