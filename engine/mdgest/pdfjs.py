"""The same page map, read by pdf.js instead of pdfium — for the browser build.

`pagemap.read` needs a binary pdfium, which has no wheel that can be shipped to
a browser. pdf.js has no such problem, so the browser build reads with pdf.js
and hands the result here. Everything downstream — `structure`, `ops`, `emit`,
`fidelity` — is unchanged and cannot tell which reader ran.

The two readers do not report the same things, and the differences are not
noise:

- **Boxes.** pdfium reports *ink* bounds, so its box height depends on which
  glyphs the line contains: measured over the fixtures and two real documents,
  one 10pt face ranges 0.62–1.14 of its size depending on ascenders and
  descenders. pdf.js reports the text matrix, which is flat per font. A flat
  box is not a smaller error than a varying one, it is a differently shaped
  one, and `structure` measures gutters in `median_height` — so feeding it a
  uniformly taller box moves every layout decision a little and tips some. The
  fix is to approximate the ink: the string itself says whether the line has
  ascenders and whether it has descenders, which is most of what pdfium is
  measuring.

- **Weight and slant.** pdf.js decides both by regex on the font name
  (`pdf.worker.mjs`: `this.bold = /bold/i.test(fontName)`), and never reads
  /Flags ForceBold or /ItalicAngle even though it parses them. pdfium reads the
  descriptor, so a subset face named `ABCDEF+f-1-0` is bold to pdfium and plain
  to pdf.js -- and subset names like that are the common case, not a corner.

  So the name is not the evidence here. `scripts/dump_pdfjs.mjs` reads the
  font's own OS/2 and head tables out of the face pdf.js hands over, and
  `_weight_of` / `_slant_of` decide from those, falling back to the name only
  when a font carries no tables at all. Measured on a real document, that is
  the difference between reading `Roboto,Bold` as bold because of its name and
  reading it as bold because usWeightClass is 700.

  What it still cannot see is a face that is neither embedded nor one of the
  standard 14: pdf.js ships no font data for one, so its /FontDescriptor is out
  of reach and only the name is left. `doc-c.pdf` pins exactly that, and
  `tests/test_reader_conformance.py` records the four lines it costs.

- **Text.** pdfium re-reads a union box through `FPDFText_GetBoundedText` and
  re-derives the spacing; here the item strings are concatenated and the gap
  decides. That is the one place a reader swap can reach the fidelity gate, so
  a trailing hyphen never takes a space after it.

  It reaches further than that, and not in this module's gift to fix: pdfium
  emits a raw \x02 for a soft hyphen at a line end, which whitespace
  normalization then eats, so `early-` and `stage` join as `early stage` and
  the hyphen is gone. This reader keeps it, so the same paragraph joins as
  `early- stage`. Neither is `early-stage`. The word is broken across two
  *lines*, so closing it up is a decision for whatever joins lines into a
  paragraph, and making it would move the goldens -- see
  `tests/test_reader_conformance.py`, which records the difference rather than
  pretending either side is right.
"""

from __future__ import annotations

from pathlib import Path

from .pagemap import _WHITESPACE, Box, Line, Page, PageMap, join_runs

#: Fractions of the font size, measured against pdfium's ink boxes over the
#: fixtures plus two real documents (a 14-page report and a one-page sheet).
#: Sweeping these is what took the whole-corpus markdown disagreement from 150
#: lines to 9; `tests/test_reader_conformance.py` is what stops them drifting.
CAP_HEIGHT = 0.70
X_HEIGHT = 0.50
DESCENDER = -0.22

#: Characters that put ink above the x-height, and below the baseline. Only
#: their presence matters, so this is a set membership test and not a metric.
TALL = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789bdfhklt|/\\()[]{}!?\"'*#$&@£€%")
DESCENDING = set("gjpqy()[]{}/|\\,;_@JQ")
XHEIGHT_ONLY = set("acemnorsuvwxz")

#: A dingbat's glyph fills a fraction of its em box, so the em box overstates
#: it by about double. These faces carry bullets, which `structure` positions
#: list items by, so the overstatement is not harmless.
SYMBOLIC = ("wingding", "dingbat", "symbol", "webding")

#: Read off the font's own tables. `usWeightClass` is only believed at 600 or
#: above because pdf.js synthesizes an OS/2 with a hardcoded 500 for any face
#: it converts from CFF/Type1 -- 500 means "no opinion", not "medium".
BOLD_WEIGHT = 600
FS_ITALIC, FS_BOLD = 1 << 0, 1 << 5
MAC_BOLD, MAC_ITALIC = 1 << 0, 1 << 1

#: The fallback, for a face that carries no tables. `-bd` and `,bold` are how
#: subset and CSS-ish names spell it; `black`/`heavy` are weights above bold.
BOLD_NAMES = ("bold", "black", "heavy", "semibold", "demibold", "-bd", ",bold")
ITALIC_NAMES = ("italic", "oblique", "-it", ",italic")


