// Text -> genome, shared by the studio (browser) and the farm CLI (node).
//
// Three things carry the quality: a vocabulary rich enough to describe a
// hippo, EXEMPLARS chosen to match the prompt (a snake request should be
// shown a snake, not three bipeds), and a JSON schema that constrains
// generation at the token level so the shape is right by construction.
// The clamps are the type-checker; the solver is the physics check.

import {
  defaultBiped, imp, hound, troll, ogre, hippo, serpent, raptor, spider, hydra,
  Genome, Skeleton, Gait, ChainSpec, ChainRole, Locomotion, Palette, girthAt,
} from './genome';
import { titleFor } from './naming';
import { weaponsFromWords, validateWeapon, dressWeapon, priceWeapon, smithPrompt } from './smith';
import type { WeaponSpec } from './character';
import { HATCH_MODEL, OLLAMA_URL, HATCH_API_KEY, HATCH_API_URL } from './ollama';
import { temperOf, temperFromWords } from './temper';
import { gearFromWords } from './gear';
import { separate } from './palette';
import { auditGenome } from './audit';

export { HATCH_MODEL, OLLAMA_URL, HATCH_API_KEY, HATCH_API_URL } from './ollama';

// --- the vocabulary --------------------------------------------------------

const SCHEMA_NOTES = `
You design creatures for a game as JSON "genomes". A creature is a BODY CURVE
with limbs hanging off it. Get the body right first — it is most of the shape.

skeleton.body: segment lengths from TAIL end to HEAD end. Few short segments =
  compact (ape, dwarf). Many segments = long (snake, lizard, dragon, worm).
skeleton.girth: radius at each point down that body — THIS is where bulk lives.
  A hippo is [0.16, 0.29, 0.30, 0.22] (a barrel). A snake tapers
  [0.04, 0.10, 0.08, 0.05]. A wiry imp is [0.07, 0.075].
skeleton.upright: true = stands like a person, false = body runs level like an
  animal. Most beasts are false.
skeleton.locomotion: "walk" | "slither" | "fly" | "hop". Legless things MUST be
  "slither". Winged things that stay airborne are "fly".

skeleton.chains: everything that hangs off the body. Each has:
  role: "leg" | "arm" | "wing" | "tail" | "head" | "horn" | "fin"
  at:   WHERE along the body, 0 = tail end, 1 = head end. A quadruped puts legs
        at about 0.1 and 0.9. A spider puts four leg chains at 0.6-1.0. Wings
        belong near 0.7-0.9. A head is at 1.
  seg:  segment lengths. For a head this is the neck, then the skull/snout —
        a long snout is a long second segment. 1-4 numbers.
  r:    thickness. spread: how far out to the side the pair sits.
  mirror: legs/arms/wings/horns are mirrored into a PAIR automatically. Set
        mirror:false for a single limb (one huge arm). Tails and heads are
        single by default — set mirror:true on a head chain for TWO HEADS.
  ink:  0 torso colour, 1 limb colour, 2 head colour, 3 accent.
  angle: pitch. Head carriage, horn rake, fin lean.

Ideas the vocabulary can express, so use it: barrel-bodied beasts, long
serpents with no legs at all, many-legged scuttlers, two-headed things, horns
and back fins, one oversized arm, stubby legs under a huge body, long necks.

held: if the words name ANYTHING carried in a hand — a weapon, a tool, an
  instrument, however strange — DESIGN IT from 1-6 capsules. You are the
  smith: nunchucks are two sticks and a thin chain link, a net is a wide
  sparse fan of thin strands, a censer is a chain and a hanging ball. Grip
  space: the hand is at [0,0,0]; +x runs away from the hand along the thing
  (max 1.1); +y is knuckle-side; +z out to the side. Shafts thin (r
  0.015-0.03), heads chunky (r up to 0.09). Give it a real silhouette and
  colour — it is the character's signature. Also pick style: how it is used.
  "swipe" cuts, "slam" crushes, "thrust" stabs, "lash" whips, "shoot" looses
  an arrow, "cast" hurls arcane bolts, "fireball" lobs an exploding ball,
  "frost" throws slow ice, "zap" strikes as lightning, "throw" hurls the
  thing itself (it sticks in the ground and must be fetched back).
offhand: a second held thing — a shield, torch, or twin of the first — same
  rules. Omit held/offhand entirely for creatures with nothing in hand.

gait: cadence 0.2-2.2 (small things quick, heavy things slow), stride 0.2-2.4,
lean/slump = hunch, armSwing, headPitch, flapAmp = wingbeat, tailWave,
bodyWave = how much the body itself undulates (high for snakes, 0 for people).
palette: hex colours suiting the description.
Return ONLY the JSON object.`;

