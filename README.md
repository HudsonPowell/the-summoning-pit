# rig

A creature is a genome: skeleton proportions + gait drivers + palette, ~750 bytes.
Nothing is keyframed. Nothing is drawn. The skeleton is resolved from drivers every
frame and renders itself — every pixel is a query against the bone field.

Long-term target: a web multiplayer dungeon game (Super Bomberman twist) whose every
creature is bred, judged, and curated rather than animated. See `ReadMe_MDs/HANDOVER_rig.md`
for the original brief and `CALIBRATION.md` for every constant we've verified — that
file is the only thing that accumulates.

## Run the studio

```
npm install
npm run dev
```

One creature, moving, changeable while it moves. No play button — it never stops.
Mood sliders are adverbs: they re-weight the same drivers, they are not new animations.
The camera is proof the skeleton is 3D: yaw around it, pitch to top-down, same genome.

## The void

```bash
PORT=5180 npm run dev
```

Open `/void.html`. **`/` to summon**, **c** for the controls, **p** for a PNG.

You do not walk around. You type, and something that has never existed walks
into the pit and fights on its own — the verb is summoning, not punching. Your
words are not kept: not on the genome, not in a filename, not over the wire.
What answers is named by its body (`src/naming.ts`), so nobody can read your
prompt back off it.

How it behaves comes from what it is made of (`src/temper.ts`): three numbers —
aggression, bravery, speed — read off armament, horns, extra heads, mass, leg
length and cadence. A horned armed heavy thing starts fights; a small unarmed
one keeps its distance; long legs and a quick cadence make it fast. The words
nudge those numbers once at hatch (savage, timid, swift, lumbering) and are then
discarded, so a savage thing stays savage without anything remembering why.

## The pit — a place that is still there tomorrow

```bash
npm run pit      # the pit itself: owns the world, keeps it, narrates it
PORT=5180 npm run dev
```

Open `/void.html?live`. Everyone is in the same pit; there are no rooms.

**There is always someone in there.** The pit holds the last one standing and
nothing else — whoever won stays, whether anyone is watching or not. Nothing
spawns while something is alive, so a challenger has to be summoned by a person;
only an empty pit refills itself. Left alone the keeper lives its own life: it
wanders, looks at nothing in particular, and after a while lies down and sleeps.
It is on its feet within a second of anything arriving.

**No accounts. The URL is the account.** The pit mints you a key the first time
you arrive and writes it into your address bar — bookmark that and you are you.
The server stores a *hash* of your key, never the key, so the state file cannot
be used to claim anything.

**Bring your own model.** Creatures are hatched in your browser, so the model is
yours: `?model=qwen2.5:14b` and `?ollama=http://localhost:11434` are remembered.
Only the finished body crosses the wire — the pit never learns what you typed.
If you have no model at all, the words go to the pit and it hatches for you.

A better model gets you a better creature, but only in one direction. The server
**derives temperament from the body** and never takes it from the wire, and it
**caps mass** — so a better model wins you proportion, coherence, a weapon that
suits and limbs that make sense. It cannot win you numbers. Everyone gets the
same amount of creature to spend; being big costs speed.

**Pacts are links.** Send someone `?pact=<your owner id>` and their creatures
will spare yours; `?feud=<id>` and they will come for you. One-way — they need
not reciprocate and nothing tells you whether they have — and not transitive.
Nothing is ever announced on screen. You find out who is in by messaging them.

## Deploying it

One image, one service, one domain: the client is built at image-build time and
served by the pit itself, so the websocket is same-origin and gets `wss://` from
the platform's TLS with nothing to configure.

```bash
npm run build && npm start        # exactly what the container does
```

**Mount a volume, or the pit forgets everything on every deploy.** Container
filesystems do not survive a restart. Point `PIT_STATE` at the volume:

| variable | what it does |
|---|---|
| `PORT` | supplied by the platform |
| `PIT_STATE` | `/data/pit-state.json` — **must be on a mounted volume** |
| `PIT_HATCH` | `off` to refuse word-summons (body-only pit, no model needed) |
| `HATCH_API_KEY` | hatch through an OpenAI-compatible endpoint |
| `HATCH_API_URL` | defaults to Groq's; any `/v1` endpoint works |
| `HATCH_MODEL` | model name for whichever backend |
| `PIT_POPULATION` | how many the pit refills to when empty (default 1) |

There is no GPU on a normal container, so a deployed pit that hatches for
visitors needs `HATCH_API_KEY` pointed at a hosted model. Without one, set
`PIT_HATCH=off` and the pit accepts only bodies — which still works for anyone
running a model locally, and costs nothing to run.

`/health` reports agents, watchers, how long the pit has been open and the age
of its oldest creature.

## Play CLASH (arena mode)## Play CLASH (arena mode)## Play CLASH (arena mode)

`npm test` runs the sim suite: a 900-tick replay must hash identically
(determinism is what netcode will rest on) plus one assertion per class rule.

Open `/clash.html`. The game per `ReadMe_MDs/CLASH.md`: 2 players, one
keyboard (P1 wasd / f place / g strike, P2 arrows / enter / shift). Movement
is four-way and grid-honest; the BODY turns freely to whatever you're asking
for, so pressing into a wall while running a corridor gives a diagonal,
shouldered-into-the-wall pose without breaking the grammar. Deterministic 60Hz integer
sim in `src/clash/sim.ts` (no DOM, no floats); figures are rig genomes
rendered flat — there are no sprites. `window.clash.step(n, inputs)` drives
the sim deterministically for tests.

## Run the arena (rig demo)

Open `/grid.html` from the dev server. Bomberman tiles: WASD/arrows to move,
space to bomb, **x to slash** — the sword cuts soft blocks and enemies. Left
alone the player wanders and occasionally bombs itself. The enemy is
`genomes/bred-tired.json` — the creature the farm evolved from text, walking
into the game unedited; get close and the tired thing turns angry and swipes.
Hurt is a mood re-weighting (tired 0.6 / angry 0.4) plus a speed cut. There are
no animations anywhere in this paragraph, which is the point.
`window.rig.step(dt)` advances the sim manually for tooling.

## Run the farm (headless, local models)

```
npm run farm:strip    # render mood contact sheets headlessly
npm run farm:judge    # local CLIP scores walks against text descriptions
npm run farm:evolve   # breed a walk from a description, no mood system involved
```

The judge validation must keep its diagonal: each description scores highest on the
walk it describes. `farm:evolve` starts from the neutral genome, mutates raw gait
drivers, and lets a sentence supply the selection pressure. First run bred a visible
trudge from "slumped, exhausted, shuffling" in 5 generations (fitness 0.024 → 0.655),
output in `genomes/bred-tired.json`.

## Layout

- `src/genome.ts` — the genome schema, the default biped, mood re-weighting
- `src/pose.ts` — drivers → joints, every frame (gait, IK, spine, arms)
- `src/render.ts` — bones → pixels (capsule field, quantised shading, hard threshold); pure buffers, no DOM, shared by studio and farm
- `src/main.ts`, `src/ui.ts`, `index.html` — the studio
- `farm/` — headless render + judge + evolve
- `genomes/` — creatures worth keeping
