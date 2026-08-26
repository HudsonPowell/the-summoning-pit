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

## Play the void

```bash
PORT=5173 npm run dev
```

Then open `/void.html?play`. Arrows or WASD to move, **space** to strike,
**shift+space** for the heavy one, **c** for the controls, **p** to grab a PNG.

You are handed one of the creatures on the shelf and dropped into the pit with
five others. Nothing else changes: the beasts notice you, close on you and run
from you exactly as they do each other, because your creature IS one of them —
the only difference is that its intent comes from a keyboard instead of the
state machine. Swing near something and you turn to face it. Die and you come
back after a beat as whatever the pit hands you next, which is also how you
meet the bestiary.

## The pit (multiplayer)

```
npm run pit      # the server: owns the void, narrates it
npm run dev      # the client
```

Then open `/void.html?live` in as many browsers as you like — everyone watches
the same creatures. `npm run pit:test` proves two clients agree.

The server owns the sim; clients only render. Two things cross the wire:
POSITIONS at 12Hz (~5 KB/s per watcher) and EVENTS the moment they happen.
Genomes travel once, by id, because the expensive data never changes. The
event stream is deliberately rich — who struck whom, with what, at what range
— because one record feeds sound, camera, the feed, records and clips.

## Play CLASH (arena mode)

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
