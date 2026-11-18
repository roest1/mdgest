"""Docling over a job's PDFs: its layout and table models over the text
layer, with OCR off, on the CPU.

OCR is off because the comparison is between readers of the text layer.
"""

import importlib.metadata
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from docling.datamodel.accelerator_options import (  # noqa: E402
    AcceleratorDevice,
    AcceleratorOptions,
)
from docling.datamodel.base_models import InputFormat  # noqa: E402
from docling.datamodel.pipeline_options import PdfPipelineOptions  # noqa: E402
from docling.document_converter import DocumentConverter, PdfFormatOption  # noqa: E402
from peer import run  # noqa: E402

options = PdfPipelineOptions()
options.do_ocr = False
options.accelerator_options = AcceleratorOptions(device=AcceleratorDevice.CPU)
converter = DocumentConverter(
    format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
)


def convert(pdf: pathlib.Path) -> tuple[str, int]:
    document = converter.convert(pdf).document
    return document.export_to_markdown(), len(document.pages)


if __name__ == "__main__":
    run(importlib.metadata.version("docling"), convert)
