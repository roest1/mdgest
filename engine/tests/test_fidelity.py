"""The gate, over the committed fixture corpus.

The interesting property under test is not "does it score 100%" — it is that
the four checks stay quiet for every legitimate thing a person can do to a
document, and speak up for the two things that would mean the engine lost or
invented content.
"""

from pathlib import Path

import pytest

from mdgest import edits as E
from mdgest import fidelity, ops
from mdgest.store import Workspace

FIXTURES = Path(__file__).parent / "fixtures"
DOC_A = FIXTURES / "doc-a.pdf"
DOC_B = FIXTURES / "doc-b.pdf"


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path / "ws")


def _added(ws, pdf: Path) -> str:
    doc = ws.add_pdf(pdf.read_bytes(), pdf.name, "x")
    ops.analyze(ws, doc)
    return doc


def _score(ws, doc: str) -> fidelity.Report:
    return fidelity.check(ws.read_analysis(doc), E.load(ws.edits_path(doc)))


@pytest.mark.parametrize("pdf", [DOC_A, DOC_B], ids=["doc-a", "doc-b"])
def test_a_freshly_read_document_is_whole(ws, pdf):
    """Nothing edited: every word on the page is in the markdown, and every
    word in the markdown is on the page."""
    report = _score(ws, _added(ws, pdf))
    assert report.coverage == pytest.approx(1.0)
    assert report.invented == []
    assert report.leaked == []
    assert report.untraceable_headings == []
    assert report.passed


def test_hiding_is_not_losing(ws):
    """A hidden block leaves the markdown *and* the expectation. Coverage that
    fell when someone hid a running header would train people to ignore it."""
    doc = _added(ws, DOC_A)
    block = next(b for b in ops.view(ws, doc)["pages"][0]["blocks"] if b.get("text"))
    ops.set_block(ws, doc, block["id"], hidden=True)

    report = _score(ws, doc)
    assert report.coverage == pytest.approx(1.0)
    assert report.passed
    assert block["text"] not in ws.md_path(doc).read_text()


def test_hidden_wording_that_survives_elsewhere_is_not_a_leak(ws):
    """The fixtures print the same footer on both pages. Hiding one copy must
    not report the other as a leak — the same wording legitimately occurs
    twice, and only wording hidden *everywhere* can leak."""
    doc = _added(ws, DOC_A)
    analysis = ws.read_analysis(doc)
    footer = next(
        b for b in analysis["pages"][0]["blocks"] if b.get("text", "").startswith("Copyright")
    )
    ops.set_block(ws, doc, footer["id"], hidden=True)

    report = _score(ws, doc)
    assert report.leaked == []
    assert report.passed


def test_inserted_words_are_counted_but_never_called_invention(ws):
    """Text a person typed is the one thing in the output that is not on the
    page. It is reported, so the share of the document that is not the
    document is visible — but it is not a fidelity failure."""
    doc = _added(ws, DOC_A)
    ops.insert_text(ws, doc, page=1, after=None, text="Zyzzyx quorbulent frobnication")

    report = _score(ws, doc)
    assert report.inserted_words == 3
    assert report.invented == []
    assert report.passed


def test_a_heading_joined_across_the_page_is_untraceable(ws):
    """Joining two blocks that are not printed together makes a heading whose
    wording appears on no page in that order. Coverage cannot see this — every
    word is still present — which is exactly why the check exists."""
    doc = _added(ws, DOC_A)
    blocks = [b for b in ops.view(ws, doc)["pages"][0]["blocks"] if b.get("text")]
    ops.join_blocks(ws, doc, blocks[3]["id"], blocks[0]["id"])
    ops.set_block(ws, doc, blocks[0]["id"], role="heading", level=2)

    report = _score(ws, doc)
    assert report.coverage == pytest.approx(1.0)
    assert report.untraceable_headings == ["Widget Assembly Manual Required Parts"]
    assert not report.passed


def test_a_heading_joined_from_neighbouring_lines_stays_traceable(ws):
    """The converse, and the reason the check is not just "did anyone join":
    blocks that *are* printed one after another read as one heading on the
    page, so joining them is honest and must not be flagged."""
    doc = _added(ws, DOC_A)
    blocks = [b for b in ops.view(ws, doc)["pages"][0]["blocks"] if b.get("text")]
    ops.join_blocks(ws, doc, blocks[1]["id"], blocks[0]["id"])
    ops.set_block(ws, doc, blocks[0]["id"], role="heading", level=2)

    joined = blocks[0]["text"] + " " + blocks[1]["text"]
    assert joined in ws.md_path(doc).read_text()
    report = _score(ws, doc)
    assert report.untraceable_headings == []
    assert report.passed


