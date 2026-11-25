# Photo to pixel art (prototype)

Turns photos of children's paper drawings into small pixel-art sprites, on this Mac, with no
network and no AI. A throwaway prototype for Slice G, "Real world" (`docs/design.md`,
`docs/decisions/0002-real-world-proof.md`), kept on the branch `prototype/photo-pixel` and never
merged. So far it has only been run on invented stand-in photos, not real drawings.

## Setup, once

    cd prototypes/photo-pixel
    uv venv --python /usr/bin/python3 .venv
    uv pip install --python .venv/bin/python pillow==11.3.0 numpy==2.0.2 scipy==1.13.1

HEIC photos are converted with macOS `sips`, which is built in.

## Run

    .venv/bin/python pipeline.py <photos-folder> <output-folder> [--json <photo-name>]...

- Reads every .jpg, .jpeg, .png, .heic and .heif in the folder.
- Writes `<name>-sheet.png` per photo (photo, lighting evened, cut-out, then 16/32/48 px in four
  variants scaled up with sharp pixels), `overview.png` (the chosen variant of every photo),
  `<name>-mode-palette-outline-32.png` (the sprite itself) and `timings.json`.
- A photo whose file name contains `grid16` or `grid32` is read as a coloured-in pixel-grid page
  from the booklet: one sprite pixel per printed square.
- `--json <name>` also writes that photo's sprite in the game's `content/art` JSON format.

## What it does

1. Normalise: EXIF rotation, HEIC to PNG, work at 1600 px on the long side. Find the sheet (the
   biggest bright grey-ish region, as its convex hull), divide by the paper's own brightness so
   shadows and lamp gradients become even white, straighten by the printed lines if any.
2. Find the drawing: inside the booklet's dashed frame when one is found, otherwise on the whole
   sheet. Ink is anything clearly darker or more colourful than paper, with a threshold set from
   the paper's own noise. Ruled lines of lined paper are removed. Holes are filled (white bellies
   and eyes stay opaque), crumbs and bits cut by the edge are dropped, then the drawing is cropped.
   Faint pencil and crayon are stretched to full strength.
3. Pixelate: colours are clustered (k-means in Lab). `area-kmeans8` averages each cell then picks
   the nearest colour; `mode-*` gives each cell the colour covering most of it, with dark outline
   ink counting more and white gaps between colouring strokes counting less. `mode-palette` snaps
   each colour to the game's palette family (docs/art.md); `mode-palette-outline` adds the 1 px
   `#1b1b2f` outline. Lone pixels are smoothed away.

`synth.py` makes the invented stand-in "photos" used to test it, on booklet pages rendered from the
design guide PDF by `swift render_booklet.swift <guide.pdf> booklet`. `check_grid.py` checks the grid reading against the sprite that was
painted.

## What the stand-in test showed

- Badges and island decorations come out well.
- Creatures keep their shape, colours and outline at 32 px, but faces blur and there is no back
  view, so they need a touch-up or an AI polish (with a grown-up's OK per picture).
- Coloured-in pixel-grid pages are read exactly (256 of 256 squares, even with a shadow and a
  tilt): the best route for couriers, badges and patterns.
- Free-drawn patterns and couriers do not shrink well; use the grid pages for those.
- Snapping to the game's palette can shift a hue.
- About 1 to 2 s per 12-megapixel photo on the Mac mini.
- Tips for kids: thick black marker outlines, solid colour, one thing per sheet on plain white
  paper, photographed in daylight from straight above.
- The server image has no `sips`, so a real version needs a HEIC library or JPEG-only uploads.

Photos and outputs never go in the repository: `.gitignore` here keeps them out.
