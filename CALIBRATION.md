# Calibration

Once a value feels right it gets written down as verified and never re-derived.
This file is the only thing that accumulates. Add, don't rewrite.

## Verified 2026-08-25 (studio v1, eyeballed in browser)

### Gait
- `stance = 0.6` — fraction of cycle each foot is planted. From human gait data, reads right.
- `elbowLag = 1/6` cycle — elbow flexion trails shoulder swing. Carried from 2D prototypes; still most of what reads as natural.
- Elbow flexion only, never hyperextends: `beta = elbowBase + elbowAmp * 0.5 * (1 + sin(2π(p - lag)))` keeps it ≥ elbowBase ≥ 0.
- Pelvis rides highest at mid-stance: `bounce * cos(2·2π(φ − 0.3))` with left-leg phase offset 0, right 0.5. The 0.3 centring is what stops it reading as bobbing on the wrong beat.
- Shared foot track, half a cycle apart (offset 0.5) — legs pass each other correctly. Planted-foot travel relative to body = `stride × stance`, centred.
- Swing-foot x eased with `(1 − cos(πu))/2`, lift with `sin(πu)`. Reads fine; no need for fancier easing yet.
- Arms swing opposite their own-side leg (offset 0.5 from it).
- Knee pole = +x (forward), fixed. Stable fold, no pole-vector fiddling needed at walk speeds.
- Default biped: cadence 0.9 cyc/s, stride 1.35 m → 1.22 m/s. Human-plausible and reads right.

### Mood re-weighting (adverbs)
- `tired=1` verified reading as exhausted trudge; `angry=1` as aggressive charge. Formulas in `src/genome.ts effectiveGait()`. Key discoveries:
  - Slump must bend only the *upper* spine segment — bending the whole spine reads as "leaning" not "tired".
  - Angry needs elbowBase +0.5 (fists come up) more than it needs armSwing.

### Rendering
- Low-res buffer 176×176 at 72 px/m → figure ~130 px tall, well above the ~12-cell readability floor.
- Threshold, not downscale (carried from prototypes, still true).
- Cross-section shading `0.5 + 0.5·sqrt(1−q²)` quantised to 4 levels; depth dim 22% across the creature's z-range.
- Outlines: silhouette ×0.35; interior edge where neighbour is >0.1 m nearer ×0.55. The interior edge is what separates near limbs from torso — without it the figure smears into one blob.
- Far-side limbs tinted ×0.8 — cheap and does a lot of depth work.
- Ortho floor rays: do NOT cull s<0; ortho ray origins sit mid-scene, half the floor is "behind" them.
- Camera default yaw 0.5, pitch 0.22 (3/4 view). Pitch 0.85 verified as a working dungeon-crawler top-down view of the same skeleton.

### The judge (farm)
- Model: `Xenova/clip-vit-base-patch32` (local, ~quantised ONNX via transformers.js).
- **Absolute scores are junk. Pairwise contrast is where the signal lives**: score = P(target description) vs its authored opposite, softmax over just those two. With three-way generic labels, a bland caption eats everything.
- SigLIP (sigmoid scores) was tried first and abandoned: scores near zero, unusable ordering at reasonable precision.
- Input: 2×2 contact sheet of phases 0, .25, .5, .75 at 176 px/frame. Sufficient for posture-level qualities.
- Validation matrix (P(quality), diagonal must win):
  neutral/tired/angry × tired-axis = 0.010 / **0.103** / 0.035; × angry-axis = 0.081 / 0.369 / **0.408**. Diagonal wins both.
- Evolution: pop 12, 5 generations, elite 3, mutation rate 0.5, scale 0.25 of param range. Fitness on "slumped exhausted shuffling" went 0.024 → 0.655 and the winner visibly trudges. Overshoots theatrically — future runs likely want a plausibility regulariser (penalise distance from baseline, or a second "looks like a person walking" contrast).

## Verified 2026-08-25 (arena v1)

### Rendering, continued
- **Depth convention: larger view-z = closer to camera.** The renderer originally
  had this inverted; a single figure self-occludes subtly enough to mask it, a
  pillar in front of a torso does not. If occlusion ever looks wrong again, check
  the sign here first.
- Arena camera: yaw 0, pitch 0.62, 40 px/m, follow-lerp 4/s. Creature must
  visibly tower over walls — pillars capped at 0.44 m tall, r 0.33.
- Floor checker aligned to logical tiles: `floor(w/tile + 0.5)` with tile = 1 m
  (tile centres on integer coords).

### Game feel
- Flame lifetime 0.6 s. 0.35 s is physically fine and perceptually invisible.
- Hurt is an adverb, not an animation: mood {tired 0.6, angry 0.4} + speed ×0.45
  + 10 Hz white flash for 0.7 s. Reads instantly.
- Lane assist: perpendicular axis drifts to tile centre at 6/s while moving.
  Bomberman navigation feels broken without it.
- Idle↔walk blend at 8/s on a single `move` weight scaling all locomotion
  amplitudes; breathing (0.012 m at 0.35 Hz) fades in as it fades out.

### The judge, continued
- **Plausibility regulariser: fitness = target-contrast × plausibility-contrast**
  ("a humanoid figure walking on two legs" vs "a broken contorted tangle of
  limbs"). Unregularised evolution breeds expressive pretzels (fitness 0.655,
  folded double); regularised winner (0.252) still visibly trudges but stands
  like a person. Multiplication, not min — both qualities must be present.

### Intent layer (slash), verified 2026-08-25
- Slash claims the right arm + borrows torso twist; locomotion never consulted.
  Hand follows a bezier through three direction posts (wind-up back-high,
  strike forward, follow-through down-across); elbow re-solved by IK with pole
  back-and-out `(-0.6, -0.25, 0.9)`.
- Timing: wind-up 40% of the move, strike 20%, settle 40%, total 0.55 s.
  The whip lives in that compressed middle fifth.
- Blend envelope: in over first 12%, out over last 18% — locomotion arm swing
  underneath never pops.
- Reach varies `(upper+fore) × (0.72 + 0.24·sin(πu))` — bent at wind-up,
  extended at strike.
- Weapon = a capsule continuing the elbow→hand line. Grip offset 0.06 m past
  the hand. Reads as held, no orientation math needed.
- Strike event fires once at t = 0.55: soft block 1 tile ahead crumbles;
  creatures within 1.15 m and ≥ 0.4 dot-product in front get hurt + 0.35 m
  knockback.

### Enemy behaviour
- The arena enemy IS genomes/bred-tired.json, unedited — farm output in game.
- Chase radius 3.2 m, axis-dominant pursuit (lane-honest), melee trigger < 1.0 m.
  Chase mood: angry = 1 stacked on the bred gait. Hurt suspends chasing.

### Death & rounds (verified 2026-08-25)
- Death is a `collapse` driver (0..1 over 0.45 s): pelvis height ×(1−0.72c),
  slump +1.0c, lean +0.3c, head +0.8c. The legs fold because IK folds them —
  no death animation exists. Fade from 0.8 s, despawn at 1.6 s.
- HP: player 5, enemies 3. hurtT doubles as the invulnerability window.
- Round n spawns min(1+n, 5) enemies from the genome pool, ≥4 m from the
  player; 8% of open tiles regrow soft cover between rounds.

### Breeding, continued
- Body proportions now evolve too (mutation rate ×0.6 vs gait). Seeded
  multipliers per target give evolution a head start on silhouette.
- skittish converged hard (0.851): creeping low, arm feeling ahead. Palette +
  contrast pair in farm/evolve.ts TARGETS.
- **CLIP cannot judge size.** "huge lumbering brute" scored ~0.002 — relative
  scale is invisible in a lone image. The brute silhouette came entirely from
  the body seed. Size-flavoured targets need seeded bodies or side-by-side
  comparison judging.
- Enemies must not share the player's palette — bred-tired was invisible
  standing right behind the player until recoloured. Distinct palette per
  bred genome is part of the genome, set at breed time.

