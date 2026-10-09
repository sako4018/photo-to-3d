"""Photo in, print-ready STL out. The one function the CLI (and later the server) calls."""

from __future__ import annotations

import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import trimesh

from .engines.base import CancelFn, Engine, ProgressFn
from .engines.registry import DEFAULT_ENGINE, get_engine
from .export.stl import write_stl
from .platform.devices import free_device_memory, pick_device
from .preprocess.background import release_session
from .preprocess.prepare import prepare_image
from .print_prep.pipeline import QUALITY_PRESETS, PrintParams, prepare_for_print


def peak_memory_gb() -> float:
    """Highest memory use of this process so far, in GB (0.0 if the OS does not tell)."""
    try:
        import resource  # macOS and Linux

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes, Linux kilobytes
        return peak / 1e9 if sys.platform == "darwin" else peak / 1e6
    except ImportError:
        import psutil  # Windows

        info = psutil.Process().memory_info()
        return getattr(info, "peak_wset", info.rss) / 1e9


@dataclass
class MakeResult:
    stl_path: Path
    report: dict
    timings: dict[str, float]
    notes: list[str] = field(default_factory=list)
    device: str = "cpu"
    engine: str = ""
    peak_ram_gb: float = 0.0


def make_stl(
    image_path: Path,
    out_path: Path,
    *,
    height_mm: float = 50.0,
    quality: str = "normal",
    device: str = "auto",
    engine_id: str = DEFAULT_ENGINE,
    remove_bg: bool = True,
    work_dir: Path | None = None,
    progress: ProgressFn | None = None,
    cancelled: CancelFn | None = None,
    engine: Engine | None = None,
) -> MakeResult:
    """Run the whole chain and write a binary STL (millimetres, closed, flat base)."""
    if quality not in QUALITY_PRESETS:
        raise ValueError(f"Unknown quality {quality!r}, expected {list(QUALITY_PRESETS)}")
    image_path, out_path = Path(image_path), Path(out_path)
    if not image_path.is_file():
        raise FileNotFoundError(f"Image not found: {image_path}")

    progress = progress or (lambda stage, fraction: None)
    cancelled = cancelled or (lambda: False)
    engine = engine or get_engine(engine_id)
    if not engine.is_installed():
        raise RuntimeError(
            f"Model {engine.id!r} is not downloaded yet (it needs about 2 GB). Run: photo3d install"
        )
    resolved_device = pick_device(device)

    timings: dict[str, float] = {}

    def timed(name: str, started: float) -> None:
        timings[name] = round(time.perf_counter() - started, 2)

    with tempfile.TemporaryDirectory(prefix="photo3d_") as temp:
        work = Path(work_dir) if work_dir else Path(temp)
        work.mkdir(parents=True, exist_ok=True)

        started = time.perf_counter()
        progress("preprocess", 0.0)
        prepared = prepare_image(image_path, remove_bg=remove_bg)
        release_session()  # the background model is not needed again
        rgba_path = work / "input_rgba.png"
        prepared.save(rgba_path)
        timed("preprocess", started)

        started = time.perf_counter()
        progress("load_model", 0.0)
        engine.load(resolved_device)
        timed("load_model", started)

        try:
            started = time.perf_counter()
            raw_path = engine.run(rgba_path, work, {"quality": quality}, progress, cancelled)
            timed("generate", started)
        finally:
            engine.unload()
            free_device_memory(resolved_device)

        started = time.perf_counter()
        progress("print_prep", 0.0)
        raw = trimesh.load(raw_path, force="mesh")
        result = prepare_for_print(
            raw,
            PrintParams(height_mm=height_mm, up_axis=engine.up_axis, quality=quality),
        )
        timed("print_prep", started)
        for name, seconds in result.timings.items():
            timings[f"  {name}"] = seconds

        started = time.perf_counter()
        write_stl(result.mesh, out_path)
        timed("write_stl", started)
        progress("done", 1.0)

    return MakeResult(
        stl_path=out_path,
        report=result.report,
        timings=timings,
        notes=result.notes,
        device=resolved_device,
        engine=engine.id,
        peak_ram_gb=round(peak_memory_gb(), 2),
    )
