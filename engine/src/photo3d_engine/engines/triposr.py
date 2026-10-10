"""TripoSR (MIT): one image in, a raw 3D mesh out. See triposr_vendor/NOTICE.md."""

from __future__ import annotations

import gc
from pathlib import Path

from PIL import Image

from ..platform.devices import free_device_memory
from ..preprocess.crop import composite_on_gray
from .base import CancelFn, Cancelled, Engine, ProgressFn

REPO_ID = "stabilityai/TripoSR"
CONFIG_NAME = "config.yaml"
WEIGHT_NAME = "model.ckpt"
# the image encoder is built from this config only, its weights are inside model.ckpt
DINO_REPO_ID = "facebook/dino-vitb16"
DINO_CONFIG = "config.json"

CHUNK_SIZE = 8192  # how many 3D points are evaluated at once: lower = less memory

# how fine the marching-cubes grid is (resolution cubed points are evaluated)
MC_RESOLUTION = {"fast": 128, "normal": 256, "detailed": 320}


def _cached(repo_id: str, filename: str) -> bool:
    from huggingface_hub import try_to_load_from_cache

    found = try_to_load_from_cache(repo_id, filename)
    return isinstance(found, str)


class TripoSREngine(Engine):
    id = "triposr"
    name = "TripoSR"
    license = "MIT"
    gated = False
    devices = frozenset({"cuda", "mps", "cpu"})
    est_mem_gb = 6.0
    download_gb = 1.7
    up_axis = "z"  # checked against real output, see docs/benchmarks.md

    def __init__(self) -> None:
        self.model = None
        self.device = "cpu"

    def is_installed(self) -> bool:
        return (
            _cached(REPO_ID, CONFIG_NAME)
            and _cached(REPO_ID, WEIGHT_NAME)
            and _cached(DINO_REPO_ID, DINO_CONFIG)
        )

    def install(self, progress: ProgressFn) -> None:
        from huggingface_hub import hf_hub_download

        steps = [
            (REPO_ID, CONFIG_NAME),
            (DINO_REPO_ID, DINO_CONFIG),
            (REPO_ID, WEIGHT_NAME),  # about 1.7 GB, the only big one
        ]
        for index, (repo_id, filename) in enumerate(steps):
            progress("install", index / len(steps))
            hf_hub_download(repo_id=repo_id, filename=filename)
        progress("install", 1.0)

    def load(self, device: str) -> None:
        from .triposr_vendor.tsr.system import TSR

        self.unload()
        model = TSR.from_pretrained(REPO_ID, config_name=CONFIG_NAME, weight_name=WEIGHT_NAME)
        model.renderer.set_chunk_size(CHUNK_SIZE)
        model.to(device)
        model.eval()
        self.model = model
        self.device = device

    def unload(self) -> None:
        device = self.device
        self.model = None
        gc.collect()
        free_device_memory(device)

    def run(
        self,
        rgba: Path,
        out_dir: Path,
        params: dict,
        progress: ProgressFn,
        cancelled: CancelFn,
    ) -> Path:
        import torch

        if self.model is None:
            raise RuntimeError("TripoSREngine.load() must be called before run()")
        out_dir.mkdir(parents=True, exist_ok=True)
        resolution = int(
            params.get("mc_resolution") or MC_RESOLUTION[params.get("quality", "normal")]
        )

        def check_cancel() -> None:
            if cancelled():
                raise Cancelled()

        progress("generate", 0.0)
        with Image.open(rgba) as opened:
            image = composite_on_gray(opened.convert("RGBA"))
        check_cancel()

        with torch.no_grad():
            scene_codes = self.model([image], device=self.device)
            progress("generate", 0.4)
            check_cancel()

            meshes = self.model.extract_mesh(scene_codes, True, resolution=resolution)
            progress("generate", 0.95)

        mesh = meshes[0]
        del scene_codes, meshes
        free_device_memory(self.device)

        out = out_dir / "raw.glb"
        mesh.export(out)
        progress("generate", 1.0)
        return out
