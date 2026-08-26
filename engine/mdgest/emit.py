"""Resolve analysis + edits into the page's final blocks, and write them as markdown.

Pure. `resolve_page` is what both the overlay on the PDF and the markdown
panel draw from, so the numbered boxes on the page and the numbered lines
beside it are one list by construction.
"""

from __future__ import annotations

import re

from .structure import marker_of

ROMAN = [
    "i",
    "ii",
    "iii",
    "iv",
    "v",
    "vi",
    "vii",
    "viii",
    "ix",
    "x",
    "xi",
    "xii",
    "xiii",
    "xiv",
    "xv",
    "xvi",
    "xvii",
    "xviii",
    "xix",
    "xx",
]
LIST_ROLES = ("bullet", "numbered", "alpha", "roman")


def roman(n: int) -> str:
    if 1 <= n <= len(ROMAN):
        return ROMAN[n - 1]
    return str(n)


def alpha(n: int) -> str:
    n -= 1
    out = ""
    while True:
        out = chr(ord("a") + n % 26) + out
        n = n // 26 - 1
        if n < 0:
            return out


def _arrange(blocks: list[dict], wanted: list[str]) -> list[dict]:
    """Blocks in a recorded order; blocks the order never named trail the one
    they were printed after (v1's fractional-rank sort)."""
    if not wanted:
        return blocks
    rank = {}
    for pos, ident in enumerate(wanted):
        rank.setdefault(ident, float(pos))
    placed = []
    previous = -1.0
    for step, blk in enumerate(blocks):
        if blk["id"] in rank:
            previous = rank[blk["id"]]
            placed.append((previous, step, blk))
        else:
            placed.append((previous + 0.5, step, blk))
    placed.sort(key=lambda e: (e[0], e[1]))
    return [e[2] for e in placed]


def cut_blocks(page: dict, raw: dict, at: list[int]) -> list[dict]:
    """A block as the fragments a person cut it into, at line boundaries.

    A block is a run of the page's lines, and which lines make a run is a
    judgment `structure._group_lines` makes from geometry alone -- a list whose
    markers are drawn rather than typed reads exactly like one wrapped
    paragraph. A cut moves the boundary. Every word stays on the line, and on
    the page, it came from, which is why this is the only thing edits may do
    to a block's words at all.
    """
    lines = raw.get("lines") or []
    at = [k for k in sorted(set(at)) if 0 < k < len(lines)]
    if not at:
        return [dict(raw)]
    texts = [page["lines"][i]["text"] for i in lines]
    boxes = [page["lines"][i]["bbox"] for i in lines]
    out: list[dict] = []
    for n, (a, b) in enumerate(zip([0, *at], [*at, len(lines)])):
        frag = dict(raw)
        frag["lines"] = lines[a:b]
        role, marker, head = marker_of(texts[a])
        if n:
            # the first fragment keeps the id every other edit refers to, and
            # the shape the analysis gave it; a later one is read off its own
            # first line, falling back to the shape of the run it came out of
            frag["id"] = f"{raw['id']}c{a}"
            frag["role"] = role or raw.get("role", "para")
            frag["marker"] = marker
        frag["text"] = " ".join(t for t in [head, *texts[a + 1 : b]] if t).strip()
        frag["bbox"] = [
            min(x[0] for x in boxes[a:b]),
            min(x[1] for x in boxes[a:b]),
            max(x[2] for x in boxes[a:b]),
            max(x[3] for x in boxes[a:b]),
        ]
        out.append(frag)
    return out


