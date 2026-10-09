# TripoSR (vendored)

Source: https://github.com/VAST-AI-Research/TripoSR
Commit: 107cefdc244c39106fa830359024f6a2f1c78871
License: MIT, Copyright (c) 2024 Tripo AI & Stability AI (see LICENSE)

Weights are not included. They are downloaded from `stabilityai/TripoSR` on Hugging Face
(MIT, no account needed).

## Changes made for photo-to-3d

- `tsr/bake_texture.py` removed (needs moderngl and xatlas; printing needs no texture).
- `tsr/models/isosurface.py`: `torchmcubes` (needs a compiler, CUDA-only build) replaced by
  `skimage.measure.marching_cubes`. The axis re-ordering after it was removed because
  scikit-image already returns vertices in (x, y, z) order.
- `tsr/utils.py`: removed `remove_background`, `resize_foreground`, `save_video` and
  `to_gradio_3d_orientation` (they pulled in `rembg` and `imageio`; this project has its own
  preprocessing). `find_class` maps the `tsr.` prefix from config.yaml to this package.
- Empty `__init__.py` files added so the folders are regular packages.
