import json

import pytest
import trimesh
from PIL import UnidentifiedImageError

from photo3d_engine.engines import registry
from photo3d_engine.jobs import JobManager, overall_progress
from photo3d_engine.print_prep.repair import is_printable
from photo3d_engine.projects import ProjectStore
from photo3d_engine.reprint import reprint


@pytest.fixture
def setup(tmp_path):
    data = tmp_path / "data"
    store = ProjectStore(data)
    events = []
    jobs = JobManager(store, data, on_event=events.append)
    yield store, jobs, events, data
    jobs.shutdown()


def project_with_photo(store, photo_bytes, **settings):
    project = store.create(
        "figure", {"engine": "dummy", "remove_bg": False, "quality": "fast", **settings}
    )
    store.save_input(project["id"], "photo.png", photo_bytes)
    return project["id"]


def test_a_job_makes_a_print_ready_stl(setup, photo_bytes):
    store, jobs, events, _ = setup
    project_id = project_with_photo(store, photo_bytes, height_mm=45, quality="fast")

    job = jobs.wait(jobs.submit(project_id)["id"])

    assert job["status"] == "done" and job["progress"] == 1.0
    project = store.get(project_id)
    folder = store.folder(project_id)
    assert project["status"] == "ready" and project["last_job"] == job["id"]
    assert project["outputs"]["stl"] == "figure_45mm.stl"
    stl = trimesh.load(folder / "figure_45mm.stl")
    assert is_printable(stl) and stl.extents[2] == pytest.approx(45, rel=0.005)
    assert (folder / "details" / "raw.glb").is_file()
    assert (folder / "report.txt").is_file() and (folder / "report.json").is_file()
    assert project["report"]["watertight"] is True


def test_the_first_job_already_uses_rotation_base_cut_and_plate(setup, photo_bytes):
    store, jobs, _, _ = setup
    plain = project_with_photo(store, photo_bytes, height_mm=40)
    turned = project_with_photo(
        store, photo_bytes, height_mm=40, rotation=[1, 0, 0], base_cut_pct=5, base_plate_mm=2
    )
    for project_id in (plain, turned):
        assert jobs.wait(jobs.submit(project_id)["id"])["status"] == "done"

    def size(project_id):
        return store.get(project_id)["report"]["size_mm"]

    assert size(turned)[2] == pytest.approx(42, abs=0.3)  # 40 mm model + 2 mm plate
    assert size(turned)[1] != pytest.approx(size(plain)[1], abs=0.5)  # lying on its side
    assert any("base plate" in note for note in store.get(turned)["report"]["notes"])


def test_a_project_saved_with_triposr_keeps_working(setup, photo_bytes, monkeypatch):
    store, jobs, _, _ = setup
    project_id = project_with_photo(store, photo_bytes, height_mm=45)
    assert jobs.wait(jobs.submit(project_id)["id"])["status"] == "done"
    folder = store.folder(project_id)

    # an old project: its raw.glb came from TripoSR, which had z up (the dummy has y up)
    old = store.update(project_id, settings={"engine": "triposr"})
    result, _ = reprint(folder, old)
    width, depth, height = result.report["size_mm"]
    assert height == pytest.approx(45, abs=0.3)
    assert max(width, depth) > height  # read as z-up, the y-up figure lies down: axis kept

    # a new job runs the replacement engine and records it, so later reprints use its axis
    monkeypatch.setitem(registry.RETIRED, "triposr", "dummy")  # the fast stand-in for TripoSG
    assert jobs.wait(jobs.submit(project_id)["id"])["status"] == "done"
    assert store.get(project_id)["settings"]["engine"] == "dummy"


def test_progress_only_goes_forward_and_ends_with_done(setup, photo_bytes):
    store, jobs, events, _ = setup
    job = jobs.submit(project_with_photo(store, photo_bytes))
    jobs.wait(job["id"])
    values = [e["job"]["progress"] for e in events]
    assert values == sorted(values) and values[-1] == 1.0
    assert {e["job"]["stage"] for e in events} >= {"preprocess", "generate", "print_prep", "done"}
    assert all(e["type"] == "job" for e in events)


def test_overall_progress_maps_stages_to_one_scale():
    assert overall_progress("preprocess", 0.0) == ("preprocess", 0.0)
    assert overall_progress("generate", 0.5) == ("generate", 0.5)
    assert overall_progress("done", 1.0) == ("save", 1.0)
    assert overall_progress("generate", 7)[1] == 0.8  # clamped


def test_a_job_needs_a_photo(setup):
    store, jobs, _, _ = setup
    project = store.create("empty")
    with pytest.raises(Exception) as error:
        jobs.submit(project["id"])
    assert error.value.status == 409 and error.value.hint


