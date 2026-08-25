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

## Run the arena

Open `/grid.html` from the dev server. Bomberman tiles, one creature: WASD/arrows
to move, space to bomb; left alone it wanders and occasionally bombs itself.
Bombs burn a flame cross, destroy soft blocks, and hurt the creature — the hurt
reaction is a mood re-weighting (tired 0.6 / angry 0.4) plus a speed cut. There
is no hurt animation, which is the point. `window.rig.step(dt)` advances the sim
manually for tooling.

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
