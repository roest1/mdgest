"""One PDF, several markdown files — and the moment a person says it is done.

A file break is a boundary someone marked on the page they were looking at, so
these tests set one and ask what reached the disk. Completion is the other half:
it is the only thing that writes a rule, which is what makes `rules.json` a
table of finished decisions rather than a log of everything anyone tried.
"""

import zipfile
from pathlib import Path

import pytest

from mdgest import corpus, ops
from mdgest.store import Workspace

FIXTURES = Path(__file__).parent / "fixtures"
DOC_A = FIXTURES / "doc-a.pdf"
DOC_B = FIXTURES / "doc-b.pdf"


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path / "ws")


def _added(ws, pdf: Path, folder: str = "manuals/widgets") -> str:
    doc = ws.add_pdf(pdf.read_bytes(), pdf.name, folder)
    ops.analyze(ws, doc)
    return doc


def _heading(ws, doc: str, starts_with: str) -> str:
    """A block by its wording. Ids shift whenever a fixture changes, and a test
    that picked the third block would then break for an unrelated reason."""
    return next(
        blk["id"]
        for page in ops.view(ws, doc)["pages"]
        for blk in page["blocks"]
        if blk.get("role") == "heading" and blk["text"].startswith(starts_with)
    )


def _names(ws, doc: str) -> list[str]:
    return [p.name for p in ws.md_paths(doc)]


# ---- what a file break writes ------------------------------------------------


def test_a_document_with_no_file_break_stays_one_file(ws):
    """The common case has to keep its shape. Nesting every one-sheet inside a
    folder of its own would buy uniformity with a level that earns nothing."""
    a = _added(ws, DOC_A)
    assert ws.md_path(a).exists()
    assert not ws.md_dir(a).is_dir()


def test_a_file_break_turns_the_document_into_a_folder(ws):
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    assert ws.md_dir(a).is_dir()
    assert len(_names(ws, a)) == 2
    # and the file it used to be is gone, not left beside the parts to be
    # exported twice and indexed as a third document
    assert not ws.md_path(a).exists()


def test_taking_the_break_back_puts_the_one_file_back(ws):
    a = _added(ws, DOC_A)
    block = _heading(ws, a, "Overview")
    ops.set_block(ws, a, block, break_before="file")
    ops.set_block(ws, a, block, break_before=None)
    assert ws.md_path(a).exists()
    assert not ws.md_dir(a).is_dir()


def test_a_page_break_is_not_a_file_break(ws):
    """Both write `---`. Only one of them cuts, and the older one is what every
    existing edits.json means by a break."""
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="page")
    assert not ws.md_dir(a).is_dir()
    assert "---" in ws.md_path(a).read_text()


def test_a_break_true_from_before_the_field_had_values_reads_as_a_page_break(ws):
    """Edits written when the field was a boolean must not start splitting
    documents the person who wrote them never asked to split."""
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before=True)
    assert not ws.md_dir(a).is_dir()


def test_an_unknown_break_is_refused(ws):
    a = _added(ws, DOC_A)
    with pytest.raises(ValueError, match="break_before must be"):
        ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="chapter")


def test_the_parts_carry_the_whole_document_and_nothing_twice(ws):
    """A split moves words between files; it must not add or drop one."""
    a = _added(ws, DOC_A)
    whole = ws.md_path(a).read_text().split()
    ops.set_block(ws, a, _heading(ws, a, "Procedure"), break_before="file")
    split = [w for p in ws.md_paths(a) for w in p.read_text().split()]
    # the `---` the file break wrote is the boundary and belongs to neither side
    assert [w for w in whole if w != "---"] == [w for w in split if w != "---"]


# ---- what the parts are called -----------------------------------------------


def test_a_part_is_named_for_the_heading_it_starts_with(ws):
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    assert _names(ws, a)[1] == "02-overview.md"


def test_renaming_the_heading_does_not_rename_the_file(ws):
    """The name was a decision, not a derivation. A citation written against
    `02-overview` must not dangle because someone fixed a typo in a heading."""
    a = _added(ws, DOC_A)
    block = _heading(ws, a, "Overview")
    ops.set_block(ws, a, block, break_before="file")
    before = _names(ws, a)
    ops.set_block(ws, a, block, level=4)  # reshaping it changes what it emits
    assert _names(ws, a) == before


def test_a_name_survives_the_break_being_taken_back_and_set_again(ws):
    a = _added(ws, DOC_A)
    block = _heading(ws, a, "Overview")
    ops.set_block(ws, a, block, break_before="file")
    before = _names(ws, a)
    ops.set_block(ws, a, block, break_before=None)
    ops.set_block(ws, a, block, break_before="file")
    assert _names(ws, a) == before


