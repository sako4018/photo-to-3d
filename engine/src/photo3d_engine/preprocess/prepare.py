"""Photo file in, prepared 512x512 RGBA cut-out out."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from .background import remove_background
from .crop import crop_to_subject
from .image_io import load_image


def prepare_image(path: Path, remove_bg: bool = True, size: int = 512) -> Image.Image:
    image = load_image(path)
    rgba = remove_background(image) if remove_bg else image.convert("RGBA")
    return crop_to_subject(rgba, size=size)
