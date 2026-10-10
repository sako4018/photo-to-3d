"""TripoSG (weights MIT, VAST-AI): one photo in, a detailed raw 3D mesh out.

The only model of the app (docs/decisions/007): detailed shapes and correct proportions,
about 2 minutes per photo on an M1 Pro, about 8 GB download, about 9 GB of memory.
The networks are this project's own code (see triposg_net.py).
"""

from __future__ import annotations

import gc
from functools import partial
from pathlib import Path

import numpy as np
from PIL import Image

from ..platform.devices import free_device_memory
from .base import CancelFn, Cancelled, Engine, ProgressFn

REPO_ID = "VAST-AI/TripoSG"
# the exact version of the weights that triposg_net.py was checked against
REVISION = "2c1c516d22d58db486a058d98d31bb6177344e06"
FLOW_FILES = ("transformer/config.json", "transformer/diffusion_pytorch_model.safetensors")
DECODER_FILES = ("vae/config.json", "vae/diffusion_pytorch_model.safetensors")
IMAGE_FILES = ("image_encoder_dinov2/config.json", "image_encoder_dinov2/model.safetensors")
ALL_FILES = FLOW_FILES + DECODER_FILES + IMAGE_FILES

GUIDANCE = 7.0  # how strongly every step follows the photo
BOUND = 1.005  # the shapes live inside this cube
POINTS_PER_BATCH = 32_768  # decoder points at once: more = faster, but more memory

# steps of the diffusion, then the surface grid: coarse points per side and refinements
# (each refinement doubles the detail, but only near the surface)
QUALITY = {
    "fast": {"steps": 12, "coarse": 64, "refine": 1},
    "normal": {"steps": 20, "coarse": 128, "refine": 1},
    "detailed": {"steps": 30, "coarse": 128, "refine": 2},
}

# refine a coarse cell when its occupancy gets this close to the surface (0)
REFINE_BAND = 2.0


def model_folder() -> Path:
    from ..paths import models_dir

    return models_dir() / "triposg"


def _cached(filename: str) -> str | None:
    """The file in the app's model folder, else in the Hugging Face cache (older installs)."""
    own = model_folder() / filename
    if own.is_file():
        return str(own)
    from huggingface_hub import try_to_load_from_cache

    found = try_to_load_from_cache(REPO_ID, filename, revision=REVISION)
    if not isinstance(found, str):
        found = try_to_load_from_cache(REPO_ID, filename)
    return found if isinstance(found, str) else None


def remote_files():
    """Name, address and size of every file to download (asks Hugging Face for the sizes)."""
    from huggingface_hub import get_hf_file_metadata, hf_hub_url

    from ..download import RemoteFile

    found = []
    for name in ALL_FILES:
        url = hf_hub_url(REPO_ID, name, revision=REVISION)
        found.append(RemoteFile(name, url, get_hf_file_metadata(url).size))
    return found


def prepare_photo(rgba: Image.Image) -> Image.Image:
    """The cut-out on white, as the model was trained (subject already centred and padded)."""
    rgba = rgba.convert("RGBA")
    white = Image.new("RGB", rgba.size, (255, 255, 255))
    white.paste(rgba, mask=rgba.getchannel("A"))
    return white