// --- exemplars: show the model things LIKE what was asked for --------------

interface Exemplar { make: () => Genome; keys: string[] }

const LIBRARY: Exemplar[] = [
  { make: defaultBiped, keys: ['human', 'person', 'knight', 'elf', 'dwarf', 'warrior', 'hero', 'man', 'woman', 'soldier', 'mage', 'wizard'] },
  { make: imp, keys: ['imp', 'gremlin', 'demon', 'devil', 'small', 'tiny', 'fairy', 'sprite', 'bat'] },
  { make: hound, keys: ['dog', 'hound', 'wolf', 'cat', 'lion', 'horse', 'deer', 'beast', 'quadruped', 'four legs', 'fox', 'boar'] },
  { make: troll, keys: ['troll', 'arms', 'four-armed', 'multi', 'brute'] },
  { make: ogre, keys: ['ogre', 'giant', 'huge', 'massive', 'titan', 'golem', 'colossus'] },
  { make: hippo, keys: ['hippo', 'fat', 'bloated', 'barrel', 'rhino', 'bear', 'heavy', 'round', 'tank', 'thick', 'obese', 'toad', 'frog'] },
  { make: serpent, keys: ['snake', 'serpent', 'worm', 'eel', 'naga', 'slither', 'legless', 'python', 'viper', 'dragon', 'wyrm', 'centipede'] },
  { make: raptor, keys: ['bird', 'wing', 'fly', 'flying', 'eagle', 'raven', 'crow', 'hawk', 'winged', 'harpy', 'moth'] },
  { make: spider, keys: ['spider', 'insect', 'bug', 'crab', 'scuttle', 'arachnid', 'many legs', 'six legs', 'eight', 'beetle', 'ant'] },
  { make: hydra, keys: ['hydra', 'two heads', 'two-headed', 'multi-headed', 'heads', 'chimera'] },
];

/** Pick the exemplars nearest the words, always with something contrasting. */
export function pickExemplars(desc: string, n = 3): Genome[] {
  const d = desc.toLowerCase();
  const scored = LIBRARY.map(e => ({
    e,
    score: e.keys.reduce((s, k) => s + (d.includes(k) ? k.length : 0), 0),
  })).sort((a, b) => b.score - a.score);

  const picked: Genome[] = [];
  for (const s of scored) {
    if (picked.length >= n - 1) break;
    if (s.score > 0) picked.push(s.e.make());
  }
  // A legless serpent is the strongest reminder that not everything is a biped
  // — but only worth showing a prompt that carried some signal. Handed to a
  // prompt that matched nothing ("idk", "yes", an empty string) it becomes the
  // only shape in the pack with any character, and the model copies it: every
  // shrug hatched as a snake. No signal, no serpent.
  if (picked.length) {
    picked.push(picked.some(p => p.skeleton.locomotion === 'slither') ? hound() : serpent());
  } else {
    picked.push(hound());
  }
  while (picked.length < n) picked.push(picked.length === 1 ? defaultBiped() : hound());
  return picked.slice(0, n);
}

// --- the schema the model must fill ----------------------------------------

const num = (min: number, max: number) => ({ type: 'number', minimum: min, maximum: max });

