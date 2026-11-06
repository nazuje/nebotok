# Editing the island in Tiled

The island players walk on is drawn in [Tiled](https://www.mapeditor.org/), a free map editor. This
page is for the people who edit it. The rules the game checks are in `content/AGENTS.md`; this page
explains them in plain steps.

## Open the map

1. Install Tiled 1.10 or newer.
2. Open `content/maps/post-island.tmj`. The tiles come from `content/maps/sky-tiles.png`, which sits
   next to it.

## What the layers are for

- **ground**: grass, path, water, sky and cliff. Every square needs a ground tile; a square left
  empty cannot be walked on.
- **decor**: things on top of the ground, such as trees, bushes, fences and the Sky Post building.
- **spawns**: an object layer with one point called `player`. That is where a new player appears,
  and where anyone whose saved spot is no longer walkable starts again. Keep it on a path or grass.
- **encounters** (optional): an object layer of rectangles marking tall grass. Name each rectangle
  after a zone `id` in `content/encounters.json`; that zone says which wild creatures live there,
  at which levels and how often they jump out. A rectangle covers every square it touches. Where
  two overlap, the one higher in the layer's object list wins. Paint the grass itself on `decor` so
  players can see it.
- **shrines** (optional): an object layer of points. Name each point after a shrine `id` in
  `content/shrines.json`, and put it on a walkable square. A player who steps onto that square or
  one next to it rests there: their team is healed, and that shrine becomes where they wake after
  their whole team faints.
- **npcs** (optional): an object layer of points, one per character. Name each point after a
  character `id` in `content/npcs.json`, and put it on a walkable square with a reachable square
  beside it. The character stands there and blocks the square; players talk from the squares
  directly beside it, never diagonally. Each character stands on one map only, and once any map
  places characters, every character in `npcs.json` must be placed.
- **marks** (optional): an object layer of points that quests send players to, such as a lookout.
  Name each point with a short lowercase id and put it on a walkable square; a quest's `reach`
  step names it, and stepping onto that square or one next to it counts. Players do not see
  marks; paint something on `decor` so they know where to go.

## What blocks walking

Some tiles have a property called `collides` ticked: sky, water, cliff, trees, fences, bushes and the
building's walls and roof. Those squares cannot be walked on, on whatever layer they sit. The door is
walkable. To see or change the property, select a tile in the Tilesets panel and look at Custom
Properties.

## Saving

- Keep **Tile Layer Format** on CSV (Map > Map Properties). Base64 is refused.
- Keep the tileset **embedded** in the map. If Tiled asks to export it as a separate file, say no.
- Then run `npm run content:validate`. It fails if the spawn or a shrine is blocked, if a grass
  rectangle or shrine names a zone or shrine the content files do not have, or if some walkable square
  cannot be reached from the spawn (a pocket closed in by trees, say). The message names the first
  such squares as `x,y`; fill them with a bush or open a way in.

## New tiles

Each tile is a sprite in `content/art/tiles/`, and `content/art/tilesets/sky-tiles.json` lists them
in order; `docs/art.md` explains how to draw one. Add new tiles at the end of that list, run
`npm run tiles` to redraw `sky-tiles.png`, then in Tiled use Tileset > Refresh to see them. Never
reorder the list: the map stores tiles by their position in it. The game draws its tiles from
`content/art/` itself, so it animates tiles such as tall grass that the PNG shows still.
