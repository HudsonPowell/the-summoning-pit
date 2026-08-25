// The bestiary: a shelf of living thumbnails. Every card is the real rig
// walking its real walk — there are no preview images anywhere.

import { Character, migrateCharacter } from './character';
import { effectiveGait } from './genome';
import { solvePose } from './pose';
import { PixelRenderer, Camera } from './render';

interface Card {
  ch: Character;
  legacy: boolean;
  renderer: PixelRenderer;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  phase: number;
}

const SIZE = 64;
const cards: Card[] = [];
let filter: 'all' | 'hero' | 'beast' = 'all';

const grid = document.getElementById('grid')!;
const filtersEl = document.getElementById('filters')!;
const emptyEl = document.getElementById('empty')!;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '');

function heightOf(ch: Character): number {
  const sk = ch.genome.skeleton;
  const legs = sk.chains.filter(c => c.role === 'leg' && c.attach === 'hip');
  const legLen = legs.length ? Math.max(...legs.map(c => c.seg[0] + c.seg[1])) : 0.8;
  return sk.prone ? legLen + sk.torsoR + sk.headR * 2 : legLen + sk.spine + sk.neck + sk.headR * 2;
}

function renderFilters() {
  filtersEl.innerHTML = '';
  for (const f of ['all', 'hero', 'beast'] as const) {
    const b = document.createElement('button');
    b.className = 'chip' + (f === filter ? ' active' : '');
    b.textContent = f;
    b.addEventListener('click', () => { filter = f; renderGrid(); renderFilters(); });
    filtersEl.appendChild(b);
  }
}

function renderGrid() {
  grid.innerHTML = '';
  const visible = cards.filter(c => filter === 'all' || c.ch.kind === filter);
  emptyEl.hidden = visible.length > 0;
  for (const card of visible) {
    const el = document.createElement('div');
    el.className = 'card';
    const cv = document.createElement('canvas');
    cv.width = SIZE; cv.height = SIZE;
    card.ctx = cv.getContext('2d')!;
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = card.ch.name;
    const kind = document.createElement('div');
    kind.className = 'kind ' + (card.legacy ? 'legacy' : card.ch.kind);
    kind.textContent = card.legacy ? `${card.ch.kind} · legacy` : card.ch.kind;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const open = document.createElement('button');
    open.textContent = 'open';
    open.addEventListener('click', () => { location.href = '/?load=' + slug(card.ch.name); });
    actions.appendChild(open);
    if (!card.legacy) {
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = 'delete';
      del.addEventListener('click', async () => {
        await fetch('/api/characters?name=' + slug(card.ch.name), { method: 'DELETE' });
        cards.splice(cards.indexOf(card), 1);
        renderGrid();
      });
      actions.appendChild(del);
    }
    el.append(cv, name, kind, actions);
    grid.appendChild(el);
  }
}

async function load() {
  const seen = new Set<string>();
  const push = (raw: any, legacy: boolean) => {
    const ch = migrateCharacter(raw);
    const key = slug(ch.name);
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({
      ch, legacy,
      renderer: new PixelRenderer(SIZE, SIZE),
      ctx: null as unknown as CanvasRenderingContext2D,
      img: new ImageData(SIZE, SIZE),
      phase: Math.random(),
    });
  };
  try {
    for (const c of (await (await fetch('/api/characters')).json()) as any[]) push(c, false);
  } catch { /* none */ }
  try {
    for (const c of (await (await fetch('/api/genome')).json()) as any[]) push(c, true);
  } catch { /* none */ }
  renderFilters();
  renderGrid();
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const card of cards) {
    if (!card.ctx) continue;
    const eff = effectiveGait(card.ch.genome.gait, { tired: 0, angry: 0 });
    card.phase = (card.phase + eff.cadence * dt) % 1;
    const h = heightOf(card.ch);
    const cam: Camera = {
      yaw: 0.5, pitch: 0.24, ppm: (SIZE * 0.62) / h, cy: h * 0.5, floor: false, flat: false,
    };
    const caps = solvePose(card.ch.genome, { tired: 0, angry: 0 }, card.phase, 1, 0, undefined, 0, {
      weapon: card.ch.weapon,
    });
    card.renderer.render(card.img.data, caps, cam, 0);
    card.ctx.putImageData(card.img, 0, 0);
    card.ctx.canvas.style.imageRendering = 'pixelated';
  }
  requestAnimationFrame(frame);
}

load().then(() => requestAnimationFrame(frame));
