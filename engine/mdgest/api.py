"""The HTTP face of the engine. Everything here is a thin call into `ops`,
which is also what the CLI calls — so anything the UI does, the shell does.
"""

from __future__ import annotations

import os
import threading
import traceback
from pathlib import Path, PurePosixPath

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import ops, render
from .store import Workspace, default_workspace


def create_app(workspace: Path | None = None) -> FastAPI:
    ws = Workspace(workspace or default_workspace())
    app = FastAPI(title="mdgest", version="0.2.0")
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )
    app.state.ws = ws
    jobs: dict[str, dict] = {}
    lock = threading.Lock()

    @app.middleware("http")
    async def no_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    def fail(exc: Exception, status: int = 400):
        raise HTTPException(status_code=status, detail=str(exc) or exc.__class__.__name__)

    def run_analysis(doc_id: str, force: bool = False) -> None:
        with lock:
            jobs[doc_id] = {"status": "running", "error": None}
        try:
            ops.analyze(ws, doc_id, force=force)
            with lock:
                jobs[doc_id] = {"status": "done", "error": None}
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            with lock:
                jobs[doc_id] = {"status": "error", "error": str(exc)}

    def analyze_async(doc_ids: list[str], force: bool = False) -> None:
        for d in doc_ids:
            with lock:
                jobs[d] = {"status": "queued", "error": None}
        threading.Thread(
            target=lambda: [run_analysis(d, force) for d in doc_ids], daemon=True
        ).start()

    # ---- workspace / tree -----------------------------------------------

    @app.get("/api/health")
    def health():
        return {"ok": True, "workspace": str(ws.root)}

    @app.get("/api/tree")
    def tree():
        with lock:
            js = dict(jobs)
        return {"tree": ws.tree(), "jobs": js, "workspace": str(ws.root)}

    @app.get("/api/jobs")
    def get_jobs():
        with lock:
            return dict(jobs)

    @app.post("/api/folders")
    def mkdir(payload: dict = Body(...)):
        try:
            return {"path": ws.mkdir(payload.get("path", ""))}
        except Exception as exc:
            fail(exc)

    @app.delete("/api/folders/{path:path}")
    def rmdir(path: str):
        try:
            ws.rmdir(path)
            return {"ok": True}
        except Exception as exc:
            fail(exc)

    @app.post("/api/move")
    def move(payload: dict = Body(...)):
        try:
            return {"path": ws.move(payload["src"], payload["dst"])}
        except Exception as exc:
            fail(exc)

    @app.post("/api/upload")
    async def upload(files: list[UploadFile] = File(...), folder: str = Form("")):
        added: list[str] = []
        for f in files:
            data = await f.read()
            name = (f.filename or "upload").replace("\\", "/")
            # a dropped directory arrives as files named with their relative path
            sub = "/".join(PurePosixPath(name).parts[:-1])
            target = "/".join(x for x in (folder, sub) if x)
            name = PurePosixPath(name).name
            lower = name.lower()
            try:
                if lower.endswith(".zip"):
                    added.extend(ws.add_zip(data, target))
                elif lower.endswith(".pdf") or data[:5] == b"%PDF-":
                    added.append(ws.add_pdf(data, name, target))
                else:
                    continue
            except Exception as exc:
                fail(exc)
        analyze_async(added)
        return {"added": added}

    # ---- documents ------------------------------------------------------

    @app.get("/api/docs/{doc_id:path}/page/{n}.png")
    def page_png(doc_id: str, n: int):
        try:
            doc_id = ws.check_doc(doc_id)
            path = render.render_page(ws.source_path(doc_id), ws.renders_dir(doc_id), n)
        except Exception as exc:
            fail(exc, 404)
        return FileResponse(path, headers={"Cache-Control": "max-age=3600"})

    @app.get("/api/docs/{doc_id:path}/thumb/{n}.png")
    def thumb_png(doc_id: str, n: int):
        try:
            doc_id = ws.check_doc(doc_id)
            path = render.render_thumb(ws.source_path(doc_id), ws.renders_dir(doc_id), n)
        except Exception as exc:
            fail(exc, 404)
        return FileResponse(path, headers={"Cache-Control": "max-age=3600"})

    @app.get("/api/docs/{doc_id:path}/assets/{name}")
    def asset(doc_id: str, name: str):
        doc_id = ws.check_doc(doc_id)
        path = ws.assets_dir(doc_id) / Path(name).name
        if not path.exists():
            raise HTTPException(404)
        return FileResponse(path, headers={"Cache-Control": "max-age=3600"})

    @app.get("/api/docs/{doc_id:path}/markdown")
    def markdown(doc_id: str):
        doc_id = ws.check_doc(doc_id)
        p = ws.md_path(doc_id)
        if not p.exists():
            raise HTTPException(404)
        return PlainTextResponse(p.read_text("utf-8"), media_type="text/markdown")

    @app.get("/api/docs/{doc_id:path}/pdf")
    def pdf(doc_id: str):
        doc_id = ws.check_doc(doc_id)
        return FileResponse(ws.source_path(doc_id), media_type="application/pdf")

    @app.get("/api/docs/{doc_id:path}")
    def get_doc(doc_id: str, lines: bool = True):
        try:
            doc_id = ws.check_doc(doc_id)
        except Exception as exc:
            fail(exc, 404)
        if not ws.source_path(doc_id).exists():
            raise HTTPException(404, "no such document")
        with lock:
            job = jobs.get(doc_id)
        if not ws.has_analysis(doc_id):
            if not job or job["status"] in ("done", "error"):
                analyze_async([doc_id])
                job = {"status": "queued", "error": None}
            return JSONResponse(
                {"doc": ws.doc_summary(doc_id), "job": job, "pending": True}, status_code=202
            )
        try:
            v = ops.view(ws, doc_id, include_lines=lines)
        except Exception as exc:
            fail(exc, 500)
        v["job"] = job
        return v

    @app.delete("/api/docs/{doc_id:path}")
    def delete_doc(doc_id: str):
        try:
            ws.remove(doc_id)
            return {"ok": True}
        except Exception as exc:
            fail(exc, 404)

    @app.post("/api/docs/{doc_id:path}/reanalyze")
    def reanalyze(doc_id: str):
        doc_id = ws.check_doc(doc_id)
        analyze_async([doc_id], force=True)
        return {"queued": True}

    # ---- edits ----------------------------------------------------------

    def edit(fn):
        try:
            return fn()
        except (KeyError, FileNotFoundError) as exc:
            fail(exc, 404)
        except Exception as exc:
            fail(exc)

    @app.patch("/api/docs/{doc_id:path}/blocks/{block_id}")
    def patch_block(doc_id: str, block_id: str, payload: dict = Body(...)):
        learn = payload.pop("learn", None)  # folder to record the decision in, or absent
        return edit(lambda: ops.set_block(ws, doc_id, block_id, learn=learn, **payload))

    # ---- rules & versions ------------------------------------------------

    @app.get("/api/rules/{path:path}")
    def get_rules(path: str):
        return {"stack": ops.list_rules(ws, path)}

    @app.get("/api/rules")
    def get_root_rules():
        return {"stack": ops.list_rules(ws, "")}

    @app.post("/api/rules-forget")
    def forget_rule(payload: dict = Body(...)):
        return edit(
            lambda: ops.forget_rule(ws, payload.get("folder", ""), payload["kind"], payload["key"])
        )

    @app.post("/api/docs/{doc_id:path}/apply-rules")
    def apply_rules(doc_id: str):
        return edit(lambda: ops.apply_rules(ws, doc_id))

    @app.get("/api/docs/{doc_id:path}/versions")
    def get_versions(doc_id: str):
        return edit(lambda: ops.list_versions(ws, doc_id))

    @app.post("/api/docs/{doc_id:path}/versions")
    def post_version(doc_id: str, payload: dict = Body(...)):
        return edit(lambda: ops.save_version(ws, doc_id, payload.get("name", "")))

    @app.post("/api/docs/{doc_id:path}/checkout")
    def post_checkout(doc_id: str, payload: dict = Body(...)):
        return edit(lambda: ops.checkout(ws, doc_id, payload.get("version")))

    @app.delete("/api/docs/{doc_id:path}/versions/{version_id}")
    def del_version(doc_id: str, version_id: str):
        return edit(lambda: ops.delete_version(ws, doc_id, version_id))

    @app.delete("/api/docs/{doc_id:path}/blocks/{block_id}/override")
    def reset_block(doc_id: str, block_id: str):
        return edit(lambda: ops.reset_block(ws, doc_id, block_id))

    @app.post("/api/docs/{doc_id:path}/blocks/{block_id}/move")
    def move_block(doc_id: str, block_id: str, payload: dict = Body(...)):
        blocks = payload.get("blocks") or block_id  # a group moves together, in page order
        return edit(
            lambda: ops.move_block(
                ws,
                doc_id,
                blocks,
                to=payload.get("to"),
                target=payload.get("target"),
                place=payload.get("place", "before"),
            )
        )

    @app.post("/api/docs/{doc_id:path}/blocks/{block_id}/join")
    def join_block(doc_id: str, block_id: str, payload: dict = Body(...)):
        return edit(lambda: ops.join_blocks(ws, doc_id, block_id, payload["parent"]))

    @app.post("/api/docs/{doc_id:path}/blocks/{block_id}/split")
    def split_block(doc_id: str, block_id: str):
        return edit(lambda: ops.split_block(ws, doc_id, block_id))

    @app.put("/api/docs/{doc_id:path}/pages/{n}/order")
    def put_order(doc_id: str, n: int, payload: dict = Body(...)):
        return edit(lambda: ops.set_order(ws, doc_id, n, payload.get("order")))

    @app.post("/api/docs/{doc_id:path}/inserts")
    def post_insert(doc_id: str, payload: dict = Body(...)):
        return edit(
            lambda: ops.insert_text(
                ws, doc_id, int(payload["page"]), payload.get("after"), payload.get("text", "")
            )
        )

    @app.patch("/api/docs/{doc_id:path}/inserts/{insert_id}")
    def patch_insert(doc_id: str, insert_id: str, payload: dict = Body(...)):
        return edit(lambda: ops.update_insert(ws, doc_id, insert_id, payload.get("text", "")))

    @app.delete("/api/docs/{doc_id:path}/inserts/{insert_id}")
    def delete_insert(doc_id: str, insert_id: str):
        return edit(lambda: ops.remove_insert(ws, doc_id, insert_id))

    @app.put("/api/docs/{doc_id:path}/markdown")
    def put_markdown(doc_id: str, payload: dict = Body(...)):
        """A freely edited markdown; the difference becomes edits (one undo step)."""
        return edit(lambda: ops.apply_markdown(ws, doc_id, payload.get("text", "")))

    @app.post("/api/docs/{doc_id:path}/undo")
    def undo(doc_id: str):
        return edit(lambda: ops.undo(ws, doc_id))

    @app.post("/api/docs/{doc_id:path}/redo")
    def redo(doc_id: str):
        return edit(lambda: ops.redo(ws, doc_id))

    @app.post("/api/docs/{doc_id:path}/reset")
    def reset(doc_id: str):
        return edit(lambda: ops.reset_edits(ws, doc_id))

    # ---- corpus ---------------------------------------------------------

    @app.post("/api/index")
    def build_index(payload: dict = Body(...)):
        try:
            return {"markdown": ops.build_index(ws, payload.get("folder", ""))}
        except Exception as exc:
            fail(exc)

    @app.get("/api/index/{folder:path}")
    def get_index(folder: str):
        base = ws.markdown / folder if folder else ws.markdown
        p = base / "INDEX.md"
        if not p.exists():
            raise HTTPException(404)
        return PlainTextResponse(p.read_text("utf-8"), media_type="text/markdown")

    # ---- the built web app, when it exists ------------------------------

    dist = Path(
        os.environ.get("MDGEST_WEB_DIST", Path(__file__).resolve().parents[2] / "web" / "dist")
    )
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}")
        def spa(path: str):
            candidate = dist / path
            if path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