export const GENOME_SCHEMA = {
  type: 'object',
  required: ['name', 'skeleton', 'gait', 'palette'],
  properties: {
    name: { type: 'string' },
    skeleton: {
      type: 'object',
      required: ['upright', 'body', 'girth', 'locomotion', 'chains'],
      properties: {
        upright: { type: 'boolean' },
        locomotion: { type: 'string', enum: ['walk', 'slither', 'fly', 'hop'] },
        body: { type: 'array', minItems: 1, maxItems: 8, items: num(0.05, 0.8) },
        girth: { type: 'array', minItems: 1, maxItems: 10, items: num(0.02, 0.4) },
        chains: {
          type: 'array', minItems: 1, maxItems: 12,
          items: {
            type: 'object',
            required: ['role', 'at', 'seg', 'r', 'spread'],
            properties: {
              role: { type: 'string', enum: ['leg', 'arm', 'wing', 'tail', 'head', 'horn', 'fin'] },
              at: num(0, 1),
              seg: { type: 'array', minItems: 1, maxItems: 4, items: num(0.03, 0.9) },
              r: num(0.01, 0.15),
              spread: num(0, 0.5),
              mirror: { type: 'boolean' },
              ink: { type: 'integer', minimum: 0, maximum: 3 },
              angle: num(-1.6, 1.6),
            },
          },
        },
      },
    },
    gait: {
      type: 'object',
      properties: {
        cadence: num(0.2, 2.2), stride: num(0.2, 2.4), lift: num(0, 0.3),
        bounce: num(0, 0.08), sway: num(0, 0.09), lean: num(-0.2, 0.5),
        slump: num(0, 0.8), armSwing: num(0, 1), headPitch: num(-0.4, 0.8),
        flapAmp: num(0, 1.3), tailWave: num(0, 1.2), bodyWave: num(0, 1.2),
      },
    },
    palette: {
      type: 'object',
      required: ['torso', 'limbs', 'head', 'accent'],
      properties: {
        torso: { type: 'string' }, limbs: { type: 'string' },
        head: { type: 'string' }, accent: { type: 'string' },
      },
    },
    held: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        style: { type: 'string', enum: ['swipe', 'slam', 'thrust', 'lash', 'shoot', 'cast', 'fireball', 'frost', 'zap', 'throw'] },
        parts: {
          type: 'array', minItems: 1, maxItems: 6,
          items: {
            type: 'object',
            required: ['a', 'b', 'r', 'color'],
            properties: {
              a: { type: 'array', minItems: 3, maxItems: 3, items: num(-0.4, 1.1) },
              b: { type: 'array', minItems: 3, maxItems: 3, items: num(-0.4, 1.1) },
              r: num(0.012, 0.1),
              color: { type: 'string' },
            },
          },
        },
      },
    },
    offhand: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parts: {
          type: 'array', minItems: 1, maxItems: 5,
          items: {
            type: 'object',
            required: ['a', 'b', 'r', 'color'],
            properties: {
              a: { type: 'array', minItems: 3, maxItems: 3, items: num(-0.4, 1.1) },
              b: { type: 'array', minItems: 3, maxItems: 3, items: num(-0.4, 1.1) },
              r: num(0.012, 0.12),
              color: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;

export function buildPrompt(desc: string): string {
  const ex = pickExemplars(desc);
  const shown = ex.map(g => `${g.name}:\n${JSON.stringify(g)}`).join('\n\n');
  return `${SCHEMA_NOTES}\n\nExamples:\n\n${shown}\n\nNow write the genome for: "${desc}"\nJSON:`;
}

/**
 * The same request, spoken to an OpenAI-compatible endpoint (Groq, Together,
 * OpenAI, anything that takes /v1/chat/completions). The load-bearing part is
 * the SCHEMA: Ollama enforces it during decoding via `format`, and these do the
 * same job through `response_format: json_schema`. Without it a small model
 * returns prose with JSON in it and the validator spends its life repairing.
 *
 * Server-side only, because it needs a key. The browser path is always Ollama,
 * which is exactly right: your model, your machine, your words.
 */
/** Worth asking again: overloaded, rate limited, or a gateway having a moment. */
function retryable(status: number, body: string): boolean {
  return status === 429 || status === 503 || status === 502 || status === 500
    || /service unavailable|overloaded|rate.?limit|try again/i.test(body);
}

export async function askOpenAI(
  desc: string,
  model: string,
  url: string,
  apiKey: string,
  temperature = 0.8,
): Promise<string> {
  const endpoint = `${url.replace(/\/$/, '')}/chat/completions`;
  const ask = async (format: unknown) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 2000,
        response_format: format,
        messages: [{ role: 'user', content: buildPrompt(desc) }],
      }),
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  };

  // Providers disagree about how much of a schema they will enforce, and which
  // models support it at all. Ask for the strong guarantee, and if the provider
  // refuses it, fall back to plain JSON mode — the validator was always going
  // to have to repair whatever came back anyway.
  const schema = { type: 'json_schema', json_schema: { name: 'genome', strict: false, schema: GENOME_SCHEMA } };
  let r = await ask(schema);
  if (!r.ok && /json_schema|response_format|schema/i.test(r.body)) {
    r = await ask({ type: 'json_object' });
  }

  // A free tier under load says "Service unavailable" and means "not right
  // now". Several people summoning at once hit that constantly, and losing a
  // creature to it feels like the pit is broken rather than busy. Back off and
  // ask again — the words are still here, and nobody is watching the clock
  // that closely.
  for (let tryAgain = 0; tryAgain < 3 && !r.ok && retryable(r.status, r.body); tryAgain++) {
    await new Promise(done => setTimeout(done, 700 * (tryAgain + 1) + Math.random() * 500));
    r = await ask(schema);
  }
  if (!r.ok) throw new Error(`hatch api ${r.status}: ${r.body.slice(0, 140)}`);

  const j: any = JSON.parse(r.body);
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('hatch api returned nothing');
  return text;
}

