"""The gate: does the markdown say what the page says, and nothing else?

Measured against the page map, never against a reference copy of the document.
A reference is itself unverified — a hand-made corpus can contain headings and
whole sentences that appear in no source, and comparing against one scores the
engine's fidelity as the reference's failure. Against the page there is no such
ambiguity: a word is printed on it or it is not.

Four checks:

1. **Coverage** — every word of every visible line reaches the markdown.
2. **Invention** — no word in the markdown is absent from both the page and
   the inserts. In this engine that check is exact rather than heuristic, and
   the reason is structural: a block's `text` is read off the page and is
   never writable (`edits.BLOCK_FIELDS` has no `text`), so the only words that
   can enter the output another way are a person's inserts, which arrive
   already labelled `origin: "person"`. Even the freehand markdown editor
   keeps this — `ops.apply_markdown` turns a line whose *words* changed into a
   hide plus an insert, never an in-place rewrite. So a word here that is on
   no page and in no insert is not a judgement call about the document. It is
   a bug in mdgest, and this is the check that finds it.
3. **Leaks** — nothing hidden reaches the markdown.
4. **Headings** — every heading emitted from the page is text really on it.

Ported from mdgest v1, with its profile-driven "required wording" check
dropped (v1 read those phrases from a client profile; this engine has no
profiles) and its text-scraping replaced: `emit.document_markdown` tags every
output line with the block that produced it, so words are attributed to the
page or to a person by construction instead of by parsing them back out.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from . import emit
from .pagemap import Box
from .rules import text_key
from .structure import xy_cut

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")

#: Words are compared after folding the punctuation that conversion changes.
WORD_RE = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
#: The marker markdown puts in front of a counted item, at the start of a line.
#: Bounded like `pagemap.MARKER_RE`, which reads them off the page.
LIST_MARKER_RE = re.compile(r"(?m)^\s*(\d{1,3}|[ivxlcdm]{1,5}|[a-z])[.)]\s", re.IGNORECASE)
_QUOTES = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'})
_DASHES = re.compile(r"[‐-―−]")
_COMPOUND = re.compile(r"(?<=[a-z0-9])-(?=[a-z0-9])")

PASS_COVERAGE = 0.98
#: Lines of something else a heading may be printed among and still be one
#: heading: a `Notes:` label in the margin at a baseline between its two
#: halves, or a neighbouring column's line where the page interleaves them.
#: Two covers what real pages do; it is not a licence to scatter.
INTRUDING_LINES = 2


def normalize(text: str) -> str:
    """Fold the punctuation differences that are not content differences.

    A PDF's curly quotes come back straight, and an apostrophe treated as a
    word character would make `athlete's` a different word from `athletes`.
    Hyphenated compounds split, so `mid-back` and `midback` agree.
    Contractions survive whole.
    """
    text = text.lower().translate(_QUOTES)
    text = _DASHES.sub("-", text)
    return _COMPOUND.sub(" ", text)


def tokens(text: str) -> Counter[str]:
    return Counter(WORD_RE.findall(normalize(text)))


@dataclass
class Report:
    coverage: float
    missing: list[tuple[str, int]] = field(default_factory=list)
    invented: list[tuple[str, int]] = field(default_factory=list)
    leaked: list[str] = field(default_factory=list)
    untraceable_headings: list[str] = field(default_factory=list)
    #: Words a person typed. Not a failure — reported so the share of the
    #: document that is not the document is visible at a glance.
    inserted_words: int = 0

    @property
    def passed(self) -> bool:
        return (
            self.coverage >= PASS_COVERAGE
            and not self.invented
            and not self.leaked
            and not self.untraceable_headings
        )

    def render(self) -> str:
        lines = [f"coverage: {self.coverage:.2%}  ({'PASS' if self.passed else 'FAIL'})"]
        if self.inserted_words:
            lines.append(f"inserted by hand: {self.inserted_words} words")
        for label, items in (
            ("words on the page but not in the markdown", self.missing[:25]),
            ("words in the markdown but on no page (a bug)", self.invented[:25]),
        ):
            if items:
                lines.append(f"{label}: " + ", ".join(f"{w} x{n}" for w, n in items))
        for label, items in (
            ("hidden text that reached the markdown", self.leaked),
            ("headings not found on any page", self.untraceable_headings),
        ):
            if items:
                lines.append(f"{label}:")
                lines.extend(f"  - {item}" for item in items)
        return "\n".join(lines)


def _strip_markup(text: str) -> str:
    """Drop what is ours rather than the page's: image links and page rules."""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    return re.sub(r"(?m)^---$", "", text)


