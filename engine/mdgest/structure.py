"""From lines on a page to blocks in reading order, each with a role.

Pure functions over a `pagemap.PageMap`. No model: the structure is read off
the page the way a person reads it in a second — what is larger or bolder is
a heading, what sits behind a bullet is an item, what sits further right is
nested deeper, what shares a column is read down before across.

Everything here is a *default*. The UI and CLI override any of it per block
(`edits.py`), and the override is what is precious; this is regenerable.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from .pagemap import BULLETS, Box, Line, Page, PageMap

ROLES = ("heading", "para", "bullet", "numbered", "alpha", "roman", "image", "insert")

BULLET_RE = re.compile(rf"^[{re.escape(BULLETS)}]\s*")
NUMBER_RE = re.compile(r"^\(?(\d{1,3})[.)]\s+")
ALPHA_RE = re.compile(r"^\(?([a-zA-Z])[.)]\s+")
ROMAN_RE = re.compile(r"^\(?((?:x{0,3})(?:ix|iv|v?i{0,3}))[.)]\s+", re.IGNORECASE)

SIZE_RATIO = 1.10  # larger than body by this much reads as a heading
MAX_HEADING_CHARS = 90
BOLD_SATURATION = 0.35  # when more text than this is bold, bold means nothing
LINE_GAP_RATIO = 1.1  # lines closer than this (× line height) are one paragraph
COLUMN_GAP_RATIO = 0.6  # an x-gap wider than this (× median line height) is a gutter
MIN_COLUMN_GAP = 3.0  # ...and at least this many points
BAND_GAP_RATIO = 0.6  # a y-gap wider than this (× median line height) splits bands


@dataclass
class Block:
    id: str
    kind: str  # text | image
    page: int
    box: Box
    lines: list[int] = field(default_factory=list)  # indexes into page.lines
    text: str = ""
    role: str = "para"
    level: int = 0  # heading level 1..6
    depth: int = 0  # list nesting depth
    bold: bool = False
    italic: bool = False
    marker: str = ""  # the printed marker ("1.", "a)", "•") if any
    size: float = 0.0
    font: str = ""
    picture: int = -1  # index into page.pictures for images

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "page": self.page,
            "bbox": self.box.as_list(),
            "lines": self.lines,
            "text": self.text,
            "role": self.role,
            "level": self.level,
            "depth": self.depth,
            "bold": self.bold,
            "italic": self.italic,
            "marker": self.marker,
            "size": round(self.size, 1),
            "font": self.font,
            "picture": self.picture,
        }


# ---------------------------------------------------------------- typography


def body_size(pm: PageMap) -> float:
    weights: Counter[float] = Counter()
    for page in pm.pages:
        for line in page.lines:
            if line.size > 0:
                weights[round(line.size, 1)] += len(line.text)
    return max(weights, key=lambda s: weights[s]) if weights else 0.0


def bold_fraction(pm: PageMap) -> float:
    total = bold = 0
    for page in pm.pages:
        for line in page.lines:
            total += len(line.text)
            if line.bold:
                bold += len(line.text)
    return bold / total if total else 0.0


def marker_of(text: str) -> tuple[str, str, str]:
    """(role, marker, rest) for a line that starts with a list marker, else ("", "", text)."""
    m = BULLET_RE.match(text)
    if m and m.end() < len(text):
        return "bullet", m.group(0).strip(), text[m.end() :].strip()
    m = NUMBER_RE.match(text)
    if m:
        return "numbered", m.group(0).strip(), text[m.end() :].strip()
    m = ROMAN_RE.match(text)
    if m and m.group(1):
        return "roman", m.group(0).strip(), text[m.end() :].strip()
    m = ALPHA_RE.match(text)
    if m:
        return "alpha", m.group(0).strip(), text[m.end() :].strip()
    return "", "", text


def _is_heading(line: Line, body: float, bold_matters: bool) -> bool:
    text = line.text.strip()
    if not text or len(text) > MAX_HEADING_CHARS or line.size <= 0 or body <= 0:
        return False
    if marker_of(text)[0]:
        return False
    larger = line.size >= body * SIZE_RATIO
    emphasized = (
        bold_matters and line.bold and line.size >= body and not text.endswith((".", ",", ";"))
    )
    return larger or emphasized


# ---------------------------------------------------------------- reading order (XY-cut)


def _median_height(boxes: list[Box]) -> float:
    hs = sorted(b.height for b in boxes if b.height > 0)
    return hs[len(hs) // 2] if hs else 10.0


def _gaps(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Empty stretches between a set of 1-D intervals."""
    out: list[tuple[float, float]] = []
    edge = None
    for lo, hi in sorted(intervals):
        if edge is not None and lo > edge:
            out.append((edge, lo))
        edge = hi if edge is None else max(edge, hi)
    return out


