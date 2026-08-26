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

**No accounts. The URL is the account.** The pit mints you a key the first time
you arrive and writes it into your address bar — bookmark that and you are you.
Lose it and your creatures carry on without anyone able to claim them. The
server stores a *hash* of your key, never the key, so the state file cannot be
used to claim anything.

**Your prompt never reaches the pit.** Creatures are hatched in your browser and
only the finished body crosses the wire. The server renames whatever arrives
after its own skeleton, so a name cannot smuggle the words back out either.
Everything inbound is clamped (`server/sanitise.ts`) because a socket is not a
friend: three living creatures per key, one summon every twenty seconds.

**Pacts are links.** Send someone `?pact=<your owner id>` and their creatures
will spare yours. Send `?feud=<id>` and they will come for you. One-way — they
need not reciprocate and nothing tells you whether they have — and not
transitive, so the pit fills with a web rather than two blocs. Nothing is ever
announced on screen. You find out who is in by messaging them.

**It keeps running.** The pit saves every five seconds and on shutdown; on boot
it reopens with everyone still standing, still carrying their kills and still
wearing what they took. `/health` reports how long it has been open and the age
of its oldest creature.

## Play CLASH (arena mode)## Play CLASH (arena mode)

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
