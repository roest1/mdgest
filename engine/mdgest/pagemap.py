"""What is on each page — lines of text and pictures, with where they sit.

The PDF's text layer *is* the text. It is read exactly, deterministically,
and the same way every time, which is what lets the output be measured
against the page rather than against someone's earlier reading of it.

Ported from mdgest v1 (`pagemap.read`) and extended: every line now also
carries its font size and whether it is set italic, because those — with
bold — are what the structure pass uses to tell a heading from a paragraph
without a layout model.

Coordinates everywhere in this package are **PDF points, origin bottom-left**
(what pdfium reports). The web client flips y when it draws.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from statistics import median


@dataclass(frozen=True)
class Box:
    left: float
    bottom: float
    right: float
    top: float

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.top - self.bottom

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    def overlap(self, other: Box) -> float:
        w = min(self.right, other.right) - max(self.left, other.left)
        h = min(self.top, other.top) - max(self.bottom, other.bottom)
        return max(0.0, w) * max(0.0, h)

    def union(self, other: Box) -> Box:
        return Box(
            min(self.left, other.left),
            min(self.bottom, other.bottom),
            max(self.right, other.right),
            max(self.top, other.top),
        )

    def as_list(self) -> list[float]:
        return [
            round(self.left, 2),
            round(self.bottom, 2),
            round(self.right, 2),
            round(self.top, 2),
        ]


@dataclass
class Line:
    text: str
    box: Box
    page: int
    size: float = 0.0
    bold: bool = False
    italic: bool = False
    font: str = ""

    def to_json(self) -> dict:
        return {
            "text": self.text,
            "bbox": self.box.as_list(),
            "size": round(self.size, 1),
            "bold": self.bold,
            "italic": self.italic,
            "font": self.font,
        }


@dataclass
class Picture:
    box: Box
    page: int
    index: int  # order on the page, by drawing order
    path: str = ""  # relative asset path once extracted
    px_width: int = 0
    px_height: int = 0

    def to_json(self) -> dict:
        return {
            "bbox": self.box.as_list(),
            "path": self.path,
            "px": [self.px_width, self.px_height],
        }


@dataclass
class Page:
    number: int
    width: float
    height: float
    lines: list[Line] = field(default_factory=list)
    pictures: list[Picture] = field(default_factory=list)


@dataclass
class PageMap:
    source: Path
    pages: list[Page] = field(default_factory=list)


_WHITESPACE = re.compile(r"\s+")
BASELINE_OVERLAP = 0.5
JOIN_GAP_RATIO = 0.6
BULLETS = "■□▪▫●○◦•‣⁃◆◇❏❑❒❘❙❚❖➥-–—·*"
BULLET_GAP_RATIO = 3.0
MARKER_RE = re.compile(r"^\(?(?:\d{1,3}|[ivxlcdm]{1,5}|[a-z])[.)]$", re.IGNORECASE)
BOLD_WEIGHT = 600
PROBES = (0.15, 0.3, 0.5, 0.7, 0.85)
FXFONT_ITALIC = 1 << 6


def is_bullet(text: str) -> bool:
    return bool(text) and not text.strip(BULLETS + " ")


def is_marker(text: str) -> bool:
    text = text.strip()
    return is_bullet(text) or bool(MARKER_RE.match(text))


def one_baseline(span: tuple[float, float], box: Box) -> bool:
    bottom, top = span
    middle = (box.top + box.bottom) / 2
    overlap = min(top, box.top) - max(bottom, box.bottom)
    return bottom <= middle <= top and overlap >= BASELINE_OVERLAP * box.height


def _baselines(runs: list[Line]) -> list[list[Line]]:
    bands: list[list[Line]] = []
    span = (0.0, 0.0)
    for run in sorted(runs, key=lambda r: (-r.box.top, r.box.left)):
        if bands and one_baseline(span, run.box):
            bands[-1].append(run)
            span = (min(span[0], run.box.bottom), max(span[1], run.box.top))
        else:
            bands.append([run])
            span = (run.box.bottom, run.box.top)
    return bands


def _neighbours(band: list[Line]) -> list[list[Line]]:
    groups: list[list[Line]] = []
    edge, previous = 0.0, None
    for run in sorted(band, key=lambda r: r.box.left):
        ratio = BULLET_GAP_RATIO if previous and is_marker(previous.text) else JOIN_GAP_RATIO
        reach = ratio * max(previous.box.height if previous else 0.0, run.box.height)
        if groups and run.box.left - edge <= reach:
            groups[-1].append(run)
            edge = max(edge, run.box.right)
        else:
            groups.append([run])
            edge = run.box.right
        previous = run
    return groups


def join_runs(runs: list[Line], reread: Callable[[Box], str]) -> list[Line]:
    """Rejoin the pieces a PDF draws one line of text in (see v1 for the why)."""
    joined: list[Line] = []
    for band in _baselines(runs):
        for group in _neighbours(band):
            if len(group) == 1:
                joined.append(group[0])
                continue
            box = Box(
                min(r.box.left for r in group),
                min(r.box.bottom for r in group),
                max(r.box.right for r in group),
                max(r.box.top for r in group),
            )
            text = _WHITESPACE.sub(" ", reread(box)).strip()
            joined.append(
                Line(text=text or " ".join(r.text for r in group), box=box, page=group[0].page)
            )
    return joined


def _style(textpage, box: Box) -> tuple[float, bool, bool, str]:
    """Font size / bold / italic / font name of a line, sampled at several points."""
    import ctypes

    import pypdfium2.raw as pdfium_c

    middle = (box.top + box.bottom) / 2
    sizes: list[float] = []
    weights: list[int] = []
    italics: list[bool] = []
    fonts: list[str] = []
    for fraction in PROBES:
        index = textpage.get_index(box.left + box.width * fraction, middle, 1.0, 1.0)
        if index is None or index < 0:
            continue
        size = pdfium_c.FPDFText_GetFontSize(textpage, index)
        if size < 3:
            # Some PDFs set every font at 1pt and scale by the text matrix; the
            # nominal size says nothing then, but the glyph's loose box (its em
            # box on the page) still does — about 1.3x the effective size.
            rect = pdfium_c.FS_RECTF()
            if pdfium_c.FPDFText_GetLooseCharBox(textpage, index, ctypes.byref(rect)):
                size = abs(rect.top - rect.bottom) / 1.3
        if size > 0:
            sizes.append(size)
        weight = pdfium_c.FPDFText_GetFontWeight(textpage, index)
        buf = ctypes.create_string_buffer(256)
        flags = ctypes.c_int()
        pdfium_c.FPDFText_GetFontInfo(textpage, index, buf, 256, ctypes.byref(flags))
        name = buf.value.decode("latin-1", "replace")
        if "+" in name:
            name = name.split("+", 1)[1]
        fonts.append(name)
        lname = name.lower()
        bold = weight >= BOLD_WEIGHT or "bold" in lname or "black" in lname or "heavy" in lname
        weights.append(1 if bold else 0)
        italics.append(bool(flags.value & FXFONT_ITALIC) or "italic" in lname or "oblique" in lname)
    if not sizes:
        return (0.0, False, False, "")
    bold = sum(weights) * 2 > len(weights)
    italic = sum(italics) * 2 > len(italics)
    font = max(set(fonts), key=fonts.count) if fonts else ""
    return (float(median(sizes)), bold, italic, font)


def read(path: Path, assets_dir: Path | None = None) -> PageMap:
    """Read every line and picture on every page."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    doc = pdfium.PdfDocument(str(path))
    try:
        pages: list[Page] = []
        for number, page in enumerate(doc, start=1):
            width, height = page.get_size()
            entry = Page(number=number, width=width, height=height)
            textpage = page.get_textpage()

            def reread(box: Box, textpage=textpage) -> str:
                return textpage.get_text_bounded(box.left, box.bottom, box.right, box.top)

            runs: list[Line] = []
            spanning: list[Line] = []
            for index in range(textpage.count_rects()):
                left, bottom, right, top = textpage.get_rect(index)
                box = Box(left, bottom, right, top)
                raw = textpage.get_text_bounded(left, bottom, right, top)
                pieces = [
                    t for piece in raw.splitlines() if (t := _WHITESPACE.sub(" ", piece).strip())
                ]
                if len(pieces) > 1:
                    spanning.extend(Line(text=t, box=box, page=number) for t in pieces)
                elif pieces:
                    runs.append(Line(text=pieces[0], box=box, page=number))

            lines = join_runs(runs, reread) + spanning
            for line in lines:
                line.size, line.bold, line.italic, line.font = _style(textpage, line.box)
            entry.lines = sorted(lines, key=lambda l: (-l.box.top, l.box.left))

            # Pictures: every image object, with its drawn bounds.
            pic_index = 0
            for obj in page.get_objects():
                if obj.type != pdfium_c.FPDF_PAGEOBJ_IMAGE:
                    continue
                try:
                    l, b, r, t = obj.get_bounds()
                except Exception:
                    continue
                box = Box(l, b, r, t)
                if box.width < 4 or box.height < 4:
                    continue
                pic = Picture(box=box, page=number, index=pic_index)
                if assets_dir is not None:
                    try:
                        bitmap = obj.get_bitmap(render=True)
                        pil = bitmap.to_pil()
                        pic.px_width, pic.px_height = pil.size
                        # Tiny or degenerate bitmaps are decoration, not figures.
                        if pil.size[0] * pil.size[1] >= 64:
                            assets_dir.mkdir(parents=True, exist_ok=True)
                            name = f"p{number}-i{pic_index}.png"
                            pil.save(assets_dir / name)
                            pic.path = name
                    except Exception:
                        pass
                entry.pictures.append(pic)
                pic_index += 1
            pages.append(entry)
        return PageMap(source=path, pages=pages)
    finally:
        doc.close()


def to_json(pm: PageMap) -> dict:
    return {
        "source": str(pm.source),
        "pages": [
            {
                "n": p.number,
                "width": round(p.width, 2),
                "height": round(p.height, 2),
                "lines": [l.to_json() for l in p.lines],
                "pictures": [pic.to_json() for pic in p.pictures],
            }
            for p in pm.pages
        ],
    }


__all__ = [
    "Box",
    "Line",
    "Page",
    "PageMap",
    "Picture",
    "asdict",
    "is_bullet",
    "is_marker",
    "read",
    "to_json",
]
