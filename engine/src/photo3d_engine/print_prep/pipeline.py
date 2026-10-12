"""The whole "raw AI mesh -> print-ready mesh" chain (see docs/PLAN.md, 7.2)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import trimesh

from .base_cut import NotManifoldError, cut_base
from .base_plate import add_base_plate
from .islands import remove_islands
from .orient import to_z_up, upright_matrix
from .repair import is_printable, repair
from .report import build_report
from .scale import bed_offset, place_on_bed, scale_to_height
from .simplify import simplify
from .voxel_remesh import voxel_remesh

# quality -> (voxel remesh resolution, target triangle count)
QUALITY_PRESETS: dict[str, tuple[int, int]] = {
    "fast": (128, 50_000),
    "normal": (256, 150_000),
    "detailed": (384, 300_000),
}


# tried in this order until the simplified mesh is still closed. The first one is the fastest;
# a real teddy-bear mesh needed 3 (the default 7 pinched two surfaces together).
SIMPLIFY_AGGRESSIVENESS = (7, 3, 1)

# below this the model may fall over or come loose while printing
SMALL_CONTACT_MM2 = 25.0
SMALL_CONTACT_SHARE = 0.02  # of the box around the model seen from above


@dataclass
class PrintParams:
    height_mm: float = 50.0
    up_axis: str = "y"
    quality: str = "normal"
    base_cut_fraction: float = 0.02
    island_fraction: float = 0.01
    base_plate_mm: float = 0.0  # 0 = no plate; else a plate this thick is added under the model
    target_faces: int | None = None  # None = taken from the quality preset
    # Height (in the input's units, after the base cut) that becomes height_mm. None = the
    # mesh's own height. Set for edited meshes, so an edit does not rescale the whole model.
    reference_height: float | None = None


@dataclass
class PrintResult:
    mesh: trimesh.Trimesh
    report: dict
    timings: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    # 4x4 matrix from the input mesh's coordinates to the printed mesh (mm). Only scaling,
    # turning and moving happen in the pipeline, so a picked point can be mapped back.
    transform: np.ndarray = field(default_factory=lambda: np.eye(4))


def small_contact_note(report: dict) -> str | None:
    """A warning when the model touches the bed with too little area, else None."""
    contact = report["base_contact_mm2"]
    width, depth, _ = report["size_mm"]
    if contact >= SMALL_CONTACT_MM2 and contact >= SMALL_CONTACT_SHARE * width * depth:
        return None
    return (
        f"the model touches the bed with only {contact:g} mm2: "
        "use a brim or supports in the slicer, or add a base plate"
    )


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

    transform = np.eye(4)

    def move_to_bed(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
        nonlocal transform
        shift = np.eye(4)
        shift[:3, 3] = bed_offset(mesh)
        transform = shift @ transform
        return place_on_bed(mesh)

    started = time.perf_counter()
    mesh = to_z_up(mesh, params.up_axis)
    transform = upright_matrix(params.up_axis, (0, 0, 0))
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
    if params.reference_height:
        factor = params.height_mm / params.reference_height
        mesh = mesh.copy()
        mesh.apply_scale(factor)
    else:
        factor = params.height_mm / float(mesh.extents[2])
        mesh = scale_to_height(mesh, params.height_mm)
    transform = np.diag([factor, factor, factor, 1.0]) @ transform
    mesh = move_to_bed(mesh)
    stage("scale", started)

    if params.base_plate_mm > 0:
        started = time.perf_counter()
        mesh = move_to_bed(add_base_plate(mesh, params.base_plate_mm))
        notes.append(
            f"added a {params.base_plate_mm:g} mm base plate "
            f"(total height {params.height_mm + params.base_plate_mm:g} mm)"
        )
        stage("base_plate", started)

    started = time.perf_counter()
    for aggressiveness in SIMPLIFY_AGGRESSIVENESS:
        simplified = simplify(mesh, target_faces, aggressiveness)
        if is_printable(simplified):
            mesh = move_to_bed(simplified)
            if aggressiveness != SIMPLIFY_AGGRESSIVENESS[0]:
                notes.append(f"simplification needed a gentler setting ({aggressiveness})")
            break
    else:
        notes.append("simplification broke the mesh, kept the full-detail version")
    stage("simplify", started)

    started = time.perf_counter()
    report = build_report(mesh)
    stage("report", started)
    contact_note = small_contact_note(report)
    if contact_note:
        notes.append(contact_note)
    report["notes"] = list(notes)

    return PrintResult(mesh=mesh, report=report, timings=timings, notes=notes, transform=transform)
