#!/usr/bin/env python3
"""Turn photos of children's paper drawings into small pixel-art sprites, offline.

Run (from this folder, after the one-time setup in README.md):
    .venv/bin/python pipeline.py <photos-folder> <output-folder> [--json NAME]

For every photo (jpg, jpeg, png, heic, heif) it writes <name>-sheet.png, a contact sheet:
the photo, the cleaned paper, the cut-out, then each size and variant scaled up with sharp
pixels. overview.png shows the chosen variant of every drawing; timings.json the seconds per
photo. A photo whose name contains "grid16" or "grid32" is read as a coloured-in pixel-grid
page from the booklet instead: one pixel per printed square.

Nothing here talks to the network. It needs only Pillow, numpy and scipy, plus macOS `sips`
for HEIC photos.
"""
import argparse, json, math, subprocess, sys, tempfile, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

WORK_SIDE = 1600          # long side of the working copy; sprites are tiny, so more buys nothing
SIZES = (16, 32, 48)
OUTLINE = "#1b1b2f"
BEST = ("mode-palette-outline", 32)

# The palette family from docs/art.md, plus the weather shades used by content/art/creatures.
GAME_PALETTE = """
#1b1b2f #ffffff #5bbf5b #47a44c #7ad66f #2f7d3a #3e9a4a #1f5f2c #8fd3ff #e9f6ff #3a8fd8 #9fd4ff
#2a66a8 #d9b77e #b8945c #b8844f #9a6a3f #6b4329 #8a5a3b #c8c8d4 #9a9aa8 #6e6e80 #f3e6c8 #d0574a
#a8443a #f4c7a1 #4a3426 #ff7eb6 #ffc2dc #d0578f #ffd94a #fff2a8 #e8a33a #bfe6ff #7fb8e0 #8a7ad0
#b9adf0 #5c4aa0 #a8e0d0 #6fb3a0 #e0fff6 #f08a3a #ffb36b #c0602a #e0524f #b8742a
""".split()


# ---------- colour helpers ----------

def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float) / 255


def rgb_hex(c):
    c = np.clip(np.round(np.asarray(c) * 255), 0, 255).astype(int)
    return "#%02x%02x%02x" % tuple(c)


