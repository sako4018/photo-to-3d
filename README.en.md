# photo-to-3d

[![CI](https://github.com/sako4018/photo-to-3d/actions/workflows/ci.yml/badge.svg)](https://github.com/sako4018/photo-to-3d/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

🇧🇬 [Версия на български](README.md)

A tool that turns **one photo** of an object into a **print-ready 3D model in STL format**: closed (watertight), in millimetres, with a flat base. It runs entirely on your own computer, with no cloud and no account.

It is for people with a 3D printer who want to turn a photo of a figurine, a toy or a gift into a model for their slicer without learning Blender. For now it only runs on a Mac with Apple Silicon.

![Teddy bear: photo, background removed, 3D model](docs/images/teddy.png)
![Garden gnome: photo, background removed, 3D model](docs/images/gnome.png)

*Photos: [Steiff Teddy Bear.jpg](https://commons.wikimedia.org/wiki/File:Steiff_Teddy_Bear.jpg) and [German garden gnome.jpg](https://commons.wikimedia.org/wiki/File:German_garden_gnome.jpg) from Wikimedia Commons, public domain (according to Commons). The 3D view is drawn by `scripts/make_readme_images.py`.*

## What works and what is next

The **command line** works: you give it a photo and get a folder with a closed STL, plus a report with the size and the approximate grams of PLA. There are **two AI models**: the fast TripoSR (about 16 s) and the much more detailed TripoSG (about 2 minutes). A **local HTTP server** (FastAPI) also works. The future app will talk to it: projects, a job queue, live progress over WebSocket, quick changes of height, base and rotation without running the AI model again, and STL export. **There is no windowed app yet.** Next comes an Electron app where you pick or drag a photo and see the model. The plan is in [docs/PLAN.md](docs/PLAN.md) (in Bulgarian).

## How it will work (planned)

> This is a plan, not something that exists. None of the list below is built yet, and the details of the website and the installer are still undecided.

1. A small website with a "before / after" picture and a "Download for Mac" button.
2. You download one file (`.dmg`) and open it like any Mac app.
3. The first launch finishes the installation: it downloads the model (about 2 GB), with a progress bar.
4. In the app you pick a photo file (or drag it in) and press "Create".
5. The app makes the 3D version (STL), shows it and saves it in a folder next to the photo.

## How to run it (macOS)

Once:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh      # installs uv
cd "$HOME/Desktop/Developer/personal projects/photo-to-3d"
uv run --project engine photo3d install              # downloads the TripoSR model, about 1.7 GB
uv run --project engine photo3d install --engine triposg   # optional: the detailed model, about 7.9 GB
```

Photo → STL:

```bash
uv run --project engine photo3d make samples/chair.png --height 50
```

Every photo gets its own folder inside `out/`, holding everything about it:

```
out/chair/
  original.png        the photo, copied unchanged
  chair_50mm.stl      the print-ready model
  report.txt          report: closed or not, size, volume, grams of PLA
  details/            the cut-out photo and the raw model (for checking)
```

- The same photo goes to the same folder again (a different height gives a second STL next to the first).
- A different photo with the same name gets a new folder (`chair-2`), so nothing is overwritten.
- `--out FOLDER` changes the place instead of `out/`. `--out file.stl` writes just one STL, with no folder.

Options: `--height` (mm), `--quality fast|normal|detailed`, `--engine triposr|triposg`, `--plate MM` (a plate this thick under the model), `--device auto|cpu|mps|cuda`, `--no-remove-bg` (the photo already has its background removed).

**Which model?** `triposr` is the default: fast and small, but shapes are soft and long objects come out squashed. `triposg` gives real detail (watch hands, bracelet links, turned chair legs) and correct proportions, but takes about 2 minutes and about 9 GB of memory. Comparison and numbers: [docs/benchmarks.md](docs/benchmarks.md), section 8 (in Bulgarian).

```bash
uv run --project engine photo3d make samples/chair.png --engine triposg --height 50
```

At the end the same report is printed: closed or not, size in mm, volume, approximate grams of PLA, time per stage and peak memory.

## Server for the app

```bash
cd "$HOME/Desktop/Developer/personal projects/photo-to-3d/engine"
uv run python -m photo3d_engine --token dev --data-dir "$HOME/photo3d-data"
```

The first printed line is JSON with the real port, for example `{"host": "127.0.0.1", "port": 59782, "token": "dev"}` (`--port 0` is the default and picks a free port). It listens on `127.0.0.1` only and every request needs the `X-Token` header. Projects are kept in `<data-dir>/projects/<id>/`.

```bash
curl -H "X-Token: dev" -d '{"name":"Chair"}' -H 'Content-Type: application/json' http://127.0.0.1:PORT/projects
curl -H "X-Token: dev" -F "photo=@samples/chair.png" http://127.0.0.1:PORT/projects/ID/inputs
curl -H "X-Token: dev" -d '{"project_id":"ID"}' -H 'Content-Type: application/json' http://127.0.0.1:PORT/jobs
```

What is verified: 147 automated tests when the server was added (162 now) (with the `DummyEngine`, no AI model) and a manual run on an M1 Pro with the real TripoSR and `samples/chair.png`: photo to STL over HTTP with the same report as the command line (82,950 triangles, 28.6 × 27.01 × 50 mm, closed), cancelling a running job, changing the height to 70 mm, export, a path with spaces and Cyrillic, and stopping with SIGTERM. **Not verified:** an Electron app (it does not exist yet), many clients at once, and any other computer. Export is STL only for now.

## Limitations

The numbers come from [docs/benchmarks.md](docs/benchmarks.md), measured on a **MacBook Pro M1 Pro with 16 GB RAM**. Nothing else has been tried.

- **Apple Silicon only.** One computer was tested. Windows, Intel Macs and NVIDIA are untested.
- **Soft details and thin parts.** Shapes are recognisable, but the robot loses its arms, the flamingo and the chair have very thin legs, and fur and knitting are smoothed out. On the teddy bear the 3D model is lumpier than the photo.
- **Small contact area with the bed.** When an object stands on thin tips, the flat base is small. On the chair it is about 6.4 mm². The report now warns about it, and `--plate 2` adds a plate (the chair then touches the bed with 942.8 mm²).
- **TripoSG is slow and big:** about 2 minutes per photo, about 7.9 GB download, a peak of about 7.5–9.5 GB of memory. Tried on 3 photos only (chair, watch, sofa). With `detailed`, a few small dots stay on flat areas after simplification.
- **TripoSG is our own rewrite.** Its original code contains parts under Tencent licences that exclude the EU, so the networks were rewritten for the MIT weights (decision 006). The numbers match the original, but the legal side has not been checked by a lawyer.
- **Nothing has been printed**, and the STL files have not been opened in a slicer. Validity (closed, correct size in mm) was only checked with the trimesh library.
- **Few test photos.** 7 in total: 5 clean renders and 2 real photos of public-domain objects. Bad photos (hard shadows, reflections, transparent objects) have not been tried.
- **The gram estimate is rough**, not a slicer result.
- **Timings (M1 Pro, "normal"):** about 16 s per photo on MPS (Apple's GPU) and about 21 s on the CPU, with peak memory of 3.7–4.3 GB. "fast" takes about 9 s, "detailed" about 22 s.
- **The download is large:** the model is about 1.7 GB and the Python environment (PyTorch) about 1.1 GB.

## Tests

```bash
cd engine
uv run pytest            # fast tests, no AI model
uv run pytest -m slow    # slow tests with the real model (weights must be downloaded)
uv run ruff check .
```

## Documents

- [docs/PLAN.md](docs/PLAN.md): the full plan and roadmap (Bulgarian)
- [docs/benchmarks.md](docs/benchmarks.md): measurements and findings (Bulgarian)
- [docs/decisions/](docs/decisions/): short explanations of the key decisions (Bulgarian)
- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute

## Third-party

- **TripoSG** (weights MIT, VAST-AI): the weights are downloaded from Hugging Face (`VAST-AI/TripoSG`). The network code is ours (`engines/triposg_net.py`), not copied from the TripoSG repository, see [decision 006](docs/decisions/006-triposg-own-code.md). The image encoder is DINOv2 (Apache-2.0), loaded with `transformers`.
- **TripoSR** (MIT): the code is vendored from [VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR), see `engine/src/photo3d_engine/engines/triposr_vendor/NOTICE.md`. The weights are downloaded from Hugging Face (`stabilityai/TripoSR`) on first run.
- **rembg** (MIT): removes the background of the photo.
- Libraries: PyTorch (BSD and Apache-2.0), transformers (Apache-2.0), trimesh (MIT), manifold3d (Apache-2.0), scikit-image (BSD-3-Clause).

The models you make are yours. Be careful with copyright when you photograph other people's figures or characters.

## License

[MIT](LICENSE), Copyright (c) 2026 Sarkis Demirdjian.
