"""Make the "photo -> 3D model" pictures for the README.

Run it from the repository root after making the models with the CLI:

    uv run --project engine photo3d make <photo.jpg> --height 60

    uv run --project engine python scripts/make_readme_images.py

It reads out/<name>/ (original photo, details/input_rgba.png and the STL) and writes one PNG
per model into docs/images/. The 3D view is drawn here with numpy and Pillow only: smooth
shading from the surface normals, no extra libraries.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

# folder in out/ -> file name in docs/images/
MODELS = {"teddy_steiff": "teddy.png", "garden_gnome": "gnome.png"}

BACKGROUND = (243, 243, 245)
CLAY = np.array([196, 202, 214], dtype=np.float64)
PANEL = 320
MAX_BYTES = 400 * 1024


def render_mesh(
    mesh: trimesh.Trimesh,
    size: int = PANEL,
    supersample: int = 3,
    azimuth_deg: float = -25.0,
    elevation_deg: float = 12.0,
) -> Image.Image:
    """Shaded orthographic picture of a Z-up mesh on a light background."""
    big = size * supersample
    azimuth, elevation = np.radians(azimuth_deg), np.radians(elevation_deg)

    # camera: looks at the model from this direction (azimuth 0 = from +X, the photo's front)
    toward_camera = np.array(
        [
            np.cos(elevation) * np.cos(azimuth),
            np.cos(elevation) * np.sin(azimuth),
            np.sin(elevation),
        ]
    )
    right = np.cross(-toward_camera, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, -toward_camera)

    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    centre = (vertices.max(axis=0) + vertices.min(axis=0)) / 2
    flat = np.column_stack([(vertices - centre) @ right, (vertices - centre) @ up])
    low, high = flat.min(axis=0), flat.max(axis=0)
    scale = 0.84 * big / max(high - low)
    middle = (low + high) / 2

    faces = np.asarray(mesh.faces)
    corners = vertices[faces]  # (n, 3, 3)
    centroids = corners.mean(axis=1)
    px = (((centroids - centre) @ right) - middle[0]) * scale + big / 2
    py = big / 2 - (((centroids - centre) @ up) - middle[1]) * scale
    depth = (centroids - centre) @ toward_camera

    # smooth shading: average of the three vertex normals of each face
    vertex_normals = np.asarray(mesh.vertex_normals)
    normals = vertex_normals[faces].mean(axis=1)
    normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-12

    light = 0.55 * toward_camera - 0.55 * right + 0.75 * up
    light /= np.linalg.norm(light)
    half = light + toward_camera
    half /= np.linalg.norm(half)
    diffuse = np.clip(normals @ light, 0, 1)
    specular = np.clip(normals @ half, 0, 1) ** 28 * 0.22
    rim = (1 - np.clip(normals @ toward_camera, 0, 1)) ** 3 * 0.10
    brightness = 0.34 + 0.72 * diffuse + rim
    colors = np.clip(CLAY[None, :] * brightness[:, None] + specular[:, None] * 255, 0, 255)

    # Only faces that look at the camera are drawn. Back faces would shine through the tiny
    # gaps between the splats below and look like dark noise.
    facing = np.asarray(mesh.face_normals) @ toward_camera > 0.0
    px, py, depth, colors = px[facing], py[facing], depth[facing], colors[facing]

    # splat every remaining face centroid on a 5x5 pixel block, keep the nearest per pixel
    pixel_ids, point_depth, point_color = [], [], []
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            x = np.round(px).astype(np.int64) + dx
            y = np.round(py).astype(np.int64) + dy
            inside = (x >= 0) & (x < big) & (y >= 0) & (y < big)
            pixel_ids.append(y[inside] * big + x[inside])
            point_depth.append(depth[inside])
            point_color.append(colors[inside])
    pixel_ids = np.concatenate(pixel_ids)
    point_depth = np.concatenate(point_depth)
    point_color = np.concatenate(point_color)
    order = np.lexsort((point_depth, pixel_ids))  # per pixel: far to near
    pixel_ids, point_color = pixel_ids[order], point_color[order]
    last_of_pixel = np.r_[pixel_ids[1:] != pixel_ids[:-1], True]  # the nearest point
    chosen, chosen_color = pixel_ids[last_of_pixel], point_color[last_of_pixel]

    rgba = np.zeros((big * big, 4), dtype=np.float64)
    rgba[chosen, :3] = chosen_color
    rgba[chosen, 3] = 255
    model = Image.fromarray(fill_pinholes(rgba.reshape(big, big, 4)), "RGBA")

    # a soft shadow under the model, so it does not float
    shadow = Image.new("L", (big, big), 0)
    bottom = int(big / 2 - (flat[:, 1].min() - middle[1]) * scale)
    half_width = int((high[0] - low[0]) * scale * 0.42)
    ImageDraw.Draw(shadow).ellipse(
        [big // 2 - half_width, bottom - big // 40, big // 2 + half_width, bottom + big // 40],
        fill=95,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(big / 60))

    picture = Image.new("RGBA", (big, big), BACKGROUND + (255,))
    picture.paste((90, 90, 100, 255), (0, 0), shadow)
    picture.alpha_composite(model)
    return picture.convert("RGB").resize((size, size), Image.Resampling.LANCZOS)


def fill_pinholes(rgba: np.ndarray, passes: int = 2) -> np.ndarray:
    """Fill single empty pixels that are surrounded by the model (a few are always left)."""
    rgba = rgba.copy()
    for _ in range(passes):
        filled = rgba[..., 3] > 0
        count = np.zeros(filled.shape, dtype=np.int32)
        total = np.zeros(rgba.shape[:2] + (3,), dtype=np.float64)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                shifted = np.roll(filled, (dy, dx), axis=(0, 1))
                count += shifted
                total += np.roll(rgba[..., :3], (dy, dx), axis=(0, 1)) * shifted[..., None]
        holes = ~filled & (count >= 5)
        rgba[holes, :3] = total[holes] / count[holes][:, None]
        rgba[holes, 3] = 255
    return np.clip(rgba, 0, 255).astype(np.uint8)


def fit_in_panel(image: Image.Image, size: int = PANEL) -> Image.Image:
    """Picture centred in a square panel with the same light background."""
    image = ImageOps.exif_transpose(image)
    if image.mode == "RGBA":
        backdrop = Image.new("RGBA", image.size, BACKGROUND + (255,))
        backdrop.alpha_composite(image)
        image = backdrop
    image = image.convert("RGB")
    image.thumbnail((size - 24, size - 24), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", (size, size), BACKGROUND)
    panel.paste(image, ((size - image.width) // 2, (size - image.height) // 2))
    return panel


def label(panel: Image.Image, text: str) -> Image.Image:
    strip = 34
    canvas = Image.new("RGB", (panel.width, panel.height + strip), BACKGROUND)
    canvas.paste(panel, (0, 0))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=15)
    width = draw.textlength(text, font=font)
    draw.text(((panel.width - width) / 2, panel.height + 8), text, fill=(70, 70, 80), font=font)
    return canvas


def save_small_png(image: Image.Image, path: Path) -> int:
    """Save as an optimised PNG, using fewer colours if it is over the size limit."""
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    for colors in (256, 192, 128, 96):
        if path.stat().st_size <= MAX_BYTES:
            break
        image.quantize(colors=colors, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)
    return path.stat().st_size


def make_row(folder: Path) -> Image.Image:
    stl = next(folder.glob("*.stl"), None)
    original = next(folder.glob("original.*"), None)
    cutout = folder / "details" / "input_rgba.png"
    if not (stl and original and cutout.exists()):
        raise FileNotFoundError(
            f"{folder} is incomplete. Make it first with: "
            "uv run --project engine photo3d make <photo> --height 60"
        )
    mesh = trimesh.load(stl)
    panels = [
        label(fit_in_panel(Image.open(original)), "Photo"),
        label(fit_in_panel(Image.open(cutout)), "Background removed"),
        label(render_mesh(mesh), "3D model (STL)"),
    ]
    row = Image.new("RGB", (PANEL * len(panels), panels[0].height), BACKGROUND)
    for index, panel in enumerate(panels):
        row.paste(panel, (index * PANEL, 0))
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=Path("out"), help="results folder")
    parser.add_argument("--images", type=Path, default=Path("docs/images"), help="where to write")
    args = parser.parse_args()

    for name, filename in MODELS.items():
        try:
            row = make_row(args.out / name)
        except FileNotFoundError as error:
            print(f"Error: {error}", file=sys.stderr)
            return 1
        size = save_small_png(row, args.images / filename)
        print(f"{args.images / filename}  {row.width}x{row.height}  {size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
