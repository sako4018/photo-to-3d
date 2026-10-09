"""Hand-made broken meshes. None of the tests need an AI model."""

from __future__ import annotations

import numpy as np
import pytest
import trimesh


@pytest.fixture
def sphere() -> trimesh.Trimesh:
    return trimesh.creation.icosphere(subdivisions=3, radius=10)


@pytest.fixture
def sphere_small_hole(sphere) -> trimesh.Trimesh:
    """A few neighbouring faces missing: a small hole that trimesh can fill."""
    keep = np.ones(len(sphere.faces), dtype=bool)
    near_top = np.argsort(-sphere.triangles_center[:, 2])[:3]
    keep[near_top] = False
    return trimesh.Trimesh(sphere.vertices, sphere.faces[keep], process=False)


@pytest.fixture
def sphere_big_hole(sphere) -> trimesh.Trimesh:
    """The whole top cap is gone: a big open mesh."""
    keep = sphere.triangles_center[:, 2] < 5
    return trimesh.Trimesh(sphere.vertices, sphere.faces[keep], process=False)


@pytest.fixture
def sphere_flipped(sphere) -> trimesh.Trimesh:
    """Every 7th face has the wrong winding (normals point inwards)."""
    faces = sphere.faces.copy()
    faces[::7] = faces[::7][:, ::-1]
    return trimesh.Trimesh(sphere.vertices, faces, process=False)


@pytest.fixture
def overlapping_balls() -> trimesh.Trimesh:
    """Two closed balls that cut through each other, stored as one mesh."""
    a = trimesh.creation.icosphere(subdivisions=3, radius=10)
    b = trimesh.creation.icosphere(subdivisions=3, radius=10)
    b.apply_translation([8, 0, 0])
    return trimesh.util.concatenate([a, b])


@pytest.fixture
def ball_with_island(sphere) -> trimesh.Trimesh:
    """A big ball plus a tiny floating speck far away."""
    speck = trimesh.creation.icosphere(subdivisions=1, radius=0.5)
    speck.apply_translation([40, 0, 0])
    return trimesh.util.concatenate([sphere, speck])
