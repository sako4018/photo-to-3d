"""Remove small floating pieces ("islands") that AI models often leave around the object."""

from __future__ import annotations

import trimesh


def _part_size(part: trimesh.Trimesh) -> float:
    # volume is only meaningful for closed parts, an open part is measured by its hull
    if part.is_watertight:
        return abs(float(part.volume))
    try:
        return float(part.convex_hull.volume)
    except Exception:
        return float(part.area)


def remove_islands(
    mesh: trimesh.Trimesh, min_fraction: float = 0.01
) -> tuple[trimesh.Trimesh, int]:
    """Keep the parts whose size is at least `min_fraction` of the biggest part.

    Returns the cleaned mesh and the number of removed parts.
    """
    parts = mesh.split(only_watertight=False)
    if len(parts) <= 1:
        return mesh, 0

    sizes = [_part_size(p) for p in parts]
    biggest = max(sizes)
    keep = [p for p, s in zip(parts, sizes, strict=True) if s >= biggest * min_fraction]
    removed = len(parts) - len(keep)
    if removed == 0:
        return mesh, 0
    if len(keep) == 1:
        return keep[0], removed
    return trimesh.util.concatenate(keep), removed