def to_lab(rgb):
    """sRGB in 0..1 (any shape ending in 3) to CIE Lab, so distances match what eyes see."""
    c = np.where(rgb > 0.04045, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = np.einsum("...j,ij->...i", c, m) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


PALETTE_RGB = np.array([hex_rgb(h) for h in GAME_PALETTE])
PALETTE_LAB = to_lab(PALETTE_RGB)


def snap_to_palette(centres_lab):
    """Nearest game colour for each cluster. Black marker photographs as a dark grey that sits closer
    to hair-brown than to the outline colour, so anything dark and greyish counts as outline."""
    idx = np.argmin(((centres_lab[:, None] - PALETTE_LAB[None]) ** 2).sum(-1), 1)
    out = PALETTE_RGB[idx]
    inky = (centres_lab[:, 0] < 32) & (np.hypot(centres_lab[:, 1], centres_lab[:, 2]) < 14)
    out[inky] = hex_rgb(OUTLINE)
    return out


def kmeans(lab, k, rng, iters=15):
    """Plain k-means++ in Lab on a sample of the drawing's pixels."""
    centres = [lab[rng.integers(len(lab))]]
    for _ in range(1, k):
        d = np.min(((lab[:, None] - np.array(centres)[None]) ** 2).sum(-1), 1)
        centres.append(lab[rng.choice(len(lab), p=d / d.sum())])
    centres = np.array(centres)
    for _ in range(iters):
        lbl = np.argmin(((lab[:, None] - centres[None]) ** 2).sum(-1), 1)
        for j in range(k):
            if np.any(lbl == j):
                centres[j] = lab[lbl == j].mean(0)
    return centres


def merge_close(centres, lab, limit=20.0):
    """Join clusters closer than `limit` (Lab units) so one marker is one colour. A filled-in grid
    has only a handful of colours, and k-means would otherwise split black into black and grey."""
    centres = list(centres)
    while len(centres) > 1:
        c = np.array(centres)
        d = np.sqrt(((c[:, None] - c[None]) ** 2).sum(-1)) + np.eye(len(c)) * 1e9
        i, j = np.unravel_index(d.argmin(), d.shape)
        if d[i, j] >= limit:
            break
        lbl = np.argmin(((lab[:, None] - c[None]) ** 2).sum(-1), 1)
        both = (lbl == i) | (lbl == j)
        centres[i] = lab[both].mean(0)
        del centres[j]
    return np.array(centres)


def lab_to_rgb_lookup(centres_lab, sample_lab, sample_rgb):
    """RGB for each Lab centre, as the mean RGB of the pixels nearest to it (avoids a Lab->RGB inverse)."""
    lbl = np.argmin(((sample_lab[:, None] - centres_lab[None]) ** 2).sum(-1), 1)
    return np.array([sample_rgb[lbl == j].mean(0) if np.any(lbl == j) else np.array([0.5, 0.5, 0.5])
                     for j in range(len(centres_lab))])


# ---------- 1. normalise ----------

def load_photo(path):
    if path.suffix.lower() in (".heic", ".heif"):
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "photo.png"
            subprocess.run(["sips", "-s", "format", "png", str(path), "--out", str(png)], check=True, capture_output=True)
            img = Image.open(png)
            img.load()
    else:
        img = Image.open(path)
    img = ImageOps.exif_transpose(img).convert("RGB")
    s = WORK_SIDE / max(img.size)
    if s < 1:
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    return np.asarray(img, float) / 255


def find_paper(rgb):
    """The sheet: the biggest bright, grey-ish region, as its convex hull so a shadow cannot bite into it."""
    small = rgb[::4, ::4]
    lum = small.mean(-1)
    chroma = small.max(-1) - small.min(-1)
    t = otsu(lum)
    # closing first, so ruled lines and pencil strokes do not split the sheet into strips
    bright = ndi.binary_closing((lum > t) & (chroma < 0.25), iterations=3)
    bright = ndi.binary_opening(bright, iterations=2)
    lbl, n = ndi.label(bright)
    if n == 0:
        return np.ones(rgb.shape[:2], bool)
    biggest = lbl == (np.argmax(np.bincount(lbl.ravel())[1:]) + 1)
    if biggest.mean() > 0.9:
        return np.ones(rgb.shape[:2], bool)
    ys, xs = np.nonzero(biggest)
    pts = np.stack([xs, ys], 1)
    hull = pts[ConvexHull(pts).vertices] * 4
    m = Image.new("L", (rgb.shape[1], rgb.shape[0]), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in hull], fill=1)
    paper = np.asarray(m, bool)
    return ndi.binary_erosion(paper, iterations=max(3, int(0.01 * max(rgb.shape))))


def otsu(values):
    hist, edges = np.histogram(values, 256, (0, 1))
    p = hist / hist.sum()
    w = np.cumsum(p); mu = np.cumsum(p * edges[:-1]); mt = mu[-1]
    between = (mt * w - mu) ** 2 / (w * (1 - w) + 1e-12)
    return edges[np.nanargmax(between)]


def paper_light(small, looks_paper, sigma):
    """Smooth paper brightness from the paper pixels alone (normalised convolution). Inside a big
    coloured area there is no paper nearby, so fall back to ever wider neighbourhoods there."""
    bg = None
    for s in (sigma, 3 * sigma, 9 * sigma):
        w = ndi.gaussian_filter(looks_paper.astype(float), s)
        est = np.stack([ndi.gaussian_filter(small[..., c] * looks_paper, s) for c in range(3)], -1) / (w[..., None] + 1e-6)
        if bg is None:
            bg, have = est, w
        else:
            trust = np.clip(have / 0.05, 0, 1)[..., None]
            bg = bg * trust + est * (1 - trust)
            have = np.maximum(have, w)
    if looks_paper.any():
        median = np.median(small[looks_paper], 0)
        bg = np.where((have < 0.01)[..., None], median, bg)
    return bg