def _weight_of(item: dict) -> bool:
    """Is this line bold? The font's tables first, its name only if it has none."""
    font = item.get("font") or {}
    fs, mac, weight = font.get("fsSelection"), font.get("macStyle"), font.get("weight")
    if fs is not None and fs & FS_BOLD:
        return True
    if mac is not None and mac & MAC_BOLD:
        return True
    if weight is not None and weight >= BOLD_WEIGHT:
        return True
    if fs or mac or (weight is not None and weight != 500):
        return False  # the tables are present and say no; the name cannot overrule
    low = _face(item).lower()
    return any(k in low for k in BOLD_NAMES)


def _slant_of(item: dict) -> bool:
    """Is this line italic? Same order of evidence as `_weight_of`."""
    font = item.get("font") or {}
    fs, mac, angle = font.get("fsSelection"), font.get("macStyle"), font.get("italicAngle")
    if fs is not None and fs & FS_ITALIC:
        return True
    if mac is not None and mac & MAC_ITALIC:
        return True
    if angle:
        return True
    if fs or mac:
        return False
    low = _face(item).lower()
    return any(k in low for k in ITALIC_NAMES)


def _face(item: dict) -> str:
    """The font's name with any subset prefix stripped, as pdfium reports it."""
    name = (item.get("font") or {}).get("name") or ""
    return name.split("+", 1)[1] if "+" in name else name


def _size(item: dict) -> float:
    """`height` is the size under the text matrix; `transform[0]` when it is 0."""
    return float(item["height"] or abs(item["transform"][0]))


def item_box(item: dict) -> Box:
    """Where the ink is, approximated from the characters that are in the line."""
    x, baseline = item["transform"][4], item["transform"][5]
    size = _size(item)
    chars = set(item["str"])
    face = _face(item).lower()
    if any(s in face for s in SYMBOLIC) or not chars & (TALL | XHEIGHT_ONLY):
        # No letters to reason about: fall back to half the em box, centred.
        font = item.get("font") or {}
        ascent, descent = font.get("ascent") or 0.9, font.get("descent") or -0.21
        middle = baseline + (ascent + descent) / 2 * size
        reach = (ascent - descent) * size / 4
        return Box(x, middle - reach, x + item["width"], middle + reach)
    top = (CAP_HEIGHT if chars & TALL else X_HEIGHT) * size
    bottom = DESCENDER * size if chars & DESCENDING else 0.0
    return Box(x, baseline + bottom, x + item["width"], baseline + top)


def _reread(pairs: list[tuple[dict, Box]]):
    """What `FPDFText_GetBoundedText` does, over the items instead of the page.

    `join_runs` hands back a union box and asks what it says; pdfium re-reads
    the page there, and here the items inside it are concatenated in reading
    order. A gap wide enough to be a space becomes one — except after a hyphen,
    which is a word broken across the run and must close up.
    """

    def reread(box: Box) -> str:
        inside = []
        for item, bounds in pairs:
            cx = (bounds.left + bounds.right) / 2
            cy = (bounds.bottom + bounds.top) / 2
            if box.left - 0.5 <= cx <= box.right + 0.5 and box.bottom - 0.5 <= cy <= box.top + 0.5:
                inside.append((bounds.left, item["str"], bounds))
        inside.sort()
        out: list[str] = []
        edge: float | None = None
        for left, text, bounds in inside:
            if edge is not None and left - edge > 0.15 * bounds.height and not out[-1].endswith("-"):
                out.append(" ")
            out.append(text)
            edge = bounds.right
        return _WHITESPACE.sub(" ", "".join(out)).strip()

    return reread


def read(dump: dict) -> PageMap:
    """A `PageMap` from what `scripts/dump_pdfjs.mjs` produced for a document."""
    pages: list[Page] = []
    for raw in dump["pages"]:
        entry = Page(number=raw["n"], width=raw["width"], height=raw["height"])
        # pdf.js emits zero-width empty items to mark line ends; they carry no
        # ink and would band with whatever sits at their baseline.
        pairs = [(it, item_box(it)) for it in raw["items"] if it["str"].strip()]
        runs = [
            Line(text=_WHITESPACE.sub(" ", it["str"]).strip(), box=box, page=raw["n"])
            for it, box in pairs
        ]
        lines = join_runs(runs, _reread(pairs))
        for line in lines:
            item, overlap = None, 0.0
            for candidate, box in pairs:
                area = line.box.overlap(box)
                if area > overlap:
                    item, overlap = candidate, area
            if item is None:
                continue
            face = _face(item)
            line.size = _size(item)
            line.bold = _weight_of(item)
            line.italic = _slant_of(item)
            line.font = face
        entry.lines = sorted(lines, key=lambda l: (-l.box.top, l.box.left))
        pages.append(entry)
    return PageMap(source=Path(dump["source"]), pages=pages)


__all__ = ["item_box", "read"]
