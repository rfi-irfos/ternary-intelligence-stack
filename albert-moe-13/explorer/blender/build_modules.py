"""Build the albert. explorer glb modules (slab, slab_fusion, embed, lm_head).

Run (Blender 5.2, background):
    blender -b -P blender/build_modules.py -- public/data/architecture.json <outdir>

Coordinates: the glbs are exported with export_yup=False, so Blender X/Y/Z are
the three.js X/Y/Z of src/scene/tower.ts (slab centred at x=0, lanes at
y=-1.8 / +1.8, z=-1.2). Keep the constants below in sync with tower.ts.

Materials carry neutral base colours only. Runtime role colours are applied by
src/scene/palette.ts (override by material name: mod_*).
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

# --- mirrors of src/scene/tower.ts -------------------------------------------
SLAB_WIDTH = 6.0   # Y
SLAB_HEIGHT = 4.0  # Z
LANE_Y = {"A": -1.8, "B": 1.8}
LANE_Z = -1.2
GATE_X_OFFSET = 0.45
EXPERT_SIZE = 0.4
EXPERT_COLS, EXPERT_ROWS = 3, 4
SP = 0.7
OFFS = {"ln1": -1.0, "attn": -0.35, "ln2": 0.3, "router": 0.95}
EDGE = 0.02  # frame bar thickness


def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.5, metal=0.0, emit=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Alpha"].default_value = alpha
    if emit > 0:
        b.inputs["Emission Color"].default_value = (*rgb, 1.0)
        b.inputs["Emission Strength"].default_value = emit
    return m


def make_materials():
    return {
        "glass": mat("mod_glass", (0.56, 0.71, 1.0), rough=0.2, alpha=0.06),
        "edge": mat("mod_edge", (1.0, 1.0, 1.0), rough=0.4, emit=1.0),
        "expert": mat("mod_expert", (0.80, 0.84, 0.90), rough=0.45),
        "attn": mat("mod_attn", (0.80, 0.84, 0.90), rough=0.45),
        "router": mat("mod_router", (0.80, 0.84, 0.90), rough=0.35),
        "ln": mat("mod_ln", (0.80, 0.84, 0.90), rough=0.45),
        "gate": mat("mod_gate", (1.0, 1.0, 1.0), rough=0.3, emit=0.6),
        "end": mat("mod_end", (0.875, 0.90, 0.95), rough=0.45),
    }


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_obj(name, bm, material, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    return link(ob)


def box_bm(sx, sy, sz, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def octa_bm(r):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in
          [(r, 0, 0), (-r, 0, 0), (0, r, 0), (0, -r, 0), (0, 0, r), (0, 0, -r)]]
    px, nx, py, ny, pz, nz = vs
    for a, b in ((px, py), (py, nx), (nx, ny), (ny, px)):
        bm.faces.new((a, b, pz))
        bm.faces.new((b, a, nz))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def frame_bm(w, h, t):
    """Rectangular frame in the YZ plane, centred, bar thickness t."""
    bm = bmesh.new()
    hw, hh = w / 2, h / 2
    bars = [(0, -hh, w, t), (0, hh, w, t), (-hw, 0, t, h), (hw, 0, t, h)]
    for cy, cz, sy, sz in bars:
        sub = box_bm(t, sy, sz)
        for v in sub.verts:
            v.co.y += cy
            v.co.z += cz
        me = bpy.data.meshes.new("tmp")
        sub.to_mesh(me)
        sub.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    return bm


def glass_bm():
    bm = bmesh.new()
    hw, hh = SLAB_WIDTH / 2, SLAB_HEIGHT / 2
    vs = [bm.verts.new((0, y, z)) for y, z in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]
    bm.faces.new(vs)
    return bm


def gate_bm(radius=0.05, ring=6, seg=24):
    """Tube along the gate arc, origin at the arc midpoint (t=0.5).

    Arc (tower.ts gateArc, local to slab x): quadratic bezier
    P0=(0.45,-1.8,-1.2) P1=(0.45,0,2.6) P2=(0.45,1.8,-1.2).
    """
    p0 = Vector((GATE_X_OFFSET, LANE_Y["A"], LANE_Z))
    p1 = Vector((GATE_X_OFFSET, 0.0, 2.6))
    p2 = Vector((GATE_X_OFFSET, LANE_Y["B"], LANE_Z))
    pts = []
    for i in range(seg + 1):
        t = i / seg
        pts.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2)
    mid = gate_mid()
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        tan = (pts[min(i + 1, seg)] - pts[max(i - 1, 0)]).normalized()
        n1 = Vector((1, 0, 0))  # arc lies in a plane x=const, so X is normal to it
        n2 = tan.cross(n1).normalized()
        rings.append([bm.verts.new(p - mid + radius * (math.cos(a) * n1 + math.sin(a) * n2))
                      for a in [2 * math.pi * k / ring for k in range(ring)]])
    for i in range(seg):
        for k in range(ring):
            k2 = (k + 1) % ring
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def gate_mid():
    return Vector((GATE_X_OFFSET, 0.0, 0.25 * LANE_Z + 0.5 * 2.6 + 0.25 * LANE_Z))


def empty(name, loc):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = 0.1
    ob.location = loc
    return link(ob)


def build_slab(M, num_experts, fusion):
    mesh_obj("slab_glass", glass_bm(), M["glass"])
    mesh_obj("slab_frame", frame_bm(SLAB_WIDTH, SLAB_HEIGHT, EDGE), M["edge"])
    for e in range(num_experts):
        col = e % EXPERT_COLS
        row = (e // EXPERT_COLS) % EXPERT_ROWS
        loc = (0.0, (col - 1) * SP, (row - 1.5) * SP + 0.4)
        mesh_obj(f"slot_expert_{e:02d}", box_bm(EXPERT_SIZE, EXPERT_SIZE, EXPERT_SIZE, 0.015),
                 M["expert"], loc)
    for s in ("A", "B"):
        y = LANE_Y[s]
        mesh_obj(f"slot_ln1_{s}", box_bm(0.1, 0.4, 0.3), M["ln"], (OFFS["ln1"], y, LANE_Z))
        mesh_obj(f"slot_attn_{s}", box_bm(0.4, 0.5, 0.5, 0.02), M["attn"], (OFFS["attn"], y, LANE_Z))
        mesh_obj(f"slot_ln2_{s}", box_bm(0.1, 0.4, 0.3), M["ln"], (OFFS["ln2"], y, LANE_Z))
        mesh_obj(f"slot_router_{s}", octa_bm(0.2), M["router"], (OFFS["router"], y, LANE_Z))
        empty(f"lane_anchor_{s}", (0.0, y, LANE_Z))
    if fusion:
        mesh_obj("slot_gate", gate_bm(), M["gate"], tuple(gate_mid()))


def build_end(M, name):
    mesh_obj(name, box_bm(0.8, 3.2, 2.4, 0.03), M["end"])


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=False,
        export_apply=True, export_cameras=False, export_lights=False,
        export_materials="EXPORT", export_extras=False,
    )
    print("wrote", path, os.path.getsize(path))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    arch_path, outdir = argv[0], argv[1]
    with open(arch_path) as f:
        model = json.load(f)["model"]
    os.makedirs(outdir, exist_ok=True)
    ne = int(model["num_experts"])
    for fname, fn in (
        ("slab.glb", lambda M: build_slab(M, ne, False)),
        ("slab_fusion.glb", lambda M: build_slab(M, ne, True)),
        ("embed.glb", lambda M: build_end(M, "slot_embed")),
        ("lm_head.glb", lambda M: build_end(M, "slot_lm_head")),
    ):
        clean()
        fn(make_materials())
        export(os.path.join(outdir, fname))


main()