export async function askOllama(
  desc: string,
  model = HATCH_MODEL,
  url = OLLAMA_URL,
  onProgress?: (chars: number) => void,
  temperature = 0.8,
): Promise<string> {
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      format: GENOME_SCHEMA,   // token-level shape guarantee, not just "json"
      options: { temperature, num_predict: 2000 },
      prompt: buildPrompt(desc),
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama ${res.status} — is \`ollama serve\` running?`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { response?: string; done?: boolean };
      out += j.response ?? '';
      onProgress?.(out.length);
      if (j.done) return out;
    }
  }
  return out;
}

// --- validation: clamps are the type-checker -------------------------------

const clampN = (x: unknown, lo: number, hi: number, fb: number): number => {
  const v = typeof x === 'number' && isFinite(x) ? x : fb;
  return Math.min(hi, Math.max(lo, v));
};
const hexOk = (c: unknown, fb: string) =>
  typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fb;

const ROLES = new Set<ChainRole>(['leg', 'arm', 'wing', 'tail', 'head', 'horn', 'fin']);
// Words that name a PERSON. A knight, a dwarf, a pirate captain is a body plan
// before it is anything else, and the model loses that constantly: six of the
// twenty heroes in roster run 001 came back as `llth` — a mirrored leg pair, a
// tail and a head. A dog. And an armless creature routes to STRIKE_BITE, so the
// witch-hunter with a crossbow bit people.
const HUMANOID = /\b(knight|squire|paladin|priest|priestess|cleric|monk|nun|ranger|hunter|huntress|archer|assassin|rogue|thief|bandit|duell?ist|swordsman|swordswoman|axemaster|spearman|warrior|soldier|guard|captain|pirate|sailor|nomad|wanderer|traveller|traveler|doctor|surgeon|smith|engineer|scholar|sorcerer|sorceress|wizard|witch|warlock|mage|necromancer|shaman|druid|bard|king|queen|prince|princess|lord|lady|noble|peasant|farmer|miner|dwarf|dwarven|elf|elven|elvish|halfling|gnome|human|man\b|woman\b|girl|boy|hag|crone|maiden|shieldmaiden|chieftain|barbarian|berserker|gladiator|mercenary|marauder|raider|cultist|acolyte|inquisitor|templar|samurai|ronin|ninja|monkish|celestial|angel|aasimar|tiefling|orc|goblin|hobgoblin|troll|ogre|giant|lich|vampire|ghoul|zombie|skeleton|wraith|revenant|mummy|golem|automaton)\b/i;
// "giant", "troll" and "beast" pull toward a person; the animal in the same
// sentence has the final say. A giant cave spider is a spider.
const NOT_A_PERSON = /wolf|hound|\bdog\b|\bcat\b|lion|horse|steed|bull\b|boar|deer|stag|\bbear\b|rhino|hippo|elephant|\box\b|goat|\bram\b|chimera|griffin|gryphon|drake|wyvern|dragon|scorpion|crab|toad|frog|newt|gorilla|\bape\b|beetle|spider|worm|slug|whale|shark|\beel\b|\bbat\b|\bowl\b|moth|bird|crawler|mound/i;
const TAILED_HUMANOID = /lizard|dragon|demon|devil|imp|tiefling|serpent|naga|rat|beast-|kobold|draconic|tailed/i;
const MANY_LEGGED = /spider|insect|bug|crab|centipede|arachnid|beetle|ant|six|eight|many legs|scuttl/i;
const SERPENTINE = /snake|serpent|worm|eel|naga|slither|legless|python|viper|cobra|adder|boa|anaconda|mamba|asp\b|wyrm|slug|noodle|tentacle|centipede|leech|lamprey/i;
const MANY_HEADED = /two[- ]head|three[- ]head|multi[- ]head|hydra|heads\b/i;
const MANY_ARMED = /four[- ]arm|six[- ]arm|multi[- ]arm|extra arm|many arms/i;

/**
 * The JSON a model actually produces, rather than the JSON it was asked for.
 * Together does not enforce the schema strictly, so things like `"lean": 0,5`
 * arrive — a comma where a decimal point belongs — and one stray character
 * throws away an entire summon. These are the failures worth surviving; a
 * genuinely unparseable body is still an error.
 */
export function parseLoose(text: string): any {
  try { return JSON.parse(text); } catch { /* try harder */ }
  let t = text.trim();
  // some models wrap the object in prose or a fence
  const open = t.indexOf('{'), close = t.lastIndexOf('}');
  if (open > 0 || close < t.length - 1) t = t.slice(open, close + 1);
  const fixes: [RegExp, string][] = [
    [/(\d),(\d)/g, '$1.$2'],          // 0,5  ->  0.5
    [/,\s*([}\]])/g, '$1'],            // trailing comma
    [/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":'],  // single-quoted keys
    [/:\s*\.(\d)/g, ': 0.$1'],        // .5 -> 0.5
  ];
  for (const [re, to] of fixes) t = t.replace(re, to);
  return JSON.parse(t);
}

