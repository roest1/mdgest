"""Page images, rendered on demand and cached."""

from __future__ import annotations

import threading
from pathlib import Path

#: pdfium is not thread-safe; every call into it in this process goes through here.
PDFIUM_LOCK = threading.RLock()

PAGE_SCALE = 1.5  # 108 dpi: legible at full width, a quarter the bytes of 3x
THUMB_SCALE = 0.3


def render_page(
    pdf: Path, out_dir: Path, number: int, scale: float = PAGE_SCALE, name: str = "page"
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{name}-{number:03d}.png"
    if target.exists():
        return target
    import pypdfium2 as pdfium

    with PDFIUM_LOCK:
        doc = pdfium.PdfDocument(str(pdf))
        try:
            page = doc[number - 1]
            bitmap = page.render(scale=scale)
            tmp = target.with_suffix(".tmp.png")
            bitmap.to_pil().save(tmp)
            tmp.replace(target)
        finally:
            doc.close()
    return target


def render_thumb(pdf: Path, out_dir: Path, number: int) -> Path:
    return render_page(pdf, out_dir, number, scale=THUMB_SCALE, name="thumb")
