"""Where the engine keeps its data on each system."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "photo-to-3d"
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "photo-to-3d"
    return Path.home() / ".photo-to-3d"


def models_dir() -> Path:
    """Where downloaded weights live. The server sets PHOTO3D_MODELS_DIR from --data-dir."""
    found = os.environ.get("PHOTO3D_MODELS_DIR")
    return Path(found) if found else default_data_dir() / "models"
