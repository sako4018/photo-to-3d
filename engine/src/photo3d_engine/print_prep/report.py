"""Printability report: is it closed, how big is it, how much filament does it need."""

from __future__ import annotations

import trimesh

PLA_DENSITY_G_CM3 = 1.24
# 3 perimeters of a 0.4 mm nozzle: the outer shell is always printed solid
SHELL_THICKNESS_MM = 1.2


def filament_grams(volume_mm3: float, area_mm2: float, infill: float) -> float:
    """Rough PLA weight: solid shell plus infill inside. A guess, not a slicer result."""
    volume_cm3 = volume_mm3 / 1000.0
    shell_cm3 = min(volume_cm3, area_mm2 * SHELL_THICKNESS_MM / 1000.0)
    printed_cm3 = shell_cm3 + (volume_cm3 - shell_cm3) * infill
    return printed_cm3 * PLA_DENSITY_G_CM3


def build_report(mesh: trimesh.Trimesh) -> dict:
    watertight = bool(mesh.is_watertight)
    consistent = bool(mesh.is_winding_consistent)
    volume_mm3 = abs(float(mesh.volume)) if watertight else 0.0
    area_mm2 = float(mesh.area)
    size = [round(float(v), 2) for v in mesh.extents]

    return {
        "watertight": watertight,
        "manifold": watertight and consistent,
        "bodies": len(mesh.split(only_watertight=False)),
        "size_mm": size,
        "volume_cm3": round(volume_mm3 / 1000.0, 2),
        "filament_g_estimate": {
            "infill_15": round(filament_grams(volume_mm3, area_mm2, 0.15), 1),
            "infill_100": round(filament_grams(volume_mm3, area_mm2, 1.0), 1),
        },
        "triangles": int(len(mesh.faces)),
    }
