"""A flat plate under the model, for models that touch the bed only with thin tips."""

from __future__ import annotations

import manifold3d
import numpy as np
import trimesh

from .base_cut import from_manifold, to_manifold

MARGIN_MM = 2.0  # the plate sticks out this much around the model's outline
OVERLAP_MM = 0.05  # the plate reaches this far into the model, so the two really join


def add_base_plate(mesh: trimesh.Trimesh, thickness_mm: float) -> trimesh.Trimesh:
    """Join a plate of `thickness_mm` under the model (the model must stand on z = 0).

    The plate's outline is the convex outline of the model seen from above, plus a margin,
    so legs and feet all stand on it. The result's bottom is at z = -thickness_mm.
    """
    if thickness_mm <= 0:
        return mesh.copy()
    outline = manifold3d.CrossSection.hull_points(np.asarray(mesh.vertices[:, :2]))
    outline = outline.offset(MARGIN_MM, manifold3d.JoinType.Round)
    plate = outline.extrude(thickness_mm + OVERLAP_MM).translate([0.0, 0.0, -thickness_mm])
    return from_manifold(to_manifold(mesh) + plate)
