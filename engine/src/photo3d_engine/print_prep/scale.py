"""Scale to real-world size in millimetres."""

from __future__ import annotations

import trimesh


def scale_to_height(mesh: trimesh.Trimesh, height_mm: float) -> trimesh.Trimesh:
    """Uniformly scale so that the size along Z equals `height_mm`."""
    if height_mm <= 0:
        raise ValueError("height_mm must be positive")
    current = float(mesh.extents[2])
    if current <= 0:
        raise ValueError("mesh has no height")
    result = mesh.copy()
    result.apply_scale(height_mm / current)
    return result


def bed_offset(mesh: trimesh.Trimesh) -> list[float]:
    """The move that centres the mesh on X/Y and puts its lowest point on Z=0."""
    low, high = mesh.bounds
    center_xy = (low[:2] + high[:2]) / 2
    return [-float(center_xy[0]), -float(center_xy[1]), -float(low[2])]


def place_on_bed(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Centre on X/Y and put the lowest point on Z=0 (the print bed)."""
    result = mesh.copy()
    result.apply_translation(bed_offset(mesh))
    return result
