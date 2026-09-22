"""The two readers, held to each other.

`pagemap.read` uses pdfium and cannot ship to a browser; `pdfjs.read` uses
pdf.js and is what the browser build will run. Two readers is two chances to
be wrong, and the failure mode is quiet: a box convention shifts, `structure`
measures a gutter differently, and a document nobody opened comes out in a
different order. Nothing else in the suite would notice, because everything
else takes `analysis.json` as given.

So this file pins the disagreement rather than the agreement. Where they
differ, they differ for a reason that is written down here, and the budget is
what stops a reason turning into a drift.

The pdf.js side is read from committed dumps under `tests/reader/`, so the
suite runs with no node and no browser. `test_the_dumps_reproduce` regenerates
them when node is there, which is the same bargain `test_fixtures.py` makes
about the PDFs themselves.
"""

import difflib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from mdgest import edits as E
from mdgest import emit, pagemap, pdfjs, structure

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures"
DUMPS = HERE / "reader"
ROOT = HERE.parent.parent

#: How many markdown lines the two readers may differ by, per document. Every
#: one of these is accounted for in `test_the_differences_are_the_known_ones`;
#: the number exists so that a *new* difference fails even when it is small.
BUDGET = {"doc-a": 0, "doc-b": 0, "doc-c": 8}

DOCS = sorted(BUDGET)


def markdown(pm) -> str:
    analysis = structure.analyze(pm)
    analysis["source"] = pm.source.name
    return emit.document_markdown(analysis, E.blank())["markdown"]


def both(doc: str) -> tuple[str, str]:
    """The same document read each way, as markdown."""
    fium = markdown(pagemap.read(FIXTURES / f"{doc}.pdf"))
    js = markdown(pdfjs.read(json.loads((DUMPS / f"{doc}.pdfjs.json").read_text())))
    return fium, js


def body_diff(a: str, b: str) -> list[str]:
    return [
        line
        for line in difflib.unified_diff(a.splitlines(), b.splitlines(), lineterm="", n=0)
        if line[:1] in "+-" and line[:3] not in ("---", "+++")
    ]


@pytest.mark.parametrize("doc", DOCS)
def test_the_headings_are_identical(doc):
    """Headings are the citation contract's raw material — `corpus.outline`
    slugs them into anchors that a `[[doc:...#anchor]]` token resolves
    against. A reader swap that moves a heading breaks every citation written
    before it, which no budget should ever absorb."""
    fium, js = both(doc)
    assert [l for l in fium.splitlines() if l.startswith("#")] == [
        l for l in js.splitlines() if l.startswith("#")
    ]


@pytest.mark.parametrize("doc", DOCS)
def test_the_disagreement_stays_inside_its_budget(doc):
    diff = body_diff(*both(doc))
    assert len(diff) <= BUDGET[doc], "\n".join(diff)


@pytest.mark.parametrize("doc", DOCS)
def test_neither_reader_loses_words(doc):
    """A difference in how lines are cut is survivable; a difference in which
    words arrive is not, because `fidelity` would score it as loss or
    invention and blame the engine for the reader."""
    fium = pagemap.read(FIXTURES / f"{doc}.pdf")
    js = pdfjs.read(json.loads((DUMPS / f"{doc}.pdfjs.json").read_text()))
    words = lambda pm: sorted(  # noqa: E731
        w for page in pm.pages for line in page.lines for w in line.text.split()
    )
    assert words(fium) == words(js)


def test_the_style_gap_is_pdfjs_reading_only_the_font_name():
    """`ABCDEF+FoundryText` is bold and `ABCDEF+FoundrySlant` is italic by
    their /FontDescriptor and by nothing else — no `Bold` in the name, no
    `Italic`. pdfium reads the descriptor. pdf.js decides both with a regex
    over the font name (`pdf.worker.mjs`: `this.bold = /bold/i.test(fontName)`)
    and never consults /Flags ForceBold or /ItalicAngle, though it parses both.

    This is pdf.js's blind spot, stated rather than absorbed. If pdf.js ever
    grows the descriptor path these assertions fail, which is the notification
    you want — the budget drops by four.
    """
    fium, js = both("doc-c")
    assert "**This line is bold by descriptor, not by name.**" in fium
    assert "*This line is italic by descriptor, not by name.*" in fium
    assert "This line is bold by descriptor, not by name." in js
    assert "**This line is bold by descriptor, not by name.**" not in js
    assert "*This line is italic by descriptor, not by name.*" not in js


def test_the_order_gap_is_pdfium_reading_the_page_number_into_a_column():
    """The other half of doc-c, and the half where pdf.js is right.

    `Page 1` is printed centred at x=300 — inside the gutter, below both
    columns — so it belongs after everything on the page. pdfium's boxes make
    the XY-cut take it into the left column's run and emit it before the right
    column ever starts; the ink-approximated boxes do not.

    Recorded, not fixed. The reader is not the place to repair a reading-order
    decision, and the golden is cut from the implementation that works today.
    The fixture exists so this is a line in a test instead of a surprise on
    somebody's two-column PDF.
    """
    fium, js = both("doc-c")
    fium_lines, js_lines = fium.splitlines(), js.splitlines()
    assert fium_lines.index("Page 1") < fium_lines.index("## Right Column")
    assert js_lines.index("Page 1") > js_lines.index("## Right Column")


