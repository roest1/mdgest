"""fr-bench-pdf2md's own scorer, run over a tool's markdown.

benchpdf2md scores what vlmparse converted: it looks, for each PDF, for a
zipped vlmparse `Document` named after it under `results/`, and runs the
PDF's tests on that document's text. So each PDF's markdown is wrapped in
a `Document` of one page -- made and zipped by vlmparse's own classes --
and the scorer's `run_and_save_benchmark` is called as its own command
line calls it. No test is run or judged here.

The job is the JSON file named on the command line: the folder the PDFs
and their tests are in, the folder the markdown is in, the PDFs to score,
the folder to work in, and the tool's name. What the scorer wrote is
summed up in `summary.json` there: its `metrics.json` as it stands, and
how many tests each category held and passed.

One thing is settled before the scorer runs. Its tests normalise the text
with a function that raises on markdown it takes for binary -- a NUL
character is enough -- and one raise ends the whole run with no score. So
each document is put to that function first, and one it refuses is given
to the scorer empty: its tests fail, as they would for a page the tool
could not read, and `summary.json` names it.
"""

import json
import os
import pathlib
import sys

import pandas as pd
from benchpdf2md.bench_tests.benchmark_tsts import BaselineTest
from benchpdf2md.create_dataset import create_dataset
from benchpdf2md.run_benchmark import run_and_save_benchmark
from vlmparse.data_model.document import Document, Page


def main() -> None:
    job = json.loads(pathlib.Path(sys.argv[1]).read_text())
    pdfs, out, work = (pathlib.Path(job[key]) for key in ("pdfs", "out", "work"))

    wanted = set(job["files"])
    tests = create_dataset(pdfs)
    tests = tests[tests.pdf_path.map(lambda p: os.path.relpath(p, pdfs)).isin(wanted)]

    probe = BaselineTest(pdf="probe", page=0, id="probe")
    refused = []
    for file in job["files"]:
        markdown = (out / file).with_suffix(".md").read_text(encoding="utf-8")
        try:
            probe.normalise(markdown)
        except ValueError as cause:
            refused.append({"file": file, "why": str(cause)})
            markdown = ""
        Document(
            file_path=str(pdfs / file),
            pages=[Page(text=markdown, latency=0.0)],
            latency=0.0,
        ).to_zip(work / "results" / pathlib.Path(file).stem)

    run_and_save_benchmark(
        ds=tests, inference_folder=work, save_folder=work, model=job["tool"]
    )

    # The one run in this folder, which was empty before it.
    (written,) = (work / "test_results").iterdir()
    results = pd.read_parquet(written / "test_results.parquet")
    by_category = results.groupby("category")["result"].agg(["sum", "count"])
    summary = {
        "metrics": json.loads((written / "metrics.json").read_text()),
        "refused": refused,
        "categories": {
            name: {"passed": int(row["sum"]), "total": int(row["count"])}
            for name, row in by_category.iterrows()
        },
    }
    (work / "summary.json").write_text(json.dumps(summary))


if __name__ == "__main__":
    main()
