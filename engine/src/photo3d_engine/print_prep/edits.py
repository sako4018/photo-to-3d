"""Changes to one part of the model, picked by the user with a click (no AI model).

Every edit is a sphere (centre and radius) plus an operation. Edits are kept in the
project settings in the coordinates of the raw mesh (details/raw.glb), so they still fit
after the height, the rotation or the base plate change. They are applied to a copy of
the raw mesh before the print pipeline, which then repairs and closes the result.

- smooth:  evens out bumps and noise inside the sphere (Taubin smoothing, keeps the volume)
- thicker: pushes the surface out along its normals, most in the middle of the sphere
- thinner: pulls it in
- remove:  deletes the surface inside the sphere; repair / voxel remesh close the cut
"""

from __future__ import annotations

import numpy as np
import scipy.sparse as sparse
import trimesh

OPERATIONS = ("smooth", "thicker", "thinner", "remove")
SMOOTH_REACH = {1: 0.25, 2: 0.5, 3: 0.8}  # strength -> how far it evens out, share of the radius
MIN_ROUNDS, MAX_ROUNDS = 4, 600
TAUBIN_SHRINK = 0.5
TAUBIN_INFLATE = -0.53
FULL_SHARE = 0.5  # the edit works fully in this inner share of the radius
MAX_FACES_TO_SPLIT = 2_000_000  # a mesh bigger than this is dense enough already


def falloff(mesh: trimesh.Trimesh, center, radius: float, full: float = FULL_SHARE) -> np.ndarray:
    """Weight per vertex: 1 up to `full` of the radius, then smoothly down to 0 at the radius."""
    distance = np.linalg.norm(mesh.vertices - np.asarray(center, dtype=float), axis=1)
    outer = np.clip((distance / radius - full) / (1.0 - full), 0.0, 1.0)
    return (1.0 - outer**2) ** 2


def _neighbour_average(mesh: trimesh.Trimesh) -> sparse.csr_matrix:
    """Matrix that turns vertex positions into the average of each vertex's neighbours."""
    edges = mesh.edges_unique
    count = len(mesh.vertices)
    ones = np.ones(len(edges) * 2)
    rows = np.concatenate([edges[:, 0], edges[:, 1]])
    cols = np.concatenate([edges[:, 1], edges[:, 0]])
    adjacency = sparse.csr_matrix((ones, (rows, cols)), shape=(count, count))
    degree = np.asarray(adjacency.sum(axis=1)).ravel()
    degree[degree == 0] = 1
    return sparse.diags(1.0 / degree) @ adjacency


def smooth(mesh: trimesh.Trimesh, center, radius: float, strength: int = 2) -> trimesh.Trimesh:
    weight = falloff(mesh, center, radius)
    inside = np.flatnonzero(weight > 0)
    if len(inside) == 0:
        return mesh
    # Smoothing spreads about one edge length per round, so the number of rounds follows
    # the size of the area in edges: the same on a coarse test mesh and a dense AI model.
    edges = mesh.edges_unique_length[np.isin(mesh.edges_unique, inside).any(axis=1)]
    edge = float(np.median(edges)) if len(edges) else radius
    reach = SMOOTH_REACH.get(strength, SMOOTH_REACH[2]) * radius
    rounds = int(np.clip(round((reach / edge) ** 2), MIN_ROUNDS, MAX_ROUNDS))
    average = _neighbour_average(mesh)[inside]  # only the rows of the moving points
    vertices = np.array(mesh.vertices)
    moving = weight[inside, None]
    for _ in range(rounds):
        for factor in (TAUBIN_SHRINK, TAUBIN_INFLATE):
            vertices[inside] += factor * moving * (average @ vertices - vertices[inside])
    return trimesh.Trimesh(vertices, mesh.faces, process=False)


def offset(mesh: trimesh.Trimesh, center, radius: float, distance: float) -> trimesh.Trimesh:
    """Move the surface along its normals by up to `distance` (negative = inwards).

    The push is a smooth bump with no flat top: a flat top with a falling edge showed as a
    stamped ring on a real model.
    """
    weight = falloff(mesh, center, radius, full=0.0)[:, None]
    if not weight.any():
        return mesh
    vertices = np.array(mesh.vertices) + weight * distance * mesh.vertex_normals
    moved = trimesh.Trimesh(vertices, mesh.faces, process=False)
    # a light smoothing of the same area hides the steps that a pure push leaves
    return smooth(moved, center, radius, strength=1)


def remove(mesh: trimesh.Trimesh, center, radius: float) -> trimesh.Trimesh:
    inside = (
        np.linalg.norm(mesh.triangles_center - np.asarray(center, dtype=float), axis=1) < radius
    )
    if inside.all():
        raise ValueError("this would remove the whole model")
    result = mesh.copy()
    result.update_faces(~inside)
    result.remove_unreferenced_vertices()
    return result


def _fine_enough(mesh: trimesh.Trimesh, center, radius: float) -> trimesh.Trimesh:
    """Split big triangles near the sphere, so the edit has points to move there.

    Real models are dense, but a flat side can be one big triangle that the sphere touches
    without any corner inside it; then nothing would change.
    """
    center = np.asarray(center, dtype=float)
    target = radius / 3.0
    for _ in range(8):
        triangles = mesh.triangles
        low, high = triangles.min(axis=1), triangles.max(axis=1)
        near = np.all((low <= center + radius) & (high >= center - radius), axis=1)
        if not near.any():
            return mesh
        edges = np.linalg.norm(triangles[near] - np.roll(triangles[near], 1, axis=1), axis=2)
        if np.percentile(edges, 90) <= target or len(mesh.faces) > MAX_FACES_TO_SPLIT:
            return mesh
        vertices, faces = trimesh.remesh.subdivide(mesh.vertices, mesh.faces)
        mesh = trimesh.Trimesh(vertices, faces, process=False)
        mesh.merge_vertices()
    return mesh


def apply_edits(mesh: trimesh.Trimesh, edits: list[dict]) -> trimesh.Trimesh:
    """Apply the edits in order to a copy of `mesh` (raw-mesh coordinates)."""
    if not edits:
        return mesh
    result = mesh.copy()
    result.merge_vertices()  # glTF splits vertices at seams; smoothing needs them joined
    for edit in edits:
        center, radius = edit["center"], float(edit["radius"])
        operation = edit["op"]
        result = _fine_enough(result, center, radius)
        if operation == "smooth":
            result = smooth(result, center, radius, int(edit.get("strength", 2)))
        elif operation in ("thicker", "thinner"):
            sign = 1.0 if operation == "thicker" else -1.0
            result = offset(result, center, radius, sign * float(edit["amount"]))
        elif operation == "remove":
            result = remove(result, center, radius)
        else:
            raise ValueError(f"unknown edit {operation!r}")
    return result


def to_raw(to_stl: list[list[float]], point_mm, radius_mm: float) -> tuple[list[float], float]:
    """Turn a point and a radius picked on the STL (mm) into raw-mesh coordinates."""
    matrix = np.asarray(to_stl, dtype=float)
    scale = float(np.cbrt(abs(np.linalg.det(matrix[:3, :3]))))
    point = np.linalg.inv(matrix) @ np.append(np.asarray(point_mm, dtype=float), 1.0)
    return [round(float(value), 6) for value in point[:3]], radius_mm / scale


def raw_scale(to_stl: list[list[float]]) -> float:
    """How many millimetres one raw-mesh unit is."""
    return float(np.cbrt(abs(np.linalg.det(np.asarray(to_stl, dtype=float)[:3, :3]))))
