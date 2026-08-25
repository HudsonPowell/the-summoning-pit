// Re-exports the clash page needs from the rig side, kept in one place so
// the sim stays import-clean (sim.ts must never import render/DOM code).

export { defaultBiped } from '../genome';
export { walkSpeed } from '../pose';
