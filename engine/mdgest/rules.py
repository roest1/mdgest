"""What mdgest learns from your edits, per folder, so the next document of the
same shape starts ahead.

A **rule** is keyed by how a block is *set on the page* — font size, weight,
face, the kind of marker in front of it, how far in it sits — never by its
words, so it carries from `arms.pdf` to `legs.pdf`. Its value is the shape
you gave such blocks (role, heading level, depth, bold, italic). A **hide
rule** is the one exception: it is keyed by the block's normalized text
(digits wildcarded), because a running footer *is* its words.

Rules live in `.mdgest/<folder>/rules.json` and apply to every document in
that folder and below. Where two folders on the path both have an opinion,
the deeper one wins — body-regions over results-review over the workspace.
Rules are defaults: they shape `analysis.json` when a document is (re)read;
a person's `edits.json` always sits on top.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from . import pagenums
from .structure import ROLES

SHAPE_FIELDS = ("role", "level", "depth", "bold", "italic")


_SPACES = re.compile(r"\s+")
_DIGITS = re.compile(r"\d+")


def text_key(text: str) -> str:
    """v1's boilerplate key: lowercase, one space, digits wildcarded."""
    return _DIGITS.sub("#", _SPACES.sub(" ", (text or "").strip().lower()))


def signature(block: dict, page: dict | None = None, with_indent: bool = True) -> str:
    """How a text block is set, as a key. Size to the half point, indent to 10pt."""
    size = round(float(block.get("size") or 0) * 2) / 2
    font = (block.get("font") or "").lower()
    parts = [
        f"s{size:g}",
        f"b{int(bool(block.get('bold')))}",
        f"i{int(bool(block.get('italic')))}",
        f"f={font}",
        f"m={_marker_kind(block)}",
        f"r={block.get('default_role') or block.get('role')}",
    ]
    if with_indent and block.get("bbox"):
        parts.append(f"x={int(round(block['bbox'][0] / 10) * 10)}")
    return "|".join(parts)


def _strip_indent(key: str) -> str:
    return re.sub(r"\|x=-?\d+$", "", key)


def _marker_kind(block: dict) -> str:
    m = (block.get("marker") or "").strip()
    if not m:
        return ""
    if m[0].isdigit():
        return "num"
    if re.fullmatch(r"\(?[ivxlcdm]{1,5}[.)]", m, re.IGNORECASE):
        return "roman"
    if re.fullmatch(r"\(?[a-zA-Z][.)]", m):
        return "alpha"
    return "bullet"


def blank() -> dict:
    return {"version": 1, "shape": {}, "hide": {}, "settings": {}}


def path_for(cache_root: Path, folder: str) -> Path:
    return (cache_root / folder / "rules.json") if folder else (cache_root / "rules.json")


def load(cache_root: Path, folder: str) -> dict:
    p = path_for(cache_root, folder)
    if not p.exists():
        return blank()
    data = json.loads(p.read_text("utf-8"))
    base = blank()
    base.update({k: v for k, v in data.items() if k in base})
    return base


def save(cache_root: Path, folder: str, rules: dict) -> None:
    p = path_for(cache_root, folder)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(rules, indent=1, ensure_ascii=False), "utf-8")


def ancestors(doc_or_folder: str) -> list[str]:
    """Folders from the workspace root down to the one containing the id: '', 'a', 'a/b'."""
    parts = [p for p in PurePosixPath(doc_or_folder).parts if p]
    return [""] + ["/".join(parts[: i + 1]) for i in range(len(parts))]


def learn_shape(rules: dict, raw_block: dict, fields: dict, doc_id: str) -> dict | None:
    """Record that blocks set like `raw_block` should be shaped like `fields`."""
    if raw_block.get("kind") != "text":
        return None
    value = {k: fields[k] for k in SHAPE_FIELDS if k in fields and fields[k] is not None}
    if not value:
        return None
    if value.get("role") and value["role"] not in ROLES:
        return None
    sig = signature(raw_block)
    entry = rules["shape"].get(sig) or {"fields": {}, "count": 0}
    entry["fields"].update(value)
    entry["count"] = entry.get("count", 0) + 1
    entry["example"] = (raw_block.get("text") or "")[:80]
    entry["doc"] = doc_id
    entry["updated"] = datetime.now(UTC).isoformat(timespec="seconds")
    rules["shape"][sig] = entry
    return {"signature": sig, **entry}


