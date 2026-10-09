"""Binary STL export. STL has no units, slicers read the numbers as millimetres."""

from __future__ import annotations

from pathlib import Path

import trimesh


def write_stl(mesh: trimesh.Trimesh, path: Path) -> Path:
    """Write a binary STL and return its path. Parent folders are created."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = mesh.export(file_type="stl")  # trimesh writes binary STL
    path.write_bytes(data)
    return path
