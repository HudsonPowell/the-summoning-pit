// The pit has to still be here tomorrow. Everything that matters — who is
// standing, what they have killed, what they are wearing for it, and who has
// sworn what to whom — goes to a file every few seconds and comes back on boot.
//
// What is NOT saved: keys. The server stores owner ids, which are hashes. If
// this file leaks, nobody's creatures can be claimed with it.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Genome } from '../src/genome';
import { Stance } from '../src/void/pacts';

export interface SavedAgent {
  genome: Genome;
  by?: string;          // owner id (a hash), never a key
  x: number; z: number;
  hp: number; maxHp: number;
  kills: number;
  spoils: string[];
  born: number;         // sim seconds
}

export interface SavedPit {
  v: 1;
  t: number;            // sim clock, so ages survive a restart
  wall: number;         // wall clock at save, so "days survived" can be real
  agents: SavedAgent[];
  pacts: { from: string; to: string; stance: Stance }[];
  relics?: unknown[];   // the floor's memory; older saves simply have none
  flora?: unknown[];
  ledger?: unknown;     // /stats counters; older saves simply have none
  /**
   * What became of people's creatures while they were away, undelivered.
   * This is the only thing the pit ever says to somebody who was not here,
   * so losing it on a restart loses the one reason anyone comes back — and
   * it was in memory alone, wiped by every single deploy.
   */
  fates?: { owner: string; line: string; at: number }[];
}

export function load(path: string): SavedPit | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw?.v !== 1 || !Array.isArray(raw.agents)) return null;
    return raw as SavedPit;
  } catch (e) {
    console.error('[pit] could not read', path, '-', (e as Error).message);
    return null;
  }
}

/** Write beside, then rename: a crash mid-save must not eat the pit. */
export function save(path: string, pit: SavedPit): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(pit));
    renameSync(tmp, path);
  } catch (e) {
    console.error('[pit] could not save -', (e as Error).message);
  }
}
