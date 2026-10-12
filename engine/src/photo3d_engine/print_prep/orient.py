"""Orientation: slicers use Z as "up", glTF models use Y."""

from __future__ import annotations

import numpy as np
import trimesh


def to_z_up(mesh: trimesh.Trimesh, up_axis: str = "y") -> trimesh.Trimesh:
    """Rotate the mesh so that its `up_axis` ("y" or "z") becomes +Z."""
    result = mesh.copy()
    if up_axis == "z":
        return result
    if up_axis == "y":
        # +90 degrees around X turns +Y into +Z
        result.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
        return result
    raise ValueError(f"up_axis must be 'y' or 'z', got {up_axis!r}")


def rotate_90(mesh: trimesh.Trimesh, axis: str, turns: int = 1) -> trimesh.Trimesh:
    """Manual rotation in 90 degree steps around x, y or z (for the UI buttons later)."""
    vectors = {"x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]}
    if axis not in vectors:
        raise ValueError(f"axis must be x, y or z, got {axis!r}")
    result = mesh.copy()
    result.apply_transform(
        trimesh.transformations.rotation_matrix(np.pi / 2 * turns, vectors[axis])
    )
    return result


def upright_matrix(up_axis: str, rotation) -> np.ndarray:
    """The 4x4 matrix of to_z_up(up_axis) followed by the 90 degree turns in `rotation`."""
    matrix = np.eye(4)
    if up_axis == "y":
        matrix = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]) @ matrix
    vectors = {"x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]}
    for axis, turns in zip("xyz", rotation, strict=True):
        if turns % 4:
            turn = trimesh.transformations.rotation_matrix(np.pi / 2 * turns, vectors[axis])
            matrix = turn @ matrix
    return matrix
