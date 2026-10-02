# Spots: push the paper to pure white, crop to the painting, pad to a square. Reads raw/spot-*.png, writes spot-*.jpg beside this file.
import glob, os
from PIL import Image, ImageChops

here = os.path.dirname(os.path.abspath(__file__))
for src in sorted(glob.glob(os.path.join(here, "raw", "spot-*.png"))):
    im = Image.open(src).convert("RGB")
    # White point: anything at or above 244 becomes 255, the rest scales.
    im = im.point(lambda v: min(255, round(v * 255 / 244)))
    # Bounding box of everything that is not (nearly) white.
    diff = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255))).convert("L").point(lambda v: 255 if v > 14 else 0)
    box = diff.getbbox() or (0, 0, *im.size)
    w, h = box[2] - box[0], box[3] - box[1]
    side = int(max(w, h) * 1.10)
    out = Image.new("RGB", (side, side), (255, 255, 255))
    out.paste(im.crop(box), ((side - w) // 2, (side - h) // 2))
    out = out.resize((720, 720), Image.LANCZOS)
    name = os.path.splitext(os.path.basename(src))[0]
    out.save(os.path.join(here, name + ".jpg"), quality=90)
    print(name, box, im.size)
