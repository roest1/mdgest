"""End-to-end over the committed fixture corpus."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mdgest import api, emit, ops
from mdgest import edits as E
from mdgest.store import Workspace

FIXTURES = Path(__file__).parent / "fixtures"
# Two synthetic documents built by fixtures/make_fixtures.py. They share a
# shape -- headings at two sizes over a body size, a paragraph whose lines
# have to be joined, nested bullets, numbered and lettered items, an image,
# a bold run-in label and a repeated footer -- so one can learn a rule the
# other inherits. Nothing here comes from a real document.
SAMPLE = FIXTURES / "doc-a.pdf"
LEGS = FIXTURES / "doc-b.pdf"


def blank_pdf() -> bytes:
    """A page with nothing on it -- for tests about paths, not parsing."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument.new()
    doc.new_page(612, 792)
    import io

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path / "ws")


def test_hierarchy_and_markdown_mirror(ws):
    pdf = SAMPLE.read_bytes()
    doc = ws.add_pdf(pdf, "Doc A.pdf", "acme/manuals/widgets")
    assert doc == "acme/manuals/widgets/doc-a"
    ops.analyze(ws, doc)
    assert ws.md_path(doc).exists()
    assert ws.md_path(doc).parent == ws.markdown / "acme/manuals/widgets"
    tree = ws.tree()
    assert tree["folders"][0]["name"] == "acme"


def test_edits_roundtrip_and_undo(ws):
    pdf = SAMPLE.read_bytes()
    doc = ws.add_pdf(pdf, "a.pdf", "x")
    ops.analyze(ws, doc)
    v = ops.view(ws, doc)
    blocks = v["pages"][0]["blocks"]
    assert len(blocks) >= 3
    first = blocks[0]["id"]
    ops.set_block(ws, doc, first, role="heading", level=3)
    v2 = ops.view(ws, doc)
    assert v2["pages"][0]["blocks"][0]["level"] == 3
    assert "### " in v2["markdown"]
    r = ops.move_block(ws, doc, first, to=3)
    assert r["order"][2] == first and len(r["affected"]) == 3
    ops.undo(ws, doc)
    assert ops.view(ws, doc)["pages"][0]["blocks"][0]["id"] == first
    ins = ops.insert_text(ws, doc, 1, first, "added by hand")
    assert "added by hand" in ops.view(ws, doc)["markdown"]
    ops.remove_insert(ws, doc, ins["id"])
    assert "added by hand" not in ops.view(ws, doc)["markdown"]


def test_emit_numbering_resets():
    page = {
        "n": 1,
        "pictures": [],
        "blocks": [
            {
                "id": "a",
                "kind": "text",
                "text": "one",
                "role": "numbered",
                "depth": 0,
                "bbox": [0, 0, 1, 1],
            },
            {
                "id": "b",
                "kind": "text",
                "text": "two",
                "role": "numbered",
                "depth": 0,
                "bbox": [0, 0, 1, 1],
            },
            {"id": "c", "kind": "text", "text": "para", "role": "para", "bbox": [0, 0, 1, 1]},
            {
                "id": "d",
                "kind": "text",
                "text": "again",
                "role": "alpha",
                "depth": 0,
                "bbox": [0, 0, 1, 1],
            },
        ],
    }
    blocks = emit.resolve_page(page, E.blank())
    text = "\n".join(l["text"] for l in emit.page_markdown(page, blocks))
    assert "1. one\n2. two" in text and "a. again" in text
    # the panel draws its list from the same markers, so they ride on the block
    assert [b["list_marker"] for b in blocks] == ["1.", "2.", "", "a."]