def flatten_light(rgb, paper):
    """Divide by the paper's own brightness, estimated only from paper-looking pixels, so a shadow
    or a lamp gradient turns into even white without bleaching big coloured areas."""
    small = rgb[::4, ::4]
    psmall = paper[::4, ::4]
    sigma = max(small.shape) / 30
    looks_paper = psmall & ((small.max(-1) - small.min(-1)) < 0.08)
    lum = small.mean(-1)
    looks_paper &= lum > 0.7 * ndi.maximum_filter(lum, size=int(max(small.shape) / 12))
    for _ in range(2):
        bg = paper_light(small, looks_paper, sigma)
        flat = np.clip(small / np.maximum(bg, 0.05), 0, 1)
        looks_paper = psmall & (flat.min(-1) > 0.86) & ((flat.max(-1) - flat.min(-1)) < 0.1)
        # thin white gaps between colouring strokes are paper too, but dimmed by the colour around
        # them; trusting them would bleach the middle of large coloured areas
        looks_paper = ndi.binary_opening(looks_paper, iterations=3)
    bg_full = np.stack([np.asarray(Image.fromarray(bg[..., c].astype(np.float32)).resize(
        (rgb.shape[1], rgb.shape[0]), Image.BILINEAR)) for c in range(3)], -1)
    flat = np.clip(rgb / np.maximum(bg_full, 0.05), 0, 1)
    flat[~paper] = 1.0
    return flat


# ---------- 2. find the drawing ----------

def bluegrey_lines(flat):
    """The booklet prints its frames and grids in a light blue-grey (#93a8bf). Judge it by the shape of
    its colour, not its strength: how much it darkens blue compared with red stays the same when a
    thin line is blurred and lightened, and it is clearly bluer than the booklet's grey text."""
    dk = 1 - flat
    ratio = dk[..., 2] / (dk[..., 0] + 1e-3)
    return ((dk[..., 0] > 0.06) & (dk[..., 0] < 0.6) & (ratio > 0.4) & (ratio < 0.72)
            & (dk[..., 1] < dk[..., 0]) & (dk[..., 1] > dk[..., 2]))


def deskew_angle(flat):
    """Small rotation that makes the printed lines horizontal: the angle whose row profile is sharpest."""
    m = bluegrey_lines(flat)[::2, ::2]
    if m.mean() < 0.002:
        return 0.0
    img = Image.fromarray(m.astype(np.uint8) * 255)
    best = (0.0, -1)
    for a in np.arange(-6, 6.01, 0.25):
        prof = np.asarray(img.rotate(a, resample=Image.BILINEAR), float).sum(1)
        score = (prof ** 2).sum()
        if score > best[1]:
            best = (a, score)
    return best[0]


def rotate_rgb(rgb, angle, fill=1.0):
    if not angle:
        return rgb
    chans = [np.asarray(Image.fromarray(rgb[..., c].astype(np.float32)).rotate(angle, resample=Image.BILINEAR, fillcolor=fill))
             for c in range(3)]
    return np.stack(chans, -1)


def printed_frame(flat):
    """The booklet's dashed 'draw here' box or the pixel grid, found by their tall blue-grey sides:
    nothing else on a booklet page is a long vertical line. The box runs from the leftmost to the
    rightmost such line, and from the highest top to the lowest bottom among them."""
    lines = bluegrey_lines(flat)
    H, W = lines.shape
    upright = ndi.binary_opening(lines, structure=np.ones((9, 1)))  # drop horizontal lines and text
    joined = ndi.binary_closing(upright, structure=np.ones((25, 1)))  # bridge the gaps between dashes
    lbl, n = ndi.label(joined)
    sides = [sl for sl in ndi.find_objects(lbl)
             if sl[0].stop - sl[0].start > 0.25 * H and sl[1].stop - sl[1].start < 0.03 * W]
    if len(sides) < 2:
        return None, None
    left = min(sl[1].start for sl in sides)
    right = max(sl[1].stop for sl in sides)
    top = min(sl[0].start for sl in sides)
    bottom = max(sl[0].stop for sl in sides)
    if right - left < 0.3 * W:
        return None, None
    box = (slice(top, bottom), slice(left, right))
    near_edge = np.zeros_like(lines)
    near_edge[max(0, top - 20):bottom + 20, max(0, left - 20):right + 20] = True
    near_edge[top + 20:bottom - 20, left + 20:right - 20] = False
    return box, lines & near_edge