def test_the_parts_index_as_the_ids_their_paths_spell(ws):
    """The half of the citation contract mdgest owns: a part's id is the path
    its file already spells."""
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    entry = corpus.index_entries(ws, "manuals")[0]
    assert [p["id"] for p in entry["parts"]] == [
        "manuals/widgets/doc-a/01-widget-assembly-manual",
        "manuals/widgets/doc-a/02-overview",
    ]


def test_a_split_document_is_one_entry_in_its_folder_index(ws):
    """It is one document however many files it wrote. Counting the files
    instead put six parts of one course beside the module next to them."""
    a = _added(ws, DOC_A)
    _added(ws, DOC_B, "manuals/gadgets")
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    entries = corpus.index_entries(ws, "manuals")
    assert [e["doc"] for e in entries] == ["manuals/gadgets/doc-b", a]  # ws.docs sorts
    assert [e["split"] for e in entries] == [False, True]
    assert "2 documents in 3 files" in corpus.index_markdown(ws, "manuals")


def test_a_part_is_titled_by_its_own_first_heading(ws):
    """A part cut from the middle has no H1 — the document's title went to the
    first part — and titling it by its filename put `03-required-parts` in
    front of an agent choosing what to read."""
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    titles = [p["title"] for p in corpus.index_entries(ws, "manuals")[0]["parts"]]
    assert titles == ["Widget Assembly Manual", "Overview"]


def test_a_split_document_gets_a_contents_page_beside_its_parts(ws):
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    toc = ws.doc_index_path(a)
    assert toc.exists()
    text = toc.read_text()
    assert "doc-a.pdf` in 2 parts" in text
    assert "## 1. Widget Assembly Manual" in text
    assert "## 2. Overview" in text
    # links are relative to the folder it sits in, so the folder explains itself
    assert "(02-overview.md)" in text
    # and it is not itself a part: not numbered, not indexed, not citable
    assert toc not in ws.md_paths(a)
    assert all(p["id"] != f"{a}/INDEX" for p in corpus.index_entries(ws, "manuals")[0]["parts"])


def test_the_contents_page_is_rewritten_when_the_parts_change(ws):
    """It is derived from the parts entirely, so a contents page that disagrees
    with the files beside it is worse than none."""
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    assert "3 parts" not in ws.doc_index_path(a).read_text()
    ops.set_block(ws, a, _heading(ws, a, "Procedure"), break_before="file")
    assert "3 parts" in ws.doc_index_path(a).read_text()


def test_an_unsplit_document_has_no_contents_page(ws):
    """There is nothing to navigate: it is one file with its own headings."""
    a = _added(ws, DOC_A)
    assert not ws.doc_index_path(a).exists()


def test_a_split_documents_figures_are_one_directory_further_away(ws):
    """The parts sit a level deeper than the file they replaced, so the link to
    the figures beside them has to climb back out. Emitted directly: the
    fixtures' image is not one pypdfium2 extracts, and the prefix is the point."""
    analysis = {
        "pages": [
            {
                "n": 1,
                "width": 100,
                "height": 100,
                "lines": [],
                "pictures": [{"path": "p1-fig1.png"}],
                "blocks": [
                    {"id": "p1b1", "kind": "text", "text": "One", "role": "heading", "level": 1},
                    {"id": "p1i0", "kind": "picture", "role": "image", "picture": 0},
                    {"id": "p1b2", "kind": "text", "text": "Two", "role": "heading", "level": 1},
                ],
            }
        ]
    }
    edits = {"blocks": {"p1b2": {"break_before": "file"}}}
    doc, pieces = ops._emit(analysis, edits, "axial-piston")
    assert len(pieces) == 2
    assert "(../axial-piston.assets/p1-fig1.png)" in doc["markdown"]
    # and a document that does not split keeps the prefix it always had
    plain, one = ops._emit(analysis, {}, "axial-piston")
    assert len(one) == 1
    assert "(axial-piston.assets/p1-fig1.png)" in plain["markdown"]


# ---- moving, deleting, exporting a split document ----------------------------


def test_a_split_document_moves_as_one_thing(ws):
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    moved = ws.move(a, "manuals/gadgets/doc-a")
    assert _names(ws, moved) == ["01-widget-assembly-manual.md", "02-overview.md"]
    assert not ws.md_dir(a).is_dir()


def test_deleting_a_split_document_leaves_no_parts_behind(ws):
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    ws.remove(a)
    assert not ws.md_dir(a).is_dir()
    assert not ws.md_path(a).exists()


