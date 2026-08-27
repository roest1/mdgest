"""The command line: run the engine, and ask a corpus the questions a corpus has.

Deliberately not a second way to edit. Shaping a block, reordering a page,
joining two lines — those are answered by clicking the thing on the page, and a
shell verb addressing `p1b7` by id was a worse way to do it that nobody used.
What is here is what a browser is the wrong shape for: sixty documents at once,
and a gate CI can fail on.

mdgest serve                              run the API (+ the built web app)
mdgest add <pdf|zip|dir> --to <folder>    ingest a pdf, a zip, or a whole tree
mdgest analyze <doc>                      read it into analysis.json + markdown
mdgest ls [folder]                        the explorer, as a tree
mdgest hide <doc> <block> [--scope ...]   hide, and say how far it reaches
mdgest suggest [doc|folder]               what else looks like what you hid
mdgest settings [folder] --page-numbers   keep | hide | mark
mdgest index <folder>                     build the corpus index
mdgest verify [doc|folder]                check the markdown against the page
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import typer

from . import occurrences, ops
from .store import Workspace, default_workspace

app = typer.Typer(
    help="pdf -> reviewable markdown: run the engine, convert a corpus, check the result.",
    no_args_is_help=True,
)


def _ws() -> Workspace:
    return Workspace(default_workspace())


def _echo(data) -> None:
    typer.echo(json.dumps(data, indent=1, ensure_ascii=False))


@app.callback()
def main_callback(
    workspace: Path | None = typer.Option(
        None, "--workspace", "-w", help="workspace root (or $MDGEST_WORKSPACE)"
    ),
):
    if workspace:
        os.environ["MDGEST_WORKSPACE"] = str(workspace)


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8770, reload: bool = False):
    """Run the API server (serves web/dist too when it has been built)."""
    import uvicorn

    typer.echo(f"mdgest serving workspace {default_workspace()} on http://{host}:{port}")
    if reload:
        uvicorn.run("mdgest.api:app", host=host, port=port, reload=True)
    else:
        # by object, not import string — works inside the frozen desktop binary too
        from .api import app as asgi

        uvicorn.run(asgi, host=host, port=port)


@app.command()
def sidecar(host: str = "127.0.0.1", port: int = 0):
    """Run the engine for the desktop app: bind an ephemeral port and announce it
    on stdout, require $MDGEST_TOKEN on /api, exit when stdin reaches EOF."""
    from .sidecar import run

    run(host, port)


@app.command()
def add(
    path: Path, to: str = typer.Option("", "--to", help="folder to put it in"), analyze: bool = True
):
    """Add a pdf, a zip of pdfs, or a directory tree of pdfs."""
    ws = _ws()
    ids = ws.add_path(path, to)
    for d in ids:
        if analyze:
            ops.analyze(ws, d)
            typer.echo(f"added + analyzed  {d}")
        else:
            typer.echo(f"added  {d}")


@app.command()
def analyze(
    doc: str, force: bool = typer.Option(False, "--force", help="rebuild even if analyzed")
):
    """(Re)build a document's analysis and markdown."""
    ops.analyze(_ws(), doc, force=force)
    typer.echo(f"analyzed {doc}")


@app.command("ls")
def ls(folder: str = typer.Argument(""), as_json: bool = typer.Option(False, "--json")):
    """The explorer tree."""
    ws = _ws()
    tree = ws.tree()
    if folder:
        for part in folder.strip("/").split("/"):
            tree = next((f for f in tree["folders"] if f["name"] == part), None)
            if tree is None:
                raise typer.BadParameter(f"no folder {folder}")
    if as_json:
        _echo(tree)
        return

    def walk(node, indent=""):
        for f in node["folders"]:
            typer.echo(f"{indent}{f['name']}/" + ("  [indexed]" if f["has_index"] else ""))
            walk(f, indent + "  ")
        for d in node["docs"]:
            flags = []
            if d["pages"] is not None:
                flags.append(f"{d['pages']}p")
            if not d["analyzed"]:
                flags.append("unanalyzed")
            if d["edited"]:
                flags.append("edited")
            if d["complete"]:
                flags.append("done")
            if d["parts"]:
                flags.append(f"{len(d['parts'])} parts")
            typer.echo(f"{indent}{d['name']}.pdf  {' '.join(flags)}")

    typer.echo(f"{ws.root}")
    walk(tree)


