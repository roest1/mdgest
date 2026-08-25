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
    assert result["learned"][0]["hide"]["key"]
    assert not result["learned"][0]["hide"].get("declined")

    ops.analyze(ws, b, force=True)
    assert "Copyright" not in ws.md_path(b).read_text()


def test_learning_a_hide_on_body_wording_declines_the_generalization(ws):
    """The bug. The block the person clicked is still hidden — what is
    declined is letting it reach documents they have not looked at."""
    a, b = _corpus(ws)
    result = ops.set_block(ws, a, _block(ws, a, "Key Points"), hidden=True, learn="manuals")
    hide = result["learned"][0]["hide"]
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
    assert result["learned"][0]["hide"].get("removed") is True


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


# ---- learned-only suggestions -------------------------------------------------


def test_nothing_is_suggested_until_something_has_been_hidden(ws):
    """The whole point. mdgest never decides on its own that wording is
    furniture — repetition is not evidence, a person's decision is."""
    a, _ = _corpus(ws)
    result = ops.suggest_hides(ws, "manuals")
    assert result["learned_from"] == {}
    assert result["suggestions"] == []


def test_hiding_the_footer_suggests_the_header_set_the_same_way(ws):
    """The fixtures print a header and a footer in the same size and face, in
    opposite margins. Hiding one is evidence about the other — and the pattern
    is how they are *set*, so it carries without keying on anyone's words."""
    a, b = _corpus(ws)
    ops.hide(ws, a, _block(ws, a, "Copyright"), scope="folder")

    suggestions = ops.suggest_hides(ws, "manuals")["suggestions"]
    assert [s["text"] for s in suggestions] == ["Widget Corp - Internal Use Only"]
    only = suggestions[0]
    assert only["scope"] == "folder"  # margin furniture on several pages
    assert only["margin"]
    assert only["occurrences"] == 4  # both pages of both documents
    assert not only["flagged"]


def test_what_is_already_hidden_is_not_suggested_again(ws):
    a, _ = _corpus(ws)
    ops.hide(ws, a, _block(ws, a, "Copyright"), scope="folder")
    ops.hide(ws, a, _block(ws, a, "Widget Corp"), scope="folder")

    assert ops.suggest_hides(ws, "manuals")["suggestions"] == []


def test_hiding_body_text_does_not_propose_the_page_furniture(ws):
    """A pattern learned from a bold run-in label says nothing about an 8pt
    footer. Suggestions follow the setting, not mere repetition."""
    a, _ = _corpus(ws)
    ops.hide(ws, a, _block(ws, a, "Key Points"), scope="document")

    texts = [s["text"] for s in ops.suggest_hides(ws, "manuals")["suggestions"]]
    assert not any("Copyright" in t or "Widget Corp" in t for t in texts)


def test_suggestions_never_apply_themselves(ws):
    a, b = _corpus(ws)
    ops.hide(ws, a, _block(ws, a, "Copyright"), scope="folder")
    before = ws.md_path(b).read_text()
    ops.suggest_hides(ws, "manuals")
    assert ws.md_path(b).read_text() == before
    assert "Widget Corp" in ws.md_path(b).read_text()


# ---- what a folder wants done with page numbers ------------------------------


def test_page_numbers_are_left_alone_by_default(ws):
    """The default changes nothing. Removing content silently on a default is
    the one thing this engine tries never to do."""
    a, _ = _corpus(ws)
    assert ops.get_settings(ws, "manuals")["effective"]["page_numbers"] == "keep"
    assert "Page 1" in ws.md_path(a).read_text()


def test_hide_drops_them(ws):
    a, _ = _corpus(ws)
    ops.set_setting(ws, "manuals", "page_numbers", "hide")
    md = ws.md_path(a).read_text()
    assert "Page 1" not in md and "Page 2" not in md
    assert "Copyright" in md  # other furniture is untouched


def test_mark_records_the_printed_number_without_touching_the_outline(ws):
    """A comment, not a heading: the anchors `corpus.py` builds for citation
    come from headings, and a page number has no business among them."""
    from mdgest import corpus

    a, _ = _corpus(ws)
    ops.set_setting(ws, "manuals", "page_numbers", "mark")
    md = ws.md_path(a).read_text()
    assert "<!-- page 1 -->" in md and "<!-- page 2 -->" in md
    assert "Page 1" not in md.replace("<!-- page 1 -->", "")
    assert not any("page" in h["anchor"] for h in corpus.outline(md))


def test_the_deeper_folder_wins(ws):
    a, _ = _corpus(ws)
    ops.set_setting(ws, "", "page_numbers", "hide")
    ops.set_setting(ws, "manuals", "page_numbers", "mark")
    assert ops.get_settings(ws, a)["effective"]["page_numbers"] == "mark"
    assert "<!-- page 1 -->" in ws.md_path(a).read_text()


def test_a_setting_can_be_cleared_so_the_parent_speaks_again(ws):
    a, _ = _corpus(ws)
    ops.set_setting(ws, "", "page_numbers", "hide")
    ops.set_setting(ws, "manuals", "page_numbers", "keep")
    assert ops.get_settings(ws, a)["effective"]["page_numbers"] == "keep"
    ops.set_setting(ws, "manuals", "page_numbers", None)
    assert ops.get_settings(ws, a)["effective"]["page_numbers"] == "hide"


