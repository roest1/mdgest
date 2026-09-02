"""The workspace on disk — a hierarchy of folders, each holding PDFs, mirrored
as markdown. Folders are just directories, any depth, so a client can shape
them however they think (manuals/hydraulics/pumps/...).

    <workspace>/
      sources/<folder...>/<doc>.pdf          what was uploaded
      markdown/<folder...>/<doc>.md          the output, same tree
                          /<doc>/NN-name.md  ...or a folder, when a file break split it
                                 /INDEX.md   the table of contents for that parse
                          /<doc>.assets/     extracted figures
                          /<folder>/INDEX.md a corpus index over a folder (mdgest index)
      .mdgest/<folder...>/<doc>/analysis.json   regenerable
                                 /edits.json     precious
                                 /page_count     regenerable; the tree reads it, not analysis.json
                                 /renders/       regenerable page images

A document's id is its path under sources/ without the extension, e.g.
`manuals/hydraulics/pumps/axial-piston`.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._ -]+")


def default_workspace() -> Path:
    env = os.environ.get("MDGEST_WORKSPACE")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.cwd() / "workspace").resolve()


def clean_segment(name: str) -> str:
    name = SAFE_SEGMENT.sub("-", name.strip()).strip(" .")
    name = re.sub(r"-{2,}", "-", name)
    return name or "untitled"


def clean_path(path: str) -> str:
    parts = [
        clean_segment(p)
        for p in PurePosixPath(path.replace("\\", "/")).parts
        if p not in ("", ".", "..", "/")
    ]
    return "/".join(parts)


def slug(name: str) -> str:
    name = name.lower()
    name = re.sub(r"[^a-z0-9]+", "-", name).strip("-")
    return name or "doc"


@dataclass
class Workspace:
    root: Path

    def __post_init__(self) -> None:
        self.root = Path(self.root)
        for d in ("sources", "markdown", ".mdgest"):
            (self.root / d).mkdir(parents=True, exist_ok=True)

    # ---- paths -----------------------------------------------------------
    @property
    def sources(self) -> Path:
        return self.root / "sources"

    @property
    def markdown(self) -> Path:
        return self.root / "markdown"

    @property
    def cache(self) -> Path:
        return self.root / ".mdgest"

    def source_path(self, doc_id: str) -> Path:
        return self.sources / f"{doc_id}.pdf"

    def md_path(self, doc_id: str) -> Path:
        """Where an unsplit document's markdown goes."""
        return self.markdown / f"{doc_id}.md"

    def md_dir(self, doc_id: str) -> Path:
        """Where a split document's parts go — a folder named for the PDF.

        A document that splits becomes a directory rather than a run of
        prefixed siblings, so it still moves, deletes and exports as one thing,
        and so `corpus.index_entries` -- which walks `*.md` and strips the
        suffix -- gives each part the citable id its path already spells.
        """
        return self.markdown / doc_id

    def md_paths(self, doc_id: str) -> list[Path]:
        """The parts this document wrote, in reading order — its own index is
        not one of them, or it would be numbered, indexed and cited as a part."""
        if self.md_dir(doc_id).is_dir():
            return sorted(p for p in self.md_dir(doc_id).glob("*.md") if p.name != "INDEX.md")
        return [self.md_path(doc_id)] if self.md_path(doc_id).exists() else []

    def doc_index_path(self, doc_id: str) -> Path:
        """The table of contents for a split document's parse."""
        return self.md_dir(doc_id) / "INDEX.md"

    def assets_dir(self, doc_id: str) -> Path:
        return self.markdown / f"{doc_id}.assets"

    def cache_dir(self, doc_id: str) -> Path:
        return self.cache / doc_id

    def analysis_path(self, doc_id: str) -> Path:
        return self.cache_dir(doc_id) / "analysis.json"

    def edits_path(self, doc_id: str) -> Path:
        return self.cache_dir(doc_id) / "edits.json"

    def page_count_path(self, doc_id: str) -> Path:
        """The page count on its own, beside the analysis it was taken from.

        `tree()` wants one integer per document, and `analysis.json` is 13.7 kB
        of pagemap: parsing all of it for `page_count` was 77 ms of the 141 ms a
        thousand-document tree cost, paid once a second for as long as a batch
        was analyzing.
        """
        return self.cache_dir(doc_id) / "page_count"

    def versions_path(self, doc_id: str) -> Path:
        return self.cache_dir(doc_id) / "versions.json"

    def renders_dir(self, doc_id: str) -> Path:
        return self.cache_dir(doc_id) / "renders"

    def _inside(self, path: Path, base: Path) -> bool:
        try:
            path.resolve().relative_to(base.resolve())
            return True
        except ValueError:
            return False

    def check_doc(self, doc_id: str) -> str:
        doc_id = clean_path(doc_id)
        if not doc_id or not self._inside(self.source_path(doc_id), self.sources):
            raise FileNotFoundError(doc_id)
        return doc_id

    # ---- folders ---------------------------------------------------------
    def mkdir(self, folder: str) -> str:
        folder = clean_path(folder)
        if not folder:
            raise ValueError("a folder needs a name")
        (self.sources / folder).mkdir(parents=True, exist_ok=True)
        (self.markdown / folder).mkdir(parents=True, exist_ok=True)
        return folder

    def rmdir(self, folder: str) -> None:
        folder = clean_path(folder)
        if not folder:
            raise ValueError("refusing to delete the workspace root")
        for base in (self.sources, self.markdown, self.cache):
            target = base / folder
            if target.exists():
                shutil.rmtree(target)

    def move(self, src: str, dst: str) -> str:
        """Move a folder or a document (by id) to a new path; returns the new id/path."""
        src, dst = clean_path(src), clean_path(dst)
        if self.source_path(src).exists():
            # a document
            for a, b in (
                (self.source_path(src), self.source_path(dst)),
                (self.md_path(src), self.md_path(dst)),
                (self.md_dir(src), self.md_dir(dst)),
                (self.assets_dir(src), self.assets_dir(dst)),
                (self.cache_dir(src), self.cache_dir(dst)),
            ):
                if a.exists():
                    b.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(a), str(b))
            return dst
        if (self.sources / src).is_dir():
            for base in (self.sources, self.markdown, self.cache):
                a, b = base / src, base / dst
                if a.exists():
                    b.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(a), str(b))
            return dst
        raise FileNotFoundError(src)

    # ---- documents -------------------------------------------------------
    def docs(self, folder: str = "") -> list[str]:
        base = self.sources / clean_path(folder) if folder else self.sources
        if not base.exists():
            return []
        return sorted(
            str(p.relative_to(self.sources).with_suffix("")).replace(os.sep, "/")
            for p in base.rglob("*.pdf")
        )

    def add_pdf(self, data: bytes, name: str, folder: str = "") -> str:
        folder = clean_path(folder)
        stem = slug(Path(name).stem)
        doc_id = f"{folder}/{stem}" if folder else stem
        target = self.source_path(doc_id)
        n = 2
        while target.exists():
            doc_id = f"{folder}/{stem}-{n}" if folder else f"{stem}-{n}"
            target = self.source_path(doc_id)
            n += 1
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return doc_id

    def add_zip(self, data: bytes | Path, folder: str = "") -> list[str]:
        """Unpack a zip of PDFs, keeping its directory structure under `folder`."""
        import io

        added: list[str] = []
        zf = zipfile.ZipFile(io.BytesIO(data) if isinstance(data, bytes) else data)
        for info in zf.infolist():
            if info.is_dir() or not info.filename.lower().endswith(".pdf"):
                continue
            if "__MACOSX" in info.filename or Path(info.filename).name.startswith("."):
                continue
            rel = PurePosixPath(info.filename)
            sub = "/".join(clean_segment(p) for p in rel.parts[:-1])
            target_folder = "/".join(p for p in (folder, sub) if p)
            added.append(self.add_pdf(zf.read(info), rel.name, target_folder))
        return added

    def add_path(self, path: Path, folder: str = "") -> list[str]:
        """Add a pdf, a zip, or a directory tree of pdfs."""
        path = Path(path)
        if path.is_dir():
            added: list[str] = []
            for p in sorted(path.rglob("*.pdf")):
                sub = "/".join(clean_segment(s) for s in p.relative_to(path).parent.parts)
                target = "/".join(x for x in (folder, sub) if x)
                added.append(self.add_pdf(p.read_bytes(), p.name, target))
            return added
        if path.suffix.lower() == ".zip":
            return self.add_zip(path, folder)
        if path.suffix.lower() == ".pdf":
            return [self.add_pdf(path.read_bytes(), path.name, folder)]
        raise ValueError(f"not a pdf, zip, or directory: {path}")

    def remove(self, doc_id: str) -> None:
        doc_id = self.check_doc(doc_id)
        for p in (self.source_path(doc_id), self.md_path(doc_id)):
            if p.exists():
                p.unlink()
        for d in (self.md_dir(doc_id), self.assets_dir(doc_id), self.cache_dir(doc_id)):
            if d.is_dir():
                shutil.rmtree(d)

    def has_analysis(self, doc_id: str) -> bool:
        return self.analysis_path(doc_id).exists()

    def read_analysis(self, doc_id: str) -> dict:
        return json.loads(self.analysis_path(doc_id).read_text("utf-8"))

    def write_analysis(self, doc_id: str, analysis: dict) -> None:
        p = self.analysis_path(doc_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(analysis, ensure_ascii=False), "utf-8")
        self._write_page_count(doc_id, analysis.get("page_count"))

    def _write_page_count(self, doc_id: str, count: object) -> None:
        if not isinstance(count, int):
            return
        p = self.page_count_path(doc_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        # Written aside and moved into place: analyses run on a worker thread
        # while the explorer reads the tree, and a half-written file would parse
        # as a smaller number rather than as nothing.
        tmp = p.with_name(p.name + ".tmp")
        tmp.write_text(str(count), "utf-8")
        tmp.replace(p)

    def page_count(self, doc_id: str) -> int | None:
        try:
            return int(self.page_count_path(doc_id).read_text("utf-8"))
        except (OSError, ValueError):
            pass
        # Analyzed before this file existed. Pay the full parse once and leave
        # the answer behind, so an old workspace costs it once per document
        # rather than once per document per tree.
        try:
            count = json.loads(self.analysis_path(doc_id).read_text("utf-8")).get("page_count")
        except (OSError, ValueError):
            return None
        self._write_page_count(doc_id, count)
        return count if isinstance(count, int) else None

    # ---- the tree --------------------------------------------------------
    def tree(self) -> dict:
        """Folders and documents as a nested tree for the explorer."""

        def node(rel: Path) -> dict:
            abs_dir = self.sources / rel
            folders = []
            docs = []
            for child in sorted(abs_dir.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
                if child.is_dir():
                    folders.append(node(rel / child.name))
                elif child.suffix.lower() == ".pdf":
                    doc_id = str(rel / child.stem).replace(os.sep, "/")
                    docs.append(self.doc_summary(doc_id))
            return {
                "name": rel.name or "",
                "path": str(rel).replace(os.sep, "/") if str(rel) != "." else "",
                "folders": folders,
                "docs": docs,
                "has_index": (self.markdown / rel / "INDEX.md").exists(),
            }

        return node(Path("."))

    def doc_summary(self, doc_id: str) -> dict:
        analysis = self.analysis_path(doc_id)
        analyzed = analysis.exists()
        pages = self.page_count(doc_id) if analyzed else None
        edited = False
        ep = self.edits_path(doc_id)
        complete = False
        if ep.exists():
            try:
                e = json.loads(ep.read_text("utf-8"))
                edited = bool(
                    e.get("blocks") or e.get("order") or e.get("inserts") or e.get("joins")
                )
                complete = bool(e.get("complete"))
            except Exception:
                pass
        return {
            "id": doc_id,
            "name": Path(doc_id).name,
            "folder": str(PurePosixPath(doc_id).parent) if "/" in doc_id else "",
            "pages": pages,
            "analyzed": analyzed,
            "edited": edited,
            "has_markdown": bool(self.md_paths(doc_id)),
            "parts": [p.name for p in self.md_paths(doc_id)] if self.md_dir(doc_id).is_dir() else [],
            "complete": complete,
        }
