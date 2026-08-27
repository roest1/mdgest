"""What a person decided about a document — the only precious file.

`analysis.json` regenerates from the PDF; `edits.json` does not. It records
role/level/nesting/emphasis overrides per block, the reading order per page,
joins and cuts, hidden blocks, and text a person inserted (flagged as such,
because it is the one thing here that is not on the page). Every mutation
pushes the previous state onto an undo stack.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

VERSION = 1
UNDO_DEPTH = 100
BLOCK_FIELDS = ("role", "level", "depth", "bold", "italic", "hidden", "break_before", "break_after")
#: What a break is worth. `page` writes `---` and keeps one file; `file` writes
#: `---` too and starts a new markdown file there. Stored as a string rather
#: than a second boolean field because a file break is a page break that also
#: cuts -- two booleans would admit `file and not page`, which means nothing.
#: A `True` written before this field carried values reads as `page`.
BREAKS = ("page", "file")


def blank() -> dict:
    return {
        "version": VERSION,
        "blocks": {},  # id -> {role, level, depth, bold, italic, hidden}
        "order": {},  # page -> [ids]
        "inserts": [],  # {id, page, after, text}
        "joins": {},  # child id -> parent id
        # block id -> the line positions a cut falls before. A block is a run
        # of the page's lines and `structure._group_lines` chose where the run
        # ends; a cut moves that boundary. Regrouping is the only thing edits
        # may do to a block's words, and `fidelity` depends on it: no text
        # field means no word can enter that is not on the page.
        "cuts": {},
        # Where a file break starts a part, to the name that part's file
        # carries: block id -> name, and "" for the part before the first
        # break. Seeded from the part's first heading the first time it is
        # written and not touched again, so retitling a heading later does not
        # rename a file or dangle the citations already written against it.
        "parts": {},
        "complete": False,  # a person has said this document is done (see ops.set_complete)
        "base": None,  # the saved version this working copy continues from (None = the original)
        "undo": [],  # previous states (without their own undo stacks)
        "redo": [],
    }


def load(path: Path) -> dict:
    if not path.exists():
        return blank()
    data = json.loads(path.read_text("utf-8"))
    base = blank()
    base.update({k: v for k, v in data.items() if k in base})
    return base


def save(path: Path, edits: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(edits, indent=1, ensure_ascii=False), "utf-8")
    tmp.replace(path)


CONTENT_KEYS = ("blocks", "order", "inserts", "joins", "cuts", "parts")


def content(edits: dict) -> dict:
    """Just the decisions — what a version stores and what `is_dirty` compares."""
    return {k: copy.deepcopy(edits.get(k, blank()[k])) for k in CONTENT_KEYS}


def _snapshot(edits: dict) -> dict:
    """What undo remembers: the decisions, and not `base`.

    `base` is where the working copy sits in the version tree, not something a
    person decided about the document. Restoring it meant that undoing the
    edit before a save also un-pointed the save -- the version stayed in the
    tree with nothing pointing at it, and the next save came out its sibling
    rather than its child.
    """
    return content(edits)


def is_empty(edits: dict) -> bool:
    return not any(edits.get(k) for k in CONTENT_KEYS)


def checkpoint(edits: dict) -> None:
    """Call before mutating: remembers the current state for undo."""
    edits["undo"].append(_snapshot(edits))
    del edits["undo"][:-UNDO_DEPTH]
    edits["redo"] = []


def undo(edits: dict) -> bool:
    if not edits["undo"]:
        return False
    edits["redo"].append(_snapshot(edits))
    edits.update(edits["undo"].pop())
    return True


def redo(edits: dict) -> bool:
    if not edits["redo"]:
        return False
    edits["undo"].append(_snapshot(edits))
    edits.update(edits["redo"].pop())
    return True


def set_block(edits: dict, block_id: str, **fields) -> dict:
    entry = edits["blocks"].setdefault(block_id, {})
    for k, v in fields.items():
        if k not in BLOCK_FIELDS:
            raise ValueError(f"unknown block field {k!r}")
        if k in ("break_before", "break_after") and v is not None:
            v = "page" if v is True else v
            if v not in BREAKS:
                raise ValueError(f"{k} must be one of {BREAKS}")
        if v is None:
            entry.pop(k, None)
        else:
            entry[k] = v
    if not entry:
        edits["blocks"].pop(block_id, None)
    return entry


def clear_block(edits: dict, block_id: str) -> None:
    edits["blocks"].pop(block_id, None)


def set_order(edits: dict, page: int, order: list[str] | None) -> None:
    if order is None:
        edits["order"].pop(str(page), None)
    else:
        edits["order"][str(page)] = list(order)


def add_insert(edits: dict, page: int, after: str | None, text: str) -> dict:
    n = 1 + max(
        [int(i["id"].split("-")[1]) for i in edits["inserts"] if i["id"].startswith("ins-")] or [0]
    )
    entry = {"id": f"ins-{n}", "page": page, "after": after, "text": text}
    edits["inserts"].append(entry)
    return entry


def update_insert(edits: dict, insert_id: str, text: str) -> bool:
    for entry in edits["inserts"]:
        if entry["id"] == insert_id:
            entry["text"] = text
            return True
    return False


def remove_insert(edits: dict, insert_id: str) -> bool:
    before = len(edits["inserts"])
    edits["inserts"] = [i for i in edits["inserts"] if i["id"] != insert_id]
    for page, order in list(edits["order"].items()):
        edits["order"][page] = [i for i in order if i != insert_id]
    return len(edits["inserts"]) < before


def join(edits: dict, child: str, parent: str) -> None:
    if child == parent:
        raise ValueError("a block cannot be joined to itself")
    edits["joins"][child] = parent


def split(edits: dict, child: str) -> bool:
    return edits["joins"].pop(child, None) is not None


def set_cuts(edits: dict, block_id: str, at: list[int]) -> list[int]:
    """Where a block is cut into fragments — positions in its own line list.
    An empty list puts it back together."""
    at = sorted({int(k) for k in at if int(k) > 0})
    if at:
        edits["cuts"][block_id] = at
    else:
        edits["cuts"].pop(block_id, None)
    return at


def set_part_name(edits: dict, at: str, name: str) -> str:
    """Name the part that starts at a block (`""` for the first one)."""
    edits["parts"][at] = name
    return name


def summary(edits: dict) -> dict:
    return {
        "blocks": len(edits["blocks"]),
        "pages_reordered": len(edits["order"]),
        "inserts": len(edits["inserts"]),
        "joins": len(edits["joins"]),
        "cuts": len(edits["cuts"]),
        "parts": len(edits["parts"]),
        "complete": bool(edits.get("complete")),
        "undo": len(edits["undo"]),
        "redo": len(edits["redo"]),
    }
