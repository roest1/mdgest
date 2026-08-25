#!/usr/bin/env python3
"""Comments and docstrings are on a budget, and this is the budget.

A comment that names the failure it prevents is worth its line. A comment that
restates the code, or repeats what `docs/` already says, is a line the next
reader has to check against the code and discard. The second kind grows
quietly, and nobody notices until a twenty-line module carries forty lines of
prose about itself.

Two limits, both chosen from what the engine's own well-worn modules already
do rather than from anyone's opinion:

    module docstring   <= MAX_MODULE_DOC lines   -- longer belongs in docs/
    prose / code       <= MAX_RATIO             -- for modules big enough to judge

Run it directly to see every module's ratio; `--check` exits 1 over budget.
"""

from __future__ import annotations

import argparse
import ast
import io
import sys
import tokenize
from pathlib import Path

#: A module docstring says what question the module answers and what would go
#: wrong otherwise. Past this it is documentation, and documentation belongs
#: where it can be read without opening a source file. The number is the
#: longest docstring among the engine's original modules, not an opinion.
MAX_MODULE_DOC = 20

#: Prose lines per code line. The engine's oldest modules sit at 0.08-0.20.
#: This is set where the explanation-dense modules pass and narration does not:
#: `fidelity` earns 0.42 because every check it makes has a subtle reason, and
#: that is the ceiling, not the target.
MAX_RATIO = 0.45

#: Below this a docstring legitimately dominates, so the ratio says nothing.
#: The module-docstring limit still applies.
MIN_CODE_LINES = 40


def measure(path: Path) -> dict:
    src = path.read_text("utf-8")
    lines = src.splitlines()
    blank = sum(1 for line in lines if not line.strip())

    comment = sum(
        1
        for tok in tokenize.generate_tokens(io.StringIO(src).readline)
        if tok.type == tokenize.COMMENT
    )

    tree = ast.parse(src)
    module_doc = ast.get_docstring(tree, clean=False)
    module_doc_lines = module_doc.count("\n") + 2 if module_doc else 0

    doc = module_doc_lines
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            text = ast.get_docstring(node, clean=False)
            if text:
                doc += text.count("\n") + 2

    code = len(lines) - blank - comment - doc
    return {
        "path": path,
        "code": max(code, 0),
        "prose": comment + doc,
        "module_doc": module_doc_lines,
        "ratio": (comment + doc) / code if code > 0 else 0.0,
    }


def over_budget(row: dict) -> list[str]:
    problems = []
    if row["module_doc"] > MAX_MODULE_DOC:
        problems.append(
            f"module docstring is {row['module_doc']} lines (limit {MAX_MODULE_DOC})"
            " — move the detail into docs/"
        )
    if row["code"] >= MIN_CODE_LINES and row["ratio"] > MAX_RATIO:
        problems.append(
            f"{row['prose']} prose lines to {row['code']} of code"
            f" = {row['ratio']:.2f} (limit {MAX_RATIO:.2f})"
        )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if over budget")
    parser.add_argument("paths", nargs="*", default=["mdgest"])
    args = parser.parse_args()

    files: list[Path] = []
    for raw in args.paths:
        p = Path(raw)
        files.extend(sorted(p.rglob("*.py")) if p.is_dir() else [p])

    rows = [measure(f) for f in files if f.name != "__init__.py"]
    rows.sort(key=lambda r: -r["ratio"])

    failures = 0
    if not args.check:
        print(f"{'module':<20}{'code':>6}{'prose':>7}{'doc':>6}{'ratio':>8}")
        print("-" * 47)
    for row in rows:
        problems = over_budget(row)
        failures += bool(problems)
        if args.check:
            for problem in problems:
                print(f"{row['path']}: {problem}", file=sys.stderr)
        else:
            mark = "  OVER" if problems else ""
            print(
                f"{row['path'].name:<20}{row['code']:>6}{row['prose']:>7}"
                f"{row['module_doc']:>6}{row['ratio']:>8.2f}{mark}"
            )

    total_code = sum(r["code"] for r in rows)
    total_prose = sum(r["prose"] for r in rows)
    if not args.check:
        print("-" * 47)
        print(f"{'all':<20}{total_code:>6}{total_prose:>7}{'':>6}{total_prose / total_code:>8.2f}")
    elif failures:
        print(f"\n{failures} module(s) over the prose budget.", file=sys.stderr)
    return 1 if failures and args.check else 0


if __name__ == "__main__":
    raise SystemExit(main())
