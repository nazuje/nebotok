# content

Game content as JSON data. Every file is checked against its schema in `CONTENT_SCHEMAS`
(`packages/core/src/content.ts`); a file without a schema fails `npm run content:validate`. Adding
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
  such as `sky-tiles.png`. That PNG is drawn by `scripts/make-tiles.mjs` (`npm run tiles`) and
  committed; add tiles only at the end of its list, because tile ids are positions in it.
- **Layers:** a `ground` tile layer (every tile walkable unless marked), a `decor` tile layer for
  trees, fences and buildings, and an object layer `spawns` with a point named `player`, the
  place where new players appear. More tile layers are allowed.
- **Optional object layers:** `encounters`, rectangles of tall grass each named by a zone id in
  `encounters.json`, and `shrines`, points each named by a shrine id in `shrines.json` on a
  walkable tile. `content:validate` checks that the names exist.
- **Collision is a tile property, not a layer:** a tileset tile with the boolean property
  `collides` set to true blocks its square on every layer it is placed on. An empty `ground` square
  is blocked too.
- **Playable:** the `player` spawn is walkable, and every walkable tile can be reached from it on
  foot. Fill a pocket nobody can reach with a bush or tree rather than leaving it.
- `world.json` names the map new players start on (`startMap`) and how fast everyone walks
  (`walkTilesPerSecond`). `avatars.json` lists the looks a profile can pick, with placeholder
  colours until real art arrives.

## Creatures and battles

`creatures/` holds what battles read, all placeholders until the kids' creatures arrive:
`weather.json` (the six weather types, which is strong and weak against which, and what each
does as battlefield weather), `moves.json`, `species.json` (each knows exactly four moves) and
`battle-rules.json` (the numbers that tune damage, weather length and the turn limit).
`content:validate` also checks that every type, weather and move a file names exists. Battle
golden replays use their own frozen copy in `packages/core/fixtures/golden/battle/content/`, so a
change here never moves their hashes; the property tests battle on these files instead.
Placeholder names stay obviously placeholder, such as "Sun Blob".

`creatures/befriending.json` tunes how likely a wild creature is to accept a treat (core
`befriendChance`): tiredness, a favourite or liked treat and level. A species may name a
`favouriteTreat`.

## Treats, encounters, shrines and starters

- `items.json`: everything a player carries, by `kind`. Only treats so far; `likedBy` lists the
  species that love a treat and the weather types whose creatures like it.
- `encounters.json`: encounter zones. Each has the chance per step in its tall grass, the
  battlefield weather (or null) and the creatures, with level ranges and weights.
- `shrines.json`: the shrines maps may place, and `teamFainted`: whether waking heals the team
  and what share of each item is kept (100: nothing is lost).
- `starters.json`: the three starters a new player chooses from (one per weather type), their
  level, and the items every new player gets.

`content:validate` checks that every species, type, weather and item these files name exists.
