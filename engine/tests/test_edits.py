import numpy as np
import pytest
import trimesh

from photo3d_engine.print_prep.edits import apply_edits, falloff, raw_scale, to_raw
from photo3d_engine.print_prep.pipeline import PrintParams, prepare_for_print


def noisy_sphere() -> trimesh.Trimesh:
    sphere = trimesh.creation.icosphere(subdivisions=4, radius=10)
    bumps = np.random.default_rng(1).normal(0, 0.4, len(sphere.vertices))
    sphere.vertices += sphere.vertex_normals * bumps[:, None]
    return sphere


def roughness(mesh, center, radius) -> float:
    """Spread of the distances from the centre of the sphere, inside the picked area."""
    near = np.linalg.norm(mesh.vertices - center, axis=1) < radius
    return float(np.std(np.linalg.norm(mesh.vertices[near], axis=1)))


def test_falloff_is_one_in_the_middle_and_zero_outside():
    mesh = trimesh.Trimesh([[0, 0, 0], [0.9, 0, 0], [1.5, 0, 0], [3, 0, 0]], [[0, 1, 2], [1, 2, 3]])
    weight = falloff(mesh, [0, 0, 0], 2.0)
    assert weight[0] == 1 and weight[1] == 1 and 0 < weight[2] < 1 and weight[3] == 0


def test_smooth_only_changes_the_picked_part():
    mesh = noisy_sphere()
    top, bottom = np.array([0, 0, 10.0]), np.array([0, 0, -10.0])
    smoothed = apply_edits(
        mesh, [{"op": "smooth", "center": top.tolist(), "radius": 5, "strength": 3}]
    )
    assert roughness(smoothed, top, 3) < roughness(mesh, top, 3) / 3
    assert roughness(smoothed, bottom, 4) == pytest.approx(roughness(mesh, bottom, 4), rel=0.01)
    assert smoothed.is_watertight


def test_thicker_and_thinner_move_the_surface_out_and_in():
    mesh = trimesh.creation.icosphere(subdivisions=4, radius=10)
    top = [0, 0, 10.0]
    thick = apply_edits(mesh, [{"op": "thicker", "center": top, "radius": 6, "amount": 1.5}])
    thin = apply_edits(mesh, [{"op": "thinner", "center": top, "radius": 6, "amount": 1.5}])
    assert thick.bounds[1][2] == pytest.approx(11.5, abs=0.3)
    assert thin.bounds[1][2] == pytest.approx(8.5, abs=0.3)
    assert thick.bounds[0][2] == pytest.approx(-10, abs=0.01)  # the other side stays


def test_remove_cuts_a_part_and_the_pipeline_closes_it_again():
    body = trimesh.creation.icosphere(subdivisions=3, radius=10)
    bump = trimesh.creation.icosphere(subdivisions=3, radius=3)
    bump.apply_translation([0, 0, 12])
    figure = trimesh.util.concatenate([body, bump])
    cut = apply_edits(figure, [{"op": "remove", "center": [0, 0, 12], "radius": 4}])
    printed = prepare_for_print(cut, PrintParams(height_mm=40, up_axis="z", quality="fast"))
    assert printed.report["watertight"] and printed.report["bodies"] == 1
    assert cut.bounds[1][2] < 11  # the bump is gone


def test_remove_refuses_to_delete_everything():
    with pytest.raises(ValueError):
        apply_edits(
            trimesh.creation.icosphere(), [{"op": "remove", "center": [0, 0, 0], "radius": 50}]
        )


def test_a_point_picked_on_the_stl_maps_back_to_the_raw_mesh():
    raw = trimesh.creation.capsule(height=1.0, radius=0.3)  # along Z, like an upright figure
    raw.apply_translation([0.2, -0.1, 0.4])
    printed = prepare_for_print(
        raw, PrintParams(height_mm=60, up_axis="z", quality="fast", base_plate_mm=2)
    )
    to_stl = printed.transform.tolist()
    # the top of the printed model must come back to the top of the raw mesh
    top_stl = printed.mesh.vertices[np.argmax(printed.mesh.vertices[:, 2])]
    point, radius = to_raw(to_stl, top_stl, 6.0)
    assert point[2] == pytest.approx(raw.bounds[1][2], abs=0.02)
    assert radius == pytest.approx(6.0 / raw_scale(to_stl))
    assert raw_scale(to_stl) == pytest.approx(60 / (raw.extents[2] * 0.98), rel=0.01)


def test_edits_work_on_big_flat_triangles_too():
    # a cylinder side is a few long triangles: no corner near the middle of the side
    can = trimesh.creation.cylinder(radius=8, height=40, sections=24)
    middle = [8.0, 0.0, 0.0]
    assert np.linalg.norm(can.vertices - middle, axis=1).min() > 5
    thick = apply_edits(can, [{"op": "thicker", "center": middle, "radius": 5, "amount": 2}])
    assert thick.bounds[1][0] == pytest.approx(10, abs=0.3)
    assert thick.bounds[1][2] == pytest.approx(20, abs=0.01)  # the ends stay where they were