def test_api_smoke(tmp_path):
    app = api.create_app(tmp_path / "ws")
    c = TestClient(app)
    pdf = SAMPLE.read_bytes()
    r = c.post(
        "/api/upload",
        files=[("files", ("doc-a.pdf", pdf, "application/pdf"))],
        data={"folder": "k/sub"},
    )
    assert r.status_code == 200, r.text
    doc = r.json()["added"][0]
    for _ in range(200):
        r = c.get(f"/api/docs/{doc}")
        if r.status_code == 200:
            break
        import time

        time.sleep(0.05)
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["pages"][0]["n"] == 1
    assert c.get(f"/api/docs/{doc}/page/1.png").status_code == 200
    assert c.get(f"/api/docs/{doc}/thumb/1.png").status_code == 200
    assert c.get("/api/tree").json()["tree"]["folders"][0]["name"] == "k"
    b = v["pages"][0]["blocks"][0]["id"]
    assert c.patch(f"/api/docs/{doc}/blocks/{b}", json={"bold": True}).status_code == 200
    assert c.post(f"/api/docs/{doc}/undo").json()["undone"] is True
    assert c.post("/api/index", json={"folder": "k"}).status_code == 200
    assert c.get("/api/index/k").status_code == 200


def test_token_gate_and_add_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("MDGEST_TOKEN", "s3cret")
    app = api.create_app(tmp_path / "ws")
    c = TestClient(app)
    assert c.get("/api/tree").status_code == 401
    assert c.get("/api/tree", headers={"x-mdgest-token": "wrong"}).status_code == 401
    assert c.get("/api/tree?t=s3cret").status_code == 200  # <img src> carries ?t=
    h = {"x-mdgest-token": "s3cret"}
    # the desktop drop hands over paths; a directory tree keeps its hierarchy
    src = tmp_path / "drive" / "unit-1"
    src.mkdir(parents=True)
    (src / "Lesson One.pdf").write_bytes(blank_pdf())
    (tmp_path / "drive" / "flat.pdf").write_bytes(blank_pdf())
    r = c.post(
        "/api/add-paths",
        headers=h,
        json={"paths": [str(tmp_path / "drive")], "folder": "course"},
    )
    assert r.status_code == 200, r.text
    assert sorted(r.json()["added"]) == ["course/flat", "course/unit-1/lesson-one"]
    # a bogus path reports an error instead of failing the whole batch
    r = c.post("/api/add-paths", headers=h, json={"paths": [str(tmp_path / "nope.pdf")]})
    assert r.json()["added"] == [] and len(r.json()["errors"]) == 1


def test_api_answers_are_never_cached(tmp_path):
    """Both middlewares are pure ASGI now and nothing had pinned what they do.
    Every /api answer says no-cache, the render routes included -- their own
    `max-age` loses on purpose, because a page image is addressed by document
    path alone. Anything outside /api is left alone."""
    c = TestClient(api.create_app(tmp_path / "ws"))
    (tmp_path / "one.pdf").write_bytes(blank_pdf())
    r = c.post("/api/add-paths", json={"paths": [str(tmp_path / "one.pdf")]})
    doc = r.json()["added"][0]
    assert c.get("/api/health").headers["cache-control"] == "no-cache"
    png = c.get(f"/api/docs/{doc}/page/1.png")
    assert png.status_code == 200 and png.headers["cache-control"] == "no-cache"
    assert "cache-control" not in c.get("/not-an-api-path").headers


def test_group_move_keeps_page_order(ws):
    pdf = SAMPLE.read_bytes()
    doc = ws.add_pdf(pdf, "g.pdf", "x")
    ops.analyze(ws, doc)
    blocks = ops.view(ws, doc)["pages"][0]["blocks"]
    assert len(blocks) >= 6
    ids = [b["id"] for b in blocks]
    # move 2nd..4th (given out of order) after the 6th
    r = ops.move_block(ws, doc, [ids[3], ids[1], ids[2]], target=ids[5], place="after")
    assert r["order"][:6] == [ids[0], ids[4], ids[5], ids[1], ids[2], ids[3]]
    assert r["moved"] == [ids[1], ids[2], ids[3]]
    with pytest.raises(ValueError):
        ops.move_block(ws, doc, [ids[1], ids[2]], target=ids[2])


