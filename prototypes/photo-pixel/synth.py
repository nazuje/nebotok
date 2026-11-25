"""Make synthetic stand-in "phone photos" of children's drawings, so the pipeline
can be exercised before the real photos arrive. Everything here is invented."""
import json, math, random, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
BOOKLET = HERE / "booklet"
OUT = HERE / "synthetic"
REPO = HERE.parents[1]
PAGE_W, PAGE_H = 2381, 3367            # booklet pages rendered at 4x (A4)
CREATURE_BOX = (190, 1310, 2230, 3160)  # inside the dashed "draw here" frame, page 4
COURIER_BOX = (190, 1500, 2230, 3110)   # page 3

INK = (35, 35, 40)


def wobble_poly(cx, cy, rx, ry, n=48, amt=0.06, rng=None):
    pts = []
    phase = [rng.uniform(0, 6.3) for _ in range(3)]
    for i in range(n):
        t = 2 * math.pi * i / n
        r = 1 + amt * (math.sin(3 * t + phase[0]) + 0.6 * math.sin(5 * t + phase[1]) + 0.4 * math.sin(7 * t + phase[2]))
        pts.append((cx + rx * r * math.cos(t), cy + ry * r * math.sin(t)))
    return pts


def jitter(pts, amt, rng):
    return [(x + rng.uniform(-amt, amt), y + rng.uniform(-amt, amt)) for x, y in pts]


def stroke(draw, pts, width, colour, closed=True):
    pts = list(pts) + ([pts[0]] if closed else [])
    draw.line(pts, fill=colour, width=width, joint="curve")
    r = width / 2
    for x, y in pts:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=colour)


def scribble_fill(page, poly, colour, rng, coverage=0.93, alpha=1.0, width=34):
    """Fill a shape the way a child colours with a marker: diagonal strokes, gaps, overlaps."""
    w, h = page.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    layer = Image.new("L", (w, h), 0)
    ld = ImageDraw.Draw(layer)
    step = width * 0.8
    k = -1.0
    c = y0 - (x1 - x0)
    while c < y1 + (x1 - x0):
        if rng.random() < coverage:
            ld.line([(x0 - 40, c + rng.uniform(-8, 8)), (x1 + 40, c + k * -(x1 - x0 + 80) + rng.uniform(-8, 8))],
                    fill=int(255 * alpha * rng.uniform(0.75, 1.0)), width=int(width * rng.uniform(0.7, 1.1)))
        c += step
    # slight overshoot past the outline, as children do
    over = mask.filter(ImageFilter.MaxFilter(9))
    cover = Image.fromarray((np.asarray(layer, float) * np.asarray(over, float) / 255).astype(np.uint8))
    solid = Image.new("RGB", (w, h), colour)
    page.paste(solid, (0, 0), cover)


def crayon_texture(page, rng, strength):
    """Paper tooth: crayon and pencil leave speckled white gaps."""
    a = np.asarray(page, float)
    noise = rng_np(rng).random(a.shape[:2])
    paper = np.array([250, 249, 244], float)
    t = (noise < strength)[..., None]
    a = np.where(t, a * 0.3 + paper * 0.7, a)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def rng_np(rng):
    return np.random.default_rng(rng.randrange(1 << 30))


