"""Crop to the subject and centre it on a square canvas, the way image-to-3D models expect."""

from __future__ import annotations

import numpy as np
from PIL import Image

ALPHA_THRESHOLD = 10


def crop_to_subject(
    rgba: Image.Image, size: int = 512, foreground_ratio: float = 0.85
) -> Image.Image:
    """Square RGBA image of `size` px where the subject fills `foreground_ratio` of the side."""
    if not 0 < foreground_ratio <= 1:
        raise ValueError("foreground_ratio must be in (0, 1]")

    rgba = rgba.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.where(alpha > ALPHA_THRESHOLD)
    if len(xs) == 0:
        raise ValueError("No subject found in the image (it is fully transparent)")

    subject = rgba.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    side = int(round(max(subject.size) / foreground_ratio))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(subject, ((side - subject.width) // 2, (side - subject.height) // 2))
    return canvas.resize((size, size), Image.Resampling.LANCZOS)
