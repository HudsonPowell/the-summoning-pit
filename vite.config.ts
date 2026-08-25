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

export default defineConfig({
  plugins: [genomeStore(), jsonStore('/api/characters', 'characters')],
  server: {
    watch: { ignored: ['**/genomes/**', '**/characters/**', '**/farm/out/**'] },
  },
});
