"""Render every icon the app ships from docs/brand/*.svg.

    uv sync --project backend --extra dev        # brings in cairosvg
    uv run --project backend python scripts/make_brand.py

The SVGs are the only source of truth. Their text is already outlined, so
nothing here depends on a font being installed — which is what the old
make_icon.py did, and why it died on machines that lacked Liberation Sans.

Art is chosen by the size a person *sees*, not by pixel count: at 16pt the
three-element mark is mush, so those slots get the arrow instead. Everywhere
else gets the full mark, and macOS gets it from the inset drawing because
Apple's grid expects app art to sit inside its canvas rather than fill it.

The web favicon is the odd one out: it ships as the small mark's SVG, copied
rather than rendered, so the browser keeps a vector at every zoom level. It
lives under the frontend's public/ and so has its own destination flag.
"""

from __future__ import annotations

import argparse
import shutil
import struct
from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "docs" / "brand"
ICONS = ROOT / "src-tauri" / "icons"
FAVICON = ROOT / "frontend" / "public" / "favicon.svg"

SMALL_PT = 16          # at or below this displayed size, the arrow wins

# Tauri's flat PNG set, all from the full mark.
FLAT = {
    "32x32.png": 32, "64x64.png": 64, "128x128.png": 128,
    "128x128@2x.png": 256, "icon.png": 512,
    "Square30x30Logo.png": 30, "Square44x44Logo.png": 44, "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89, "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150, "Square284x284Logo.png": 284, "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

ICO_SIZES = [16, 24, 32, 48, 64, 256]

# (chunk type, pixel size, displayed point size)
ICNS_CHUNKS = [
    ("ic04",   16,   16), ("ic11",   32,   16),
    ("ic05",   32,   32), ("ic12",   64,   32),
    ("ic07",  128,  128), ("ic13",  256,  128),
    ("ic08",  256,  256), ("ic14",  512,  256),
    ("ic09",  512,  512), ("ic10", 1024, 1024),
]


def render(svg: Path, px: int) -> Image.Image:
    buf = BytesIO()
    cairosvg.svg2png(url=str(svg), write_to=buf, output_width=px, output_height=px)
    return Image.open(buf).convert("RGBA")


def dib(im: Image.Image) -> bytes:
    """One ICO entry in BMP form: a 32-bit bottom-up XOR image and an empty AND mask.

    PNG-in-ICO is legal from Vista on, but the shell still renders DIB more
    predictably at the small sizes, and those are the ones that matter here.
    """
    w, h = im.size
    px = im.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))
    row = ((w + 31) // 32) * 4          # 1bpp, padded to 4 bytes
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor), 0, 0, 0, 0)
    return header + bytes(xor) + bytes(row * h)


def write_ico(dest: Path, art: dict[int, Image.Image]) -> None:
    entries, blobs, offset = [], [], 6 + 16 * len(ICO_SIZES)
    for s in ICO_SIZES:
        im = art[s]
        data = _png(im) if s >= 256 else dib(im)
        entries.append(struct.pack("<BBBBHHII", 0 if s >= 256 else s, 0 if s >= 256 else s,
                                   0, 0, 1, 32, len(data), offset))
        blobs.append(data)
        offset += len(data)
    dest.write_bytes(struct.pack("<HHH", 0, 1, len(ICO_SIZES)) + b"".join(entries) + b"".join(blobs))


def _png(im: Image.Image) -> bytes:
    b = BytesIO()
    im.save(b, format="PNG", optimize=True)
    return b.getvalue()


def write_icns(dest: Path, art: dict[str, Image.Image]) -> None:
    """icns is a magic word, a length, then typed chunks — PNG payloads throughout.

    Keyed by chunk type, never by pixel size: ic11 and ic05 are both 32x32 images
    but are shown at 16pt and 32pt, so they hold different drawings.
    """
    body = b""
    for kind, _px, _pt in ICNS_CHUNKS:
        data = _png(art[kind])
        body += kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    dest.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ICONS)
    ap.add_argument("--favicon", type=Path, default=FAVICON,
                    help="where the web favicon SVG is copied")
    ap.add_argument("--no-favicon", help="leave the web favicon alone")
    ap.add_argument("--sources", action="store_true", help="also keep the 1024px source PNGs")
    args = ap.parse_args()

    full, small, macos = BRAND / "mark.svg", BRAND / "mark-small.svg", BRAND / "mark-macos.svg"
    for p in (full, small, macos):
        if not p.exists():
            raise SystemExit(f"missing {p.relative_to(ROOT)} — the SVGs are the source of truth")

    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    for name, px in FLAT.items():
        render(full, px).save(out / name)

    write_ico(out / "icon.ico", {s: render(small if s <= SMALL_PT else full, s) for s in ICO_SIZES})

    write_icns(out / "icon.icns", {
        kind: render(small if pt <= SMALL_PT else macos, px)
        for kind, px, pt in ICNS_CHUNKS
    })

    if not args.no_favicon:
        args.favicon.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(small, args.favicon)

    if args.sources:
        render(full, 1024).save(out / "source.png")
        render(small, 1024).save(out / "source-small.png")
        render(macos, 1024).save(out / "source-macos.png")

    print(f"wrote {len(FLAT)} png + icon.ico + icon.icns -> {out}")
    if not args.no_favicon:
        print(f"copied mark-small.svg -> {args.favicon.relative_to(ROOT)}")
    print(f"  arrow art at {SMALL_PT}pt and below; full mark above; macOS from the inset drawing")


if __name__ == "__main__":
    main()
