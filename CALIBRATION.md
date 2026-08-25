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

### Dev environment
- The sim clock is rAF-driven; a hidden browser pane suspends rAF and freezes
  the sim. `window.rig.step(dt)` advances it manually — also the seed of the
  model-drivable instrument: outside agents can pose the sim at any exact moment.

## Not yet verified / open
- Foot-ground slip vs floor scroll not exactly matched (treadmill approximation). Not noticeable yet.
- 40 fps in the studio at 176² — fine for now, floor pass is the cost. WebGPU port is the real answer, not micro-optimisation.
- Toe pitch during swing is a guess (0.5·sin(πu)); revisit with reference data.
