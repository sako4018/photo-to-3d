"""Background removal with rembg (U2-Net, runs on the CPU)."""

from __future__ import annotations

import gc

import numpy as np
from PIL import Image

_session = None


def has_useful_alpha(image: Image.Image) -> bool:
    """True if the image already has a cut-out: some pixels clear and some solid."""
    if image.mode != "RGBA":
        return False
    alpha = np.asarray(image.getchannel("A"))
    return bool((alpha < 20).any() and (alpha > 235).any())


def remove_background(image: Image.Image) -> Image.Image:
    """Return an RGBA image where the background is transparent."""
    global _session
    if has_useful_alpha(image):
        return image.convert("RGBA")

    from rembg import new_session, remove

    if _session is None:
        _session = new_session("u2net", providers=["CPUExecutionProvider"])
    return remove(image.convert("RGB"), session=_session).convert("RGBA")


def release_session() -> None:
    """Free the background model's memory (it is needed before the 3D model, not during)."""
    global _session
    _session = None
    gc.collect()