def dino_pixels(photo: Image.Image):
    """224x224 normalised tensor the way DINOv2 expects it."""
    import torch

    small = photo.resize((256, 256), Image.Resampling.BICUBIC).crop((16, 16, 240, 240))
    data = np.asarray(small, dtype=np.float32) / 255.0
    data = (data - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
    return torch.from_numpy(data.astype(np.float32)).permute(2, 0, 1)[None]


def grid_points(count: int, device, dtype):
    import torch

    axis = torch.linspace(-BOUND, BOUND, count, device=device, dtype=dtype)
    xs, ys, zs = torch.meshgrid(axis, axis, axis, indexing="ij")
    return torch.stack([xs, ys, zs], dim=-1).reshape(-1, 3)


def cells_near_surface(field, band: float):
    """True for every grid cell (8 corners) that the surface may pass through, plus a margin."""
    import torch.nn.functional as F

    volume = field[None, None]
    highest = F.max_pool3d(volume, 2, stride=1)
    lowest = -F.max_pool3d(-volume, 2, stride=1)
    near = ((highest > -band) & (lowest < band)).float()
    return F.max_pool3d(near, 3, stride=1, padding=1)[0, 0] > 0


def refine(field, occupancy, band: float, cancelled: CancelFn):
    """Double the grid: interpolate everywhere, ask the decoder again only near the surface."""
    import torch
    import torch.nn.functional as F

    size = field.shape[0] * 2 - 1
    fine = F.interpolate(field[None, None], size=(size,) * 3, mode="trilinear", align_corners=True)
    fine = fine[0, 0]

    cells = cells_near_surface(field, band)
    cells = cells.repeat_interleave(2, 0).repeat_interleave(2, 1).repeat_interleave(2, 2)
    # a fine grid point is asked when any of the 8 fine cells around it is near the surface
    touched = F.max_pool3d(F.pad(cells.float(), (1, 1, 1, 1, 1, 1))[None, None], 2, stride=1)
    index = torch.nonzero(touched[0, 0] > 0)
    points = index.float() / (size - 1) * (2 * BOUND) - BOUND
    fine[index[:, 0], index[:, 1], index[:, 2]] = occupancy(points, cancelled)
    return fine


def surface_mesh(field):
    """Marching cubes at occupancy 0, vertices scaled back into the shape cube."""
    import trimesh
    from skimage import measure

    grid = field.cpu().numpy()
    vertices, faces, _, _ = measure.marching_cubes(grid, 0.0)
    vertices = vertices / (grid.shape[0] - 1) * (2 * BOUND) - BOUND
    mesh = trimesh.Trimesh(vertices, faces, process=False)
    if mesh.volume < 0:
        mesh.invert()
    return mesh


class TripoSGEngine(Engine):
    id = "triposg"
    name = "TripoSG"
    license = "MIT"
    gated = False
    devices = frozenset({"cuda", "mps", "cpu"})
    est_mem_gb = 10.0  # measured peak 8.4-9.5 GB on an M1 Pro, see docs/benchmarks.md
    download_gb = 7.9
    up_axis = "y"

    def __init__(self) -> None:
        self.flow = None
        self.decoder = None
        self.image_encoder = None
        self.device = "cpu"
        self.dtype = None

    def is_installed(self) -> bool:
        return all(_cached(name) for name in ALL_FILES)

    def own_folder(self) -> Path | None:
        return model_folder()

    def weight_files(self) -> list[Path]:
        found = [_cached(name) for name in ALL_FILES]
        return [Path(path) for path in found if path]

    def install(self, progress: ProgressFn, cancelled: CancelFn = lambda: False) -> None:
        from ..download import download

        def on_bytes(done: int, total: int) -> None:
            progress("install", done / total if total else 1.0)

        download(remote_files(), model_folder(), on_bytes, cancelled)

    def load(self, device: str) -> None:
        import torch
        from transformers import Dinov2Model

        from .triposg_net import (
            FlowTransformer,
            ShapeDecoder,
            decoder_renames,
            flow_renames,
            load_weights,
        )

        self.unload()
        # half precision on GPUs halves the memory; the CPU is faster in float32
        dtype = torch.float32 if device == "cpu" else torch.float16

        flow = FlowTransformer()
        load_weights(flow, Path(_cached(FLOW_FILES[1])), flow_renames, dtype)
        decoder = ShapeDecoder()
        load_weights(decoder, Path(_cached(DECODER_FILES[1])), decoder_renames, dtype)
        image_dir = Path(_cached(IMAGE_FILES[1])).parent
        image_encoder = Dinov2Model.from_pretrained(image_dir)

        self.flow = flow.to(device, dtype).eval()
        self.decoder = decoder.to(device, dtype).eval()
        self.image_encoder = image_encoder.to(device, dtype).eval()
        self.device, self.dtype = device, dtype

    def unload(self) -> None:
        self.flow = self.decoder = self.image_encoder = None
        gc.collect()
        free_device_memory(self.device)

    def _occupancy(self, memory, points, cancelled: CancelFn):
        """Decoder answers for many points, a batch at a time, back on the CPU as float32."""
        import torch

        values = []
        for start in range(0, len(points), POINTS_PER_BATCH):
            if cancelled():
                raise Cancelled()
            batch = points[start : start + POINTS_PER_BATCH].to(self.device, self.dtype)
            values.append(self.decoder.occupancy(memory, batch[None])[0].float().cpu())
        return torch.cat(values)

    def run(
        self,
        rgba: Path,
        out_dir: Path,
        params: dict,
        progress: ProgressFn,
        cancelled: CancelFn,
    ) -> Path:
        import torch

        if self.flow is None:
            raise RuntimeError("TripoSGEngine.load() must be called before run()")
        out_dir.mkdir(parents=True, exist_ok=True)
        preset = QUALITY[params.get("quality", "normal")]
        steps = int(params.get("steps") or preset["steps"])
        on_step = params.get("on_step")  # (step, steps) for the app's "step 12 of 20"

        def check_cancel() -> None:
            if cancelled():
                raise Cancelled()

        progress("generate", 0.0)
        with Image.open(rgba) as opened:
            photo = prepare_photo(opened)

        with torch.no_grad():
            pixels = dino_pixels(photo).to(self.device, self.dtype)
            image = self.image_encoder(pixels).last_hidden_state
            # one pass without the photo, one with it; their difference is pushed further
            image = torch.cat([torch.zeros_like(image), image])

            generator = torch.Generator().manual_seed(int(params.get("seed", 42)))
            tokens = torch.randn(1, 2048, 64, generator=generator).to(self.device, self.dtype)
            sigmas = [1.0 - i / steps for i in range(steps)] + [0.0]
            for step in range(steps):
                check_cancel()
                t = torch.full((2,), sigmas[step] * 1000.0, device=self.device)
                plain, with_photo = self.flow(torch.cat([tokens, tokens]), t, image).chunk(2)
                velocity = plain + GUIDANCE * (with_photo - plain)
                tokens = tokens + (sigmas[step] - sigmas[step + 1]) * velocity
                if on_step:
                    on_step(step + 1, steps)
                progress("generate", 0.7 * (step + 1) / steps)

            memory = self.decoder.memory(tokens)
            del image, plain, with_photo, velocity
            occupancy = partial(self._occupancy, memory)

            coarse = preset["coarse"]
            field = occupancy(grid_points(coarse, "cpu", torch.float32), cancelled)
            field = field.reshape(coarse, coarse, coarse)
            for level in range(preset["refine"]):
                progress("generate", 0.75 + 0.2 * level / preset["refine"])
                field = refine(field, occupancy, REFINE_BAND, cancelled)
            check_cancel()

        del occupancy, memory, tokens
        free_device_memory(self.device)
        mesh = surface_mesh(field)
        out = out_dir / "raw.glb"
        mesh.export(out)
        progress("generate", 1.0)
        return out
