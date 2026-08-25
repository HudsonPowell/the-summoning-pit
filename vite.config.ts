import { defineConfig, Plugin } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';

// dev-tool endpoint: the studio's hatch box POSTs a genome here and it lands
// in genomes/, where the arena's glob picks it up as an enemy candidate
function genomeSave(): Plugin {
  return {
    name: 'genome-save',
    configureServer(server) {
      server.middlewares.use('/api/genome', (req, res) => {
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
            res.setHeader('content-type', 'application/json');
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
  plugins: [genomeSave()],
});
