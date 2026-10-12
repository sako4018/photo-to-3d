"""Pick the compute device: CUDA, then Apple MPS, then CPU."""

from __future__ import annotations

import os

# Some PyTorch operations have no Apple GPU version yet. With this they run on the CPU
# instead of crashing. Must be set before torch is first imported.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

VALID_DEVICES = ("auto", "cuda", "mps", "cpu")


def available_devices() -> list[str]:
    """Devices that PyTorch can really use here. CPU is always last."""
    try:
        import torch
    except ImportError:
        return ["cpu"]

    found = []
    if torch.cuda.is_available():
        found.append("cuda")
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        found.append("mps")
    found.append("cpu")
    return found


def pick_device(preferred: str = "auto") -> str:
    """Resolve "auto" to the best device. An explicit choice must be available."""
    if preferred not in VALID_DEVICES:
        raise ValueError(f"Unknown device {preferred!r}, expected one of {VALID_DEVICES}")

    found = available_devices()
    if preferred == "auto":
        return found[0]
    if preferred not in found:
        raise RuntimeError(f"Device {preferred!r} is not available here (available: {found})")
    return preferred


def free_device_memory(device: str) -> None:
    """Give cached GPU memory back after a model is unloaded."""
    import gc

    gc.collect()
    try:
        import torch
    except ImportError:
        return
    if device == "cuda" and torch.cuda.is_available():
        torch.cuda.empty_cache()
    elif device == "mps":
        mps = getattr(torch, "mps", None)
        backend = getattr(torch.backends, "mps", None)
        # torch.mps.empty_cache() raises on computers without an Apple GPU (Windows, Linux)
        if mps is not None and hasattr(mps, "empty_cache") and backend and backend.is_available():
            mps.empty_cache()
