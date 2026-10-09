import pytest

from photo3d_engine.platform import devices


def test_cpu_is_always_available():
    assert "cpu" in devices.available_devices()
    assert devices.available_devices()[-1] == "cpu"


def test_auto_picks_the_best_available(monkeypatch):
    monkeypatch.setattr(devices, "available_devices", lambda: ["mps", "cpu"])
    assert devices.pick_device("auto") == "mps"
    monkeypatch.setattr(devices, "available_devices", lambda: ["cuda", "mps", "cpu"])
    assert devices.pick_device("auto") == "cuda"
    monkeypatch.setattr(devices, "available_devices", lambda: ["cpu"])
    assert devices.pick_device("auto") == "cpu"


def test_explicit_cpu_always_works():
    assert devices.pick_device("cpu") == "cpu"


def test_missing_device_gives_a_clear_error(monkeypatch):
    monkeypatch.setattr(devices, "available_devices", lambda: ["cpu"])
    with pytest.raises(RuntimeError, match="cuda"):
        devices.pick_device("cuda")


def test_unknown_device_name_is_rejected():
    with pytest.raises(ValueError):
        devices.pick_device("tpu")


def test_free_device_memory_never_crashes():
    for name in ("cpu", "mps", "cuda"):
        devices.free_device_memory(name)
