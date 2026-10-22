"""Build the faceted Otl Aicher head. Run with Blender --background --factory-startup --python scripts/build_aicher.py.
Source assets are pinned and bundled locally; this build makes no network requests.

The MakeHuman base mesh gets an old man's proportions and Aicher's features (broad square head, high forehead,
heavy low brows, big nose, narrow hooded eyes, ears that stand out, wide jaw), is cut at the neck, decimated into
large facets and written as a small binary: low-poly positions, one relative morph per expression, triangles and a
region per facet (skin, hair, brow, eye, shirt) that the runtime shader colours.
"""
import bpy
import bmesh
import json
import pathlib
import tempfile
import zipfile
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils import Vector
from mathutils.geometry import barycentric_transform

ROOT = pathlib.Path(__file__).resolve().parents[1]
temporary_sources = tempfile.TemporaryDirectory(prefix='aicher-head-')
TMP = pathlib.Path(temporary_sources.name)
with zipfile.ZipFile(ROOT / 'scripts/model-source/makehuman-head.zip') as archive:
    archive.extractall(TMP)
with zipfile.ZipFile(ROOT / 'scripts/model-source/makehuman-aicher.zip') as archive:
    archive.extractall(TMP / 'aicher')
DATA = TMP / 'makehuman/data'
TARGETS = TMP / 'aicher/targets'
# Triangles of the finished head: large facets, but enough for a face to read.
FACETS = 2600


def read_obj(path):
    vertices, faces, groups = [], [], []
    group = ''
    for line in path.read_text().splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == 'v':
            vertices.append([float(x) for x in fields[1:4]])
        elif fields[0] == 'g':
            group = fields[1]
        elif fields[0] == 'f':
            faces.append([int(x.split('/')[0]) - 1 for x in fields[1:]])
            groups.append(group)
    return np.array(vertices), faces, groups


def target(path, count):
    delta = np.zeros((count, 3))
    for line in path.read_text().splitlines():
        fields = line.split()
        if fields and fields[0][0].isdigit():
            delta[int(fields[0])] = [float(x) for x in fields[1:4]]
    return delta


base, faces, groups = read_obj(DATA / '3dobjs/base.obj')

# --- likeness -----------------------------------------------------------------------------------------------------
SHAPE = {
    'macrodetails/universal-male-old-averagemuscle-averageweight': 0.7,
    'macrodetails/universal-male-old-averagemuscle-maxweight': 0.3,
    'macrodetails/caucasian-male-old': 1.0,
    'head/head-square': 0.8,
    'head/head-round': 0.3,
    'head/head-scale-horiz-incr': 0.6,
    'head/head-scale-vert-decr': 0.35,
    'head/head-scale-depth-incr': 0.2,
    'head/head-age-incr': 0.6,
    'head/head-fat-incr': 0.2,
    'forehead/forehead-scale-vert-incr': 0.5,
    'forehead/forehead-trans-backward': 0.2,
    'nose/nose-scale-vert-incr': 0.55,
    'nose/nose-scale-horiz-incr': 0.45,
    'nose/nose-scale-depth-incr': 0.4,
    'nose/nose-flaring-incr': 0.35,
    'nose/nose-point-width-incr': 0.5,
    'nose/nose-volume-incr': 0.35,
    'nose/nose-hump-incr': 0.2,
    'nose/nose-point-down': 0.25,
    'eyebrows/eyebrows-trans-down': 0.6,
    'eyebrows/eyebrows-trans-forward': 0.6,
    'eyebrows/eyebrows-angle-down': 0.3,
    'eyes/l-eye-height2-decr': 0.6,
    'eyes/r-eye-height2-decr': 0.6,
    'eyes/l-eye-bag-incr': 0.6,
    'eyes/r-eye-bag-incr': 0.6,
    'eyes/l-eye-eyefold-down': 0.5,
    'eyes/r-eye-eyefold-down': 0.5,
    'eyes/l-eye-scale-decr': 0.3,
    'eyes/r-eye-scale-decr': 0.3,
    'ears/l-ear-scale-incr': 0.5,
    'ears/r-ear-scale-incr': 0.5,
    'ears/l-ear-wing-incr': 0.5,
    'ears/r-ear-wing-incr': 0.5,
    'ears/l-ear-lobe-incr': 0.4,
    'ears/r-ear-lobe-incr': 0.4,
    'chin/chin-width-incr': 0.6,
    'chin/chin-prominent-incr': 0.3,
    'chin/chin-bones-incr': 0.4,
    'cheek/l-cheek-bones-incr': 0.35,
    'cheek/r-cheek-bones-incr': 0.35,
    'mouth/mouth-scale-horiz-incr': 0.4,
    'mouth/mouth-laugh-lines-out': 0.6,
    'mouth/mouth-upperlip-volume-decr': 0.5,
    'mouth/mouth-lowerlip-volume-decr': 0.3,
    'neck/neck-scale-horiz-incr': 0.4,
    'neck/neck-double-incr': 0.2,
    'torso/torso-scale-horiz-incr': 0.3,
}
neutral = base.copy()
for name, weight in SHAPE.items():
    neutral += target(TARGETS / (name + '.target'), len(base)) * weight

