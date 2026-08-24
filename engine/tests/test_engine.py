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


def test_rules_carry_to_the_next_document(ws):
    a = ws.add_pdf(SAMPLE.read_bytes(), "doc-a.pdf", "acme/manuals/widgets")
    ops.analyze(ws, a)
    v = ops.view(ws, a)
    # the bold run-in labels ("Key Points:") read as H3s by default; say they are
    # ordinary paragraphs, and learn that for everything under widgets/
    target = next(b for b in v["pages"][0]["blocks"] if b["text"].startswith("Key Points"))
    assert target["role"] == "heading"
    r = ops.set_block(ws, a, target["id"], learn="acme/manuals/widgets", role="para")
    assert r["learned"]["shape"]["fields"]["role"] == "para"
    # and hide the copyright footer, learned at the client level
    foot = next(b for b in v["pages"][0]["blocks"] if "Copyright" in b["text"])
    ops.set_block(ws, a, foot["id"], learn="acme", hidden=True)

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
