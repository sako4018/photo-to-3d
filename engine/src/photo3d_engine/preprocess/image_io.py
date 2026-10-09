"""Load a photo from JPG, PNG, WEBP or HEIC (iPhone) with the right orientation."""

from __future__ import annotations

from pathlib import Path

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
MAX_SIDE = 2048


def load_image(path: Path, max_side: int = MAX_SIDE) -> Image.Image:
    """Open an image, apply its EXIF rotation and return RGB or RGBA, at most `max_side` wide."""
    path = Path(path)
    if path.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise ValueError(
            f"Unsupported image type {path.suffix!r}, expected one of {sorted(SUPPORTED_SUFFIXES)}"
        )

    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)  # phones store the rotation in EXIF
        image.load()

    # keep transparency if there is any, everything else becomes plain RGB
    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    image = image.convert("RGBA" if has_alpha else "RGB")

    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return image
