"""Job queue: one worker, one job at a time, one model in memory (docs/PLAN.md, 6 and 9.5).

A job turns the photo of a project into a print-ready STL by calling make_stl(). Progress
and the end result are reported through `on_event`, which the server forwards to WebSocket
clients. Jobs are saved as JSON, so a job that was running when the program stopped shows up
as "interrupted" the next time.
"""

from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from .engines.base import Cancelled
from .errors import AppError
from .make import make_stl
from .projects import ProjectStore, check_settings
from .reprint import stl_name, write_outputs

ACTIVE = ("queued", "running")
FINISHED = ("done", "error", "cancelled", "interrupted")

# stage -> (where it starts in the overall progress, how much of it the stage takes)
STAGES = {
    "preprocess": (0.00, 0.10),
    "load_model": (0.10, 0.10),
    "generate": (0.20, 0.60),
    "print_prep": (0.80, 0.15),
    "save": (0.95, 0.05),
}

EventFn = Callable[[dict], None]


def overall_progress(stage: str, fraction: float) -> tuple[str, float]:
    """Map a (stage, 0..1) report of make_stl to one number for the whole job."""
    if stage == "done":
        return "save", 1.0
    start, width = STAGES.get(stage, (0.0, 0.0))
    return stage, round(start + width * max(0.0, min(1.0, fraction)), 3)