def draw_creature(page, box, rng, body, belly, ear, outline_w=20, ink=INK, coverage=0.95, alpha=1.0, fill_w=34):
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + 80
    rx, ry = (x1 - x0) * 0.30, (y1 - y0) * 0.30
    d = ImageDraw.Draw(page)
    body_p = wobble_poly(cx, cy, rx, ry, rng=rng)
    ear_l = jitter([(cx - rx * 0.75, cy - ry * 0.55), (cx - rx * 0.95, cy - ry * 1.45), (cx - rx * 0.25, cy - ry * 0.85)], 10, rng)
    ear_r = jitter([(cx + rx * 0.25, cy - ry * 0.85), (cx + rx * 0.95, cy - ry * 1.45), (cx + rx * 0.75, cy - ry * 0.55)], 10, rng)
    feet = [wobble_poly(cx - rx * 0.45, cy + ry * 0.98, rx * 0.22, ry * 0.12, n=24, rng=rng),
            wobble_poly(cx + rx * 0.45, cy + ry * 0.98, rx * 0.22, ry * 0.12, n=24, rng=rng)]
    tail = jitter([(cx + rx * 0.92, cy + ry * 0.2), (cx + rx * 1.45, cy - ry * 0.25), (cx + rx * 1.3, cy + ry * 0.05), (cx + rx * 0.95, cy + ry * 0.45)], 8, rng)
    belly_p = wobble_poly(cx, cy + ry * 0.25, rx * 0.5, ry * 0.45, rng=rng)
    for shape, col in [(ear_l, ear), (ear_r, ear), (tail, ear)] + [(f, ear) for f in feet] + [(body_p, body), (belly_p, belly)]:
        scribble_fill(page, shape, col, rng, coverage, alpha, fill_w)
    for shape in [ear_l, ear_r, tail, *feet, body_p, belly_p]:
        stroke(d, shape, outline_w, ink)
    for ex in (cx - rx * 0.35, cx + rx * 0.35):
        ey = cy - ry * 0.35
        er = rx * 0.17
        d.ellipse((ex - er, ey - er, ex + er, ey + er), fill=(252, 252, 250))
        stroke(d, wobble_poly(ex, ey, er, er, n=20, amt=0.03, rng=rng), max(6, outline_w // 2), ink)
        pr = er * 0.45
        d.ellipse((ex - pr, ey - pr + 8, ex + pr, ey + pr + 8), fill=ink)
    mouth = [(cx - rx * 0.25 + i * rx * 0.05, cy - ry * 0.02 + math.sin(i / 10 * math.pi) * ry * 0.12) for i in range(11)]
    stroke(d, mouth, max(6, outline_w // 2), ink, closed=False)


def draw_courier(page, box, rng):
    x0, y0, x1, y1 = box
    cx = (x0 + x1) / 2
    d = ImageDraw.Draw(page)
    H = y1 - y0
    head = wobble_poly(cx, y0 + H * 0.25, H * 0.13, H * 0.13, amt=0.03, rng=rng)
    hair = jitter([(cx - H * 0.14, y0 + H * 0.22), (cx - H * 0.12, y0 + H * 0.1), (cx, y0 + H * 0.08), (cx + H * 0.12, y0 + H * 0.1), (cx + H * 0.14, y0 + H * 0.22), (cx, y0 + H * 0.15)], 6, rng)
    cap = jitter([(cx - H * 0.15, y0 + H * 0.13), (cx - H * 0.1, y0 + H * 0.04), (cx + H * 0.1, y0 + H * 0.04), (cx + H * 0.15, y0 + H * 0.13), (cx + H * 0.27, y0 + H * 0.15), (cx + H * 0.15, y0 + H * 0.17)], 5, rng)
    body = jitter([(cx - H * 0.13, y0 + H * 0.4), (cx + H * 0.13, y0 + H * 0.4), (cx + H * 0.17, y0 + H * 0.72), (cx - H * 0.17, y0 + H * 0.72)], 6, rng)
    arm_l = jitter([(cx - H * 0.13, y0 + H * 0.42), (cx - H * 0.27, y0 + H * 0.62), (cx - H * 0.22, y0 + H * 0.65), (cx - H * 0.12, y0 + H * 0.5)], 5, rng)
    arm_r = jitter([(cx + H * 0.13, y0 + H * 0.42), (cx + H * 0.27, y0 + H * 0.62), (cx + H * 0.22, y0 + H * 0.65), (cx + H * 0.12, y0 + H * 0.5)], 5, rng)
    legs = [jitter([(cx - H * 0.12, y0 + H * 0.72), (cx - H * 0.02, y0 + H * 0.72), (cx - H * 0.03, y0 + H * 0.95), (cx - H * 0.13, y0 + H * 0.95)], 4, rng),
            jitter([(cx + H * 0.02, y0 + H * 0.72), (cx + H * 0.12, y0 + H * 0.72), (cx + H * 0.13, y0 + H * 0.95), (cx + H * 0.03, y0 + H * 0.95)], 4, rng)]
    bag = jitter([(cx + H * 0.05, y0 + H * 0.55), (cx + H * 0.25, y0 + H * 0.55), (cx + H * 0.25, y0 + H * 0.7), (cx + H * 0.05, y0 + H * 0.7)], 5, rng)
    letter = jitter([(cx + H * 0.09, y0 + H * 0.58), (cx + H * 0.21, y0 + H * 0.58), (cx + H * 0.21, y0 + H * 0.66), (cx + H * 0.09, y0 + H * 0.66)], 3, rng)
    for shape, col in [(legs[0], (40, 60, 120)), (legs[1], (40, 60, 120)), (arm_l, (60, 130, 220)), (arm_r, (60, 130, 220)), (body, (60, 130, 220)), (head, (245, 200, 160)), (hair, (110, 70, 40)), (cap, (220, 50, 50)), (bag, (150, 95, 50)), (letter, (252, 252, 250))]:
        scribble_fill(page, shape, col, rng)
    for shape in [legs[0], legs[1], arm_l, arm_r, body, head, hair, cap, bag, letter]:
        stroke(d, shape, 18, INK)
    for ex in (cx - H * 0.045, cx + H * 0.045):
        ey = y0 + H * 0.25
        d.ellipse((ex - 14, ey - 14, ex + 14, ey + 14), fill=INK)
    stroke(d, [(cx - H * 0.05 + i * H * 0.01, y0 + H * 0.31 + math.sin(i / 10 * math.pi) * 18) for i in range(11)], 9, INK, closed=False)


def draw_badge(page, box, rng):
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    R = min(x1 - x0, y1 - y0) * 0.42
    d = ImageDraw.Draw(page)
    circle = wobble_poly(cx, cy, R, R, amt=0.02, rng=rng)
    star = jitter([(cx + (R * 0.8 if i % 2 == 0 else R * 0.36) * math.cos(-math.pi / 2 + i * math.pi / 5),
                    cy + (R * 0.8 if i % 2 == 0 else R * 0.36) * math.sin(-math.pi / 2 + i * math.pi / 5)) for i in range(10)], 10, rng)
    scribble_fill(page, circle, (240, 140, 50), rng)
    scribble_fill(page, star, (255, 215, 60), rng)
    stroke(d, circle, 22, INK)
    stroke(d, star, 22, INK)


def draw_pattern(page, box, rng):
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(page)
    rect = jitter([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], 10, rng)
    scribble_fill(page, rect, (120, 200, 230), rng)
    bands = 5
    for b in range(bands):
        yy = y0 + (b + 0.5) * (y1 - y0) / bands
        zig = [(x0 + i * (x1 - x0) / 12, yy + (40 if i % 2 else -40) + rng.uniform(-6, 6)) for i in range(13)]
        stroke(d, zig, 30, (230, 60, 120) if b % 2 else (60, 160, 70), closed=False)
        for i in range(6):
            px, py = x0 + (i + 0.5 + (b % 2) * 0.5) * (x1 - x0) / 6.5, yy + (y1 - y0) / bands / 2
            d.ellipse((px - 22, py - 22, px + 22, py + 22), fill=(250, 210, 50))
    stroke(d, rect, 22, INK)


def plain_paper(lined=False):
    page = Image.new("RGB", (PAGE_W, PAGE_H), (250, 249, 244))
    if lined:
        d = ImageDraw.Draw(page)
        for y in range(380, PAGE_H - 100, 95):
            d.line([(0, y), (PAGE_W, y)], fill=(150, 190, 225), width=5)
        d.line([(330, 0), (330, PAGE_H)], fill=(225, 120, 130), width=6)
    return page


def booklet(n):
    return Image.open(BOOKLET / f"page-{n}.png").convert("RGB")


def fill_grid(page, sprite, colours, rng):
    a = np.asarray(page.convert("RGB")).astype(int)
    gridish = (abs(a[..., 0] - 143) < 12) & (abs(a[..., 1] - 161) < 12) & (abs(a[..., 2] - 181) < 12)
    rows = np.nonzero(gridish.sum(1) > 1000)[0]  # only the long grid lines, not the grey heading text
    cols = np.nonzero(gridish.sum(0) > 1000)[0]
    gx0, gx1, gy0, gy1 = cols.min(), cols.max(), rows.min(), rows.max()
    n = len(sprite)
    cw, ch = (gx1 - gx0) / n, (gy1 - gy0) / n
    for r, row in enumerate(sprite):
        for c, key in enumerate(row):
            if key == ".":
                continue
            m = 6
            cell = [(gx0 + c * cw + m, gy0 + r * ch + m), (gx0 + (c + 1) * cw - m, gy0 + r * ch + m),
                    (gx0 + (c + 1) * cw - m, gy0 + (r + 1) * ch - m), (gx0 + c * cw + m, gy0 + (r + 1) * ch - m)]
            scribble_fill(page, jitter(cell, 6, rng), colours[key], rng, coverage=0.92, width=26)
    return page


def photograph(page, rng, *, fill=0.9, angle=0.0, background="table-white", gradient=0.15, shadow=0.0,
               warm=0.05, size=(3024, 4032), blur=1.2):
    W, H = size
    if background == "wood":
        y = np.arange(H)[:, None]; x = np.arange(W)[None, :]
        grain = np.sin(x / 9.0 + 6 * np.sin(y / 170.0)) * 0.5 + 0.5
        base = np.stack([120 + 40 * grain, 80 + 28 * grain, 45 + 15 * grain + 0 * y], -1)
        bg = Image.fromarray(base.astype(np.uint8))
    else:
        bg = Image.new("RGB", (W, H), (205, 205, 200))
    scale = fill * min(W / PAGE_W, H / PAGE_H)
    p = page.resize((int(PAGE_W * scale), int(PAGE_H * scale)), Image.LANCZOS).convert("RGBA")
    p = p.rotate(angle, resample=Image.BICUBIC, expand=True)
    bg.paste(p, ((W - p.width) // 2, (H - p.height) // 2), p)
    a = np.asarray(bg, float)
    yy, xx = np.mgrid[0:H, 0:W]
    light = 1.0 - gradient * (0.6 * xx / W + 0.4 * yy / H)
    if shadow:
        sx, sy = W * 0.78, H * 0.62
        d2 = ((xx - sx) / (W * 0.28)) ** 2 + ((yy - sy) / (H * 0.22)) ** 2
        light = light * (1 - shadow * np.clip(1.4 - d2, 0, 1) ** 0.7 * (d2 < 1.4))
    a = a * light[..., None] * np.array([1.0, 1.0 - warm, 1.0 - 2.2 * warm])
    a += rng_np(rng).normal(0, 3.0, a.shape)
    img = Image.fromarray(a.clip(0, 255).astype(np.uint8))
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return img


def save_jpeg(img, path, orientation=None):
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    img.save(path, "JPEG", quality=86, exif=exif.tobytes())


def main():
    OUT.mkdir(exist_ok=True)
    rng = random.Random(7)

    page = booklet(4)
    draw_creature(page, CREATURE_BOX, rng, body=(255, 120, 180), belly=(255, 225, 90), ear=(80, 190, 90))
    save_jpeg(photograph(page, rng, fill=0.97, gradient=0.08), OUT / "creature-1.jpg")

    page = booklet(4)
    draw_creature(page, CREATURE_BOX, rng, body=(70, 140, 220), belly=(190, 230, 255), ear=(40, 80, 170))
    shot = photograph(page, rng, fill=0.93, angle=3, gradient=0.35, shadow=0.45, warm=0.08)
    # store it sideways with an EXIF "rotate 90" tag, as phones do
    save_jpeg(shot.transpose(Image.ROTATE_90), OUT / "creature-2-shadow.jpg", orientation=6)

    page = booklet(3)
    draw_courier(page, COURIER_BOX, rng)
    jpg = OUT / "courier-1.jpg"
    save_jpeg(photograph(page, rng, fill=0.95, angle=-2, gradient=0.18), jpg)
    subprocess.run(["sips", "-s", "format", "heic", str(jpg), "--out", str(OUT / "courier-1.heic")], check=True, capture_output=True)
    jpg.unlink()

    page = plain_paper()
    draw_creature(page, (300, 700, 2100, 2900), rng, body=(255, 170, 200), belly=(255, 240, 170), ear=(150, 220, 150),
                  outline_w=6, ink=(120, 120, 125), coverage=0.6, alpha=0.45, fill_w=14)
    page = crayon_texture(page, rng, 0.25)
    save_jpeg(photograph(page, rng, fill=0.92, gradient=0.2), OUT / "creature-3-pencil.jpg")

    page = plain_paper(lined=True)
    draw_creature(page, (300, 800, 2100, 2900), rng, body=(250, 210, 60), belly=(255, 250, 220), ear=(240, 130, 40))
    save_jpeg(photograph(page, rng, fill=0.95, gradient=0.15), OUT / "creature-4-lined.jpg")

    page = plain_paper()
    draw_badge(page, (500, 1000, 1900, 2400), rng)
    save_jpeg(photograph(page, rng, fill=0.62, angle=7, background="wood", gradient=0.12), OUT / "badge-1-table.jpg")

    page = plain_paper()
    draw_pattern(page, (350, 900, 2050, 2600), rng)
    save_jpeg(photograph(page, rng, fill=0.95, gradient=0.12), OUT / "pattern-1.jpg")

    sprite = json.loads((REPO / "content/art/couriers/courier.json").read_text())["frames"]["down-stand"]
    colours = {"k": INK, "y": (225, 70, 70), "s": (240, 200, 160), "b": (70, 140, 220), "r": (140, 90, 50), "m": (250, 205, 60), "d": (100, 65, 40)}
    page = fill_grid(booklet(8), sprite, colours, rng)
    save_jpeg(photograph(page, rng, fill=0.96, angle=1.5, gradient=0.2, shadow=0.25), OUT / "grid16-courier.jpg")
    print("wrote", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
