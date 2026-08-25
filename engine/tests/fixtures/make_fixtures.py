#!/usr/bin/env python3
"""Generate the test corpus: two small, entirely synthetic PDFs.

Run `python make_fixtures.py` to rewrite doc-a.pdf / doc-b.pdf in place; the
output is byte-for-byte deterministic, so a regenerated fixture only shows up
in `git status` when this script actually changed.

The content is invented (a fictional widget manual) and shares nothing with
any real document. It exists to exercise the parts of the engine that a blank
page cannot: two heading sizes over a body size, a multi-line paragraph that
has to be joined, printed bullets at two indents, numbered and lettered
items, a bold run-in label, one image with real drawn bounds, and the three
kinds of page furniture: a running header and a copyright footer (identical in
both documents and set the same way as each other, so hiding one is evidence
about the other) and a page number (same band, different indent, different
wording per page). Both documents carry the same label and furniture so the
rule-learning tests have something to carry from one to the other.

Base-14 fonts only (no embedding), hand-assembled objects (no writer library):
pypdfium2 renders, it does not author.
"""

from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).parent

BODY, H2, H1, SMALL = 10.0, 14.0, 20.0, 8.0
LEADING = 12.0
LEFT = 72.0
BULLET = "\x95"  # WinAnsi 0x95 -> U+2022, which pagemap.BULLETS recognizes


