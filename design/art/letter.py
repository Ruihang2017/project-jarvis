"""Set type on a painted icon background, and build contact sheets.

usage:
  py letter.py compose <bg.png> <name> <text> [--color #RRGGBB] [--edge #RRGGBB]
                       [--tint #RRGGBB] [--size word|letter] [--halo 0..1] [--track em]
  py letter.py banner <bg.png> <name> <text> [same options as compose]
  py letter.py sheet <out.png> <img1024.png> [...]

compose writes raw/<name>-1024.png and <name>.jpg (512, q90) next to this script.
banner keeps the background's own shape (e.g. 3:2) and sets the word across the middle;
it writes raw/<name>-full.png and <name>.jpg (1200 wide, q90).
--tint multiplies the background by a colour (deepens a too-light wash).
--halo strength of a wide soft glow in the edge colour behind the letters.
--edge is the colour of the soft shadow / thin outline behind the letters.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ART = Path(__file__).resolve().parent
FONTS = "C:/Windows/Fonts/"
SIZE = 1024


def hexrgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def font(px):
    try:
        f = ImageFont.truetype(FONTS + "bahnschrift.ttf", px)
        f.set_variation_by_name("Bold")
        return f
    except Exception:
        return ImageFont.truetype(FONTS + "segoeuib.ttf", px)


def square(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    return im.resize((SIZE, SIZE), Image.LANCZOS)


def text_mask(text, px, track):
    """Glyphs drawn one by one with extra tracking; returns a tight L mask."""
    f = font(px)
    gap = round(px * track)
    boxes = [f.getbbox(c) for c in text]
    adv = [f.getlength(c) for c in text]
    width = int(sum(adv) + gap * (len(text) - 1)) + px
    top = min(b[1] for b in boxes)
    bottom = max(b[3] for b in boxes)
    m = Image.new("L", (width, bottom - top + px // 2), 0)
    d = ImageDraw.Draw(m)
    x = px // 4
    for c, a in zip(text, adv):
        d.text((x, -top + px // 8), c, font=f, fill=255)
        x += a + gap
    return m.crop(m.getbbox())


def fit(text, target_w, target_h, track):
    """Largest size whose ink fits within target_w x target_h."""
    lo, hi = 20, 900
    while hi - lo > 1:
        mid = (lo + hi) // 2
        m = text_mask(text, mid, track)
        if m.width <= target_w and m.height <= target_h:
            lo = mid
        else:
            hi = mid
    return text_mask(text, lo, track)


def compose(bg, name, text, color="#FFFFFF", edge="#0B4F55", tint=None, size="word", halo="0", track="0.06"):
    im = square(bg)
    if tint:
        im = ImageChops.multiply(im, Image.new("RGB", im.size, hexrgb(tint)))
    if size == "word":
        m = fit(text, int(SIZE * 0.78), SIZE, float(track))
    else:
        m = fit(text, SIZE, int(SIZE * 0.45), 0)
    im = letter_on(im, m, color, edge, halo)
    out = ART / "raw" / f"{name}-1024.png"
    im.save(out)
    im.resize((512, 512), Image.LANCZOS).save(ART / f"{name}.jpg", quality=90)
    print("wrote", out)


def banner(bg, name, text, color="#FFFFFF", edge="#0B4F55", tint=None, size="word", halo="0", track="0.06"):
    im = Image.open(bg).convert("RGB")
    if tint:
        im = ImageChops.multiply(im, Image.new("RGB", im.size, hexrgb(tint)))
    m = fit(text, int(im.width * 0.62), int(im.height * 0.3), float(track))
    im = letter_on(im, m, color, edge, halo)
    out = ART / "raw" / f"{name}-full.png"
    im.save(out)
    im.resize((1200, round(1200 * im.height / im.width)), Image.LANCZOS).save(ART / f"{name}.jpg", quality=90)
    print("wrote", out)


def letter_on(im, m, color, edge, halo):
    """Shadow, outline and grainy letters for mask m, centred on im."""
    mask = Image.new("L", im.size, 0)
    mask.paste(m, ((im.width - m.width) // 2, (im.height - m.height) // 2))
    ec = hexrgb(edge)
    # optional wide soft glow in the edge colour, to quiet busy rings behind the text
    if float(halo) > 0:
        hl = mask.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(28))
        im.paste(Image.new("RGB", im.size, ec), (0, 0), hl.point(lambda v: int(v * float(halo))))
    # soft drop shadow
    sh = mask.filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.45))
    sh = ImageChops.offset(sh, 0, 6)
    im.paste(Image.new("RGB", im.size, ec), (0, 0), sh)
    # thin translucent outline
    ol = mask.filter(ImageFilter.MaxFilter(5)).point(lambda v: int(v * 0.40))
    im.paste(Image.new("RGB", im.size, ec), (0, 0), ol)
    # letters, with a faint paper grain taken from the painting so they sit on it
    grain = im.convert("L").filter(ImageFilter.GaussianBlur(1))
    grain = ImageChops.subtract(grain, grain.filter(ImageFilter.GaussianBlur(6)), 1, 128)
    grain = grain.point(lambda v: max(0, min(255, 250 + (v - 128) * 2)))
    fill = ImageChops.multiply(Image.new("RGB", im.size, hexrgb(color)), grain.convert("RGB"))
    im.paste(fill, (0, 0), mask)
    return im


def sheet(out, paths):
    pad, rowh = 16, 256 + 32
    W = pad + 256 + pad + 64 + pad + 32 + pad + 360
    im = Image.new("RGB", (W, pad + rowh * len(paths)), (246, 243, 236))
    d = ImageDraw.Draw(im)
    lab = ImageFont.truetype(FONTS + "segoeuib.ttf", 18)
    y = pad
    for p in paths:
        src = Image.open(p).convert("RGB")
        x = pad
        for s in (256, 64, 32):
            im.paste(src.resize((s, s), Image.LANCZOS), (x, y + (256 - s) // 2))
            x += s + pad
        d.text((x, y + 118), Path(p).stem.replace("-1024", ""), font=lab, fill=(40, 40, 40))
        y += rowh
    im.save(out)
    print("wrote", out)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] in ("compose", "banner"):
        opts = {}
        pos = []
        i = 1
        while i < len(a):
            if a[i].startswith("--"):
                opts[a[i][2:]] = a[i + 1]
                i += 2
            else:
                pos.append(a[i])
                i += 1
        (compose if a[0] == "compose" else banner)(*pos, **opts)
    elif a and a[0] == "sheet":
        sheet(a[1], a[2:])
    else:
        print(__doc__)
        sys.exit(1)