def remove_ruled_lines(mask, flat, region):
    """Lined paper: rows or columns that are 'ink' most of the way across are ruled lines, so drop the
    pixels on them whose colour matches the line, keeping drawing that crosses them."""
    out = mask.copy()
    for axis in (1, 0):
        frac = mask.sum(axis=axis) / np.maximum(region.sum(axis=axis), 1)
        # a ruled line is a thin spike in the profile; a big drawing raises it slowly
        lines = np.nonzero((frac > 0.4) & (frac - ndi.median_filter(frac, 31) > 0.3))[0]
        if len(lines) == 0:
            continue
        band = np.zeros(mask.shape[1 - axis], bool)
        band[lines] = True
        band = ndi.binary_dilation(band, iterations=2)
        sel = (band[:, None] if axis == 1 else band[None, :]) & mask
        line_col = np.median(flat[(lines[:, None] if axis == 1 else slice(None)),
                                  (slice(None) if axis == 1 else lines[None, :])].reshape(-1, 3)[
                                      mask[(lines[:, None] if axis == 1 else slice(None)),
                                           (slice(None) if axis == 1 else lines[None, :])].ravel()], axis=0)
        near = np.abs(flat - line_col).sum(-1) < 0.35
        out &= ~(sel & near)
    return out


def ink_threshold(score, region):
    """Just above the paper's own noise: low for faint pencil on clean paper, never below 0.06."""
    s = score[region]
    med = np.median(s)
    mad = np.median(np.abs(s - med)) + 1e-3
    return float(np.clip(med + 8 * mad, 0.06, 0.16))


def ink_mask(flat, region):
    """What the child drew: anything clearly darker or more colourful than white paper."""
    score = np.maximum(1 - flat.min(-1), (flat.max(-1) - flat.min(-1)) * 1.5)
    t = ink_threshold(score, region)
    m = (score > t) & region
    m = remove_ruled_lines(m, flat, region)
    m = ndi.binary_opening(m, iterations=1)
    m = ndi.binary_closing(m, iterations=4)
    m = ndi.binary_fill_holes(m)
    lbl, n = ndi.label(m)
    if n:
        sizes = np.bincount(lbl.ravel())
        sizes[0] = 0
        # crumbs, and bits cut off at the edge of the drawing area (frame dashes, the sheet's edge)
        edge = ndi.binary_dilation(~region, iterations=2)
        touches = np.bincount(lbl[edge].ravel(), minlength=n + 1) > 0
        keep = (sizes >= max(0.02 * sizes.max(), 0.0005 * m.size)) & ~(touches & (sizes < 0.2 * sizes.max()))
        keep[0] = False
        m = keep[lbl]
    return m, t


def crop_box(mask, margin=0.04):
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        raise ValueError("no drawing found")
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    p = int(margin * max(y1 - y0, x1 - x0))
    return max(0, y0 - p), min(mask.shape[0], y1 + p), max(0, x0 - p), min(mask.shape[1], x1 + p)


def boost(rgb, sat=1.3):
    """Photos of marker look duller than the paper does; push saturation a little back up."""
    grey = rgb.mean(-1, keepdims=True)
    return np.clip(grey + (rgb - grey) * sat, 0, 1)


def strengthen_faint(rgb, mask):
    """Pencil and light crayon: stretch the drawing's colours so its strongest ink reaches full
    strength. Leaves strong marker alone."""
    ink = 1 - rgb[mask]
    strength = np.percentile(ink.max(-1), 95) if len(ink) else 1
    if strength >= 0.55:
        return rgb, 1.0
    gain = 0.75 / max(strength, 0.05)
    return np.clip(1 - (1 - rgb) * gain, 0, 1), gain


# ---------- 3. pixelate ----------

def fit_cells(h, w, n, pad):
    """Map a drawing of h x w working pixels onto an n x n sprite, keeping its shape, centred, feet down."""
    inner = n - 2 * pad
    s = inner / max(h, w)
    ch, cw = max(1, round(h * s)), max(1, round(w * s))
    oy = pad + (inner - ch)  # stand on the bottom so creatures do not float
    ox = pad + (inner - cw) // 2
    return ch, cw, oy, ox