### Genome v2 — general body plans (verified 2026-08-25)
- Skeleton = tagged chains (leg/arm/wing/tail) attached to girdles (hip/chest).
  Layers claim roles; nothing counts limbs.
- **The one gait rule: leg phase offset = girdleIndex×0.25 + (right? 0.5) +
  chainIndexOnGirdle×0.125.** This alone produced a correct lateral-sequence
  quadruped walk on the first run — the hound was never taught to walk. The
  architecture's founding test passed.
- Prone frame: pelvis at −0.45·spine, chest at +0.45·spine; front girdle's
  bounce runs 0.25 cycle after the hind's.
- Wings flap at 2× gait phase while moving, slow flutter at 0.6 Hz when idle.
- Tails: per-segment yaw lag 0.9 rad, pitch folds −0.28/segment, droop rides
  slump (so tired/dead creatures' tails fall).
- Extra arm pairs stack downward 0.13 m/pair with 0.06-cycle phase lag.
- v1 biped JSONs load through migrateGenome — bred creatures survived the
  schema change untouched.
- Perf: studio down to ~24 fps with multi-chain creatures. WebGPU port moves up
  the list.

### GPU renderer (verified 2026-08-25)
- WebGPU fragment shader replicates the CPU bone field exactly: same
  projection, quantised shading, depth dim, outline rules (outline = 4
  neighbour re-evaluations per pixel — GPUs eat the 5× loop happily).
- **The CPU renderer in render.ts is the reference implementation** (and the
  farm's headless path). If GPU and CPU ever disagree, the CPU one is right.
  The math is duplicated in gpu.ts — change both or the pictures drift.
- Resolution is now nearly free on GPU: 512×384 arena renders without strain.
- Floor fade radius raised 7 → 10 m for the zoomed-out play camera.
- Arena defaults: ppm 26 (was 40) at 240×180 — half the arena in frame reads
  much better as a play view. Live controls: zoom 14–64 ppm, resolution
  160–512 wide (×0.75 tall). Studio: resolution 96–400 square.
- Wall culling must derive from viewport size (`W/2/ppm`, with pitch
  correction on z) — fixed cull distances vanish walls when the player zooms out.

### Pace (feedback-driven, 2026-08-25)
- Original walk speeds read as sluggish in play (Jody). Base gait raised to
  cadence 1.05 / stride 1.45 (~1.5 m/s), and the arena has a global `pace`
  multiplier (default 1.5, slider 0.6–2.5) that scales ground speed, cycle
  rate, AND slash speed together — scaling only speed makes feet slide.

### Text-to-creature (verified 2026-08-25)
- `npm run hatch -- "<description>"` — llama3.2:3b via local Ollama emits a
  genome (format: 'json'), hard clamps validate every number, structural rules
  repair the skeleton (≥1 hip leg; prone needs chest legs and loses arms),
  CLIP scores the walking result. Hatched genomes land in genomes/ and
  auto-join the arena enemy pool via the glob.
- First hatches: structurally valid walking creatures every time; weak on
  interpretation (sizes ignored — "tiny" isn't; palettes off-theme). 3B is
  enough for the pipeline, not for taste. Paths up: 8B model, size words →
  explicit seg-length guidance in the prompt, or hatch-N-keep-best composed
  with the CLIP judge.
- Prompt structure that worked: schema rules + three real example genomes
  (biped, winged, quadruped) + the description. The examples matter more than
  the rules.

### In-studio hatch (verified 2026-08-25)
- The studio's hatch box calls Ollama directly from the browser (Ollama's
  default CORS allows any localhost origin), then POSTs the validated genome
  to the dev server's /api/genome endpoint (vite middleware), which writes it
  into genomes/ — where the arena glob makes it an enemy.
- **Stream Ollama responses, always.** A `stream: false` generate call holds a
  silent connection ~20s and some environments cull it (empty body, confusing
  parse error downstream). Streaming NDJSON also gives live progress for free.
- Vite only loads vite.config.ts present at startup — creating the config
  while the server runs does nothing; restart the dev server.
- Size vocabulary added to the hatch prompt (tiny legs 0.1-0.18 … huge
  0.55-0.7, thickness by bulk); shared pipeline lives in src/hatch.ts,
  CLI wrapper + CLIP reviewer in farm/hatch.ts.

### Hatch repairs (2026-08-25, after "heavy set dwarf with axe" → 4 arms, no axe)
- **Prose rules don't bind a 3B model; repairs must be code.** The validator now:
  - forges a weapon from description words (axe/club/sword/spear/hammer/staff
    each with authored length/r/colour) whenever the model forgets one;
  - caps chains at one per role (legs: one per girdle) unless the description
    asks for extra limbs (regex escape hatch: "four-armed", "six legs", …);
  - strips leg@chest from upright creatures (dangling chest-legs), or
    reattaches them to the hip when they're the only legs.
- Genome names/slugs come from the DESCRIPTION, not the model's invented name —
  rerolling the same words overwrites the dud in the pool instead of spamming it.
- Reroll runs at temperature 0.9 (vs 0.7) for variety.
- Effect: dwarf judge score 0.075 → 0.219, correct silhouette on next roll.

### The hatch-reset bug (2026-08-25)
- Symptom: hatched creature "flashes up then resets". Cause: saving the genome
  file landed in a directory covered by the arena's `import.meta.glob`, which
  put genomes/ in the module graph — and Vite broadcasts glob-invalidation
  full-reloads to EVERY connected client, including the studio tab.
- Fix: **never glob a directory the app writes into.** The arena now fetches
  the pool from GET /api/genome at runtime; the watcher ignores genomes/ and
  farm/out/. Bonus: the arena picks up new creatures on every page load with
  no rebuild.
- Belt-and-braces: the studio persists the current creature to sessionStorage
  on every adopt and restores it on load — no reload of any cause can eat a
  hatch again.

### CLASH ARENA sim (verified 2026-08-25, /clash.html)
- 60Hz fixed tick, integers only: positions in sub-px (4/px), timers in ticks,
  seeded LCG the sole randomness. Constants: box 12px in a 16px corridor,
  ASSIST 5px (spec's number — feel-tune pending), speed 3 sub/tick (~2.8
  tiles/s, boots to 6), fuse 150, flame 30, radius 2.
- **Solid-tiles-you-overlap never block you** — you can walk out of anything,
  never back in. This one rule replaces the owner-pass flag AND fixes the
  freeze-on-own-candle death (the box still straddles the candle tile after
  the centre leaves it; a centre-based flag glues the player to the blast).
- 32x22 with the (even,even) lattice is NOT 180-degree symmetric: mirrors of
  odd-odd tiles are pillars. Spawns must be odd-odd ((1,1)/(29,19) — the
  corner (30,20) IS a pillar), and mirrored block placement needs a
  mirror-is-floor check; odd-odd tiles roll independently at the same rate.
- Resolution queue verified: two candles 44 ticks apart resolved on the same
  tick when the first's cross touched the second (8-tile merged cross).
- Round flow verified: kill -> winner -> win pip -> 2.5s -> full reset, wins
  persist. Draws possible by design.
- Figures are rig genomes rendered flat at 13 px/m (~22px tall) with bulk
  x1.7 — unscaled limbs are 1px and vanish. Facing: profile yaw 0.45,
  mirrored via canvas flip for left; back -1.1; front 2.4.

### The character model (2026-08-25)
- A character = genome + named behaviour sets + weapon spec + blast spec,
  ~4KB total. Behaviours are typed data: 'gait' (a Gait + mood), 'still'
  (collapse/tired/breathe — idle and sleep are the same type, different
  numbers), 'strike' (parameterised arc: duration, windup/strike fractions,
  bezier posts, reach range, torso twist).
- behaviours.walk.gait shares the genome.gait OBJECT — walk is canonical;
  chip-switching repoints genome.gait at the active behaviour's gait so the
  solver and sliders stay honest.
- Defaults derived, not authored per character: run = walk transformed
  (cadence x1.35, stride x1.25, lean+, swing+); sleep = still with collapse
  0.82 + slow deep breath. Light strike 0.38s low flat arc; heavy 0.95s
  overhead (windup 50%, strike 14%).
- Weapons are capsule parts in GRIP SPACE (+x along blade, +y knuckle-side);
  the smith (llama3.2:3b) composes 2-6 parts; hard clamps keep it holdable;
  keyword armoury answers when ollama is down. First forge: a 6-part staff
  with orb + ember nodes — genuinely composed, not from the armoury.
- Stores: characters/ via /api/characters (GET/POST/DELETE), never glob'd,
  watcher-ignored. genomes/ remains the legacy pool; bestiary lists both
  (legacy badge) through migrateCharacter.
- Bestiary thumbnails are the real rig walking at 64px — there are no
  preview images anywhere in the app.

### Arena gameplay experiment (2026-08-25)
- **Two attacks per character, cleanly split**: the BLAST is the placed
  cross (the CLASH verb — its delay and radius are authored per character in
  the forge, its core/edge/pattern colour the candle and flames per owner);
  the STRIKE is melee (g / shift), driven by the character's attack-light
  spec, 26 ticks, hit at tick 14, range 1.2 tiles, front arc + point-blank.
- HP model while beasts exist: players 3hp, 1s invuln on any hit; flames
  1 damage; beast contact 1 damage. Face-tanking a beast is lethal by
  design — bomb them or hit-and-run.
- Beasts: kind=beast characters spawn min(1+round, 6) at odd-odd tiles ≥7
  tiles from spawns, wander with seeded repath, chase within 4 tiles, 2hp.
  All beast state lives in the int sim; genomes only matter to the renderer.
- Hero select reloads the page — a clean deterministic restart beats
  hot-swapping sim config mid-round.
- Arena look persists in localStorage (clash-cfg: heroes, figure style
  flat/shaded, board tone, scale 1-3x) with a reset-look button. Melee
  can hit point-blank (pure front-arc dot test fails at zero distance).

### Sound & juice (2026-08-25)
- Audio is fully synthesised (WebAudio, zero samples) in src/clash/audio.ts.
  Per the design doc, the fuse is a gameplay system: every candle hums, pitch
  180→600Hz as it shortens, waveform per owner (square/saw/tri/sine), gain
  flutters up in the last third. AudioContext must be created on first
  keypress (autoplay policy) — ensureAudio() on keydown.
- The sim emits a typed event stream (g.events, cleared each tick, pure
  output — determinism untouched). Presentation consumes it: sound, hit-stop
  (4 frames on strike connect, 8 on death — acc zeroed so no catch-up
  burst), screenshake (explosions scale with tile count, decay 0.82/frame).
- Bite telegraph: 24 ticks (0.4s) of rear-up with a ! marker before the
  lunge lands — 16 ticks was too fast for a human to react. Windup uses the
  beast's own attack-light strike anim. Cooldown 50, lunge range 1.2x contact.
- Ground shadows: a 3px solid dark rect under every figure. Cheapest
  grounding win in the whole renderer.
- Round flow: 2s frozen countdown (3-2-1-GO toasts + ticks) each round;
  first to 3 wins takes the match (toast + fanfare, 6s, then full reset).

### The seven class rules (2026-08-25) — pattern IS the game
Each pattern changes exactly ONE rule of the verb; damage is identical
everywhere, per the design doc. All verified by `npm test`.
- FLAME — baseline damage cross, one block per arm.
- RUNE — damage cross, but an enemy standing still on it for 36 ticks (0.6s)
  scuffs it out. Movement resets the counter; scuffing never damages.
- VINE — grows wall (240 ticks) instead of destroying; crushes what it grows
  through, stops at blocks without consuming them, buries rather than chains.
  **The origin tile never crushes** — you can always step out of your own
  placement, the same principle as the collision overlap allowance.
- OIL — two-part: puddles paint instantly, inert and harmless, and wait for
  ANY player's real fire; ignition flood-fills the connected slick. Placement
  is on a cooldown (the fuse value) rather than a candle count.
- CURSE — ordinary damage cross rendered at 0.22 alpha as a 2px smudge:
  hidden information in a genre with none.
- BELL — non-lethal: radius+1, soft flame (flameSoft=1, 12 ticks) that damages
  nothing and shoves bodies 2 tiles outward along each arm.
- IMP — the placeable walks: 3 tiles at 2 sub-px/tick in the placer's facing,
  passing over tiles as non-solid, then arms with a 60-tick fuse.

### Sim tests (farm/sim_test.ts, `npm test`)
- Determinism: a 900-tick scripted replay hashes identically across runs for
  all seven patterns; different seeds diverge. This is the property netcode,
  spectating and desync detection will rest on — run it after ANY sim change.
- Class-rule assertions cover every bullet above. A weak-looking result is
  worth a second look: the bell's 5-subpixel shove was a wall correctly
  stopping it, confirmed by clearing the lane (then 2.03 tiles).

### Soft-field blending (2026-08-25)
The bone field can resolve with an exponential smooth-min instead of hard
nearest-capsule, so parts fuse at the joints and their inks cross-fade.
- Two sweeps: the first finds per-pixel nearest surface (signed distance s,
  depth, radius, ink); the second accumulates `w = exp(-(s - minS)/k)` from
  every capsule within `k*6` px and inside the depth gate. Then
  **`smin = minS - k·ln(ΣW)`** and **`q = 1 + smin/r`** — the same q the hard
  path uses, so shading/quantisation is untouched. At k → 0 it collapses
  exactly onto the old field, so blend 0 is bit-identical to before.
- Four controls (forge → render): **blend** (softness k, px), **blend depth**
  (max view-z gap a part may bleed across, m), **colour mix** (0 keeps the
  nearest ink, 1 full weighted mix), **shape fuse** (0 keeps the hard
  silhouette while colours still blend, 1 fully fused).
- **Fusing inflates the surface** — that's inherent to smooth-min. `shape
  fuse` exists precisely to dial it back: `smin = minS + (sminFull - minS)·amt`.
  At k=4 with shape fuse 1 the figure reads melty; shape fuse 0 keeps the
  silhouette tight with the colour bleed intact. Useful zone is k 1.5–2.5.
- Sweet spot found by eye: k 2.0, depth 0.35, mix 1, shape 0.5.
- GPU shader mirrors the same maths (two loops per pixel, `softHit`); WGSL
  module-scope `var<private>` must be declared BEFORE the function using it.
- `npx tsx farm/blend_test.ts` renders the parameter grid (k across, shape
  fuse / depth bleed down) — quickest way to re-judge the look.
- Arena persists a single `blend` in its look settings (shape fuse fixed at
  0.5 so silhouettes stay readable at 22px).

### Limb depth — two real bugs, found by Jody's eye (2026-08-25)
Both caught by `farm/render_test.ts`, which now runs as part of `npm test`.
1. **Depth came from the capsule AXIS, not its surface.** A capsule's surface
   bulges toward the camera by up to a full radius — precisely the scale at
   which limbs overlap — so crossing limbs sorted essentially by luck. Fixed:
   `z = axisZ + sqrt(r² - d²)/ppm`. The near CAP is tested separately, because
   a limb aimed at the camera projects to a point where the segment-closest
   test degrades and the cap is what you actually see.
   **Radii are in pixels, depths in metres — divide the bulge by ppm.**
2. **The blended path picked the winner by smallest signed distance**, i.e.
   whichever capsule the pixel was DEEPEST INSIDE, not whichever was in front.
   A fat far limb painted over a thin near one. Fixed: the smooth-min still
   uses the true `minS`, but ownership (depth/ink/radius) goes to the greatest
   surface z among capsules actually covering the pixel, with an
   only-in-the-fuse-margin fallback (`insideHit` flag).
Sorting artefacts on limbs are almost always one of these two; check the axis
-vs-surface question first.

### Control feel & orientation (2026-08-25)
- **Figures are now turned to their heading and shot with ONE fixed camera**
  (`rotY(cap, -heading)`, cam yaw 0 / pitch 0.3), replacing the old trick of
  snapping between four hand-picked camera yaws plus a canvas flip. Any angle
  works, so diagonals orient correctly and a turn reads as a turn.
  `heading = atan2(fy, fx)` maps straight from grid input: +x east, +z toward
  the camera (screen-down). Verify with `npx tsx farm/facing_test.ts`.
- The smoothed heading lives in the RENDERER (0.45 toward target per frame),
  never in the sim — the sim keeps integer facing, so determinism is intact.
- **The space stays four-way; the BODY turns freely.** Jody's framing, and
  it is better than the 8-way movement I first built (now removed): movement
  is one axis per tick, grid-honest, but the pose turns to the raw INPUT
  intent. Running up a thin corridor while also pressing left keeps you
  moving up and swings the body to a diagonal, leaning on the wall. Reads as
  physical contact rather than a snap between four poses.
- Three separate quantities, and keeping them separate is the trick:
  `ix/iy` intent (drives the drawn heading), `fx/fy` four-way facing
  (gameplay: strike arc, imp direction — grammar untouched), `pressX/pressY`
  an axis asked for and refused (a wall being leaned on). The last two are
  presentation-only outputs of a deterministic sim.
- Wall lean is a 1.6px positional nudge toward the pressed wall. Turning is
  exponential at rate 16/s using real frame dt, so it feels the same at any
  refresh rate.
- Forge arrow keys orbit: tap = 0.045 rad, shift-tap = ⅛ of that, hold =
  1.4 rad/s continuous, `[` / `]` snap to compass eighths. Camera sliders
  stepped down to 0.001 so a fine nudge is actually visible in the readout.

### Dev environment
- The sim clock is rAF-driven; a hidden browser pane suspends rAF and freezes
  the sim. `window.rig.step(dt)` advances it manually — also the seed of the
  model-drivable instrument: outside agents can pose the sim at any exact moment.

## Not yet verified / open
- Foot-ground slip vs floor scroll not exactly matched (treadmill approximation). Not noticeable yet.
- 40 fps in the studio at 176² — fine for now, floor pass is the cost. WebGPU port is the real answer, not micro-optimisation.
- Toe pitch during swing is a guess (0.5·sin(πu)); revisit with reference data.

### Resolution vs zoom — they are not the same slider (2026-08-25)
`ppm` is buffer-pixels per metre, so a resolution slider that only resizes the
buffer changes **framing**, not density: the figure stays the same pixel count
and simply occupies less of a larger frame, which reads as zooming out. Jody
spotted this immediately.
- Fix: **ppm is derived, never set directly** — `ppm = zoomPpm × (res / REF)`.
  Framing then depends only on zoom (`REF / zoomPpm` metres visible), and
  resolution moves nothing but the pixel count. Forge REF 176, rig arena 240.
- Measured across a 4× range (96→400): on-screen figure height held at
  483–489 px (the 1% is buffer-grid quantisation of the bounding box) while
  colour runs across the mid-line went 18 → 22 → 31 → 34. That is the check
  worth repeating — same size, more pixels.
- CLASH's arena is deliberately different: native 512×352 is fixed by the
  design doc and its `scale` select is an integer upscale of the whole board,
  which is a true zoom and correct as-is.

### THE VOID — attract mode (2026-08-25)
A full-bleed viewport where nobody is playing: creatures off the bestiary
shelf wander a pool of light, notice each other, and brawl, filmed by a
camera that tries to keep up. `/void.html`, `src/void/`.
- Agent AI is a small state machine — wander / think / approach / fight /
  flee / down — with `nerve` per agent deciding whether being noticed means
  charging or bolting. Continuous space, no grid: this is not the CLASH sim
  and does not need determinism.
- **The camera FRAMES the cast**: `focusOf()` returns the centroid, a tension
  score and the radius the shot needs; ppm is then `res / metresNeeded`,
  clamped, so a lone creature fills the frame and a brawl pulls in. Because
  ppm derives from the buffer width, resolution still only changes density.
- **Never draw a ground shadow as a capsule.** A zero-length capsule is a
  SPHERE here, so it reads as a black bowling ball at the feet — and worse,
  its dark ink bleeds into the figure through the colour blend and greys the
  whole creature out. Shadows need floor-pass support, not a bone.
- Floor falloff is now controllable: `floorRadius`, `floorPower` (1 linear,
  higher tightens the pool — 2.4 reads best), `floorLift`. Both renderers.
- Chrome hides with `c` for a clean grab; `p` saves a PNG straight off the
  display canvas; the control drawer lives off-canvas on `h`.
- The browser pane reports `document.hidden` even when fronted, so rAF never
  runs there. `window.voidScene.run(seconds)` drives and renders it by hand —
  that is the only way to verify this page from tooling.

### THE VOID, take two — built for screen recording (2026-08-25)
Jody's notes: drawer always open, camera centred on what is actually visible,
no typography anywhere, colour control over the dark, higher resolution.
- **The stage is a flex column beside the drawer, not underneath it.** The
  canvas fills `#stage` only, so "centred" means centred in what you can see.
  A `ResizeObserver` on the stage re-fits the buffer whenever the drawer
  opens or the window moves.
- **Do not transition `width` on the drawer.** A hidden tab pauses CSS
  transitions, so the panel froze mid-animation at 1px and the stage measured
  wrong. It snaps now — and snapping is better for recording anyway. Same
  root cause as the dead rAF loop and the silent ResizeObserver: in a hidden
  tab there are no rendering opportunities, so rAF, transitions AND observers
  all stop. `voidScene.run()` / `.refit()` exist to drive it from tooling.
- **Falloff circularity**: a circle on the ground is an ellipse once the
  camera tilts — that is the "sideways" pool. `floorSquash` scales the depth
  axis by `sin(pitch)` so it reads as a true circle on screen; the slider
  blends 0 (honest ground circle) → 1 (screen circle).
- Colours are now inputs, not constants: `voidColor`, `floorColorA/B` in both
  renderers, lerped by the falloff. Defaults reproduce the old palette; the
  void page ships true black. `document.body` matches so it is seamless.
- Framing fits BOTH axes — ground spread against buffer width, and the same
  spread times `sin(pitch)` plus creature height against buffer height —
  otherwise portrait and ultrawide windows frame badly.
- `c` toggles the drawer, `p` captures a PNG. Resolution runs to 1600.

### The void's camera operator (2026-08-25)
Replaced "average everyone and zoom to fit" with a director in
`src/void/director.ts`, split into two jobs that must stay apart: DECIDE the
shot, then MOVE to it.
- **Shot selection** scores candidates each frame — kill 130, brawl 110,
  duel 100 + drama (rises as the pair's HP falls), stalk 70, solo 30+size —
  but only cuts when the subject is gone, the score beats the current by 25,
  or the shot is 11 s stale. `MIN_HOLD` 2.2 s stops it twitching between
  subjects. Measured over 20 s: duel 22 samples, brawl 10, stalk 4, solo 4.
- **Movement is a critically damped spring** (Unity-style `smoothDamp` with a
  velocity term), not an exponential lerp: it eases in *and* out, never
  overshoots, and handles a target jump gracefully. Angles use the same
  spring on the wrapped delta. After a cut, `settle` runs the spring at 45%
  of its usual time for 0.7 s so the move is decisive rather than drifty.
- **Anticipation**: for a single subject the look-at is pushed ahead by
  `speed × move × lead` seconds, so the camera leads instead of trailing.
- **Angle is chosen to read the action**: a pair sets yaw to
  `atan2(dz, dx)` so both are across the screen; a lone creature gets
  `heading + 0.75 − π/2`, a three-quarter FRONT view rather than its back.
  `sway` then drifts either side of that ideal instead of orbiting blindly.
- Framing: duels and kills get an extra 0.82 tightness multiplier. Closeness
  0.72 with the new margins reaches 73–164 px/m where the old camera sat
  near 46 — it actually comes close now.
- Hits punch the shake 0.45, deaths 1.0.

### Genome v3 — a vocabulary wide enough to be worth conjuring (2026-08-25)
Jody: "if everything gives you approximately the same beast, there's no point
conjuring." The diagnosis was NOT the model — **the schema had no words for a
hippo.** v2 could say: one spine (a single number), one hardcoded head on a
hardcoded neck, limbs at exactly two girdles, everything mirrored, four inks.
A 70B model would have produced the same sameness.
- **The body is now a curve**: `body[]` segment lengths rear→front with
  `girth[]` radii along it, and every chain attaches at `at` ∈ 0..1 ALONG that
  curve. One abstraction yields snakes (long body, no legs), hippos (short fat
  body, stumpy legs), spiders (four leg chains at 0.6-1.0), hydras (two head
  chains) and horns/fins. `girth` is where bulk lives — it does more for
  silhouette than any other field.
- New roles `head | horn | fin`; `mirror` per chain (asymmetry — one huge arm);
  `ink` index per chain; `locomotion: walk|slither|fly|hop`.
- **The gait rule generalises**: few legs offset by `at * 0.25` (the old
  lateral-sequence walk, preserved); three or more leg chains offset by index
  so a wave runs down the body instead of all legs marching together.
- **Exemplar retrieval beats prompt prose.** `pickExemplars()` scores the ten
  presets against the words and shows the model the two nearest PLUS a
  deliberate contrast (a legless serpent, or a hound if it already has one).
  Asking for a hippo now shows it a hippo. This mattered more than model size.
- `format` now takes the full JSON **schema**, not `'json'` — shape is
  constrained at the token level, so structural repair barely fires.
- Repairs that must stay code, because a 3B still gets them wrong: `at` has a
  meaning (heads clamped ≥0.78, tails ≤0.22, wings 0.55-0.95 — a head at 0 is
  a misread axis, not a new creature); stacked heads get pushed apart into a
  leaning pair; a legless creature becomes `slither` rather than having legs
  forced onto it (the old bug); slither enforces `bodyWave ≥ 0.6` or it renders
  as a stick.
- Wing elevation must stay lateral (`0.2 + flap*0.55`). Reaching vertical
  projects to a spike, not a wing.
- Verified: "a hippo" → quadruped, "a giant serpent" → legless slitherer,
  "a scuttling crab beast" → three leg pairs, "a two-headed ogre" → two heads.
  Four unmistakably different silhouettes from four prompts.
- `farm/migrate_check.ts` loads and poses every saved creature (v1/v2/v3) and
  runs in `npm test` — 20/20 clean.

### Weapons, attack styles, ranged, and secondary motion (2026-08-25)
- **The intent layer now claims ANY chain, not just an arm.** `StrikeSpec.limb`
  = `arm | head | tail`. That one generalisation gave beasts their bite (an
  open item since the first arena) and tails their lash, without a special
  case anywhere. A bite rears the head, snaps it forward and down, and
  stretches the neck segments by up to 35% — it reads instantly.
- **The three bezier posts ARE the attack style**, so shape stays data: a
  thrust is posts running straight out, a slam falls from overhead. Seven
  named styles ship (swipe, slam, thrust, bite, lash, cast, shoot) and the
  forge has a style picker. Resist adding a `motion` enum — the posts already
  say it.
- `styleFor(weapon, hasArms, hasTail)` picks defaults from what a creature IS:
  no arms → bite (and lash if it has a tail); bow → shoot; staff/wand → cast;
  spear → thrust; hammer/axe → slam. New characters get the right attack
  without anyone choosing one.
- **Ranged**: `StrikeSpec.ranged` releases a `Shot` at the strike moment
  instead of testing contact. Shots carry their own speed/range/size/trail and
  stop caring about their owner. Archers kite: `preferredRange()` is
  `range * 0.55` (capped 5.5 m) versus 1.5 m for melee, and they back off when
  something closes inside 55% of it.
  **Balance note: a kiter currently beats a melee creature untouched** — 4
  shots, 4 hits, 0 bites taken. Fine for a showcase, needs a cost before it is
  a game.
- **Secondary motion** costs almost nothing and does the most for "alive":
  the caller passes `turn` (rad/s) and `lookYaw`, so the body banks into
  turns, the tail swings wide behind it, and heads track their target up to
  0.9 rad. The solver stays pure — the *caller* owns the state, as with the
  smoothed heading.
- `lunge` on a strike drives the whole body curve forward through the blow and
  recovers after: 0.3 m on a bite, 0.22 on a thrust.
- Check with `farm/attack_test.ts` (all styles, windup vs strike),
  `farm/bite_test.ts` (frame-by-frame) and `farm/ranged_test.ts` (in the suite).

### The pit — server, wire format, event stream (2026-08-25)
`npm run pit` runs the void on a server; `/void.html?live` watches it.
Verified: two independent clients, identical creature ids, ~10Hz, **535 bytes
per snapshot ≈ 5 KB/s per watcher**.
- **Nobody drives a character, so none of the hard netcode applies** — no
  prediction, no rollback, no rewind. It is state replication, and the state
  is tiny.
- **Three separate rates, on purpose**: sim 30Hz, positions 12Hz, events the
  instant they happen. Events are sparse and carry the story, so they must not
  wait for a position tick.
- **Genomes travel once, by id.** The catalogue goes out in `hello`; snapshots
  carry an index. The expensive data is the only part that never changes.
- **The client interpolates positions but advances gait phase LOCALLY** from
  each creature's own cadence, and starts strikes from EVENTS rather than
  snapshots. So animation stays smooth however sparse the wire is — and it is
  why the event stream had to be rich from the first commit.
- `LiveVoid` deliberately quacks like `VoidSim`, so the director, the pose
  solver and every look control work unchanged. Same seam the farm uses.
- **Two bugs worth remembering.** (1) `{ t: 'hello', ...snapshot() }` — the
  spread carries its own `t` and silently relabelled the message as a
  snapshot, so the roster never arrived and every creature was undefined.
  Spread first, label after. (2) Clearing `sim.events` at the START of the
  client update destroyed events that arrived between frames, unread — the
  caller drains them after reading instead.

## hatching: what 50 hostile summons taught (2026-08-26)

50 prompts — plain, power-user, absurd, meme, confused, and hostile (empty
string, prompt injection, XSS, SQL, emoji, 70 letter As) — through the hatcher,
three runs, every creature rendered with its prompt burned in. Kept in
`farm/out/stress/`. `npm run stress <label>` adds a run; nothing overwrites.

- **50/50 survive, in every run.** No crash, no NaN joint, no infinite height.
  No injection, XSS or SQL string escaped the validator — they hatch as
  creatures, which is the correct answer to a prompt. Structural safety is real.
- **Survival was measuring the wrong thing.** In the baseline nine prompts
  hatched as a floating head on a sausage. Legal genome, no creature.
- **A fast hatch is a bad hatch.** Every degenerate one came back in 1.2–1.7s
  against 2.5–5s for a real one. The model wasn't failing, it was bailing —
  minimal JSON, almost no chains. Time is a usable quality signal.
- **The validator read silence as "snake".** Legless → slither was the rule, so
  every shrug became a worm. Leglessness now has to be earned by the words
  (`SERPENTINE`); flying has to be earned by wings; a head with fewer than two
  limbs gets arms or a tail. The model's own `locomotion: "slither"` is NOT
  evidence — it reaches for it whenever the prompt gives it nothing.
- **The exemplars were the actual cause.** `pickExemplars` always appended the
  serpent as contrast. On a prompt that matched no keywords it was the only
  shape in the pack with any character, so the model copied it. No signal, no
  serpent.
- **Injected legs scale off girth, not span.** `max(girth) * 3.6`, clamped
  0.14–0.55. Scaling off body length put long creatures on stilts.
- **Open: bodies come back as planks.** Long span, wide girth, running off
  frame. Needs a span-to-girth discipline. Run-to-run variance on the same
  prompt is still large — the floors stop disasters, they don't buy consistency.

## the prompt never leaves the summoner (2026-08-26)

The words that summoned a creature are not part of it. `genome.name` used to be
`'hatched-' + slug(desc)`, which put the prompt on the genome, over the wire to
every watcher, into the kill feed, and into a filename on disk — sixteen of them
were sitting in `genomes/`. Three reasons that's wrong: it turns summoning into
a message board someone has to moderate, it hands every player the trick, and it
is nobody else's business.

Creatures are now named by their own body — `src/naming.ts` hashes the
skeleton's numbers to pick syllables and reads an epithet off the body plan
("Kastoum the Many-Legged"). Text never touches it, so there is nothing to leak
rather than a rule about not leaking it. Identical bodies share a name, which is
correct: they are the same beast.

Prompts survive in `farm/out/roster/*/\_report.md` only — the local farm, so the
hatcher can still be judged. Nothing else keeps them.

## roster run 001 — 50 real fantasy summons

50/50 stood. Quadrupeds are the strength: the dire wolf, griffin, minotaur,
sabre-tooth and rhinoceros read as animals without help. Armed bipeds work when
the body stays compact.

The dominant defect is now body ASPECT, and it goes both ways: planks (the siege
engineer is a slab on legs, so are the basilisk, hydra and crab-beast) and pins
(the golem knight and the desert nomad are vertical lines). Nothing in the
schema says a torso has a sane span-to-girth ratio, so the model spends its
budget at either extreme. That is the next floor.

## secondary motion: what makes it look alive (2026-08-26)

The rig posed every creature exactly on target, on the frame it was asked to,
which is precisely why it read as a puppet. `src/secondary.ts` is the lag —
under-damped springs fed by what the creature is doing and what is done to it.

- **Under-damped on purpose.** Critical damping is correct and looks dead.
  Damping ratios land between 0.12 (flesh) and 0.42 (head).
- **Mass sets the softness**: `soft = 1/(0.55 + mass*0.45)` scales every
  stiffness, so a troll wobbles longer than an imp. That single term is most of
  what tells you how heavy a thing is.
- **Five springs**: lean (banks past the turn), twist (torso dragged after the
  feet), bob (weight landing), jiggle (never has a target, only settles), head
  (arrives last and overshoots). Plus spin, which nothing drives but a blow.
- **The wobble travels** rather than moving the whole body at once:
  `jigAt(u) = jiggle * sin(u*3.1 + 0.6) * 0.5` along the body curve.
- **Sub-step the spring** above 1/45 s or a slow frame blows it up.

## import cycles typecheck and then fail in the browser

`smith.ts` imported OLLAMA_URL from `hatch.ts`, and hatch then needed the
smith. `tsc --noEmit` is clean, node is clean, the farm is clean — and the
browser throws `temperOf is not defined` at the first spawn, because a cycle
leaves part of the graph uninitialised. Constants shared by two modules go in
their own module (`src/ollama.ts`). Cheap rule: if two files import each other,
one of them is really three.

## foot-skate: legs cycle on distance, never on a clock (2026-08-26)

`phase += cadence * move * dt` looks right and is the reason everything slid.
A creature backing off, circling in a fight, chasing at 1.25x or fleeing at
1.4x all cycled its legs at the same rate as one strolling, so the feet ran at
a different speed from the floor.

Stride is metres per cycle, so a cycle is one stride travelled:

    fwd  = dx*cos(heading) + dz*sin(heading)
    lat  = -dx*sin(heading) + dz*cos(heading)
    phase += (fwd + |lat|*0.5) / max(0.08, stride)

Signed, so backing up runs the cycle backwards; the lateral term keeps the feet
lifting when a creature sidesteps. Measured after: 0.950 m travelled per leg
cycle against a genome stride of 0.950, p10–p90 0.944–0.950.

## the camera that made people ill

Three separate faults, only one of which was smoothing:

1. **Yaw wound up.** The director leaves `cam.yaw` unwrapped; it had reached
   17.49 rad. Handing back to a follow camera targeting 0.5 and interpolating
   LINEARLY spins the view two and a half times. Angles always take the short
   way round — `smoothDampAngle` on a wrapped current.
2. **Following the subject exactly.** A creature in a fight circles, jockeys
   and backs off constantly. The camera now follows an ANCHOR that only moves
   when the creature leaves a 0.9 m deadzone, damped over 0.75 s, and takes its
   height from the creature's SIZE rather than its bob — tracking the bounce is
   bolting the camera to a spring.
3. **Cutting on hand-off.** Fine between the director's own shots, sickening
   when it takes the camera off something you were watching. The director's
   frame now goes through the same damping. A dead summon also keeps the
   camera rather than releasing it mid-fight.

Measured while following: peak yaw rate **0 rad/s**, peak camera speed 2.3 m/s
against a creature moving at 1.71. Director-only: peak accel 18.5 m/s² where it
had been 26,000.

Cold start snaps to the first frame instead of damping up from nothing —
otherwise the first second is a black screen.

## why nothing in the pit was worth watching (2026-08-26)

Everything died and nothing carried forward, so a kill earned nothing and a
death cost nothing. Three changes, measured at default peace 0.35, cast 4:

- **Spoils.** The victor takes a chain off the loser — horn, arm, tail, wing,
  fin, or a spare head — grafted onto ITS OWN copy of the genome, worn smaller,
  unmirrored, angled, riding high on the back, in the dead thing's accent
  colour so it never matches. Take an arm that was holding something and you
  get the weapon too. Max 4. A veteran is visibly a chimera of what it killed,
  and its career is readable off its silhouette with no numbers on screen.
- **Glory.** `score += min(0.9, kills*0.3)` in pickTarget. Whatever has been
  killing is the thing worth killing, which is the only reason the pit does not
  crown its first winner.
- **Recovery.** Nothing healed, ever — every creature was on a one-way trip
  from spawn to death. Seven quiet seconds buys a hit point, then 3.5s for each
  after. And not every blow wounds: `0.22 + speed*0.28` of them are grazes that
  knock a creature about without bleeding it, so a nimble thing can survive a
  fight it would otherwise have lost on arithmetic.

An agent's genome is now DEEP COPIED at spawn. It was shared by reference with
the roster Character, so the first grafted horn would have been inherited by
every hound that ever spawned afterwards.

Result: 86 kills per 10 minutes became 39. Median lifetime 45s, longest 185s.
Champions reach 2-3 kills and wear their trophies.

**Still unsolved, and it is not a tuning problem.** A 45-second life cannot
carry the kind of attachment that makes someone care. "How many days it has
survived" needs a pit that keeps running when the tab is closed — that is the
server, not a constant.

## the pit persists, and the URL is the account (2026-08-26)

No accounts, no logins, no identity service. The pit mints a key, the client
keeps it in `?k=`, and that is the whole of signing up. The server stores
`ownerOf(key) = sha256('pit:' + key)[0..10]` — a hash — so the state file on
disk cannot be used to claim anyone's creatures.

- **The prompt never reaches the server.** The client hatches and sends only
  the genome; the server renames it off its own skeleton, so the words cannot
  come back out through a name either. This falls out of Ollama being local,
  and it is worth keeping even when a hosted pit has to hatch server-side.
- **Everything inbound is clamped** (`server/sanitise.ts`): 14 chains, 8 body
  segments, 8 weapon parts, every number bounded. Three living creatures per
  key, one summon per 20s.
- **The cast grows.** Characters used to be a fixed roster addressed by index.
  Every summon adds one, so a new entry is broadcast the moment it exists and
  before any agent referring to it can arrive.
- **Save beside, then rename** — a crash mid-write must not eat the pit. Saves
  every 5s and on SIGINT/SIGTERM.

Two bugs worth remembering:

- `castId()` broadcasts, and the roster is registered while the module is still
  loading — before `const wss` exists. `ReferenceError: Cannot access 'wss'
  before initialization`. Broadcast through a nullable ref that starts null.
- `send()` dropped anything sent before the socket opened, silently. The first
  thing a client ever sends is its key request, so every client got no key and
  could not summon at all. Queue until open.

Verified end to end: browser hatches "a brass-plated siege beetle with a spike"
→ genome over the wire → server names it Skimaech the Many-Legged → saved to
disk → server killed → reopened with it still standing. Pacts survive the same
trip.

## the feet were never planted (2026-08-26)

Locking gait phase to distance travelled fixed the CADENCE and not the contact.
The foot was still placed as `hip.x + track.x * mv`, and `mv` is the idle↔walk
blend — which sits at **0.45 in the fight state**. So a creature circling an
opponent covered ground at full speed while its feet gave back 45% of it, and
skated the other 55%. Everything in a fight slid.

`footTrack`'s stance retreat is already exactly `stride * stance`, which is
exactly how far the body travels in that time — so the foot holds its place in
the world *if nothing scales it*. The `mv` factor was not just wrong, it was
redundant: phase only advances with distance now, so a stationary creature's
feet are already frozen. It survives only as a settle (`clamp(mv/0.3, 0, 1)`)
so a creature that stops does not leave a leg in mid-air.

Measured, one hound, drift of a foot that is DOWN, per frame, against a body
travelling 28.5 mm/frame:

| | before | after |
|---|---|---|
| walking straight | — | **0.86 mm** median, 3.14 mm p90 |
| turning | — | 4.61 mm median, 40 mm p90 |

**Turning still slides and I could not fix it.** The foot is placed in
body-local space, so rotating the body drags a planted foot round the arc. I
tried counter-rotating it by `turnRate * stanceDuration`: both signs made it
worse (8.5 mm and 17.9 mm median against a 4.6 mm baseline), because a turn
rate sampled this frame is a bad estimate of the rotation over a whole stance.
Doing it properly needs the foot to remember where it was planted — real
per-foot world-space state, held on the agent, not derived in a stateless
solver. Reverted rather than shipped.

Separation now also **feels** like something: heavier bodies give less ground
(`give = other.bulk / (a.bulk + other.bulk)`), and any real shove jolts the
secondary springs. Bodies used to interpenetrate and slide apart with the pose
completely unaware.

## watching a fight, one frame at a time (2026-08-27)

`npm run fight ogre hound` renders a strip of a real fight. Numbers cannot tell
you that a swing is boring. The first strip showed four things at once, none of
which I would have found by reasoning:

1. **They never closed.** Melee held a flat `FIGHT_R = 1.5 m` and circled there
   — outside most creatures' own arms. Two things standing near each other,
   swinging at air. Now `preferredRange = reachOf(a) * 0.72`, so a creature
   fights at the distance its body actually is.
2. **Weapons dragged on the floor.** The grip runs along the forearm, so an arm
   at rest points a greatsword straight down — every armed creature stood there
   using its weapon as a walking stick. The grip is now blended between a
   CARRIED direction `(0.55, 0.72, ∓0.25)` and the forearm, lining up only as
   the swing takes over.
3. **Every swing was the same swing.** One spec per creature per weight, forever.
   `varyStrike()` mirrors the arc, flips it to rise instead of fall, widens it,
   and scales duration ±25%, reach, twist and lunge. The shape was always data,
   so variation is free.
4. **Nothing interrupted anything.** A creature took a blow and carried on
   swinging as though nothing had touched it, which is why exchanges read as
   two things taking turns at a wall. A wound now cancels the swing in
   progress, costs a beat of recovery, and knocks the body back by
   `0.16 / bulk` — the heavier you are, the less you give.
5. **Bites did not read.** A head strike moves a head: 64 cm of neck on an
   animal a metre long. Measured, not guessed. Head and tail strikes now throw
   the whole body — lunge ×1.9, reach ×1.25, duration ×0.82.

The live client rolls its own swing variation from `(event time, agent id)`
rather than putting a spec on the wire: damage was settled on the server, so
the arc is cosmetic and does not need to agree.

## scenery, made of the same stuff (2026-08-27)

`src/props.ts` — rocks, boulders, ferns, fungus, crystal shards, bones, stumps.
Built the way creatures are: points and radii, no meshes, no sprites, so they go
through the same capsule field and blob into themselves and into each other
exactly like a body does. `npm run props` renders the sheet.

- **Grown from a seed**, so the pit's layout is a NUMBER: it costs nothing to
  send and comes back identical after a restart.
- **A plain LCG fed consecutive seeds returns nearly the same first value**, and
  the first value drawn is the colour — which is why three crystals in a row
  came out identical gold. The seed is scrambled (xorshift-multiply) before the
  stream starts. Anything seeded per-instance needs this.
- **Only solid things block**: rocks, boulders and stumps have a radius and push
  creatures out, and a real push jolts the springs and makes a wanderer pick a
  new heading. Ferns and bones are walked through.
- Two shapes needed rework after looking at them: a crystal that leans as far as
  it rises is a gold blob with spikes in it (now mostly vertical, thin base), and
  a stump taller than it is wide is a post — and its roots must clear the trunk's
  own radius or the blend swallows them whole.

## a health bar with no UI in it

Two capsules in the world, laid along the camera's right so they read as a bar
from any angle instead of foreshortening to a dot. Being in the field means it
blobs at its ends like everything else, and nothing breaks when the camera
moves. Yours is always shown; everything else earns its bar by bleeding.

## before deploying: what the wire was still trusting (2026-08-27)

**Temperament came from the client.** `sanitiseGenome` clamped it to 0..1 and
then believed it, so anyone could send `{aggression:1, bravery:1, speed:1}` with
no body to justify any of it. It is derived on the server now, from the only
thing the server can actually see. Verified: a hound claiming all three maxed
gets 0.47 / 0.33 / 0.77 — exactly what its body earns.

**Mass was unbounded.** A creature with everything tripled came in at 0.664
against a default biped's 0.051. `src/budget.ts` scales a summon into a band.

The band is `[0.03, 0.14]`, and the FLOOR matters as much as the cap, because
the model has almost no grip on scale. Measured across real hatches:

| prompt | mass |
|---|---|
| a wolf | 0.141 |
| a giant cave troll | 0.280 |
| **an enormous armoured war-elephant** | **0.015** |
| **a colossal titan of stone, the biggest thing in the world** | **0.021** |
| a tiny imp | 0.006 |

The titan arrived smaller than a housecat. Volume goes with the cube of a linear
scale, so the correction is a cube root: halving an overrun costs only ~20% of
height, and an extravagant summon still arrives looking like what it was asked
to be, just smaller.

Being big is a CHOICE and not a win, because girth costs speed in `temper.ts`.
That is what makes a size band safe to expose.

## deployment shape

- **One service.** The server serves the built client (`server/static.ts`), so
  the socket is same-origin and `wss://` comes free. The client defaults to
  `location.host` and only falls back to `:8787` on the dev ports.
- **Vite builds `index.html` and nothing else** unless every page is listed in
  `rollupOptions.input`. The first build produced a deploy with no `/void.html`
  in it at all.
- **Container filesystems are ephemeral.** `PIT_STATE` must point at a mounted
  volume or the pit forgets everything on every deploy.
- **Claim the summon slot BEFORE the slow part.** Server-side hatching takes
  seconds; setting the cooldown after it returns lets one client have twenty in
  flight at once.
- The hatcher speaks Ollama *or* any OpenAI-compatible endpoint. The
  load-bearing part in both is the JSON schema — Ollama enforces it during
  decoding via `format`, the others via `response_format: json_schema`. Without
  it a small model returns prose with JSON in it.

## the bake-off: does a better model make a better creature? (2026-08-27)

`npm run bakeoff` — same prompt, same schema notes, same server pipeline, two
authors: llama3.2:3b through the hatcher, and genomes written by Opus 5. Both
go through `sanitiseGenome()`, so both are mass-capped and both have their
temperament derived from their body.

**Composition: yes, clearly.** The heron and the dwarf are not close — llama
returned a flat plank on stilts and an orange post, against a wading bird with
a spearing beak and a broad short-legged figure. **The troll went the other
way**: llama's read better than mine, because I over-hunched it (slump 0.42 +
lean 0.34 + headPitch 0.4 folds a creature onto its own face). Authoring is a
skill and I got one of three wrong.

**Power: it was actively backwards, and that was a real design fault.**
The first run scored llama's 2.86 m plank at bravery **1.00** and speed
**1.00**, against the faithful 0.84 m dwarf at 0.25 and 0.23. Temperament read
raw HEIGHT, and mass is capped — so the optimal play was tall and thin, i.e.
ignore the prompt.

Now it reads SHAPE, not size:

    stocky = clamp(fattest / height * 4.2)     leggy = clamp(legLen / height * 1.5)
    bravery    = 0.14 + stocky*0.62 + weapon*0.12 + legChains*0.04
    speed      = 0.16 + leggy*0.6 + (cadence-0.8)*0.35 - stocky*0.35
    aggression = 0.2 + weapon*0.26 + noArms*0.16 + horns*0.11 + extraHeads*0.15 + stocky*0.22

Everyone spends the same mass, so what matters is how it is spent: stocky holds
its ground, leggy runs, armed starts things. The same dwarf now reads bravery
0.75 against the plank's 0.40, and the heron 0.58 speed against its 0.16.

So: a better model buys **fidelity**, and fidelity is now worth having. It
cannot buy stats — those are derived here, from the body, under a mass cap.

## gear, colour, and checking the work (2026-08-27)

**Gear** (`src/gear.ts`, `npm run gear`). Helm, horned helm, crest, hood,
pauldrons, breastplate, rags, cloak, shell — capsules again, so they blend into
the body instead of sitting on it like a decal. Placed in ANCHOR space and
scaled by whatever they hang off, so one helmet spec fits a hound and an ogre.
This is what makes a knight look different from a nomad; palette alone never
did.

Two placement bugs, same root cause: **`fwdAt()` runs along the SPINE, and on an
upright creature the spine points at the sky.** A breastplate placed "forward"
was driven up into its own neck and vanished inside the blend. Gear uses the
creature's FACING (`+x` when upright, the body curve otherwise). And torso gear
has to stand proud of the chest — inside the body's own radius the field
swallows it whole.

**Palette** (`src/palette.ts`). Small models pick a mood and return four shades
of it: an orange creature with orange limbs, an orange head and an orange
accent renders as one undifferentiated lump whatever the shape is doing. The
four colours are pushed apart in HSL, keeping the intended hue — limbs a step
down from the torso, head clearly separated, and the accent thrown ~0.42 across
the wheel. `#c86a2a/#c8722f/#cc7a35/#c96e2c` becomes torso orange, light limbs,
a dark head and a teal accent.

**Checking the work** (`src/audit.ts`). The instinct is to hand the genome back
to the model and ask it to check itself. Wrong tool: these failures are
structural and enumerable — no wings on a winged thing, one head on a
two-headed thing, three legs on a six-legged one — and a 3B model re-reading
its own JSON is less reliable than a list of ifs that is right every time and
costs nothing. The audit finds it and, where the fix is obvious, makes it;
anything left unmet is recorded on `genome.missing` rather than invented.

What a checklist CANNOT judge is whether the thing looks like a hippo. That is
the CLIP judge in `farm/judge.ts`, and it is the only place a second opinion
from a model earns its latency.

## the Dockerfile bug that builds clean and cannot start (2026-08-27)

    ENV NODE_ENV=production
    RUN npm ci

`npm ci` under `NODE_ENV=production` skips devDependencies. The server runs
from TypeScript through **tsx, which is a devDependency** — so the image builds
without a single error and then fails the moment it is asked to run. Must be
`npm ci --include=dev`.

Deploy config lives in `railway.json`: Dockerfile builder, `/health` as the
healthcheck, restart on failure. Verified locally by building the client and
booting the server exactly as the container does — one keeper standing, client
served, health green.

The CLI needs no global install: `npx @railway/cli` works. Only `login` needs a
human, because it opens a browser.

## bring-your-own-model cannot work over https (2026-08-27)

Shipped, described as a feature, and structurally impossible: a page served from
`https://` cannot make a request to `http://localhost:11434`. The browser blocks
it — `net::ERR_BLOCKED_BY_CLIENT` — before Ollama's own CORS rules even come
into it. Local hatching works on a dev server and nowhere else.

So a hosted pit MUST hatch server-side. `HATCH_API_KEY` is not an optimisation,
it is the only way anyone but the developer can summon into a deployed pit.

## `?live` should never have been opt-in

Two people opening the deployed link each got their own private simulation and
neither could see the other — the shared pit was behind a flag left over from
development. The deployed origin now defaults to live; `?solo` opts out; a dev
server keeps the opt-in, because there is no pit behind it unless one is
running.

## self-hosted Ollama on Railway: measured, and it is memory not speed (2026-08-27)

Deployed `ollama/ollama` as a second service with a volume at `/root/.ollama`,
pointed the pit at `http://ollama.railway.internal:11434`, and had the pit pull
its own model on boot (no public port on the model server).

Ollama's own boot log settles it:

    inference compute  id=cpu  library=cpu  total="953.7 MiB"  available="935.0 MiB"

**954 MiB.** `llama3.2:3b` needs ~2 GB and cannot load regardless of patience —
the pull also died early (`POST /api/pull` returned 200 in 6.5s for a 2 GB
model, and `/api/tags` was then empty). The estimate of 40–70s per summon was
never tested, because nothing got that far.

So the ceiling on the trial is RAM, not tokens/sec. Self-hosting needs a paid
plan for memory before speed is even a question. A ~0.5B model would fit in
954 MiB, but 3B is already the weak link in creature quality — going smaller
trades the whole point away.

## creature voices: the room is the work (2026-08-27)

`src/void/voice.ts`. One room, everything sent to it — that is what makes a
harvested grunt and a stolen shriek sound like they happened in the same place.
No audio assets needed for the space itself: a reverb impulse is decaying noise
with a few early reflections stamped into it (11ms, 19ms, 31ms, 47ms — those
say "stone chamber"), and the floor is brown noise, band-passed low, drifting
on a 0.06 Hz LFO so the room is never perfectly still. A silent room reads as
a bug; a quiet moving one reads as a place.

Per creature, from the body it already has: **mass** sets pitch
(`rate = (0.62/mass)^0.55` — gentle at the top so giants are not inaudible),
**girth** sets a peaking filter for throat size, **aggression** sets waveshaper
grit. Per trigger: detune ±6%, a pitch bend across the sound (a death falls, a
call pushes up), a 4–9 Hz wobble on the formant. Distance is mostly WETNESS,
not volume.

### harvesting from Chatterbox — what actually happens

- **Spelled-out roars read as letters.** "GRAAAAAH" sounds like someone saying
  letters. Guttural phonemes work: `ughhhh`, `khhhh`, `nnnnngh`.
- **`[laugh]` and `[cough]` are native tags** — real non-speech, no trickery.
- **Bare fragments make it ramble.** "ugh" with no punctuation gives the model
  no reason to stop, so it runs the sampler to its 1000-step ceiling. "Ugh."
  with a full stop is the whole difference between a grunt and a hang.
- **A runaway kills the server.** Every harvest died the same way: no error, a
  hard shutdown around step 510 as the KV cache grows. One runaway takes the
  whole process down, so a 120-sound batch never finishes.
- **There is no length cap to reach for.** `ChatterboxTTS.generate` exposes
  repetition_penalty, min_p, top_p, exaggeration, cfg_weight, temperature — and
  no max_new_tokens. The ceiling lives inside T3.

So a harvest needs a **supervisor**: generate in a child process, kill it on a
timeout, restart and resume. Not a longer timeout — the process does not
survive to be waited on.
