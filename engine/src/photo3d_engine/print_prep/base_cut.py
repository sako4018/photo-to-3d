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
    return drop_back_to_back(mesh)


def drop_back_to_back(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Remove flat slivers with no volume that boolean operations sometimes leave.

    Two kinds: triangles that use one corner twice (merging corners that were almost on the
    same spot does that), and pairs of triangles on the same three corners facing each
    other. They are not part of the solid, but they make it look open and in several parts.
    """
    faces = mesh.faces
    repeated = (
        (faces[:, 0] == faces[:, 1]) | (faces[:, 1] == faces[:, 2]) | (faces[:, 0] == faces[:, 2])
    )
    pairs = trimesh.grouping.group_rows(np.sort(faces, axis=1), require_count=2)
    if not repeated.any() and len(pairs) == 0:
        return mesh
    keep = ~repeated
    if len(pairs):
        keep[np.ravel(pairs)] = False
    mesh.update_faces(keep)
    mesh.remove_unreferenced_vertices()
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
