# Arena battles

The rules of real-time arena battles, as an agent needs them to build and check them. The design in
words is in [design.md](design.md) ("Creatures and battles"), the wire plan in
[protocol.md](protocol.md) ("Arena fights"), and why turns are dropped in
[decisions/0001-real-time-arena.md](decisions/0001-real-time-arena.md).

This is the plan for the milestone "Phase 2: Arena battles" (#141 to #160, see
[phases.md](phases.md)). Built so far: the bodies, walking, dash, collisions, storm and ring-out in
`packages/core/src/arena/` (#144, "Bodies in code" below). Turn battles stay live until the
switch-over (#160). When the code and this page disagree, fix one of them in the same pull request.

The look and the numbers come from the prototype, variant 6 (branch `prototype/battle-feel` at
54d1893, `apps/game/src/prototype-battle/arena-*.ts`). A number marked **plan** is the planner's
proposal and not in the prototype. Every number is a starting value: #146's balance sim tunes them,
by changing `content/creatures/arena.json` only.

## Units

- **Arena units** for distance. The island starts with radius 520; a creature's body is a circle of
  radius 46. Speeds on this page are arena units a second.
- **Ticks** for time: one fixed step is one tick, 60 a second. 1 s is 60 ticks.
- **Whole numbers only** in `packages/core/src/arena/`, so the server (V8) and an iPad's Safari
  (JavaScriptCore) get the same island to the unit:
  - positions and velocities in 1/256 arena units;
  - ratios as permille (‰) or percent;
  - a direction is an index 0 to 15 into a table of unit vectors in 1/4096, written as literal
    constants; an angle limit is stored as its cosine in 1/4096 (30° is 3547, 0.7 rad is 3133);
  - lengths by an integer square root (`isqrt`); angle tests by dot and cross products.
  No `Math.sin`, `cos`, `atan2`, `asin`, `hypot`, `sqrt`, `Math.random`, `Date.now` or
  `performance` in that folder; a unit test greps for them (#144). The prototype's floats are the
  behaviour to match, not the code to copy.
- **Randomness** from core's seeded RNG (`rng.ts`), seeded by the server when the fight starts.
- **Directions on the wire:** the stick sends 8 directions (the even indices); all 16 are allowed so
  16-way steering stays an option behind one constant.

## A fight

Two creatures stand on a round floating island seen from above. Each walks, dashes and uses up to
three abilities on cooldowns. A fight ends when one creature is knocked out (health 0) or knocked off
the island (ring-out). From 20 s a storm eats the island's edge. After 180 s (10800 ticks) the
larger share of health left wins.

## The step

`arenaStep(state, inputs, content)` (#144) moves the island one tick and returns the new state and
its events; `fightStep` (#147) wraps it with teams, treats, swaps and rounds. The order, from the
prototype's `stepArena` (`arena-rules.ts`):

1. **storm**: warn, shrink, or start the next step;
2. **swap**: bring in the next creature (wild fights);
3. **steer and act**, side 0 then side 1: steer, cast a finished wind-up, then dash, treat or a
   button press;
4. **move**: walk with friction, or the drive of a dash or lunge; rooted creatures stand still;
5. **collide**: bodies push apart, dash bumps, lunges land;
6. **shots**: bolts, sprays, snares and thrown treats fly and hit;
7. **zones**: puddles, walls, freezes, strikes and zones arm, pulse and end;
8. **edge**: the lip holds walkers back; a body past the edge falls (ring-out);
9. **treat**: a treat on the ground is picked up or eaten;
10. **ending**: knockout, ring-out or the time limit.

A finished fight steps no further. `arenaHash(state)` (core `stableHash`) is the fingerprint for
goldens and for the server's mismatch log.

### Bodies in code

`packages/core/src/arena/` (#144), exported from `@nebotok/core`:

- `fixed.ts`: the whole-number maths. `DIRECTION_VECTORS` (index 0 points right, 4 down, 8 left,
  12 up; `d + 8` is the exact opposite of `d`), `isqrt`, and `div`, which truncates towards zero
  so every rule is point-symmetric and a mirrored fight ends exactly mirrored.
- `rules.ts`: `ArenaContent` (`{ arena, species }`), the `content` every arena function takes.
  `arena` is the whole `arena.json` (`ArenaRules` in core `content.ts`), of which the step reads
  the `island`, `dash` and `storm` groups so far. Abilities (#145) add what they need to it.
- `state.ts`: `ArenaState` (`tick`, `rng`, `radius`, `storm`, two `bodies`, `outcome`), `Body`,
  `ArenaInput` (`{ dir, dash }` for now), `ArenaSetup` (`{ seed, species }`), `arenaStart` and
  `arenaHash`. Positions are in 1/256 arena units from the island's centre; velocities in 1/256
  arena units **a tick**; every timer on a body (`dashTicks`, `dashCooldown`, `knockedTicks`)
  counts the ticks left. Side 0 starts left of the centre facing right, side 1 mirrored, each 45%
  of the radius out.
- `storm.ts`: `stormRadius(step)` and the storm's own step.
- `step.ts`: `arenaStep`. Before the storm, each body's timers tick down by one. After collide,
  every body is held to the top speed. `knockFor(base, health left in permille)` is the knock rule;
  until bodies carry health (#145) every knock is a full-health knock (a bump is 315 u/s) and the
  time limit is a draw.
- `golden.ts`: `ArenaGoldenFile`, inputs as runs of ticks with the same input, replayed by
  `arenaReplay`.

An `outcome` is `{ winner, how, tick }` with `how` `ringOut` or `timeUp` (#145 adds `knockout`);
`winner` is null for a draw, which is also what two ring-outs on the same tick give.

## Walking, dashing and the edge

- **Walk cap:** `330 + 2.2 × the species' base speed` (385 to 517 u/s with today's species).
- **Friction:** speed kept each tick 901‰; **planted brake** 756‰ more when not steering and not
  tumbling.
- Steering is 30% as strong while tumbling and 40% while winding up.
- **Top speed** 1800 u/s, whatever pushes.
- **Dash** (Space): 1100 u/s for 12 ticks in the stick's direction (else the facing), cooldown 180
  ticks (3 s) kept on the body. The owner's sumo game uses 5 s; #146 tries both.
- **Collisions:** overlapping bodies push apart along the line between their centres and share
  70% of their closing speed. A dashing body that runs into the other closing faster than 300 u/s
  bumps it: knock 700 (scaled as below), tumble 22 ticks, no damage. A lunge lands when the bodies
  are within two bodies plus 14 units.
- **The lip:** walking and dashing stop 0.35 body inside the edge, so only a knock carries a
  creature over: a body past the lip that moves outwards loses that motion and goes back onto the
  lip. A tumbling creature is not held. A body more than one body past the edge falls: a
  `ringOut` event, and it is out. The storm can push a standing creature off too.

## Health, damage and knock

- **Health** in the arena is 7 times the creature's real health (`hpScale` 7 × core `maxHpAt`), so
  a fight lasts long enough to move about. Afterwards a creature keeps
  `ceil(arena health ÷ 7)`; a rung-out creature never comes back with 0.
- **Damage:** core `damageOf` (`battle/damage.ts`) with the move's power, both creatures' stats and
  levels, the weather chart, the same-type bonus and a roll of 85 to 100 from the seeded RNG, times
  the shape's share, at least 1. `accuracy` is not used: aiming and dodging replace it.
- **Knock:** `shape knock × (45% + 175% × share of health lost)`: 0.45× at full health, up to
  2.2× nearly out, so a worn-down creature flies further.
- **Tumble:** 22 ticks after a knock: weak steering, and the lip does not hold it.

## The storm

| What | Ticks | Seconds |
| --- | --- | --- |
| First shrink starts | 1200 | 20 |
| Warning before each shrink | 120 | 2 |
| One shrink takes | 30 | 0.5 |
| Then a shrink every | 600 | 10 |

The first 5 shrinks each take 10% of the starting radius (half is gone at 60 s), then 5% each down
to the floor of 25% of the starting radius (at 110 s). The radius never grows during a fight.

## Buttons, kinds and loadouts

Every move has a **kind**, which says which button it sits on, and a **shape**, which says what it
does on the island (#142, the move's `arena` block in `content/creatures/moves.json`).

| Button | Kind | Cooldown | Ready at the start | Unlocks at level |
| --- | --- | --- | --- | --- |
| 1 | quick | 54 to 60 ticks, about 1 s (**plan**; the prototype's are 48 to 60) | at once | 1 |
| 2 | special | 360 ticks, 6 s | after 180 ticks, 3 s | 7 |
| 3 | ultimate | 1200 ticks, 20 s | after 720 ticks, 12 s | 12 |

- A creature keeps **every move it learns**: its learned moves are its species' level-1 moves plus
  every learnset entry at or below its level, in learnset order (`learnedMoves`, #148). They are
  worked out, never stored, so nothing is forgotten in the arena.
- Its **loadout** is one learned move per unlocked button, of that button's kind, or none. The
  default (on migration, on unlocking a button, on learning a move for an empty button) is the
  first learned move of that kind. Six species that learned their first special only at level 9 or
  10 (dawnshell, drizzlesnail, glaciyak, rumblejelly, gustowl, blossomcub) learn it at 7 (#142),
  so every creature has a move for button 2. Calls count as ultimates, so button 3 has a move from
  level 1.
- **Pressing:** one button a tick; holding button 1 repeats it. A press for a locked, cooling or
  empty button does nothing and gives a `refused` event.
- **Aim:** abilities go where the creature faces. While the player is not aiming on purpose, the
  aim help bends a cast towards the other creature if it is within 30° of the facing and 900
  units.
- **Wind-up:** the computer's creatures wind up 36 ticks (0.6 s) before a special or an ultimate,
  shown by a telegraph; players never do.

## The 13 shapes

Numbers are the shape's defaults in `arena.json` `shapes` (their keys are in core
`ARENA_SHAPE_NUMBERS`); a move's `arena` block may override any of its own shape's numbers and its
kind's `cooldownTicks`, in whole numbers. Every shape that deals damage has a `sharePercent`, the
share of a full hit one hit deals (100 unless the table says otherwise). "Prototype" names the kit
in `arena-kits.ts` KITS a number comes from.

| Shape | What it does | Numbers |
| --- | --- | --- |
| bolt | A shot along the aim; hits the first body it touches | Gale: 900 u/s, radius 22, reach 560, knock 420. Rain: 1000 u/s, radius 18, reach 620, knock 300 (prototype) |
| spray | Three small bolts in a 20° fan, a third of the damage each | 950 u/s, radius 16, reach 460, knock 160, 10° between bolts (cosine 4034), 33% each (**plan**) |
| cone | A wedge in front, hits at once | Radius 230, half-angle 0.7 rad (cosine 3133), knock 560 (prototype sun quick) |
| snare | A bolt that roots (icicle-poke: 48 ticks) or pulls 120 units towards the caster (vine-tickle) | 900 u/s, radius 20, reach 520, no knock, `rootTicks` 48, `pull` 0; vine-tickle has `rootTicks` 0 and `pull` 120 (**plan**) |
| lunge | The caster drives forward and hits on touch | 1350 u/s for 14 ticks, knock 1150 (prototype gale special) |
| burst | A ring around the caster that knocks outward | Radius 170, knock 900 (**plan**) |
| puddle | Lands at the aim, slows whoever stands in it | Reach 300, radius 115, arms in 18 ticks, slows to 45% for 4 s (prototype rain special) |
| shield | Guards the caster: reflects damage and shots, knocks on touch | 4 s, reflects 40%, knock 500 (prototype sun special) |
| strike | A mark at the aim that lands later | Reach 300, lands after 30 ticks, radius 90, knock 600; sky-crackle drops 3 in a line along the aim, 150 apart, 60% each (**plan**) |
| wall | A wide wave that rolls forward | 650 u/s, radius 190, 60 ticks, knock 1250, thickness 50 (prototype gale ultimate) |
| freeze | A circle that forms at the aim and roots | Reach 200, radius 190, arms in 30 ticks, roots 96 ticks, 1.6 s (prototype rain ultimate) |
| zone | A circle around the caster that pulses | Radius 210 for 5 s, a pulse every 30 ticks for 20% of a hit; noon-blaze also heals the caster 3% a pulse (`healPercent`, prototype sun ultimate); pollen-burst slows to 60% instead (`slowPercent`) |
| weather | No damage: a push ring and the move's weather on the island | Ring radius 150, knock 500; weather for 900 ticks (`weatherTicks`), 15 s (**plan**) |

Where the aim lands: a thrown puddle or freeze lands at the other creature's distance when the aim
help has it, clamped to 120 to 420 units, else at the shape's reach (prototype `aimOf`).

**Weather on the island:** a `weather` move sets its weather for 900 ticks; every ultimate also sets
its own type's weather for 600 ticks (10 s, `ultimateWeatherTicks`). A new weather ends the old one early. The weather chart
in `content/creatures/weather.json` applies to every hit, as in turns.

### Every move's kind and shape

Taps are always bolts, wallops always lunges, calls always weather (#142).

A move's own numbers, where it differs from its shape: gale-tap, gust-push, heat-shimmer and
snow-puff cool down in 54 ticks (the prototype's gale bolt and sun cone are quicker), other quick
moves in 60; gust-push knocks 700; drip-drop flies as the prototype's rain bolt (1000 u/s, radius
18, reach 620, knock 300); the rest are named in the shapes table.

| Type | Quick (tap, 40) | Quick (50) | Special (65) | Special (wallop, 80) | Ultimate (100) | Ultimate (call) |
| --- | --- | --- | --- | --- | --- | --- |
| sun | sun-tap: bolt | heat-shimmer: cone | sun-ray: shield | sun-wallop: lunge | noon-blaze: zone (heals) | sun-call: weather |
| rain | rain-tap: bolt | drip-drop: bolt (faster, longer) | puddle-jump: puddle | rain-wallop: lunge | downpour: wall (water) | rain-call: weather |
| frost | frost-tap: bolt | snow-puff: cone | icicle-poke: snare (roots) | frost-wallop: lunge | big-freeze: freeze | frost-call: weather |
| gale | gale-tap: bolt | gust-push: bolt (big knock) | twirl: burst | gale-wallop: lunge | sky-sweep: wall (wind) | gale-call: weather |
| storm | storm-tap: bolt | static-zap: spray | cloud-clap: strike | storm-wallop: lunge | sky-crackle: strike ×3 | storm-call: weather |
| bloom | bloom-tap: bolt | petal-toss: spray | vine-tickle: snare (pulls) | bloom-wallop: lunge | pollen-burst: zone (slows) | bloom-call: weather |

## Status effects

- **slow:** walk cap times a percent, for some ticks (puddle, pollen-burst).
- **root:** no walking, dashing or casting, for some ticks (icicle-poke, freeze).
- **pull:** moved a distance towards the caster (vine-tickle).
- **shield:** reflects a percent of damage, sends shots back at their caster, knocks on touch.

## Treats and befriending

Only in wild fights.

- **The window:** the Treat button (E) shows while the wild creature has less than 30% of its health
  left: 35% with a treat its type likes, 40% with its favourite treat, plus a cooked treat's
  `strength` in points, at most 45%.
- **The throw** uses the best treat in the bag for this species: the favourite, then a liked one,
  then the strongest plain one. It is used up when thrown, as today. It flies 800 u/s up to 560
  units, with radius 26 (plain), 33 (liked) or 40 (favourite).
- **A hit befriends.** The creature joins the team, or storage when the team is full.
- **A miss** lies on the ground for 300 ticks (5 s). Your creature walking over it picks it back up;
  the wild creature walking over it eats it and heals 10%. After a lost treat the next one waits 120
  ticks (2 s).
- **No befriending after a ring-out:** a wild creature knocked off the island floats away. You win
  and get XP, but no new friend.

## Fight modes

**Wild fights:** your lead creature against one wild creature.

- **Swap** (Q) brings in the next standing team creature, cooldown 300 ticks (5 s). A creature that
  is knocked out or rung out is replaced by the next. A new creature enters at the island's
  centre-left with 60 ticks of grace. The fight is lost when none can fight.
- **Your creature rung out** is out of this fight, with its health kept as it was.
- **Leave** (held 1 s) ends the fight as `ran`: no XP, as today's run.
- **Outcomes:** `won`, `wonByRingOut`, `befriended`, `lost`, `ran`, `timeUp`.
- **Rewards** (`arenaRewards`): `xpForWin` of the wild creature's level to every creature that
  fought and still stands, as today. A level up fills a newly unlocked button and puts a new move on
  an empty button (#148).

**Rounds** (trainer fights and duels): best of 3.

- Each side **picks 3** creatures in order; the default is the first three standing, and a 30 s
  timer picks it. One creature a round, in that order; the island and the storm reset every round.
- A round ends on a knockout, a ring-out or the time limit, where the larger share of health
  left wins. An equal share replays that round once, then it is a draw round. First to 2 round wins.
- 3 s between rounds with the score as round pips (trophy, puff, empty).
- No Swap, no Treat, no Leave. A duel has a give-up button, held 2 s, which loses the rest.
- **Outcomes:** `won`, `lost` or `draw`, with the list of rounds.
- **Duel rewards** (`duelRewards`): 25% of `xpForWin` to every creature that fought, on both sides,
  win or lose. Duel health is put back as it was before; nothing is lost.
- **Trainer rewards:** from the trainer's entry in `content/trainers.json` (XP share, an item).

**Even match** (duels, on by default): every creature fights at the higher of the two players'
average team levels, for that duel only. Nothing about it is saved. With it off, real levels.

## The turtle setting

A player's own easier setting, saved with the player (save v7, #148), off by default.

- Your creature takes 70% of the damage.
- Against the computer, its creature also walks at 80%, winds up for 150% (54 ticks) and cools down
  at 130%, and the wild mind uses the gentler `WILD_EASIER` skill.
- **In duels** it is allowed; only the 70% damage applies, and both players see a turtle badge on
  that creature.

## Minds

`wildInput(state, side, brain, rng)` (#146) presses the buttons for the computer: a whole-number
port of the prototype's `arena-ai.ts`. Its skills live in `arena.json` `minds`:

| Skill | Think every | Dodge | Aim error | Lead | React | Eager |
| --- | --- | --- | --- | --- | --- | --- |
| `WILD` | 10 ticks | 35% | 0.14 rad | 50% | 14 ticks | 4% a tick |
| `WILD_EASIER` (turtle) | 16 ticks | 15% | 0.24 rad | 20% | 26 ticks | 2.5% a tick |
| `BOT` (tests, trainers) | 8 ticks | 50% | 0.08 rad | 60% | 10 ticks | 5% a tick |

Think: how often it picks where to walk. Dodge: the chance of dashing aside from a shot or a
wind-up. Aim error: the largest miss, stored as a direction offset. Lead: how much of the target's
movement it aims ahead. React: the wait after an ability. Eager: the chance a tick of starting a
ready special or ultimate when the moment is right.

It keeps its shape's favourite range (prototype: 330 for gale's bolt, 420 for rain's, 150 for
sun's cone), stays 180 units off the edge and leaves the storm's warning ring. A wild creature's
loadout (`wildLoadout`) is, for each unlocked button, its strongest learned move of that kind, its
own type first. A trainer names its creatures' loadouts and a skill.

## Balance targets

`node scripts/arena-sim.mjs` (#146) plays `BOT` against `WILD` and `WILD_EASIER` for every species
pair at levels 5, 10 and 20. The targets:

- a same-level fight lasts 25 to 70 s, and at least half reach the storm;
- `BOT` beats `WILD` 75 to 90% of the time at equal level; a type advantage moves that by about 15
  points;
- no shape deals more than 1.5 times the average of its kind;
- ring-outs end 20 to 45% of fights.

Load-time checks (`npm run content:validate`): `ArenaRules` in core `content.ts` checks
`arena.json` on its own, and `arenaLinkProblems` (`arena-links.ts`) checks it against
`moves.json` and `species.json`:

- a dash is faster than every species' walk cap;
- the ring-out line, one body past the edge, lies beyond the island's radius (a body is at least 1
  unit);
- the storm's floor is wider than four body radii, so two creatures fit side by side;
- every reach (a shot, a thrown shape, a strike's farthest mark, a treat's flight) is shorter than
  the island's diameter;
- every quick move cools down quicker than every special one, and every special quicker than every
  ultimate;
- buttons unlock at rising levels from 1, and every species learns a move of each kind by the level
  its button unlocks.

## Events

Each step returns events for the screen's juice and for logs. The state is the truth; events only
animate it.

- Bodies (#144): `stormWarning` (`step`, the `radius` it shrinks to, sent `warnTicks` before the
  shrink starts), `stormShrank` (`step`, `radius`, once the shrink has finished), `bumped`
  (`side` knocked, `knock` in u/s, `x`, `y` where), `dashed` (`side`, `dir`), `teeter` (`side`,
  once when its centre passes the lip) and `ringOut` (`side`).
- Abilities (#145): `cast`, `windup`, `hit` (damage, health left, effectiveness, knock), `blocked`,
  `reflected`, `status`, `weatherStarted`, `weatherEnded`, `fainted`, `refused`.

## Every tunable

`content/creatures/arena.json` (#142) holds these, in whole numbers. Source: `arena-kits.ts` unless
marked.

| Group | Key | Value | Prototype |
| --- | --- | --- | --- |
| `island` | `radius`, `body` | 520, 46 | ARENA |
| `island` | `frictionPermille`, `plantedPermille` | 901, 756 | ARENA `friction` 0.901, `planted` 0.756 |
| `island` | `walkBase`, `walkPerSpeedPercent` | 330, 220 | ARENA `walkBase`, `walkPerSpeed` 2.2 |
| `island` | `topSpeed` | 1800 | ARENA |
| `island` | `hpScale` | 7 | ARENA |
| `island` | `knockBasePercent`, `knockLostPercent` | 45, 175 | ARENA `fullHealthKnock`, `lowHealthKnock` |
| `island` | `knockedTicks`, `bumpKnock` | 22, 700 | ARENA |
| `island` | `limitTicks` | 10800 (180 s) | ARENA `limit` |
| `dash` | `speed`, `ticks`, `cooldownTicks` | 1100, 12, 180 | ARENA `dashSpeed`, `dashTicks`, `dashCooldown` |
| `swap` | `cooldownTicks` | 300 | ARENA `swapCooldown` |
| `storm` | `firstTicks`, `everyTicks`, `warnTicks`, `shrinkTicks` | 1200, 600, 120, 30 | STORM |
| `storm` | `bigSteps`, `bigStepPercent`, `smallStepPercent`, `floorPercent` | 5, 10, 5, 25 | STORM |
| `treat` | `windowPercent`, `speed`, `range`, `radius` | 30, 800, 560, 26 | TREAT |
| `treat` | `groundTicks`, `againTicks` | 300, 120 | TREAT |
| `treat` | `likedRadius`, `favouriteRadius` | 33, 40 | **plan** |
| `treat` | `likedWindowPercent`, `favouriteWindowPercent` | 35, 40 | **plan** |
| `kinds` | `quick`, `special`, `ultimate`: `cooldownTicks` | 60, 360, 1200 (a quick move may say 54) | KITS (quick: **plan**) |
| `kinds` | `openingTicks` | 0, 180, 720 | ARENA `openingCooldown` |
| `kinds` | `windupTicks` (the wild wind-up) | 0, 36, 36 | ARENA `windup` |
| `buttons` | unlock levels of buttons 1 to 3 | `[1, 7, 12]` | **plan**, settled by the owner |
| `easier` | `walkPercent`, `windupPercent`, `cooldownPercent`, `damageTakenPercent` | 80, 150, 130, 70 | EASIER |
| `aimHelp` | `cosine`, `range` | 3547 (30°), 900 | `AIM_ASSIST`, `aimOf` |
| | `zonePulseTicks` | 30 | `ZONE_PULSE` |
| | `wallThickness` | 50 | `WALL_THICKNESS` |
| | `ultimateWeatherTicks` | 600 | **plan** |
| `shapes` | each shape's numbers | see "The 13 shapes" | KITS |
| `minds` | `WILD`, `WILD_EASIER`, `BOT` | see "Minds" | `arena-ai.ts` |

The shapes' numbers are in "The 13 shapes". The network and screen numbers are in
[protocol.md](protocol.md) ("Arena fights") and below.

## Screens and controls

- **Stick:** floating, anywhere on the left half, a 60 px pad with a 30% dead zone, 8 directions
  sent. It never wakes the world's walking stick.
- **Buttons** on the right, each at least 64 px with a cooldown ring: 1, 2, 3 (by unlock; a locked
  one shows the lock picture with its level in digits), Dash, and Treat and Swap only while they can
  be used. Leave sits in a top corner, held 1 s (wild fights only).
- **Keys:** WASD or arrows, 1, 2, 3, Space (dash), E (treat), Q (swap).
- **Pictures** (#143): one for each of the 13 shapes, a corner mark for each kind (quick a small
  tick, special a star, ultimate a sun-burst ring), and dash, treat, swap, leave, lock, turtle,
  challenge, accept, decline, watch, even match, real levels and ring-out. A move's button picture
  is its shape tinted by its type with its kind's mark (`abilityIcon`).
- **Juice** (#153): health bars with a trail, level badges red, green or blue for higher, lower or
  even, damage numbers (yellow with "!" for strong hits), hit-stop 60 to 160 ms (drawing only),
  shake 150 to 350 ms up to 14 px, sparks, falling spin, hearts. Under reduced motion: no shake, no
  hit-stop, no particles, no camera ease; numbers and bars stay. Haptics on hits to you, a ring-out
  and a befriend, where the device allows, never under reduced motion.
- **Loadout picker** (#154, built): three button tiles (at least 64 px), then only the learned moves of
  that kind, so no wrong choice is possible. A move tile shows 1 to 3 power pips (1 for 40 and 50,
  2 for 65 and 80, 3 for 100), not numbers. The new-move toast goes away by itself after 6 s.
  Opened from each team card and from the toast (`apps/game/src/loadout-picker.ts`,
  `new-move-toast.ts`). Until #150 the toast follows the turn battle's moves learned and offered;
  holding a move plays a canvas sketch of its shape (`shape-preview.ts`) until #151's painter takes
  its `ShapePainter` seam.
- **Duels** (#157, #158): ask a courier within 4 tiles; the answer card waits 20 s, then declines
  by itself; the same pair waits 30 s after a decline. Up to 6 watchers. The winner's courier wears
  a small trophy for 60 s.

## Trainers

A trainer (#156) is content: `content/trainers.json` gives each one an id, the character (`npc`),
three creatures (species, level and a loadout of learned moves), a mind skill (`WILD` or `BOT`), a
reward (an XP share and an item) and a rematch rule. A dialogue node's action `fight: <trainerId>`
starts a best of 3, and leads on to its `won` or `lost` node; the quest step `beatTrainer` counts a
win, next to `winBattles`. The one placeholder trainer is Vetrinka, the weather-watcher at the
lookout, with three creatures at levels 6 to 8 in the side chapter, until the kids' trainers
replace her.

## Names in code

Planned names, so the tickets agree:

- Core state and steps (#144, #145, #147): `ArenaState`, `Body`, `ArenaInput`
  (`{ dir, dash, press, treat, swap, leave }`), `ArenaSetup`, `ArenaRules`, `ArenaContent`,
  `arenaStart`, `arenaStep`, `arenaHash`, `ArenaFight` and `fightStep`.
- Minds (#146): `wildInput`, `wildLoadout`, the skills `WILD`, `WILD_EASIER` and `BOT`.
- Results (#147), the arena twins of the turn helpers that take a `BattleState`: `arenaWildSetup`,
  `teamAfterFight`, `befriendedFromFight`, `arenaRewards` and `duelRewards`. Both versions live
  together until #160.
- Loadouts (#148): `learnedMoves(species, level, content)`, `setLoadout`, `setTurtle`, and the save's
  `SettingsV7 { readToMe, turtle }`.
- Server (#149, #150): `apps/server/src/arena-room.ts`, `seat.fight`, `settleFight`.
- Client (#151): `apps/game/src/arena/` (`arena-link.ts`, `arena-scene.ts`, `arena-controls.ts`),
  `abilityIcon(moveId, sizePx)` (#143) beside `pictureIcon` and `weatherIcon`.
- Test hook: `arena` (mode, tick, both bodies, health, buttons with cooldown and lock, outcome),
  with `arena.picks`, `arena.round` and `arena.score` for rounds (#155), next to `battle` until
  #160.

## Checks

- Goldens in `packages/core/fixtures/golden/arena/`, on a frozen copy of `moves.json`,
  `species.json` and `arena.json`; the turn goldens' copy stays frozen.
- Property tests: same seed and inputs, same hash; no speed above top speed; mirrored fights end
  mirrored; the storm only shrinks and never below its floor; health stays within 0 and max; the
  wild mind never sends an illegal press or walks off the island on its own in 5000 random fights.
- 10,000 random steps stay under 0.05 ms a step in Node.
- Browser checks drive a fight by keys and taps from a prepared save against a weak wild creature,
  wait on the test hook's state, never on wall-clock time, and run in parts of their own
  (`chromium-arena`, `webkit-arena`).
## Words

- **arena:** a real-time fight on an island, and the Colyseus room that runs one.
- **island:** the round floating ground a fight happens on. Its radius shrinks in the storm.
- **storm:** the edge of the island eaten away, step by step, from 20 s into a fight.
- **ring-out:** a creature knocked off the island. It is out of that fight; a wild one cannot be
  befriended.
- **knock:** the push a hit or a bump gives, bigger the more health is lost.
- **kind:** which button a move sits on: quick (button 1), special (2) or ultimate (3).
- **shape:** what a move does on the island: one of the 13 above.
- **button:** one of the three ability buttons. Buttons 2 and 3 unlock by level.
- **loadout:** a creature's chosen move for each button.
- **turtle:** a player's easier setting.
- **round:** one creature against one in a best of 3.
- **duel:** a friendly fight between two players, with nothing to lose.
- **watcher:** a player watching a duel live, who sends no input.