def test_export_writes_the_tree_the_workspace_has(ws):
    a = _added(ws, DOC_A)
    b = _added(ws, DOC_B, "manuals/gadgets")
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    dest = ws.root.parent / "out"
    result = ops.export(ws, [a, b], dest)
    assert result["documents"] == 2
    assert sorted(str(p.relative_to(dest).as_posix()) for p in dest.rglob("*.md")) == [
        "manuals/gadgets/doc-b.md",
        "manuals/widgets/doc-a/01-widget-assembly-manual.md",
        "manuals/widgets/doc-a/02-overview.md",
        "manuals/widgets/doc-a/INDEX.md",  # the parse travels with its contents
    ]


def test_export_to_a_zip_holds_the_same_paths(ws):
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    target = ws.root.parent / "out.zip"
    ops.export(ws, [a], target, as_zip=True)
    assert sorted(zipfile.ZipFile(target).namelist()) == [
        "manuals/widgets/doc-a/01-widget-assembly-manual.md",
        "manuals/widgets/doc-a/02-overview.md",
        "manuals/widgets/doc-a/INDEX.md",
    ]


def test_export_lists_a_document_once_however_many_files_it_wrote(ws):
    """A document is what a person selects. Picking three of a document's four
    parts is not a thing anyone means."""
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    entries = ops.export_tree(ws, "manuals")
    assert [e["doc"] for e in entries] == [a]
    assert len(entries[0]["files"]) == 2


def test_exporting_nothing_is_an_error_rather_than_an_empty_directory(ws):
    a = _added(ws, DOC_A)
    ws.md_path(a).unlink()
    with pytest.raises(ValueError, match="nothing to export"):
        ops.export(ws, [a], ws.root.parent / "out")


# ---- done -------------------------------------------------------------------


def test_marking_done_is_what_promotes_edits_to_rules(ws):
    a = _added(ws, DOC_A)
    b = _added(ws, DOC_B)
    label = _heading(ws, a, "Key Points")
    ops.set_block(ws, a, label, role="para")

    ops.analyze(ws, b, force=True)
    still = next(
        x for x in ops.view(ws, b)["pages"][0]["blocks"] if x["text"].startswith("Key Points")
    )
    assert still["role"] == "heading"  # nothing learned while a is unfinished

    ops.set_complete(ws, a)
    ops.analyze(ws, b, force=True)
    now = next(
        x for x in ops.view(ws, b)["pages"][0]["blocks"] if x["text"].startswith("Key Points")
    )
    assert now["role"] == "para" and now["rule"]["kind"] == "shape"


def test_a_file_break_is_learned_like_any_other_shape(ws):
    """What makes splitting the second document cheap: the boundary is keyed by
    how the block is set, so a folder of decks built the same way splits the
    same way without anyone marking each one."""
    a = _added(ws, DOC_A)
    b = _added(ws, DOC_B)
    ops.set_block(ws, a, _heading(ws, a, "Overview"), break_before="file")
    ops.set_complete(ws, a)
    ops.analyze(ws, b, force=True)
    assert ws.md_dir(b).is_dir()


def test_marking_done_reports_its_checks_without_refusing(ws):
    """The checks say what is wrong and let the person through. A document that
    lost three words on page 9 still holds an hour of shape decisions, and
    blocking would strand them along with the mistake."""
    a = _added(ws, DOC_A)
    result = ops.set_complete(ws, a)
    assert result["complete"] is True
    assert {c["name"] for c in result["checks"]} == {"fidelity", "headings"}
    assert all(c["level"] in ("ok", "warn") for c in result["checks"])


def test_the_heading_check_sees_a_gap_coverage_cannot(ws):
    """An H4 under an H2 is legal markdown and a broken outline, and the anchors
    `corpus` cites are built from exactly these."""
    a = _added(ws, DOC_A)
    assert [c["level"] for c in ops.completion_checks(ws, a) if c["name"] == "headings"] == ["ok"]
    ops.set_block(ws, a, _heading(ws, a, "Overview"), level=5)
    check = next(c for c in ops.completion_checks(ws, a) if c["name"] == "headings")
    assert check["level"] == "warn" and "H1 to H5" in check["message"]


def test_un_completing_leaves_the_rules_it_taught_standing(ws):
    """Once a rule is out, other documents are already shaped by it. Taking the
    mark off says this document is not finished, not that the folder should
    forget what it learned — `rules.forget` is where that lives."""
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Key Points"), role="para")
    ops.set_complete(ws, a)
    assert any(r["shape"] for r in ops.list_rules(ws, a))
    ops.set_complete(ws, a, complete=False)
    assert ws.doc_summary(a)["complete"] is False
    assert any(r["shape"] for r in ops.list_rules(ws, a))


