"""Turn a print-ready STL into the small binary mesh the website (site/) loads.

Usage (from the project folder):
    engine/.venv/bin/python scripts/export_site_mesh.py INPUT.stl OUTPUT.bin [--faces 36000]

The mesh is simplified, centred on x/y, placed on z=0 and scaled so its largest side is 1.
File layout (little endian): uint32 vertex count, uint32 face count,
float32 xyz per vertex, uint32 triple per face.
"""

import argparse

import fast_simplification
import numpy as np
import trimesh


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--faces", type=int, default=36000)
    args = parser.parse_args()

    mesh = trimesh.load(args.input)
    mesh.merge_vertices()
    verts, faces = fast_simplification.simplify(
        mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_count=args.faces
    )
    centre = np.array(
        [
            (verts[:, 0].min() + verts[:, 0].max()) / 2,
            (verts[:, 1].min() + verts[:, 1].max()) / 2,
            verts[:, 2].min(),
        ]
    )
    verts = verts - centre
    verts = verts / (verts.max(axis=0) - verts.min(axis=0)).max()
    with open(args.output, "wb") as out:
        out.write(np.array([len(verts), len(faces)], dtype="<u4").tobytes())
        out.write(verts.astype("<f4").tobytes())
        out.write(faces.astype("<u4").tobytes())
    print(f"{args.output}: {len(verts)} vertices, {len(faces)} faces")


if __name__ == "__main__":
    main()