def resolve_page(page: dict, edits: dict) -> list[dict]:
    """The page's blocks after joins, overrides, inserts and ordering — numbered 1..N."""
    overrides = edits.get("blocks", {})
    joins = edits.get("joins", {})
    inserts = [i for i in edits.get("inserts", []) if int(i.get("page", 0)) == int(page["n"])]

    cuts = edits.get("cuts", {})
    by_id: dict[str, dict] = {}
    blocks: list[dict] = []
    for raw in page["blocks"]:
        for blk in cut_blocks(page, raw, cuts.get(raw["id"]) or []):
            blk["origin"] = "page"
            blk["joined"] = []
            by_id[blk["id"]] = blk
            blocks.append(blk)

    # joins: a child's words go onto its parent, and the child leaves the list
    for child, parent in joins.items():
        if child in by_id and parent in by_id and child != parent:
            c, p = by_id[child], by_id[parent]
            if c.get("text"):
                p["text"] = (p.get("text", "") + " " + c["text"]).strip()
            p["joined"].append(child)
            l, b, r, t = p["bbox"]
            cl, cb, cr, ct = c["bbox"]
            p["bbox"] = [min(l, cl), min(b, cb), max(r, cr), max(t, ct)]
            blocks = [x for x in blocks if x["id"] != child]

    # inserted text: new blocks placed after their anchor (or first)
    for ins in inserts:
        blk = {
            "id": ins["id"],
            "kind": "insert",
            "page": page["n"],
            "bbox": None,
            "lines": [],
            "text": ins.get("text", ""),
            "role": "insert",
            "level": 0,
            "depth": 0,
            "bold": False,
            "italic": False,
            "marker": "",
            "size": 0,
            "picture": -1,
            "origin": "person",
            "joined": [],
            "after": ins.get("after"),
        }
        pos = 0
        if ins.get("after"):
            for i, b in enumerate(blocks):
                if b["id"] == ins["after"]:
                    pos = i + 1
                    break
        blocks.insert(pos, blk)

    # overrides
    for blk in blocks:
        ov = overrides.get(blk["id"])
        blk["edited"] = bool(ov)
        blk["hidden"] = bool(blk.get("hidden"))  # a learned rule may hide by default
        blk.setdefault("break_before", False)
        blk.setdefault("break_after", False)
        if ov:
            for k, v in ov.items():
                blk[k] = v
        if blk.get("role") == "heading" and not blk.get("level"):
            blk["level"] = 2

    blocks = _arrange(blocks, edits.get("order", {}).get(str(page["n"]), []))
    # A deleted block keeps its place -- it is there to be restored -- but not
    # its number: numbering what the markdown does not carry makes "move to 9"
    # a count of things the person cannot see.
    n = 0
    counters: dict[tuple[str, int], int] = {}
    for blk in blocks:
        if blk.get("hidden"):
            blk["n"] = None
            blk["list_marker"] = ""
            continue
        n += 1
        blk["n"] = n
        blk["list_marker"] = _marker(blk, counters)
    return blocks


def _marker(blk: dict, counters: dict[tuple[str, int], int]) -> str:
    """The marker this block will be written with, `2.` / `b.` / `iii.` / `-`.

    Here rather than in `page_markdown` because the panel draws the same list
    and would otherwise count it again, in TypeScript: two encodings of "a
    paragraph resets the numbering, coming back up a level resets the deeper
    ones", drifting apart the first time one of them is fixed.
    """
    role = blk.get("role", "para")
    if role not in LIST_ROLES:
        counters.clear()
        return ""
    depth = max(0, int(blk.get("depth") or 0))
    for key in [k for k in counters if k[1] > depth]:
        counters.pop(key)
    if role == "bullet":
        return "-"
    key = (role, depth)
    counters[key] = counters.get(key, 0) + 1
    k = counters[key]
    return f"{k}." if role == "numbered" else f"{alpha(k)}." if role == "alpha" else f"{roman(k)}."


def _inline(blk: dict) -> str:
    text = (blk.get("text") or "").strip()
    if not text:
        return ""
    if blk.get("role") == "heading":
        return text
    if blk.get("bold"):
        text = f"**{text}**"
    if blk.get("italic"):
        text = f"*{text}*"
    return text