def test_a_bad_policy_is_refused(ws):
    _corpus(ws)
    with pytest.raises(ValueError, match="page_numbers must be"):
        ops.set_setting(ws, "manuals", "page_numbers", "delete")
    with pytest.raises(ValueError, match="unknown setting"):
        ops.set_setting(ws, "manuals", "color", "blue")


def test_the_policy_is_reported_but_never_counted_as_someone_hiding(ws):
    """`hidden_by_rule` exists to catch content that vanished by a decision
    nobody saw. A folder setting is not that — it is explicit and visible —
    and under `mark` the number is recorded rather than removed."""
    from mdgest import edits as E
    from mdgest import fidelity

    a, _ = _corpus(ws)
    for policy in ("hide", "mark"):
        ops.set_setting(ws, "manuals", "page_numbers", policy)
        report = fidelity.check(ws.read_analysis(a), E.load(ws.edits_path(a)))
        assert report.page_numbers == policy
        assert report.hidden_by_rule == []
        assert report.hidden_words == 0
        assert report.passed
        assert f"page numbers: {policy}" in report.render()


@pytest.mark.parametrize(
    "text,expected",
    [
        ("12", "12"),
        ("Page 12", "12"),
        ("page iv", "iv"),
        ("IV", "iv"),
        ("- 12 -", "12"),
        ("12 of 40", "12"),
        ("p. 7", "7"),
        # words made only of roman-numeral letters, which `[ivxlcdm]+` eats
        ("civil", None),
        ("mill", None),
        ("did", None),
        # and things that merely contain a number
        ("Chapter 4", None),
        ("Copyright 2026 Fixture Press.", None),
        ("Widget Corp - Internal Use Only", None),
        ("", None),
    ],
)
def test_page_number_detection_discriminates(text, expected):
    from mdgest import pagenums

    assert pagenums.label(text) == expected


def test_a_number_in_the_body_is_not_a_page_number(ws):
    """`4` is a page number in the footer and a list item in the body, so
    position is checked before the pattern ever is."""
    a, _ = _corpus(ws)
    ops.set_setting(ws, "manuals", "page_numbers", "hide")
    md = ws.md_path(a).read_text()
    assert "Seat the frame plate flat on the jig." in md  # numbered item 1, intact
    assert md.count("Torque to spec") == 1


# ---- cost, at the scale a real corpus reaches --------------------------------


def test_a_shared_index_gives_the_same_answer_as_a_fresh_one(ws):
    """Building the index reads every analysis under the folder, which is most
    of the cost of asking. Hiding does not move a block, so a caller working
    through a list may build one and reuse it — but only if it answers the
    same."""
    a, b = _corpus(ws)
    block = _block(ws, a, "Copyright")
    fresh = ops.preview_hide(ws, a, block)
    shared = occurrences.Index.over(ws, "manuals")
    reused = ops.preview_hide(ws, a, block, index=shared)
    assert reused == fresh


def test_changing_a_setting_does_not_re_read_the_documents(ws):
    """A setting changes what is done with what was already read. Re-analyzing
    a corpus to move one policy is minutes of work for none of it, so this
    re-shapes the cached analyses instead — and `analyze` must not be reached.
    """
    a, _ = _corpus(ws)
    calls = []
    original = ops.analyze

    def spy(ws_, doc, force=False):
        calls.append((doc, force))
        return original(ws_, doc, force=force)

    ops.analyze = spy
    try:
        ops.set_setting(ws, "manuals", "page_numbers", "hide")
    finally:
        ops.analyze = original
    assert calls == []
    assert "Page 1" not in ws.md_path(a).read_text()


def test_a_setting_round_trips_exactly(ws):
    """`keep` has to put back what `hide` took away, or the cheap re-shape is
    not a substitute for re-reading the page."""
    a, _ = _corpus(ws)
    before = ws.md_path(a).read_text()

    ops.set_setting(ws, "manuals", "page_numbers", "hide")
    assert "Page 1" not in ws.md_path(a).read_text()
    ops.set_setting(ws, "manuals", "page_numbers", "mark")
    assert "<!-- page 1 -->" in ws.md_path(a).read_text()
    ops.set_setting(ws, "manuals", "page_numbers", "keep")

    assert ws.md_path(a).read_text() == before


def test_the_index_does_not_hold_every_analysis_at_once(ws):
    """It keeps a few fields per block, not the analysis they came from. One
    document is read, folded in and let go before the next is opened.

    Measured against the thing it replaced — reading every analysis into one
    dict and building from that — because on-disk JSON bytes and in-memory
    Python objects are not comparable quantities.
    """
    import tracemalloc

    _corpus(ws)
    docs = ws.docs("manuals")

    tracemalloc.start()
    streamed = occurrences.Index.over(ws, "manuals")
    streamed_peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()

    tracemalloc.start()
    everything = {d: ws.read_analysis(d) for d in docs}
    held = occurrences.Index.build(everything)
    held_peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()

    assert streamed.by_key.keys() == held.by_key.keys()  # same answer
    assert streamed_peak < held_peak, f"{streamed_peak} >= {held_peak}"
