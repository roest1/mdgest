"""How does an agent find the passage it needs without reading the corpus?

Two indexes, because a long document parsed into a dozen files is a corpus of
its own. A **folder index** lists documents; a **document index** lists the
parts one PDF was split into. An agent reads one small file, then one more,
then the passage — rather than every heading in the folder to find one section.

Both are markdown, and neither writes prose: a title, a page count, a heading
outline with anchors, and the first line under each section taken verbatim.

mdgest owns one half of the citation contract: every emitted heading gets a
stable, unique anchor, and a citable id is the document's folder-relative path
minus `.md`. Resolving those tokens against a corpus needs a model in the loop
and lives in the asking tool. The grammar is in docs/app.md.
"""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

from .store import Workspace

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[‘’“”]", "", text)
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text or "section"


def outline(md: str) -> list[dict]:
    seen: dict[str, int] = {}
    out: list[dict] = []
    lines = md.splitlines()
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line)
        if not m:
            continue
        base = slugify(m.group(2))
        n = seen.get(base, 0)
        seen[base] = n + 1
        anchor = base if n == 0 else f"{base}-{n}"
        # lead: first non-empty, non-heading line after it
        lead = ""
        for nxt in lines[i + 1 : i + 12]:
            s = nxt.strip()
            if s and not s.startswith("#") and s != "---" and not s.startswith("!["):
                lead = re.sub(r"[*_`]", "", s)[:140]
                break
        out.append(
            {
                "level": len(m.group(1)),
                "text": m.group(2),
                "anchor": anchor,
                "line": i + 1,
                "lead": lead,
            }
        )
    return out


def title_of(md: str, fallback: str) -> str:
    """The name a file goes into an index under.

    Any heading, not only an H1. A part cut out of the middle of a document has
    no H1 -- the document's title went to the first part -- and titling it by
    its filename put `03-required-parts` in front of an agent choosing what to
    read, which is the one job an index has.
    """
    heads = outline(md)
    return heads[0]["text"] if heads else fallback


def _part(ws: Workspace, path: Path, link: str, doc_id: str) -> dict:
    text = path.read_text("utf-8")
    return {
        "rel": link,
        "file": path.name,
        "id": f"{doc_id}/{path.stem}",
        "title": title_of(text, path.stem),
        "words": len(text.split()),
        "outline": outline(text),
    }


def index_entries(ws: Workspace, folder: str = "") -> list[dict]:
    """One entry per document — never one per file.

    A document is what a person converted and what they cite; the files are how
    it came out. Walking `*.md` instead counted a course split into six parts as
    six documents sitting beside the module next to it.
    """
    base = ws.markdown / folder if folder else ws.markdown
    entries = []
    for doc_id in ws.docs(folder):
        paths = ws.md_paths(doc_id)
        if not paths:
            continue
        rel = PurePosixPath(doc_id).relative_to(folder) if folder else PurePosixPath(doc_id)
        parts = [
            _part(ws, p, p.relative_to(base).as_posix(), doc_id) for p in paths
        ]
        split = ws.md_dir(doc_id).is_dir()
        entries.append(
            {
                "doc": doc_id,
                "rel": rel.as_posix(),
                "title": parts[0]["title"],
                "split": split,
                "index": f"{rel.as_posix()}/INDEX.md" if split else None,
                "parts": parts,
                "words": sum(p["words"] for p in parts),
            }
        )
    return entries


def index_markdown(ws: Workspace, folder: str = "") -> str:
    """The folder index: what documents are here, and where to look next.

    A split document is one entry pointing at its own index rather than a dozen
    inlined outlines. Twelve modules of twelve sections is 144 headings flat and
    twelve lines here, and an agent that has to read all 144 to choose one is
    doing the thing the index exists to prevent.
    """
    entries = index_entries(ws, folder)
    name = folder or "workspace"
    files = sum(len(e["parts"]) for e in entries)
    lines = [
        f"# Index — {name}",
        "",
        f"{len(entries)} documents in {files} files. Cite as `[[doc:<path>#<anchor>]]`,"
        " where the path is what is printed below.",
        "",
    ]
    for e in entries:
        lines.append(f"## {e['title']}")
        lines.append("")
        if e["split"]:
            lines.append(
                f"- {len(e['parts'])} parts · {e['words']} words ·"
                f" [contents]({e['index']})"
            )
            for n, part in enumerate(e["parts"], 1):
                lines.append(f"  {n}. [{part['title']}]({part['rel']}) — `{part['rel'][:-3]}`")
        else:
            part = e["parts"][0]
            lines.append(f"- doc: `{e['rel']}` · {part['words']} words · [open]({part['rel']})")
            for h in part["outline"]:
                if h["level"] == 1:
                    continue
                indent = "  " * (h["level"] - 1)
                lead = f" — {h['lead']}" if h["lead"] else ""
                lines.append(f"{indent}- [{h['text']}]({part['rel']}#{h['anchor']}){lead}")
        lines.append("")
    return "\n".join(lines)


def document_index(ws: Workspace, doc_id: str) -> str:
    """The document index: the table of contents for one PDF's parse.

    Written beside the parts, so the folder it lives in explains itself without
    anything outside it. Links are relative to that folder; the ids are
    workspace-relative, because which prefix a citation carries depends on which
    folder was indexed and only the full path is true either way.
    """
    paths = ws.md_paths(doc_id)
    parts = [_part(ws, p, p.name, doc_id) for p in paths]
    name = Path(doc_id).name
    lines = [
        f"# {parts[0]['title'] if parts else name} — contents",
        "",
        f"`{name}.pdf` in {len(parts)} parts, {sum(p['words'] for p in parts)} words,"
        " in reading order. Cite a section as `[[doc:<id>#<anchor>]]`.",
        "",
    ]
    for n, part in enumerate(parts, 1):
        lines.append(f"## {n}. {part['title']}")
        lines.append("")
        lines.append(f"- [{part['file']}]({part['rel']}) · {part['words']} words · `{part['id']}`")
        for h in part["outline"]:
            if h["level"] == 1:
                continue  # the document's own title, already this part's name
            indent = "  " * max(0, h["level"] - 1)
            lead = f" — {h['lead']}" if h["lead"] else ""
            lines.append(f"{indent}- [{h['text']}]({part['rel']}#{h['anchor']}){lead}")
        lines.append("")
    return "\n".join(lines)
