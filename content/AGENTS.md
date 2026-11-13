# content

Game content as JSON data. Every file is checked against its schema in `CONTENT_SCHEMAS`
(`packages/core/src/content-files.ts`); a file without a schema fails `npm run content:validate`. Adding
content follows the `add-content` skill.

- **Both languages, always.** Every text a player reads is `{ "en": "...", "sl": "..." }`.
- **Write for players aged 8 to 16:** short sentences, friendly and clear.
- **Slovenian:** never assume the player's gender. Slovenian past tense and many adjectives show
  gender (`si našel` / `si našla`), so use the present tense or the imperative instead: "Najdeš
  pismo." or "Poišči pismo.", not "Našel si pismo." Address the player with the informal *ti*.
- Use the Slovenian typographic conventions already in `strings.json`: a space before the ellipsis
  (`Povezovanje …`) and lowercase language names (`angleščina`).
- Names are original. Players' and real children's names never appear here.

## Maps

Maps are Tiled JSON files, `content/maps/<id>.tmj`, checked by `readTiledMap` and
`playabilityProblems` in `packages/core/src/map.ts`. People edit them in Tiled; `docs/tiled.md`
is their guide. Keep to these conventions or validation fails:

- **Fixed size, orthogonal, 16 by 16 pixel tiles.** Tile layer format CSV (never Base64 or
  compressed), so diffs stay readable.
- **One embedded tileset per map** (Map > Embed Tilesets), whose image is a PNG next to the map,
  such as `sky-tiles.png`. Its tiles are listed in `art/tilesets/sky-tiles.json`, and
  `npm run tiles` draws the PNG from them for Tiled; it is committed and must stay up to date. Add
  tiles only at the end of that list, because tile ids are positions in it.
- **Layers:** a `ground` tile layer (every tile walkable unless marked), a `decor` tile layer for
  trees, fences and buildings, and an object layer `spawns` with a point named `player`, the
  place where new players appear. More tile layers are allowed.
- **Optional object layers:** `encounters`, rectangles of tall grass each named by a zone id in
  `encounters.json`, and `shrines`, points each named by a shrine id in `shrines.json` on a
  walkable tile. `npcs`, points each named by a character id in `npcs.json` on a walkable tile with
  a reachable neighbour, and `marks`, points that quests' `reach` steps name. `spots` and
  `stations`, points each named by a spot or station id, blocked like characters and used from a
  neighbouring tile; a spot may stand on water or the island's edge. `content:validate` checks
  that the names exist.
- **Collision is a tile property, not a layer:** a tileset tile with the boolean property
  `collides` set to true blocks its square on every layer it is placed on. An empty `ground` square
  is blocked too.
- **Playable:** the `player` spawn is walkable, and every walkable tile can be reached from it on
  foot. Fill a pocket nobody can reach with a bush or tree rather than leaving it.
- `world.json` names the map new players start on (`startMap`) and how fast everyone walks
  (`walkTilesPerSecond`). `avatars.json` lists the looks a profile can pick; each one's courier
  is the sprite `art/couriers/<id>.json`.

## Art

`art/` holds every sprite as JSON, one character per pixel, and `art/png/` the real art that
replaces them. `docs/art.md` is the format and style guide. `content:validate` fails while any
avatar, species, weather type, item, character, story cue, spot, station, skill or map lacks the sprite it needs; `npm run art:sheet` draws
them all onto `.proof/art/sheet.png` to look at.

## Creatures and battles

`creatures/` holds what battles read, all placeholders until the kids' creatures arrive:
`weather.json` (the six weather types, which is strong and weak against which, and what each
does as battlefield weather), `moves.json`, `species.json` and `battle-rules.json` (the numbers
that tune damage, weather length and the turn limit).

A species has a name and a one-line `description` in both languages, a weather `type`, base
`stats`, a `favouriteTreat`, and `placeholder: true` until a real design replaces it. It knows
exactly four `moves`, and its `learnset` lists every move it learns as `{ level, move }` in rising
level order, each move once: the four `moves` first, in order, at level 1, then the rest above
level 1. A creature knows at most four moves; reaching a learnset level teaches that move at once
when there is room, or asks the player which move to forget for it.
`content:validate` also checks that every type, weather and move a file names exists. Battle
golden replays use their own frozen copy in `packages/core/fixtures/golden/battle/content/`, so a
change here never moves their hashes; the property tests battle on these files instead, and
`node scripts/battle-sim.mjs` prints how each species and weather type fares one on one. Keep
every species under about 65% there.

