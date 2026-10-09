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


def place_on_bed(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Centre on X/Y and put the lowest point on Z=0 (the print bed)."""
    result = mesh.copy()
    low, high = result.bounds
    center_xy = (low[:2] + high[:2]) / 2
    result.apply_translation([-center_xy[0], -center_xy[1], -low[2]])
    return result
