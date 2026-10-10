import pytest
import trimesh

from photo3d_engine.engines.base import Cancelled
from photo3d_engine.engines.dummy import DummyEngine
from photo3d_engine.engines.registry import DEFAULT_ENGINE, engine_ids, get_engine, raw_up_axis


def test_registry_knows_the_engines():
    assert "dummy" in engine_ids()
    assert DEFAULT_ENGINE == "triposg"
    assert engine_ids() == ["dummy", "triposg"]
    assert get_engine("dummy").id == "dummy"


def test_projects_saved_with_triposr_now_use_triposg():
    assert get_engine("triposr").id == "triposg"
    assert "triposr" not in engine_ids()  # cannot be picked for new work
    # but its old raw meshes still stand up the right way
    assert raw_up_axis("triposr") == "z" and raw_up_axis("triposg") == "y"


def test_registry_rejects_unknown_engine():
    with pytest.raises(ValueError, match="nope"):
        get_engine("nope")


def test_dummy_engine_writes_a_glb_and_reports_progress(tmp_path):
    engine = DummyEngine()
    engine.load("cpu")
    steps = []
    out = engine.run(
        tmp_path / "x.png", tmp_path / "work", {}, lambda s, p: steps.append((s, p)), lambda: False
    )
    engine.unload()

    assert out.name == "raw.glb" and out.exists()
    mesh = trimesh.load(out, force="mesh")
    assert len(mesh.faces) > 100
    assert steps[0] == ("generate", 0.0) and steps[-1] == ("generate", 1.0)


def test_dummy_engine_honours_cancel(tmp_path):
    engine = DummyEngine()
    engine.load("cpu")
    with pytest.raises(Cancelled):
        engine.run(tmp_path / "x.png", tmp_path, {}, lambda *_: None, lambda: True)


def test_dummy_figure_stands_along_y():
    from photo3d_engine.engines.dummy import build_figure

    figure = build_figure()
    assert figure.extents[1] > figure.extents[0]
    assert figure.extents[1] > figure.extents[2]
