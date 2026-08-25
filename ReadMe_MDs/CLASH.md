# CLASH

**A 2–4 player web game. Bomberman's grammar, a dungeon's dressing, and a betrayal in the middle of every round.**

---

## 1. The one sentence

You and three other people loot a dungeon together for ninety seconds, and then the floor collapses into an arena and you fight each other with exactly the things you just picked up.

## 2. The one rule everything obeys

Every action in this game is the same verb:

> **Place a thing on a tile. It waits. It resolves as a cross along the corridors.**

The cross travels outward from the origin in four directions up to a radius, stops dead at solid wall, and consumes exactly one destructible block before stopping in that direction. That's it. Movement is four-way on a grid. There is no aiming, no shooting, no cursor.

Everything below is a variation on three numbers — **delay**, **radius**, **what "resolves" means** — and nothing may break this grammar. If a proposed feature needs a fifth direction or a mouse, it belongs in a different game.

## 3. Why it isn't just Bomberman

Three departures, in order of importance.

**The bomb is not a bomb.** Each class places a different object, and the fiction changes one rule. A seed grows a wall instead of destroying one. Oil is placed inert and lit later by someone else's flame. A curse is invisible until it fires. Same verb, seven different games sharing one board.

**The round has two halves with opposite incentives.** Co-operate, then betray. You cannot play the first half correctly without making yourself vulnerable in the second.

**Health drains.** Lifted from Gauntlet. Your health bar ticks down continuously during the co-op half, and torches and food replenish it. It means you cannot turtle, cannot stall, and are always spending a resource just by existing.

---

## 4. The seven

One class per colour. In a 4-player match the three unchosen colours belong to the dungeon — its architecture, its treasure, its monsters — so the palette is always fully allocated and the players are always the brightest things on screen.

| Class | Ink | Places | Delay | What resolves | The twist |
|---|---|---|---|---|---|
| **THE WICK** | cyan | Candle | 2.5s | Damage cross, r2 | The baseline. The candle visibly shortens — the timer is an object on the board, not a number. |
| **THE CHALK** | yellow | Rune | 3.0s | Damage cross, r2 | Runes can be **scuffed**: stand still on an enemy rune for 0.6s and it's erased. Defusing is a real, dangerous choice. |
| **THE WARDEN** | green | Seed | 2.0s | Vine cross, r2 | Doesn't destroy — **builds**. The cross becomes temporary wall for 4s, crushing anything in it. Inverts the maze. |
| **THE STILL** | red | Oil flask | — | Inert puddle cross, r2 | Two-part. Oil just sits there, visible and harmless, until any flame touches it. Puddles **chain into adjacent puddles**. Traps laid three moves ahead. |
| **THE HEX** | magenta | Curse | 3.5s | Damage cross, r2 | **Invisible to everyone else** until the instant it fires. Hidden information in a genre that has none. |
| **THE PEAL** | white | Bell | 2.0s | Shove cross, r3 | Non-lethal. Pushes players two tiles along the corridor. You don't kill people, you put them where the killing is. |
| **THE HORN** | blue | Imp | 1.0s + walk | Damage cross, r2 | The bomb **walks**. Waddles 3 tiles in your facing direction, then bursts. Aimed, delayed, mobile — highest skill ceiling. |

**Balancing note for implementation:** ship all seven with identical damage and radius. The differences are entirely in *timing, visibility, and geometry*. Resist the urge to give anyone bigger numbers.

## 5. Pickups

Classic Bomberman powerups, redressed. Dropped by destroyed blocks and chests. **Carried into the PvP half** — this is what makes the co-op half tense.

- **Greater Focus** — +1 radius (stacks to 5)
- **Second Hand** — +1 simultaneous placement (stacks to 5)
- **Boots** — +movement speed (stacks to 3)
- **Gauntlets** — you can kick a placed object; it slides down the corridor until it hits something
- **Word of Command** — remote detonation; your placements no longer auto-fire, you trigger them
- **Ward** — absorbs one hit, then breaks
- **The Key** — opens the stair door. One per floor. Everyone can see who's carrying it.

**Cruelty clause:** blasting a chest destroys what's inside. You have to open them, and opening takes a beat standing still.

---

## 6. The round

### Half one — DELVE (90 seconds)

All players on one floor, co-operating. Monsters generate from crypts and must be blasted. Health drains. Chests, gold and the key are scattered. Friendly fire is **on** for the entire game — this is not a bug, it is the whole point, and it makes the co-op half quietly political.

The half ends when someone reaches the stairs with the key, or the timer expires.

### Half two — COLLAPSE (60 seconds, or last one standing)

The floor becomes an arena. Monsters stop spawning. A ring of wall closes in from the edges every 10 seconds, shrinking the play space. Everyone fights with the loadout they just built.

Winner takes the round. **Best of three floors.**

### Why this works

