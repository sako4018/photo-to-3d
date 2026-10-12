"""Print-ready files from a project's kept raw mesh. Used after a job and for fast re-runs.

The raw mesh (details/raw.glb) is never changed, so height, base cut and rotation can be
tried again in seconds without running the AI model again (docs/PLAN.md, 7.2).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import trimesh

from .cli import format_result
from .engines.registry import get_engine, raw_up_axis
from .errors import AppError
from .export.stl import write_stl
from .make import MakeResult
from .print_prep.edits import apply_edits
from .print_prep.orient import rotate_90, to_z_up, upright_matrix
from .print_prep.pipeline import QUALITY_PRESETS, PrintParams, prepare_for_print
from .print_prep.voxel_remesh import voxel_remesh
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


def closed_one_part(report: dict) -> bool:
    return bool(report["watertight"]) and report["bodies"] == 1


def edited_mesh(details: Path, raw: trimesh.Trimesh, edits: list[dict]) -> trimesh.Trimesh:
    """The raw mesh with the edits. The last result is kept on disk, so a new edit only
    applies itself instead of all the edits before it again."""
    cache, cache_edits = details / "edited.npz", details / "edited.json"
    if not edits:
        cache.unlink(missing_ok=True)
        cache_edits.unlink(missing_ok=True)
        return raw
    stat = (details / "raw.glb").stat()
    source = [stat.st_size, stat.st_mtime_ns]  # a new model from the photo makes the cache stale
    start, done = raw, 0
    if cache.is_file() and cache_edits.is_file():
        try:
            info = json.loads(cache_edits.read_text(encoding="utf-8"))
            kept = info["edits"]
            if info["raw"] == source and kept == edits[: len(kept)]:
                arrays = np.load(cache)
                start = trimesh.Trimesh(arrays["vertices"], arrays["faces"], process=False)
                done = len(kept)
        except (OSError, ValueError, KeyError, TypeError):
            start, done = raw, 0  # a broken cache is only slower, never wrong
    result = apply_edits(start, edits[done:]) if done < len(edits) else start
    np.savez(cache, vertices=result.vertices, faces=result.faces)
    cache_edits.write_text(json.dumps({"raw": source, "edits": edits}), encoding="utf-8")
    return result


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

    up_axis = raw_up_axis(settings["engine"])
    edits = settings.get("edits", [])
    original = trimesh.load(raw_path, force="mesh")
    try:
        raw = edited_mesh(folder / "details", original, edits)
    except ValueError as error:
        raise AppError(
            f"The change could not be made: {error}", "Undo it and try a smaller area."
        ) from error
    mesh = to_z_up(raw, up_axis)
    for axis, turns in zip("xyz", settings["rotation"], strict=True):
        if turns % 4:
            mesh = rotate_90(mesh, axis, turns)

    # With edits the size comes from the model without them: making the top thicker must not
    # shrink the rest of the figure to keep the old height.
    reference = None
    if edits:
        upright = upright_matrix(up_axis, settings["rotation"])
        heights = (original.vertices @ upright[:3, :3].T)[:, 2]
        cut = float(settings["base_cut_pct"]) / 100.0
        reference = float(heights.max() - heights.min()) * (1.0 - cut)

    params = PrintParams(
        height_mm=float(settings["height_mm"]),
        up_axis="z",  # already turned upright above
        quality=settings["quality"],
        base_cut_fraction=float(settings["base_cut_pct"]) / 100.0,
        base_plate_mm=float(settings.get("base_plate_mm", 0.0)),
        reference_height=reference,
    )
    try:
        printed = prepare_for_print(mesh, params)
        if edits and not closed_one_part(printed.report):
            # An edit can press two sides of a thin part into each other. Rebuilding the
            # edited mesh from voxels makes it one closed solid again (as for broken AI output).
            rebuilt = voxel_remesh(mesh, QUALITY_PRESETS[params.quality][0])
            printed = prepare_for_print(rebuilt, params)
            printed.notes.append("the edited model was rebuilt to keep it closed")
            printed.report["notes"] = list(printed.notes)
    except ValueError as error:
        raise AppError(
            f"The model could not be prepared: {error}", "Try other settings."
        ) from error

    printed.report["to_stl"] = (
        printed.transform @ upright_matrix(up_axis, settings["rotation"])
    ).tolist()
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
