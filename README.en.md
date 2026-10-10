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

The **command line** works: you give it a photo and get a folder with a closed STL, plus a report with the size and the approximate grams of PLA. **There is no windowed app yet.** Next come a FastAPI server and an Electron app where you pick or drag a photo and see the model. The plan is in [docs/PLAN.md](docs/PLAN.md) (in Bulgarian).

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

Options: `--height` (mm), `--quality fast|normal|detailed`, `--device auto|cpu|mps|cuda`, `--no-remove-bg` (the photo already has its background removed).

At the end the same report is printed: closed or not, size in mm, volume, approximate grams of PLA, time per stage and peak memory.

## Limitations

The numbers come from [docs/benchmarks.md](docs/benchmarks.md), measured on a **MacBook Pro M1 Pro with 16 GB RAM**. Nothing else has been tried.

- **Apple Silicon only.** One computer was tested. Windows, Intel Macs and NVIDIA are untested.
- **Soft details and thin parts.** Shapes are recognisable, but the robot loses its arms, the flamingo and the chair have very thin legs, and fur and knitting are smoothed out. On the teddy bear the 3D model is lumpier than the photo.
- **Small contact area with the bed.** When an object stands on thin tips, the flat base is small. On the chair it is about 6.4 mm². A slicer will want a brim or supports for such a model.
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

- **TripoSR** (MIT): the code is vendored from [VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR), see `engine/src/photo3d_engine/engines/triposr_vendor/NOTICE.md`. The weights are downloaded from Hugging Face (`stabilityai/TripoSR`) on first run.
- **rembg** (MIT): removes the background of the photo.
- Libraries: PyTorch (BSD and Apache-2.0), transformers (Apache-2.0), trimesh (MIT), manifold3d (Apache-2.0), scikit-image (BSD-3-Clause).

The models you make are yours. Be careful with copyright when you photograph other people's figures or characters.

## License

[MIT](LICENSE), Copyright (c) 2026 Sarkis Demirdjian.
