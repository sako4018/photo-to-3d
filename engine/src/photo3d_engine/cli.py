"""Command line: photo3d make photo.jpg --height 50   (results go to out/photo/)"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .engines.base import Cancelled
from .engines.registry import DEFAULT_ENGINE, engine_ids, get_engine
from .layout import plan_outputs, save_original
from .make import MakeResult, make_stl
from .platform.devices import VALID_DEVICES
from .print_prep.pipeline import QUALITY_PRESETS


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="photo3d", description="Turn a photo into a print-ready STL."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    make = commands.add_parser("make", help="photo -> STL")
    make.add_argument("image", type=Path, help="JPG, PNG, WEBP or HEIC photo")
    make.add_argument(
        "--out",
        type=Path,
        help="folder for the results (default: out/), a folder per photo is made inside. "
        "If it ends in .stl, only that one file is written",
    )
    make.add_argument("--height", type=float, default=50.0, help="model height in mm (default 50)")
    make.add_argument("--quality", choices=list(QUALITY_PRESETS), default="normal")
    make.add_argument("--device", choices=list(VALID_DEVICES), default="auto")
    make.add_argument(
        "--engine",
        choices=engine_ids(),
        default=DEFAULT_ENGINE,
        help="triposr: fast (~16 s); triposg: much more detailed (~2 min, 8 GB download)",
    )
    make.add_argument(
        "--plate",
        type=float,
        default=0.0,
        metavar="MM",
        help="add a flat plate this thick under the model (for models on thin legs)",
    )
    make.add_argument(
        "--no-remove-bg", action="store_true", help="the photo already has a cut-out background"
    )
    make.add_argument(
        "--keep-work",
        type=Path,
        help="only with --out file.stl: folder to keep the prepared input and raw.glb in",
    )

    install = commands.add_parser(
        "install", help="download the model weights (TripoSR 1.7 GB, TripoSG 7.9 GB)"
    )
    install.add_argument("--engine", choices=engine_ids(), default=DEFAULT_ENGINE)
    return parser


def format_result(result: MakeResult) -> str:
    report = result.report
    width, depth, height = report["size_mm"]
    grams = report["filament_g_estimate"]

    def check(ok: bool) -> str:
        return "yes" if ok else "NO"

    lines = [
        f"STL: {result.stl_path}",
        f"  watertight : {check(report['watertight'])}    manifold : {check(report['manifold'])}"
        f"    parts : {report['bodies']}",
        f"  size       : {width} x {depth} x {height} mm",
        f"  volume     : {report['volume_cm3']} cm3",
        f"  PLA (est.) : ~{grams['infill_15']} g at 15% infill, ~{grams['infill_100']} g solid",
        f"  triangles  : {report['triangles']}",
        f"  bed contact: {report.get('base_contact_mm2', 0):g} mm2",
        f"  engine     : {result.engine} on {result.device}",
        "  time (s)   : "
        + ", ".join(f"{name.strip()} {sec}" for name, sec in result.timings.items()),
        f"  peak RAM   : {result.peak_ram_gb} GB",
    ]
    lines += [f"  note       : {note}" for note in result.notes]
    return "\n".join(lines)


def run_make(args: argparse.Namespace) -> int:
    def show(stage: str, fraction: float) -> None:
        if fraction in (0.0, 1.0):
            print(f"  [{stage}] {'done' if fraction == 1.0 else 'start'}", file=sys.stderr)

    if not args.image.is_file():
        raise FileNotFoundError(f"Image not found: {args.image}")
    outputs = plan_outputs(args.image, args.out, args.height)
    if outputs.folder:
        save_original(args.image, outputs.folder)

    result = make_stl(
        args.image,
        outputs.stl,
        height_mm=args.height,
        quality=args.quality,
        device=args.device,
        engine_id=args.engine,
        remove_bg=not args.no_remove_bg,
        base_plate_mm=args.plate,
        work_dir=outputs.details or args.keep_work,
        progress=show,
    )
    text = format_result(result)
    if outputs.folder:
        outputs.report.write_text(text + "\n", encoding="utf-8")
        print(f"Folder: {outputs.folder}")
    print(text)
    if not result.report["watertight"]:
        print("WARNING: the STL is not watertight, a slicer may complain.", file=sys.stderr)
        return 2
    return 0


def run_install(args: argparse.Namespace) -> int:
    engine = get_engine(args.engine)
    if engine.is_installed():
        print(f"{engine.name} is already downloaded.")
        return 0
    print(
        f"Downloading {engine.name} ({engine.license} license, about {engine.download_gb:g} GB), "
        "this can take a while..."
    )
    engine.install(lambda stage, fraction: print(f"  {fraction:.0%}", file=sys.stderr))
    print("Done.")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "make":
            return run_make(args)
        return run_install(args)
    except Cancelled:
        print("Cancelled.", file=sys.stderr)
        return 130
    except (FileNotFoundError, ValueError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
