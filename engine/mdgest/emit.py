"""Resolve analysis + edits into the page's final blocks, and write them as markdown.

Pure. `resolve_page` is what both the overlay on the PDF and the markdown
panel draw from, so the numbered boxes on the page and the numbered lines
beside it are one list by construction.
"""

from __future__ import annotations

import re

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


def resolve_page(page: dict, edits: dict) -> list[dict]:
    """The page's blocks after joins, overrides, inserts and ordering — numbered 1..N."""
    overrides = edits.get("blocks", {})
    joins = edits.get("joins", {})
    inserts = [i for i in edits.get("inserts", []) if int(i.get("page", 0)) == int(page["n"])]

    by_id: dict[str, dict] = {}
    blocks: list[dict] = []
    for raw in page["blocks"]:
        blk = dict(raw)
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
    for n, blk in enumerate(blocks, start=1):
        blk["n"] = n
    return blocks


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
    counters: dict[tuple[str, int], int] = {}
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
        if not is_list:
            counters.clear()
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
            depth = max(0, int(blk.get("depth") or 0))
            # reset deeper counters when we come back up
            for key in [k for k in counters if k[1] > depth]:
                counters.pop(key)
            indent = "  " * depth
            if role == "bullet":
                marker = "-"
            else:
                key = (role, depth)
                counters[key] = counters.get(key, 0) + 1
                k = counters[key]
                marker = (
                    f"{k}."
                    if role == "numbered"
                    else f"{alpha(k)}."
                    if role == "alpha"
                    else f"{roman(k)}."
                )
            if not prev_list and out and out[-1]["text"] != "":
                put("", None)
            put(f"{indent}{marker} {text}", blk)
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
        for ln in page_markdown(page, blocks, assets_prefix):
            ln["page"] = page["n"]
            lines.append(ln)
    # trim trailing blank
    while lines and lines[-1]["text"] == "":
        lines.pop()
    text = "\n".join(l["text"] for l in lines) + "\n"
    return {"markdown": text, "lines": lines, "pages": pages}


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