def test_invention_is_caught(ws):
    """Words in the output that are on no page and in no insert.

    This cannot be produced through the API — a block's `text` is read off the
    page and `edits.BLOCK_FIELDS` has no `text`, so nothing can rewrite it.
    That is the invariant this check defends, so the test asserts against a
    hand-built analysis that violates it directly. A real failure here means
    the engine regressed, not that the document is unusual.
    """
    analysis = {
        "version": 1,
        "source": "synthetic.pdf",
        "body_size": 10.0,
        "page_count": 1,
        "pages": [
            {
                "n": 1,
                "width": 612.0,
                "height": 792.0,
                "lines": [
                    {
                        "text": "Hex bolts",
                        "bbox": [72, 700, 200, 712],
                        "size": 10.0,
                        "bold": False,
                        "italic": False,
                        "font": "Helvetica",
                    }
                ],
                "pictures": [],
                "blocks": [
                    {
                        "id": "p1b0",
                        "kind": "text",
                        "page": 1,
                        "bbox": [72, 700, 200, 712],
                        "lines": [0],
                        "text": "Hex bolts and a smuggled clause",
                        "role": "para",
                        "level": 0,
                        "depth": 0,
                        "bold": False,
                        "italic": False,
                        "marker": "",
                        "size": 10.0,
                        "font": "Helvetica",
                        "picture": -1,
                    }
                ],
            }
        ],
    }
    report = fidelity.check(analysis, E.blank())
    invented = dict(report.invented)
    assert set(invented) == {"and", "a", "smuggled", "clause"}
    assert not report.passed
    assert "smuggled" in report.render()


@pytest.mark.parametrize(
    "heading,lines,expected",
    [
        # the ordinary case: a heading wrapped over two consecutive lines
        ("body region arms", [["body", "region"], ["arms"]], True),
        # what the substring and column readings both miss: a `Notes:` label
        # in the margin, printed at a baseline between the heading's halves
        ("body region arms", [["body", "region"], ["notes"], ["arms"]], True),
        # two intruders is still one heading; three is a scattering
        ("body region arms", [["body", "region"], ["a"], ["b"], ["arms"]], True),
        ("body region arms", [["body", "region"], ["a"], ["b"], ["c"], ["arms"]], False),
        # the same words in another order are not this heading
        ("body region arms", [["arms"], ["body", "region"]], False),
        # a partial line is not a match: the heading's words must arrive whole
        ("body region arms", [["body", "regionalism"], ["arms"]], False),
        ("", [["body"]], False),
    ],
)
def test_printed_together_discriminates(heading, lines, expected):
    """Unit-tested directly: through `check` the plain substring reading
    short-circuits this fallback on any page simple enough to build as a
    fixture, and the cases it exists for are exactly the ones that are not."""
    assert fidelity._printed_together(heading.split(), lines) is expected


def test_report_renders_a_verdict(ws):
    report = _score(ws, _added(ws, DOC_A))
    text = report.render()
    assert text.startswith("coverage: 100.00%")
    assert "PASS" in text


def test_verify_folder_reports_worst_first(ws):
    """The shape CI wants: every document under a folder, failures at the top."""
    good = _added(ws, DOC_B)
    bad = _added(ws, DOC_A)
    blocks = [b for b in ops.view(ws, bad)["pages"][0]["blocks"] if b.get("text")]
    ops.join_blocks(ws, bad, blocks[3]["id"], blocks[0]["id"])
    ops.set_block(ws, bad, blocks[0]["id"], role="heading", level=2)

    result = ops.verify_folder(ws, "")
    assert result["documents"] == 2
    assert result["failed"] == 1
    assert result["reports"][0]["doc"] == bad
    assert result["reports"][1]["doc"] == good


def test_verify_exits_nonzero_so_ci_can_gate(ws, monkeypatch):
    from typer.testing import CliRunner

    from mdgest.cli import app

    monkeypatch.setenv("MDGEST_WORKSPACE", str(ws.root))
    doc = _added(ws, DOC_A)
    runner = CliRunner()

    assert runner.invoke(app, ["verify"]).exit_code == 0

    blocks = [b for b in ops.view(ws, doc)["pages"][0]["blocks"] if b.get("text")]
    ops.join_blocks(ws, doc, blocks[3]["id"], blocks[0]["id"])
    ops.set_block(ws, doc, blocks[0]["id"], role="heading", level=2)

    result = runner.invoke(app, ["verify"])
    assert result.exit_code == 1
    assert "FAIL" in result.stdout
    assert "Widget Assembly Manual Required Parts" in result.stdout