def fill_colouring_gaps(labels, mask, pale, k):
    """Uncoloured paper showing between colouring strokes, inside the drawing, takes the colour
    around it. Only thin gaps: a white area wide enough to survive an opening (an eye, a white
    belly, a letter) was left white on purpose and stays."""
    if not pale:
        return labels
    white = np.isin(labels, pale) & mask
    r = max(3, int(0.02 * max(labels.shape)))
    disk = np.hypot(*np.mgrid[-r:r + 1, -r:r + 1]) <= r
    meant = ndi.binary_opening(white, structure=disk)
    gaps = white & ~meant
    if not gaps.any():
        return labels
    source = mask & ~white
    _, (iy, ix) = ndi.distance_transform_edt(~source, return_indices=True)
    out = labels.copy()
    out[gaps] = labels[iy[gaps], ix[gaps]]
    return out


def pixelate_mode(labels, n, pad, k, dark, pale=()):
    """Each sprite pixel takes the colour covering most of its cell. Dark ink counts double, so thin
    marker outlines survive the shrink instead of losing to the colour beside them; paper-white
    counts less, so the gaps between colouring strokes do not turn into white stripes."""
    h, w = labels.shape
    ch, cw, oy, ox = fit_cells(h, w, n, pad)
    cy = (np.arange(h) * ch // h)[:, None]
    cx = (np.arange(w) * cw // w)[None, :]
    cell = (cy * cw + cx).ravel()
    counts = np.zeros((ch * cw, k + 1))
    np.add.at(counts, (cell, labels.ravel()), 1.0)
    # rarer colours count a little more, so thin coloured lines and small details are not voted away
    share = np.bincount(labels.ravel(), minlength=k + 1)[:k] / max(1, (labels != k).sum())
    weights = np.ones(k + 1)
    weights[:k] = np.clip((np.median(share[share > 0]) / np.maximum(share, 1e-6)) ** 0.35, 0.8, 1.8)
    weights[dark] *= 1.3 if n <= 16 else 2.0  # at 16 px a doubled outline would swallow the drawing
    weights[list(pale)] *= 0.6
    counts *= weights
    out = np.full((n, n), k)
    out[oy:oy + ch, ox:ox + cw] = counts.argmax(1).reshape(ch, cw)
    return out


def pixelate_area(rgb, alpha, n, pad, centres_lab, k):
    """Average each cell (Pillow's box filter), then snap the average to the nearest colour."""
    h, w = alpha.shape
    ch, cw, oy, ox = fit_cells(h, w, n, pad)
    pre = np.concatenate([rgb * alpha[..., None], alpha[..., None]], -1)
    small = np.stack([np.asarray(Image.fromarray(pre[..., c].astype(np.float32)).resize((cw, ch), Image.BOX))
                      for c in range(4)], -1)
    a = small[..., 3]
    col = small[..., :3] / np.maximum(a[..., None], 1e-6)
    lbl = np.argmin(((to_lab(col)[:, :, None] - centres_lab[None, None]) ** 2).sum(-1), -1)
    lbl[a < 0.5] = k
    out = np.full((n, n), k)
    out[oy:oy + ch, ox:ox + cw] = lbl
    return out


def despeckle(grid, k):
    """Lone pixels that differ from all four neighbours read as noise at 16 px; give them the neighbours' colour."""
    g = grid.copy()
    n = g.shape[0]
    for y in range(n):
        for x in range(n):
            nb = [grid[yy, xx] for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)) if 0 <= yy < n and 0 <= xx < n]
            if grid[y, x] in nb:
                continue
            vals, cnt = np.unique(nb, return_counts=True)
            if cnt.max() >= 3:
                g[y, x] = vals[cnt.argmax()]
    return g


def add_outline(grid, k, outline_idx):
    opaque = grid != k
    ring = ndi.binary_dilation(opaque, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]]) & ~opaque
    g = grid.copy()
    g[ring] = outline_idx
    return g


def render(grid, colours, k):
    n = grid.shape[0]
    img = np.zeros((n, n, 4), np.uint8)
    for j, c in enumerate(colours):
        img[grid == j, :3] = np.round(np.asarray(c) * 255)
        img[grid == j, 3] = 255
    return Image.fromarray(img)


# ---------- grid pages ----------

