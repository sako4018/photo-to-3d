import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from photo3d_engine.download import RemoteFile, done_bytes, download
from photo3d_engine.engines import registry
from photo3d_engine.engines.base import Cancelled, Engine
from photo3d_engine.errors import AppError
from photo3d_engine.installs import InstallManager

FILES = {"a/config.json": b'{"x": 1}', "a/weights.bin": bytes(range(256)) * 4000}


class RangeHandler(BaseHTTPRequestHandler):
    """Serves FILES and honours "Range: bytes=N-", like Hugging Face does."""

    ignore_range = False

    def do_GET(self):  # noqa: N802 (name given by http.server)
        data = FILES.get(self.path.lstrip("/"))
        if data is None:
            self.send_error(404)
            return
        start = 0
        asked = self.headers.get("Range")
        if asked and not self.ignore_range:
            start = int(asked.split("=")[1].rstrip("-"))
            self.send_response(206)
        else:
            self.send_response(200)
        self.send_header("Content-Length", str(len(data) - start))
        self.end_headers()
        self.wfile.write(data[start:])

    def log_message(self, *args):
        pass


@pytest.fixture
def server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), RangeHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    RangeHandler.ignore_range = False


def remote(server):
    return [RemoteFile(name, f"{server}/{name}", len(data)) for name, data in FILES.items()]


def test_download_fetches_every_file_and_reports_bytes(server, tmp_path):
    seen = []
    download(remote(server), tmp_path, lambda done, total: seen.append((done, total)))
    for name, data in FILES.items():
        assert (tmp_path / name).read_bytes() == data
    total = sum(len(d) for d in FILES.values())
    assert seen[0] == (0, total) and seen[-1] == (total, total)
    assert [done for done, _ in seen] == sorted(done for done, _ in seen)  # only forward


def test_a_stopped_download_resumes_where_it_was(server, tmp_path, monkeypatch):
    monkeypatch.setattr("photo3d_engine.download.CHUNK", 100_000)
    files = remote(server)
    seen = [0]
    with pytest.raises(Cancelled):  # stop in the middle of the big file
        download(
            files,
            tmp_path,
            lambda done, total: seen.__setitem__(0, done),
            cancelled=lambda: seen[0] > 300_000,
        )
    part = tmp_path / "a" / "weights.bin.part"
    assert part.is_file() and 0 < part.stat().st_size < len(FILES["a/weights.bin"])
    already = done_bytes(files, tmp_path)

    resumed = []
    download(files, tmp_path, lambda done, total: resumed.append(done))
    assert resumed[0] == already  # starts from what was on disk, not from 0
    assert (tmp_path / "a" / "weights.bin").read_bytes() == FILES["a/weights.bin"]
    assert not part.exists()


def test_a_server_that_ignores_the_range_still_gives_a_whole_file(server, tmp_path):
    files = remote(server)
    part = tmp_path / "a" / "weights.bin.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(FILES["a/weights.bin"][:500])
    RangeHandler.ignore_range = True
    download(files, tmp_path, lambda d, t: None)
    assert (tmp_path / "a" / "weights.bin").read_bytes() == FILES["a/weights.bin"]


def test_a_wrong_size_is_an_error_and_keeps_no_broken_file(server, tmp_path):
    wrong = [RemoteFile("a/config.json", f"{server}/a/config.json", 999)]
    with pytest.raises(OSError, match="expected 999"):
        download(wrong, tmp_path, lambda d, t: None)
    assert not (tmp_path / "a" / "config.json").exists()


# ---------- install manager ----------


class FakeEngine(Engine):
    """Downloads FILES from the test server into a folder, like TripoSG does."""

    id = "fake"
    name = "Fake"
    license = "MIT"
    download_gb = 0.001
    folder = None
    url = None

    def is_installed(self):
        return all((self.folder / name).is_file() for name in FILES)

    def install(self, progress, cancelled=lambda: False):
        files = [RemoteFile(n, f"{self.url}/{n}", len(d)) for n, d in FILES.items()]
        download(
            files, self.folder, lambda done, total: progress("install", done / total), cancelled
        )

    def load(self, device):
        pass

    def unload(self):
        pass

    def run(self, *args):
        raise NotImplementedError


