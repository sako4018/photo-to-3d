from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from photo3d_engine.server import create_app

TOKEN = "secret"
HEADERS = {"X-Token": TOKEN}


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "Моите данни" / "photo to 3d", TOKEN)  # spaces and Cyrillic
    with TestClient(app, headers=HEADERS) as test_client:
        yield test_client


def new_project(client, photo_bytes, name="Мече", **settings):
    settings = {"engine": "dummy", "remove_bg": False, "quality": "fast", **settings}
    project = client.post("/projects", json={"name": name, "settings": settings}).json()
    reply = client.post(
        f"/projects/{project['id']}/inputs", files={"photo": ("photo.png", photo_bytes)}
    )
    assert reply.status_code == 200, reply.text
    return project["id"]


def make_model(client, photo_bytes, **settings):
    project_id = new_project(client, photo_bytes, **settings)
    job = client.post("/jobs", json={"project_id": project_id}).json()
    assert client.app.state.jobs.wait(job["id"])["status"] == "done"
    return project_id, job["id"]


def test_every_endpoint_wants_the_token(client):
    for method, path in [
        ("get", "/health"),
        ("get", "/engines"),
        ("get", "/projects"),
        ("post", "/projects"),
        ("get", "/projects/x"),
        ("get", "/jobs/j-1"),
        ("post", "/jobs"),
        ("post", "/projects/x/print-prep"),
    ]:
        for headers in ({"X-Token": ""}, {"X-Token": "wrong"}):
            reply = client.request(method, path, headers=headers)
            assert reply.status_code == 401, (method, path)
            assert reply.json()["error"] and reply.json()["hint"]
    assert client.get("/health").status_code == 200


def test_a_request_without_any_token_is_refused(client):
    bare = TestClient(client.app)  # no default headers
    assert bare.get("/projects").status_code == 401


def test_health_and_engines(client):
    health = client.get("/health").json()
    assert health["version"] and "cpu" in health["devices"] and health["free_memory_gb"] > 0
    engines = {e["id"]: e for e in client.get("/engines").json()}
    assert engines["dummy"]["installed"] is True
    assert engines["triposr"]["license"] == "MIT" and engines["triposr"]["gated"] is False


def test_project_lifecycle(client):
    created = client.post("/projects", json={"name": "Cup"})
    assert created.status_code == 201
    project_id = created.json()["id"]
    assert [p["id"] for p in client.get("/projects").json()] == [project_id]

    changed = client.patch(
        f"/projects/{project_id}", json={"name": "Big cup", "settings": {"height_mm": 80}}
    ).json()
    assert changed["name"] == "Big cup" and changed["settings"]["height_mm"] == 80

    assert client.delete(f"/projects/{project_id}").status_code == 204
    missing = client.get(f"/projects/{project_id}")
    assert missing.status_code == 404 and missing.json()["hint"]


def test_bad_requests_get_a_plain_message(client):
    assert client.post("/projects", json={}).status_code == 422
    assert client.post("/projects", json={"name": "  "}).status_code == 422
    reply = client.post("/projects", json={"name": "a", "settings": {"quality": "ultra"}})
    assert reply.status_code == 422 and "quality" in reply.json()["error"]
    reply = client.post("/jobs", json={"project_id": "nope"})
    assert reply.status_code == 404 and reply.json()["hint"]


def test_ids_with_path_tricks_cannot_reach_other_folders(client):
    keep = client.post("/projects", json={"name": "keep"}).json()["id"]
    for bad in ("%2e%2e", "..%2Fjobs", "UPPER", "a%2Fb"):
        assert client.delete(f"/projects/{bad}").status_code in (404, 405)
    assert client.get(f"/projects/{keep}").status_code == 200


def test_a_wrong_photo_is_refused(client):
    project_id = client.post("/projects", json={"name": "a"}).json()["id"]
    for filename, data, status in [
        ("notes.txt", b"hello", 415),
        ("photo.png", b"not an image", 422),
    ]:
        reply = client.post(f"/projects/{project_id}/inputs", files={"photo": (filename, data)})
        assert reply.status_code == status and reply.json()["hint"]


def test_photo_to_stl_through_the_api(client, photo_bytes):
    project_id, job_id = make_model(client, photo_bytes, height_mm=45)

    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "done" and job["progress"] == 1.0

    project = client.get(f"/projects/{project_id}").json()
    assert project["status"] == "ready" and project["outputs"]["stl"] == "Мече_45mm.stl"

    report = client.get(f"/projects/{project_id}/report").json()
    assert report["watertight"] is True and report["size_mm"][2] == pytest.approx(45, abs=0.3)

    stl = client.get(f"/projects/{project_id}/files/model.stl")
    assert stl.status_code == 200 and len(stl.content) > 1000
    assert client.get(f"/projects/{project_id}/files/raw.glb").status_code == 200
    assert client.get(f"/projects/{project_id}/files/original").content == photo_bytes
    assert client.get(f"/projects/{project_id}/files/secret.txt").status_code == 404


def test_report_and_files_before_a_model_exists(client):
    project_id = client.post("/projects", json={"name": "a"}).json()["id"]
    assert client.get(f"/projects/{project_id}/report").status_code == 404
    assert client.get(f"/projects/{project_id}/files/model.stl").status_code == 404


def test_a_job_without_a_photo_is_refused(client):
    project_id = client.post("/projects", json={"name": "a"}).json()["id"]
    reply = client.post("/jobs", json={"project_id": project_id})
    assert reply.status_code == 409 and reply.json()["hint"]


