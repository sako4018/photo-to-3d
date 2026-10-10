"""Hand-made broken meshes. None of the tests need an AI model."""

from __future__ import annotations

import io
import threading

import numpy as np
import pytest
import trimesh
from PIL import Image


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


@pytest.fixture
def photo_bytes() -> bytes:
    """A red blob on a transparent canvas: counts as cut out, so no background AI runs."""
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    image.paste(Image.new("RGBA", (80, 120), (200, 30, 30, 255)), (60, 40))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def gate(monkeypatch) -> threading.Event:
    """Registers a "slow" engine that waits for the gate to open inside run()."""
    from photo3d_engine.engines import registry
    from photo3d_engine.engines.base import Cancelled
    from photo3d_engine.engines.dummy import DummyEngine

    opened = threading.Event()

    class SlowEngine(DummyEngine):
        id = "slow"

        def run(self, rgba, out_dir, params, progress, cancelled):
            while not opened.wait(0.01):
                if cancelled():
                    raise Cancelled()
            return super().run(rgba, out_dir, params, progress, cancelled)

    monkeypatch.setitem(registry._FACTORIES, "slow", SlowEngine)
    yield opened
    opened.set()  # never leave a worker thread waiting
