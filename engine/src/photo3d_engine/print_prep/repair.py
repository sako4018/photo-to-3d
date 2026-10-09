"""Light mesh repair with trimesh. If this is not enough, voxel_remesh takes over."""

from __future__ import annotations

import numpy as np
import trimesh


def is_printable(mesh: trimesh.Trimesh) -> bool:
    """Closed, every edge shared by two faces, consistent winding and positive volume."""
    return bool(mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0)


def fill_boundary_loops(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Close every open boundary loop with a triangle fan around the loop's centre.

    trimesh's own fill_holes only handles holes of 3-4 edges. A fan is a good fit for the
    usual AI-mesh case: one roughly flat opening (the back or the bottom of the object).
    """
    edge_rows = trimesh.grouping.group_rows(mesh.edges_sorted, require_count=1)
    if len(edge_rows) == 0:
        return mesh

    # each open edge as it appears in its one face: a -> b
    open_edges = mesh.edges[edge_rows]
    loops = trimesh.graph.connected_components(open_edges, min_len=1)

    vertices = [np.asarray(mesh.vertices)]
    faces = [np.asarray(mesh.faces)]
    next_index = len(mesh.vertices)
    loop_of_vertex = {}
    for loop_id, nodes in enumerate(loops):
        for node in nodes:
            loop_of_vertex[int(node)] = loop_id

    centres = np.array([mesh.vertices[nodes].mean(axis=0) for nodes in loops])
    vertices.append(centres)
    # the filling triangle runs b -> a so that it joins the mesh with a consistent winding
    loop_ids = np.array([loop_of_vertex[int(a)] for a in open_edges[:, 0]])
    fan = np.column_stack([open_edges[:, 1], open_edges[:, 0], next_index + loop_ids])
    faces.append(fan)

    return trimesh.Trimesh(np.vstack(vertices), np.vstack(faces), process=False)


def repair(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Merge vertices, drop broken faces, fix normals and close holes.

    Returns a new mesh. It may still be not watertight (e.g. self-intersections).
    """
    fixed = mesh.copy()
    fixed.merge_vertices()
    fixed.update_faces(fixed.nondegenerate_faces())
    fixed.update_faces(fixed.unique_faces())
    fixed.remove_unreferenced_vertices()

    trimesh.repair.fix_winding(fixed)
    trimesh.repair.fill_holes(fixed)  # tiny triangle/quad holes
    fixed = fill_boundary_loops(fixed)  # everything bigger
    trimesh.repair.fix_normals(fixed)
    trimesh.repair.fix_inversion(fixed)
    return fixed