export function validateGenome(raw: any, desc: string): Genome {
  const base = defaultBiped();
  const sk = raw?.skeleton ?? {};

  const body: number[] = (Array.isArray(sk.body) && sk.body.length ? sk.body : [0.26, 0.24])
    .slice(0, 8).map((v: unknown) => clampN(v, 0.05, 0.8, 0.25));
  const girth: number[] = (Array.isArray(sk.girth) && sk.girth.length ? sk.girth : [0.1])
    .slice(0, 10).map((v: unknown) => clampN(v, 0.02, 0.4, 0.1));

  let chains: ChainSpec[] = (Array.isArray(sk.chains) ? sk.chains : [])
    .filter((c: any) => ROLES.has(c?.role))
    .slice(0, 12)
    .map((c: any): ChainSpec => {
      const seg = (Array.isArray(c.seg) && c.seg.length ? c.seg : [0.3, 0.3])
        .slice(0, 4).map((s: unknown) => clampN(s, 0.03, 0.9, 0.25));
      if (seg.length < 2 && c.role !== 'horn' && c.role !== 'fin') seg.push(seg[0]);
      return {
        role: c.role,
        at: clampN(c.at, 0, 1, 0.5),
        seg,
        r: clampN(c.r, 0.01, 0.15, 0.05),
        spread: clampN(c.spread, 0, 0.5, 0.1),
        ...(typeof c.mirror === 'boolean' ? { mirror: c.mirror } : {}),
        ...(typeof c.ink === 'number' ? { ink: Math.min(3, Math.max(0, Math.round(c.ink))) } : {}),
        ...(typeof c.angle === 'number' ? { angle: clampN(c.angle, -1.6, 1.6, 0) } : {}),
      };
    });

  // budgets: generous enough for a spider, tight enough that a dwarf doesn't
  // sprout extra limbs the words never asked for
  const budget: Record<ChainRole, number> = {
    leg: MANY_LEGGED.test(desc) ? 5 : 2,
    arm: MANY_ARMED.test(desc) ? 3 : 1,
    wing: 1, tail: 1,
    head: MANY_HEADED.test(desc) ? 2 : 1,
    horn: 2, fin: 2,
  };
  const used: Partial<Record<ChainRole, number>> = {};
  chains = chains.filter(c => {
    const n = (used[c.role] ?? 0) + 1;
    if (n > budget[c.role]) return false;
    used[c.role] = n;
    return true;
  });

  // `at` has a meaning: 1 is the head end, 0 is the tail end. A model that
  // puts a head at 0 has misread the axis, not invented a new creature.
  for (const c of chains) {
    if (c.role === 'head') c.at = Math.max(0.78, c.at);
    if (c.role === 'tail') c.at = Math.min(0.22, c.at);
    if (c.role === 'wing') c.at = Math.min(0.95, Math.max(0.55, c.at));
  }

  // heads stacked at the same spot read as a single head — separate them
  const heads = chains.filter(c => c.role === 'head');
  if (heads.length > 1) {
    heads.forEach((h, i) => {
      h.spread = Math.max(h.spread, 0.12);
      h.mirror = false;
      h.at = Math.min(1, h.at - i * 0.04);
      h.angle = (h.angle ?? 0) + (i === 0 ? 0.25 : -0.15);
    });
    // one pair of necks leaning apart, rather than two heads in one place
    heads[0].mirror = heads.length === 2;
    if (heads.length === 2) chains = chains.filter(c => c !== heads[1]);
  }

  // A person is a person. The words won this argument before the model was
  // asked: two legs, arms that can hold the thing they were described holding,
  // upright, head on top. Anything else the model drew is kept.
  const humanoid = HUMANOID.test(desc) &&
    !NOT_A_PERSON.test(desc) && !MANY_LEGGED.test(desc) && !SERPENTINE.test(desc);
  if (humanoid) {
    const legs = chains.filter(c => c.role === 'leg');
    const arms = chains.filter(c => c.role === 'arm');
    // one mirrored pair of legs, never a quadruped's two girdles
    if (legs.length !== 1) {
      chains = chains.filter(c => c.role !== 'leg');
      const keep = legs[0];
      chains.push(keep
        ? { ...keep, at: 0, mirror: true }
        : { role: 'leg', at: 0, seg: [0.44, 0.43], r: 0.055, spread: 0.11, mirror: true });
    } else {
      legs[0].at = Math.min(legs[0].at, 0.12);
      legs[0].mirror = true;
    }
    // a person has two arms — and without the left one there is no hand for
    // the shield to be in
    for (const a of arms) a.mirror = true;
    if (!arms.length) {
      chains.push({ role: 'arm', at: 1, seg: [0.3, 0.28], r: 0.05, spread: 0.18, mirror: true });
    }
    // a knight has no tail; a lizardfolk does. The words say which.
    if (!TAILED_HUMANOID.test(desc)) chains = chains.filter(c => c.role !== 'tail');
  }

  // every creature needs a head to read as a creature
  if (!chains.some(c => c.role === 'head')) {
    chains.push({ role: 'head', at: 1, seg: [0.09, 0.12], r: 0.11, spread: 0, ink: 2 });
  }

  // Legless is a legitimate creature ONLY when something asked for it. A model
  // that bails on a prompt returns almost no chains, and the old rule read that
  // silence as "a snake" — so vague and hostile prompts all hatched as sausages.
  // Silence is not a body plan. Evidence for leglessness is the words, wings,
  // or a genuinely long tapering body; absent that, the thing gets legs.
  let locomotion: Locomotion =
    ['walk', 'slither', 'fly', 'hop'].includes(sk.locomotion) ? sk.locomotion : 'walk';
  const upright = humanoid ? true
    : typeof sk.upright === 'boolean' ? sk.upright : !MANY_LEGGED.test(desc);

  // Flying is a claim wings have to back. Without them it's just a hovering
  // blob, which is the same failure wearing a different word.
  if (locomotion === 'fly' && !chains.some(c => c.role === 'wing')) locomotion = 'walk';

  if (!chains.some(c => c.role === 'leg') && locomotion !== 'fly') {
    // Leglessness has to be earned by the words. Trusting the model's own
    // `locomotion: slither` is not enough — it reaches for it whenever the
    // prompt gives it nothing, and a shrug is not a body plan.
    const serpentine = SERPENTINE.test(desc) && !humanoid;
    if (serpentine) {
      locomotion = 'slither';
    } else {
      // A pair under the hips; low-slung bodies get a front pair too, so a
      // four-legged silhouette rather than a wheelbarrow. Length follows GIRTH,
      // not body span — scaling off span gave long creatures stilts, because a
      // wolf's leg is about as long as it is thick, not as long as it is.
      const len = clampN(Math.max(...girth) * 3.6, 0.14, 0.55, 0.4);
      chains.push({ role: 'leg', at: upright ? 0 : 0.08, seg: [len, len * 0.98], r: 0.055, spread: 0.11 });
      if (!upright) {
        chains.push({ role: 'leg', at: 0.72, seg: [len * 0.95, len * 0.9], r: 0.052, spread: 0.11 });
      }
      locomotion = 'walk';
    }
  }
  if (chains.some(c => c.role === 'leg') && locomotion === 'slither') locomotion = 'walk';

  // A head on a body with nothing else is a lollipop, not a creature. Anything
  // that stands up gets arms; anything that doesn't gets a tail to steer with.
  const limbs = chains.filter(c => c.role !== 'head').length;
  if (limbs < 2) {
    chains.push(upright
      ? { role: 'arm', at: 1, seg: [0.3, 0.28], r: 0.05, spread: 0.18 }
      : { role: 'tail', at: 0, seg: [0.22, 0.18, 0.13], r: 0.04, spread: 0 });
  }

  // A limb hangs off the BODY. `spread` is how far out to the side it
  // attaches, and the model returns the maximum every single time — 0.5
  // against a torso 0.17 wide puts the legs three times the body's own radius
  // out into the air, which is exactly what "the legs aren't attached" looks
  // like. Bound it to the thing it is attached to.
  {
    const at = (u: number) => girthAt({ ...sk, body, girth } as Skeleton, u * Math.max(1, body.length));
    for (const c of chains) {
      if (c.role === 'head' || c.role === 'tail') continue;
      const room = at(c.at) * 1.35 + 0.02;
      c.spread = Math.min(c.spread, room);
    }
  }

  // --- proportion ---------------------------------------------------------
  // The schema never said a torso has a sane shape, so the model spends its
  // budget at the extremes: pills (girth as wide as the body is long) and
  // planks (a slab running off the edge of the frame). Both stop it reading as
  // a creature. Ratios, not absolutes, so a wolf and a giant are both allowed.
  const span = body.reduce((a, b) => a + b, 0);
  const fattest = Math.max(...girth);

  // a person is taller than they are wide, and stands on legs not stumps
  const maxGirth = humanoid ? span * 0.34 : span * 0.55;
  if (fattest > maxGirth) {
    const k = maxGirth / fattest;
    for (let i = 0; i < girth.length; i++) girth[i] = Math.max(0.02, girth[i] * k);
  }
  if (humanoid) {
    const minLeg = span * 0.85;
    for (const c of chains) {
      if (c.role !== 'leg') continue;
      const total = c.seg.reduce((a, b) => a + b, 0);
      if (total < minLeg && total > 0) {
        const k = minLeg / total;
        c.seg = c.seg.map(v => Math.min(0.9, v * k));
      }
    }
  }
  // and nothing is longer than the room it stands in, unless it's a snake
  if (locomotion !== 'slither' && span > 1.8) {
    const k = 1.8 / span;
    for (let i = 0; i < body.length; i++) body[i] *= k;
  }

  const skeleton: Skeleton = { upright, body, girth, locomotion, chains };

  const gs = raw?.gait ?? {};
  const gait: Gait = {
    cadence: clampN(gs.cadence, 0.2, 2.2, base.gait.cadence),
    stride: clampN(gs.stride, 0.2, 2.4, base.gait.stride),
    stance: clampN(gs.stance, 0.5, 0.75, base.gait.stance),
    lift: clampN(gs.lift, 0, 0.3, base.gait.lift),
    bounce: clampN(gs.bounce, 0, 0.08, base.gait.bounce),
    sway: clampN(gs.sway, 0, 0.09, base.gait.sway),
    lean: clampN(gs.lean, -0.2, 0.5, base.gait.lean),
    slump: clampN(gs.slump, 0, 0.8, base.gait.slump),
    crouch: clampN(gs.crouch, 0, 0.25, base.gait.crouch),
    pelvisTwist: clampN(gs.pelvisTwist, 0, 0.3, base.gait.pelvisTwist),
    shoulderTwist: clampN(gs.shoulderTwist, 0, 0.4, base.gait.shoulderTwist),
    armSwing: clampN(gs.armSwing, 0, 1, base.gait.armSwing),
    elbowBase: clampN(gs.elbowBase, 0, 1.2, base.gait.elbowBase),
    elbowAmp: clampN(gs.elbowAmp, 0, 1.2, base.gait.elbowAmp),
    elbowLag: clampN(gs.elbowLag, 0, 0.4, base.gait.elbowLag),
    headPitch: clampN(gs.headPitch, -0.4, 0.8, base.gait.headPitch),
    flapAmp: clampN(gs.flapAmp, 0, 1.3, base.gait.flapAmp),
    tailWave: clampN(gs.tailWave, 0, 1.2, base.gait.tailWave),
    bodyWave: locomotion === 'slither'
      ? Math.max(0.6, clampN(gs.bodyWave, 0, 1.2, 0.85))
      : clampN(gs.bodyWave, 0, 1.2, 0),
  };

  const p = raw?.palette ?? {};
  const palette: Palette = {
    torso: hexOk(p.torso, base.palette.torso),
    limbs: hexOk(p.limbs, base.palette.limbs),
    head: hexOk(p.head, base.palette.head),
    accent: hexOk(p.accent, base.palette.accent),
  };

  // The prompt does NOT become the name. It was the summoner's words; it is not
  // the creature's identity, it should not travel to other players in a kill
  // feed, and it should not sit in a filename on a disk somewhere. The body
  // names itself — see src/naming.ts.
  // four colours that are actually four colours
  const genome: Genome = { name: titleFor(skeleton), skeleton, gait, palette: separate(palette) };

  // The words name the weapon, and the armoury builds a real one — a crossbow
  // with limbs, a scimitar that curves, a shield in the off hand. This used to
  // be a table of lengths and radii, which is why every armed hero was holding
  // the same grey stick.
  if (chains.some(c => c.role === 'arm')) {
    // The MODEL is the smith now: whatever it designed, priced and dressed,
    // is what the hand holds. The regex armoury answers only when the model
    // stayed silent — it is a fallback, not the source. This is the
    // difference between "nunchucks" being nunchucks and being a club.
    const rawAny = raw as any;
    const modelMade = (w: any) => w && Array.isArray(w?.parts) && w.parts.length ? w : undefined;
    const designed = validHeld(modelMade(rawAny.held) ?? modelMade(rawAny.weapon), desc);
    const designedOff = validHeld((raw as any).offhand, desc);
    const { main, off } = weaponsFromWords(desc);
    genome.weapon = designed ?? main ?? undefined;
    genome.offhand = designedOff ?? off ?? undefined;
    if (!genome.weapon) delete genome.weapon;
    if (!genome.offhand) delete genome.offhand;
  }
  // Temperament is the last thing the words do. They set three numbers — how
  // readily it starts a fight, whether it holds when hurt, how fast it moves —
  // and are then gone. A "savage" thing is savage forever after; nothing keeps
  // the word that made it so.
  genome.temper = temperFromWords(desc, temperOf(genome));

  // and what it is wearing. Armour, a helm, a hood, a cloak — the things that
  // make a knight look different from a nomad, which palette alone never did.
  const worn = gearFromWords(desc);
  if (worn.length) genome.gear = worn;

  // The last thing before it leaves: check it against what was asked for, and
  // fix what is cheaply fixable. A winged thing gets wings; a two-headed thing
  // gets its second head. Anything left unmet is reported, not invented.
  genome.missing = auditGenome(genome, desc)
    .filter(c => !c.met)
    .map(c => c.want);
  if (!genome.missing.length) delete genome.missing;

  return genome;
}

