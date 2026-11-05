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
  such as `sky-tiles.png`. Its tiles are listed in `art/tilesets/sky-tiles.json`, and
  `npm run tiles` draws the PNG from them for Tiled; it is committed and must stay up to date. Add
  tiles only at the end of that list, because tile ids are positions in it.
- **Layers:** a `ground` tile layer (every tile walkable unless marked), a `decor` tile layer for
  trees, fences and buildings, and an object layer `spawns` with a point named `player`, the
  place where new players appear. More tile layers are allowed.
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
avatar, species, weather type, item or map lacks the sprite it needs; `npm run art:sheet` draws
them all onto `.proof/art/sheet.png` to look at.

## Creatures and battles

`creatures/` holds what battles read, all placeholders until the kids' creatures arrive:
`weather.json` (the six weather types, which is strong and weak against which, and what each
does as battlefield weather), `moves.json`, `species.json` (each knows exactly four moves) and
`battle-rules.json` (the numbers that tune damage, weather length and the turn limit).
`content:validate` also checks that every type, weather and move a file names exists. Battle
golden replays use their own frozen copy in `packages/core/fixtures/golden/battle/content/`, so a
change here never moves their hashes; the property tests battle on these files instead.
Placeholder names stay obviously placeholder, such as "Sun Blob".