# Expressions as relative morphs. His smile closes the eyes to slits.
POSES = {
    'smile': [('mouthSmileLeft', 0.85), ('mouthSmileRight', 0.85), ('cheekSquintLeft', 0.7), ('cheekSquintRight', 0.7),
              ('eyeSquintLeft', 0.6), ('eyeSquintRight', 0.6)],
    'blink': [('eyeBlinkLeft', 1), ('eyeBlinkRight', 1)],
    'browUp': [('browInnerUp', 0.6), ('browOuterUpLeft', 0.6), ('browOuterUpRight', 0.6)],
    'browDown': [('browDownLeft', 0.7), ('browDownRight', 0.7)],
}
poses = {name: neutral + sum((target(TMP / ('faceunits/targets/faceunits/' + key + '.target'), len(base)) * weight
                              for key, weight in parts), np.zeros_like(base))
         for name, parts in POSES.items()}


def group_center(name):
    ids = sorted({i for f, g in zip(faces, groups) if g == name for i in f})
    return neutral[ids].mean(axis=0)


eye_l = group_center('joint-l-eye')
neck = group_center('joint-neck')
head_top = group_center('joint-head-2')
head_center = np.array([0.0, eye_l[1] + 0.25, 0.15])

# --- head and neck ------------------------------------------------------------------------------------------------
# Below the jaw the neck is cut into a column around its axis; the column then runs on straight down, out of the
# frame, like the necks of the other heads.
NECK_R = 0.8
NECK_Z = neck[2] + 0.1
# Heights relative to the neck joint: the old man's body is taller than the base mesh.
NECK_CUT = neck[1] - 0.35
NECK_END = neck[1] - 4.0
# Below this the skull ends; the shoulders rise no higher.
JAW_Y = neck[1] + 0.66


def inside(points):
    dz = points[:, 2] - NECK_Z
    r = np.hypot(points[:, 0], dz)
    # Room for the chin at the front; none for the shoulders at the sides and back.
    reach = NECK_R + 0.1 + 0.7 * np.maximum(0, dz / np.maximum(r, 1e-9))
    return (points[:, 1] > NECK_CUT) & ((points[:, 1] > JAW_Y) | (r < reach))


kept = []
for f, g in zip(faces, groups):
    if g == 'body' and np.all(inside(neutral[f])):
        kept.append((f, 'skin'))
    elif g in ('helper-l-eye', 'helper-r-eye'):
        kept.append((f, 'eye'))

ids = sorted({i for f, _ in kept for i in f})
remap = {old: new for new, old in enumerate(ids)}
positions = {'neutral': neutral[ids]}
positions.update({name: pose[ids] for name, pose in poses.items()})
tris, tri_part = [], []
for f, part in kept:
    f = [remap[i] for i in f]
    if len(f) == 4:
        a, b, c, d = f
        p = positions['neutral']
        # Split along the shorter diagonal.
        if np.linalg.norm(p[a] - p[c]) < np.linalg.norm(p[b] - p[d]):
            tris += [[a, b, c], [a, c, d]]
        else:
            tris += [[a, b, d], [b, c, d]]
        tri_part += [part, part]
    else:
        tris.append(f)
        tri_part.append(part)

# The open loop at the cut runs on down, rounding out into a straight column.
edge_count = {}
for t, part in zip(tris, tri_part):
    if part != 'skin':
        continue
    for i in range(3):
        a, b = t[i], t[(i + 1) % 3]
        edge_count[(a, b)] = edge_count.get((a, b), 0) + 1
boundary = {a: b for (a, b) in edge_count if (b, a) not in edge_count}
seen = set()
for start in list(boundary):
    if start in seen:
        continue
    loop = [start]
    seen.add(start)
    while boundary[loop[-1]] != start:
        loop.append(boundary[loop[-1]])
        seen.add(loop[-1])
    if positions['neutral'][loop][:, 1].mean() > JAW_Y:
        continue  # eye openings, mouth
    # A clean, level edge where the column starts.
    for name in positions:
        positions[name][loop, 1] = NECK_CUT
    first = len(positions['neutral'])
    rim = positions['neutral'][loop]
    n = len(loop)
    angle = np.arctan2(rim[:, 0], rim[:, 2] - NECK_Z)
    out = np.column_stack([np.sin(angle), np.zeros(n), np.cos(angle)])
    # The shirt collar: a small ledge out from the neck, then the column down.
    lip = rim + out * 0.12
    lip[:, 1] = NECK_CUT - 0.03
    bottom = out * (NECK_R + 0.15) + np.array([0, NECK_END, NECK_Z])
    for name in positions:
        positions[name] = np.vstack([positions[name], lip, bottom])
    for i in range(n):
        j = (i + 1) % n
        # The new faces run along each boundary edge the other way round.
        tris += [[loop[j], loop[i], first + i], [loop[j], first + i, first + j]]
        tris += [[first + j, first + i, first + n + i], [first + j, first + n + i, first + n + j]]
        tri_part += ['shirt'] * 4
tris = np.array(tris)


