"""MarkItDown over a job's PDFs, as it comes: it reads the text layer and
has no OCR of its own."""

import importlib.metadata
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from markitdown import MarkItDown  # noqa: E402
from pdfminer.pdfpage import PDFPage  # noqa: E402
from peer import run  # noqa: E402

converter = MarkItDown()


def convert(pdf: pathlib.Path) -> tuple[str, int]:
    markdown = converter.convert(str(pdf)).text_content
    with open(pdf, "rb") as file:
        return markdown, sum(1 for _ in PDFPage.get_pages(file))


if __name__ == "__main__":
    run(importlib.metadata.version("markitdown"), convert)
