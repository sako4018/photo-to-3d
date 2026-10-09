"""Cut a flat base so the model sits stable on the bed (boolean trim with manifold3d)."""

from __future__ import annotations

import manifold3d
import numpy as np
import trimesh


class NotManifoldError(ValueError):
    """The mesh cannot be used for boolean operations (open or self-intersecting)."""


def to_manifold(mesh: trimesh.Trimesh) -> manifold3d.Manifold:
    source = manifold3d.Mesh(
        vert_properties=np.asarray(mesh.vertices, dtype=np.float32),
        tri_verts=np.asarray(mesh.faces, dtype=np.uint32),
    )
    result = manifold3d.Manifold(source)
    if result.is_empty() or str(result.status()) != "Error.NoError":
        raise NotManifoldError(f"mesh is not manifold: {result.status()}")
    return result


def from_manifold(result: manifold3d.Manifold) -> trimesh.Trimesh:
    out = result.to_mesh()
    mesh = trimesh.Trimesh(
        np.asarray(out.vert_properties)[:, :3].astype(np.float64),
        np.asarray(out.tri_verts),
        process=False,
    )
    mesh.merge_vertices()
    return mesh


def cut_base(mesh: trimesh.Trimesh, cut_fraction: float = 0.02) -> trimesh.Trimesh:
    """Remove the lowest `cut_fraction` of the height (along Z) and leave a flat bottom.

    The mesh must be closed. Raises NotManifoldError otherwise.
    """
    if not 0 <= cut_fraction < 0.5:
        raise ValueError("cut_fraction must be in [0, 0.5)")
    if cut_fraction == 0:
        return mesh.copy()

    low, high = mesh.bounds[:, 2]
    cut_z = low + (high - low) * cut_fraction
    manifold = to_manifold(mesh)
    # trim_by_plane keeps what is in the direction of the normal: z >= cut_z
    trimmed = manifold.trim_by_plane([0, 0, 1], float(cut_z))
    if trimmed.is_empty():
        raise ValueError("base cut removed the whole mesh")
    return from_manifold(trimmed)
