"""PyMuPDF4LLM over a job's PDFs: its defaults, with OCR off.

OCR is off because the comparison is between readers of the text layer;
left on, it would run only where an OCR engine happens to be installed,
and the score would depend on the machine.
"""

import importlib.metadata
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import pymupdf  # noqa: E402
import pymupdf4llm  # noqa: E402
from peer import run  # noqa: E402


def convert(pdf: pathlib.Path) -> tuple[str, int]:
    with pymupdf.open(pdf) as doc:
        return pymupdf4llm.to_markdown(doc, use_ocr=False), doc.page_count


if __name__ == "__main__":
    run(importlib.metadata.version("pymupdf4llm"), convert)
