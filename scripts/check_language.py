#!/usr/bin/env python3
"""American English, checked against a fixed list of pairs.

Deliberately not a suffix pattern. `\\w+ise\\b` matches `otherwise`, `precise`,
`promise`, `supervise` and `raise`; `\\w+yse\\b` matches `analyses`, which is
the correct plural of *analysis* and appears throughout the engine. A pattern
that has to carry a growing list of exceptions is worse than a list of the
words actually being looked for, so this is that list.

Add a pair when one turns up. Do not turn it into a regex.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

#: British -> American. Longer forms first where one contains another, so
#: `judgements` is reported as `judgments` rather than as `judgement`.
PAIRS: dict[str, str] = {
    "analyse": "analyze",
    "analysed": "analyzed",
    "analysing": "analyzing",
    "behaviour": "behavior",
    "cancelled": "canceled",
    "catalogue": "catalog",
    "centre": "center",
    "colour": "color",
    "defence": "defense",
    "emphasise": "emphasize",
    "emphasised": "emphasized",
    "favour": "favor",
    "fibre": "fiber",
    "generalise": "generalize",
    "generalised": "generalized",
    "grey": "gray",
    "honour": "honor",
    "initialise": "initialize",
    "judgement": "judgment",
    "judgements": "judgments",
    "labelled": "labeled",
    "labelling": "labeling",
    "licence": "license",
    "metre": "meter",
    "modelled": "modeled",
    "neighbour": "neighbor",
    "normalise": "normalize",
    "normalised": "normalized",
    "organise": "organize",
    "practise": "practice",
    "recognise": "recognize",
    "recognises": "recognizes",
    "serialise": "serialize",
    "signalling": "signaling",
    "summarise": "summarize",
    "synchronise": "synchronize",
    "travelled": "traveled",
    "unsynchronised": "unsynchronized",
    "whilst": "while",
}

SUFFIXES = (".py", ".ts", ".tsx", ".rs", ".md", ".toml")
SKIP = {"node_modules", ".venv", "target", "dist", ".git", "__pycache__"}

_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")


def offenders(text: str) -> list[tuple[int, str, str]]:
    """(line number, word as written, what it should be)."""
    found = []
    for number, line in enumerate(text.splitlines(), start=1):
        for match in _WORD.finditer(line):
            word = match.group(0)
            american = PAIRS.get(word.lower())
            if american is None:
                continue
            if word[0].isupper():
                american = american.capitalize()
            found.append((number, word, american))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="*", default=["."])
    args = parser.parse_args()

    files: list[Path] = []
    for raw in args.paths:
        root = Path(raw)
        candidates = [root] if root.is_file() else root.rglob("*")
        files += [
            f
            for f in candidates
            if f.suffix in SUFFIXES and f.is_file() and not SKIP & set(f.parts)
        ]

    # this file is the list of the words, so of course it contains them
    me = Path(__file__).resolve()

    count = 0
    for path in sorted(set(files)):
        if path.resolve() == me:
            continue
        for number, word, american in offenders(path.read_text("utf-8", errors="ignore")):
            print(f"{path}:{number}: {word} -> {american}", file=sys.stderr)
            count += 1
    if count:
        print(f"\n{count} British spelling(s). This repo is American English.", file=sys.stderr)
    return 1 if count else 0


if __name__ == "__main__":
    raise SystemExit(main())
