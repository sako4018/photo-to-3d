"""Reduce the triangle count (smaller files, faster slicing)."""

from __future__ import annotations

import fast_simplification
import numpy as np
import trimesh


def simplify(mesh: trimesh.Trimesh, target_faces: int) -> trimesh.Trimesh:
    """Decimate to about `target_faces` triangles. Smaller meshes are returned as they are."""
    if target_faces < 4:
        raise ValueError("target_faces must be at least 4")
    if len(mesh.faces) <= target_faces:
        return mesh.copy()

    points, faces = fast_simplification.simplify(
        np.asarray(mesh.vertices, dtype=np.float64),
        np.asarray(mesh.faces, dtype=np.int64),
        target_count=target_faces,
    )
    result = trimesh.Trimesh(points, faces, process=True)
    trimesh.repair.fix_normals(result)
    return result
