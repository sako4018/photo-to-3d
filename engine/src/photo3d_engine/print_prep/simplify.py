"""Reduce the triangle count (smaller files, faster slicing)."""

from __future__ import annotations

import fast_simplification
import numpy as np
import trimesh

# Meshes up to this many times the target are kept as they are: halving them saves only a
# few MB, and on a detailed TripoSG watch it left thin sliver triangles on the flat back.
KEEP_UP_TO = 2.0


def simplify(mesh: trimesh.Trimesh, target_faces: int, aggressiveness: int = 7) -> trimesh.Trimesh:
    """Decimate to about `target_faces` triangles. Meshes up to twice that are returned as is.

    A lower `aggressiveness` merges less boldly: slower to reach the target, but it avoids
    pinching two nearby surfaces together (seen on a real teddy-bear photo).
    """
    if target_faces < 4:
        raise ValueError("target_faces must be at least 4")
    if len(mesh.faces) <= target_faces * KEEP_UP_TO:
        return mesh.copy()

    points, faces = fast_simplification.simplify(
        np.asarray(mesh.vertices, dtype=np.float64),
        np.asarray(mesh.faces, dtype=np.int64),
        target_count=target_faces,
        agg=aggressiveness,
    )
    result = trimesh.Trimesh(points, faces, process=True)
    trimesh.repair.fix_normals(result)
    return result