def test_options_change_the_settings_and_bad_ones_are_refused(setup, photo_bytes):
    store, jobs, _, _ = setup
    project_id = project_with_photo(store, photo_bytes)
    jobs.wait(jobs.submit(project_id, {"height_mm": 33, "quality": "fast"})["id"])
    assert store.get(project_id)["settings"]["height_mm"] == 33
    with pytest.raises(Exception) as error:
        jobs.submit(project_id, {"quality": "ultra"})
    assert error.value.status == 422


def test_two_jobs_run_one_after_the_other(setup, photo_bytes, gate):
    store, jobs, _, _ = setup
    first = jobs.submit(project_with_photo(store, photo_bytes, engine="slow"))
    second = jobs.submit(project_with_photo(store, photo_bytes, engine="slow"))
    for _ in range(200):
        if jobs.get(first["id"])["status"] == "running":
            break
        gate.wait(0.01)
    assert jobs.get(first["id"])["status"] == "running"
    assert jobs.get(second["id"])["status"] == "queued"
    gate.set()
    assert jobs.wait(first["id"])["status"] == "done"
    assert jobs.wait(second["id"])["status"] == "done"


def test_cancel_a_queued_job(setup, photo_bytes, gate):
    store, jobs, _, _ = setup
    first = jobs.submit(project_with_photo(store, photo_bytes, engine="slow"))
    queued = jobs.submit(project_with_photo(store, photo_bytes, engine="slow"))
    assert jobs.cancel(queued["id"])["status"] == "cancelled"
    gate.set()
    jobs.wait(first["id"])
    assert jobs.get(queued["id"])["status"] == "cancelled"


def test_cancel_a_running_job_leaves_no_result(setup, photo_bytes, gate):
    store, jobs, _, _ = setup
    project_id = project_with_photo(store, photo_bytes, engine="slow")
    job = jobs.submit(project_id)
    for _ in range(200):
        if jobs.get(job["id"])["stage"] == "generate":
            break
        gate.wait(0.01)
    jobs.cancel(job["id"])
    assert jobs.wait(job["id"])["status"] == "cancelled"
    assert store.get(project_id)["outputs"] == {} and store.get(project_id)["status"] == "empty"


def test_the_worker_survives_a_failed_job(setup, photo_bytes):
    store, jobs, _, _ = setup
    broken = project_with_photo(store, photo_bytes)
    (store.folder(broken) / "original.png").unlink()  # the photo vanished
    failed = jobs.wait(jobs.submit(broken)["id"])
    assert failed["status"] == "error" and failed["error"]["error"] and failed["error"]["hint"]
    assert store.get(broken)["status"] == "error"

    fine = jobs.wait(jobs.submit(project_with_photo(store, photo_bytes))["id"])
    assert fine["status"] == "done"


def test_a_model_that_is_not_downloaded_gives_a_helpful_error(setup, photo_bytes, monkeypatch):
    from photo3d_engine.engines.dummy import DummyEngine

    monkeypatch.setattr(DummyEngine, "is_installed", lambda self: False)
    store, jobs, _, _ = setup
    job = jobs.wait(jobs.submit(project_with_photo(store, photo_bytes))["id"])
    assert job["status"] == "error" and "photo3d install" in job["error"]["error"]


def test_a_job_that_was_running_at_shutdown_is_marked_interrupted(tmp_path):
    data = tmp_path / "data"
    store = ProjectStore(data)
    jobs_folder = data / "jobs"
    jobs_folder.mkdir()
    stale = {"id": "j-deadbeef", "project_id": "x", "status": "running", "progress": 0.4}
    (jobs_folder / "j-deadbeef.json").write_text(json.dumps(stale))

    manager = JobManager(store, data)
    try:
        job = manager.get("j-deadbeef")
        assert job["status"] == "interrupted" and job["error"]["hint"]
    finally:
        manager.shutdown()


def test_unknown_job(setup):
    _, jobs, _, _ = setup
    with pytest.raises(Exception) as error:
        jobs.get("j-nope")
    assert error.value.status == 404


@pytest.mark.parametrize(
    ("error", "expected", "hint"),
    [
        (MemoryError("x"), "ran out of memory", "Fast detail"),
        (
            RuntimeError("MPS backend out of memory (MPS allocated: 9 GB)"),
            "ran out of memory",
            "Fast",
        ),
        (
            ValueError("No subject found in the image (it is fully transparent)"),
            "No object found",
            "one clear object",
        ),
        (UnidentifiedImageError("cannot identify image file"), "could not be read", "JPG or PNG"),
        (FileNotFoundError("original.png is missing"), "original.png", "Add the photo"),
        (KeyError("boom"), "Something went wrong", "Try again"),
    ],
)
def test_job_errors_are_explained_in_plain_words(error, expected, hint):
    problem = JobManager._explain(error)

    assert expected in problem["error"]
    assert hint in problem["hint"]
    assert type(error).__name__ in problem["details"]  # the technical text for "Details"
