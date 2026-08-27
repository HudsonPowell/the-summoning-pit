// One service, one domain. Railway gives you a host and a port; serving the
// built client from the same process means the websocket is same-origin, so
// there is no CORS to configure and no second URL to keep in step — and wss://
// comes free with their TLS.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

/** Returns true if it handled the request. */
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (!existsSync(root)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const url = (req.url ?? '/').split('?')[0];
  // normalize() collapses ../ before we join, so a request cannot climb out
  let rel = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel === '\\') rel = '/void.html';
  const path = join(root, rel);
  if (!path.startsWith(root)) { res.writeHead(403).end(); return true; }
  if (!existsSync(path) || !statSync(path).isFile()) return false;

  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const body = readFileSync(path);
  // hashed assets never change; pages must not be cached or a deploy is invisible
  const immutable = /\/assets\/.*-[A-Za-z0-9_-]{8,}\./.test(path);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