Names are original and fit the creature's weather; search the web for each new name to make sure
no game, brand or character uses it. The Slovenian name is its own playful word, not a
translation.

`creatures/renamed.json` maps each species id that was renamed or removed to the species that
stands in for it now. The server applies it to every save it loads, because old saves keep old
ids. Renaming or removing a species adds a line here, and its old ids stay forever; point every
old id straight at a species in `species.json`, never at another renamed id. A species, move or
item that is gone without a line here is dropped or replaced as a save loads (`sanitizeProgress`,
"Saves" in `docs/protocol.md`), so a removal without a rename costs players that creature.

`creatures/befriending.json` tunes how likely a wild creature is to accept a treat (core
`befriendChance`): tiredness, a favourite or liked treat and level. A species may name a
`favouriteTreat`.

## Treats, encounters, shrines and starters

- `items.json`: everything a player carries, by `kind`: `treat` (a treat's `likedBy` lists the
  species that love it and the weather types whose creatures like it), `quest` (an item for one
  quest, named in its `quest`, kept in full when the team faints), `ingredient` (gathered for
  cooking, see below) and `material`.
- `encounters.json`: encounter zones. Each has the chance per step in its tall grass, the
  battlefield weather (or null) and the creatures, with level ranges and weights.
- `shrines.json`: the shrines maps may place, and `teamFainted`: whether waking heals the team
  and what share of each item is kept (100: nothing is lost).
- `starters.json`: the three starters a new player chooses from (one per weather type), their
  level, and the items every new player gets.

`content:validate` checks that every species, type, weather and item these files name exists.

## Skills, spots, recipes and jobs

Skills are foraging, fishing and cooking (Slice C). Every gather or cook is a tiny game the server
judges (`docs/protocol.md`, "Skills and the job board"). All of it is placeholder content, for the
kids to change.

- `skills.json`: `maxLevel`, `levelCosts` (the XP from each level to the next, `maxLevel - 1`
  entries, each more than the one before), the `skills` (each `uses: "spots"` with a
  `restSeconds`, or `uses: "recipes"`, and the tiny `game` it plays: `dip`, `sparkle` or `marker`)
  and the `games`' timings, one entry per `difficulty` 1 to 3. The schema keeps every game fair:
  a dip window of at least 500 ms, a sparkle shown at least 800 ms, a sweep of at least 900 ms, a
  game at most 6 s. `node scripts/skill-sim.mjs` prints the minutes of steady play to each level;
  keep the top level between 120 and 180 minutes, which a property test checks.
- `spots.json`: where players gather: the `skill`, the `ingredient` `item` it gives (1 a success,
  2 a perfect), the `level` it needs, the `xp` per success, its game's `difficulty`, its picture
  `look` (`art/spots/<look>`) and its `name`. A map's `spots` layer places each one
  (`docs/tiled.md`).
- `recipes.json`: what the cooking skill makes: the treat it `makes`, the `level` and
  `ingredients` it needs, `xp` and `difficulty`. The recipe book is every recipe at or below the
  player's cooking level, plus the next locked one.
- `stations.json`: things players use on the map: a `cookingPot` or a `jobBoard`, with a `look`
  (`art/stations/<look>`) and a `name`. A map's `stations` layer places each one.
- `jobs.json`: the board's `slots` and the job `templates`: `gather` (an item gathered), `cook` (a
  dish cooked) or `deliver` (items handed to one of the characters `to`), a `count` range, what
  the player `needs` (a skill level), a draw `weight` and `rewards`: items, and skill XP `perItem`.
  A job is done the moment its count is reached; its rewards go in at once.
- `items.json` kinds `ingredient` (gathered, never offered in battle) and `treat` with an optional
  `strength` (0 to 30, added to the befriending chance). `inventory.json` stacks ingredients too.
- Quest steps `gather` (an `item`, a perfect counts 2), `cook` (a `treat`) and `finishJobs` (any
  job), and quest `rewards.skills` (skill XP). A `side: true` chapter in `story.json` comes after
  the main chapters, and `nextGoal` offers its quests only when the main story has nothing to do.
