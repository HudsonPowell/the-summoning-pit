// No accounts. A key is a string you keep in a URL, and it is the only proof
// that a creature is yours. Bookmark it and you are you; lose it and the
// creature carries on in the pit without anyone able to claim it.
//
// The key is secret. The OWNER id is a hash of it, safe to put in a pact link,
// and the thing everyone else sees. Handing someone your key hands them your
// creatures; handing them your owner id only lets them swear at you.

import { createHash, randomBytes } from 'node:crypto';

export function mintKey(): string {
  return randomBytes(16).toString('base64url');
}

export function ownerOf(key: string): string {
  return createHash('sha256').update('pit:' + key).digest('base64url').slice(0, 10);
}

/** Cheap shape check so a typo does not become an owner id. */
export function looksLikeKey(k: unknown): k is string {
  return typeof k === 'string' && k.length >= 16 && k.length <= 64 && /^[\w-]+$/.test(k);
}
