"""How far a hide reaches, and who decides.

The fixtures give both cases in one corpus: a `Copyright …` footer printed in
the bottom band of every page of both documents (furniture), and a
`Key Points:` bold run-in printed twice in the body of each (a heading that
merely repeats). Telling those apart is the whole job.
"""

from pathlib import Path

import pytest

from mdgest import occurrences, ops
from mdgest.store import Workspace

FIXTURES = Path(__file__).parent / "fixtures"
DOC_A = FIXTURES / "doc-a.pdf"
DOC_B = FIXTURES / "doc-b.pdf"


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path / "ws")


def _corpus(ws) -> tuple[str, str]:
    a = ws.add_pdf(DOC_A.read_bytes(), "doc-a.pdf", "manuals")
    b = ws.add_pdf(DOC_B.read_bytes(), "doc-b.pdf", "manuals")
    ops.analyze(ws, a)
    ops.analyze(ws, b)
    return a, b


def _block(ws, doc: str, starts_with: str) -> str:
    return next(
        blk["id"]
        for page in ws.read_analysis(doc)["pages"]
        for blk in page["blocks"]
        if blk.get("text", "").startswith(starts_with)
    )


# ---- what the evidence proposes ---------------------------------------------


def test_margin_furniture_proposes_the_folder(ws):
    a, _ = _corpus(ws)
    preview = ops.preview_hide(ws, a, _block(ws, a, "Copyright"))
    assert preview["in_margin"]
    assert preview["proposed"]["scope"] == "folder"
    assert not preview["proposed"]["flagged"]
    assert len(preview["would_touch"]["folder"]) == 4  # both pages of both docs


def test_repeated_body_wording_stays_in_this_document_and_is_flagged(ws):
    """The expensive mistake: `Key Points:` repeats, but it is a heading, and
    deleting it across a folder removes real content that coverage cannot
    report (hiding takes the expectation with it)."""
    a, _ = _corpus(ws)
    preview = ops.preview_hide(ws, a, _block(ws, a, "Key Points"))
    assert not preview["in_margin"]
    assert preview["proposed"]["scope"] == "document"
    assert preview["proposed"]["flagged"]
    assert {o["doc"] for o in preview["would_touch"]["document"]} == {a}


def test_wording_printed_once_in_the_body_proposes_this_block_only(ws):
    a, _ = _corpus(ws)
    preview = ops.preview_hide(ws, a, _block(ws, a, "The assembly proceeds"))
    assert preview["proposed"]["scope"] == "block"
    # nothing to generalize: widening to the document would reach the same one
    assert len(preview["would_touch"]["document"]) == 1
    assert len(preview["would_touch"]["folder"]) == 1


def test_preview_changes_nothing(ws):
    a, _ = _corpus(ws)
    before = ws.md_path(a).read_text()
    ops.preview_hide(ws, a, _block(ws, a, "Copyright"))
    assert ws.md_path(a).read_text() == before
    assert not ws.edits_path(a).exists() or "hidden" not in ws.edits_path(a).read_text()


# ---- applying at a scope -----------------------------------------------------


def test_document_scope_hides_every_instance_here_and_none_elsewhere(ws):
    a, b = _corpus(ws)
    result = ops.hide(ws, a, _block(ws, a, "Key Points"), scope="document")
    assert result["scope"] == "document"
    assert len(result["blocks"]) == 2  # both printings in this document

    assert "Key Points" not in ws.md_path(a).read_text()
    assert "Key Points" in ws.md_path(b).read_text()  # untouched
    assert ops.list_rules(ws, a)[-1]["hide"] == []  # and no rule was written


def test_folder_scope_writes_a_rule_and_reaches_the_other_document(ws):
    a, b = _corpus(ws)
    ops.hide(ws, a, _block(ws, a, "Copyright"), scope="folder")
    ops.analyze(ws, b, force=True)

    assert "Copyright" not in ws.md_path(a).read_text()
    assert "Copyright" not in ws.md_path(b).read_text()
    assert any(h["key"] for r in ops.list_rules(ws, a) for h in r["hide"])


def test_block_scope_leaves_the_other_printing_standing(ws):
    a, _ = _corpus(ws)
    ops.hide(ws, a, _block(ws, a, "Key Points"), scope="block")
    assert ws.md_path(a).read_text().count("Key Points") == 1


def test_an_unknown_scope_is_refused(ws):
    a, _ = _corpus(ws)
    with pytest.raises(ValueError, match="unknown scope"):
        ops.hide(ws, a, _block(ws, a, "Copyright"), scope="everywhere")


# ---- the existing --learn path, which the web UI drives ----------------------


def test_learning_a_hide_on_margin_furniture_still_generalizes(ws):
    """The workflow that must keep working: hide the footer on the first
    document in a folder and every later one arrives with it gone."""
    a, b = _corpus(ws)
    result = ops.set_block(ws, a, _block(ws, a, "Copyright"), hidden=True, learn="manuals")
    assert result["learned"]["hide"]["key"]
    assert not result["learned"]["hide"].get("declined")

    ops.analyze(ws, b, force=True)
    assert "Copyright" not in ws.md_path(b).read_text()


def test_learning_a_hide_on_body_wording_declines_the_generalization(ws):
    """The bug. The block the person clicked is still hidden — what is
    declined is letting it reach documents they have not looked at."""
    a, b = _corpus(ws)
    result = ops.set_block(ws, a, _block(ws, a, "Key Points"), hidden=True, learn="manuals")
    hide = result["learned"]["hide"]
    assert hide["declined"] is True
    assert hide["scope"] == "document"
    assert "section heading" in hide["why"]

    ops.analyze(ws, a, force=True)
    ops.analyze(ws, b, force=True)
    assert "Key Points" in ws.md_path(b).read_text()  # never reached the other document
    assert ws.md_path(a).read_text().count("Key Points") == 1  # the clicked one still went


def test_unhiding_is_never_declined(ws):
    """Narrowing a decision is always safe; only widening one needs evidence."""
    a, _ = _corpus(ws)
    block = _block(ws, a, "Copyright")
    ops.set_block(ws, a, block, hidden=True, learn="manuals")
    result = ops.set_block(ws, a, block, hidden=False, learn="manuals")
    assert result["learned"]["hide"].get("removed") is True


# ---- the index itself --------------------------------------------------------


def test_the_index_skips_unanalyzed_documents(ws):
    """A preview must not trigger minutes of work on a document nobody has
    opened, so unanalyzed ones are absent rather than read."""
    a, _ = _corpus(ws)
    ws.add_pdf(DOC_A.read_bytes(), "doc-c.pdf", "manuals")  # added, not analyzed
    index = occurrences.Index.over(ws, "manuals")
    assert "manuals/doc-c" not in index.documents
    assert len(index.documents) == 2


def test_margin_is_judged_per_page_height(ws):
    a, _ = _corpus(ws)
    index = occurrences.Index.over(ws, "manuals")
    footer = index.evidence(next(k for k in index.by_key if k.startswith("copyright")))
    assert footer.in_margin
    body = index.evidence(next(k for k in index.by_key if k.startswith("key points")))
    assert not body.in_margin