def _page_lines(page: dict) -> list[str]:
    return [ln.get("text", "") for ln in page.get("lines", [])]


def _visible_line_indices(page: dict, blocks: list[dict]) -> tuple[set[int], set[int]]:
    """(visible, hidden) page-line indices, by the block each line belongs to.

    A joined child's lines travel with its parent — `resolve_page` folds the
    child's words into the parent and drops it from the list — so its indices
    are collected from the parent's `joined` list rather than lost.
    """
    by_id = {b["id"]: b for b in blocks}
    visible: set[int] = set()
    hidden: set[int] = set()
    raw_by_id = {b["id"]: b for b in page.get("blocks", [])}
    for blk in blocks:
        if blk.get("origin") != "page":
            continue
        idx = list(blk.get("lines") or [])
        for child in blk.get("joined") or []:
            idx.extend(raw_by_id.get(child, {}).get("lines") or [])
        (hidden if blk.get("hidden") else visible).update(idx)
    # a block that resolve_page removed entirely (neither kept nor joined) is
    # not on screen and not in the output; treat it as hidden, not as missing.
    accounted = visible | hidden
    for blk in page.get("blocks", []):
        if blk["id"] in by_id:
            continue
        for i in blk.get("lines") or []:
            if i not in accounted:
                hidden.add(i)
    return visible, hidden


def _expected(analysis: dict, resolved: dict[int, list[dict]]) -> Counter[str]:
    """Words the markdown must contain.

    A line repeated across pages counts once. A deck restates its section
    banner on every slide and the markdown states it once, which is correct;
    counting each restatement would read as loss.
    """
    seen: set[str] = set()
    expected: Counter[str] = Counter()
    for page in analysis["pages"]:
        texts = _page_lines(page)
        visible, _ = _visible_line_indices(page, resolved[page["n"]])
        for i in sorted(visible):
            if i >= len(texts):
                continue
            identity = text_key(texts[i])
            if not identity or identity in seen:
                continue
            seen.add(identity)
            expected += tokens(texts[i])
    return expected