def test_reorder_brings_a_scattered_selection_together_where_it_starts(ws):
    """Three headings numbered 3, 5 and 10 are already ascending, so a sort in
    place would call them ordered and do nothing -- while what a person looking
    at them means by putting them in order is 3, 4, 5. The run lands at the
    first of their numbers: nothing above it moves, nothing below the last of
    them moves, and pressing again does nothing."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "r.pdf", "x")
    ops.analyze(ws, doc)
    blocks = ops.view(ws, doc)["pages"][0]["blocks"]
    by_text = {b["text"]: b["id"] for b in blocks}
    heads = [by_text["Overview"], by_text["Required Parts"], by_text["Procedure"]]
    before = {b["id"]: b["n"] for b in blocks}
    lo, hi = min(before[h] for h in heads), max(before[h] for h in heads)
    assert [before[h] for h in heads] == sorted(before[h] for h in heads)  # already ascending
    assert [before[h] for h in heads] != [lo, lo + 1, lo + 2]  # and not neighbors

    preview = ops.reorder_blocks(ws, doc, heads, preview=True)
    assert {b["id"]: b["n"] for b in ops.view(ws, doc)["pages"][0]["blocks"]} == before

    r = ops.reorder_blocks(ws, doc, [heads[2], heads[0], heads[1]])  # click order is not the input
    assert r["order"] == preview["order"] and r["to"] == lo
    after = {b["id"]: b["n"] for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    assert [after[h] for h in heads] == [lo, lo + 1, lo + 2]
    untouched = [i for i, n in before.items() if n is not None and (n < lo or n > hi)]
    assert all(after[i] == before[i] for i in untouched)
    assert ops.reorder_blocks(ws, doc, heads)["affected"] == []


def test_choosing_the_boxes_is_choosing_the_gutters():
    """Why re-reading part of a page can beat re-reading the page: `xy_cut`
    cuts on the gaps the boxes in front of it leave, so a heading that spans
    both columns hides the gutter and the page is read across. Leave that
    heading out of the selection and the cut it defeated succeeds."""
    page = {"lines": [{"bbox": [0, 0, 100, 10]}]}  # a ten-point line: the unit
    head = {"id": "head", "bbox": [72, 700, 540, 715]}
    columns = [
        {"id": "l1", "bbox": [72, 600, 290, 690]},
        {"id": "l2", "bbox": [72, 500, 290, 590]},
        {"id": "r1", "bbox": [320, 600, 540, 690]},
        {"id": "r2", "bbox": [320, 500, 540, 590]},
    ]
    across = ops._reading_rank(page, [head, *columns])
    assert sorted(across, key=across.get) == ["head", "l1", "r1", "l2", "r2"]
    down = ops._reading_rank(page, columns)
    assert sorted(down, key=down.get) == ["l1", "l2", "r1", "r2"]


def test_an_insertion_has_no_geometry_to_be_read_from(ws):
    """Reading order comes off the page, and an insertion is not on the page.
    It is still gathered with the rest -- a run with a hole in it is not a run
    -- but it trails what can be read, in the order it already had."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "i.pdf", "x")
    ops.analyze(ws, doc)
    by_text = {b["text"]: b["id"] for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    overview, procedure = by_text["Overview"], by_text["Procedure"]
    ins = ops.insert_text(ws, doc, 1, procedure, "A note nobody printed.")["id"]

    r = ops.reorder_blocks(ws, doc, [overview, procedure, ins])
    numbers = {b["id"]: b["n"] for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    assert numbers[procedure] == numbers[overview] + 1
    assert numbers[ins] == numbers[procedure] + 1  # last, being unreadable off the page
    assert r["to"] == numbers[overview]


def test_deleting_a_block_gives_up_its_number(ws):
    """A deleted block keeps its place -- it is there to be restored -- but not
    its number, so #9 on the page is the ninth thing in the markdown. Numbering
    what the markdown does not carry makes `--to 3` a count of the invisible,
    and every delete a renumbering a person has to do in their head."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "h.pdf", "x")
    ops.analyze(ws, doc)
    ids = [b["id"] for b in ops.view(ws, doc)["pages"][0]["blocks"]]
    assert len(ids) >= 5
    ops.set_block(ws, doc, ids[1], hidden=True)
    blocks = ops.view(ws, doc)["pages"][0]["blocks"]
    assert [b["id"] for b in blocks] == ids  # still in place, still restorable
    numbers = {b["id"]: b["n"] for b in blocks}
    assert numbers[ids[1]] is None
    assert numbers[ids[0]] == 1 and numbers[ids[2]] == 2

    # and `to` counts the same numbers: 2 is where the second visible one sits
    r = ops.move_block(ws, doc, ids[3], to=2)
    assert r["to"] == 2
    assert r["order"][:4] == [ids[0], ids[1], ids[3], ids[2]]

    ops.set_block(ws, doc, ids[1], hidden=False)
    back = {b["id"]: b["n"] for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    assert back[ids[1]] == 2  # restored, and numbered from where it now sits


def test_shaping_a_group_is_one_edit(ws):
    """A selection is one decision, so it costs one undo. Per-block requests
    meant ten bullets took ten presses of undo to take back, and nine of them
    left the document in a state nobody had asked for."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "b.pdf", "x")
    ops.analyze(ws, doc)
    ids = [b["id"] for b in ops.view(ws, doc)["pages"][0]["blocks"]][:3]
    ops.set_block(ws, doc, ids, role="bullet")
    blocks = {b["id"]: b for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    assert all(blocks[i]["role"] == "bullet" for i in ids)
    ops.undo(ws, doc)
    back = {b["id"]: b for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    assert not any(back[i]["role"] == "bullet" for i in ids)


def test_editing_the_text_teaches_what_the_shape_bar_teaches(ws):
    """Fixing a section's bullets by typing and fixing them by clicking are the
    same decision. Only one of them used to record a rule, so the next document
    arrived wrong in exactly the way the person had just corrected."""
    a = ws.add_pdf(SAMPLE.read_bytes(), "doc-a.pdf", "acme/widgets")
    ops.analyze(ws, a)
    md = ops.view(ws, a)["markdown"]
    lines = md.split("\n")
    # the bold run-in label reads as an H3; say it is a paragraph, in the text
    i = next(i for i, l in enumerate(lines) if l.startswith("### Key Points"))
    lines[i] = lines[i].replace("### ", "")
    r = ops.apply_markdown(ws, a, "\n".join(lines))
    assert r["shaped"] == 1
    assert len(ops.set_complete(ws, a, folder="acme/widgets")["learned"]) == 1

    b = ws.add_pdf(LEGS.read_bytes(), "doc-b.pdf", "acme/widgets")
    ops.analyze(ws, b)
    kp = next(x for x in ops.view(ws, b)["pages"][0]["blocks"] if x["text"].startswith("Key Points"))
    assert kp["role"] == "para" and kp["rule"]["kind"] == "shape"


def test_api_group_move(tmp_path):
    app = api.create_app(tmp_path / "ws")
    c = TestClient(app)
    pdf = SAMPLE.read_bytes()
    doc = c.post(
        "/api/upload", files=[("files", ("a.pdf", pdf, "application/pdf"))], data={"folder": "k"}
    ).json()["added"][0]
    import time

    for _ in range(200):
        r = c.get(f"/api/docs/{doc}")
        if r.status_code == 200:
            break
        time.sleep(0.05)
    blocks = r.json()["pages"][0]["blocks"]
    assert len(blocks) >= 6
    ids = [b["id"] for b in blocks]
    r = c.post(
        f"/api/docs/{doc}/blocks/{ids[1]}/move",
        json={"blocks": ids[1:4], "target": ids[5], "place": "after"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["order"][:6] == [ids[0], ids[4], ids[5], ids[1], ids[2], ids[3]]


def test_api_reorder_previews_the_same_answer_it_commits(tmp_path):
    """The button shows the numbers before it is pressed, so the preview has to
    be the answer and not a guess -- and asking for it may not write."""
    c = TestClient(api.create_app(tmp_path / "ws"))
    doc = c.post(
        "/api/upload",
        files=[("files", ("a.pdf", SAMPLE.read_bytes(), "application/pdf"))],
        data={"folder": "k"},
    ).json()["added"][0]
    import time

    for _ in range(200):
        r = c.get(f"/api/docs/{doc}")
        if r.status_code == 200:
            break
        time.sleep(0.05)
    by_text = {b["text"]: b["id"] for b in r.json()["pages"][0]["blocks"]}
    heads = [by_text["Overview"], by_text["Required Parts"], by_text["Procedure"]]
    c.post(f"/api/docs/{doc}/blocks/{heads[0]}/move", json={"target": heads[2], "place": "after"})
    was = {b["id"]: b["n"] for b in c.get(f"/api/docs/{doc}").json()["pages"][0]["blocks"]}

    p = c.post(f"/api/docs/{doc}/reorder", json={"blocks": heads, "preview": True})
    assert p.status_code == 200, p.text
    assert {b["id"]: b["n"] for b in c.get(f"/api/docs/{doc}").json()["pages"][0]["blocks"]} == was
    assert (
        c.post(f"/api/docs/{doc}/reorder", json={"blocks": heads}).json()["order"]
        == p.json()["order"]
    )
    assert c.post(f"/api/docs/{doc}/reorder", json={"blocks": heads[:1]}).status_code == 400


def test_rules_carry_to_the_next_document(ws):
    a = ws.add_pdf(SAMPLE.read_bytes(), "doc-a.pdf", "acme/manuals/widgets")
    ops.analyze(ws, a)
    v = ops.view(ws, a)
    # the bold run-in labels ("Key Points:") read as H3s by default; say they are
    # ordinary paragraphs, and learn that for everything under widgets/
    target = next(b for b in v["pages"][0]["blocks"] if b["text"].startswith("Key Points"))
    assert target["role"] == "heading"
    ops.set_block(ws, a, target["id"], role="para")
    # and hide the copyright footer, learned at the client level — a scope the
    # evidence is shown for, which is a different act from finishing a document
    foot = next(b for b in v["pages"][0]["blocks"] if "Copyright" in b["text"])
    ops.hide(ws, a, foot["id"], scope="folder", folder="acme")
    r = ops.set_complete(ws, a, folder="acme/manuals/widgets")
    assert r["learned"][0]["shape"]["fields"]["role"] == "para"

    b = ws.add_pdf(LEGS.read_bytes(), "doc-b.pdf", "acme/manuals/widgets")
    applied = ops.analyze(ws, b)
    assert applied["rules_applied"] >= 2
    blocks = ops.view(ws, b)["pages"][0]["blocks"]
    kp = next(x for x in blocks if x["text"].startswith("Key Points"))
    assert kp["role"] == "para" and kp["rule"]["folder"].endswith("widgets")
    assert next(x for x in blocks if "Copyright" in x["text"])["hidden"] is True
    # a doc outside widgets/ inherits the client-level hide but not the shape rule
    other = ws.add_pdf(SAMPLE.read_bytes(), "doc-a.pdf", "acme/manuals/gadgets")
    ops.analyze(ws, other)
    ob = ops.view(ws, other)["pages"][0]["blocks"]
    assert next(x for x in ob if "Copyright" in x["text"])["hidden"] is True
    assert next(x for x in ob if x["text"].startswith("Key Points"))["role"] == "heading"
    stack = ops.list_rules(ws, b)
    assert [s["folder"] for s in stack][-1] == "acme/manuals/widgets"


def test_versions_chain_and_go_back(ws):
    pdf = SAMPLE.read_bytes()
    doc = ws.add_pdf(pdf, "v.pdf", "x")
    ops.analyze(ws, doc)
    blocks = ops.view(ws, doc)["pages"][0]["blocks"]
    assert len(blocks) >= 3
    b0, b1 = blocks[0]["id"], blocks[1]["id"]
    ops.set_block(ws, doc, b0, bold=True)
    v1 = ops.save_version(ws, doc, "bold first")
    assert v1["saved"] == "v1" and v1["dirty"] is False
    ops.set_block(ws, doc, b1, italic=True)
    assert ops.list_versions(ws, doc)["dirty"] is True
    v2 = ops.save_version(ws, doc, "and italic second")
    assert ops.list_versions(ws, doc)["versions"][1]["parent"] == "v1"
    # back to the original: no edits, but v1/v2 still there; undo brings v2's state back
    ops.checkout(ws, doc, "original")
    assert not ops.view(ws, doc)["pages"][0]["blocks"][0].get("bold")
    ops.checkout(ws, doc, "v1")
    view = ops.view(ws, doc)
    assert view["pages"][0]["blocks"][0]["bold"] and not view["pages"][0]["blocks"][1].get("italic")
    assert view["versions"]["base"] == "v1"
    # a new save from v1 is a second successor of v1, a branch
    ops.set_block(ws, doc, b1, hidden=True)
    v3 = ops.save_version(ws, doc, "hide second instead")
    assert next(v for v in v3["versions"] if v["id"] == "v3")["parent"] == "v1"
    with pytest.raises(ValueError):
        ops.delete_version(ws, doc, "v1")
    assert v2["saved"] == "v2"


def test_the_original_is_the_bottom_of_undo(ws):
    """Going back to a saved state is going to a place, not making an edit, so
    the history of the working copy you left does not come with you: one undo
    returns what you had -- nothing is lost by switching -- and there is no
    second one that walks from the original *into* an abandoned branch."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "u.pdf", "x")
    ops.analyze(ws, doc)
    ids = [b["id"] for b in ops.view(ws, doc)["pages"][0]["blocks"]]
    for i in (1, 2, 3):
        ops.set_block(ws, doc, ids[i], bold=True)

    ops.checkout(ws, doc, "original")
    assert [b for b in ops.view(ws, doc)["pages"][0]["blocks"] if b.get("bold")] == []

    assert ops.undo(ws, doc)["undone"] is True
    assert len([b for b in ops.view(ws, doc)["pages"][0]["blocks"] if b.get("bold")]) == 3
    assert ops.undo(ws, doc)["undone"] is False  # and no further
    assert ops.redo(ws, doc)["redone"] is True
    assert [b for b in ops.view(ws, doc)["pages"][0]["blocks"] if b.get("bold")] == []


def test_standing_where_you_already_stand_is_not_a_step(ws):
    """Checking out the state the working copy is already in changes nothing,
    so it may not leave an undo step behind. Two presses used to offer two
    undos on a document nobody had edited."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "s.pdf", "x")
    ops.analyze(ws, doc)
    ops.checkout(ws, doc, "original")
    ops.checkout(ws, doc, None)
    assert ops.view(ws, doc)["edits"]["undo"] == 0


def test_a_version_saved_after_an_undo_still_descends_from_its_base(ws):
    """Undo takes back decisions, not where the working copy sits in the tree.
    When it took back `base` as well, undoing the edit before a save left the
    saved version with nothing pointing at it, and the next save came out its
    sibling rather than its child."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "b.pdf", "x")
    ops.analyze(ws, doc)
    ids = [b["id"] for b in ops.view(ws, doc)["pages"][0]["blocks"]]
    ops.set_block(ws, doc, ids[1], bold=True)
    ops.save_version(ws, doc, "first")

    ops.undo(ws, doc)
    assert ops.list_versions(ws, doc)["base"] == "v1"
    assert ops.list_versions(ws, doc)["dirty"] is True  # v1 is not what is on screen

    ops.set_block(ws, doc, ids[2], italic=True)
    r = ops.save_version(ws, doc, "second")
    assert next(v for v in r["versions"] if v["id"] == "v2")["parent"] == "v1"


def test_reset_forgets_every_kind_of_edit(ws):
    """`reset every edit` names them one by one, so a kind added later is a
    kind it quietly keeps."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "z.pdf", "x")
    ops.analyze(ws, doc)
    page = ws.read_analysis(doc)["pages"][0]
    para = next(b for b in page["blocks"] if len(b["lines"]) == 3)
    ops.cut_block(ws, doc, para["id"], [1])
    ops.set_block(ws, doc, para["id"], bold=True)

    ops.reset_edits(ws, doc)
    assert not any(E.load(ws.edits_path(doc))[k] for k in E.CONTENT_KEYS)
    assert ops.view(ws, doc)["edits"]["cuts"] == 0


def test_cutting_a_fragment_counts_from_the_fragment(ws):
    """A cut is addressed in the lines of the block a person is looking at, not
    of the run it came out of -- otherwise cutting a piece a second time means
    knowing where that piece starts, which is the engine's bookkeeping and not
    anything on the screen."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "x.pdf", "x")
    ops.analyze(ws, doc)
    page = ws.read_analysis(doc)["pages"][0]
    para = next(b for b in page["blocks"] if len(b["lines"]) == 3)
    printed = [page["lines"][i]["text"] for i in para["lines"]]

    ops.cut_block(ws, doc, para["id"], [1])
    blocks = {b["id"]: b for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    assert blocks[para["id"]]["text"] == printed[0]
    assert blocks[para["id"] + "c1"]["text"] == " ".join(printed[1:])

    ops.cut_block(ws, doc, para["id"] + "c1", [1])  # the second line of the piece
    blocks = {b["id"]: b for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    assert [blocks[i]["text"] for i in (para["id"], para["id"] + "c1", para["id"] + "c2")] == printed

    with pytest.raises(ValueError):
        ops.cut_block(ws, doc, para["id"], [9])
    ops.cut_block(ws, doc, para["id"], [])  # the whole run, back together
    assert ops.view(ws, doc)["markdown"] == ops.write_markdown(ws, doc)
    assert para["id"] + "c1" not in {b["id"] for b in ops.view(ws, doc)["pages"][0]["blocks"]}


def test_a_boundary_moved_is_not_words_retyped(ws):
    """The fix for a list the page draws its bullets rather than printing them:
    the analysis reads the items as one wrapped paragraph, and a person splits
    them in the markdown. The words did not change, so nothing may be hidden
    and nothing inserted -- the block is cut where they cut it, both halves
    stay the page's, and applying the same text again changes nothing."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "c.pdf", "x")
    ops.analyze(ws, doc)
    md = ops.view(ws, doc)["markdown"]
    page = ws.read_analysis(doc)["pages"][0]
    para = next(b for b in page["blocks"] if len(b["lines"]) == 3)
    printed = [page["lines"][i]["text"] for i in para["lines"]]
    lines = md.split("\n")
    at = lines.index(para["text"])
    lines[at : at + 1] = [printed[0], "", " ".join(printed[1:])]

    r = ops.apply_markdown(ws, doc, "\n".join(lines))
    assert r["regrouped"] == 2 and r["hidden"] == 0 and r["inserted"] == 0

    blocks = {b["id"]: b for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    head, tail = blocks[para["id"]], blocks[para["id"] + "c1"]
    assert head["text"] == printed[0] and tail["text"] == " ".join(printed[1:])
    assert head["origin"] == tail["origin"] == "page"
    assert head["bbox"][3] > tail["bbox"][3]  # the tail sits below the head
    assert ops.apply_markdown(ws, doc, ops.view(ws, doc)["markdown"])["regrouped"] == 0


def test_a_boundary_moved_across_two_blocks_cuts_one_and_joins_the_other(ws):
    """The shape the report came in as: a run the analysis broke in the wrong
    place, so fixing it moves words from one block to the next. That is a cut
    and a join, and it stays inside what edits may say about a page."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "j.pdf", "x")
    ops.analyze(ws, doc)
    md = ops.view(ws, doc)["markdown"]
    page = ws.read_analysis(doc)["pages"][0]
    para = next(b for b in page["blocks"] if len(b["lines"]) == 3)
    head = next(b for b in page["blocks"] if b["text"] == "Overview")
    printed = [page["lines"][i]["text"] for i in para["lines"]]
    lines = md.split("\n")
    at = lines.index("## Overview")
    assert lines[at + 1 : at + 3] == ["", para["text"]]
    lines[at : at + 3] = [f"## Overview {printed[0]}", " ".join(printed[1:])]

    r = ops.apply_markdown(ws, doc, "\n".join(lines))
    assert r["regrouped"] == 2 and r["hidden"] == 0 and r["inserted"] == 0
    blocks = {b["id"]: b for b in ops.view(ws, doc)["pages"][0]["blocks"]}
    assert blocks[head["id"]]["text"] == f"Overview {printed[0]}"
    assert blocks[para["id"] + "c1"]["text"] == " ".join(printed[1:])
    assert para["id"] not in blocks  # its first line went to the heading


def test_a_boundary_inside_a_line_is_still_hide_and_insert(ws):
    """A block is whole lines of the page, so a boundary a person puts in the
    middle of one cannot be recorded as a cut. It falls back to hiding and
    inserting -- the old behavior, and the honest one: those words come out
    of the engine's reach and are marked as not on the page."""
    doc = ws.add_pdf(SAMPLE.read_bytes(), "m.pdf", "x")
    ops.analyze(ws, doc)
    md = ops.view(ws, doc)["markdown"]
    page = ws.read_analysis(doc)["pages"][0]
    para = next(b for b in page["blocks"] if len(b["lines"]) == 3)
    lines = md.split("\n")
    at = lines.index(para["text"])
    head, tail = para["text"].split("ahead. ")
    lines[at : at + 1] = [head + "ahead.", "", tail]

    r = ops.apply_markdown(ws, doc, "\n".join(lines))
    assert r["regrouped"] == 0 and r["hidden"] == 1 and r["inserted"] == 1


def test_apply_markdown_diff(ws):
    pdf = SAMPLE.read_bytes()
    doc = ws.add_pdf(pdf, "e.pdf", "x")
    ops.analyze(ws, doc)
    v = ops.view(ws, doc)
    md = v["markdown"]
    lines = md.split("\n")
    assert len(lines) >= 10
    # 1) change the first H2 into an H3 (same words) -> shape change
    i2 = next(i for i, l in enumerate(lines) if l.startswith("## "))
    lines[i2] = "#" + lines[i2]
    # 2) delete the next non-empty block line -> hidden
    idel = next(i for i in range(i2 + 1, len(lines)) if lines[i].strip())
    deleted = lines[idel]
    del lines[idel]
    # 3) add a brand-new line at the end -> insert
    lines.append("")
    lines.append("A sentence nobody printed.")
    r = ops.apply_markdown(ws, doc, "\n".join(lines))
    assert r["shaped"] == 1 and r["hidden"] == 1 and r["inserted"] == 1
    after = ops.view(ws, doc)["markdown"]
    assert "### " in after and "A sentence nobody printed." in after and deleted not in after
    ops.undo(ws, doc)
    assert ops.view(ws, doc)["markdown"] == md