@app.command()
def done(
    doc: str,
    undo: bool = typer.Option(False, "--undo", help="take the mark off; the rules it taught stay"),
    folder: str | None = typer.Option(None, "--learn-into", help="which folder records the rules"),
):
    """Mark a document done: run its checks and promote its edits to folder rules."""
    result = ops.set_complete(_ws(), doc, complete=not undo, folder=folder)
    if undo:
        typer.echo(f"{doc}: no longer marked done")
        return
    for check in result["checks"]:
        typer.echo(f"  {'ok  ' if check['level'] == 'ok' else 'warn'}  {check['name']}: {check['message']}")
    shapes = sum(1 for entry in result["learned"] if entry.get("shape"))
    hides = sum(1 for entry in result["learned"] if (entry.get("hide") or {}).get("key"))
    typer.echo(
        f"{doc}: done — {shapes} shape rule(s), {hides} hide rule(s) into "
        f"{result['folder'] or '<root>'}"
    )


@app.command()
def export(
    dest: str = typer.Argument(..., help="a directory, or a .zip to write"),
    folder: str = typer.Option("", "--from", help="limit to a folder of the workspace"),
    all_docs: bool = typer.Option(False, "--all", help="include documents not marked done"),
):
    """Copy converted markdown out of the workspace, its folders intact."""
    ws = _ws()
    entries = ops.export_tree(ws, folder)
    chosen = [e["doc"] for e in entries if all_docs or e["complete"]]
    if not chosen:
        typer.echo("nothing to export: no document there is marked done (--all overrides).")
        raise typer.Exit(1)
    target = Path(dest).expanduser()
    result = ops.export(ws, chosen, target, as_zip=target.suffix.lower() == ".zip")
    typer.echo(f"{result['documents']} document(s), {result['files']} file(s) -> {result['dest']}")


@app.command()
def index(folder: str = typer.Argument("")):
    """Build INDEX.md over a folder's markdown."""
    typer.echo(ops.build_index(_ws(), folder), nl=False)


@app.command()
def hide(
    doc: str,
    block: str,
    scope: str | None = typer.Option(
        None, "--scope", help="block | document | folder (default: what the evidence proposes)"
    ),
    show: bool = typer.Option(False, "--show", help="unhide instead"),
    dry_run: bool = typer.Option(False, "--dry-run", "-n", help="print the reach, change nothing"),
    yes: bool = typer.Option(False, "--yes", "-y", help="skip the confirmation"),
):
    """Hide a block, and say how far that reaches.

    A hide is keyed by the block's wording, so it can reach other pages and
    other documents. Which is right depends on where the wording sits: margin
    wording that repeats is furniture and generalizes, body wording that
    repeats is usually a section heading and stays narrow. The reach is
    printed before anything changes — nothing generalizes unseen.
    """
    ws = _ws()
    preview = ops.preview_hide(ws, doc, block)
    chosen = scope or preview["proposed"]["scope"]
    touch = preview["would_touch"].get(chosen, [])

    typer.echo(f'"{preview["text"][:80]}"')
    typer.echo(f"  {'in a page margin' if preview['in_margin'] else 'in the body of the page'}")
    typer.echo(f"  proposed: {preview['proposed']['scope']} — {preview['proposed']['why']}")
    if preview["proposed"]["flagged"]:
        typer.echo("  ⚠ body wording that repeats is very often a section heading")
    if chosen != preview["proposed"]["scope"]:
        typer.echo(f"  asked for: {chosen}")
    if chosen == "block":
        typer.echo("  reaches: this block only")
    else:
        typer.echo(f"  reaches: {len(touch)} block(s)")
        for o in touch[:20]:
            typer.echo(f"      {o['doc']}  p{o['page']}  {o['block']}  {o['text'][:60]}")
        if len(touch) > 20:
            typer.echo(f"      … and {len(touch) - 20} more")

    if dry_run:
        return
    if not yes and not typer.confirm(f"{'unhide' if show else 'hide'} at {chosen} scope?"):
        raise typer.Abort()
    _echo(ops.hide(ws, doc, block, scope=chosen, hidden=not show))


@app.command()
def settings(
    target: str = typer.Argument("", help="a document or folder (default: the workspace root)"),
    page_numbers: str | None = typer.Option(
        None, "--page-numbers", help="keep | hide | mark (or 'unset' to stop overriding)"
    ),
):
    """What a folder wants done with page numbers, and where that was decided.

    keep  leave them as ordinary text (the default: it changes nothing)
    hide  drop them like any other furniture
    mark  drop them as prose and record `<!-- page 12 -->` at the top of the
          page instead — invisible when rendered, and unlike a heading it adds
          nothing to the outline or to the anchors built from it

    Set on a folder; the deeper folder wins. The printed number is worth
    keeping because it is not always the page's position in the file — front
    matter is numbered in roman, and an extracted chapter starts at 143.
    """
    ws = _ws()
    if page_numbers is not None:
        folder = target
        if ws.source_path(target).exists():
            raise typer.BadParameter("a setting is recorded on a folder, not a document")
        _echo(
            ops.set_setting(
                ws, folder, "page_numbers", None if page_numbers == "unset" else page_numbers
            )
        )
        return
    _echo(ops.get_settings(ws, target))