def xy_cut(items: list[tuple[int, Box]], unit: float) -> list[list[int]]:
    """Reading order of boxes as leaf groups: bands top to bottom, columns left to
    right, recursively. Each leaf is one column-band of the page; flatten for
    the order, keep the leaves to reason about indentation within a column.

    Columns win over bands when a gutter exists, because a paragraph break
    that happens to line up across two columns is not a reason to read across.
    """
    if len(items) <= 1:
        return [[i for i, _ in items]] if items else []
    xgaps = [
        g
        for g in _gaps([(b.left, b.right) for _, b in items])
        if g[1] - g[0] >= max(COLUMN_GAP_RATIO * unit, MIN_COLUMN_GAP)
    ]
    if xgaps:
        cuts = sorted((g[0] + g[1]) / 2 for g in xgaps)
        groups: list[list[tuple[int, Box]]] = [[] for _ in range(len(cuts) + 1)]
        for item in items:
            cx = (item[1].left + item[1].right) / 2
            k = sum(1 for c in cuts if cx > c)
            groups[k].append(item)
        out: list[list[int]] = []
        for g in groups:
            out.extend(xy_cut(g, unit))
        return out
    ygaps = [
        g
        for g in _gaps([(b.bottom, b.top) for _, b in items])
        if g[1] - g[0] >= BAND_GAP_RATIO * unit
    ]
    if ygaps:
        cuts = sorted(((g[0] + g[1]) / 2 for g in ygaps), reverse=True)
        groups = [[] for _ in range(len(cuts) + 1)]
        for item in items:
            cy = (item[1].top + item[1].bottom) / 2
            k = sum(1 for c in cuts if cy < c)
            groups[k].append(item)
        out = []
        for g in groups:
            out.extend(xy_cut(g, unit))
        return out
    return [[i for i, _ in sorted(items, key=lambda it: (-it[1].top, it[1].left))]]


# ---------------------------------------------------------------- blocks

INDENT_TOLERANCE = 3


def _cluster(values: list[int]) -> list[int]:
    """Distinct indents, with anything within INDENT_TOLERANCE of a smaller one folded in."""
    out: list[int] = []
    for v in sorted(set(values)):
        if not out or v - out[-1] > INDENT_TOLERANCE:
            out.append(v)
    return out


def _same_style(a: Line, b: Line) -> bool:
    return abs(a.size - b.size) <= 0.6 and a.bold == b.bold


def _group_lines(page: Page, order: list[int], body: float, bold_matters: bool) -> list[list[int]]:
    """Consecutive lines (in reading order) that make one block."""
    groups: list[list[int]] = []
    prev: Line | None = None
    prev_heading = False
    prev_marker = ""
    for idx in order:
        line = page.lines[idx]
        heading = _is_heading(line, body, bold_matters)
        role, _, _ = marker_of(line.text)
        start_new = True
        if prev is not None and groups:
            unit = max(prev.box.height, line.box.height, 1.0)
            gap = prev.box.bottom - line.box.top
            close = -0.5 * unit <= gap <= LINE_GAP_RATIO * unit
            overlap_x = min(prev.box.right, line.box.right) - max(prev.box.left, line.box.left) > 0
            if close and overlap_x and _same_style(prev, line) and not role:
                if heading and prev_heading:
                    start_new = False  # a heading wrapped onto two lines
                elif not heading and not prev_heading:
                    # a wrapped paragraph or list item: continuation starts at or
                    # right of the previous text's left edge (hanging indent)
                    first = page.lines[groups[-1][0]]
                    if prev_marker:
                        start_new = False
                    else:
                        start_new = (
                            abs(line.box.left - first.box.left) > 0.9 * unit
                            and line.box.left < first.box.left
                        )
        if start_new:
            groups.append([idx])
            prev_marker = role
        else:
            groups[-1].append(idx)
        prev, prev_heading = line, heading
    return groups


