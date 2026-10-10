import numpy as np
import pytest
from PIL import Image

from photo3d_engine.preprocess.background import has_useful_alpha, remove_background
from photo3d_engine.preprocess.crop import crop_to_subject
from photo3d_engine.preprocess.image_io import load_image
from photo3d_engine.preprocess.prepare import prepare_image


def cutout(width=40, height=100, canvas=(300, 200)) -> Image.Image:
    """A red rectangle on a fully transparent canvas."""
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    image.paste(Image.new("RGBA", (width, height), (220, 20, 20, 255)), (60, 30))
    return image


# ---------- loading ----------


def test_load_jpg_png_and_webp(tmp_path):
    for suffix in (".jpg", ".png", ".webp"):
        path = tmp_path / f"photo{suffix}"
        Image.new("RGB", (80, 60), (10, 120, 200)).save(path)
        loaded = load_image(path)
        assert loaded.size == (80, 60)
        assert loaded.mode == "RGB"


def test_load_heic_from_an_iphone(tmp_path):
    path = tmp_path / "IMG_0001.HEIC"
    Image.new("RGB", (64, 48), (200, 30, 30)).save(path, format="HEIF")
    assert load_image(path).size == (64, 48)


def test_load_applies_exif_rotation(tmp_path):
    path = tmp_path / "rotated.jpg"
    image = Image.new("RGB", (100, 40), (50, 50, 50))
    exif = Image.Exif()
    exif[0x0112] = 6  # "rotate 90 degrees clockwise to view"
    image.save(path, exif=exif)
    assert load_image(path).size == (40, 100)


def test_load_keeps_transparency(tmp_path):
    path = tmp_path / "cut.png"
    cutout().save(path)
    assert load_image(path).mode == "RGBA"


def test_load_shrinks_big_photos(tmp_path):
    path = tmp_path / "big.png"
    Image.new("RGB", (4000, 3000), (1, 2, 3)).save(path)
    assert max(load_image(path, max_side=1000).size) == 1000


def test_load_rejects_unknown_types(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("hi")
    with pytest.raises(ValueError, match="Unsupported"):
        load_image(path)


def test_load_works_with_cyrillic_path(tmp_path):
    folder = tmp_path / "снимки на предмети"
    folder.mkdir()
    path = folder / "чаша 1.png"
    Image.new("RGB", (20, 20), (9, 9, 9)).save(path)
    assert load_image(path).size == (20, 20)


# ---------- crop ----------


def test_crop_is_square_and_has_the_subject_in_the_middle():
    result = crop_to_subject(cutout(), size=256, foreground_ratio=0.8)
    assert result.size == (256, 256)
    alpha = np.asarray(result.getchannel("A"))
    ys, xs = np.where(alpha > 10)
    assert abs((xs.min() + xs.max()) / 2 - 128) < 3
    assert abs((ys.min() + ys.max()) / 2 - 128) < 3


def test_crop_subject_fills_the_requested_share():
    result = crop_to_subject(cutout(width=40, height=100), size=500, foreground_ratio=0.8)
    alpha = np.asarray(result.getchannel("A"))
    ys, _ = np.where(alpha > 10)
    assert (ys.max() - ys.min() + 1) / 500 == pytest.approx(0.8, abs=0.02)


def test_crop_rejects_an_empty_image():
    with pytest.raises(ValueError, match="No subject"):
        crop_to_subject(Image.new("RGBA", (50, 50), (0, 0, 0, 0)))


def test_crop_rejects_bad_ratio():
    with pytest.raises(ValueError):
        crop_to_subject(cutout(), foreground_ratio=0)


# ---------- background ----------


def test_has_useful_alpha():
    assert has_useful_alpha(cutout())
    assert not has_useful_alpha(Image.new("RGB", (10, 10)))
    assert not has_useful_alpha(Image.new("RGBA", (10, 10), (1, 2, 3, 255)))  # nothing cut out
    assert not has_useful_alpha(Image.new("RGBA", (10, 10), (1, 2, 3, 0)))  # nothing left


def test_existing_cutout_is_kept_without_loading_rembg():
    original = cutout()
    assert remove_background(original).tobytes() == original.tobytes()


def test_prepare_image_with_a_cutout_needs_no_ai(tmp_path):
    path = tmp_path / "cut.png"
    cutout().save(path)
    result = prepare_image(path, size=128)
    assert result.size == (128, 128)
    assert result.mode == "RGBA"


@pytest.mark.slow
def test_rembg_really_removes_a_plain_background(tmp_path):
    photo = Image.new("RGB", (300, 300), (240, 240, 240))
    photo.paste(Image.new("RGB", (120, 160), (200, 30, 30)), (90, 70))
    result = remove_background(photo)
    alpha = np.asarray(result.getchannel("A"))
    assert alpha[5, 5] < 50  # corner is background
    assert alpha[150, 150] > 200  # the object stays
