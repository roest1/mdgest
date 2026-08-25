"""The command line — the same operations the UI performs, one per verb.

mdgest serve                              run the API (+ the built web app)
mdgest add <pdf|zip|dir> --to <folder>    upload
mdgest ls [folder]                        the explorer, as a tree
mdgest mkdir / rm / mv                    manage the hierarchy
mdgest show <doc> [--page N]              the numbered blocks, like the overlay
mdgest md <doc>                           the markdown
mdgest set <doc> <block> --role ...       change a block's shape
mdgest move <doc> <block> --to N          reorder
mdgest insert <doc> --page N --after <block> "text"
mdgest join / split / undo / redo / reset
mdgest index <folder>                     build the corpus index
mdgest verify [doc|folder]                check the markdown against the page
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import typer

from . import ops
from .store import Workspace, default_workspace

app = typer.Typer(
    help="pdf -> reviewable markdown; everything the UI does, from the shell.", no_args_is_help=True
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
            typer.echo(f"{indent}{d['name']}.pdf  {' '.join(flags)}")

    typer.echo(f"{ws.root}")
    walk(tree)


@app.command()
def mkdir(path: str):
    typer.echo(_ws().mkdir(path))


@app.command()
def rm(path: str, yes: bool = typer.Option(False, "--yes", "-y")):
    """Remove a document (by id) or a folder (recursively)."""
    ws = _ws()
    if not yes and not typer.confirm(f"delete {path} and everything derived from it?"):
        raise typer.Abort()
    if ws.source_path(path).exists():
        ws.remove(path)
    else:
        ws.rmdir(path)
    typer.echo(f"removed {path}")


@app.command()
def mv(src: str, dst: str):
    typer.echo(_ws().move(src, dst))


@app.command()
def show(
    doc: str,
    page: int | None = typer.Option(None, "--page", "-p"),
    as_json: bool = typer.Option(False, "--json"),
):
    """The numbered blocks of a document — what the overlay draws."""
    ws = _ws()
    v = ops.view(ws, doc, include_lines=False)
    if as_json:
        _echo(v["pages"] if page is None else next(p for p in v["pages"] if p["n"] == page))
        return
    for pg in v["pages"]:
        if page is not None and pg["n"] != page:
            continue
        typer.echo(
            f"── page {pg['n']} ({pg['width']}x{pg['height']} pt){'  [reordered]' if pg['reordered'] else ''}"
        )
        for b in pg["blocks"]:
            shape = b["role"]
            if b["role"] == "heading":
                shape += f"{b.get('level', 2)}"
            elif b["role"] in ("bullet", "numbered", "alpha", "roman"):
                shape += f" d{b.get('depth', 0)}"
            marks = (
                ("B" if b.get("bold") else "")
                + ("I" if b.get("italic") else "")
                + ("H" if b.get("hidden") else "")
            )
            edited = "*" if b.get("edited") else " "
            text = b.get("text") or (
                f"<figure {b.get('picture', 0) + 1}>" if b["kind"] == "image" else ""
            )
            typer.echo(f"{b['n']:>4} {edited}{b['id']:<8} {shape:<11} {marks:<3} {text[:90]}")


@app.command()
def md(doc: str):
    """Print the document's markdown."""
    ws = _ws()
    p = ws.md_path(ws.check_doc(doc))
    if not p.exists():
        ops.analyze(ws, doc)
    typer.echo(p.read_text("utf-8"), nl=False)


@app.command("set")
def set_cmd(
    doc: str,
    block: str,
    role: str | None = typer.Option(None, help="heading|para|bullet|numbered|alpha|roman|image"),
    level: int | None = typer.Option(None, help="heading level 1-6"),
    depth: int | None = typer.Option(None, help="list nesting depth"),
    bold: bool | None = typer.Option(None, "--bold/--no-bold"),
    italic: bool | None = typer.Option(None, "--italic/--no-italic"),
    hidden: bool | None = typer.Option(None, "--hide/--show"),
    break_before: bool | None = typer.Option(
        None, "--break-before/--no-break-before", help="a --- page break before it"
    ),
    break_after: bool | None = typer.Option(None, "--break-after/--no-break-after"),
    learn: str | None = typer.Option(
        None, "--learn", help="record this as a rule in FOLDER ('' = workspace root)"
    ),
    reset: bool = typer.Option(False, "--reset", help="drop every override on the block"),
):
    """Change how a block is written."""
    ws = _ws()
    if reset:
        _echo(ops.reset_block(ws, doc, block))
        return
    fields = {
        k: v
        for k, v in dict(
            role=role,
            level=level,
            depth=depth,
            bold=bold,
            italic=italic,
            hidden=hidden,
            break_before=break_before,
            break_after=break_after,
        ).items()
        if v is not None
    }
    if not fields:
        raise typer.BadParameter("nothing to set")
    _echo(ops.set_block(ws, doc, block, learn=learn, **fields))