def analyze(pm: PageMap) -> dict:
    """The whole document as blocks with roles, per page, plus a default order."""
    body = body_size(pm)
    bold_matters = bold_fraction(pm) < BOLD_SATURATION
    pages_out: list[dict] = []
    heading_sizes: Counter[float] = Counter()
    all_blocks: list[list[Block]] = []

    for page in pm.pages:
        unit = _median_height([l.box for l in page.lines]) if page.lines else 10.0
        leaves = xy_cut([(i, l.box) for i, l in enumerate(page.lines)], unit)
        order = [i for leaf in leaves for i in leaf]
        groups = _group_lines(page, order, body, bold_matters)
        blocks: list[Block] = []
        for gi, group in enumerate(groups):
            lines = [page.lines[i] for i in group]
            box = lines[0].box
            for l in lines[1:]:
                box = box.union(l.box)
            first = lines[0]
            role, marker, rest = marker_of(first.text)
            texts = [rest] + [l.text for l in lines[1:]]
            text = " ".join(t for t in texts if t).strip()
            blk = Block(
                id=f"p{page.number}b{gi}",
                kind="text",
                page=page.number,
                box=box,
                lines=group,
                text=text,
                size=first.size,
                font=first.font,
                bold=all(l.bold for l in lines),
                italic=all(l.italic for l in lines),
                marker=marker,
            )
            if (
                not role
                and _is_heading(first, body, bold_matters)
                and all(_is_heading(l, body, bold_matters) for l in lines)
            ):
                blk.role = "heading"
                heading_sizes[round(first.size, 1)] += 1
                blk.bold = False
            elif role:
                blk.role = role
            else:
                blk.role = "para"
            blocks.append(blk)

        # pictures become blocks, placed by their vertical center among the text
        for pi, pic in enumerate(page.pictures):
            blocks.append(
                Block(
                    id=f"p{page.number}i{pi}",
                    kind="image",
                    page=page.number,
                    box=pic.box,
                    role="image",
                    picture=pi,
                )
            )
        all_blocks.append(blocks)

    # heading levels: larger type is a higher level, document-wide. Sizes
    # within 8% of each other are one level (a 24pt and a 25pt title are the
    # same thing), and nothing goes deeper than h4 by default.
    sizes = sorted(heading_sizes, reverse=True)
    level_of: dict[float, int] = {}
    level, anchor = 0, None
    for sz in sizes:
        if anchor is None or sz < anchor * 0.92:
            level += 1
            anchor = sz
        level_of[sz] = min(level, 4)

    for page, blocks in zip(pm.pages, all_blocks):
        text_blocks = [b for b in blocks if b.kind == "text"]
        # list nesting by marker indent, judged within one column of the page:
        # a column is a run of non-heading blocks whose horizontal extents chain.
        col_of: dict[str, int] = {}
        col = -1
        extent: tuple[float, float] | None = None
        for b in text_blocks:
            if b.role == "heading":
                continue
            if extent is None or min(extent[1], b.box.right) - max(extent[0], b.box.left) <= 0:
                col += 1
                extent = (b.box.left, b.box.right)
            else:
                extent = (min(extent[0], b.box.left), max(extent[1], b.box.right))
            col_of[b.id] = col
        indents_by_col: dict[int, list[int]] = {}
        for b in text_blocks:
            if b.role in ("bullet", "numbered", "alpha", "roman"):
                indents_by_col.setdefault(col_of.get(b.id, -1), []).append(round(b.box.left))
        indents_by_col = {k: _cluster(v) for k, v in indents_by_col.items()}
        item: Block | None = None
        for b in text_blocks:
            indents = indents_by_col.get(col_of.get(b.id, -1), [])
            if b.role == "heading":
                b.level = level_of.get(round(b.size, 1), len(sizes) or 1)
                item = None
            elif b.role in ("bullet", "numbered", "alpha", "roman"):
                b.depth = sum(1 for i in indents if i < round(b.box.left) - INDENT_TOLERANCE)
                item = b
            elif (
                item is not None
                and not b.bold
                and col_of.get(b.id) == col_of.get(item.id)
                and b.box.left >= item.box.left + 2
                and b.size <= item.size + 0.6
                and item.box.bottom - b.box.top < 2.5 * max(b.box.height, 1.0)
            ):
                # a regular line under an item, indented: its detail
                b.role = "bullet"
                b.depth = item.depth + 1
            else:
                item = None

        # default order: text blocks already in reading order; a picture goes
        # before the text nearest to it — its label to the right on the same
        # row, or its caption below it — else at the end of the page.
        ordered: list[Block] = list(text_blocks)
        for img in (b for b in blocks if b.kind == "image"):
            best_pos, best_dist = len(ordered), float("inf")
            for i, tb in enumerate(ordered):
                if tb.kind != "text":
                    continue
                x_overlap = min(tb.box.right, img.box.right) - max(tb.box.left, img.box.left)
                y_overlap = min(tb.box.top, img.box.top) - max(tb.box.bottom, img.box.bottom)
                dist = None
                if y_overlap > 0 and tb.box.left >= img.box.right - 2:
                    dist = tb.box.left - img.box.right  # beside it, to the right
                elif x_overlap > 0 and tb.box.top <= img.box.bottom + 2:
                    dist = img.box.bottom - tb.box.top  # under it
                if dist is not None:
                    dist = round(
                        dist / 6
                    )  # a few points either way is a tie; the earlier block wins
                if dist is not None and dist < best_dist:
                    best_pos, best_dist = i, dist
            ordered.insert(best_pos, img)
        pages_out.append(
            {
                "n": page.number,
                "width": round(page.width, 2),
                "height": round(page.height, 2),
                "lines": [l.to_json() for l in page.lines],
                "pictures": [p.to_json() for p in page.pictures],
                "blocks": [b.to_json() for b in ordered],
            }
        )

    return {
        "version": 1,
        "source": str(pm.source),
        "body_size": body,
        "page_count": len(pm.pages),
        "pages": pages_out,
    }
