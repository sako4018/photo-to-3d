import pytest
import trimesh
from PIL import Image

from photo3d_engine.cli import main
from photo3d_engine.make import make_stl
from photo3d_engine.print_prep.repair import is_printable


@pytest.fixture
def cutout_png(tmp_path):
    """A red blob on a transparent canvas: counts as already cut out, so no background AI runs."""
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    image.paste(Image.new("RGBA", (80, 120), (200, 30, 30, 255)), (60, 40))
    path = tmp_path / "photo.png"
    image.save(path)
    return path


def test_make_stl_with_the_dummy_engine(tmp_path, cutout_png):
    out = tmp_path / "out" / "figure.stl"
    result = make_stl(cutout_png, out, height_mm=45, quality="fast", engine_id="dummy")

    assert out.exists()
    stl = trimesh.load(out)
    assert is_printable(stl)
    assert stl.extents[2] == pytest.approx(45, rel=0.005)
    assert stl.bounds[0][2] == pytest.approx(0, abs=1e-3)
    assert result.report["watertight"] and result.report["bodies"] == 1
    assert {"preprocess", "load_model", "generate", "print_prep", "write_stl"} <= set(
        result.timings
    )
    assert result.device in ("cpu", "mps", "cuda")
    assert result.peak_ram_gb > 0


def test_make_stl_reports_progress(tmp_path, cutout_png):
    seen = []
    make_stl(
        cutout_png,
        tmp_path / "a.stl",
        quality="fast",
        engine_id="dummy",
        progress=lambda stage, fraction: seen.append(stage),
    )
    assert seen[0] == "preprocess" and seen[-1] == "done"
    assert "generate" in seen


def test_make_stl_can_keep_the_work_files(tmp_path, cutout_png):
    work = tmp_path / "work"
    make_stl(cutout_png, tmp_path / "a.stl", quality="fast", engine_id="dummy", work_dir=work)
    assert (work / "raw.glb").exists()
    assert (work / "input_rgba.png").exists()


def test_make_stl_rejects_a_missing_photo(tmp_path):
    with pytest.raises(FileNotFoundError):
        make_stl(tmp_path / "nope.png", tmp_path / "a.stl", engine_id="dummy")


def test_make_stl_rejects_unknown_quality(tmp_path, cutout_png):
    with pytest.raises(ValueError):
        make_stl(cutout_png, tmp_path / "a.stl", quality="ultra", engine_id="dummy")


def test_make_stl_cancel_stops_before_any_output(tmp_path, cutout_png):
    from photo3d_engine.engines.base import Cancelled

    out = tmp_path / "a.stl"
    with pytest.raises(Cancelled):
        make_stl(cutout_png, out, quality="fast", engine_id="dummy", cancelled=lambda: True)
    assert not out.exists()


def test_cli_make_prints_a_report_and_writes_the_stl(tmp_path, cutout_png, capsys):
    out = tmp_path / "cli.stl"
    code = main(
        ["make", str(cutout_png), "--out", str(out), "--engine", "dummy", "--quality", "fast"]
        + ["--height", "40"]
    )
    shown = capsys.readouterr().out

    assert code == 0
    assert out.exists()
    assert "watertight : yes" in shown
    assert "size       : " in shown and "x 40.0 mm" in shown
    assert "PLA (est.)" in shown


def test_cli_make_works_with_cyrillic_and_spaces(tmp_path, cutout_png):
    folder = tmp_path / "моите модели"
    out = folder / "фигурка 1.stl"
    assert (
        main(
            ["make", str(cutout_png), "--out", str(out), "--engine", "dummy"]
            + ["--quality", "fast"]
        )
        == 0
    )
    assert out.exists()


def test_cli_make_says_what_is_wrong_for_a_missing_file(tmp_path, capsys):
    code = main(
        ["make", str(tmp_path / "ghost.jpg"), "--out", str(tmp_path / "a.stl")]
        + ["--engine", "dummy"]
    )
    assert code == 1
    assert "Error:" in capsys.readouterr().err


def test_cli_rejects_unknown_quality():
    with pytest.raises(SystemExit):
        main(["make", "x.png", "--out", "a.stl", "--quality", "ultra"])


def test_cli_install_is_a_noop_for_the_dummy_engine(capsys):
    assert main(["install", "--engine", "dummy"]) == 0
    assert "already downloaded" in capsys.readouterr().out


@pytest.mark.slow
def test_real_triposr_makes_a_printable_stl(tmp_path):
    from pathlib import Path

    from photo3d_engine.engines.registry import get_engine

    sample = Path(__file__).resolve().parents[2] / "samples" / "chair.png"
    if not get_engine("triposr").is_installed():
        pytest.skip("TripoSR weights are not downloaded")

    out = tmp_path / "chair.stl"
    result = make_stl(sample, out, height_mm=50, quality="fast", engine_id="triposr")
    stl = trimesh.load(out)
    assert is_printable(stl)
    assert stl.extents[2] == pytest.approx(50, rel=0.005)
    assert result.report["bodies"] == 1
