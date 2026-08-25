"""Printed page numbers, and what a folder wants done with them.

The number is worth keeping even though the line is not prose: it is how a
reader cites the source, and it is not always the page's position in the file
— front matter is numbered in roman, an extracted chapter starts at 143. So
`keep` / `hide` / `mark` is a per-folder setting rather than a behavior; see
docs/app.md for what each does and why `mark` writes a comment.
"""

from __future__ import annotations

import re

#: Share of page height counted as the band a page number may sit in. The
#: same fraction `occurrences` uses, and for the same reason.
MARGIN_FRACTION = 0.12

POLICIES = ("keep", "hide", "mark")
DEFAULT_POLICY = "keep"

#: A roman numeral, properly formed. The tempting `[ivxlcdm]+` also matches
#: ordinary words — `civil`, `mill`, `did` — which is how a margin line of
#: real text becomes a page number and disappears.
_ROMAN = r"(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})"

#: What a page prints where a page number goes. Bounded deliberately: enough
#: for `12`, `iv`, `Page 12`, `12 of 40`, `- 12 -`, and not enough for a year,
#: a clause number, or a line of prose that happens to start with a digit.
PAGE_NUMBER_RE = re.compile(
    r"^[\s\-–—|·.]*"
    r"(?:page\s+|p\.\s*)?"
    rf"(\d{{1,4}}|{_ROMAN})"
    rf"(?:\s*(?:of|/)\s*(?:\d{{1,4}}|{_ROMAN}))?"
    r"[\s\-–—|·.]*$",
    re.IGNORECASE,
)


def label(text: str) -> str | None:
    """The page number this text prints, or None if it prints something else.

    Position is not checked here — a bare `4` is a page number in the footer
    and a list item in the body, and only the caller knows which band it sits
    in (see `rules.apply`, which asks only about blocks in a margin).
    """
    match = PAGE_NUMBER_RE.match((text or "").strip())
    return match.group(1).lower() if match else None


def policy_of(settings: dict | None) -> str:
    """The page-number policy a settings block asks for, validated."""
    wanted = (settings or {}).get("page_numbers") or DEFAULT_POLICY
    return wanted if wanted in POLICIES else DEFAULT_POLICY


def marker(text: str) -> str:
    """How a marked page number is written into the markdown."""
    return f"<!-- page {label(text) or (text or '').strip()} -->"


__all__ = [
    "DEFAULT_POLICY",
    "MARGIN_FRACTION",
    "PAGE_NUMBER_RE",
    "POLICIES",
    "label",
    "marker",
    "policy_of",
]
