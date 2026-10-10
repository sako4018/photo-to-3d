"""HTTP + WebSocket API for the desktop app (docs/PLAN.md, 4.4 and 10).

Listens on 127.0.0.1 only and wants the secret token in the X-Token header on every request
(the WebSocket also takes ?token=, because browsers cannot set headers there).
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import psutil
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Header,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from . import __version__
from .engines.registry import DEFAULT_ENGINE, engine_ids, get_engine
from .errors import AppError
from .installs import InstallManager, free_disk_gb
from .jobs import JobManager
from .paths import models_dir
from .platform.devices import available_devices
from .platform.hardware import gpu
from .projects import ProjectStore, check_settings
from .reprint import reprint


class NewProject(BaseModel):
    name: str
    settings: dict | None = None


class ProjectChanges(BaseModel):
    name: str | None = None
    settings: dict | None = None


class NewJob(BaseModel):
    project_id: str
    quality: str | None = None
    device: str | None = None
    engine: str | None = None
    height_mm: float | None = None
    remove_bg: bool | None = None


class PrintPrep(BaseModel):
    height_mm: float | None = None
    base_cut_pct: float | None = None
    base_plate_mm: float | None = None
    rotation: list[int] | None = None
    quality: str | None = None


class ExportRequest(BaseModel):
    format: str = "stl"
    dest_path: str = Field(min_length=1)


class Hub:
    """Fans job events out to the connected WebSocket clients."""

    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.clients: set[asyncio.Queue] = set()

    def publish(self, event: dict) -> None:
        """Called from the worker thread."""
        if self.loop is None or self.loop.is_closed():
            return
        for client in list(self.clients):
            self.loop.call_soon_threadsafe(client.put_nowait, event)


def create_app(data_dir: Path, token: str, engine_id: str = DEFAULT_ENGINE) -> FastAPI:
    hub = Hub()
    store = ProjectStore(data_dir, engine_id)
    jobs = JobManager(store, data_dir, on_event=hub.publish)
    installs = InstallManager(on_event=hub.publish)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        yield
        installs.shutdown()
        await asyncio.to_thread(jobs.shutdown)

    app = FastAPI(title="photo-to-3d engine", version=__version__, lifespan=lifespan)
    app.state.store, app.state.jobs, app.state.installs = store, jobs, installs

    def require_token(x_token: str | None = Header(default=None)) -> None:
        if x_token is None or not hmac.compare_digest(x_token, token):
            raise AppError("Missing or wrong token.", "Start the engine from the app.", 401)

    api = APIRouter(dependencies=[Depends(require_token)])

    # --- errors in plain words ----------------------------------------------------------

    @app.exception_handler(AppError)
    async def app_error(request: Request, error: AppError) -> JSONResponse:
        return JSONResponse(error.as_dict(), status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def bad_request(request: Request, error: RequestValidationError) -> JSONResponse:
        where = ".".join(str(part) for part in error.errors()[0]["loc"][1:]) or "request"
        problem = AppError(f"Invalid value in {where!r}.", "Check the request and try again.", 422)
        return JSONResponse(problem.as_dict(), status_code=422)

    # --- system -------------------------------------------------------------------------

    @api.get("/health")
    def health() -> dict:
        memory = psutil.virtual_memory()
        return {
            "version": __version__,
            "devices": available_devices(),
            "free_memory_gb": round(memory.available / 1e9, 1),
            "total_memory_gb": round(memory.total / 1e9, 1),
            "free_disk_gb": round(free_disk_gb(models_dir()), 1),
            "gpu": gpu(),
            "engine": engine_id,  # the engine new projects use
            "data_dir": str(store.root.parent),
        }

    @api.get("/engines")
    def engines() -> list[dict]:
        found = []
        for engine_id in engine_ids():
            engine = get_engine(engine_id)
            files = engine.weight_files()
            found.append(
                {
                    "id": engine.id,
                    "name": engine.name,
                    "license": engine.license,
                    "gated": engine.gated,
                    "devices": sorted(engine.devices),
                    "est_mem_gb": engine.est_mem_gb,
                    "download_gb": engine.download_gb,
                    "installed": engine.is_installed(),
                    # where the weights are and how much space they take (for Settings)
                    "folder": os.path.commonpath(files) if files else None,
                    "disk_gb": round(sum(f.resolve().stat().st_size for f in files) / 1e9, 2),
                }
            )
        return found

    @api.get("/engines/{engine_id}/install")
    def install_state(engine_id: str) -> dict:
        return installs.get(_known(engine_id))

    @api.post("/engines/{engine_id}/install", status_code=202)
    def install_start(engine_id: str) -> dict:
        """Start or resume the download; progress comes as "install" events on /ws."""
        return installs.start(_known(engine_id))

    @api.post("/engines/{engine_id}/install/pause")
    async def install_pause(engine_id: str) -> dict:
        return await asyncio.to_thread(installs.pause, _known(engine_id))

    def _known(engine_id: str) -> str:
        if engine_id not in engine_ids():
            raise AppError(f"Unknown model {engine_id!r}.", "Pick one from /engines.", 404)
        return engine_id

    # --- projects -----------------------------------------------------------------------

    @api.get("/projects")
    def list_projects() -> list[dict]:
        return store.list()

    @api.post("/projects", status_code=201)
    def create_project(body: NewProject) -> dict:
        return store.create(body.name, check_settings(body.settings or {}))

    @api.get("/projects/{project_id}")
    def get_project(project_id: str) -> dict:
        return store.get(project_id)

    @api.patch("/projects/{project_id}")
    def change_project(project_id: str, body: ProjectChanges) -> dict:
        settings = check_settings(body.settings or {})
        if body.name is not None:
            store.rename(project_id, body.name)
        if settings:
            store.update(project_id, settings=settings)
        return store.get(project_id)

    @api.delete("/projects/{project_id}", status_code=204)
    def delete_project(project_id: str) -> None:
        if jobs.active_for(project_id):
            raise AppError("A job is still running for this project.", "Cancel it first.", 409)
        store.delete(project_id)

    @api.post("/projects/{project_id}/inputs")
    async def add_photo(project_id: str, photo: Annotated[UploadFile, File()]) -> dict:
        data = await photo.read()
        return await asyncio.to_thread(store.save_input, project_id, photo.filename or "", data)

    @api.get("/projects/{project_id}/files/{name}")
    def project_file(project_id: str, name: str) -> FileResponse:
        project, folder = store.get(project_id), store.folder(project_id)
        known = {
            "model.stl": project["outputs"].get("stl"),
            "raw.glb": project["outputs"].get("raw"),
            "input_rgba.png": "details/input_rgba.png",
            "original": project["image"],
        }
        relative = known.get(name)
        path = folder / relative if relative else None
        if path is None or not path.is_file():
            raise AppError("This file does not exist (yet).", "Create the model first.", 404)
        return FileResponse(path)

    # --- jobs ---------------------------------------------------------------------------

    @api.post("/jobs", status_code=202)
    def start_job(body: NewJob) -> dict:
        options = body.model_dump(exclude={"project_id"})
        return jobs.submit(body.project_id, options)

    @api.get("/jobs/{job_id}")
    def get_job(job_id: str) -> dict:
        return jobs.get(job_id)

    @api.post("/jobs/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict:
        return jobs.cancel(job_id)

    # --- print preparation and export ---------------------------------------------------

    @api.post("/projects/{project_id}/print-prep")
    def print_prep(project_id: str, body: PrintPrep) -> dict:
        """New height, base or rotation on the kept raw mesh: seconds, no AI model."""
        if jobs.active_for(project_id):
            raise AppError("A job is still running for this project.", "Wait for it to end.", 409)
        settings = check_settings(body.model_dump())
        project = store.update(project_id, settings=settings) if settings else store.get(project_id)
        result, outputs = reprint(store.folder(project_id), project)
        return store.update(project_id, status="ready", outputs=outputs, report=result.report)

    @api.get("/projects/{project_id}/report")
    def report(project_id: str) -> dict:
        found = store.get(project_id)["report"]
        if found is None:
            raise AppError("There is no report yet.", "Create the model first.", 404)
        return found

    @api.post("/projects/{project_id}/export")
    def export(project_id: str, body: ExportRequest) -> dict:
        if body.format != "stl":
            raise AppError(
                f"The format {body.format!r} is not available yet.", "Use format 'stl'.", 422
            )
        project, folder = store.get(project_id), store.folder(project_id)
        if not project["outputs"].get("stl"):
            raise AppError("There is no STL yet.", "Create the model first.", 409)
        source = folder / project["outputs"]["stl"]

        dest = Path(body.dest_path).expanduser()
        target = dest if dest.suffix.lower() == ".stl" else dest / source.name
        if not target.parent.is_dir():
            raise AppError(
                f"The folder {str(target.parent)!r} does not exist.", "Pick a folder.", 422
            )
        if target.exists():
            raise AppError(
                f"{target.name!r} already exists there.", "Pick another folder or name.", 409
            )
        shutil.copy2(source, target)
        return {"path": str(target)}

    app.include_router(api)

    # --- live progress ------------------------------------------------------------------

    @app.websocket("/ws")
    async def events(socket: WebSocket) -> None:
        given = socket.query_params.get("token") or socket.headers.get("x-token") or ""
        if not hmac.compare_digest(given, token):
            await socket.close(code=4401)
            return
        await socket.accept()
        client: asyncio.Queue = asyncio.Queue()
        hub.clients.add(client)
        try:
            while True:
                await socket.send_json(await client.get())
        except WebSocketDisconnect:
            pass
        finally:
            hub.clients.discard(client)
            with contextlib.suppress(Exception):
                await socket.close()

    return app