You spend ninety seconds being generous and sixty seconds regretting it. Every co-operative decision — who takes the chest, who takes the hit, who carries the key — is a competitive decision you haven't admitted to yet.

## 7. Modes, in build order

1. **ARENA** — straight 2–4 player last-one-standing on a symmetric map. No monsters, no co-op, no collapse. **Build this first.** If Arena isn't fun with one class, nothing else will save it.
2. **DELVE** — the co-op half alone, four players, three floors, shared score.
3. **CLASH** — the full two-half loop above. The actual game.

Deferred, deliberately: Dungeon Master asymmetric mode, the simultaneous-turn variant, a persistent tavern hub, meta-progression.

---

## 8. Engine spec

### Space

- Logical grid: **32 × 22 tiles**. Tile = **16 × 16 px**. Native resolution **512 × 352**, integer-scaled ×2 / ×3 only. Never fractional — it destroys the pixel art.
- Tile types: `FLOOR`, `WALL` (permanent), `BLOCK` (destructible), `WATER` (blocks movement, not blasts), `PIT` (blocks movement, blasts pass over).
- Solid blocks sit at every (even, even) coordinate — the classic lattice — with rooms carved out of it. The map is one byte per tile: **704 bytes per level.**

### Movement — get this right or nothing else matters

Entities live in continuous pixel space but only ever move on grid lines. The single most important detail in the entire engine:

> **Corner assist.** When the player pushes a direction they can't currently move in, and they are within ~5px of a corridor's centre line on the perpendicular axis, snap them onto that line and let them go.

Without this the game feels broken and nobody can say why. With it, it feels like Bomberman. Budget real time for tuning this number.

Also: players pass through their *own* freshly-placed object until they step off it, then it becomes solid to them.

### Simulation

- Fixed **60Hz** logic tick, decoupled from render. All timers in ticks, never seconds.
- **Resolution order matters.** Each tick, collect every placeable whose timer hit zero into a queue, then process the queue — and if a resolving cross touches another placeable, set that one's timer to zero and push it onto the same queue. This gives you chain reactions for free, and makes them deterministic.
- Damage is resolved after all crosses are computed, so simultaneous deaths are genuinely simultaneous. Two players killing each other on the same tick is a draw and should be possible.

### Networking

- **Authoritative server, fixed tick, clients send input only.** No client-side prediction in v1.
- Whole game state is tiny — grid + ≤4 players + ~20 placeables + ~20 monsters is **under 2KB**. Send full snapshots at 20Hz. Do not build delta compression until you have measured that you need it.
- Use **2–3 frames of input delay** rather than rollback. On a grid game with no aiming, input delay is nearly invisible and rollback is a month of work you don't need.
- Determinism is worth preserving anyway (no floats in the simulation where an int will do) — it makes replays, spectating and desync detection almost free later.

### Rendering

- Draw order: `floor → props → placeables → effects → monsters → players → UI`.
- Sprites are **flat colour, no shading, no lighting**. Tiles are up to 3 flat layers; figures are 16×24, one tile wide and two tall, two flat colours plus an eye accent.
- Value hierarchy is a rule, not a preference: **walls dark** (recede), **destructible blocks mid** (readable as breakable), **interactive and decorative bright**. The brightest thing on screen should always be a thing you can act on.
- Per-tile decoration is seeded from the tile's own coordinates, so texture varies across the map without any authored data.

### Audio

The fuse is audible and its pitch rises as it burns down. Each class has a distinct timbre, so you learn to hear *who* placed something and *how long you have* without looking. This is a gameplay system, not decoration — blind-corner play depends on it.

### Controls

Four directions and **one button**. A second button appears only if you pick up Gauntlets (kick) or Word of Command (detonate). Local multiplayer on one keyboard is a first-class feature, not an afterthought.

---

## 9. Build order for the engine

1. Grid, one player, movement **with corner assist**. Stop and tune until it feels right.
2. Place candle → fuse → cross resolve → destroy blocks → drop pickup.
3. Second local player, collision, death, round reset.
4. Chain reactions and the resolution queue.
5. Pickups, all seven.
6. Netcode: server tick, input relay, snapshots.
7. Classes two through seven.
8. Monsters and crypt generators.
9. Health drain, torches, food.
10. The collapse.

Ship after step 5 to someone who isn't you. If two people on one keyboard aren't laughing by then, fix that before adding anything.

---

## 10. Art direction, in one paragraph

Flat colour on black. No gradients, no shading, no lighting model — every shape is one solid colour and all detail is drawn as negative space cut into it. Sixteen flat colours total. Tiles are 16×16 and figures are 16×24, so a player is exactly one tile wide and two tall. The look descends from 8-bit machines that could only fill a cell with a single ink, but at twice the resolution, so the fidelity goes into linework rather than light. Characters are two flat colours — a body and a headgear — plus a single accent for the eyes. It should read cleanly at 1× on a laptop and hold up printed on a cassette inlay.