@pytest.fixture
def fake_engine(server, tmp_path, monkeypatch):
    FakeEngine.folder, FakeEngine.url = tmp_path / "models", server
    monkeypatch.setitem(registry._FACTORIES, "fake", FakeEngine)
    monkeypatch.setenv("PHOTO3D_MODELS_DIR", str(tmp_path / "models"))
    return FakeEngine


def test_install_manager_downloads_and_reports_events(fake_engine):
    events = []
    installs = InstallManager(on_event=events.append)
    assert installs.get("fake")["status"] == "idle"
    installs.start("fake")
    state = installs.wait("fake")
    assert state["status"] == "done" and state["progress"] == 1.0
    assert events[-1]["type"] == "install" and events[-1]["install"]["status"] == "done"
    assert InstallManager().get("fake")["status"] == "done"  # seen as installed later too


def test_install_manager_pauses_and_resumes(fake_engine, monkeypatch):
    monkeypatch.setattr("photo3d_engine.download.CHUNK", 50_000)
    installs = InstallManager()
    real_install = FakeEngine.install

    def slow_install(self, progress, cancelled=lambda: False):
        import time

        def slow(done_fraction_stage, fraction):
            time.sleep(0.05)
            progress(done_fraction_stage, fraction)

        real_install(self, slow, cancelled)

    monkeypatch.setattr(FakeEngine, "install", slow_install)
    installs.start("fake")
    paused = installs.pause("fake")
    assert paused["status"] == "paused" and paused["progress"] < 1.0
    installs.start("fake")
    assert installs.wait("fake")["status"] == "done"


def test_install_manager_refuses_when_the_disk_is_too_full(fake_engine, monkeypatch):
    monkeypatch.setattr("photo3d_engine.installs.free_disk_gb", lambda folder: 0.1)
    with pytest.raises(Exception, match="Not enough free disk space"):
        InstallManager().start("fake")


def test_install_errors_are_explained(fake_engine, monkeypatch):
    def broken(self, progress, cancelled=lambda: False):
        raise OSError("connection reset")

    monkeypatch.setattr(FakeEngine, "install", broken)
    installs = InstallManager()
    installs.start("fake")
    state = installs.wait("fake")
    assert state["status"] == "error"
    assert "connection reset" in state["error"]["error"] and "Retry" in state["error"]["hint"]


# ---------- removing the downloaded copy ----------


@pytest.fixture
def own_copy_engine(fake_engine, tmp_path):
    """The fake engine, with its files in <models>/fake like a real engine's own folder."""
    fake_engine.folder = tmp_path / "models" / "fake"
    fake_engine.own_folder = lambda self: self.folder
    return fake_engine


def test_remove_deletes_only_the_apps_own_copy(own_copy_engine):
    installs = InstallManager()
    installs.start("fake")
    installs.wait("fake")
    assert installs.get("fake")["status"] == "done"

    state = installs.remove("fake")

    assert state["status"] == "idle"
    assert not own_copy_engine.folder.exists()
    installs.start("fake")  # can be downloaded again
    assert installs.wait("fake")["status"] == "done"


def test_remove_refuses_when_there_is_no_own_copy(fake_engine):
    # fake_engine keeps no folder of its own (own_folder() is None)
    with pytest.raises(AppError) as error:
        InstallManager().remove("fake")
    assert error.value.status == 404


def test_remove_never_leaves_the_models_folder(own_copy_engine, tmp_path):
    elsewhere = tmp_path / "somewhere-else"
    elsewhere.mkdir()
    (elsewhere / "precious.bin").write_bytes(b"x")
    own_copy_engine.own_folder = lambda self: elsewhere

    with pytest.raises(AppError) as error:
        InstallManager().remove("fake")

    assert error.value.status == 400
    assert (elsewhere / "precious.bin").exists()


def test_remove_refuses_while_downloading(own_copy_engine, monkeypatch):
    installs = InstallManager()
    gate = threading.Event()
    real_install = own_copy_engine.install

    def slow_install(self, progress, cancelled=lambda: False):
        gate.wait(5)
        real_install(self, progress, cancelled)

    monkeypatch.setattr(own_copy_engine, "install", slow_install)
    installs.start("fake")
    try:
        with pytest.raises(AppError) as error:
            installs.remove("fake")
        assert error.value.status == 409
    finally:
        gate.set()
        installs.wait("fake")
