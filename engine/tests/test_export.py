import struct

import pytest
import trimesh

from photo3d_engine.export.stl import write_stl
from photo3d_engine.print_prep.pipeline import PrintParams, prepare_for_print


def test_stl_is_binary_and_has_the_right_size(tmp_path, sphere):
    path = write_stl(sphere, tmp_path / "ball.stl")
    data = path.read_bytes()
    (triangle_count,) = struct.unpack("<I", data[80:84])
    assert triangle_count == len(sphere.faces)
    assert len(data) == 84 + 50 * triangle_count  # binary STL layout


def test_stl_creates_missing_folders(tmp_path, sphere):
    path = write_stl(sphere, tmp_path / "a" / "b" / "ball.stl")
    assert path.exists()


def test_stl_works_with_spaces_and_cyrillic_in_the_path(tmp_path, sphere):
    folder = tmp_path / "моят модел с интервали"
    path = write_stl(sphere, folder / "топка 1.stl")
    assert trimesh.load(path).is_watertight


def test_print_ready_stl_round_trip_keeps_millimetres(tmp_path, overlapping_balls):
    result = prepare_for_print(
        overlapping_balls, PrintParams(height_mm=35, up_axis="z", quality="fast")
    )
    path = write_stl(result.mesh, tmp_path / "out.stl")

    loaded = trimesh.load(path)
    assert loaded.is_watertight
    assert loaded.is_winding_consistent
    assert loaded.volume > 0
    assert loaded.bounds[0][2] == pytest.approx(0, abs=1e-3)
    assert loaded.extents[2] == pytest.approx(35, rel=0.005)
    assert loaded.volume == pytest.approx(result.mesh.volume, rel=1e-3)
