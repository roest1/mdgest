"""Every operation the UI and the CLI share. Each takes a Workspace and a
document id, mutates `edits.json` under an undo checkpoint, rewrites the
markdown beside the source, and returns the resolved view of the page touched.
"""

from __future__ import annotations

import difflib
import re as _re
import shutil
from pathlib import Path, PurePosixPath

from . import edits as E
from . import emit, pagemap, rules, structure, versions
from .store import Workspace

# ---- analysis ----------------------------------------------------------------


def analyze(ws: Workspace, doc_id: str, force: bool = False) -> dict:
    """Read the PDF into analysis.json (+ figure assets) and write the markdown."""
    doc_id = ws.check_doc(doc_id)
    if ws.has_analysis(doc_id) and not force:
        return ws.read_analysis(doc_id)
    assets = ws.assets_dir(doc_id)
    if assets.exists():
        shutil.rmtree(assets)
    from .render import PDFIUM_LOCK

    with PDFIUM_LOCK:
        pm = pagemap.read(ws.source_path(doc_id), assets)
    analysis = structure.analyse(pm)
    analysis["source"] = Path(doc_id).name + ".pdf"
    analysis["rules_applied"] = rules.apply(analysis, rules.stack_for(ws.cache, doc_id))
    ws.write_analysis(doc_id, analysis)
    write_markdown(ws, doc_id, analysis)
    return analysis


