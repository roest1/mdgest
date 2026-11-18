"""What every peer's `convert.py` shares: the job, read and answered.

A peer is run on the same job the mdgest converter is: the JSON file named
on the command line gives the folder the PDFs are in, the folder the
markdown goes to, the PDFs, and the file to say how it went in. A peer
gives `run` a function from a PDF's path to its markdown and the number
of its pages; this times it, writes `<input>.md`, and writes an empty one
for a document the peer could not convert, with the reason.
"""

import json
import pathlib
import sys
import time
from typing import Callable


def run(version: str, convert: Callable[[pathlib.Path], tuple[str, int]]) -> None:
    job = json.loads(pathlib.Path(sys.argv[1]).read_text())
    pdfs, out = pathlib.Path(job["pdfs"]), pathlib.Path(job["out"])
    files = {}
    for done, file in enumerate(job["files"], 1):
        to = (out / file).with_suffix(".md")
        to.parent.mkdir(parents=True, exist_ok=True)
        markdown = ""
        started = time.perf_counter()
        try:
            markdown, pages = convert(pdfs / file)
            ms = (time.perf_counter() - started) * 1000
            files[file] = {"pages": pages, "ms": ms}
        except Exception as cause:  # one document's failure is its own
            files[file] = {"pages": 0, "ms": 0, "error": repr(cause)}
        to.write_text(markdown, encoding="utf-8")
        if done % 100 == 0:
            print(f"  {done}/{len(job['files'])}", flush=True)
    (out / job["run"]).write_text(json.dumps({"version": version, "files": files}))
