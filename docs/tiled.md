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

## What blocks walking

Some tiles have a property called `collides` ticked: sky, water, cliff, trees, fences, bushes and the
building's walls and roof. Those squares cannot be walked on, on whatever layer they sit. The door is
walkable. To see or change the property, select a tile in the Tilesets panel and look at Custom
Properties.

## Saving

- Keep **Tile Layer Format** on CSV (Map > Map Properties). Base64 is refused.
- Keep the tileset **embedded** in the map. If Tiled asks to export it as a separate file, say no.
- Then run `npm run content:validate`. It fails if the spawn is blocked or if some walkable square
  cannot be reached from the spawn (a pocket closed in by trees, say). The message names the first
  such squares as `x,y`; fill them with a bush or open a way in.

## New tiles

The tile pictures are drawn by `scripts/make-tiles.mjs` until real art arrives. Add new tiles at the
end of its list, run `npm run tiles`, then in Tiled use Tileset > Refresh to see them. Never reorder
the list: the map stores tiles by their position in it.