/** The model's held-thing design, clamped, priced and dressed — or nothing. */
function validHeld(raw: any, desc: string): WeaponSpec | undefined {
  if (!raw || !Array.isArray(raw.parts) || !raw.parts.length) return undefined;
  const spec = validateWeapon(raw, typeof raw.name === 'string' ? raw.name : 'held');
  if (!spec.parts.length) return undefined;
  const style = typeof raw.style === 'string' ? raw.style : undefined;
  const priced = priceWeapon(dressWeapon(spec, desc));
  return style ? { ...priced, style } : priced;
}

export async function hatchGenome(
  desc: string,
  model = HATCH_MODEL,
  url = OLLAMA_URL,
  onProgress?: (chars: number) => void,
  temperature = 0.8,
): Promise<Genome> {
  // A hosted endpoint if one is configured (that is how a deployed pit hatches
  // for people with no model of their own), otherwise the local Ollama.
  const text = HATCH_API_KEY
    ? await askOpenAI(desc, model ?? HATCH_MODEL, HATCH_API_URL, HATCH_API_KEY, temperature)
    : await askOllama(desc, model, url, onProgress, temperature);
  const genome = validateGenome(parseLoose(text), desc);

  // The smith's second chance. The words plainly name a carried thing, the
  // armoury has no word for it, and the genome pass did not design one — so
  // one small focused call forges it. This is what makes "nunchucks" be
  // nunchucks instead of nothing: the list of weapons we never wrote is the
  // whole point.
  if (!genome.weapon
    && genome.skeleton.chains.some(c => c.role === 'arm')
    && namesImplement(desc)) {
    try {
      const forged = await askSmith(desc, model, url);
      if (forged.parts.length) genome.weapon = priceWeapon(dressWeapon(forged, desc));
    } catch { /* bare hands, then — the fight goes on */ }
  }
  return genome;
}

