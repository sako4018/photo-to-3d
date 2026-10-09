import pytest
from PIL import Image

from photo3d_engine.cli import main
from photo3d_engine.layout import plan_outputs, project_folder, save_original


def make_photo(path, color):
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    image.paste(Image.new("RGBA", (80, 120), color), (60, 40))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    return path


def test_plan_for_a_stl_path_keeps_the_single_file_mode(tmp_path):
    photo = make_photo(tmp_path / "a.png", (200, 30, 30, 255))
    outputs = plan_outputs(photo, tmp_path / "x" / "model.stl", 50)
    assert outputs.folder is None and outputs.stl == tmp_path / "x" / "model.stl"
    assert outputs.details is None and outputs.report is None


def test_plan_for_a_folder_names_everything_after_the_photo(tmp_path):
    photo = make_photo(tmp_path / "teddy.png", (200, 30, 30, 255))
    outputs = plan_outputs(photo, tmp_path / "results", 60)
    assert outputs.folder == tmp_path / "results" / "teddy"
    assert outputs.stl == outputs.folder / "teddy_60mm.stl"
    assert outputs.details == outputs.folder / "details"
    assert outputs.report == outputs.folder / "report.txt"


def test_height_with_a_fraction_is_written_without_trailing_zeros(tmp_path):
    photo = make_photo(tmp_path / "a.png", (1, 2, 3, 255))
    assert plan_outputs(photo, tmp_path / "o", 42.5).stl.name == "a_42.5mm.stl"
    assert plan_outputs(photo, tmp_path / "o", 50.0).stl.name == "a_50mm.stl"


def test_default_base_folder_is_out_in_the_current_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    photo = make_photo(tmp_path / "cup.png", (9, 9, 9, 255))
    assert plan_outputs(photo, None, 50).folder.parts == ("out", "cup")


def test_same_photo_reuses_its_folder_but_a_different_one_gets_a_new_folder(tmp_path):
    base = tmp_path / "out"
    first = make_photo(tmp_path / "in1" / "cup.png", (200, 30, 30, 255))
    other = make_photo(tmp_path / "in2" / "cup.png", (30, 30, 200, 255))
    save_original(first, project_folder(base, first))

    assert project_folder(base, first) == base / "cup"  # same photo again
    assert project_folder(base, other) == base / "cup-2"  # same name, different picture
    save_original(other, project_folder(base, other))
    assert project_folder(base, other) == base / "cup-2"
    assert (base / "cup" / "original.png").read_bytes() == first.read_bytes()  # untouched


def test_save_original_keeps_the_extension_and_never_overwrites(tmp_path):
    photo = tmp_path / "IMG_0001.JPG"
    photo.write_bytes(b"first")
    target = save_original(photo, tmp_path / "f")
    assert target.name == "original.jpg" and target.read_bytes() == b"first"
    photo.write_bytes(b"second")
    assert save_original(photo, tmp_path / "f").read_bytes() == b"first"


def test_cli_makes_a_folder_with_the_original_the_stl_and_a_report(tmp_path, capsys):
    photo = make_photo(tmp_path / "фигурка с интервал.png", (200, 30, 30, 255))
    code = main(
        ["make", str(photo), "--out", str(tmp_path / "results"), "--engine", "dummy"]
        + ["--quality", "fast", "--height", "40"]
    )
    folder = tmp_path / "results" / "фигурка с интервал"
    shown = capsys.readouterr().out

    assert code == 0
    assert (folder / "original.png").read_bytes() == photo.read_bytes()
    assert (folder / "фигурка с интервал_40mm.stl").stat().st_size > 1000
    assert "watertight : yes" in (folder / "report.txt").read_text(encoding="utf-8")
    assert (folder / "details" / "raw.glb").exists()
    assert (folder / "details" / "input_rgba.png").exists()
    assert f"Folder: {folder}" in shown


def test_cli_without_out_uses_out_in_the_current_folder(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    photo = make_photo(tmp_path / "cup.png", (200, 30, 30, 255))
    assert main(["make", str(photo), "--engine", "dummy", "--quality", "fast"]) == 0
    assert (tmp_path / "out" / "cup" / "original.png").exists()
    assert (tmp_path / "out" / "cup" / "cup_50mm.stl").exists()


def test_cli_second_height_goes_next_to_the_first_in_the_same_folder(tmp_path):
    photo = make_photo(tmp_path / "cup.png", (200, 30, 30, 255))
    base = ["make", str(photo), "--out", str(tmp_path / "o"), "--engine", "dummy"]
    assert main(base + ["--quality", "fast", "--height", "30"]) == 0
    assert main(base + ["--quality", "fast", "--height", "70"]) == 0
    names = sorted(p.name for p in (tmp_path / "o" / "cup").glob("*.stl"))
    assert names == ["cup_30mm.stl", "cup_70mm.stl"]


def test_cli_missing_photo_creates_no_folder(tmp_path, capsys):
    code = main(
        ["make", str(tmp_path / "ghost.jpg"), "--out", str(tmp_path / "o")] + ["--engine", "dummy"]
    )
    assert code == 1 and "Error:" in capsys.readouterr().err
    assert not (tmp_path / "o").exists()


@pytest.mark.parametrize("bad", ["x.txt"])
def test_cli_unsupported_file_type_is_an_error_not_a_crash(tmp_path, bad, capsys):
    path = tmp_path / bad
    path.write_text("hi")
    assert main(["make", str(path), "--out", str(tmp_path / "o"), "--engine", "dummy"]) == 1
