"""A workspace as a folder someone can keep, and read back to carry on.

There is no account and no server, so a project is a folder on a disk and
exporting one is what saving means. It has to survive being emailed, zipped by
Finder, unzipped by Explorer, and handed back through a file input, so the
format is three things and no more:

    my-project/
      mdgest.json     the manifest -- every decision, in one visible file
      sources/        the PDFs, exactly as they went in
      markdown/       what came out, with its figures

Nothing here is hidden. The working `.mdgest/` is a cache directory and stays
one; it is not the save format. A dot-directory in an *export* would be invisible
in the place a person keeps it, silently dropped by some `webkitdirectory`
uploads, and padded with `__MACOSX` by the mac zip tool -- three ways to lose
the only part that cannot be recomputed. A single visible file has none of
those failure modes and reads as what it is.

It fits in one file because of a decision this engine already made. A
document's precious state is its edits and its saved versions; measured on a
real 14-page report that is 5.7 kB against 76 kB of `analysis.json` and about
2.8 MB of page renders, both of which regenerate from the PDF. So the manifest
carries the 5.7 kB, the export carries the sources it came from, and a corpus
of sixty documents is a few hundred kilobytes of JSON.

Undo and redo stacks are dropped on the way out. They are the shape of one
working session, not a decision about a document, and they are most of what
makes `edits.json` large.

## What ports

`manifest`, `compare` and `apply` are pure: dicts in, dicts out, no file
system. They are the format, and they are what a browser build has to
reimplement against OPFS. `export_to` / `import_from` are the thin I/O
wrappers, and are the only part that changes when the workspace stops being a
directory. Keeping that line sharp is the same lesson `store.py` teaches by
failing to: its 63 lines of path algebra port anywhere and its 221 lines of I/O
do not.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from . import edits as E
from . import rules as R
from . import versions as V
from .store import Workspace

FORMAT = "mdgest-project"
#: Bump when a manifest written today would be misread by a reader written
#: against the previous shape. `compare` refuses a version it does not know
#: rather than guessing, because guessing here overwrites someone's decisions.
VERSION = 1
MANIFEST = "mdgest.json"

#: Session state, not decisions. See the module docstring.
DROPPED = ("undo", "redo")


def _edits_for_export(data: dict) -> dict:
    return {k: v for k, v in data.items() if k not in DROPPED}


def manifest(ws: Workspace, revision: int = 1) -> dict:
    """Everything about a workspace that a PDF cannot regenerate.

    `sha256` is what makes a re-import able to tell "this is the same document"
    from "the source under this name changed" -- the second of which quietly
    invalidates every edit, because a block id is `p{page}b{index}` and means
    nothing once the pages move.
    """
    documents: dict[str, dict] = {}
    for doc_id in ws.docs():
        entry: dict = {
            "sha256": ws.source_hash(doc_id),
            "edits": _edits_for_export(E.load(ws.edits_path(doc_id))),
        }
        pages = ws.page_count(doc_id)
        if pages is not None:
            entry["pages"] = pages
        saved = V.load(ws.versions_path(doc_id))
        if saved.get("versions"):
            entry["versions"] = saved
        documents[doc_id] = entry

    # Rules are per folder, deeper winning, and the folders that carry one are
    # sparse -- so store the ones that exist rather than walking the tree.
    learned: dict[str, dict] = {}
    for path in sorted(ws.cache.rglob("rules.json")):
        folder = str(path.parent.relative_to(ws.cache)).replace("\\", "/")
        learned["" if folder == "." else folder] = json.loads(path.read_text("utf-8"))

    return {
        "format": FORMAT,
        "version": VERSION,
        "revision": revision,
        "exported": datetime.now(UTC).isoformat(timespec="seconds"),
        "documents": documents,
        "rules": learned,
    }


@dataclass
class Comparison:
    """What importing this manifest would do to this workspace.

    There is no revision bookkeeping behind this and deliberately so. A counter
    only knows which export is newer; comparing the decisions themselves knows
    which documents would actually lose work, exactly, for the cost of a dict
    comparison. `conflicts` is the list worth putting in front of a person
    before anything is written.
    """

    added: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)  # here already, with different edits
    resourced: list[str] = field(default_factory=list)  # same id, a different PDF underneath

    @property
    def safe(self) -> bool:
        return not self.conflicts and not self.resourced


def compare(ws: Workspace, man: dict) -> Comparison:
    """What `apply` would change, without changing anything."""
    if man.get("format") != FORMAT:
        raise ValueError(f"not an mdgest project: {man.get('format')!r}")
    if man.get("version") != VERSION:
        raise ValueError(
            f"project format v{man.get('version')}, this engine reads v{VERSION}"
        )
    out = Comparison()
    here = set(ws.docs())
    for doc_id, entry in sorted(man.get("documents", {}).items()):
        if doc_id not in here:
            out.added.append(doc_id)
            continue
        digest = entry.get("sha256")
        if digest and ws.source_hash(doc_id) != digest:
            # The name is the same and the bytes are not, so the block ids the
            # incoming edits are keyed to describe a document that is no longer
            # underneath them. Never resolve this quietly.
            out.resourced.append(doc_id)
        elif _edits_for_export(E.load(ws.edits_path(doc_id))) != entry.get("edits"):
            out.conflicts.append(doc_id)
        else:
            out.unchanged.append(doc_id)
    return out


def apply(ws: Workspace, man: dict, *, documents: list[str] | None = None) -> list[str]:
    """Write a manifest's decisions into a workspace.

    Sources are not written here -- `import_from` puts those in place first,
    because the edits are only meaningful beside the PDF they were made
    against. Pass `documents` to take a subset, which is how a UI honors
    "keep mine" for the rows `compare` flagged.
    """
    wanted = man.get("documents", {})
    chosen = list(wanted) if documents is None else [d for d in documents if d in wanted]
    for doc_id in chosen:
        entry = wanted[doc_id]
        data = E.blank()
        data.update({k: v for k, v in (entry.get("edits") or {}).items() if k in data})
        path = ws.edits_path(doc_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=1, ensure_ascii=False), "utf-8")
        if entry.get("versions"):
            V.save(ws.versions_path(doc_id), entry["versions"])
        if entry.get("sha256"):
            # Trust it no further than the next read: writing it saves the
            # rehash, and `compare` already established the bytes match.
            hp = ws.source_hash_path(doc_id)
            hp.parent.mkdir(parents=True, exist_ok=True)
            hp.write_text(entry["sha256"], "utf-8")
    for folder, learned in (man.get("rules") or {}).items():
        R.save(ws.cache, folder, learned)
    return chosen


# ---- the I/O half -------------------------------------------------------
# Everything above is dicts. Everything below is a directory, and is the part a
# browser build replaces with OPFS and a zip.


def export_to(ws: Workspace, dest: Path, *, revision: int = 1, output_only: bool = False) -> Path:
    """Write the project to `dest`, which is created and must not be a workspace.

    `output_only` writes just `markdown/` -- what someone came for, to hand to
    whatever reads it next. The default writes the resumable project. Neither
    writes `renders/`: page images are cache, they are the bulk of a workspace,
    and they come back on demand.
    """
    dest.mkdir(parents=True, exist_ok=True)
    if (dest / ".mdgest").exists():
        raise ValueError(f"{dest} is a workspace, not an export target")
    if ws.markdown.exists():
        shutil.copytree(ws.markdown, dest / "markdown", dirs_exist_ok=True)
    if output_only:
        return dest
    if ws.sources.exists():
        shutil.copytree(ws.sources, dest / "sources", dirs_exist_ok=True)
    man = manifest(ws, revision=revision)
    (dest / MANIFEST).write_text(json.dumps(man, indent=1, ensure_ascii=False) + "\n", "utf-8")
    return dest


def read_manifest(src: Path) -> dict:
    """The manifest from an export directory, or from the file itself."""
    path = src / MANIFEST if src.is_dir() else src
    if not path.exists():
        raise ValueError(f"no {MANIFEST} in {src} -- a folder of PDFs, not a project?")
    return json.loads(path.read_text("utf-8"))


def looks_like_project(src: Path) -> bool:
    """Whether to offer "continue" or "add PDFs" for what was just dropped.

    One visible file at the root decides it, which is the whole reason the
    manifest is not hidden and not inferred from directory contents.
    """
    try:
        return read_manifest(src).get("format") == FORMAT
    except (ValueError, OSError, json.JSONDecodeError):
        return False


def import_from(ws: Workspace, src: Path, *, documents: list[str] | None = None) -> list[str]:
    """Restore a project into `ws`. Sources land first, then the decisions.

    Sources are copied to their recorded ids rather than through
    `store.add_pdf`, which slugs a filename and renames around a collision --
    right for an upload, wrong here. An id in a manifest is already the id its
    edits are keyed to, and inventing `pumps-2` beside `pumps` would resume
    nothing while looking like it had.
    """
    man = read_manifest(src)
    wanted = man.get("documents", {})
    chosen = list(wanted) if documents is None else [d for d in documents if d in wanted]
    for doc_id in chosen:
        pdf = src / "sources" / f"{doc_id}.pdf"
        if not pdf.exists():
            raise ValueError(f"{MANIFEST} lists {doc_id}, but sources/{doc_id}.pdf is missing")
        target = ws.source_path(ws.check_doc(doc_id))
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(pdf, target)
    md = src / "markdown"
    if md.exists():
        shutil.copytree(md, ws.markdown, dirs_exist_ok=True)
    return apply(ws, man, documents=chosen)


__all__ = [
    "FORMAT",
    "MANIFEST",
    "VERSION",
    "Comparison",
    "apply",
    "compare",
    "export_to",
    "import_from",
    "looks_like_project",
    "manifest",
    "read_manifest",
]