@app.command()
def rules(
    path: str = typer.Argument("", help="a folder or document id; shows every rule on its path"),
):
    """What mdgest has learned, root first (deepest wins)."""
    for level in ops.list_rules(_ws(), path):
        typer.echo(
            f"── {level['folder'] or '(workspace)'}  {len(level['shape'])} shape · {len(level['hide'])} hide"
        )
        for r in level["shape"]:
            typer.echo(f"   {r['key']}\n      -> {r['fields']}   e.g. {r['example']!r}")
        for r in level["hide"]:
            typer.echo(f"   hide {r['key']!r}")


@app.command()
def forget(folder: str, kind: str, key: str):
    """Forget one rule: mdgest forget <folder> shape|hide <key>."""
    _echo(ops.forget_rule(_ws(), folder, kind, key))


@app.command("apply-rules")
def apply_rules(doc: str):
    """Re-read DOC under the current rules (edits stay on top)."""
    _echo(ops.apply_rules(_ws(), doc))


@app.command()
def versions(doc: str):
    """The saved versions of DOC and where the working copy sits."""
    v = ops.list_versions(_ws(), doc)
    typer.echo(f"original{'  <- working copy' if v['base'] is None else ''}")
    for e in v["versions"]:
        mark = "  <- working copy" if e["id"] == v["base"] else ""
        typer.echo(f"{'  ' * e['depth']}{e['id']}  {e['name']}  ({e['created'][:16]}){mark}")
    if v["dirty"]:
        typer.echo("(working copy has unsaved changes)")


@app.command()
def save(doc: str, name: str = typer.Argument("", help="a name for this version")):
    """Save the working copy as a new version (successor of the current one)."""
    _echo(ops.save_version(_ws(), doc, name))


@app.command()
def checkout(
    doc: str, version: str = typer.Argument(..., help="a version id like v2, or 'original'")
):
    """Make the working copy that version. Undoable."""
    _echo(ops.checkout(_ws(), doc, version))


@app.command()
def move(
    doc: str,
    block: str,
    to: int | None = typer.Option(None, "--to", help="new number on the page"),
    before: str | None = typer.Option(None, "--before", help="block id to go before"),
    after: str | None = typer.Option(None, "--after", help="block id to go after"),
):
    """Move a block — or a comma-separated group — within its page (the blast radius is reported)."""
    blocks = [b.strip() for b in block.split(",") if b.strip()]
    if before:
        r = ops.move_block(_ws(), doc, blocks, target=before, place="before")
    elif after:
        r = ops.move_block(_ws(), doc, blocks, target=after, place="after")
    elif to is not None:
        r = ops.move_block(_ws(), doc, blocks, to=to)
    else:
        raise typer.BadParameter("give --to, --before or --after")
    _echo(r)


@app.command()
def order(
    doc: str,
    page: int,
    ids: str | None = typer.Argument(None, help="comma-separated block ids"),
    reset: bool = False,
):
    """Set (or reset) a whole page's order."""
    if reset:
        _echo(ops.set_order(_ws(), doc, page, None))
    else:
        _echo(
            ops.set_order(
                _ws(), doc, page, [x.strip() for x in (ids or "").split(",") if x.strip()]
            )
        )


@app.command()
def insert(
    doc: str,
    text: str,
    page: int = typer.Option(..., "--page", "-p"),
    after: str | None = typer.Option(None, "--after"),
):
    """Insert text that is NOT on the page (recorded as a person's insertion)."""
    _echo(ops.insert_text(_ws(), doc, page, after, text))


@app.command("edit")
def edit_md(
    doc: str,
    file: Path = typer.Argument(..., help="a markdown file you edited (start from `mdgest md`)"),
):
    """Apply a freely edited markdown: the difference becomes edits, one undo step."""
    _echo(ops.apply_markdown(_ws(), doc, file.read_text("utf-8")))


@app.command("edit-insert")
def edit_insert(doc: str, insert_id: str, text: str):
    _echo(ops.update_insert(_ws(), doc, insert_id, text))


@app.command("rm-insert")
def rm_insert(doc: str, insert_id: str):
    _echo(ops.remove_insert(_ws(), doc, insert_id))


@app.command()
def join(doc: str, child: str, parent: str):
    """Append a block's words onto another block."""
    _echo(ops.join_blocks(_ws(), doc, child, parent))


@app.command()
def split(doc: str, child: str):
    _echo(ops.split_block(_ws(), doc, child))


@app.command()
def undo(doc: str):
    _echo(ops.undo(_ws(), doc))


@app.command()
def redo(doc: str):
    _echo(ops.redo(_ws(), doc))


@app.command()
def reset(doc: str, yes: bool = typer.Option(False, "--yes", "-y")):
    """Forget every edit on a document (undoable)."""
    if not yes and not typer.confirm(f"forget every edit on {doc}?"):
        raise typer.Abort()
    _echo(ops.reset_edits(_ws(), doc))


@app.command()
def index(folder: str = typer.Argument("")):
    """Build INDEX.md over a folder's markdown."""
    typer.echo(ops.build_index(_ws(), folder), nl=False)


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
    # the argument is a document if it names one, otherwise a folder ("" = all)
    try:
        doc = ws.check_doc(target) if target else None
    except Exception:
        doc = None
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
