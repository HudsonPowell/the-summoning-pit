# Rig — handover

**To:** Cowork
**From:** Jody (creative direction) via Claude (prototypes)
**Status:** exploratory. No game decided. No engine decided. Do not assume this doc knows better than you do about implementation.

---

## What this is

A character motion system where the skeleton is the truth layer and everything visible is a skin painted on top of it. Nothing is keyframed. Motion comes out of drivers — small authored relationships like stride length, cadence, lean, reach — resolved every frame into joint positions.

The prototypes in this folder establish the feel and nothing else. They are 2D, they are HTML, and they are disposable. Read them for what the motion should *do*, not for how to build it.

---

## Why it exists

Three ways to make a character move:

1. **Pure physics.** Springs and muscles, gait emerges. Beautiful, uncontrollable. You cannot ask it to slash.
2. **Procedural drivers with authored intent.** You describe relationships, not poses. Generalises to any body plan for free.
3. **Motion capture.** Perfect fidelity, zero generality. Nothing in a mocap set covers a bat.

This project is (2), with a thin authored layer on top for punctuation moves. That choice is the whole point and is not up for revision. Everything else is.

The test of the approach: tag two chains as legs and the thing should start walking without being told what a walk is. If a six-limbed creature or something with forearms needs special-casing, the architecture has failed.

---

## Appetite

**The vocabulary we eventually need** — walk, run, idle, jump, duck, slash, turn left, turn right, and all of it modifiable by state: *angry*, *tired*, *hurt*, *cautious*. Adverbs, not new animations. Angry-walk should be walk with the drivers pushed, not a second asset.

**The ambition beyond that** — a loop where models propose driver sets, something evaluates whether the result reads as the intended behaviour, and the good ones get kept. Generate, watch, judge, retain. Not required for v1, but the architecture shouldn't foreclose it. Behaviours should be data — nameable, storable, diffable, mutable — never code.

**The scale** — small enough that a creature is a config object you could breed variations of. If a behaviour can't be serialised to a few hundred bytes, it's probably a keyframe animation in disguise.

---

## Open, genuinely

- **2D or 3D.** Currently 2D because it was fastest to prototype. 3D is probably right — it makes turning, facing, and depth real rather than faked, and the driver model doesn't care about dimensionality. Your call. Prototype it if that's the fastest way to know.
- **What game.** Unknown. Design for a motion system that a game could later be built on, not for a specific game's requirements.
- **Local directory, multiple models.** Yes to both. Set up whatever structure supports iteration and lets other models participate.

---

## What matters

**Feel is the deliverable.** Not architecture, not correctness. If it walks convincingly and the code is ugly, that's a pass. If it's beautifully abstracted and reads as floaty, that's a fail.

**Every constant is calibrated, not approximated.** Once a value feels right, it gets written down as verified and never re-derived. Keep a file of these. It's the only thing that accumulates.

**Real data beats invented curves.** Human gait joint angles are published and measured. Where reference data exists for a motion, start from it and let the sliders be deviations from a known-good baseline. Guessing sinusoids cost this prototype two wrong passes at arm swing.

**Layers claim chains, chains don't know about layers.** A locomotion layer owns feet and pelvis. A posture layer owns the spine. An intent layer grabs specific limbs toward targets and blends in and out by weight. None of them should count limbs.

**A tool, not a pipeline.** There should always be a place to watch the thing move while you drag a slider. No play button. It never stops. If the only way to evaluate a change is to rebuild and relaunch, the loop is too slow to find feel.

---

## Prototype notes worth carrying over

Small, hard-won, ignore the ones that don't apply:

- A side-on figure is one profile. Mirroring a limb to the other side must not flip which way its joints fold, or the two elbows bend opposite ways. Reflect position, preserve shape.
- Legs at the same attachment point share one foot track, half a cycle apart, so one passes the other. Give each leg its own track and they meet in the middle and stop.
- The elbow only flexes. It never hyperextends, and it trails the shoulder by roughly a sixth of a cycle. That lag is most of what reads as natural.
- Seed IK from the previous frame's solution — it keeps the bend direction stable without pole vectors.
- The pixel layer is a threshold, not a downscale. Draw at low resolution, hard-cut the alpha. Downscaling gives you mush.
- Figures below roughly twelve cells tall stop reading as limbed.

---

## Do not build

- A keyframe timeline.
- A general-purpose animation editor.
- Anything that requires art assets to evaluate.
- Networking, save systems, menus, or anything that isn't a creature moving.
- A game.

---

## The thing to get to first

One creature, on screen, moving, with a way to change how it moves while it's moving. Everything after that is layering.