def read_grid(flat, frame_slice, n):
    """A coloured-in booklet grid: one pixel per printed square, from the middle half of each square."""
    sy, sx = frame_slice
    y0, y1, x0, x1 = sy.start, sy.stop, sx.start, sx.stop
    ys = np.linspace(y0, y1, n + 1)
    xs = np.linspace(x0, x1, n + 1)
    cells = np.zeros((n, n, 3))
    filled = np.zeros((n, n), bool)
    for r in range(n):
        for c in range(n):
            a0, a1 = int(ys[r] + (ys[r + 1] - ys[r]) * 0.25), int(ys[r] + (ys[r + 1] - ys[r]) * 0.75)
            b0, b1 = int(xs[c] + (xs[c + 1] - xs[c]) * 0.25), int(xs[c] + (xs[c + 1] - xs[c]) * 0.75)
            patch = flat[a0:a1, b0:b1].reshape(-1, 3)
            score = np.maximum(1 - patch.min(-1), (patch.max(-1) - patch.min(-1)) * 1.5)
            filled[r, c] = (score > 0.2).mean() > 0.4
            cells[r, c] = np.median(patch[score > 0.2], 0) if filled[r, c] else 1
    return cells, filled


# ---------- per photo ----------

def process(path, rng):
    t0 = time.perf_counter()
    rgb = load_photo(path)
    paper = find_paper(rgb)
    flat = flatten_light(rgb, paper)
    angle = deskew_angle(flat)
    if angle:
        flat = rotate_rgb(flat, angle)
        rgb = rotate_rgb(rgb, angle)
    frame, frame_px = printed_frame(flat)
    grid_n = 16 if "grid16" in path.stem else 32 if "grid32" in path.stem else None
    result = {"photo": rgb, "flat": flat, "variants": {}, "grid_n": grid_n}

    if grid_n and frame is not None:
        cells, filled = read_grid(flat, frame, grid_n)
        sample_rgb = boost(cells[filled])
        lab = to_lab(sample_rgb)
        k = min(12, len(lab))
        centres = merge_close(kmeans(lab, k, rng), lab)
        k = len(centres)
        cols = lab_to_rgb_lookup(centres, lab, sample_rgb)
        lbl = np.full((grid_n, grid_n), k)
        lbl[filled] = np.argmin(((lab[:, None] - centres[None]) ** 2).sum(-1), 1)
        snapped = snap_to_palette(centres)
        result["variants"][("grid-kmeans", grid_n)] = render(lbl, cols, k)
        result["variants"][("grid-palette", grid_n)] = render(lbl, snapped, k)
        result["cutout"] = render(lbl, cols, k).resize((grid_n * 16, grid_n * 16), Image.NEAREST)
        result["notes"] = f"deskew {angle:+.2f} deg, read as a {grid_n}x{grid_n} grid"
        result["grids"] = {("grid-palette", grid_n): (lbl, snapped, k)}
        result["seconds"] = time.perf_counter() - t0
        return result

    region = paper.copy()
    if frame is not None:
        sy, sx = frame
        inset = int(0.015 * max(flat.shape))
        region = np.zeros_like(paper)
        region[sy.start + inset:sy.stop - inset, sx.start + inset:sx.stop - inset] = True
        region &= ~ndi.binary_dilation(frame_px, iterations=4)
    mask, threshold = ink_mask(flat, region)
    y0, y1, x0, x1 = crop_box(mask)
    m = mask[y0:y1, x0:x1]
    col, gain = strengthen_faint(flat[y0:y1, x0:x1], m)
    col = boost(col)
    result["notes"] = f"deskew {angle:+.2f} deg, frame {'yes' if frame is not None else 'no'}, ink threshold {threshold:.3f}, faint gain {gain:.2f}"
    result["cutout"] = Image.fromarray(np.concatenate([np.round(col * 255), m[..., None] * 255.0], -1).astype(np.uint8))

    sample_rgb = col[m]
    sample_rgb = sample_rgb[rng.choice(len(sample_rgb), min(20000, len(sample_rgb)), replace=False)]
    sample_lab = to_lab(sample_rgb)
    all_lab = to_lab(col)
    grids = {}
    for family in ("kmeans8", "palette"):
        centres = kmeans(sample_lab, 8 if family == "kmeans8" else 12, rng)
        if family == "palette":
            # two shades of one marker (stroke overlaps, light falloff) read as stripes in pixel art
            centres = merge_close(centres, sample_lab, limit=14.0)
        k = len(centres)
        cols = lab_to_rgb_lookup(centres, sample_lab, sample_rgb)
        snapped = snap_to_palette(centres)
        labels = np.argmin(((all_lab[:, :, None] - centres[None, None]) ** 2).sum(-1), -1)
        dark = [j for j in range(k) if centres[j, 0] < 35]
        pale = [j for j in range(k) if centres[j, 0] > 88 and np.hypot(centres[j, 1], centres[j, 2]) < 12]
        labels = fill_colouring_gaps(labels, m, pale, k)
        labels[~m] = k
        for n in SIZES:
            if family == "kmeans8":
                grids[("area-kmeans8", n)] = (pixelate_area(col, m.astype(float), n, 1, centres, k), cols, k)
                grids[("mode-kmeans8", n)] = (despeckle(pixelate_mode(labels, n, 1, k, dark, pale), k), cols, k)
            else:
                g = despeckle(pixelate_mode(labels, n, 1, k, dark, pale), k)
                grids[("mode-palette", n)] = (g, snapped, k)
                pal = np.vstack([snapped, hex_rgb(OUTLINE)])
                grids[("mode-palette-outline", n)] = (add_outline(np.where(g == k, k + 1, g), k + 1, k), pal, k + 1)
    for key, (g, cols, k) in grids.items():
        result["variants"][key] = render(g, cols, k)
    result["grids"] = grids
    result["seconds"] = time.perf_counter() - t0
    return result


