# Art

Until the art test, every picture in Nebotok is placeholder pixel art that agents draw as text:
JSON files in `content/art/`, where each character is one pixel. The game turns them into
textures when it loads, so placeholders need no image files. Real art replaces them later one
file at a time, as a PNG, with no code changes.

This page is the style guide and the reference for the format. `npm run content:validate` enforces
everything marked as a rule here.

## Where art lives

Each sprite is one file, `content/art/<kind>/<name>.json`, and its id is `<kind>/<name>`. The
kind fixes its size and the frames the game asks it for:

| Kind | Size | Must have | Needed by |
| --- | --- | --- | --- |
| `tiles` | 16×16 | any frames; the first is the still tile | the tilesets in `content/art/tilesets/` |
| `couriers` | 16×16 | the 9 frames and 3 walk animations below | each avatar in `avatars.json` needs `couriers/<avatar id>`; `couriers/courier` is drawn for an avatar without one |
| `creatures` | 32×32 or 48×48 | frames `front` and `back` | each species in `creatures/species.json` needs `creatures/<species id>` |
| `icons` | 16×16 | any frames; the first is the icon | each species needs `icons/<species id>` too, its small picture for lists, menus and the world |
| `backgrounds` | 64×36 | any frames | each weather type in `creatures/weather.json` needs `backgrounds/<weather id>`, for its battles |
| `items` | 16×16 | any frames | each item in `items.json` needs `items/<item id>` |
| `weather` | 16×16 | any frames; the first is the icon | each weather type needs `weather/<weather id>` too, the icon beside its name on the battle field |
| `spots` | 16×16 | frames `ready` and `resting` | each `look` in `spots.json` needs `spots/<look>` |
| `stations` | 16×16 | any frames; the first is the still picture | each `look` in `stations.json` needs `stations/<look>` |
| `actions` | 16×16 | animation `play` | each skill in `skills.json` needs `actions/<skill id>`, drawn beside a courier doing it |
| `skills` | 16×16 | any frames; the first is the icon | each skill needs `skills/<skill id>` too, its icon in lists and toasts |
| `games` | 32×32 | see below | the tiny games: `games/float` (frames `still` and `dip`) for a skill playing `dip`, `games/sparkle` for `sparkle`, `games/marker` for `marker` |

A new kind is one line in `SPRITE_RULES` (`packages/core/src/art.ts`).

Also in `content/art/`:

- `tilesets/<name>.json`: the tiles of a map tileset in tile id order, such as
  `tilesets/sky-tiles.json` for the island's `sky-tiles.png`. A tile's id is its position in the
  list, so add tiles at the end and never reorder them.
- `png/`: real art, named by the sprites that use it.

## The sprite file

```json
{
  "width": 16,
  "height": 16,
  "palette": { "k": "#1b1b2f", "g": "#5bbf5b" },
  "frames": {
    "still": ["16 rows", "of 16 characters each"],
    "sway": ["..."]
  },
  "animations": {
    "sway": { "frames": ["still", "sway"], "ms": [700, 700] }
  }
}
```

- `palette`: up to 16 colours, each a single character other than `.` mapped to a lowercase
  `#rrggbb`. `.` is always transparent.
- `frames`: named frames, each exactly `height` rows of exactly `width` characters, every one of
  them `.` or a palette key. Frame and animation names are short lowercase words, such as `step-a`.
- `animations` (optional): each plays its `frames` in order, showing each for its `ms`, and loops.
  There is one `ms` per frame, from 16 to 10000.

A **recolour** is another drawn sprite with some palette colours swapped. It holds only the
changes, and every key it changes must be in the base's palette:

```json
{
  "recolour": "couriers/courier",
  "palette": { "y": "#3a7bd5" }
}
```

A **PNG sprite** is real art; see "How real art replaces a placeholder" below.

## How the game draws each kind

- **Tiles.** The map's tileset is drawn from its list in `content/art/tilesets/`, each tile's
  first frame. A tile with animations plays its first one forever, every copy on the map in step
  (tall grass sways this way). Players who ask their device for reduced motion see only the first
  frame. A tile is only a picture: where wild creatures appear is the map's `encounters` layer, and
  where players rest is its `shrines` layer (`docs/tiled.md`), so paint tall grass and shrine tiles
  over those.
- **Couriers.** The frames are `<facing>-<pose>` for the facings `down`, `up` and `right` (left is
  right mirrored) and the poses `stand`, `step-a` and `step-b`; the 14 rows above the feet stay the
  same in every pose. The animations `walk-down`, `walk-up` and `walk-right` play
  `step-a, stand, step-b, stand`. One walk cycle covers two steps, so the game stretches the cycle
  to the world's walking speed and the `ms` only set the frames' proportions. The profile screens
  show `down-stand`. Each avatar's courier is a recolour of `couriers/courier`, whose grey cap shows
  on any avatar without a sprite of its own.
- **Creatures** and **backgrounds** are for the battle screen. A creature shows `front` facing the
  player and `back` as the player's own; a background is drawn behind both. A creature's icon is
  the same creature, simplified to read at 16 by 16. Give each creature a silhouette of its own
  and the colours of its weather, so it reads as that weather even in black and white.
- **Weather icons** sit beside the weather's name on the battle field while that weather lasts:
  one simple shape each (a sun, a cloud with drops), in the weather's colours.
- **Spots and stations** stand on their map tile like a character. A spot shows `ready`, or
  `resting` while it rests for this player (a bare bush, still water). The `actions` animation of
  a skill plays beside the courier of anyone doing it, so courier sprites need no gathering
  frames. The `games` sprites are drawn inside the tiny game's card: the fishing float bobs on
  `still` and drops on `dip`, the sparkle is what foraging players tap, and the marker sweeps
  over cooking's bar. They stay readable for players who ask for reduced motion, who see no
  animation.

