"""Run the engine as a supervised sidecar of the desktop app.

The contract with the supervisor (src-tauri/src/engine.rs):

- stdin is a pipe the supervisor holds open. EOF means the supervisor is gone
  (exited, crashed, or was killed) and the engine exits with it — no orphaned
  server survives a dead window.
- the port is 0 by default; the one actually bound is announced on stdout as
      MDGEST_ENGINE_READY <port>
  after listen(), so a connection made the moment the line appears just queues.
- MDGEST_TOKEN, when set, must accompany every /api request (see api.py). The
  supervisor generates it per launch and passes it in the environment.

`mdgest serve` stays the way to run the engine by hand.
"""

from __future__ import annotations

import os
import sys
import threading


def _exit_on_stdin_eof() -> None:
    if sys.stdin is None:
        return
    try:
        while sys.stdin.buffer.read(65536):
            pass
    except Exception:
        pass
    os._exit(0)


def run(host: str = "127.0.0.1", port: int = 0) -> None:
    import socket

    import uvicorn

    from .api import app  # imported here, after the supervisor's env is in place

    threading.Thread(target=_exit_on_stdin_eof, daemon=True).start()
    sock = socket.create_server((host, port))
    bound = sock.getsockname()[1]
    print(f"MDGEST_ENGINE_READY {bound}", flush=True)
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=bound, log_level="info"))
    server.run(sockets=[sock])
