import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, Plugin } from 'vite';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';

// dev-tool endpoint: POST saves a genome into genomes/, GET lists them all.
// The arena fetches the pool at runtime (never a build-time glob): a glob
// would put genomes/ in the module graph, and every hatch-save would
// broadcast a full page reload to every open tab — resetting the creature
// you just hatched.
function jsonStore(route: string, dir: string): Plugin {
  const slugOf = (name: unknown) =>
    String(name ?? 'item')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 48) || 'item';
  return {
    name: `json-store-${dir}`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        res.setHeader('content-type', 'application/json');
        mkdirSync(dir, { recursive: true });
        if (req.method === 'GET') {
          try {
            const list = readdirSync(dir)
              .filter(f => f.endsWith('.json'))
              .sort()
              .map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
            res.end(JSON.stringify(list));
          } catch {
            res.statusCode = 500;
            res.end('[]');
          }
          return;
        }
        if (req.method === 'DELETE') {
          try {
            const url = new URL(req.url ?? '', 'http://x');
            const slug = slugOf(url.searchParams.get('name'));
            unlinkSync(`${dir}/${slug}.json`);
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false }));
          }
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          try {
            const g = JSON.parse(body);
            const slug = slugOf(g.name);
            writeFileSync(`${dir}/${slug}.json`, JSON.stringify(g, null, 2));
            res.end(JSON.stringify({ ok: true, file: `${dir}/${slug}.json` }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false }));
          }
        });
      });
    },
  };
}

function genomeStore(): Plugin {
  return {
    name: 'genome-store',
    configureServer(server) {
      server.middlewares.use('/api/genome', (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') {
          try {
            mkdirSync('genomes', { recursive: true });
            const list = readdirSync('genomes')
              .filter(f => f.endsWith('.json'))
              .sort()
              .map(f => JSON.parse(readFileSync(`genomes/${f}`, 'utf8')));
            res.end(JSON.stringify(list));
          } catch {
            res.statusCode = 500;
            res.end('[]');
          }
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          try {
            const g = JSON.parse(body);
            const slug =
              String(g.name ?? 'creature')
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '')
                .slice(0, 48) || 'creature';
            mkdirSync('genomes', { recursive: true });
            writeFileSync(`genomes/${slug}.json`, JSON.stringify(g, null, 2));
            res.end(JSON.stringify({ ok: true, file: `genomes/${slug}.json` }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false }));
          }
        });
      });
    },
  };
}

// The build tag: Railway supplies the commit sha at build time; a local dev
// server asks git; anything else is 'dev'. Shown tiny in the corner so "which
// version am I looking at" stops being a guessing game.
function buildTag(): string {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildTag()) },
  plugins: [genomeStore(), jsonStore('/api/characters', 'characters')],
  // Every page is an entry point. Vite builds index.html and nothing else by
  // default, so a deploy shipped a pit with no /void.html in it.
  // a minified stack still names its functions — an error surfaced from a
  // browser we do not own is only useful if it says WHERE
  esbuild: { keepNames: true },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        void: resolve(__dirname, 'void.html'),
        bestiary: resolve(__dirname, 'bestiary.html'),
        clash: resolve(__dirname, 'clash.html'),
        grid: resolve(__dirname, 'grid.html'),
        type: resolve(__dirname, 'type.html'),
      },
    },
  },
  server: {
    watch: { ignored: ['**/genomes/**', '**/characters/**', '**/farm/out/**'] },
  },
});
