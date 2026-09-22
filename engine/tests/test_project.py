"""Export as save, and read back to carry on.

There is no account and no server: a project is a folder, and exporting one is
the only thing that makes a decision survive the browser storage it was made
in. So the format has two jobs -- carry everything a PDF cannot regenerate,
and never quietly overwrite a decision on the way back in.
"""

from pathlib import Path

import pytest

from mdgest import edits as E
from mdgest import ops, project, render
from mdgest.store import Workspace

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path / "ws")


@pytest.fixture
def corpus(ws):
    a = ws.add_pdf((FIXTURES / "doc-a.pdf").read_bytes(), "doc-a.pdf", "manuals")
    b = ws.add_pdf((FIXTURES / "doc-b.pdf").read_bytes(), "doc-b.pdf", "manuals")
    ops.analyze(ws, a)
    ops.analyze(ws, b)
    return ws, a, b


def _first_block(ws, doc: str) -> str:
    return ws.read_analysis(doc)["pages"][0]["blocks"][0]["id"]


# ---- what the export is -----------------------------------------------------


def test_the_export_shows_only_what_a_person_put_in(corpus, tmp_path):
    """Three entries at the root, none of them hidden. Anything invisible here
    is something a file input or a zip tool can drop without saying so, and
    what it would drop is the only irreplaceable part."""
    ws, a, _ = corpus
    ops.set_block(ws, a, _first_block(ws, a), role="heading", level=2)
    out = project.export_to(ws, tmp_path / "out")

    assert sorted(p.name for p in out.iterdir()) == ["markdown", "mdgest.json", "sources"]
    assert not any(p.name.startswith(".") for p in out.rglob("*"))


def test_renders_are_not_in_the_export(corpus, tmp_path):
    """Page images are cache and are the bulk of a workspace. They come back on
    demand, and carrying them would roughly double what a person stores."""
    ws, a, _ = corpus
    render.render_page(ws.source_path(a), ws.renders_dir(a), 1)
    assert list(ws.renders_dir(a).glob("*.png")), "the fixture should have rendered one"
    out = project.export_to(ws, tmp_path / "out")
    assert not list(out.rglob("renders"))
    assert not list(out.rglob("*.png")) or all(
        "markdown" in str(p) for p in out.rglob("*.png")
    )


def test_undo_stacks_do_not_survive_the_export(corpus, tmp_path):
    """A working session's undo history is not a decision about a document, and
    it is most of what makes edits.json big."""
    ws, a, _ = corpus
    block = _first_block(ws, a)
    for level in (2, 3, 4):
        ops.set_block(ws, a, block, role="heading", level=level)
    assert E.load(ws.edits_path(a))["undo"], "the fixture should have built a stack"

    man = project.manifest(ws)
    assert man["documents"][a]["edits"]["blocks"][block]["level"] == 4
    assert "undo" not in man["documents"][a]["edits"]
    assert "redo" not in man["documents"][a]["edits"]


def test_output_only_is_just_the_markdown(corpus, tmp_path):
    ws, _, _ = corpus
    out = project.export_to(ws, tmp_path / "out", output_only=True)
    assert [p.name for p in out.iterdir()] == ["markdown"]
    assert not (out / project.MANIFEST).exists()


# ---- coming back ------------------------------------------------------------


def test_a_round_trip_restores_the_decisions(corpus, tmp_path):
    ws, a, b = corpus
    block = _first_block(ws, a)
    ops.set_block(ws, a, block, role="heading", level=3, bold=True)
    before = ws.md_path(a).read_text()

    project.export_to(ws, tmp_path / "out")
    fresh = Workspace(tmp_path / "fresh")
    restored = project.import_from(fresh, tmp_path / "out")

    assert sorted(restored) == sorted([a, b])
    assert E.load(fresh.edits_path(a))["blocks"][block] == {
        "role": "heading",
        "level": 3,
        "bold": True,
    }
    # The markdown came across, and re-deriving it from the restored edits
    # reproduces it -- the decisions arrived, not just their output.
    assert fresh.md_path(a).read_text() == before
    ops.analyze(fresh, a, force=True)
    ops.write_markdown(fresh, a, fresh.read_analysis(a))
    assert fresh.md_path(a).read_text() == before


def test_rules_learned_in_a_folder_come_back(corpus, tmp_path):
    """Rules are the other precious thing: they are what the tool learned from
    a person, and losing them means being taught the same footer twice."""
    ws, a, _ = corpus
    from mdgest import rules as R

    R.save(ws.cache, "manuals", {"version": 1, "shape": {}, "hide": {"x": True}, "settings": {}})
    project.export_to(ws, tmp_path / "out")

    fresh = Workspace(tmp_path / "fresh")
    project.import_from(fresh, tmp_path / "out")
    assert R.load(fresh.cache, "manuals")["hide"] == {"x": True}