/**
 * Do the words name something carried? A "carrying" verb, or "with a/two X"
 * where X is not anatomy. Deliberately loose — a false positive costs one
 * small model call; a false negative costs the whole point.
 */
function namesImplement(desc: string): boolean {
  const d = desc.toLowerCase();
  if (/(wielding|wields|carrying|carries|holding|holds|swinging|swings|armed with|brandishing)\s+\w/.test(d)) return true;
  // the article is optional — "with nunchucks" names a thing as plainly as
  // "with a net". Anatomy and plain description words are not implements.
  const NOT_A_THING = '(eye|horn|wing|leg|arm|head|tail|scale|fang|claw|tooth|teeth|fin|snout|beak|shell|mane|crest|hoof|hide|fur|face|bod(y|ies)|neck|maw|jaw|skin|scar|wound|feather|whisker|tusk|hump|stripe|spot|red|blue|green|black|white|golden|pale|dark|glowing|burning|no)';
  return new RegExp(String.raw`\bwith\s+((a|an|two|twin|dual|paired|his|her|its)\s+)?((giant|huge|big|small|long|short|great|rusty|old|heavy|sharp)\s+)?(?!${NOT_A_THING}s?\b)[a-z]{3,}`).test(d);
}

/** One focused smith call, on whichever brain this hatch is using. */
async function askSmith(desc: string, model?: string, url?: string): Promise<WeaponSpec> {
  const prompt = smithPrompt(desc);
  if (HATCH_API_KEY) {
    const res = await fetch(`${HATCH_API_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${HATCH_API_KEY}` },
      body: JSON.stringify({
        model: model ?? HATCH_MODEL, temperature: 0.8, max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`smith api ${res.status}`);
    const j: any = await res.json();
    return validateWeapon(parseLoose(j?.choices?.[0]?.message?.content ?? ''), desc);
  }
  const res = await fetch(`${(url ?? OLLAMA_URL)}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model ?? HATCH_MODEL, stream: false, format: 'json',
      options: { temperature: 0.8, num_predict: 600 },
      prompt,
    }),
  });
  if (!res.ok) throw new Error(`smith ollama ${res.status}`);
  const j: any = await res.json();
  return validateWeapon(parseLoose(j?.response ?? ''), desc);
}