def _column_reading(page: dict) -> str:
    """The page read down its columns — the order `structure.analyse` uses.

    A page map is one list per page, top to bottom, so a two-column layout
    interleaves and a heading wrapped over two lines of the left column has
    the right column's line sitting between its halves. Both readings are the
    page; a heading found in either is on it.
    """
    lines = page.get("lines", [])
    if not lines:
        return ""
    boxes = [Box(*ln["bbox"]) for ln in lines]
    heights = sorted(b.top - b.bottom for b in boxes)
    unit = heights[len(heights) // 2] if heights else 10.0
    order = [i for leaf in xy_cut(list(enumerate(boxes)), unit or 10.0) for i in leaf]
    return "\n".join(lines[i].get("text", "") for i in order)


def _printed_together(heading: list[str], lines: list[list[str]]) -> bool:
    """Is this heading a run of lines on the page, give or take an intruder?

    A heading is checked against the page as a plain substring first, and
    against the page read down its columns, and that is what normally matches.
    What defeats both is a heading wrapped over two lines with something
    printed *between* them. Then the question worth asking is this one: are
    the heading's lines here, whole, consecutive, in order, with no more than
    a couple of other lines among them. A heading assembled from a block is
    exactly that by construction. Words scattered over a page are not, and
    neither is the same wording in another order.
    """
    if not heading:
        return False
    for start in range(len(lines)):
        need, intruders = heading, 0
        for words in lines[start:]:
            shared = 0
            while shared < len(words) and shared < len(need) and words[shared] == need[shared]:
                shared += 1
            if shared and shared == min(len(words), len(need)):
                need = need[shared:]
                if not need:
                    return True
            elif need is heading:
                break  # this line is not the start of it
            elif intruders >= INTRUDING_LINES:
                break
            else:
                intruders += 1
    return False


def check(analysis: dict, edits: dict) -> Report:
    """Score one document's markdown against the pages it was read from."""
    doc = emit.document_markdown(analysis, edits)
    resolved = {p["n"]: p["blocks"] for p in doc["pages"]}
    origin_of = {b["id"]: b.get("origin") for p in doc["pages"] for b in p["blocks"]}

    # Attribute every output line to the page or to a person. The emitter
    # already tagged each line with its block, so this is a lookup, not a parse.
    from_page: list[str] = []
    from_person: list[str] = []
    for ln in doc["lines"]:
        bid = ln.get("block")
        if not bid:
            continue  # blank lines and page rules are ours, not anyone's words
        (from_person if origin_of.get(bid) == "person" else from_page).append(ln["text"])
    page_output = _strip_markup("\n".join(from_page))
    person_output = _strip_markup("\n".join(from_person))

    produced_page = tokens(page_output)
    produced_person = tokens(person_output)
    expected = _expected(analysis, resolved)

    mass = sum(expected.values()) or 1
    missing = expected - (produced_page + produced_person)
    coverage = 1.0 - sum(missing.values()) / mass

    # Everything printed anywhere counts as on the page — hidden lines
    # included, because a leak is a different finding than an invention.
    on_page: Counter[str] = Counter()
    for page in analysis["pages"]:
        on_page += tokens("\n".join(_page_lines(page)))
    # A counted list's marker is markup, not a word: markdown writes `3.` in
    # front of the third item exactly as it writes `-` in front of a bullet,
    # and renumbers, so the digit it writes need not be the digit the page
    # printed. Discount markers here only — coverage is measured above, so a
    # number the page really does print is still owed back.
    markers = tokens(" ".join(LIST_MARKER_RE.findall(page_output)))
    invented = Counter({w: n for w, n in (produced_page - markers).items() if w not in on_page})

    # Leaks: wording that is hidden *everywhere* and still reached the output.
    # The same text often occurs twice — once in a contents list that is
    # hidden, once as the heading of the page it points at, which stays — and
    # the surviving copy is not a leak.
    body_keys = {
        text_key(re.sub(r"^#{1,6}\s+", "", ln)) for ln in page_output.splitlines() if ln.strip()
    }
    visible_keys: set[str] = set()
    hidden_texts: dict[str, str] = {}
    for page in analysis["pages"]:
        texts = _page_lines(page)
        visible, hidden = _visible_line_indices(page, resolved[page["n"]])
        for i in visible:
            if i < len(texts):
                visible_keys.add(text_key(texts[i]))
        for i in hidden:
            if i < len(texts) and text_key(texts[i]):
                hidden_texts[text_key(texts[i])] = texts[i]
    leaked = sorted(
        text for key, text in hidden_texts.items() if key in body_keys and key not in visible_keys
    )

    # Headings: only those emitted from the page are owed to it. A heading a
    # person inserted is theirs, and they were warned when they typed it.
    readings: list[str] = []
    printed: list[list[list[str]]] = []
    for page in analysis["pages"]:
        flat = normalize(re.sub(r"\s+", " ", " ".join(_page_lines(page))))
        readings.append(flat)
        readings.append(flat.replace("- ", ""))
        readings.append(normalize(re.sub(r"\s+", " ", _column_reading(page))))
        printed.append([WORD_RE.findall(normalize(t)) for t in _page_lines(page)])
    untraceable: list[str] = []
    for ln in doc["lines"]:
        bid = ln.get("block")
        if not bid or origin_of.get(bid) == "person":
            continue
        m = HEADING_RE.match(ln["text"])
        if not m:
            continue
        heading = normalize(re.sub(r"\s+", " ", m.group(2))).strip()
        if not heading or any(heading in reading for reading in readings):
            continue
        words = WORD_RE.findall(heading)
        if any(_printed_together(words, page_lines) for page_lines in printed):
            continue
        untraceable.append(m.group(2))

    return Report(
        coverage=coverage,
        missing=missing.most_common(),
        invented=invented.most_common(),
        leaked=leaked,
        untraceable_headings=untraceable,
        inserted_words=sum(produced_person.values()),
    )


__all__ = ["PASS_COVERAGE", "Report", "check", "normalize", "tokens"]
