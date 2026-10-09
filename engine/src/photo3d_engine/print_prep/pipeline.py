"""The whole "raw AI mesh -> print-ready mesh" chain (see docs/PLAN.md, 7.2)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import trimesh

from .base_cut import NotManifoldError, cut_base
from .islands import remove_islands
from .orient import to_z_up
from .repair import is_printable, repair
from .report import build_report
from .scale import place_on_bed, scale_to_height
from .simplify import simplify
from .voxel_remesh import voxel_remesh

# quality -> (voxel remesh resolution, target triangle count)
QUALITY_PRESETS: dict[str, tuple[int, int]] = {
    "fast": (128, 50_000),
    "normal": (256, 150_000),
    "detailed": (384, 300_000),
}


@dataclass
class PrintParams:
    height_mm: float = 50.0
    up_axis: str = "y"
    quality: str = "normal"
    base_cut_fraction: float = 0.02
    island_fraction: float = 0.01
    target_faces: int | None = None  # None = taken from the quality preset


@dataclass
class PrintResult:
    mesh: trimesh.Trimesh
    report: dict
    timings: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def prepare_for_print(raw: trimesh.Trimesh, params: PrintParams | None = None) -> PrintResult:
    """Repair, orient, cut a base, scale to millimetres, put on the bed and simplify."""
    params = params or PrintParams()
    if params.quality not in QUALITY_PRESETS:
        raise ValueError(f"Unknown quality {params.quality!r}, expected {list(QUALITY_PRESETS)}")
    resolution, preset_faces = QUALITY_PRESETS[params.quality]
    target_faces = params.target_faces or preset_faces

    timings: dict[str, float] = {}
    notes: list[str] = []

    def stage(name: str, started: float) -> None:
        timings[name] = round(time.perf_counter() - started, 3)

    started = time.perf_counter()
    mesh = repair(raw)
    mesh, removed = remove_islands(mesh, params.island_fraction)
    if removed:
        notes.append(f"removed {removed} small floating part(s)")
    stage("repair", started)

    remeshed = False
    # Several parts usually means overlapping pieces: a slicer sees crossing surfaces there,
    # voxel remesh merges them into one solid.
    parts = len(mesh.split(only_watertight=False))
    if not is_printable(mesh) or parts > 1:
        started = time.perf_counter()
        mesh = voxel_remesh(mesh, resolution)
        remeshed = True
        reason = "was not watertight" if parts <= 1 else f"had {parts} separate parts"
        notes.append(f"mesh {reason}, rebuilt with voxel remesh")
        stage("voxel_remesh", started)

    started = time.perf_counter()
    mesh = to_z_up(mesh, params.up_axis)
    stage("orient", started)

    started = time.perf_counter()
    try:
        mesh = cut_base(mesh, params.base_cut_fraction)
    except NotManifoldError:
        if remeshed:
            raise
        mesh = voxel_remesh(mesh, resolution)
        notes.append("mesh was not usable for the base cut, rebuilt with voxel remesh")
        mesh = cut_base(mesh, params.base_cut_fraction)
    stage("base_cut", started)

    # scale after the cut, so the final height is exactly height_mm
    started = time.perf_counter()
    mesh = scale_to_height(mesh, params.height_mm)
    mesh = place_on_bed(mesh)
    stage("scale", started)

    started = time.perf_counter()
    simplified = simplify(mesh, target_faces)
    if is_printable(simplified):
        mesh = place_on_bed(simplified)
    else:
        notes.append("simplification broke the mesh, kept the full-detail version")
    stage("simplify", started)

    started = time.perf_counter()
    report = build_report(mesh)
    stage("report", started)

    return PrintResult(mesh=mesh, report=report, timings=timings, notes=notes)
