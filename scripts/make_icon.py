"""Draw the app icon: the header's "md" badge, at icon size.

    uv run --project engine python scripts/make_icon.py
    bunx tauri icon src-tauri/icons/source.png -o src-tauri/icons   (from web/)

A rounded square, brand-green fading to emerald, "md" in near-black — the same
mark the UI shows in its header.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
GREEN = (108, 192, 74)  # --color-brand-green
EMERALD = (4, 120, 87)  # tailwind emerald-700
INK = (13, 17, 12)

FONTS = [
    "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf",
    "/usr/share/fonts/google-droid-sans-fonts/DroidSans-Bold.ttf",
    "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def main() -> None:
    mid = tuple((a + b) // 2 for a, b in zip(GREEN, EMERALD))
    grad = Image.new("RGB", (2, 2))
    grad.putdata([GREEN, mid, mid, EMERALD])  # diagonal: green top-left, emerald bottom-right
    img = grad.resize((SIZE, SIZE), Image.BICUBIC).convert("RGBA")

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=SIZE // 5, fill=255)
    img.putalpha(mask)

    font_path = next((f for f in FONTS if Path(f).exists()), None)
    if not font_path:
        raise SystemExit("no usable bold font found — add one to FONTS")
    font = ImageFont.truetype(font_path, int(SIZE * 0.42))
    draw = ImageDraw.Draw(img)
    left, top, right, bottom = draw.textbbox((0, 0), "md", font=font)
    draw.text(
        ((SIZE - (right - left)) / 2 - left, (SIZE - (bottom - top)) / 2 - top),
        "md",
        font=font,
        fill=INK,
    )

    out = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "source.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
