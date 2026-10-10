"""A fake engine for tests: builds a simple figure without any AI model.

The figure is a body (capsule) with a head (sphere) and two ears, stacked along +Y
like a glTF model. The parts overlap and are NOT merged, so the raw mesh is not clean
(several bodies, internal faces), just like a real model's output can be.

PHOTO3D_DUMMY_SECONDS=10 makes a run take that long (in steps), so the app's progress
screen can be tried without the real model.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import trimesh

from .base import CancelFn, Cancelled, Engine, ProgressFn


def build_figure() -> trimesh.Trimesh:
    body = trimesh.creation.capsule(height=20, radius=8, count=[24, 24])
    body.apply_translation([0, 0, 0])
    head = trimesh.creation.icosphere(subdivisions=3, radius=7)
    head.apply_translation([0, 0, 17])
    ears = []
    for x in (-5, 5):
        ear = trimesh.creation.icosphere(subdivisions=2, radius=3)
        ear.apply_translation([x, 0, 23])
        ears.append(ear)
    figure = trimesh.util.concatenate([body, head, *ears])
    # capsule/spheres are built along Z, rotate so the figure stands along +Y
    figure.apply_transform(trimesh.transformations.rotation_matrix(-3.14159265 / 2, [1, 0, 0]))
    return figure


class DummyEngine(Engine):
    id = "dummy"
    name = "Dummy (tests)"
    license = "MIT"
    devices = frozenset({"cpu", "mps", "cuda"})
    est_mem_gb = 0.0
    up_axis = "y"

    def is_installed(self) -> bool:
        return True

    def install(self, progress: ProgressFn, cancelled: CancelFn = lambda: False) -> None:
        progress("install", 1.0)

    def load(self, device: str) -> None:
        self.device = device

    def unload(self) -> None:
        pass

    def run(
        self,
        rgba: Path,
        out_dir: Path,
        params: dict,
        progress: ProgressFn,
        cancelled: CancelFn,
    ) -> Path:
        out_dir.mkdir(parents=True, exist_ok=True)
        progress("generate", 0.0)
        steps, on_step = 5, params.get("on_step")
        pause = float(os.environ.get("PHOTO3D_DUMMY_SECONDS", "0")) / steps
        for step in range(steps):
            if cancelled():
                raise Cancelled()
            time.sleep(pause)
            if on_step:
                on_step(step + 1, steps)
            progress("generate", 0.9 * (step + 1) / steps)
        figure = build_figure()
        out = out_dir / "raw.glb"
        figure.export(out)
        progress("generate", 1.0)
        return out
