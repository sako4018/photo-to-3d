"""Print-ready files from a project's kept raw mesh. Used after a job and for fast re-runs.

The raw mesh (details/raw.glb) is never changed, so height, base cut and rotation can be
tried again in seconds without running the AI model again (docs/PLAN.md, 7.2).
"""

from __future__ import annotations

import json
from pathlib import Path

import trimesh

from .cli import format_result
from .engines.registry import get_engine, raw_up_axis
from .errors import AppError
from .export.stl import write_stl
from .make import MakeResult
from .print_prep.orient import rotate_90, to_z_up
from .print_prep.pipeline import PrintParams, prepare_for_print
from .projects import file_stem


def stl_name(project: dict, height_mm: float) -> str:
    return f"{file_stem(project['name'])}_{height_mm:g}mm.stl"


def write_outputs(folder: Path, project: dict, result: MakeResult) -> dict:
    """Write report.json and report.txt next to the STL. Returns the `outputs` entry."""
    (folder / "report.json").write_text(
        json.dumps(result.report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (folder / "report.txt").write_text(format_result(result) + "\n", encoding="utf-8")
    return {
        "stl": result.stl_path.name,
        "report": "report.json",
        "raw": "details/raw.glb",
    }


def reprint(folder: Path, project: dict) -> tuple[MakeResult, dict]:
    """Run the print pipeline again on the kept raw mesh with the project's settings."""
    raw_path = folder / "details" / "raw.glb"
    if not raw_path.is_file():
        raise AppError(
            "There is no model to adjust yet.",
            "Create the 3D model from the photo first.",
            409,
        )
    settings = project["settings"]
    engine = get_engine(settings["engine"])

    mesh = to_z_up(trimesh.load(raw_path, force="mesh"), raw_up_axis(settings["engine"]))
    for axis, turns in zip("xyz", settings["rotation"], strict=True):
        if turns % 4:
            mesh = rotate_90(mesh, axis, turns)

    params = PrintParams(
        height_mm=float(settings["height_mm"]),
        up_axis="z",  # already turned upright above
        quality=settings["quality"],
        base_cut_fraction=float(settings["base_cut_pct"]) / 100.0,
        base_plate_mm=float(settings.get("base_plate_mm", 0.0)),
    )
    try:
        printed = prepare_for_print(mesh, params)
    except ValueError as error:
        raise AppError(
            f"The model could not be prepared: {error}", "Try other settings."
        ) from error

    stl_path = write_stl(printed.mesh, folder / stl_name(project, params.height_mm))
    result = MakeResult(
        stl_path=stl_path,
        report=printed.report,
        timings=printed.timings,
        notes=printed.notes,
        device="cpu",
        engine=engine.id,
    )
    return result, write_outputs(folder, project, result)
