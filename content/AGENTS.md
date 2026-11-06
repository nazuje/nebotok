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
  a reachable neighbour, and `marks`, points that quests' `reach` steps name. `content:validate`
  checks that the names exist.
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
avatar, species, weather type, item, character, story cue or map lacks the sprite it needs; `npm run art:sheet` draws
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
  quest, named in its `quest`, kept in full when the team faints) and `material`.
- `encounters.json`: encounter zones. Each has the chance per step in its tall grass, the
  battlefield weather (or null) and the creatures, with level ranges and weights.
- `shrines.json`: the shrines maps may place, and `teamFainted`: whether waking heals the team
  and what share of each item is kept (100: nothing is lost).
- `starters.json`: the three starters a new player chooses from (one per weather type), their
  level, and the items every new player gets.

`content:validate` checks that every species, type, weather and item these files name exists.

## The story: characters, dialogue, quests and the bag

The Slice B story is a placeholder: every character and quest has `placeholder: true`, and the
real story later replaces it, resetting each player's quests (`docs/protocol.md`, "Saves").

- `npcs.json`: the characters players talk to: `name`, `role`, a `voice` (`pitch` 1 to 5 and
  `pace` 1 to 3) and `placeholder`. Each needs `art/characters/<id>.json` (16 by 16, frames
  `down`, `up` and `right`), `art/portraits/<id>.json` (32 by 32, frame `neutral`) and
  `dialogue/<id>.json`. A map's `npcs` layer places them (`docs/tiled.md`).
- `dialogue/<npc>.json`: what one character says. `entries` are tried in order and the first whose
  `if` holds opens the talk; only the last has no `if`. Each node has a line `say` in both
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