class JobManager:
    def __init__(self, store: ProjectStore, data_dir: Path, on_event: EventFn | None = None):
        self.store = store
        self.folder = Path(data_dir).resolve() / "jobs"
        self.folder.mkdir(parents=True, exist_ok=True)
        self.on_event = on_event or (lambda event: None)
        self._jobs: dict[str, dict] = {}
        self._cancel: dict[str, threading.Event] = {}
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._lock = threading.RLock()
        self._recover()
        self._worker = threading.Thread(target=self._work, name="job-worker", daemon=True)
        self._worker.start()

    # --- public -------------------------------------------------------------------------

    def submit(self, project_id: str, options: dict | None = None) -> dict:
        """Queue a job. `options` may change the project's settings (height, quality, ...)."""
        project = self.store.get(project_id)
        if not project["image"]:
            raise AppError("This project has no photo yet.", "Add a photo first.", 409)
        settings = check_settings(options or {})
        if settings:
            self.store.update(project_id, settings=settings)

        job = {
            "id": f"j-{uuid.uuid4().hex[:8]}",
            "project_id": project_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0.0,
            "error": None,
            "created": datetime.now().isoformat(timespec="seconds"),
            "finished": None,
        }
        with self._lock:
            self._jobs[job["id"]] = job
            self._cancel[job["id"]] = threading.Event()
            self._save(job)
        self.store.update(project_id, last_job=job["id"])
        self._emit(job)
        self._queue.put(job["id"])
        return dict(job)

    def get(self, job_id: str) -> dict:
        with self._lock:
            if job_id not in self._jobs:
                raise AppError("Unknown job.", "It may have been created by an older version.", 404)
            return dict(self._jobs[job_id])

    def cancel(self, job_id: str) -> dict:
        with self._lock:
            job = self.get(job_id)
            if job["status"] in ACTIVE:
                self._cancel[job_id].set()
                if job["status"] == "queued":  # the worker has not started it, just drop it
                    self._finish(job_id, "cancelled")
            return self.get(job_id)

    def active_for(self, project_id: str) -> bool:
        """True while a job of this project is queued or running."""
        with self._lock:
            return any(
                job["project_id"] == project_id and job["status"] in ACTIVE
                for job in self._jobs.values()
            )

    def wait(self, job_id: str, timeout: float = 60.0) -> dict:
        """Block until the job is finished (for tests and scripts)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = self.get(job_id)
            if job["status"] in FINISHED:
                return job
            time.sleep(0.02)
        raise TimeoutError(f"job {job_id} did not finish in {timeout} s")

    def shutdown(self) -> None:
        """Stop the worker. A running job is cancelled."""
        with self._lock:
            for job_id, job in self._jobs.items():
                if job["status"] in ACTIVE:
                    self._cancel[job_id].set()
        self._queue.put(None)
        self._worker.join(timeout=30)

    # --- worker -------------------------------------------------------------------------

    def _work(self) -> None:
        while True:
            job_id = self._queue.get()
            if job_id is None:
                return
            with self._lock:
                if self._jobs[job_id]["status"] != "queued":
                    continue  # cancelled while waiting
                self._jobs[job_id].update(status="running", stage="preprocess")
                self._emit(self._jobs[job_id])
            try:
                self._run(job_id)
            except Exception as error:  # a bug here must not kill the worker for later jobs
                self._finish(job_id, "error", self._explain(error))

    def _run(self, job_id: str) -> None:
        job = self.get(job_id)
        cancel = self._cancel[job_id]
        try:
            project = self.store.get(job["project_id"])
            folder = self.store.folder(job["project_id"])
            settings = project["settings"]
            stl = folder / stl_name(project, float(settings["height_mm"]))

            def progress(stage: str, fraction: float) -> None:
                if cancel.is_set() and stage != "done":
                    raise Cancelled()  # stops between stages, not only inside the model
                name, value = overall_progress(stage, fraction)
                self._progress(job_id, name, value)

            result = make_stl(
                folder / project["image"],
                stl,
                height_mm=float(settings["height_mm"]),
                quality=settings["quality"],
                device=settings["device"],
                engine_id=settings["engine"],
                remove_bg=bool(settings["remove_bg"]),
                work_dir=folder / "details",
                progress=progress,
                cancelled=cancel.is_set,
            )
            outputs = write_outputs(folder, project, result)
            self.store.update(
                job["project_id"], status="ready", outputs=outputs, report=result.report
            )
            self._finish(job_id, "done")
        except Cancelled:
            self._finish(job_id, "cancelled")
        except Exception as error:  # the worker must survive any failure of one job
            problem = self._explain(error)
            project = self.store.get(job["project_id"]) if self._project_exists(job) else None
            if project is not None and not project["outputs"]:
                self.store.update(job["project_id"], status="error")
            self._finish(job_id, "error", problem)

    # --- helpers ------------------------------------------------------------------------

    def _project_exists(self, job: dict) -> bool:
        try:
            self.store.folder(job["project_id"])
            return True
        except AppError:
            return False

    @staticmethod
    def _explain(error: Exception) -> dict:
        if isinstance(error, AppError):
            return error.as_dict()
        if isinstance(error, FileNotFoundError):
            return {"error": str(error), "hint": "Add the photo again."}
        if isinstance(error, RuntimeError):
            return {"error": str(error), "hint": "Details are in the engine log."}
        return {
            "error": f"Something went wrong: {error}",
            "hint": "Try again. If it keeps happening, use a smaller photo or the 'fast' quality.",
        }

    def _progress(self, job_id: str, stage: str, value: float) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.update(stage=stage, progress=max(job["progress"], value))
            self._emit(job)

    def _finish(self, job_id: str, status: str, error: dict | None = None) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.update(
                status=status, error=error, finished=datetime.now().isoformat(timespec="seconds")
            )
            if status == "done":
                job.update(stage="done", progress=1.0)
            self._save(job)
            self._emit(job)

    def _emit(self, job: dict) -> None:
        try:
            self.on_event({"type": "job", "job": dict(job)})
        except Exception:  # a broken listener must never stop the worker
            pass

    def _save(self, job: dict) -> None:
        path = self.folder / f"{job['id']}.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(job, indent=2, ensure_ascii=False), encoding="utf-8")
        temp.replace(path)

    def _recover(self) -> None:
        """Jobs found in a running state were cut off by a stop or crash."""
        for path in sorted(self.folder.glob("j-*.json")):
            try:
                job = json.loads(path.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            if job.get("status") in ACTIVE:
                job.update(
                    status="interrupted",
                    error={
                        "error": "The program was closed while this job was running.",
                        "hint": "Press 'Create' again.",
                    },
                )
                self._save(job)
            self._jobs[job["id"]] = job
            self._cancel[job["id"]] = threading.Event()
