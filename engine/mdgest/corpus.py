"""A corpus index over a folder of converted markdown.

The index is itself markdown: per document, its title, page count and heading
outline with GitHub-style anchors, plus the first line under each top section
taken verbatim — nothing here writes prose.

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


def index_entries(ws: Workspace, folder: str) -> list[dict]:
    base = ws.markdown / folder if folder else ws.markdown
    entries = []
    for md_path in sorted(base.rglob("*.md")):
        if md_path.name == "INDEX.md":
            continue
        rel = md_path.relative_to(base).with_suffix("")
        doc_id = str(PurePosixPath(folder) / rel.as_posix()) if folder else rel.as_posix()
        text = md_path.read_text("utf-8")
        pages = text.count("\n---\n") + 1
        words = len(text.split())
        entries.append(
            {
                "doc": doc_id,
                "rel": rel.as_posix(),
                "title": next(
                    (h["text"] for h in outline(text) if h["level"] == 1), Path(doc_id).name
                ),
                "pages": pages,
                "words": words,
                "outline": outline(text),
            }
        )
    return entries


def index_markdown(ws: Workspace, folder: str) -> str:
    entries = index_entries(ws, folder)
    name = folder or "workspace"
    lines = [
        f"# Index — {name}",
        "",
        f"{len(entries)} documents. Cite as `[[doc:{name}/<path>#<anchor>]]`.",
        "",
    ]
    for e in entries:
        lines.append(f"## {e['title']}")
        lines.append("")
        lines.append(
            f"- doc: `{e['rel']}` · {e['pages']} pages · {e['words']} words · [open]({e['rel']}.md)"
        )
        for h in e["outline"]:
            if h["level"] == 1:
                continue
            indent = "  " * (h["level"] - 1)
            lead = f" — {h['lead']}" if h["lead"] else ""
            lines.append(f"{indent}- [{h['text']}]({e['rel']}.md#{h['anchor']}){lead}")
        lines.append("")
    return "\n".join(lines)
