"""Projects on disk: one folder per project with a project.json (see docs/decisions/005).

<data-dir>/projects/<id>/
  project.json          name, settings, status, paths and the last report
  original.jpg          the photo, copied untouched (layout.save_original)
  <name>_50mm.stl       the print-ready model
  report.txt, report.json
  details/              input_rgba.png and raw.glb (the raw model, kept for print-prep)
"""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path

from .errors import AppError
from .layout import save_original
from .preprocess.image_io import SUPPORTED_SUFFIXES, load_image

DEFAULT_SETTINGS = {
    "height_mm": 50.0,
    "quality": "normal",
    "engine": "triposr",
    "device": "auto",
    "remove_bg": True,
    "base_cut_pct": 2.0,
    "rotation": [0, 0, 0],  # quarter turns around x, y, z
}
STATUSES = ("empty", "ready", "error")
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def check_settings(options: dict) -> dict:
    """Keep only the known settings, each with a valid value. Raises AppError otherwise."""
    from .engines.registry import engine_ids
    from .platform.devices import VALID_DEVICES
    from .print_prep.pipeline import QUALITY_PRESETS

    def number(value, low, high) -> bool:
        return (
            isinstance(value, int | float) and not isinstance(value, bool) and low <= value <= high
        )

    checks = {
        "quality": lambda v: v in QUALITY_PRESETS,
        "device": lambda v: v in VALID_DEVICES,
        "engine": lambda v: v in engine_ids(),
        "height_mm": lambda v: number(v, 5, 500),
        "base_cut_pct": lambda v: number(v, 0, 20),
        "remove_bg": lambda v: isinstance(v, bool),
        "rotation": lambda v: (
            isinstance(v, list) and len(v) == 3 and all(isinstance(t, int) for t in v)
        ),
    }
    settings = {}
    for key, value in options.items():
        if value is None:
            continue
        if key not in checks or not checks[key](value):
            raise AppError(f"Invalid value for {key!r}: {value!r}.", "Check the settings.", 422)
        settings[key] = value
    return settings


def file_stem(name: str) -> str:
    """A name that is safe in a file name (keeps Cyrillic and spaces, drops the rest)."""
    cleaned = re.sub(r"[^\w .-]", "", name, flags=re.UNICODE).strip(" .")
    return cleaned or "model"


def folder_slug(name: str) -> str:
    """ASCII-only part of a project folder name."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:30] or "project"


class ProjectStore:
    def __init__(self, data_dir: Path) -> None:
        self.root = Path(data_dir).resolve() / "projects"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    # --- lookup -------------------------------------------------------------------------

    def folder(self, project_id: str) -> Path:
        """Folder of a project. The id is checked, so a crafted id cannot leave the data dir."""
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", project_id):
            raise AppError("Unknown project.", "Pick a project from the list.", 404)
        folder = (self.root / project_id).resolve()
        if folder.parent != self.root or not (folder / "project.json").is_file():
            raise AppError("Unknown project.", "Pick a project from the list.", 404)
        return folder

    def get(self, project_id: str) -> dict:
        with self._lock:
            return json.loads((self.folder(project_id) / "project.json").read_text("utf-8"))

    def list(self) -> list[dict]:
        projects = []
        with self._lock:
            for path in self.root.glob("*/project.json"):
                try:
                    projects.append(json.loads(path.read_text("utf-8")))
                except (OSError, ValueError):
                    continue  # a broken project.json must not hide all other projects
        return sorted(projects, key=lambda p: p["created"], reverse=True)

    # --- changes ------------------------------------------------------------------------

    def create(self, name: str, settings: dict | None = None) -> dict:
        name = name.strip()
        if not name:
            raise AppError("The project needs a name.", "Type a name and try again.", 422)
        project = {
            "id": f"{folder_slug(name)}-{uuid.uuid4().hex[:6]}",
            "name": name,
            "created": datetime.now().isoformat(timespec="seconds"),
            "status": "empty",
            "image": None,
            "settings": {**DEFAULT_SETTINGS, **(settings or {})},
            "outputs": {},
            "last_job": None,
            "report": None,
        }
        with self._lock:
            folder = self.root / project["id"]
            folder.mkdir(parents=True)
            self._write(folder, project)
        return project

    def update(self, project_id: str, **changes) -> dict:
        """Merge top-level fields (settings and outputs are merged one level deeper)."""
        with self._lock:
            project = self.get(project_id)
            for key, value in changes.items():
                if key in ("settings", "outputs") and isinstance(value, dict):
                    project[key] = {**project[key], **value}
                else:
                    project[key] = value
            self._write(self.folder(project_id), project)
            return project

    def rename(self, project_id: str, name: str) -> dict:
        name = name.strip()
        if not name:
            raise AppError("The project needs a name.", "Type a name and try again.", 422)
        return self.update(project_id, name=name)

    def delete(self, project_id: str) -> None:
        """Remove the project folder, and only a folder that is directly inside the data dir."""
        with self._lock:
            folder = self.folder(project_id)
            if folder.parent != self.root:
                raise AppError("Refusing to delete outside the data folder.", "", 400)
            shutil.rmtree(folder)

    def save_input(self, project_id: str, filename: str, data: bytes) -> dict:
        """Store the uploaded photo as original.<ext>. Checks the type and that it opens."""
        suffix = Path(filename).suffix.lower()
        if suffix not in SUPPORTED_SUFFIXES:
            raise AppError(
                f"Unsupported photo type {suffix or '(none)'}.",
                f"Use one of: {', '.join(sorted(SUPPORTED_SUFFIXES))}.",
                415,
            )
        if not data or len(data) > MAX_UPLOAD_BYTES:
            raise AppError("The photo is empty or larger than 50 MB.", "Pick another photo.", 413)

        with self._lock:
            folder = self.folder(project_id)
            with tempfile.TemporaryDirectory(prefix="photo3d_up_") as temp:
                upload = Path(temp) / f"upload{suffix}"
                upload.write_bytes(data)
                try:
                    load_image(upload)
                except Exception as error:  # Pillow raises many kinds of errors for bad files
                    raise AppError(
                        "This file could not be opened as a photo.",
                        "Try a JPG or PNG photo.",
                        422,
                    ) from error
                for old in folder.glob("original.*"):
                    old.unlink()  # our own copy of the previous photo of this project
                saved = save_original(upload, folder)
            # a new photo makes the old model and report stale
            project = self.get(project_id)
            project.update(image=saved.name, status="empty", outputs={}, report=None)
            self._write(folder, project)
            return project

    def _write(self, folder: Path, project: dict) -> None:
        target = folder / "project.json"
        temp = folder / "project.json.tmp"
        temp.write_text(json.dumps(project, indent=2, ensure_ascii=False), "utf-8")
        temp.replace(target)  # never leaves a half-written project.json
