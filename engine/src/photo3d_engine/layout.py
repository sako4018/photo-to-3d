"""Where the results go: one folder per photo, holding the original and what was made from it.

out/
  teddy/
    original.jpg          the photo, copied untouched
    teddy_60mm.stl        the print-ready model
    report.txt            the printability report
    details/              cut-out photo and raw model (for checking, not for printing)
"""

from __future__ import annotations

import itertools
import shutil
from dataclasses import dataclass
from pathlib import Path

DEFAULT_BASE = Path("out")


@dataclass(frozen=True)
class Outputs:
    stl: Path
    folder: Path | None  # None when the user asked for one bare .stl file

    @property
    def details(self) -> Path | None:
        return self.folder / "details" if self.folder else None

    @property
    def report(self) -> Path | None:
        return self.folder / "report.txt" if self.folder else None


def project_folder(base: Path, image: Path) -> Path:
    """Folder for this photo. The same photo reuses its folder, a different photo with the
    same name gets `name-2`, `name-3`..., so one photo never overwrites another."""
    data = image.read_bytes()
    for number in itertools.count(1):
        name = image.stem if number == 1 else f"{image.stem}-{number}"
        folder = base / name
        originals = sorted(folder.glob("original.*")) if folder.is_dir() else []
        if not originals or originals[0].read_bytes() == data:
            return folder
    raise AssertionError("unreachable")  # itertools.count never ends


def plan_outputs(image: Path, out: Path | None, height_mm: float) -> Outputs:
    """`--out file.stl` keeps the old single-file behaviour, anything else is a base folder
    (default `out/`) in which a folder for this photo is made."""
    if out is not None and out.suffix.lower() == ".stl":
        return Outputs(stl=out, folder=None)
    folder = project_folder(out if out is not None else DEFAULT_BASE, image)
    return Outputs(stl=folder / f"{image.stem}_{height_mm:g}mm.stl", folder=folder)


def save_original(image: Path, folder: Path) -> Path:
    """Copy the photo into the project folder (kept with its own extension)."""
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"original{image.suffix.lower()}"
    if not target.exists():
        shutil.copy2(image, target)
    return target