def test_nothing_differs_but_those_two_things():
    """The budget says how many lines may differ; this says which ones."""
    diff = body_diff(*both("doc-c"))
    assert sorted(diff) == sorted(
        [
            "-Page 1",
            "-",
            "+",
            "+Page 1",
            "-**This line is bold by descriptor, not by name.**",
            "-*This line is italic by descriptor, not by name.*",
            "+This line is bold by descriptor, not by name.",
            "+This line is italic by descriptor, not by name.",
        ]
    ), "\n".join(diff)


def test_the_named_styles_survive_the_swap():
    """The blind spot is only the descriptor. A face that says `Oblique` or
    `Bold` in its name reads the same either way, which is the ordinary case
    and the reason the gap above is tolerable rather than disqualifying."""
    _, js = both("doc-c")
    assert "*This line is set italic and says so in its name.*" in js
    assert "**This line is bold and named for it.**" in js


def item(name: str, **tables) -> dict:
    """One text item, as `dump_pdfjs.mjs` writes it."""
    font = {"name": name, "ascent": 0.9, "descent": -0.21,
            "weight": None, "macStyle": None, "fsSelection": None, "italicAngle": None}
    font.update(tables)
    return {"str": "x", "transform": [10, 0, 0, 10, 0, 0], "width": 5, "height": 10, "font": font}


@pytest.mark.parametrize(
    "case, expected",
    [
        # A subset name says nothing; the face's own tables say everything.
        # This is the case the name heuristic was silently failing, and no
        # fixture reaches it because make_fixtures.py embeds no fonts.
        (item("ABCDEF+f-1-0", fsSelection=1 << 5), True),
        (item("ABCDEF+f-1-0", macStyle=1), True),
        (item("ABCDEF+f-1-0", weight=700), True),
        (item("ABCDEF+f-1-0", weight=400), False),
        # Tables present and negative outrank a name that claims otherwise:
        # a face called Bold that reports usWeightClass 400 and the REGULAR
        # bit is a renamed regular, and the page will look like one.
        (item("ABCDEF+FakeBold", fsSelection=1 << 6, weight=400), False),
        # usWeightClass 500 is what pdf.js synthesizes for a converted CFF, so
        # it is not evidence either way and the name gets its turn.
        (item("ABCDEF+Roboto-Bold", weight=500, fsSelection=0, macStyle=0), True),
        (item("ABCDEF+GillSansMT", weight=500, fsSelection=0, macStyle=0), False),
        # No tables at all -- a face neither embedded nor standard-14.
        (item("ABCDEF+FoundryText"), False),
        (item("Helvetica-Bold"), True),
        (item("Roboto,Bold"), True),
        (item("SomeFace-BD"), True),
    ],
)
def test_weight_reads_the_tables_before_the_name(case, expected):
    assert pdfjs._weight_of(case) is expected


@pytest.mark.parametrize(
    "case, expected",
    [
        (item("ABCDEF+f-1-0", fsSelection=1), True),
        (item("ABCDEF+f-1-0", macStyle=1 << 1), True),
        (item("ABCDEF+f-1-0", italicAngle=-12.0), True),
        (item("ABCDEF+f-1-0", fsSelection=1 << 6), False),
        (item("ABCDEF+FoundrySlant"), False),
        (item("Helvetica-Oblique"), True),
        (item("Charter-Italic"), True),
    ],
)
def test_slant_reads_the_tables_before_the_name(case, expected):
    assert pdfjs._slant_of(case) is expected


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_the_dumps_reproduce(tmp_path):
    """The committed dumps have to be what the script actually writes today,
    or the conformance above is checking a reader nobody runs."""
    for doc in DOCS:
        out = tmp_path / f"{doc}.json"
        result = subprocess.run(
            [
                "node",
                str(ROOT / "scripts" / "dump_pdfjs.mjs"),
                str(FIXTURES / f"{doc}.pdf"),
                str(out),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            pytest.skip(f"dump_pdfjs.mjs unavailable: {result.stderr.strip()[:200]}")
        assert json.loads(out.read_text()) == json.loads(
            (DUMPS / f"{doc}.pdfjs.json").read_text()
        ), f"{doc}: regenerating the dump changed it"


def test_every_fixture_has_a_dump():
    assert {p.name.removesuffix(".pdfjs.json") for p in DUMPS.glob("*.pdfjs.json")} == {
        p.stem for p in FIXTURES.glob("*.pdf")
    }


if __name__ == "__main__":  # a quick look at where they stand
    for doc in DOCS:
        d = body_diff(*both(doc))
        print(f"{doc}: {len(d)} differing markdown lines (budget {BUDGET[doc]})")
        for line in d:
            print("   ", line[:120])
    sys.exit(0)