def esc(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


class Content:
    """A page's content stream, built line by line from the top down."""

    def __init__(self) -> None:
        self.ops: list[str] = []

    def text(self, x: float, y: float, size: float, s: str, *, bold: bool = False) -> None:
        font = "/F2" if bold else "/F1"
        self.ops.append(f"BT {font} {size:g} Tf 1 0 0 1 {x:g} {y:g} Tm ({esc(s)}) Tj ET")

    def paragraph(self, x: float, y: float, lines: list[str], size: float = BODY) -> float:
        """Consecutive lines one leading apart — the engine should join these."""
        for line in lines:
            self.text(x, y, size, line)
            y -= LEADING
        return y

    def image(self, x: float, y: float, w: float, h: float) -> None:
        self.ops.append(f"q {w:g} 0 0 {h:g} {x:g} {y:g} cm /Im1 Do Q")

    def render(self) -> bytes:
        return "\n".join(self.ops).encode("latin-1")


class Pdf:
    def __init__(self) -> None:
        self.objects: list[bytes] = []

    def add(self, body: bytes) -> int:
        self.objects.append(body)
        return len(self.objects)

    def stream(self, extra: str, data: bytes) -> int:
        return self.add(f"<< {extra} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream")

    def build(self, root: int) -> bytes:
        out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, body in enumerate(self.objects, start=1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(self.objects) + 1}\n".encode()
        out += b"0000000000 65535 f \n"
        for off in offsets:
            out += f"{off:010d} 00000 n \n".encode()
        out += (
            f"trailer\n<< /Size {len(self.objects) + 1} /Root {root} 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n"
        ).encode()
        return bytes(out)


# a 2x2 RGB image, scaled up on the page — enough to give pagemap real bounds
IMAGE_BYTES = bytes([0x30, 0x60, 0xA0, 0xC0, 0x50, 0x30, 0xE0, 0xC0, 0x40, 0x20, 0x30, 0x70])


def write(path: Path, title: str, page1: Content, page2: Content) -> None:
    pdf = Pdf()
    f1 = pdf.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    f2 = pdf.add(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    )
    im = pdf.stream(
        "/Type /XObject /Subtype /Image /Width 2 /Height 2 "
        "/ColorSpace /DeviceRGB /BitsPerComponent 8",
        IMAGE_BYTES,
    )
    resources = (
        f"/Font << /F1 {f1} 0 R /F2 {f2} 0 R >> /XObject << /Im1 {im} 0 R >>"
    )
    pages_ref = len(pdf.objects) + 1 + 2 * 2  # contents+page for each of the 2 pages
    page_refs = []
    for content in (page1, page2):
        c = pdf.stream("", content.render())
        page_refs.append(
            pdf.add(
                f"<< /Type /Page /Parent {pages_ref} 0 R /MediaBox [0 0 612 792] "
                f"/Resources << {resources} >> /Contents {c} 0 R >>".encode()
            )
        )
    kids = " ".join(f"{r} 0 R" for r in page_refs)
    pages = pdf.add(f"<< /Type /Pages /Count {len(page_refs)} /Kids [{kids}] >>".encode())
    assert pages == pages_ref, (pages, pages_ref)
    info = pdf.add(f"<< /Title ({esc(title)}) >>".encode())  # noqa: F841
    root = pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>".encode())
    path.write_bytes(pdf.build(root))


#: A running header and footer, identical in both documents and set the same
#: way as each other -- so hiding one is evidence about the other, which is
#: what `occurrences.suggest` learns from. Page numbers sit in the same band
#: but are indented differently and change page to page.
HEADER = "Widget Corp - Internal Use Only"
FOOTER = "Copyright 2026 Fixture Press. Synthetic test data."


def furniture(page: Content, number: int) -> None:
    """What every page carries that is not the document."""
    page.text(LEFT, 772, SMALL, HEADER)  # clear of the 20pt title's ascent
    page.text(LEFT, 72, SMALL, FOOTER)
    page.text(300, 56, SMALL, f"Page {number}")


def manual(subject: str, verb: str) -> tuple[Content, Content]:
    """Both fixtures share a shape and differ in wording."""
    p1 = Content()
    p1.text(LEFT, 740, H1, f"Widget {subject} Manual", bold=True)
    p1.text(LEFT, 705, H2, "Overview", bold=True)
    p1.paragraph(
        LEFT,
        685,
        [
            f"The {verb} proceeds in four stages. Each stage depends on the one",
            "before it, so do not skip ahead. Read this section end to end",
            "before you pick up a single tool.",
        ],
    )
    p1.text(LEFT, 620, H2, "Required Parts", bold=True)
    p1.text(LEFT, 598, BODY, f"{BULLET} Frame plate, anodized")
    p1.text(LEFT, 584, BODY, f"{BULLET} Hex bolts, eight of them")
    p1.text(LEFT + 18, 570, BODY, "- Washers ship in the bolt bag")
    p1.text(LEFT, 556, BODY, f"{BULLET} Torque wrench, calibrated this year")
    p1.text(LEFT, 520, H2, "Procedure", bold=True)
    p1.text(LEFT, 498, BODY, "1. Seat the frame plate flat on the jig.")
    p1.text(LEFT, 484, BODY, "2. Thread every bolt by hand before torquing any of them.")
    p1.text(LEFT, 470, BODY, "3. Torque to spec in a star pattern, never in a circle.")
    p1.text(LEFT, 434, BODY, "Key Points:", bold=True)
    p1.paragraph(
        LEFT,
        418,
        [
            "A hand-thread that binds means the plate is not seated. Back it out",
            "and start the stage again rather than forcing the bolt.",
        ],
    )
    p1.image(LEFT, 250, 144, 108)
    furniture(p1, 1)

    p2 = Content()
    p2.text(LEFT, 740, H2, "Verification", bold=True)
    p2.paragraph(
        LEFT,
        718,
        [
            "Verify the assembly cold, before the first run. A warm frame hides",
            "the very gap you are looking for.",
        ],
    )
    p2.text(LEFT, 670, BODY, "a. Check the gap with a feeler gauge at all four corners.")
    p2.text(LEFT, 656, BODY, "b. Re-torque after ten minutes of rest.")
    p2.text(LEFT, 642, BODY, "c. Record the final reading in the build log.")
    p2.text(LEFT, 606, H2, "Troubleshooting", bold=True)
    p2.text(LEFT, 584, BODY, "Key Points:", bold=True)
    p2.paragraph(
        LEFT,
        568,
        [
            "A reading that drifts between the first and second torque pass is a",
            "seating problem, not a calibration problem.",
        ],
    )
    furniture(p2, 2)
    return p1, p2


def main() -> None:
    write(HERE / "doc-a.pdf", "Widget Assembly Manual", *manual("Assembly", "assembly"))
    write(HERE / "doc-b.pdf", "Widget Maintenance Manual", *manual("Maintenance", "service"))
    for p in ("doc-a.pdf", "doc-b.pdf"):
        print(f"wrote {HERE / p} ({(HERE / p).stat().st_size} bytes)")


if __name__ == "__main__":
    main()
