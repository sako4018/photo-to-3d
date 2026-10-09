import numpy as np
import pytest
import trimesh

from photo3d_engine.engines.dummy import DummyEngine
from photo3d_engine.print_prep.base_cut import NotManifoldError, cut_base
from photo3d_engine.print_prep.islands import remove_islands
from photo3d_engine.print_prep.orient import rotate_90, to_z_up
from photo3d_engine.print_prep.pipeline import PrintParams, prepare_for_print
from photo3d_engine.print_prep.repair import is_printable, repair
from photo3d_engine.print_prep.report import build_report
from photo3d_engine.print_prep.scale import place_on_bed, scale_to_height
from photo3d_engine.print_prep.simplify import simplify
from photo3d_engine.print_prep.voxel_remesh import voxel_remesh


def assert_print_ready(mesh: trimesh.Trimesh, height_mm: float) -> None:
    assert is_printable(mesh)
    assert mesh.bounds[0][2] == pytest.approx(0.0, abs=1e-4)
    assert mesh.extents[2] == pytest.approx(height_mm, rel=0.005)
    assert len(mesh.split(only_watertight=False)) == 1


# ---------- repair ----------


def test_broken_fixtures_really_are_broken(sphere_small_hole, sphere_big_hole, sphere_flipped):
    assert not sphere_small_hole.is_watertight
    assert not sphere_big_hole.is_watertight
    assert not sphere_flipped.is_winding_consistent


def test_repair_fills_small_hole(sphere_small_hole):
    assert is_printable(repair(sphere_small_hole))


def test_repair_fills_a_big_hole_into_a_solid(sphere_big_hole):
    fixed = repair(sphere_big_hole)
    assert is_printable(fixed)
    # sphere of radius 10 cut at z~5.7: about 3500 mm3, clearly not a hollow shell
    assert fixed.volume == pytest.approx(3500, rel=0.1)


def test_repair_fills_several_separate_holes(sphere):
    middle_only = (sphere.triangles_center[:, 2] < 7) & (sphere.triangles_center[:, 2] > -7)
    two_holes = trimesh.Trimesh(sphere.vertices, sphere.faces[middle_only], process=False)
    assert not two_holes.is_watertight
    assert is_printable(repair(two_holes))


def test_repair_fixes_flipped_normals(sphere_flipped):
    fixed = repair(sphere_flipped)
    assert is_printable(fixed)
    assert fixed.volume > 0


def test_repair_fixes_fully_inverted_mesh(sphere):
    inverted = sphere.copy()
    inverted.invert()
    assert inverted.volume < 0
    assert repair(inverted).volume > 0


def test_repair_does_not_change_input(sphere_small_hole):
    before = len(sphere_small_hole.faces)
    repair(sphere_small_hole)
    assert len(sphere_small_hole.faces) == before


# ---------- islands ----------


def test_remove_islands_drops_the_speck(ball_with_island):
    cleaned, removed = remove_islands(ball_with_island)
    assert removed == 1
    assert len(cleaned.split(only_watertight=False)) == 1
    assert cleaned.extents.max() < 25  # the speck at x=40 is gone


def test_remove_islands_keeps_big_parts(overlapping_balls):
    cleaned, removed = remove_islands(overlapping_balls)
    assert removed == 0
    assert len(cleaned.faces) == len(overlapping_balls.faces)


# ---------- voxel remesh ----------


def test_voxel_remesh_turns_a_small_hole_into_a_solid(sphere_small_hole, sphere):
    result = voxel_remesh(sphere_small_hole, resolution=96)
    assert is_printable(result)
    assert result.volume == pytest.approx(sphere.volume, rel=0.1)


def test_voxel_remesh_ignores_vertices_no_face_uses(sphere_big_hole):
    # the fixture still holds the vertices of the removed cap. They must not count as surface.
    assert len(sphere_big_hole.vertices) > len(np.unique(sphere_big_hole.faces))
    result = voxel_remesh(sphere_big_hole, resolution=96)
    assert result.bounds[1][2] < 8  # the cap was at z up to 10, the mesh itself ends at ~5.7


def test_voxel_remesh_always_returns_a_closed_mesh_even_for_a_huge_opening(sphere_big_hole):
    # a very big opening gives a closed but hollow thin shell, that is the documented limit
    result = voxel_remesh(sphere_big_hole, resolution=96)
    assert is_printable(result)


def test_voxel_remesh_merges_overlapping_balls(overlapping_balls):
    result = voxel_remesh(overlapping_balls, resolution=96)
    assert is_printable(result)
    assert len(result.split(only_watertight=False)) == 1
    # union is smaller than the sum of both balls
    assert result.volume < overlapping_balls.volume