def vertex_normals(points):
    normals = np.zeros_like(points)
    face_n = np.cross(points[tris[:, 1]] - points[tris[:, 0]], points[tris[:, 2]] - points[tris[:, 0]])
    for i in range(3):
        np.add.at(normals, tris[:, i], face_n)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def hair_mask(points):
    """Short-cropped hair: high receding line at the front, down to the nape at the back."""
    v = points - head_center
    d = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
    front = smoothstep(0.1, 0.6, d[:, 2])
    back = smoothstep(0.0, 0.7, -d[:, 2])
    line = 0.08 + 0.5 * front - 0.55 * back
    return smoothstep(line - 0.04, line + 0.04, d[:, 1])


# The crop sits a few millimetres proud of the scalp.
skin_vertex = np.zeros(len(positions['neutral']), bool)
skin_vertex[np.unique(tris[[p == 'skin' for p in tri_part]])] = True
offset = vertex_normals(positions['neutral']) * (hair_mask(positions['neutral']) * skin_vertex)[:, None] * 0.07
for name in positions:
    positions[name] = positions[name] + offset


def region(points):
    """0 skin, 1 hair, 2 brow (3 eye and 4 shirt come from the geometry they lie on)."""
    out = np.zeros(len(points), np.uint8)
    out[hair_mask(points) > 0.5] = 1
    # Heavy, nearly straight eyebrows, a little lower at the outer ends.
    x = np.abs(points[:, 0])
    u = (x - (eye_l[0] + 0.03)) / 0.27
    arch = eye_l[1] + 0.17 - 0.05 * np.maximum(u, 0) ** 2
    thick = 0.095 * (1 - 0.3 * np.clip(u, 0, 1))
    brow = (np.abs(u) < 1.1) & (np.abs(points[:, 1] - arch) < thick) & (points[:, 2] > eye_l[2] - 0.35)
    out[brow] = 2
    return out


# --- facets -------------------------------------------------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
mesh = bpy.data.meshes.new('Bust')
mesh.from_pydata(positions['neutral'].tolist(), [], tris.tolist())
mesh.update()
obj = bpy.data.objects.new('Bust', mesh)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
decimate = obj.modifiers.new('Facets', 'DECIMATE')
decimate.decimate_type = 'COLLAPSE'
decimate.ratio = FACETS / len(tris)
decimate.use_symmetry = True
decimate.symmetry_axis = 'X'
decimate.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='Facets')
bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
low = np.array([v.co[:] for v in bm.verts])
low_tris = np.array([[v.index for v in f.verts] for f in bm.faces])
bm.free()

# Carry every morph over: each low vertex sits on a full-res triangle; it moves as that triangle moves.
full = positions['neutral']
tree = BVHTree.FromPolygons([Vector(p) for p in full], tris.tolist())


def locate(point):
    location, _, index, _ = tree.find_nearest(Vector(point))
    return location, index


morphs = {name: np.zeros_like(low) for name in POSES}
for i, point in enumerate(low):
    location, index = locate(point)
    a, b, c = (Vector(full[j]) for j in tris[index])
    for name in POSES:
        pa, pb, pc = (Vector(positions[name][j]) for j in tris[index])
        moved = barycentric_transform(location, a, b, c, pa, pb, pc)
        morphs[name][i] = np.array(moved) - np.array(location)

# One region per facet, from where its centre lies on the full head.
centres = low[low_tris].mean(axis=1)
regions = region(centres)
for k, centre in enumerate(centres):
    _, index = locate(centre)
    if tri_part[index] == 'eye':
        regions[k] = 3
    elif tri_part[index] == 'shirt':
        regions[k] = 4

# --- export -------------------------------------------------------------------------------------------------------
# Runtime units: the neck joint at the origin, one unit from chin to crown, +z towards the viewer.
SCALE = 1 / (head_top[1] - (eye_l[1] - 1.3))


def export(points):
    return ((points - np.array([0, neck[1], neck[2]])) * SCALE).astype(np.float32)


out_bin = ROOT / 'public/models/AicherHead.bin'
chunks = [export(low).ravel()] + [(morphs[name] * SCALE).astype(np.float32).ravel() for name in POSES]
with open(out_bin, 'wb') as handle:
    for chunk in chunks:
        handle.write(chunk.tobytes())
    handle.write(low_tris.astype(np.uint16).ravel().tobytes())
    handle.write(regions.astype(np.uint8).tobytes())
metadata = {
    'vertices': len(low),
    'triangles': len(low_tris),
    'morphs': list(POSES),
    'regions': ['skin', 'hair', 'brow', 'eye', 'shirt'],
    'layout': 'float32 positions, float32 morph deltas in order, uint16 triangles, uint8 region per triangle',
    'eyeY': float(export(eye_l[None])[0, 1]),
    'chinY': float(export(np.array([[0, eye_l[1] - 1.3, 0]]))[0, 1]),
    'topY': float(export(head_top[None])[0, 1]),
    'sourceRevision': (TMP / 'aicher/revision.txt').read_text().strip(),
}
(ROOT / 'public/models/AicherHead.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('AICHER_HEAD', json.dumps(metadata), 'bytes', out_bin.stat().st_size)
