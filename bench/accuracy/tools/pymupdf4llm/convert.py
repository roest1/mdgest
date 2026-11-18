"""PyMuPDF4LLM over a job's PDFs: its defaults, with OCR off.

The job is the JSON file named on the command line, the one the mdgest
converter is given: the folder the PDFs are in, the folder the markdown
goes to, and the PDFs. OCR is off because the comparison is between
readers of the text layer; left on, it would run only where an OCR engine
happens to be installed, and the score would depend on the machine.
"""

import importlib.metadata
import json
import pathlib
import sys
import time

import pymupdf
import pymupdf4llm


def main() -> None:
    job = json.loads(pathlib.Path(sys.argv[1]).read_text())
    pdfs, out = pathlib.Path(job["pdfs"]), pathlib.Path(job["out"])
    files = {}
    for done, file in enumerate(job["files"], 1):
        to = (out / file).with_suffix(".md")
        to.parent.mkdir(parents=True, exist_ok=True)
        markdown = ""
        started = time.perf_counter()
        try:
            with pymupdf.open(pdfs / file) as doc:
                pages = doc.page_count
                markdown = pymupdf4llm.to_markdown(doc, use_ocr=False)
            ms = (time.perf_counter() - started) * 1000
            files[file] = {"pages": pages, "ms": ms}
        except Exception as cause:  # one document's failure is its own
            files[file] = {"pages": 0, "ms": 0, "error": repr(cause)}
        to.write_text(markdown, encoding="utf-8")
        if done % 100 == 0:
            print(f"  {done}/{len(job['files'])}", flush=True)
    run = {"version": importlib.metadata.version("pymupdf4llm"), "files": files}
    (out / "run.json").write_text(json.dumps(run))


if __name__ == "__main__":
    main()
