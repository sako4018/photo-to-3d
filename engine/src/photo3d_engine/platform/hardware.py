"""What the computer has, for the app's first-launch check (docs/phase-2-app.md, 2.1)."""

from __future__ import annotations

import platform
import subprocess
import sys


def gpu() -> dict:
    """{"kind": "apple" | "nvidia" | "none", "name": "..."}. "none" means CPU only (slow)."""
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return {"kind": "apple", "name": _mac_chip() or "Apple Silicon"}
    try:
        import torch

        if torch.cuda.is_available():
            return {"kind": "nvidia", "name": torch.cuda.get_device_name(0)}
    except Exception:  # no torch, or a broken driver: treat as CPU only
        pass
    return {"kind": "none", "name": platform.processor() or platform.machine() or "CPU"}


def _mac_chip() -> str | None:
    try:
        found = subprocess.run(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        return found.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None