def test_the_manifest_is_how_a_drop_is_told_apart(corpus, tmp_path):
    """A dropped folder is either work to continue or PDFs to add, and the UI
    has to know which before it does anything. One visible file at the root
    answers it -- no sniffing the contents, no guessing from a dot-directory
    the upload may never have delivered."""
    ws, _, _ = corpus
    out = project.export_to(ws, tmp_path / "out")
    assert project.looks_like_project(out)

    loose = tmp_path / "loose"
    (loose / "sources").mkdir(parents=True)
    (loose / "sources" / "x.pdf").write_bytes((FIXTURES / "doc-a.pdf").read_bytes())
    assert not project.looks_like_project(loose)


# ---- refusing to lose work --------------------------------------------------


def test_an_import_over_untouched_work_is_a_no_op(corpus, tmp_path):
    ws, a, b = corpus
    project.export_to(ws, tmp_path / "out")
    man = project.read_manifest(tmp_path / "out")
    seen = project.compare(ws, man)
    assert sorted(seen.unchanged) == sorted([a, b])
    assert seen.safe


def test_a_stale_export_is_reported_not_applied(corpus, tmp_path):
    """The failure this exists to prevent: export at two, work until four,
    re-import the two o'clock folder, lose two hours. Nothing is written until
    someone has seen this list."""
    ws, a, _ = corpus
    project.export_to(ws, tmp_path / "out")
    ops.set_block(ws, a, _first_block(ws, a), role="heading", level=2)

    seen = project.compare(ws, project.read_manifest(tmp_path / "out"))
    assert seen.conflicts == [a]
    assert not seen.safe


def test_a_changed_source_under_the_same_name_is_its_own_case(corpus, tmp_path):
    """Block ids are `p{page}b{index}`. Swap the PDF and every edit still
    resolves -- to different blocks. Nothing downstream can notice, which is
    why the digest is checked here and reported separately from a plain
    conflict: the edits are not merely older, they are meaningless."""
    ws, a, _ = corpus
    project.export_to(ws, tmp_path / "out")

    ws.source_path(a).write_bytes((FIXTURES / "doc-b.pdf").read_bytes())
    ws.source_hash_path(a).unlink()  # a real re-upload writes the new source and its digest

    seen = project.compare(ws, project.read_manifest(tmp_path / "out"))
    assert seen.resourced == [a]
    assert a not in seen.conflicts


def test_a_subset_can_be_taken(corpus, tmp_path):
    """"Keep mine" for the flagged rows has to be expressible, or the only
    answer to a conflict is all-or-nothing."""
    ws, a, b = corpus
    project.export_to(ws, tmp_path / "out")
    fresh = Workspace(tmp_path / "fresh")
    taken = project.import_from(fresh, tmp_path / "out", documents=[b])
    assert taken == [b]
    assert fresh.source_path(b).exists()
    assert not fresh.source_path(a).exists()


def test_a_foreign_or_future_manifest_is_refused(ws):
    with pytest.raises(ValueError, match="not an mdgest project"):
        project.compare(ws, {"format": "something-else", "version": 1})
    with pytest.raises(ValueError, match="this engine reads v"):
        project.compare(ws, {"format": project.FORMAT, "version": project.VERSION + 1})


def test_a_manifest_naming_a_missing_source_fails_before_writing(corpus, tmp_path):
    ws, a, _ = corpus
    out = project.export_to(ws, tmp_path / "out")
    (out / "sources" / f"{a}.pdf").unlink()
    fresh = Workspace(tmp_path / "fresh")
    with pytest.raises(ValueError, match="is missing"):
        project.import_from(fresh, out)


# ---- the digest -------------------------------------------------------------


def test_the_digest_is_cached_beside_the_page_count(corpus):
    ws, a, _ = corpus
    digest = ws.source_hash(a)
    assert digest and len(digest) == 64
    assert ws.source_hash_path(a).read_text("utf-8").strip() == digest
    ws.source_path(a).unlink()
    assert ws.source_hash(a) == digest, "a cached digest should not need the source"


def test_two_names_for_one_pdf_share_a_digest(ws):
    """The cheap half of duplicate detection: the same bytes under two ids.
    Reported, never resolved here -- path is identity and a digest is only
    ever evidence."""
    data = (FIXTURES / "doc-a.pdf").read_bytes()
    a = ws.add_pdf(data, "doc-a.pdf")
    b = ws.add_pdf(data, "elsewhere.pdf", "manuals")
    assert a != b
    assert ws.source_hash(a) == ws.source_hash(b)
