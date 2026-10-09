"""Guaranteed-closed remesh: voxelize the surface, fill the inside, run marching cubes.

It smooths small details a little, but the result is always a closed surface, which
is what a slicer needs. Used when plain repair cannot make the mesh watertight.
"""

from __future__ import annotations

import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure


def voxel_remesh(
    mesh: trimesh.Trimesh, resolution: int = 256, smooth_sigma: float = 0.8
) -> trimesh.Trimesh:
    """Rebuild `mesh` as a closed surface on a grid with `resolution` cells along the longest side.

    Holes up to roughly 1/6 of the object size are closed into a solid. A much bigger
    opening leaves a closed but hollow thin shell (plain `repair` fills such loops first).
    """
    if resolution < 16:
        raise ValueError("resolution must be at least 16")

    # vertices that no face uses would be voxelized as if they were surface
    mesh = mesh.copy()
    mesh.remove_unreferenced_vertices()

    pitch = float(max(mesh.extents)) / resolution
    if pitch <= 0:
        raise ValueError("mesh has no size")

    surface = mesh.voxelized(pitch)
    grid = np.asarray(surface.matrix, dtype=bool)
    origin = np.asarray(surface.transform)[:3, 3]

    # Close gaps in the surface, then fill the inside. Closing = dilate, fill, erode.
    # The measured sweet spot is about resolution / 12 steps (cost is dominated by voxelizing).
    closing = max(4, resolution // 12)
    pad = closing + 2
    grid = np.pad(grid, pad)
    grid = ndimage.binary_dilation(grid, iterations=closing)
    grid = ndimage.binary_fill_holes(grid)
    grid = ndimage.binary_erosion(grid, iterations=closing)

    volume = ndimage.gaussian_filter(grid.astype(np.float32), sigma=smooth_sigma)
    if volume.max() <= 0.5:
        raise ValueError("voxel remesh produced an empty volume")

    verts, faces, _normals, _values = measure.marching_cubes(volume, level=0.5)
    verts = (verts - pad) * pitch + origin
    result = trimesh.Trimesh(verts, faces, process=True)
    trimesh.repair.fix_normals(result)
    return result