## Style

- **The palette family.** Reuse these before adding a colour, so placeholders sit together:
  - outline `#1b1b2f`
  - grass `#5bbf5b`, `#47a44c` (dark), `#7ad66f` (light); leaves `#2f7d3a`, `#3e9a4a`, `#358a42`;
    shadow on grass `#1f5f2c`
  - sky `#8fd3ff`, cloud `#e9f6ff`, water `#3a8fd8`, wave `#9fd4ff`
  - path `#d9b77e`, pebble `#b8945c`; wood `#b8844f` (lit), `#9a6a3f`, `#6b4329` (dark); rock
    `#8a5a3b`
  - stone `#c8c8d4` (lit), `#9a9aa8`, `#6e6e80` (dark); wall `#f3e6c8`; roof `#d0574a`, `#a8443a`
  - skin `#f4c7a1`, hair `#4a3426`; flowers `#ff7eb6`, `#ffd94a`
  - weather: sun `#ffd94a`, rain `#3a8fd8`, frost `#bfe6ff`, storm `#8a7ad0`, bloom `#ff7eb6`, gale
    `#a8e0d0`, each with a lighter and a darker shade (see `content/art/creatures/`)
- **Outlines.** Couriers, creatures and items get a one-pixel `#1b1b2f` outline around their
  silhouette. Tiles have no outline, so they join their neighbours; they edge with their own darkest
  shade instead.
- **Light comes from the top left.** Use the lit shade along the top and left edges, the dark
  shade along the bottom and right, a small white or near-white shine near the top left, and a
  shadow falling to the bottom right.
- **Read at a glance.** At 16×16 a sprite is seen small on a phone: a clear silhouette, few
  colours, no single-pixel details that matter. Creatures should be recognisable from their outline
  alone, and their main colour should say their weather type.
- **Keys you can read.** Pick palette characters that hint at the colour (`k` outline, `g` grass,
  `w` white), and use the same ones across a kind.
- Everything is original: never traced from, or in the style of a named character from, a
  commercial game.

## How to add a sprite

A worked example: a berry, `items/sun-berry`, and a rain-coloured recolour of it. (The treats in
`items.json` are drawn the same way: `items/plain-treat` and one recolour per weather type.)

1. **Write the file**, `content/art/items/sun-berry.json`. Items are 16×16, outlined, lit from the
   top left:

   ```json
   {
     "width": 16,
     "height": 16,
     "palette": {
       "k": "#1b1b2f",
       "f": "#3e9a4a",
       "l": "#fff2a8",
       "b": "#ffd94a",
       "d": "#e8a33a",
       "w": "#ffffff"
     },
     "frames": {
       "still": [
         "................",
         "........kk......",
         ".......kffk.....",
         "......kffk......",
         ".....kkkkkk.....",
         "....klllbbbk....",
         "...klwlbbbbdk...",
         "...kllbbbbbdk...",
         "...klbbbbbbdk...",
         "...kbbbbbbbdk...",
         "...kbbbbbbddk...",
         "....kbbbbddk....",
         ".....kddddk.....",
         "......kkkk......",
         "................",
         "................"
       ]
     }
   }
   ```

2. **A recolour**, `content/art/items/rain-berry.json`, swaps only the berry's shades:

   ```json
   {
     "recolour": "items/sun-berry",
     "palette": { "l": "#9fd4ff", "b": "#3a8fd8", "d": "#2a66a8" }
   }
   ```

3. **Check it:** `npm run content:validate`. It names the file, frame and row of any mistake: a
   row of the wrong width, a character not in the palette, a frame the kind needs, a missing base.
   It also fails while some content needs a sprite that does not exist, so adding an item to
   `items.json` and its sprite go together.
4. **Look at it:** `npm run art:sheet` draws every sprite, scaled up four times with sharp pixels
   and labelled, onto `.proof/art/sheet.png`. Open it and look at your sprite next to the others:
   size, outline, light and colour should match.
5. **For a tile**, also add its id at the end of `content/art/tilesets/sky-tiles.json`, run
   `npm run tiles` to redraw `content/maps/sky-tiles.png`, then in Tiled use Tileset > Refresh, mark
   the tile `collides` if nobody may walk onto it, and place it on the map (`docs/tiled.md`).
6. Run the verify level for the change. A new tile or courier shows in the browser check's world
   screenshots.

## How real art replaces a placeholder

1. Draw the PNG with every frame side by side, left to right, each exactly the sprite's size, so a
   two-frame 16×16 tile is 32×16. Save it as an 8-bit PNG (RGBA, RGB, grey or indexed), not
   interlaced. Transparent pixels stay transparent.
2. Put it in `content/art/png/`, named like the sprite: `content/art/png/tiles/tall-grass.png`.
3. Replace the sprite's JSON with the PNG's frame names, in the order they appear, and keep its
   animations:

   ```json
   {
     "width": 16,
     "height": 16,
     "png": "tiles/tall-grass.png",
     "frames": ["still", "sway"],
     "animations": { "sway": { "frames": ["still", "sway"], "ms": [700, 700] } }
   }
   ```

4. `npm run content:validate` checks the PNG exists, is the right size for its frames, and that
   every PNG in `content/art/png/` is used. For a tile, run `npm run tiles` too, so Tiled shows the
   new art.

A recolour must be based on a drawn sprite, so when its base becomes a PNG, give the recolour a
PNG of its own as well: each avatar's courier gets its own image.