def test_cancel_through_the_api(client, photo_bytes, gate):
    project_id = new_project(client, photo_bytes, engine="slow")
    job = client.post("/jobs", json={"project_id": project_id}).json()
    cancelled = client.post(f"/jobs/{job['id']}/cancel").json()
    assert client.app.state.jobs.wait(job["id"])["status"] == "cancelled"
    assert cancelled["id"] == job["id"]
    assert client.get("/jobs/j-unknown").status_code == 404


def test_print_prep_changes_the_model_without_a_new_generation(client, photo_bytes):
    project_id, _ = make_model(client, photo_bytes, height_mm=50)
    folder = client.app.state.store.folder(project_id)
    raw_before = (folder / "details" / "raw.glb").read_bytes()

    taller = client.post(f"/projects/{project_id}/print-prep", json={"height_mm": 70}).json()
    assert taller["outputs"]["stl"] == "Мече_70mm.stl"
    assert taller["report"]["size_mm"][2] == pytest.approx(70, abs=0.3)
    assert (folder / "Мече_70mm.stl").is_file() and (folder / "Мече_50mm.stl").is_file()

    lying = client.post(f"/projects/{project_id}/print-prep", json={"rotation": [1, 0, 0]}).json()
    assert lying["report"]["watertight"] is True
    assert lying["report"]["size_mm"][2] == pytest.approx(70, abs=0.3)  # height is kept
    assert lying["report"]["size_mm"][1] != taller["report"]["size_mm"][1]  # but it is turned
    assert (folder / "details" / "raw.glb").read_bytes() == raw_before  # raw mesh untouched


def test_print_prep_needs_a_model_first_and_checks_values(client, photo_bytes):
    project_id = new_project(client, photo_bytes)
    reply = client.post(f"/projects/{project_id}/print-prep", json={"height_mm": 60})
    assert reply.status_code == 409 and reply.json()["hint"]
    reply = client.post(f"/projects/{project_id}/print-prep", json={"quality": "ultra"})
    assert reply.status_code == 422


def test_export_copies_the_stl_and_never_overwrites(client, photo_bytes, tmp_path):
    project_id, _ = make_model(client, photo_bytes)
    target = tmp_path / "Мои модели с интервал"
    target.mkdir()

    saved = client.post(
        f"/projects/{project_id}/export", json={"format": "stl", "dest_path": str(target)}
    )
    assert saved.status_code == 200
    copy = target / "Мече_50mm.stl"
    assert saved.json()["path"] == str(copy) and copy.stat().st_size > 1000

    again = client.post(f"/projects/{project_id}/export", json={"dest_path": str(target)})
    assert again.status_code == 409 and again.json()["hint"]

    named = client.post(
        f"/projects/{project_id}/export", json={"dest_path": str(target / "own.stl")}
    )
    assert named.status_code == 200 and (target / "own.stl").is_file()

    missing = client.post(f"/projects/{project_id}/export", json={"dest_path": str(tmp_path / "x")})
    assert missing.status_code == 422
    other_format = client.post(
        f"/projects/{project_id}/export", json={"format": "3mf", "dest_path": str(target)}
    )
    assert other_format.status_code == 422


def test_export_before_a_model_exists(client, tmp_path):
    project_id = client.post("/projects", json={"name": "a"}).json()["id"]
    reply = client.post(f"/projects/{project_id}/export", json={"dest_path": str(tmp_path)})
    assert reply.status_code == 409


def test_websocket_needs_the_token(client):
    bare = TestClient(client.app)  # the default client sends the X-Token header
    for url in ("/ws", "/ws?token=wrong"):
        with pytest.raises(WebSocketDisconnect) as error, bare.websocket_connect(url):
            pass
        assert error.value.code == 4401


def test_websocket_streams_job_events(client, photo_bytes):
    project_id = new_project(client, photo_bytes)
    with client.websocket_connect(f"/ws?token={TOKEN}") as socket:
        job = client.post("/jobs", json={"project_id": project_id}).json()
        seen = []
        while True:
            event = socket.receive_json()
            if event["job"]["id"] != job["id"]:
                continue
            seen.append(event["job"])
            if event["job"]["status"] == "done":
                break
    assert seen[0]["status"] in ("queued", "running")
    progress = [j["progress"] for j in seen]
    assert progress == sorted(progress) and progress[-1] == 1.0


def test_deleting_a_project_with_a_running_job_is_refused(client, photo_bytes, gate):
    project_id = new_project(client, photo_bytes, engine="slow")
    job = client.post("/jobs", json={"project_id": project_id}).json()
    reply = client.delete(f"/projects/{project_id}")
    assert reply.status_code == 409 and reply.json()["hint"]
    client.post(f"/jobs/{job['id']}/cancel")
    client.app.state.jobs.wait(job["id"])
    assert client.delete(f"/projects/{project_id}").status_code == 204


@pytest.mark.slow
def test_real_triposr_through_the_api(tmp_path):
    from photo3d_engine.engines.registry import get_engine

    if not get_engine("triposr").is_installed():
        pytest.skip("TripoSR weights are not downloaded (run: photo3d install)")
    sample = Path(__file__).resolve().parents[2] / "samples" / "chair.png"
    app = create_app(tmp_path / "data", TOKEN)
    with TestClient(app, headers=HEADERS) as client:
        project = client.post(
            "/projects", json={"name": "chair", "settings": {"quality": "fast"}}
        ).json()
        client.post(
            f"/projects/{project['id']}/inputs",
            files={"photo": ("chair.png", sample.read_bytes())},
        )
        job = client.post("/jobs", json={"project_id": project["id"]}).json()
        assert app.state.jobs.wait(job["id"], timeout=600)["status"] == "done"
        report = client.get(f"/projects/{project['id']}/report").json()
        assert report["watertight"] is True and report["size_mm"][2] == pytest.approx(50, abs=0.5)
