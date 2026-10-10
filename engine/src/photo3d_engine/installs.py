"""Model downloads started from the app: one background thread per engine, with pause.

The state of a download is reported through `on_event` as {"type": "install", "install": {...}}
(at most a few times a second), the same way jobs are.
"""

from __future__ import annotations

import shutil
import threading
import time
from collections.abc import Callable
from pathlib import Path

from .engines.base import Cancelled
from .engines.registry import get_engine
from .errors import AppError
from .paths import models_dir

SPARE_GB = 1.0  # free space to keep on top of the download
EVENTS_PER_SECOND = 4


def free_disk_gb(folder: Path) -> float:
    """Free space on the disk that holds `folder` (which may not exist yet)."""
    folder = Path(folder)
    while not folder.exists() and folder != folder.parent:
        folder = folder.parent
    return shutil.disk_usage(folder).free / 1e9


class InstallManager:
    def __init__(self, on_event: Callable[[dict], None] | None = None) -> None:
        self.on_event = on_event or (lambda event: None)
        self._state: dict[str, dict] = {}
        self._stop: dict[str, threading.Event] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._last_emit = 0.0
        self._lock = threading.RLock()

    def get(self, engine_id: str) -> dict:
        engine = get_engine(engine_id)
        with self._lock:
            state = self._state.get(engine.id)
            if state is None:
                status = "done" if engine.is_installed() else "idle"
                state = self._new_state(engine, status, 1.0 if status == "done" else 0.0)
            return dict(state)

    def start(self, engine_id: str) -> dict:
        """Start or resume the download. Does nothing if it is running or done."""
        engine = get_engine(engine_id)
        with self._lock:
            current = self.get(engine.id)
            if current["status"] in ("running", "done"):
                return current
            needed = engine.download_gb * (1.0 - current["progress"]) + SPARE_GB
            free = free_disk_gb(models_dir())
            if free < needed:
                raise AppError(
                    f"Not enough free disk space: {free:.1f} GB free, "
                    f"about {needed:.1f} GB needed.",
                    "Free up some space and try again.",
                    507,
                )
            self._state[engine.id] = self._new_state(engine, "running", current["progress"])
            self._stop[engine.id] = threading.Event()
            thread = threading.Thread(
                target=self._run, args=(engine.id,), name=f"install-{engine.id}", daemon=True
            )
            self._threads[engine.id] = thread
            thread.start()
            self._emit(engine.id, force=True)
            return dict(self._state[engine.id])

    def pause(self, engine_id: str) -> dict:
        engine = get_engine(engine_id)
        with self._lock:
            if engine.id in self._stop:
                self._stop[engine.id].set()
        thread = self._threads.get(engine.id)
        if thread is not None:
            thread.join(timeout=30)  # it stops after the chunk it is writing
        return self.get(engine.id)

    def remove(self, engine_id: str) -> dict:
        """Delete the app's own downloaded copy. Never touches a copy that lives elsewhere."""
        engine = get_engine(engine_id)
        with self._lock:
            if self.get(engine.id)["status"] == "running":
                raise AppError("The model is downloading.", "Pause the download first.", 409)
            folder = engine.own_folder()
            if folder is None or not Path(folder).is_dir():
                raise AppError(
                    "There is no downloaded copy to remove.",
                    "A copy kept by another tool is not touched.",
                    404,
                )
            folder = Path(folder).resolve()
            if folder.parent != models_dir().resolve():  # only a folder directly in models/
                raise AppError("This folder cannot be removed.", "It is not the app's own.", 400)
            shutil.rmtree(folder)
            self._state.pop(engine.id, None)
            return self.get(engine.id)

    def wait(self, engine_id: str, timeout: float = 60.0) -> dict:
        """Block until the download is no longer running (for tests)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = self.get(engine_id)
            if state["status"] != "running":
                return state
            time.sleep(0.02)
        raise TimeoutError(f"download of {engine_id} did not finish in {timeout} s")

    def shutdown(self) -> None:
        for stop in self._stop.values():
            stop.set()

    # --- worker -------------------------------------------------------------------------

    def _run(self, engine_id: str) -> None:
        engine = get_engine(engine_id)
        stop = self._stop[engine_id]

        def progress(stage: str, fraction: float) -> None:
            with self._lock:
                self._state[engine_id]["progress"] = round(max(0.0, min(1.0, fraction)), 4)
            self._emit(engine_id)

        try:
            engine.install(progress, stop.is_set)
            self._set(engine_id, "done", progress=1.0)
        except Cancelled:
            self._set(engine_id, "paused")
        except Exception as error:  # no internet, server error, disk full ...
            self._set(
                engine_id,
                "error",
                error={
                    "error": f"The download stopped: {error}",
                    "hint": "Check the internet connection and press Retry. "
                    "It continues where it stopped.",
                },
            )

    def _set(self, engine_id: str, status: str, **changes) -> None:
        with self._lock:
            self._state[engine_id].update(status=status, **changes)
        self._emit(engine_id, force=True)

    @staticmethod
    def _new_state(engine, status: str, progress: float) -> dict:
        return {
            "engine": engine.id,
            "status": status,  # idle, running, paused, done, error
            "progress": progress,
            "total_gb": engine.download_gb,
            "error": None,
        }

    def _emit(self, engine_id: str, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_emit < 1.0 / EVENTS_PER_SECOND:
            return
        self._last_emit = now
        try:
            self.on_event({"type": "install", "install": self.get(engine_id)})
        except Exception:  # a broken listener must never stop the download
            pass