- Dialogue conditions `{ "jobReady": true }` (a delivery to this character is on the board and the
  player carries all of it), `{ "jobWaiting": true }` (one is on the board and they do not) and
  `{ "skill": id, "level": n }`, and the effect `{ "deliverJob": true }`, which hands over the
  first ready delivery. A node with it is reached only through an entry or choice whose `if` holds
  `jobReady`, as `take` needs `has`. Put job entries after the quest turn-ins and offers, so
  those come first, and mark every entry before them that only reminds the player of an active
  quest `"reminder": true`: while a delivery to the character is ready, the talk passes over
  reminders and takes it, as the turn-in mark over their head promises.

`content:validate` checks every link: each spot gives an ingredient and each recipe makes a treat
from ingredients, at levels up to `maxLevel`; recipes need a `cookingPot` and jobs a `jobBoard`; a
job's item comes from a spot or recipe its `needs` reach, so every job the board draws is
doable; counts and rewards fit a stack; each `to` character has a `jobReady` dialogue entry,
and every quest reminder before it (an active-quest `if` leading to no effects) is a `reminder`; at
least `slots` templates need only level 1. Once any map places a spot (or station), every one must
stand on exactly one point. Skills golden replays use their own frozen copy in
`packages/core/fixtures/golden/skills/content/`, so editing these files never moves them.
## The story: characters, dialogue, quests and the bag

The Slice B story is a placeholder: every character and quest has `placeholder: true`, and the
real story later replaces it, resetting each player's quests (`docs/protocol.md`, "Saves").

- `npcs.json`: the characters players talk to: `name`, `role`, a `voice` (`pitch` 1 to 5 and
  `pace` 1 to 3) and `placeholder`. Each needs `art/characters/<id>.json` (16 by 16, frames
  `down`, `up` and `right`), `art/portraits/<id>.json` (32 by 32, frame `neutral`) and
  `dialogue/<id>.json`. A map's `npcs` layer places them (`docs/tiled.md`).
- `dialogue/<npc>.json`: what one character says. `entries` are tried in order and the first whose
  `if` holds opens the talk; only the last has no `if`. An entry marked `"reminder": true` leads
  to no effects and is passed over while a delivery is ready (see the job conditions above). Each node has a line `say` in both
  languages, an optional `speaker` (another character or `narrator`), a `mood` (`calm`, `happy`,
  `worried` or `surprised`), and then `next`, up to 3 `choices` (each with its own `if`) or
  neither, which ends the talk. Entering a node does its `effects` all together or not at all:
  `startQuest` (only the quest's giver), `completeStep` (a talk or deliver step of this character),
  `give` and `take` an item, `setFlag`, `cue` (a scene: `effects/<cue>` in art) and
  `{ "offerStarter": true }`, which opens the starter screen for a player with no creature. A node
  that takes an item is only reached through an entry or choice whose `if` checks
  `{ "has": item, "count": n }`. Conditions: `{ quest, is }` (`available`, `active` or `done`),
  `{ quest, at: step }`, `{ has, count }`, `{ lacks }`, `{ flag, set }` and `{ needsStarter }`.
  Every node must be reachable.
- `quests.json`: each quest's `chapter`, `giver`, the quests it `requires`, a `name` and `summary`,
  1 to 10 `steps` (`talk`, `deliver`, `winBattles`, `befriend`, `visitShrine` or `reach`, each with
  a `hint`), `rewards` (items and experience for every team creature) and `effects` when it is done.
  A `reach` step names a point of a map's `marks` layer.
- `story.json`: the `chapters` in order, each listing its quests (each quest in one chapter) and
  an optional closing flag `endsWith`, and every story `flags` id with what it means.
- `inventory.json`: how many of one item fit in the bag, by kind (`stack`), and the order of the bag
  screen's sections. Items are never discarded.

`content:validate` checks every link: each character has a dialogue file, every id a condition or
effect names exists, every quest is started by its giver and every talk or deliver step is
completed, delivered items are given somewhere, no gift is bigger than a stack, every flag is
declared and every closing flag is set, and some node offers the starter. Once any map places a
character, every character must stand on one. Story golden replays use their own frozen copy in
`packages/core/fixtures/golden/story/content/`, so editing this story never moves them.
