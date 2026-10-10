"""Start the engine server: python -m photo3d_engine --port 0 --token SECRET --data-dir FOLDER

--engine dummy makes new projects use the small test engine (for the app's own tests).

The first line printed is JSON with the real port (and the token), so the desktop app can read it.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import signal
import socket
import sys
import threading
from pathlib import Path

import uvicorn

from .engines.registry import DEFAULT_ENGINE, engine_ids
from .paths import default_data_dir
from .server import create_app

HOST = "127.0.0.1"  # never listen on the network


def stop_when_stdin_closes() -> None:
    """Stop the server when the app that started it is gone (its end of our stdin closes).

    This also covers a crashed or force-quit app, which can no longer ask us to stop.
    """

    def watch() -> None:
        try:
            while sys.stdin.buffer.read(1024):
                pass
        except (OSError, ValueError):
            pass
        signal.raise_signal(signal.SIGINT)  # uvicorn stops cleanly, like after Ctrl+C

    threading.Thread(target=watch, name="parent-watch", daemon=True).start()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="photo3d_engine", description="photo-to-3d engine server")
    parser.add_argument("--port", type=int, default=0, help="0 = pick a free port (default)")
    parser.add_argument("--token", help="secret for the X-Token header (default: a random one)")
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--engine", choices=engine_ids(), default=DEFAULT_ENGINE)
    parser.add_argument(
        "--exit-with-parent",
        action="store_true",
        help="stop when stdin closes (the app that started the engine is gone)",
    )
    args = parser.parse_args(argv)

    # downloaded weights live next to the projects, so one folder holds everything
    os.environ.setdefault("PHOTO3D_MODELS_DIR", str(Path(args.data_dir) / "models"))
    token = args.token or secrets.token_urlsafe(24)
    app = create_app(args.data_dir, token, engine_id=args.engine)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((HOST, args.port))
    port = sock.getsockname()[1]
    print(json.dumps({"host": HOST, "port": port, "token": token}), flush=True)

    if args.exit_with_parent:
        stop_when_stdin_closes()

    # uvicorn stops cleanly on SIGTERM and SIGINT and runs the app shutdown (stops the worker)
    uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
    return 0


if __name__ == "__main__":
    sys.exit(main())
