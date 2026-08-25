"""Where else does this wording appear, and where on the page does it sit?

Hiding a block asks a question the block cannot answer: how far should this
reach? A running footer should go from every document in the folder. A section
heading that happens to be printed twice should go from neither. Both are
"wording that repeats", and telling them apart by repetition alone is the
mistake that deletes real content — on a twenty-page deck a section banner
shown on eight slides clears any sensible repetition threshold.

Position decides. Repetition is the necessary condition, position the
deciding one:

    in a page margin, on several pages  ->  the whole folder
    in a page margin, on one page       ->  this instance only
    in the body, printed once           ->  this instance only
    in the body, printed several times  ->  this document, flagged

v1 also required a margin wording to be corroborated across *documents* before
it would generalize. That fits a corpus ingested all at once and not this one:
here documents arrive one at a time, and the first is exactly when a person
sets up the footer rule for the rest. Requiring a second document to exist
first would decline the decision at the only moment it is worth making.

**Margin wording generalizes by default; body wording does not.** A line
repeating in the margins is furniture with near certainty. A line repeating in
the body is very often a section title, and deleting one of those is the
expensive mistake — the more so because the gate cannot report it: coverage is
computed over what is visible, so hiding removes the expectation along with
the content (see `fidelity`).

Nothing here decides anything. It proposes a scope and lists exactly what that
scope would touch, and a person accepts it, narrows it, or ignores it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .rules import signature, text_key
from .store import Workspace

#: Share of page height counted as the header/footer band.
MARGIN_FRACTION = 0.12
#: A wording is margin furniture when at least this share of the pages it is
#: printed on put it in a margin band. Below it, treat it as body text.
MARGIN_SHARE = 0.5

#: The three reaches a hide can have, narrowest first.
SCOPES = ("block", "document", "folder")


def _plural(n: int, noun: str) -> str:
    """`1 document` / `6 documents` — these strings are read by a person."""
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


@dataclass(frozen=True)
class Occurrence:
    """One printing of a wording: which document, which page, where on it."""

    doc: str
    page: int
    block: str
    text: str
    margin: bool
    #: how the block is set, keyed as `rules.signature` keys a shape rule —
    #: so "things set like the ones you already hid" is answerable
    signature: str = ""
    hidden: bool = False


@dataclass
class Evidence:
    """Everything known about one wording, across the documents indexed."""

    key: str
    occurrences: list[Occurrence] = field(default_factory=list)

    @property
    def documents(self) -> set[str]:
        return {o.doc for o in self.occurrences}

    @property
    def pages(self) -> set[tuple[str, int]]:
        return {(o.doc, o.page) for o in self.occurrences}

    @property
    def margin_pages(self) -> set[tuple[str, int]]:
        return {(o.doc, o.page) for o in self.occurrences if o.margin}

    @property
    def in_margin(self) -> bool:
        if not self.occurrences:
            return False
        return len(self.margin_pages) / len(self.pages) >= MARGIN_SHARE

    def within(self, doc: str) -> list[Occurrence]:
        return [o for o in self.occurrences if o.doc == doc]


@dataclass(frozen=True)
class Proposal:
    """A scope, why the evidence supports it, and whether it wants a look."""

    scope: str
    why: str
    flagged: bool = False


@dataclass
class Index:
    """Every text block of every analyzed document, keyed by normalized text."""

    by_key: dict[str, Evidence] = field(default_factory=dict)
    documents: list[str] = field(default_factory=list)

    @classmethod
    def build(cls, analyses: dict[str, dict], hidden: dict[str, set[str]] | None = None) -> Index:
        """`hidden` names the blocks a person hid per document (from each
        document's `edits.json`), which the analysis alone does not know."""
        hidden = hidden or {}
        index = cls(documents=sorted(analyses))
        for doc in index.documents:
            for page in analyses[doc]["pages"]:
                band = page["height"] * MARGIN_FRACTION
                for blk in page["blocks"]:
                    if blk.get("kind") != "text":
                        continue
                    key = text_key(blk.get("text") or "")
                    if not key:
                        continue
                    box = blk.get("bbox") or [0, 0, 0, 0]
                    bottom, top = box[1], box[3]
                    index.by_key.setdefault(key, Evidence(key=key)).occurrences.append(
                        Occurrence(
                            doc=doc,
                            page=page["n"],
                            block=blk["id"],
                            text=blk.get("text") or "",
                            margin=top > page["height"] - band or bottom < band,
                            signature=signature(blk),
                            hidden=bool(blk.get("hidden")) or blk["id"] in hidden.get(doc, set()),
                        )
                    )
        return index

    @classmethod
    def over(cls, ws: Workspace, folder: str = "") -> Index:
        """Every analyzed document under a folder. Unanalyzed ones are skipped
        rather than read — a preview must not trigger minutes of work."""
        from . import edits as E

        analyses, hidden = {}, {}
        for doc in ws.docs(folder):
            if not ws.has_analysis(doc):
                continue
            analyses[doc] = ws.read_analysis(doc)
            overrides = E.load(ws.edits_path(doc)).get("blocks", {})
            hidden[doc] = {b for b, ov in overrides.items() if ov.get("hidden")}
        return cls.build(analyses, hidden)

    def evidence(self, key: str) -> Evidence:
        return self.by_key.get(key, Evidence(key=key))

    def propose(self, key: str, doc: str) -> Proposal:
        """The scope the evidence supports — never asked for, always shown."""
        evidence = self.evidence(key)
        elsewhere = sorted(evidence.documents - {doc})
        here = len(evidence.within(doc))
        pages = len(evidence.pages)

        if evidence.in_margin:
            # Repetition is the necessary condition, position the deciding one.
            # Printed in a margin band on more than one page is running
            # furniture — a header, a footer, a page number — and generalizing
            # it is the whole point of learning a rule.
            if pages > 1:
                where = f"{_plural(pages, 'page')}"
                if elsewhere:
                    where += f" across {_plural(len(evidence.documents), 'document')}"
                return Proposal(
                    "folder",
                    f"printed in the page margin of {where} — furniture, not the document",
                )
            # Once, in a margin: a one-off. There is nothing to generalize, and
            # a title set at the top of a cover page reads as margin too.
            return Proposal("block", "printed once, in the margin of a single page")

        if here <= 1 and not elsewhere:
            return Proposal("block", "printed once, in the body of the page")

        where = f"{_plural(here, 'time')} in this document"
        if elsewhere:
            where += f" and in {_plural(len(elsewhere), 'other document')}"
        return Proposal(
            "document",
            f"printed in the body of the page, {where}. Body wording that repeats "
            "is very often a section heading, so this stays narrow",
            flagged=True,
        )

    # ---- learning what *this* person calls boilerplate ----------------------

    def hidden_signatures(self) -> dict[str, int]:
        """How a person sets the things they hide: signature -> how many
        distinct wordings they have hidden that are set that way."""
        by_signature: dict[str, set[str]] = {}
        for evidence in self.by_key.values():
            for o in evidence.occurrences:
                if o.hidden and o.signature:
                    by_signature.setdefault(o.signature, set()).add(evidence.key)
        return {sig: len(keys) for sig, keys in by_signature.items()}

    def suggest(self, doc: str = "") -> list[dict]:
        """Wordings that look like the ones already hidden, and are not.

        Nothing is proposed until a person has hidden something: the pattern is
        learned from what *they* excluded, never from repetition alone. What is
        learned is how the hidden blocks are *set* — the same key `rules.py`
        uses for a shape rule — so it carries across documents without keying
        on anyone's words.

        A suggestion is a proposal and nothing else. It is never applied here.
        """
        known = self.hidden_signatures()
        if not known:
            return []
        out: list[dict] = []
        for key, evidence in self.by_key.items():
            live = [o for o in evidence.occurrences if not o.hidden]
            if not live or len(live) != len(evidence.occurrences):
                continue  # already hidden, wholly or in part — not a discovery
            if doc and not any(o.doc == doc for o in live):
                continue
            sigs = {o.signature for o in live if o.signature} & set(known)
            if not sigs:
                continue
            example = next(o for o in live if o.signature in sigs)
            proposal = self.propose(key, doc or example.doc)
            out.append(
                {
                    "key": key,
                    "text": example.text,
                    "scope": proposal.scope,
                    "why": proposal.why,
                    "flagged": proposal.flagged,
                    "margin": evidence.in_margin,
                    "signature": example.signature,
                    "like": known[example.signature],
                    "doc": example.doc,
                    "block": example.block,
                    "occurrences": len(live),
                }
            )
        # furniture first: what is in a margin, then what recurs most
        out.sort(key=lambda s: (not s["margin"], -s["occurrences"], s["text"]))
        return out

    def would_touch(self, key: str, doc: str, scope: str) -> list[Occurrence]:
        """Exactly which printings a hide at this scope would govern."""
        occurrences = self.evidence(key).occurrences
        if scope == "folder":
            return sorted(occurrences, key=lambda o: (o.doc, o.page, o.block))
        if scope == "document":
            return sorted(self.evidence(key).within(doc), key=lambda o: (o.page, o.block))
        return []


__all__ = [
    "MARGIN_FRACTION",
    "MARGIN_SHARE",
    "SCOPES",
    "Evidence",
    "Index",
    "Occurrence",
    "Proposal",
]