def learn_hide(rules: dict, raw_block: dict, hidden: bool, doc_id: str) -> dict | None:
    key = text_key(raw_block.get("text") or "")
    if not key:
        return None
    if hidden:
        rules["hide"][key] = {
            "example": (raw_block.get("text") or "")[:80],
            "doc": doc_id,
            "updated": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        return {"key": key, **rules["hide"][key]}
    rules["hide"].pop(key, None)
    return {"key": key, "removed": True}


def settings_for(stack: list[tuple[str, dict]]) -> dict:
    """The settings in force, root first and the deeper folder winning."""
    out: dict = {}
    for _, table in stack:
        out.update({k: v for k, v in (table.get("settings") or {}).items() if v is not None})
    return out


def forget(rules: dict, kind: str, key: str) -> bool:
    return rules.get(kind, {}).pop(key, None) is not None


def stack_for(cache_root: Path, doc_id: str) -> list[tuple[str, dict]]:
    """(folder, rules) from the root down to the document's folder — deeper last, so deeper wins."""
    folder = str(PurePosixPath(doc_id).parent) if "/" in doc_id else ""
    return [(f, load(cache_root, f)) for f in ancestors(folder)]


def apply(analysis: dict, stack: list[tuple[str, dict]]) -> int:
    """Shape the analysis by the rules. Returns how many blocks a rule touched.

    A rule with the indent in its key beats one without; within a tier the
    deepest folder wins. Everything written is a *default*: the block remembers
    its page-read role in `default_role` and which rule spoke in `rule`.
    """
    touched = 0
    settings = settings_for(stack)
    page_policy = pagenums.policy_of(settings)
    analysis["page_numbers"] = page_policy
    if not any(r["shape"] or r["hide"] or r.get("settings") for _, r in stack):
        return 0
    # the same rules keyed without their indent, for the looser match
    loose = [(f, {_strip_indent(k): v for k, v in r["shape"].items()}) for f, r in stack]
    for page in analysis["pages"]:
        band = page["height"] * pagenums.MARGIN_FRACTION
        for blk in page["blocks"]:
            if blk.get("kind") != "text":
                continue
            blk.setdefault("default_role", blk.get("role"))
            # A page number is only a page number where a page number goes: a
            # bare `4` is one in the footer and a list item in the body.
            box = blk.get("bbox") or [0, 0, 0, 0]
            if box[3] > page["height"] - band or box[1] < band:
                printed = pagenums.label(blk.get("text") or "")
                if printed is not None:
                    blk["page_number"] = printed
                    if page_policy in ("hide", "mark"):
                        blk["hidden"] = True
                        blk["rule"] = {
                            "folder": "",
                            "key": "page_numbers",
                            "kind": "setting",
                            "doc": "",
                        }
                        touched += 1
            hit = None
            for with_indent in (True, False):
                sig = signature(blk, with_indent=with_indent)
                tier = stack if with_indent else loose
                for folder, table in reversed(tier):  # deepest first
                    entry = table["shape"].get(sig) if with_indent else table.get(sig)
                    if entry:
                        hit = (folder, sig, entry)
                        break
                if hit:
                    break
            if hit:
                folder, sig, entry = hit
                for k, v in entry["fields"].items():
                    blk[k] = v
                blk["rule"] = {
                    "folder": folder,
                    "key": sig,
                    "kind": "shape",
                    "doc": entry.get("doc", ""),
                }
                touched += 1
            key = text_key(blk.get("text") or "")
            for folder, rules in reversed(stack):
                if key in rules["hide"]:
                    blk["hidden"] = True
                    blk["rule"] = {
                        "folder": folder,
                        "key": key,
                        "kind": "hide",
                        # which document taught it — so a report can say where
                        # content that vanished from *this* one was decided
                        "doc": rules["hide"][key].get("doc", ""),
                    }
                    touched += 1
                    break
    return touched