@app.command()
def suggest(
    target: str = typer.Argument("", help="a document or a folder (default: everything)"),
    apply: bool = typer.Option(False, "--apply", help="hide each one, asking first"),
):
    """What else looks like the boilerplate you have already hidden.

    Nothing is proposed until you have hidden something — the pattern comes
    from what *you* excluded, not from repetition. mdgest never decides on its
    own that wording is furniture.
    """
    ws = _ws()
    # one index for the whole walk: hiding does not move a block, so the reach
    # of each later suggestion is the same as when they were all proposed
    folder = target
    if ws.source_path(target).exists():
        folder = str(Path(ws.check_doc(target)).parent) if "/" in target else ""
    index = occurrences.Index.over(ws, folder)
    result = ops.suggest_hides(ws, target, index=index)
    if not result["learned_from"]:
        typer.echo("nothing hidden yet, so nothing to learn from.")
        typer.echo("hide a running header or footer first: mdgest hide <doc> <block>")
        return
    if not result["suggestions"]:
        typer.echo(f"nothing else is set like the {len(result['learned_from'])} pattern(s) you hid.")
        return
    for s in result["suggestions"]:
        where = "in a page margin" if s["margin"] else "in the body of the page"
        typer.echo(f'"{s["text"][:70]}"')
        typer.echo(f"  {where}, {s['occurrences']} printing(s); set like {s['like']} you hid")
        typer.echo(f"  would hide at {s['scope']} scope — {s['why']}")
        if s["flagged"]:
            typer.echo("  ⚠ body wording that repeats is very often a section heading")
        if apply and typer.confirm(f"  hide it at {s['scope']} scope?"):
            ops.hide(ws, s["doc"], s["block"], scope=s["scope"], index=index)
            typer.echo("  hidden.")


@app.command()
def verify(
    target: str = typer.Argument("", help="a document id, or a folder (default: all)"),
    json_out: bool = typer.Option(False, "--json", help="the full report, machine-readable"),
):
    """Check the markdown against the pages it came from.

    Every word of every visible line must reach the markdown, no word in the
    markdown may be absent from both the page and the inserts, nothing hidden
    may leak, and every heading must be text really on the page. Exits 1 if
    any document fails, so CI can gate on it.
    """
    ws = _ws()
    # A document if a source of that name is really there, otherwise a folder
    # ("" = everything). `check_doc` alone says only that the path is inside the
    # workspace, so it happily returns a folder id and the gate goes looking for
    # `<folder>.pdf` -- which is what `verify manuals` used to do.
    doc = ws.check_doc(target) if target and ws.source_path(target).exists() else None
    if doc is not None:
        reports = [ops.verify(ws, doc)]
        result = {"folder": doc, "documents": 1, "reports": reports}
        result["failed"] = sum(1 for r in reports if not r["passed"])
    else:
        result = ops.verify_folder(ws, target)

    if json_out:
        _echo(result)
    else:
        for r in result["reports"]:
            flag = "PASS" if r["passed"] else "FAIL"
            line = f"{flag}  {r['coverage']:.2%}  {r['doc']}"
            if r["hidden_words"]:
                line += f"  (-{r['hidden_words']} hidden, {r['hidden_share']:.1%})"
            if r["inserted_words"]:
                line += f"  (+{r['inserted_words']} inserted)"
            if r.get("page_numbers", "keep") != "keep":
                line += f"  (page numbers: {r['page_numbers']})"
            typer.echo(line)
            for label, items in (
                ("missing", [w for w, _ in r["missing"]]),
                ("invented", [w for w, _ in r["invented"]]),
                ("leaked", r["leaked"]),
                ("untraceable heading", r["untraceable_headings"]),
                (
                    "hidden by folder rule",
                    [
                        f"{h['text']}  [{h['folder'] or '<root>'}"
                        + (f", learned on {h['learned_on']}" if h.get("learned_on") else "")
                        + "]"
                        for h in r["hidden_by_rule"]
                    ],
                ),
            ):
                for item in items[:10]:
                    typer.echo(f"      {label}: {item}")
        if result["documents"] > 1:
            typer.echo(f"\n{result['documents']} documents, {result['failed']} failed")
    if result["failed"]:
        raise typer.Exit(1)


def main() -> None:
    app()


if __name__ == "__main__":
    main()