# ---------- 4. sheets ----------

def checker(w, h, s=8):
    yy, xx = np.mgrid[0:h, 0:w]
    v = np.where(((yy // s) + (xx // s)) % 2, 205, 235).astype(np.uint8)
    return Image.fromarray(np.stack([v, v, v, np.full_like(v, 255)], -1))


def on_checker(img, size):
    img = img.copy()
    img.thumbnail(size, Image.LANCZOS if max(img.size) > max(size) else Image.NEAREST)
    bg = checker(*img.size)
    bg.alpha_composite(img)
    return bg


def font(sz):
    try:
        return ImageFont.load_default(sz)
    except TypeError:
        return ImageFont.load_default()


def contact_sheet(name, res):
    tile = 192
    photo = Image.fromarray((res["photo"] * 255).astype(np.uint8))
    flat = Image.fromarray((res["flat"] * 255).astype(np.uint8))
    top = [("photo", photo), ("lighting evened", flat), ("cut-out", res["cutout"])]
    keys = sorted(res["variants"], key=lambda k: (k[1], k[0]))
    names = sorted({k[0] for k in keys})
    sizes = sorted({k[1] for k in keys})
    W = max(3 * 340, len(names) * (tile + 16)) + 32
    H = 60 + 400 + len(sizes) * (tile + 40) + 20
    sheet = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)
    d.text((16, 12), f"{name}   ({res['seconds']:.2f} s)   {res.get('notes', '')}", fill="black", font=font(18))
    for i, (label, im) in enumerate(top):
        t = on_checker(im.convert("RGBA"), (320, 360))
        sheet.alpha_composite(t, (16 + i * 340, 70))
        d.text((16 + i * 340, 46), label, fill="black", font=font(16))
    for r, n in enumerate(sizes):
        y = 60 + 400 + r * (tile + 40)
        for c, v in enumerate(names):
            if (v, n) not in res["variants"]:
                continue
            im = res["variants"][(v, n)].resize((tile, tile), Image.NEAREST)
            sheet.alpha_composite(on_checker(im, (tile, tile)), (16 + c * (tile + 16), y + 20))
            d.text((16 + c * (tile + 16), y), f"{v} {n}", fill="black", font=font(14))
    return sheet


def overview(rows):
    tile = 192
    W, H = 16 + 5 * (tile + 16), 16 + len(rows) * (tile + 40)
    sheet = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for r, (name, res) in enumerate(rows):
        y = 16 + r * (tile + 40)
        d.text((16, y), f"{name} ({res['seconds']:.1f} s)", fill="black", font=font(14))
        photo = Image.fromarray((res["photo"] * 255).astype(np.uint8)).convert("RGBA")
        sheet.alpha_composite(on_checker(photo, (tile, tile)), (16, y + 18))
        sheet.alpha_composite(on_checker(res["cutout"], (tile, tile)), (16 + tile + 16, y + 18))
        is_grid = ("grid-palette", res["grid_n"]) in res["variants"]
        variant = "grid-palette" if is_grid else BEST[0]
        for c, n in enumerate((res["grid_n"],) if is_grid else SIZES):
            im = res["variants"][(variant, n)].resize((tile, tile), Image.NEAREST)
            sheet.alpha_composite(on_checker(im, (tile, tile)), (16 + (c + 2) * (tile + 16), y + 18))
            d.text((16 + (c + 2) * (tile + 16), y + tile + 20), f"{variant} {n}", fill="black", font=font(12))
    return sheet


# ---------- 5. game JSON ----------

KEY_HINTS = [("k", 0, 0, 0), ("w", 1, 1, 1), ("r", 0.85, 0.25, 0.25), ("o", 0.95, 0.55, 0.2), ("y", 1, 0.85, 0.3),
             ("g", 0.3, 0.7, 0.3), ("b", 0.25, 0.5, 0.85), ("c", 0.6, 0.85, 1), ("p", 0.55, 0.45, 0.8),
             ("m", 1, 0.5, 0.7), ("n", 0.55, 0.35, 0.2), ("s", 0.96, 0.78, 0.63), ("e", 0.6, 0.6, 0.65)]


def sprite_json(grid, colours, k, frame):
    """content/art format: one character per pixel, '.' transparent, keys hinting at the colour."""
    used = sorted({int(v) for v in np.unique(grid) if v != k})
    palette, keys, taken = {}, {}, set()
    for j in used:
        hx = rgb_hex(colours[j])
        if hx in palette.values():
            keys[j] = next(key for key, v in palette.items() if v == hx)
            continue
        if hx == OUTLINE:
            order = ["k"]
        else:
            lab = to_lab(np.asarray(colours[j]))
            order = [h[0] for h in sorted(KEY_HINTS, key=lambda h: ((to_lab(np.array(h[1:])) - lab) ** 2).sum())]
        key = next((c for c in order + list("adfhijlqtuvxz") if c not in taken), None)
        taken.add(key)
        palette[key] = hx
        keys[j] = key
    rows = ["".join("." if v == k else keys[int(v)] for v in row) for row in grid]
    n = grid.shape[0]
    return {"width": n, "height": n, "palette": palette, "frames": {frame: rows}}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("photos", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--json", action="append", default=[],
                    help="photo name (without extension) to also write as content/art JSON; repeatable")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(1)
    photos = sorted(p for p in args.photos.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".heic", ".heif"))
    rows, timings = [], {}
    for p in photos:
        try:
            res = process(p, rng)
        except Exception as e:  # one bad photo should not stop the rest
            print(f"{p.name}: FAILED {e}", file=sys.stderr)
            continue
        t = time.perf_counter()
        contact_sheet(p.stem, res).save(args.out / f"{p.stem}-sheet.png")
        for (v, n), im in res["variants"].items():
            if (v, n) == BEST or v == "grid-palette":
                im.save(args.out / f"{p.stem}-{v}-{n}.png")
        timings[p.name] = {"pipeline_s": round(res["seconds"], 2), "sheet_s": round(time.perf_counter() - t, 2)}
        print(f"{p.name}: {res['seconds']:.2f} s pipeline, {timings[p.name]['sheet_s']:.2f} s sheet")
        rows.append((p.stem, res))
        if p.stem in args.json:
            key = ("grid-palette", res["grid_n"]) if ("grid-palette", res["grid_n"]) in res["grids"] else BEST
            g, cols, k = res["grids"][key]
            frame = "front" if "creature" in p.stem else "down-stand" if "courier" in p.stem else "still"
            (args.out / f"{p.stem}.json").write_text(json.dumps(sprite_json(g, cols, k, frame), indent=2) + "\n")
    if rows:
        overview(rows).save(args.out / "overview.png")
    (args.out / "timings.json").write_text(json.dumps(timings, indent=2) + "\n")


if __name__ == "__main__":
    main()