def test_voxel_remesh_keeps_size(sphere):
    result = voxel_remesh(sphere, resolution=96)
    assert result.extents == pytest.approx(sphere.extents, rel=0.1)


def test_voxel_remesh_rejects_tiny_resolution(sphere):
    with pytest.raises(ValueError):
        voxel_remesh(sphere, resolution=4)


# ---------- orient / scale / place ----------


def test_to_z_up_turns_y_into_z():
    tall_in_y = trimesh.creation.box(extents=[10, 50, 20])
    result = to_z_up(tall_in_y, "y")
    assert result.extents == pytest.approx([10, 20, 50])


def test_to_z_up_keeps_z_models():
    tall_in_z = trimesh.creation.box(extents=[10, 20, 50])
    assert to_z_up(tall_in_z, "z").extents == pytest.approx([10, 20, 50])


def test_to_z_up_rejects_bad_axis(sphere):
    with pytest.raises(ValueError):
        to_z_up(sphere, "x")


def test_to_z_up_keeps_the_mesh_closed(sphere):
    assert is_printable(to_z_up(sphere, "y"))


def test_rotate_90_swaps_extents():
    box = trimesh.creation.box(extents=[10, 20, 50])
    assert rotate_90(box, "x").extents == pytest.approx([10, 50, 20])


def test_scale_to_height_gives_exact_millimetres(sphere):
    result = scale_to_height(sphere, 50)
    assert result.extents[2] == pytest.approx(50)
    assert result.extents[0] == pytest.approx(50)  # uniform scale keeps proportions


def test_scale_to_height_rejects_bad_values(sphere):
    with pytest.raises(ValueError):
        scale_to_height(sphere, 0)


def test_place_on_bed_centres_and_grounds(sphere):
    moved = sphere.copy()
    moved.apply_translation([100, -30, 17])
    placed = place_on_bed(moved)
    assert placed.bounds[0][2] == pytest.approx(0)
    assert (placed.bounds[0][:2] + placed.bounds[1][:2]) / 2 == pytest.approx([0, 0], abs=1e-6)


# ---------- base cut ----------


def test_cut_base_makes_a_flat_closed_bottom(sphere):
    low = sphere.bounds[0][2]
    cut = cut_base(sphere, 0.1)
    assert cut.is_watertight
    expected_bottom = low + sphere.extents[2] * 0.1
    assert cut.bounds[0][2] == pytest.approx(expected_bottom, abs=1e-3)
    assert cut.extents[2] == pytest.approx(sphere.extents[2] * 0.9, rel=1e-3)
    # a flat bottom: many vertices lie exactly on the lowest plane
    on_floor = np.isclose(cut.vertices[:, 2], cut.bounds[0][2], atol=1e-4).sum()
    assert on_floor >= 3


def test_cut_base_zero_changes_nothing(sphere):
    assert len(cut_base(sphere, 0).faces) == len(sphere.faces)


def test_cut_base_refuses_open_mesh(sphere_big_hole):
    with pytest.raises(NotManifoldError):
        cut_base(sphere_big_hole, 0.05)


def test_cut_base_rejects_silly_fraction(sphere):
    with pytest.raises(ValueError):
        cut_base(sphere, 0.9)


# ---------- simplify ----------


def test_simplify_reduces_and_stays_closed():
    dense = trimesh.creation.icosphere(subdivisions=5, radius=10)
    result = simplify(dense, 2000)
    assert len(result.faces) < len(dense.faces) / 3
    assert abs(len(result.faces) - 2000) < 600
    assert is_printable(result)
    assert result.volume == pytest.approx(dense.volume, rel=0.05)


def test_simplify_leaves_small_meshes_alone(sphere):
    assert len(simplify(sphere, 10_000).faces) == len(sphere.faces)


# ---------- report ----------


def test_report_for_a_10mm_cube():
    cube = trimesh.creation.box(extents=[10, 10, 10])
    report = build_report(cube)
    assert report["watertight"] and report["manifold"]
    assert report["bodies"] == 1
    assert report["size_mm"] == [10.0, 10.0, 10.0]
    assert report["volume_cm3"] == 1.0
    assert report["filament_g_estimate"]["infill_100"] == pytest.approx(1.2, abs=0.1)
    assert report["filament_g_estimate"]["infill_15"] < report["filament_g_estimate"]["infill_100"]
    assert report["triangles"] == 12


