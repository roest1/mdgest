#!/usr/bin/env python3
"""Time and memory at the shape of a real corpus, not a two-page fixture.

Two pressures, and a change can be fine under one and terrible under the
other: many documents (an index over a folder, a setting applied across it)
and one long document (the payload the UI loads, the reading order of a dense
page). The default is around 60 documents of 17 pages plus one of 300, which
is the shape of a drive this was built against.

Every page is generated from `engine/tests/fixtures/make_fixtures.py`, so this
measures structure and contains nobody's documents.

    uv run --project engine python scripts/bench.py [--docs 60] [--pages 17]
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
import tracemalloc
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine" / "tests" / "fixtures"))


def build_pdf(path: Path, pages: int, subject: str) -> None:
    """A document of `pages` pages, each with a heading, body and furniture."""
    import make_fixtures as mf

    contents = []
    for i in range(pages):
        page = mf.Content()
        page.text(mf.LEFT, 740, mf.H1 if i == 0 else mf.H2, f"{subject} section {i + 1}", bold=True)
        for j in range(14):
            page.text(mf.LEFT, 700 - j * 14, mf.BODY, f"Line {j} of section {i + 1}, {subject}.")
        mf.furniture(page, i + 1)
        contents.append(page)

    pdf = mf.Pdf()
    plain = pdf.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    bold = pdf.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    resources = f"/Font << /F1 {plain} 0 R /F2 {bold} 0 R >>"
    pages_ref = len(pdf.objects) + 1 + 2 * len(contents)
    refs = []
    for content in contents:
        stream = pdf.stream("", content.render())
        refs.append(
            pdf.add(
                f"<< /Type /Page /Parent {pages_ref} 0 R /MediaBox [0 0 612 792] "
                f"/Resources << {resources} >> /Contents {stream} 0 R >>".encode()
            )
        )
    kids = " ".join(f"{r} 0 R" for r in refs)
    tree = pdf.add(f"<< /Type /Pages /Count {len(refs)} /Kids [{kids}] >>".encode())
    path.write_bytes(pdf.build(pdf.add(f"<< /Type /Catalog /Pages {tree} 0 R >>".encode())))


def took(label: str, call, runs: int = 3) -> float:
    start = time.perf_counter()
    for _ in range(runs):
        call()
    each = (time.perf_counter() - start) / runs
    print(f"  {label:<44}{each * 1000:9.1f} ms")
    return each


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--docs", type=int, default=60)
    parser.add_argument("--pages", type=int, default=17)
    parser.add_argument("--long", type=int, default=300, help="pages in the single long document")
    args = parser.parse_args()

    try:
        from mdgest import ops
        from mdgest.store import Workspace
    except ImportError:
        print("the engine is not here yet; this measures it once it is.", file=sys.stderr)
        return 0

    tmp = Path(tempfile.mkdtemp())
    sources = tmp / "src"
    sources.mkdir()
    ws = Workspace(tmp / "ws")

    start = time.perf_counter()
    docs = []
    folders = ["a/b/c", "a/b/d", "a/e", "f/g/h/i"]
    for i in range(args.docs):
        path = sources / f"doc-{i:02d}.pdf"
        build_pdf(path, args.pages, f"Widget{i:02d}")
        doc = ws.add_pdf(path.read_bytes(), path.name, folders[i % len(folders)])
        ops.analyze(ws, doc)
        docs.append(doc)
    long_path = sources / "long.pdf"
    build_pdf(long_path, args.long, "Long")
    long_doc = ws.add_pdf(long_path.read_bytes(), "long.pdf", "books")
    ops.analyze(ws, long_doc)
    print(
        f"corpus: {args.docs} docs of {args.pages}p + one of {args.long}p"
        f"  (ingested in {time.perf_counter() - start:.1f}s)\n"
    )

    print("many documents:")
    took("index over the whole workspace", lambda: _index(ws))
    took("verify the corpus", lambda: ops.verify_folder(ws, ""), runs=1)

    print("\none long document:")
    import json

    took("view (the payload the UI loads)", lambda: ops.view(ws, long_doc))
    size = len(json.dumps(ops.view(ws, long_doc))) / 1e6
    page = len(json.dumps(ops.page_view(ws, long_doc, 1))) / 1e6
    print(f"  {'view payload':<44}{size:9.2f} MB")
    print(f"  {'one page of it':<44}{page:9.4f} MB")

    print("\nmemory:")
    tracemalloc.start()
    _index(ws)
    peak = tracemalloc.get_traced_memory()[1] / 1e6
    tracemalloc.stop()
    print(f"  {'index peak':<44}{peak:9.1f} MB")
    return 0


def _index(ws):
    from mdgest import occurrences

    return occurrences.Index.over(ws, "")


if __name__ == "__main__":
    raise SystemExit(main())
