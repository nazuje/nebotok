# Arena battles

The rules of real-time arena battles, as an agent needs them to build and check them. The design in
words is in [design.md](design.md) ("Creatures and battles"), the wire plan in
[protocol.md](protocol.md) ("Arena fights"), and why turns are dropped in
[decisions/0001-real-time-arena.md](decisions/0001-real-time-arena.md).

This is the plan for the milestone "Phase 2: Arena battles" (#141 to #160, see
[phases.md](phases.md)). Built so far: the bodies, walking, dash, collisions, storm, ring-out and
abilities in `packages/core/src/arena/` (#144, #145, "The arena in code" below), and the
computer's mind with its balance sim (#146, "Minds"). Turn battles stay live until the switch-over
(#160). When the code and this page disagree, fix one of them in the same pull request.

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

In code, swap and treat sit in `fightStep` around `arenaStep` rather than inside it, so the island's
step and its goldens stay as they were: a wild fight's tick first takes Leave, then Swap, then
throws a treat (all side 0's), then runs `arenaStep` (steps 1 and 3 to 10 above), then flies the
thrown treat or lets one on the ground be picked up or eaten (steps 6 and 9 for the treat), then
settles the ending.

### The arena in code

`packages/core/src/arena/` (#144, #145, #146), exported from `@nebotok/core`:

- `fixed.ts`: the whole-number maths. `DIRECTION_VECTORS` (index 0 points right, 4 down, 8 left,
  12 up; `d + 8` is the exact opposite of `d`), `isqrt`, `unitOf`, `turn` (by a cosine and sine in
  1/4096), `limitSpeed`, and `div`, which truncates towards zero so every rule is point-symmetric
  and a mirrored fight ends exactly mirrored.
- `rules.ts`: `ArenaContent` (`{ arena, rules, species, moves, weather }`), the `content` every
  arena function takes: the whole `arena.json` (`ArenaRules` in core `content.ts`), the battle
  rules and weather chart that damage reads, the species and the moves. `arenaContentOf` takes it
  from a `BattleContent` loaded with `arena.json`; `loadArenaContent` parses the five raw files, as
  the goldens' frozen copy needs. `arenaDamageContent` is what a hit hands `damageOf`: the battle
  rules with the arena's own `strongPercent` and `weakPercent`.
- `state.ts`: `ArenaState` (`tick`, `rng`, `radius`, `storm`, two `bodies`, `things`, `nextId`,
  `weather`, `outcome`), `Body`, `Thing`, `ArenaInput` (`{ dir, dash, press }`; #147 adds `treat`,
  `swap` and `leave`), `ArenaSetup` (`{ seed, fighters }`, each `ArenaFighter` an `id`, `species`,
  `level`, a `loadout` of three move ids or null, `turtle` and `computer`), `arenaStart` and
  `arenaHash`. Positions are in 1/256 arena units from the island's centre; velocities in 1/256
  arena units **a tick**; every timer on a body (`dashTicks`, `dashCooldown`, `knockedTicks`,
  `cooldowns`, the `status` ticks, a `windup` or `lunge`) counts the ticks left. Side 0 starts left
  of the centre facing right, side 1 mirrored, each 45% of the radius out.
- `storm.ts`: `stormRadius(step)` and the storm's own step.
- `abilities.ts`: `abilityOf(moveId)` (the shape's numbers with the move's own on top), presses,
  wind-ups, `aimOf` and one cast for each shape. `hits.ts`: damage, knock (`knockFor(base, health
  left in permille)`), shields and status effects. `things.ts`: shots, zones, walls and marks.
  `weather.ts`: the island's weather. `working.ts`: the step's own scratch state.
- `step.ts`: `arenaStep`. Before the storm, each body's timers tick down by one, and so does the
  weather. After collide, every body is held to the top speed, and again after the zones.
- `mind.ts`: the computer's mind (`wildInput`, `createBrain`, `wildLoadout`, `mindFight`; see
  "Minds").
- `golden.ts`: `ArenaGoldenFile`, inputs as runs of ticks with the same input, replayed by
  `arenaReplay`.

The whole fight (#147), around the island:

- `fight-state.ts`: `FightSetup`, either a `WildFightSetup` (`{ mode: 'wild', seed, team, wild,
  treats, weather? }`, each team entry its save `place`, real `hp` and `fighter`; `weather` the
  encounter zone's, #150) or a `RoundsFightSetup`
  (`{ mode: 'rounds', seed, picks }`, one to three picks a side). `ArenaFight` is a `WildFight`
  (the `island`, the `team` with each creature's arena `health`, `fought` and `out`, the
  `active` one, `swapCooldown`, the `treats` in the bag, the `treat` out, `treatWait`,
  `outcome`) or a `RoundsFight` (`picks`, `round`, `replay`, `rounds` played, `score`,
  `outcome`). `fightHash` is its fingerprint.
- `fight.ts`: `fightStart(setup, content)` and `fightStep(fight, inputs, content)`, which hand on to
  `wildStart`/`wildStep` (`wild-fight.ts`) or `roundsStart`/`roundsStep` (`rounds.ts`). Their
  `content` is a `FightContent`: the `ArenaContent` and the `items`, from `fightContentOf` or
  `loadFightContent`.
- `treats.ts`: the window (`treatWindowPercent`, `treatWindowOpen`), `bestTreat`, and a thrown
  treat's flight and time on the ground.
- `results.ts`: `arenaWildSetup` builds a wild fight from the save (the standing team in order, as
  `a1`, `a2`... by team place; the wild creature `b1`, the computer's), and after a fight
  `teamAfterFight` (health back), `befriendedFromFight`, `arenaRewards`, `duelRewards` and
  `inventoryAfterFight` (treats used).
- `fight-golden.ts`: `FightGoldenFile`, replayed by `fightReplay`.

`ArenaInput` takes `treat`, `swap` and `leave` as optional, so the island's own inputs and goldens
need none of them. `leave` is sent once the Leave button has been held for its second; the hold
itself is the screen's. The island only reads side 0's; side 1 never treats, swaps or leaves.

An `outcome` is `{ winner, how, tick }` with `how` `knockout`, `ringOut` or `timeUp`; `winner` is
null for a draw, which is also what two creatures down on the same tick give, and an equal share
of health at the time limit.
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
- **Type chart:** softer than in turn battles, so skill decides more: a strong hit does 1.5 times and a
  weak one 0.75 times (`strongPercent` 150, `weakPercent` 75 in `arena.json`; turn battles keep 2
  and 0.5 times from `battle-rules.json`).
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
share of a full hit one hit deals (100 unless the table says otherwise). The shares, the shield's
reflection, the strike's radius and the freeze's arming were tuned by the balance sim (#146, "sim"
below), so no shape deals more than 1.5 times its kind's average. "Prototype" names the kit in
`arena-kits.ts` KITS a number comes from.

| Shape | What it does | Numbers |
| --- | --- | --- |
| bolt | A shot along the aim; hits the first body it touches | Gale: 900 u/s, radius 22, reach 560, knock 420. Rain: 1000 u/s, radius 18, reach 620, knock 300 (prototype) |
| spray | Three small bolts in a 20° fan, each a share of the damage | 950 u/s, radius 16, reach 460, knock 160, 10° between bolts (cosine 4034), 40% each (**plan**, sim) |
| cone | A wedge in front, hits at once | Radius 230, half-angle 0.7 rad (cosine 3133), knock 560, 70% (prototype sun quick; share: sim) |
| snare | A bolt that roots (icicle-poke: 48 ticks) or pulls 120 units towards the caster (vine-tickle) | 900 u/s, radius 20, reach 520, no knock, `rootTicks` 48, `pull` 0; vine-tickle has `rootTicks` 0 and `pull` 120 (**plan**) |
| lunge | The caster drives forward and hits on touch | 1350 u/s for 14 ticks, knock 1150 (prototype gale special) |
| burst | A ring around the caster that knocks outward | Radius 170, knock 900, 60% (**plan**, sim) |
| puddle | Lands at the aim, slows whoever stands in it | Reach 300, radius 115, arms in 18 ticks, slows to 45% for 4 s, 85% (prototype rain special; share: sim) |
| shield | Guards the caster: reflects damage and shots, knocks on touch | 4 s, reflects 60%, knock 500 (prototype sun special; reflection: sim) |
| strike | A mark at the aim that lands later | Reach 300, lands after 30 ticks, radius 120 (sim), knock 600; sky-crackle drops 3 in a line along the aim, 150 apart, 60% each (**plan**) |
| wall | A wide wave that rolls forward | 650 u/s, radius 190, 60 ticks, knock 1250, thickness 50, 45% (prototype gale ultimate; share: sim) |
| freeze | A circle that forms at the aim and roots | Reach 200, radius 190, arms in 20 ticks, roots 96 ticks, 1.6 s, 130% (prototype rain ultimate; arming and share: sim) |
| zone | A circle around the caster that pulses | Radius 210 for 5 s, a pulse every 30 ticks for 30% of a hit (sim); noon-blaze also heals the caster 3% a pulse (`healPercent`, prototype sun ultimate); pollen-burst slows to 60% instead (`slowPercent`) |
| weather | No damage: a push ring and the move's weather on the island | Ring radius 150, knock 500; weather for 900 ticks (`weatherTicks`), 15 s (**plan**) |

Where the aim lands: a thrown puddle or freeze lands at the other creature's distance when the aim
help has it, clamped to 120 to 420 units, else at the shape's reach (prototype `aimOf`).

**Weather on the island:** a `weather` move sets its weather for 900 ticks; every ultimate also sets
its own type's weather for 600 ticks (10 s, `ultimateWeatherTicks`). A new weather ends the old one early. A wild fight
starts under its encounter zone's weather, which lasts the whole fight (`limitTicks`) until a move's weather ends it;
it does not come back after (#150). The weather chart in `content/creatures/weather.json` applies to every hit, as in
turns.

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

### How abilities play out

What the shapes table leaves to the code (#145):

- A press is refused (`refused` with `locked`, `empty`, `busy` or `cooling`) every tick it does not
  cast, so a held button 1 sends one while it cools. A body is busy while it is out, at 0 health,
  rooted, winding up or lunging; then it cannot dash either.
- A wind-up keeps the aim it was pressed with. Against a turtle a computer's creature winds up
  150% and cools down 130%. A shot starts at the caster's edge; a lunge holds its drive for its
  ticks, cannot turn, and the lip stops it like a dash. When it lands it rebounds at 15% of its
  drive.
- The cone hits a body whose centre is inside the wedge or within one body of its edges, and within
  its radius plus a body. A burst, a weather ring and a strike's mark reach a body within their
  radius plus a body; a puddle within its radius plus 0.3 body; a freeze and a zone's pulse within
  their radius plus 0.5 body.
- A puddle hits once, on the first touch, and slows to its `slowPercent` while a body stands in it
  and 12 ticks after (`SLOW_HOLD_TICKS`); so does pollen-burst's zone. A freeze hits and roots once,
  when it forms. A zone pulses every `zonePulseTicks` and heals its caster only while the caster
  stands in it. A wall hits once and sweeps away the other side's shots it rolls over. A weather
  ring deals no damage: its `hit` has damage 0.
- A shield ends when it blocks a hit or a touch: the hit's damage times `reflectPercent` goes back to
  the other creature, which is knocked away with the shield's knock. A shot that touches a shield
  is sent back instead and becomes the shield's side's; the shield stays up. Nothing roots, slows
  or pulls through a shield.
- A rooted body stands still from its next move on, so a knock in the same step still counts.
- So that a mirrored fight ends mirrored whichever side acts first: a step draws one damage roll
  for all its hits; every knock reads health from the start of the step; cones, bursts and weather
  rings land after both sides have acted, and two lunges that meet both end before either hits;
  pulls move both bodies from where they stood; zone heals come after every hit; and of two
  weathers cast in the same step the longer wins, then the first type id in sort order. A creature
  knocked out during a step can still be hit in it; a rung-out one cannot.
- There is no cap on things: the cooldowns keep each side under the protocol's 24.
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
  the wild creature walking over it eats it and heals 10%. After a lost or eaten treat the next one
  waits 120 ticks (2 s). Only one treat is out at a time, and none is thrown while your creature is
  winding up, lunging or rooted. The throw goes the way the stick points that tick.
- **No befriending after a ring-out:** a wild creature knocked off the island floats away. You win
  and get XP, but no new friend.

## Fight modes

**Wild fights:** your lead creature against one wild creature.

- **Swap** (Q) brings in the next standing team creature, cooldown 300 ticks (5 s). A creature that
  is knocked out or rung out is replaced by the next. A new creature enters at the island's
  centre-left with 60 ticks of grace. The fight is lost when none can fight.
- **Grace** (`ENTRY_GRACE_TICKS`, 60 ticks, a body's `graceTicks`): nothing hits, bumps or knocks a
  creature that has just come in, and a shield it touches does not hurt it. It can move and act
  from its first tick. A swap is refused while the creature on the island is winding up, lunging,
  rooted or dashing, or when no other creature can fight.
- **Health back** (`teamAfterFight`): every creature that fought keeps its arena health divided by
  `hpScale`, rounded up, so only a knockout leaves 0.
- **Your creature rung out** is out of this fight, with its health kept as it was.
- **Leave** (held 1 s) ends the fight as `ran`: no XP, as today's run.
- **Outcomes:** `won`, `wonByRingOut`, `befriended`, `lost`, `ran`, `timeUp`. When the wild
  creature and yours go down on the same tick, the wild creature down counts: it is a win.
- **Rewards** (`arenaRewards`): `xpForWin` of the wild creature's level to every creature that
  fought and still stands, as today. `won`, `wonByRingOut`, `befriended` and `timeUp` give it;
  `lost` and `ran` give nothing. A fight that runs out of time still gives the full XP: the
  creatures stood their ground for three minutes, the wild creature simply wanders off, and a
  child who fought that long should not leave with nothing. A level up fills a newly unlocked button and puts a new move on
  an empty button (#148).

**Rounds** (trainer fights and duels): best of 3.

- Each side **picks 3** creatures in order; the default is the first three standing, and a 30 s
  timer picks it. One creature a round, in that order; the island and the storm reset every round.
- A round ends on a knockout, a ring-out or the time limit, where the larger share of health
  left wins. An equal share replays that round once, then it is a draw round. First to 2 round wins.
  Each round and each replay gets its own island seed (`<seed>/<rounds played>`). A side that has no
  creature left for a round loses that round (`forfeit`).
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

`wildInput(state, side, brain, rng, content)` (`src/arena/mind.ts`, #146) presses the buttons for
the computer: a whole-number port of the prototype's `arena-ai.ts`. It also takes `content`, which
every arena function takes, for the skills, ranges and moves. `createBrain(skill, rules)` makes the
`Brain` it keeps between ticks; `rng` is the mind's own seeded RNG, never the fight's, so the
fight's rolls are the same whoever plays it. Its presses are always legal. `mindFight(setup,
[skill, skill], content)` plays a whole fight between two minds, each with its own
`createRng('mind:<side>:<seed>')`.

Its skills live in `arena.json` `minds.skills`, tuned by the balance sim (the prototype's values in
brackets):

| Skill | `thinkTicks` | `dodgePercent` | `aimErrorCosine` | `leadPercent` | `reactTicks` | `eagerPermille` |
| --- | --- | --- | --- | --- | --- | --- |
| `WILD` | 20 (10) | 10 (35) | 3133, 0.70 rad (0.14) | 0 (50) | 36 (14) | 15 (40) |
| `WILD_EASIER` (turtle) | 24 (16) | 5 (15) | 2854, 0.80 rad (0.24) | 0 (20) | 60 (26) | 10 (25) |
| `BOT` (tests, trainers) | 8 | 50 | 4083, 0.08 rad | 60 | 10 | 50 |

Think: how often it picks where to walk. Dodge: the chance of dashing aside from a shot, a lunge or
a wind-up it sees coming. Aim error: the largest miss, as the cosine of its angle in 1/4096 (4096
never misses). Lead: how much of the target's movement it aims ahead with a shot. React: the wait
after an ability, between half and one and a half of it. Eager: the chance in 1000 a tick of
starting a ready special or ultimate when the moment suits it; a quick move in reach goes 35% of ticks. It
waits a second before its first step. `wildMindFor(turtle)` picks `WILD_EASIER` against a player
with the turtle setting on, else `WILD`.

It keeps the favourite range of the shape on its button 1 (`minds.ranges`, arena units: bolt and
snare 380, spray, lunge, puddle and strike 300, wall 330, freeze 200, cone, burst, shield, zone and
weather 150) and circles the other creature; the prototype had one range for each type, 330 for
gale, 420 for rain and 150 for sun. It stays `minds.edgeMargin` (180) units inside the edge, treats
the edge the storm warns of as the edge, and walks out of the other side's puddles, freezes, marks
and zones. A wild creature's loadout (`wildLoadout(species, level, content)`) is, for each unlocked
button, its strongest learned move of that kind: its own type first, then the most power, then the
first learned. A trainer names its creatures' loadouts and a skill.

## Balance targets

`node scripts/arena-sim.mjs` (#146) plays `BOT` (the player's side, default loadout, turtle on
against `WILD_EASIER`) against `WILD` and `WILD_EASIER` (wild loadout, winding up) for every species
pair at levels 5, 10 and 20, prints the table, the type match-ups, a shape round at level 40 and the
damage a cast of each shape, then checks the targets. `--seeds`, `--levels`, `--plus` (the wild
creature's extra levels) and `--arena <file>` (another `arena.json` to try) change the run. The
targets:

- a same-level fight lasts 25 to 70 s, and at least half reach the storm;
- `BOT` beats `WILD` 75 to 90% of the time at equal level with neither type ahead; a type advantage
  moves that by about 15 points;
- no shape deals more than 1.5 times the average of its kind;
- ring-outs end 20 to 45% of fights.

Measured with 3 seeds, with the softer type chart (#178): fights last 50.0 s on average and 97%
reach the storm; `BOT` beats `WILD` 84.3% with neither type ahead (79.3% over all pairs, 73 to 86%
by level) and `WILD_EASIER` 90 to 99%; the most damaging shape deals 1.46 times its kind's average
(cone); ring-outs end 41%. The type swing still misses: a type advantage moves the win rate by about
29 points each way (99% and 40%). With turn battles' chart, where a strong hit does four times a weak
one, it was 43 points (#146: 100% and 14%). With `WILD` four levels up, `BOT` wins 32% of even
match-ups.

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
- the arena's `strongPercent` is above 100 and its `weakPercent` below 100;
- buttons unlock at rising levels from 1, and every species learns a move of each kind by the level
  its button unlocks.

## Events

Each step returns events for the screen's juice and for logs. The state is the truth; events only
animate it.

- Bodies (#144): `stormWarning` (`step`, the `radius` it shrinks to, sent `warnTicks` before the
  shrink starts), `stormShrank` (`step`, `radius`, once the shrink has finished), `bumped`
  (`side` knocked, `knock` in u/s, `x`, `y` where), `dashed` (`side`, `dir`), `teeter` (`side`,
  once when its centre passes the lip) and `ringOut` (`side`).
- Abilities (#145): `refused` (`side`, `button`, `reason`), `windup` (`side`, `button`, `move`,
  `ticks`), `cast` (`side`, `button`, `move`, `shape`), `hit` (`side` hit, `by`, `move`, `damage`,
  `health` left, `effectiveness`, `knock` in u/s, `x`, `y`), `blocked` (`side` whose shield took it,
  `by`), `reflected` (`side` that sent the shot back, the shot's new `thing` id), `status` (`side`,
  `status` `slow`, `root`, `shield` or `pull`, `ticks`), `healed` (`side`, `amount`, `health`),
  `weatherStarted` (`weather`, `ticks`), `weatherEnded` (`weather`) and `fainted` (`side`).
- The fight (#147): `entered` (`side`, `id`, team `place`), `swapped` (`from` and `to` places),
  `treatThrown` (`item`, `liking`), `treatLanded` (`item`, `x`, `y`), `treatPickedUp`,
  `treatEaten` (`item`, `amount` healed, `health`), `treatLost` (`item`), `befriended`
  (`species`, `level`), `roundEnded` (`round`, `winner`, `how`, `replay`) and `fightEnded`
  (`result`).

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
| | `strongPercent`, `weakPercent` | 150, 75 (turn battles: 200, 50) | **owner**, #178 |
| `shapes` | each shape's numbers | see "The 13 shapes" | KITS |
| `minds` | `skills`: `WILD`, `WILD_EASIER`, `BOT`; `edgeMargin`; `ranges` by shape | see "Minds" | `arena-ai.ts` |

The shapes' numbers are in "The 13 shapes". The network and screen numbers are in
[protocol.md](protocol.md) ("Arena fights") and below.

## Screens and controls

- **Stick:** floating, anywhere on the left half, a 60 px pad with a 30% dead zone, 8 directions
  sent. It never wakes the world's walking stick.
- **Buttons** on the right, each at least 64 px with a cooldown ring: 1, 2, 3 (by unlock; a locked
  one shows the lock picture with its level in digits), Dash, and Treat and Swap only while they can
  be used. Leave sits in a top corner, held 1 s (wild fights only).
- **Keys:** WASD or arrows, 1, 2, 3, Space (dash), E (treat), Q (swap).
- **Arena screen** (#151, built): the island fills the screen, drawn by Phaser
  (`apps/game/src/arena/arena-scene.ts`), with HTML over it: a card for each side at the top
  (portrait, level badge, health bar, the turtle on yours when it is on), the stick's half, the
  button cluster and Leave (`arena-controls.ts`, `arena-screen.ts`). Creatures follow the server's
  positions with a short ease, snap when they jump far, squash on a hit, bob as they walk and fall
  off the edge after a ring-out. The result is a card with one picture for the ending (trophy,
  ring-out, heart, puff, leave, clock or cloud) and one line, each creature's XP bar, and Continue,
  which goes back to the world. Swap shows while a team-mate could still come in, as far as the
  fight's events tell (`fight-book.ts`); Treat while you hold a treat, none is out, and the wild
  creature's health is under that treat's window. The world's toasts and the new-move toast stay
  hidden while the arena is up.
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
  `new-move-toast.ts`). The toast follows the turn battle's moves learned and offered, and an arena
  fight's `arena.result` `learned` (#150), which the arena client hands to it after Continue;
  holding a move plays its shape on a mini island with the arena's own painter
  (`arena/arena-preview.ts`, through `shape-preview.ts`'s `ShapePainter` seam).
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
  (`{ dir, dash, press, treat, swap, leave }`; `press` is a button 0 to 2 or null), `ArenaSetup`,
  `ArenaRules`, `ArenaContent`, `arenaStart`, `arenaStep`, `arenaHash`, `ArenaFight` and `fightStep`.
- Minds (#146): `wildInput`, `wildLoadout`, `createBrain`, `wildMindFor`, `mindFight`, the skills
  `WILD`, `WILD_EASIER` and `BOT`.
- Results (#147), the arena twins of the turn helpers that take a `BattleState`: `arenaWildSetup`,
  `teamAfterFight`, `befriendedFromFight`, `arenaRewards` and `duelRewards`. Both versions live
  together until #160.
- Loadouts (#148): `learnedMoves(species, level, content)`, `setLoadout`, `setTurtle`, and the save's
  `SettingsV7 { readToMe, turtle }`.
- Server (#149, #150): `apps/server/src/arena-room.ts`, `seat.fight`, `settleFight`.
- Client (#151, built): `apps/game/src/arena/`: `arena-link.ts` (joins the room, sends input,
  shows the result), `arena-scene.ts` (`ArenaScene`), `arena-controls.ts` (stick, buttons, keys,
  Leave), `arena-screen.ts`, `arena-buttons.ts`, `arena-input.ts` and `fight-book.ts`;
  `abilityIcon(moveId, sizePx)` (#143) beside `pictureIcon` and `weatherIcon`.
- Test hook: `arena` (built in #151: fight id, mode, side, phase, tick, radius, both creatures
  with position and health, buttons with cooldown and lock, Leave, inputs and presses sent, what the
  scene drew, and the result), with `arena.picks`, `arena.round` and `arena.score` for rounds (#155), next to `battle` until
  #160.

## Checks

- Goldens in `packages/core/fixtures/golden/arena/`, on a frozen copy of `moves.json`,
  `species.json`, `arena.json`, `weather.json` and `battle-rules.json`; the turn goldens' copy stays
  frozen. Four for bodies, one for each shape and a weather flip, each shape's ending in a knockout
  or a ring-out, and a wild fight for each archetype (`wild-gale`, `wild-rain`, `wild-sun`): both
  minds' inputs recorded from `mindFight`, which must still play exactly that fight.
- Fight goldens in `packages/core/fixtures/golden/arena/fights/`, on the same frozen copy with
  `items.json` for treats: befriend on the second throw, swap then win, lose three and lose the
  fight, ring the wild one out, a best of 3 won 2-1, and a round replayed after a time-up tie.
- Property tests: same seed and inputs, same hash; no speed above top speed; mirrored fights end
  mirrored; the storm only shrinks and never below its floor; health stays within 0 and max; the
  wild mind never sends an illegal press or walks off the island on its own in 5000 random fights.
  Random wild fights and best of 3s with Treat, Swap and Leave end by their time limits, save
  health only for creatures that fought (at least 1 after a ring-out, 0 only after a knockout),
  give XP only to creatures that fought, and befriend only as the wild species and level.
- 10,000 random steps stay under 0.05 ms a step in Node.
- Browser checks drive a fight by keys and taps from a prepared save against a weak wild creature,
  wait on the test hook's state, never on wall-clock time, and run as verify steps of their own
  (`arena-check-chromium`, `arena-check-webkit`; `scripts/arena-check.mjs`). The check runs the
  server in its own process with `ARENA_BATTLES` on and starts each fight through the world room,
  so every run meets the same wild creature; the bot run's arena bot meets its fight in the grass.
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
