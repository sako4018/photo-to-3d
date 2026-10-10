import json

import pytest

from photo3d_engine.errors import AppError
from photo3d_engine.projects import ProjectStore, check_settings, file_stem


@pytest.fixture
def store(tmp_path):
    return ProjectStore(tmp_path / "data")


def test_create_list_and_get(store):
    project = store.create("Teddy bear")
    assert project["status"] == "empty" and project["settings"]["height_mm"] == 50.0
    assert store.get(project["id"]) == project
    assert [p["id"] for p in store.list()] == [project["id"]]
    on_disk = json.loads((store.root / project["id"] / "project.json").read_text("utf-8"))
    assert on_disk["name"] == "Teddy bear"


def test_two_projects_with_the_same_name_do_not_clash(store):
    assert store.create("cup")["id"] != store.create("cup")["id"]


def test_cyrillic_name_gives_an_ascii_folder_and_a_readable_file_name(store):
    project = store.create("Мече")
    assert project["id"].isascii() and project["name"] == "Мече"
    assert file_stem("Мече / тест?") == "Мече  тест"
    assert file_stem("???") == "model"


def test_empty_name_is_refused(store):
    with pytest.raises(AppError) as error:
        store.create("   ")
    assert error.value.status == 422 and error.value.hint


def test_rename_and_update_merge_settings(store):
    project = store.create("a")
    store.rename(project["id"], "b")
    updated = store.update(project["id"], settings={"height_mm": 70})
    assert updated["name"] == "b"
    assert updated["settings"]["height_mm"] == 70 and updated["settings"]["quality"] == "normal"


def test_save_input_keeps_the_photo_as_original(store, photo_bytes):
    project = store.create("a")
    saved = store.save_input(project["id"], "Foto.PNG", photo_bytes)
    assert saved["image"] == "original.png"
    assert (store.root / project["id"] / "original.png").read_bytes() == photo_bytes


def test_a_new_photo_replaces_the_old_one_and_clears_the_result(store, photo_bytes):
    project = store.create("a")
    store.save_input(project["id"], "a.png", photo_bytes)
    store.update(project["id"], status="ready", outputs={"stl": "x.stl"}, report={"a": 1})
    saved = store.save_input(project["id"], "b.png", photo_bytes)
    assert saved["outputs"] == {} and saved["report"] is None and saved["status"] == "empty"
    assert len(list((store.root / project["id"]).glob("original.*"))) == 1


@pytest.mark.parametrize(
    ("filename", "data", "status"),
    [
        ("notes.txt", b"hello", 415),
        ("photo.png", b"", 413),
        ("photo.png", b"this is not an image", 422),
    ],
)
def test_bad_uploads_are_refused_with_a_hint(store, filename, data, status):
    project = store.create("a")
    with pytest.raises(AppError) as error:
        store.save_input(project["id"], filename, data)
    assert error.value.status == status and error.value.hint


def test_delete_removes_only_the_project_folder(store, tmp_path):
    keep = store.create("keep")
    gone = store.create("gone")
    store.delete(gone["id"])
    assert not (store.root / gone["id"]).exists()
    assert (store.root / keep["id"]).exists()


@pytest.mark.parametrize("bad_id", ["..", "../data", "a/b", "/etc", ".hidden", "UPPER", ""])
def test_ids_that_could_leave_the_data_folder_are_unknown(store, bad_id):
    outside = store.root.parent / "precious"
    outside.mkdir()
    (outside / "project.json").write_text("{}")
    with pytest.raises(AppError) as error:
        store.delete(bad_id)
    assert error.value.status == 404
    assert outside.exists()


def test_a_broken_project_json_does_not_hide_the_others(store):
    good = store.create("good")
    broken = store.create("broken")
    (store.root / broken["id"] / "project.json").write_text("{not json")
    assert [p["id"] for p in store.list()] == [good["id"]]


def test_data_dir_with_spaces_and_cyrillic(tmp_path, photo_bytes):
    store = ProjectStore(tmp_path / "Моите данни" / "photo to 3d")
    project = store.create("a")
    assert store.save_input(project["id"], "a.png", photo_bytes)["image"] == "original.png"


def test_check_settings_accepts_good_values_and_refuses_bad_ones():
    good = {"quality": "fast", "height_mm": 40, "rotation": [1, 0, 0], "device": "cpu"}
    assert check_settings({**good, "engine": None}) == good
    for bad in (
        {"quality": "ultra"},
        {"height_mm": 0},
        {"height_mm": True},
        {"base_cut_pct": 50},
        {"rotation": [1, 2]},
        {"unknown": 1},
    ):
        with pytest.raises(AppError):
            check_settings(bad)