def write_markdown(ws: Workspace, doc_id: str, analysis: dict | None = None) -> str:
    analysis = analysis or ws.read_analysis(doc_id)
    edits = E.load(ws.edits_path(doc_id))
    doc = emit.document_markdown(analysis, edits, assets_prefix=f"{Path(doc_id).name}.assets/")
    target = ws.md_path(doc_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(doc["markdown"], "utf-8")
    return doc["markdown"]


# ---- views -------------------------------------------------------------------


def view(ws: Workspace, doc_id: str, include_lines: bool = True) -> dict:
    """Everything the document screen needs in one payload."""
    doc_id = ws.check_doc(doc_id)
    analysis = ws.read_analysis(doc_id)
    edits = E.load(ws.edits_path(doc_id))
    doc = emit.document_markdown(analysis, edits, assets_prefix=f"{Path(doc_id).name}.assets/")
    pages = []
    for page, resolved in zip(analysis["pages"], doc["pages"]):
        pages.append(
            {
                "n": page["n"],
                "width": page["width"],
                "height": page["height"],
                "lines": page["lines"] if include_lines else [],
                "pictures": page["pictures"],
                "blocks": resolved["blocks"],
                "reordered": str(page["n"]) in edits.get("order", {}),
            }
        )
    return {
        "doc": ws.doc_summary(doc_id),
        "body_size": analysis.get("body_size"),
        "page_count": analysis.get("page_count"),
        "pages": pages,
        "markdown": doc["markdown"],
        "md_lines": doc["lines"],
        "edits": E.summary(edits),
        "versions": versions.summary(versions.load(ws.versions_path(doc_id)), edits),
        "rules_applied": analysis.get("rules_applied", 0),
    }


def page_view(ws: Workspace, doc_id: str, number: int) -> dict:
    analysis = ws.read_analysis(doc_id)
    edits = E.load(ws.edits_path(doc_id))
    page = next(p for p in analysis["pages"] if p["n"] == number)
    blocks = emit.resolve_page(page, edits)
    return {"n": number, "blocks": blocks, "reordered": str(number) in edits.get("order", {})}


# ---- mutations ---------------------------------------------------------------


def _mutate(ws: Workspace, doc_id: str, fn) -> dict:
    doc_id = ws.check_doc(doc_id)
    path = ws.edits_path(doc_id)
    edits = E.load(path)
    E.checkpoint(edits)
    result = fn(edits)
    E.save(path, edits)
    write_markdown(ws, doc_id)
    return result if result is not None else {}


def set_block(
    ws: Workspace, doc_id: str, block_id: str, learn: str | None = None, **fields
) -> dict:
    """Override a block's shape. With `learn` = a folder on the document's path,
    also record the decision as a rule there (see `rules.py`)."""

    def fn(edits):
        clean = {k: v for k, v in fields.items() if k in E.BLOCK_FIELDS}
        if "role" in clean and clean["role"] is not None and clean["role"] not in structure.ROLES:
            raise ValueError(f"unknown role {clean['role']!r}; one of {structure.ROLES}")
        E.set_block(edits, block_id, **clean)
        result = {"block": block_id, "override": edits["blocks"].get(block_id, {})}
        if learn is not None:
            result["learned"] = _learn(ws, doc_id, block_id, learn, clean, edits)
        return result

    return _mutate(ws, doc_id, fn)


def _raw_block(ws: Workspace, doc_id: str, block_id: str) -> dict | None:
    analysis = ws.read_analysis(doc_id)
    for page in analysis["pages"]:
        for b in page["blocks"]:
            if b["id"] == block_id:
                return b
    return None


def _learn(
    ws: Workspace, doc_id: str, block_id: str, folder: str, fields: dict, edits: dict
) -> dict | None:
    folder = folder.strip("/")
    if folder not in rules.ancestors(doc_id):
        raise ValueError(f"{folder!r} is not a folder on the path of {doc_id}")
    raw = _raw_block(ws, doc_id, block_id)
    if raw is None or raw.get("kind") != "text":
        return None
    store = rules.load(ws.cache, folder)
    out: dict = {"folder": folder}
    shape = {k: v for k, v in fields.items() if k in rules.SHAPE_FIELDS}
    if shape:
        # the rule carries the block's whole shape as it now stands, not just the key that changed
        current = {k: raw.get(k) for k in rules.SHAPE_FIELDS}
        current.update(
            {k: v for k, v in edits["blocks"].get(block_id, {}).items() if k in rules.SHAPE_FIELDS}
        )
        out["shape"] = rules.learn_shape(store, raw, current, doc_id)
    if "hidden" in fields:
        out["hide"] = rules.learn_hide(store, raw, bool(fields["hidden"]), doc_id)
    rules.save(ws.cache, folder, store)
    return out


def list_rules(ws: Workspace, doc_or_folder: str) -> list[dict]:
    """Every rule that applies on the path, root first."""
    out = []
    if ws.source_path(doc_or_folder).exists():  # a document: its folder's path
        doc_or_folder = str(PurePosixPath(doc_or_folder).parent) if "/" in doc_or_folder else ""
    for folder in rules.ancestors(doc_or_folder):
        r = rules.load(ws.cache, folder)
        out.append(
            {
                "folder": folder,
                "shape": [{"key": k, **v} for k, v in r["shape"].items()],
                "hide": [{"key": k, **v} for k, v in r["hide"].items()],
            }
        )
    return out


def forget_rule(ws: Workspace, folder: str, kind: str, key: str) -> dict:
    r = rules.load(ws.cache, folder)
    ok = rules.forget(r, kind, key)
    rules.save(ws.cache, folder, r)
    return {"forgotten": ok}


def apply_rules(ws: Workspace, doc_id: str) -> dict:
    """Re-read the document under the current rules (edits stay)."""
    analysis = analyze(ws, doc_id, force=True)
    return {"rules_applied": analysis.get("rules_applied", 0)}


# ---- versions ----------------------------------------------------------------


def list_versions(ws: Workspace, doc_id: str) -> dict:
    doc_id = ws.check_doc(doc_id)
    return versions.summary(versions.load(ws.versions_path(doc_id)), E.load(ws.edits_path(doc_id)))


def save_version(ws: Workspace, doc_id: str, name: str) -> dict:
    doc_id = ws.check_doc(doc_id)
    path = ws.edits_path(doc_id)
    edits = E.load(path)
    data = versions.load(ws.versions_path(doc_id))
    entry = versions.snapshot(data, edits, name)
    versions.save(ws.versions_path(doc_id), data)
    edits["base"] = entry["id"]
    E.save(path, edits)
    return {"saved": entry["id"], "name": entry["name"], **versions.summary(data, edits)}


def checkout(ws: Workspace, doc_id: str, version_id: str | None) -> dict:
    """Make the working copy that version (or the original). Undoable."""
    doc_id = ws.check_doc(doc_id)
    data = versions.load(ws.versions_path(doc_id))
    target = None
    if version_id and version_id != "original":
        target = versions.get(data, version_id)
        if not target:
            raise KeyError(version_id)

    def fn(edits):
        fresh = E.blank()
        content = target["edits"] if target else E.content(fresh)
        for k in E.CONTENT_KEYS:
            edits[k] = content.get(k, fresh[k])
        edits["base"] = target["id"] if target else None
        return {"checked_out": edits["base"] or "original"}

    out = _mutate(ws, doc_id, fn)
    out.update(versions.summary(data, E.load(ws.edits_path(doc_id))))
    return out


def delete_version(ws: Workspace, doc_id: str, version_id: str) -> dict:
    doc_id = ws.check_doc(doc_id)
    data = versions.load(ws.versions_path(doc_id))
    versions.remove(data, version_id)
    versions.save(ws.versions_path(doc_id), data)
    path = ws.edits_path(doc_id)
    edits = E.load(path)
    if edits.get("base") == version_id:
        edits["base"] = None
        E.save(path, edits)
    return versions.summary(data, edits)


def reset_block(ws: Workspace, doc_id: str, block_id: str) -> dict:
    return _mutate(ws, doc_id, lambda e: E.clear_block(e, block_id))


def _page_of(ws: Workspace, doc_id: str, block_id: str, edits: dict) -> tuple[dict, list[dict]]:
    analysis = ws.read_analysis(doc_id)
    for page in analysis["pages"]:
        blocks = emit.resolve_page(page, edits)
        if any(b["id"] == block_id for b in blocks):
            return page, blocks
    raise KeyError(block_id)


def move_block(
    ws: Workspace,
    doc_id: str,
    block_id: str | list[str],
    to: int | None = None,
    target: str | None = None,
    place: str = "before",
) -> dict:
    """Move a block — or a group of blocks from one page, kept in their order —
    to number `to` (1-based) on the page, or before/after `target`.

    Returns the new order and the blast radius: every block whose number changed.
    """
    group = [block_id] if isinstance(block_id, str) else list(dict.fromkeys(block_id))
    if not group:
        raise ValueError("nothing to move")

    def fn(edits):
        page, blocks = _page_of(ws, doc_id, group[0], edits)
        ids = [b["id"] for b in blocks]
        missing = [g for g in group if g not in ids]
        if missing:
            raise ValueError(f"not on page {page['n']}: {missing}")
        if target is not None and target in group:
            raise ValueError("the target cannot be one of the blocks being moved")
        before = list(ids)
        moving = [i for i in ids if i in group]  # page order, not click order
        rest = [i for i in ids if i not in group]
        if target is not None:
            dst = rest.index(target) + (1 if place == "after" else 0)
        elif to is not None:
            dst = max(0, min(len(rest), int(to) - 1))
        else:
            raise ValueError("move needs `to` or `target`")
        ids = rest[:dst] + moving + rest[dst:]
        E.set_order(edits, page["n"], ids)
        affected = [i for n, i in enumerate(ids) if before[n] != i]
        return {
            "page": page["n"],
            "order": ids,
            "moved": moving,
            "affected": affected,
            "to": ids.index(moving[0]) + 1,
        }

    return _mutate(ws, doc_id, fn)


def set_order(ws: Workspace, doc_id: str, page: int, order: list[str] | None) -> dict:
    def fn(edits):
        if order is not None:
            analysis = ws.read_analysis(doc_id)
            pg = next(p for p in analysis["pages"] if p["n"] == page)
            current = {b["id"] for b in emit.resolve_page(pg, edits)}
            if set(order) != current:
                raise ValueError("order must be a permutation of the page's blocks")
        E.set_order(edits, page, order)
        return {"page": page, "order": order}

    return _mutate(ws, doc_id, fn)


def insert_text(ws: Workspace, doc_id: str, page: int, after: str | None, text: str) -> dict:
    return _mutate(ws, doc_id, lambda e: E.add_insert(e, page, after, text))


def update_insert(ws: Workspace, doc_id: str, insert_id: str, text: str) -> dict:
    def fn(edits):
        if not E.update_insert(edits, insert_id, text):
            raise KeyError(insert_id)
        return {"id": insert_id}

    return _mutate(ws, doc_id, fn)


def remove_insert(ws: Workspace, doc_id: str, insert_id: str) -> dict:
    def fn(edits):
        if not E.remove_insert(edits, insert_id):
            raise KeyError(insert_id)
        return {"id": insert_id}

    return _mutate(ws, doc_id, fn)


def join_blocks(ws: Workspace, doc_id: str, child: str, parent: str) -> dict:
    def fn(edits):
        E.join(edits, child, parent)
        return {"child": child, "parent": parent}

    return _mutate(ws, doc_id, fn)


def split_block(ws: Workspace, doc_id: str, child: str) -> dict:
    def fn(edits):
        if not E.split(edits, child):
            raise KeyError(child)
        return {"child": child}

    return _mutate(ws, doc_id, fn)


def undo(ws: Workspace, doc_id: str) -> dict:
    doc_id = ws.check_doc(doc_id)
    path = ws.edits_path(doc_id)
    edits = E.load(path)
    ok = E.undo(edits)
    E.save(path, edits)
    write_markdown(ws, doc_id)
    return {"undone": ok, **E.summary(edits)}


def redo(ws: Workspace, doc_id: str) -> dict:
    doc_id = ws.check_doc(doc_id)
    path = ws.edits_path(doc_id)
    edits = E.load(path)
    ok = E.redo(edits)
    E.save(path, edits)
    write_markdown(ws, doc_id)
    return {"redone": ok, **E.summary(edits)}


def reset_edits(ws: Workspace, doc_id: str) -> dict:
    def fn(edits):
        fresh = E.blank()
        for k in ("blocks", "order", "inserts", "joins"):
            edits[k] = fresh[k]
        return {"reset": True}

    return _mutate(ws, doc_id, fn)


# ---- corpus index -------------------------------------------------------------


def build_index(ws: Workspace, folder: str) -> str:
    """Write INDEX.md over every markdown file under a folder: one entry per
    document with its heading outline and anchors, so a downstream agent can
    decide where to read instead of reading everything.
    """
    from .corpus import index_markdown

    folder = ws.mkdir(folder) if folder else ""
    base = ws.markdown / folder if folder else ws.markdown
    text = index_markdown(ws, folder)
    (base / "INDEX.md").write_text(text, "utf-8")
    return text


# ---- free-form markdown edits --------------------------------------------------


_HEAD_RE = _re.compile(r"^(#{1,6})\s+(.*)$")
_LIST_RE = _re.compile(
    r"^(\s*)(?:([-*+•])|(\d{1,3})\.|([a-z])\.|((?:x{0,3})(?:ix|iv|v?i{0,3}))\.)\s+(.*)$",
    _re.IGNORECASE,
)


def _parse_md_line(line: str) -> dict:
    """What a markdown line says it is: role, level, depth, bold, italic, and the bare text."""
    out = {"role": "para", "level": 0, "depth": 0, "bold": False, "italic": False}
    m = _HEAD_RE.match(line)
    if m:
        out.update(role="heading", level=len(m.group(1)))
        text = m.group(2).strip()
    else:
        m = _LIST_RE.match(line)
        if m and m.group(6) is not None and (m.group(2) or m.group(3) or m.group(4) or m.group(5)):
            indent = len(m.group(1).replace("\t", "    "))
            if m.group(2):
                role = "bullet"
            elif m.group(3):
                role = "numbered"
            elif m.group(5):
                role = "roman"
            else:
                role = "alpha"
            out.update(role=role, depth=indent // 2)
            text = m.group(6).strip()
        else:
            text = line.strip()
    m = _re.fullmatch(r"\*\*(.+)\*\*", text)
    if m:
        out["bold"] = True
        text = m.group(1)
    m = _re.fullmatch(r"[*_](.+)[*_]", text)
    if m:
        out["italic"] = True
        text = m.group(1)
    out["text"] = text.strip()
    return out


def apply_markdown(ws: Workspace, doc_id: str, text: str) -> dict:
    """Take a freely edited copy of the document's markdown and record the
    difference as edits — one undo step.

    - a line that is a block's line with different markup but the same words
      → the block's shape changes (heading level, list kind, depth, bold, italic)
    - a line removed → its block is hidden (an inserted block is removed)
    - a line changed in its words → the block is hidden and the new words are
      inserted after it, as a person's text
    - new lines → inserted after the block they follow
    """
    doc_id = ws.check_doc(doc_id)
    path = ws.edits_path(doc_id)
    edits = E.load(path)
    analysis = ws.read_analysis(doc_id)
    before = emit.document_markdown(analysis, edits, assets_prefix=f"{Path(doc_id).name}.assets/")
    old_lines = before["lines"]
    old = [l["text"] for l in old_lines]
    new = text.replace("\r\n", "\n").split("\n")
    while new and new[-1] == "":
        new.pop()
    blocks_by_id: dict[str, dict] = {}
    for page in before["pages"]:
        for b in page["blocks"]:
            blocks_by_id[b["id"]] = b

    E.checkpoint(edits)
    report = {"shaped": 0, "hidden": 0, "inserted": 0, "updated": 0, "removed": 0}

    def anchor_before(i: int) -> tuple[int, str | None]:
        """(page, block id) of the last block line at or before old index i-1."""
        for j in range(i - 1, -1, -1):
            if old_lines[j].get("block"):
                return old_lines[j]["page"], old_lines[j]["block"]
        return (old_lines[0]["page"] if old_lines else 1), None

    def add_insert(after_idx: int, lines: list[str]) -> None:
        body = "\n".join(lines).strip("\n")
        if not body.strip():
            return
        page, after = anchor_before(after_idx)
        E.add_insert(edits, page, after, body)
        report["inserted"] += 1

    def hide(block_id: str) -> None:
        b = blocks_by_id.get(block_id)
        if not b:
            return
        if b.get("kind") == "insert":
            E.remove_insert(edits, block_id)
            report["removed"] += 1
        elif not b.get("hidden"):
            E.set_block(edits, block_id, hidden=True)
            report["hidden"] += 1

    sm = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag == "delete":
            for i in range(i1, i2):
                if old_lines[i].get("block"):
                    hide(old_lines[i]["block"])
            continue
        if tag == "insert":
            add_insert(i1, new[j1:j2])
            continue
        # replace: pair old block-lines with new lines where we can
        old_idx = [i for i in range(i1, i2) if old_lines[i].get("block")]
        new_seg = [l for l in new[j1:j2]]
        if (
            len(old_idx) == 1
            and len(new_seg) >= 1
            and blocks_by_id.get(old_lines[old_idx[0]]["block"], {}).get("kind") == "insert"
        ):
            E.update_insert(edits, old_lines[old_idx[0]]["block"], "\n".join(new_seg).strip("\n"))
            report["updated"] += 1
            continue
        new_nonblank = [l for l in new_seg if l.strip()]
        if len(old_idx) == len(new_nonblank):
            for i, nl in zip(old_idx, new_nonblank):
                bid = old_lines[i]["block"]
                blk = blocks_by_id.get(bid, {})
                parsed = _parse_md_line(nl)
                if blk.get("kind") == "text" and parsed["text"] == (blk.get("text") or "").strip():
                    fields = {
                        k: parsed[k]
                        for k in ("role", "level", "depth", "bold", "italic")
                        if parsed[k] != blk.get(k)
                    }
                    if fields:
                        E.set_block(edits, bid, **fields)
                        report["shaped"] += 1
                else:
                    hide(bid)
                    page, _ = anchor_before(i + 1)
                    E.add_insert(edits, page, bid, nl)
                    report["inserted"] += 1
            continue
        for i in old_idx:
            hide(old_lines[i]["block"])
        add_insert(i2, new_seg)

    E.save(path, edits)
    write_markdown(ws, doc_id)
    return report
