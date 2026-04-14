#!/usr/bin/env python3
"""Generate the auriga-cli brand icon (Celestial Compass).

Dev-only generator. The font sits next to this script under SIL OFL; the
output PNG is written into the shipped hook directory at
.claude/hooks/notify/icon.png. To regenerate:

    python3 tools/notify-icon/generate-icon.py

See icon.design.md for the design philosophy.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent.parent
FONT = ROOT / "JetBrainsMono-Bold.ttf"
OUT = REPO_ROOT / ".claude" / "hooks" / "notify" / "icon.png"

RENDER = 1024
FINAL = 512

INDIGO = (0x2C, 0x3E, 0x6B)
NIGHT = (0x10, 0x18, 0x30)
GOLD = (0xD4, 0xA8, 0x4B)
LETTER = (255, 240, 200)
CAPELLA = (255, 230, 160)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def night_sky_column(size: int) -> Image.Image:
    col = Image.new("RGB", (1, size))
    px = col.load()
    for y in range(size):
        t = y / (size - 1)
        if t < 0.15:
            px[0, y] = lerp(GOLD, INDIGO, t / 0.15)
        else:
            px[0, y] = lerp(INDIGO, NIGHT, (t - 0.15) / 0.85)
    return col.resize((size, size), Image.NEAREST).convert("RGBA")


def draw_capella(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float):
    points = []
    for i in range(10):
        angle = math.pi / 2 + i * math.pi / 5
        radius = r if i % 2 == 0 else r * 0.42
        points.append((cx + radius * math.cos(angle), cy - radius * math.sin(angle)))
    draw.polygon(points, fill=(*CAPELLA, 255))


def main():
    if not FONT.exists():
        raise SystemExit(f"font missing: {FONT}")

    bg = night_sky_column(RENDER)
    layer = Image.new("RGBA", (RENDER, RENDER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    font = ImageFont.truetype(str(FONT), int(RENDER * 0.72))
    bbox = draw.textbbox((0, 0), "A", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (RENDER - tw) // 2 - bbox[0]
    y = (RENDER - th) // 2 - bbox[1] - int(RENDER * 0.02)

    shadow = Image.new("RGBA", (RENDER, RENDER), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    off = max(1, RENDER // 110)
    sd.text((x + off, y + off), "A", font=font, fill=(0, 0, 0, 130))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=RENDER // 256))
    layer = Image.alpha_composite(layer, shadow)

    draw = ImageDraw.Draw(layer)
    draw.text((x, y), "A", font=font, fill=(*LETTER, 255))
    draw_capella(draw, RENDER * 0.82, RENDER * 0.18, RENDER * 0.04)

    composed = Image.alpha_composite(bg, layer).convert("RGB")
    composed = composed.resize((FINAL, FINAL), Image.LANCZOS)
    composed.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({FINAL}x{FINAL})")


if __name__ == "__main__":
    main()