def test_done_is_not_an_edit(ws):
    """It goes in `edits.json` because it is a person's decision about the
    document, but it is not one of the decisions a version stores — saving a
    version and then finishing must not read as unsaved work."""
    a = _added(ws, DOC_A)
    ops.set_block(ws, a, _heading(ws, a, "Key Points"), role="para")
    ops.save_version(ws, a, "shaped")
    assert ops.view(ws, a)["versions"]["dirty"] is False
    ops.set_complete(ws, a)
    assert ops.view(ws, a)["versions"]["dirty"] is False


# ---- the routes the UI drives ------------------------------------------------


def _api_doc(client, folder: str = "k") -> tuple[str, dict]:
    """Upload the fixture and wait for the analysis the API runs in a thread."""
    import time

    from mdgest import api  # noqa: F401  (imported by the caller's fixture)

    doc = client.post(
        "/api/upload",
        files=[("files", ("a.pdf", DOC_A.read_bytes(), "application/pdf"))],
        data={"folder": folder},
    ).json()["added"][0]
    for _ in range(200):
        r = client.get(f"/api/docs/{doc}")
        if r.status_code == 200:
            return doc, r.json()
        time.sleep(0.05)
    raise AssertionError("the document never finished analyzing")


def test_the_api_marks_done_and_lists_what_can_be_exported(tmp_path):
    from fastapi.testclient import TestClient

    from mdgest import api

    client = TestClient(api.create_app(tmp_path / "ws"))
    doc, view = _api_doc(client)

    assert view["doc"]["complete"] is False
    assert [e["complete"] for e in client.get("/api/export").json()["documents"]] == [False]

    checks = client.get(f"/api/docs/{doc}/checks").json()["checks"]
    assert {c["name"] for c in checks} == {"fidelity", "headings"}

    done = client.post(f"/api/docs/{doc}/complete", json={"complete": True}).json()
    assert done["complete"] is True
    assert client.get(f"/api/docs/{doc}").json()["doc"]["complete"] is True
    assert [e["complete"] for e in client.get("/api/export").json()["documents"]] == [True]


def test_the_api_exports_to_a_path_rather_than_a_download(tmp_path):
    """The webview has no downloads and a corpus has no business travelling
    through its memory, so the engine writes where it is told."""
    from fastapi.testclient import TestClient

    from mdgest import api

    client = TestClient(api.create_app(tmp_path / "ws"))
    doc, _ = _api_doc(client)
    dest = tmp_path / "out"
    r = client.post("/api/export", json={"docs": [doc], "dest": str(dest)})
    assert r.status_code == 200 and r.json()["files"] == 1
    assert (dest / "k" / "a.md").exists()

    assert client.post("/api/export", json={"docs": [doc], "dest": ""}).status_code == 400


def test_the_spa_route_serves_only_what_was_built(tmp_path, monkeypatch):
    """The catch-all joined a caller's path onto the built web app and served
    whatever came out, so `/%2e%2e/secret.txt` read a file outside it. Encoded
    because a browser normalizes `../` before sending; ungated because
    index.html has to load before the app has a token, which is why the engine
    token below does not save it."""
    from fastapi.testclient import TestClient

    from mdgest import api

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("spa", "utf-8")
    (dist / "favicon.svg").write_text("icon", "utf-8")
    (tmp_path / "secret.txt").write_text("TOP SECRET", "utf-8")
    (dist / "escape.txt").symlink_to(tmp_path / "secret.txt")
    monkeypatch.setenv("MDGEST_WEB_DIST", str(dist))
    monkeypatch.setenv("MDGEST_TOKEN", "s3cret")
    client = TestClient(api.create_app(tmp_path / "ws"))
    # the last one is a symlink out of dist, which screening for `..` would miss
    for attempt in ("/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/escape.txt"):
        assert client.get(attempt).text == "spa", attempt
    assert client.get("/favicon.svg").text == "icon"  # a real file inside dist still serves


def test_a_doc_id_shaped_route_does_not_eat_its_own_suffix(tmp_path):
    """`{doc_id:path}` is greedy and FastAPI matches in registration order, so a
    GET registered after the catch-all reads its suffix as part of the id. Both
    of these did that; nothing new may."""
    from fastapi.testclient import TestClient

    from mdgest import api

    client = TestClient(api.create_app(tmp_path / "ws"))
    doc, _ = _api_doc(client, "deep/nested/folder")
    assert client.get(f"/api/docs/{doc}/checks").status_code == 200
    assert client.get(f"/api/docs/{doc}/versions").status_code == 200
