import json

import pytest
import trimesh

from photo3d_engine.jobs import JobManager, overall_progress
from photo3d_engine.print_prep.repair import is_printable
from photo3d_engine.projects import ProjectStore


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
