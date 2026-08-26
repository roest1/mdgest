"""Saved states of a document's edits, with who came from whom.

Not git — nobody has to learn anything — but the shape is git's: the
**original** is the page read with no edits; a **version** is a named snapshot
of the edits, with a parent; the **working copy** (`edits.json`) always says
which version it continues from (`base`). You can go back to any of them, and
going back never loses what you had: it is one undoable step, and only one --
the history of the working copy you left stays with it rather than following
you to a place you went back to.

    .mdgest/<doc>/versions.json
      {"versions": [{"id": "v1", "name": "…", "parent": null, "created": "…",
                     "edits": {blocks, order, inserts, joins, cuts}}]}
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from . import edits as E


def load(path: Path) -> dict:
    if not path.exists():
        return {"versions": []}
    return json.loads(path.read_text("utf-8"))


def save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), "utf-8")
    tmp.replace(path)


def get(data: dict, vid: str) -> dict | None:
    return next((v for v in data["versions"] if v["id"] == vid), None)


def snapshot(data: dict, edits: dict, name: str) -> dict:
    n = 1 + max([int(v["id"][1:]) for v in data["versions"] if v["id"].startswith("v")] or [0])
    entry = {
        "id": f"v{n}",
        "name": (name or f"version {n}").strip(),
        "parent": edits.get("base"),
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
        "edits": E.content(edits),
    }
    data["versions"].append(entry)
    return entry


def children(data: dict, vid: str | None) -> list[dict]:
    return [v for v in data["versions"] if v.get("parent") == vid]


def remove(data: dict, vid: str) -> bool:
    if children(data, vid):
        raise ValueError("this version has successors; remove them first")
    before = len(data["versions"])
    data["versions"] = [v for v in data["versions"] if v["id"] != vid]
    return len(data["versions"]) < before


def summary(data: dict, edits: dict) -> dict:
    """The tree as a flat list in display order (depth-first), plus where the working copy is."""
    base = edits.get("base")
    working = E.content(edits)
    base_edits = get(data, base)["edits"] if base and get(data, base) else E.content(E.blank())
    dirty = working != base_edits
    out = []

    def walk(parent, depth):
        for v in sorted(children(data, parent), key=lambda v: v["created"]):
            out.append(
                {
                    "id": v["id"],
                    "name": v["name"],
                    "parent": v["parent"],
                    "created": v["created"],
                    "depth": depth,
                    "edits": {k: len(v["edits"].get(k, [])) for k in E.CONTENT_KEYS},
                }
            )
            walk(v["id"], depth + 1)

    walk(None, 1)
    return {"base": base, "dirty": dirty, "versions": out}