def test_report_flags_an_open_mesh(sphere_big_hole):
    report = build_report(sphere_big_hole)
    assert report["watertight"] is False
    assert report["manifold"] is False
    assert report["volume_cm3"] == 0


# ---------- whole pipeline ----------


def test_pipeline_end_to_end_with_dummy_engine(tmp_path):
    engine = DummyEngine()
    engine.load("cpu")
    raw_path = engine.run(tmp_path / "in.png", tmp_path, {}, lambda *_: None, lambda: False)
    raw = trimesh.load(raw_path, force="mesh")
    assert len(raw.split(only_watertight=False)) > 1  # the raw figure is several parts

    result = prepare_for_print(
        raw, PrintParams(height_mm=50, up_axis=engine.up_axis, quality="fast")
    )
    assert_print_ready(result.mesh, 50)
    assert result.report["watertight"] and result.report["bodies"] == 1
    assert set(result.timings) >= {"repair", "orient", "base_cut", "scale", "simplify", "report"}
    assert result.mesh.extents[2] > result.mesh.extents[0]  # the figure stands up


@pytest.mark.parametrize(
    "fixture_name",
    [
        "sphere_small_hole",
        "sphere_big_hole",
        "sphere_flipped",
        "overlapping_balls",
        "ball_with_island",
    ],
)
def test_pipeline_fixes_every_broken_mesh(request, fixture_name):
    broken = request.getfixturevalue(fixture_name)
    result = prepare_for_print(broken, PrintParams(height_mm=40, up_axis="z", quality="fast"))
    assert_print_ready(result.mesh, 40)


def test_pipeline_gives_a_solid_for_a_big_hole_not_a_hollow_shell(sphere_big_hole):
    result = prepare_for_print(
        sphere_big_hole, PrintParams(height_mm=40, up_axis="z", quality="fast")
    )
    width, depth, height = result.mesh.extents
    # a solid truncated ball fills a good part of its bounding box, a thin shell would be ~1%
    assert result.mesh.volume > 0.3 * width * depth * height
    assert result.notes == [] or all("voxel" not in n for n in result.notes)


def test_pipeline_merges_overlapping_parts_and_says_so(overlapping_balls):
    result = prepare_for_print(overlapping_balls, PrintParams(up_axis="z", quality="fast"))
    assert any("2 separate parts" in n for n in result.notes)
    assert result.report["bodies"] == 1


def test_pipeline_does_not_change_the_input(sphere_flipped):
    before = sphere_flipped.vertices.copy()
    prepare_for_print(sphere_flipped, PrintParams(quality="fast", up_axis="z"))
    assert np.array_equal(before, sphere_flipped.vertices)


def test_pipeline_respects_target_faces():
    dense = trimesh.creation.icosphere(subdivisions=5, radius=10)
    result = prepare_for_print(dense, PrintParams(quality="fast", up_axis="z", target_faces=3000))
    assert len(result.mesh.faces) < 5000


def test_pipeline_rejects_unknown_quality(sphere):
    with pytest.raises(ValueError):
        prepare_for_print(sphere, PrintParams(quality="ultra"))


def test_pipeline_retries_simplification_with_a_gentler_setting(sphere, monkeypatch):
    from photo3d_engine.print_prep import pipeline

    real_simplify = pipeline.simplify
    calls = []

    def flaky(mesh, target_faces, aggressiveness=7):
        calls.append(aggressiveness)
        if aggressiveness == 7:  # pretend the default setting pinches the mesh
            return trimesh.Trimesh(mesh.vertices, mesh.faces[:-2], process=False)  # now open
        return real_simplify(mesh, target_faces, aggressiveness)

    monkeypatch.setattr(pipeline, "simplify", flaky)
    result = prepare_for_print(sphere, PrintParams(up_axis="z", quality="fast", target_faces=500))

    assert calls[:2] == [7, 3]
    assert is_printable(result.mesh)
    assert any("gentler setting (3)" in n for n in result.notes)


def test_pipeline_keeps_the_full_mesh_if_every_simplification_breaks_it(sphere, monkeypatch):
    from photo3d_engine.print_prep import pipeline

    def always_broken(mesh, target_faces, aggressiveness=7):
        return trimesh.Trimesh(mesh.vertices, mesh.faces[:-2], process=False)

    monkeypatch.setattr(pipeline, "simplify", always_broken)
    result = prepare_for_print(sphere, PrintParams(up_axis="z", quality="fast", target_faces=500))

    assert is_printable(result.mesh)
    assert any("kept the full-detail version" in n for n in result.notes)