def page_markdown(page: dict, blocks: list[dict], assets_prefix: str = "") -> list[dict]:
    """Markdown lines for one page: [{text, block, n}], each line tagged with its block."""
    out: list[dict] = []
    prev_list = False

    def put(text: str, blk: dict | None) -> None:
        out.append(
            {"text": text, "block": blk["id"] if blk else None, "n": blk["n"] if blk else None}
        )

    def rule() -> None:
        if out and out[-1]["text"] != "":
            put("", None)
        put("---", None)
        put("", None)

    def emit_one(blk: dict) -> None:
        nonlocal prev_list
        if blk.get("hidden"):
            return
        role = blk.get("role", "para")
        is_list = role in LIST_ROLES
        if role == "image":
            pic = (
                page["pictures"][blk["picture"]]
                if 0 <= blk.get("picture", -1) < len(page["pictures"])
                else None
            )
            if not pic or not pic.get("path"):
                return
            if out and out[-1]["text"] != "":
                put("", None)
            put(
                f"![page {page['n']} figure {blk['picture'] + 1}]({assets_prefix}{pic['path']})",
                blk,
            )
            put("", None)
            prev_list = False
            return
        if role == "insert":
            if out and out[-1]["text"] != "":
                put("", None)
            for line in (blk.get("text") or "").splitlines() or [""]:
                put(line, blk)
            put("", None)
            prev_list = False
            return
        text = _inline(blk)
        if not text:
            return
        if role == "heading":
            if out and out[-1]["text"] != "":
                put("", None)
            put(f"{'#' * max(1, min(6, int(blk.get('level') or 2)))} {text}", blk)
            put("", None)
            prev_list = False
            return
        if is_list:
            indent = "  " * max(0, int(blk.get("depth") or 0))
            if not prev_list and out and out[-1]["text"] != "":
                put("", None)
            put(f"{indent}{blk['list_marker']} {text}", blk)
            prev_list = True
            return
        # paragraph
        if out and out[-1]["text"] != "":
            put("", None)
        put(text, blk)
        put("", None)
        prev_list = False

    for blk in blocks:
        if blk.get("break_before"):
            rule()
            prev_list = False
        emit_one(blk)
        if blk.get("break_after"):
            rule()
            prev_list = False
    return out


def document_markdown(analysis: dict, edits: dict, assets_prefix: str = "") -> dict:
    """The whole document: markdown text + per-line block map + per-page resolved blocks."""
    lines: list[dict] = []
    pages: list[dict] = []
    marking = analysis.get("page_numbers") == "mark"
    for page in analysis["pages"]:
        blocks = resolve_page(page, edits)
        pages.append({"n": page["n"], "blocks": blocks})
        if lines:
            if lines[-1]["text"] != "":
                lines.append({"text": "", "block": None, "n": None, "page": page["n"] - 1})
            lines.append(
                {"text": "---", "block": None, "n": None, "page": page["n"], "page_break": True}
            )
            lines.append({"text": "", "block": None, "n": None, "page": page["n"]})
        if marking:
            # The printed number, recorded where it cannot be mistaken for
            # prose: a comment is invisible when rendered and, unlike a
            # heading, adds nothing to the outline or to the anchors built
            # from it. The number a page prints is not always its position in
            # the file, which is the whole reason to keep it.
            printed = next(
                (b["page_number"] for b in blocks if b.get("page_number") is not None), None
            )
            if printed is not None:
                lines.append(
                    {
                        "text": f"<!-- page {printed} -->",
                        "block": None,
                        "n": None,
                        "page": page["n"],
                    }
                )
                lines.append({"text": "", "block": None, "n": None, "page": page["n"]})
        for ln in page_markdown(page, blocks, assets_prefix):
            ln["page"] = page["n"]
            lines.append(ln)
    # trim trailing blank
    while lines and lines[-1]["text"] == "":
        lines.pop()
    text = "\n".join(l["text"] for l in lines) + "\n"
    return {"markdown": text, "lines": lines, "pages": pages}


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
