"""The interface every image-to-3D model has to implement (see docs/PLAN.md, 7.3)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

ProgressFn = Callable[[str, float], None]
CancelFn = Callable[[], bool]


class Cancelled(Exception):
    """Raised by an engine when the user cancelled the job."""


class Engine(ABC):
    id: str
    name: str
    license: str
    gated: bool = False
    devices: frozenset[str] = frozenset({"cpu"})
    est_mem_gb: float = 0.0
    download_gb: float = 0.0  # size of the weights that `install` downloads
    # Which axis of the produced mesh points up: "y" (glTF convention) or "z".
    up_axis: str = "y"

    @abstractmethod
    def is_installed(self) -> bool:
        """True if everything needed (weights included) is available offline."""

    def weight_files(self) -> list[Path]:
        """The downloaded files on disk (empty when not installed or nothing to download)."""
        return []

    @abstractmethod
    def install(self, progress: ProgressFn, cancelled: CancelFn = lambda: False) -> None:
        """Download the weights. Raises Cancelled when stopped; calling it again resumes."""

    @abstractmethod
    def load(self, device: str) -> None:
        """Put the model in memory on the given device."""

    @abstractmethod
    def unload(self) -> None:
        """Free the memory again."""

    @abstractmethod
    def run(
        self,
        rgba: Path,
        out_dir: Path,
        params: dict,
        progress: ProgressFn,
        cancelled: CancelFn,
    ) -> Path:
        """Turn a prepared RGBA image into a raw mesh and return the path to raw.glb."""
