"""Build the faceted Avicii head. Run with Blender --background --factory-startup --python scripts/build_avicii.py.
Adapted from scripts/build_aicher.py. Source assets are pinned and bundled locally (makehuman-avicii.zip holds the
young male CC0 targets from the same MakeHuman revision); this build makes no network requests.

The MakeHuman base mesh gets a young, slim man's proportions (long narrow face, hollow cheeks, pointed chin, strong
straight brows), wears a baseball cap backwards (a dark dome over the crown, the brim at the back), keeps only its neck - carried on down out of the frame - is decimated into large facets and written as
a small binary: low-poly positions, one relative morph per expression, triangles and a region per facet.
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
temporary_sources = tempfile.TemporaryDirectory(prefix='avicii-head-')
TMP = pathlib.Path(temporary_sources.name)
with zipfile.ZipFile(ROOT / 'scripts/model-source/makehuman-head.zip') as archive:
    archive.extractall(TMP)
with zipfile.ZipFile(ROOT / 'scripts/model-source/makehuman-avicii.zip') as archive:
    archive.extractall(TMP / 'avicii')
DATA = TMP / 'makehuman/data'
TARGETS = TMP / 'avicii/targets'
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
    'macrodetails/universal-male-young-averagemuscle-averageweight': 0.6,
    'macrodetails/universal-male-young-averagemuscle-minweight': 0.4,
    'macrodetails/caucasian-male-young': 1.0,
    # A long, narrow face with a pointed chin.
    'head/head-oval': 0.7,
    'head/head-scale-horiz-decr': 0.35,
    'head/head-scale-vert-incr': 0.25,
    'head/head-fat-decr': 0.5,
    'chin/chin-prominent-incr': 0.45,
    'chin/chin-width-decr': 0.45,
    'chin/chin-height-incr': 0.4,
    'cheek/l-cheek-inner-decr': 0.55,
    'cheek/r-cheek-inner-decr': 0.55,
    'cheek/l-cheek-bones-incr': 0.3,
    'cheek/r-cheek-bones-incr': 0.3,
    'cheek/l-cheek-trans-down': 0.2,
    'cheek/r-cheek-trans-down': 0.2,
    # A straight, narrow nose; a small mouth with a full lower lip.
    'nose/nose-scale-depth-incr': 0.3,
    'nose/nose-scale-vert-incr': 0.3,
    'nose/nose-scale-horiz-decr': 0.35,
    'nose/nose-point-width-decr': 0.4,
    'mouth/mouth-scale-horiz-decr': 0.3,
    # Strong straight brows low over deep-set eyes.
    'eyebrows/eyebrows-trans-down': 0.55,
    'eyebrows/eyebrows-trans-forward': 0.45,
    'eyebrows/eyebrows-angle-down': 0.2,
    'eyes/l-eye-scale-decr': 0.25,
    'eyes/r-eye-scale-decr': 0.25,
    'eyes/l-eye-trans-down': 0.15,
    'eyes/r-eye-trans-down': 0.15,
    'eyes/l-eye-bag-incr': 0.3,
    'eyes/r-eye-bag-incr': 0.3,
    'forehead/forehead-scale-vert-decr': 0.2,
    'neck/neck-scale-horiz-decr': 0.2,
    'ears/l-ear-wing-incr': 0.25,
    'ears/r-ear-wing-incr': 0.25,
}
neutral = base.copy()
for name, weight in SHAPE.items():
    neutral += target(TARGETS / (name + '.target'), len(base)) * weight

# Expressions as relative morphs.
POSES = {
    'smile': [('mouthSmileLeft', 0.75), ('mouthSmileRight', 0.75), ('cheekSquintLeft', 0.4), ('cheekSquintRight', 0.4),
              ('eyeSquintLeft', 0.3), ('eyeSquintRight', 0.3)],
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
# The middle of the skull, from the eyes.
head_center = np.array([0.0, eye_l[1] + 0.25, eye_l[2] - 0.8])

# --- head and neck ------------------------------------------------------------------------------------------------
# Below the jaw the neck is cut around its axis; a collar and shoulders are built onto the cut further down.
NECK_R = 0.8
NECK_Z = neck[2] + 0.1
# Heights relative to the neck joint.
NECK_CUT = neck[1] - 0.35
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



def boundary_loops(triangles):
    """Open edge loops of a triangle list, each in order."""
    edges = set()
    for t in triangles:
        for i in range(3):
            edges.add((t[i], t[(i + 1) % 3]))
    following = {a: b for (a, b) in edges if (b, a) not in edges}
    loops, seen = [], set()
    for start in following:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        while following[loop[-1]] != start:
            loop.append(following[loop[-1]])
            seen.add(loop[-1])
        loops.append(loop)
    return loops


# A clean, level edge where the collar will sit.
for loop in boundary_loops([t for t, part in zip(tris, tri_part) if part == 'skin']):
    if positions['neutral'][loop][:, 1].mean() < JAW_Y:
        for name in positions:
            positions[name][loop, 1] = NECK_CUT
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


# The cap is its own part (built after the facets): its opening lies on a tilted plane through the skull - high on
# the forehead, low at the nape, the way a cap worn backwards sits. In directions from the skull centre: d . CAP_N = CAP_C.
CAP_N = np.array([0.0, 1.0, -0.22]) / np.linalg.norm([0.0, 1.0, -0.22])
CAP_C = 0.02
CAP_THICK = 0.12


def hair_mask(points):
    """Short hair showing under the cap: a band below its edge at the sides and the back."""
    v = points - head_center
    d = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
    below = d @ CAP_N
    band = (below < CAP_C + 0.02) & (below > CAP_C - 0.24 - 0.2 * np.clip(-d[:, 2], 0, 1))
    return (band & (d[:, 2] < 0.1)).astype(float)


def region(points):
    """0 skin, 1 cap, 2 brow, 5 hair, 6 stubble (3 eye comes from the geometry it lies on)."""
    out = np.zeros(len(points), np.uint8)
    out[hair_mask(points) > 0.5] = 5
    # Dark stubble: over the upper lip, round the mouth, on the chin and along the jaw - not on the lips.
    x, y, z = np.abs(points[:, 0]), points[:, 1], points[:, 2]
    e = eye_l[1]
    front = z > eye_l[2] - 1.0
    lips = (y > e - 1.06) & (y < e - 0.86) & (x < 0.27)
    lip_top = (y > e - 0.86) & (y < e - 0.72) & (x < 0.3)
    jaw = (y < e - 0.9) & (y > e - 1.36) & ((x > 0.4 - (e - 0.9 - y) * 0.25) | (y < e - 1.12))
    stubble = front & ~lips & jaw
    out[stubble] = 6
    # Strong, straight eyebrows close over the eyes, a little lower at the outer ends.
    x = np.abs(points[:, 0])
    u = (x - (eye_l[0] + 0.03)) / 0.27
    arch = eye_l[1] + 0.16 - 0.04 * np.maximum(u, 0) ** 2
    thick = 0.06 * (1 - 0.25 * np.clip(u, 0, 1))
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

# --- collar and shoulders ----------------------------------------------------------------------------------------
# Built straight onto the low-poly neck edge, so their facets stay large and clean: just the neck, carried on down
# out of the frame - the portrait is the face.
SHOULDER_RINGS = [
    # (outward from the neck, height relative to the cut, widening to the sides, widening front/back)
    # No shoulders: the neck simply carries on down, a little wider, and leaves the frame.
    (0.0, -0.4, 0.02, 0.01),
    (0.01, -1.0, 0.05, 0.03),
    (0.02, -1.8, 0.08, 0.05),
    (0.02, -2.8, 0.1, 0.06),
]
neck_loop = min((loop for loop in boundary_loops(low_tris.tolist())), key=lambda loop: low[loop][:, 1].mean())
rim = low[neck_loop]
angle = np.arctan2(rim[:, 0], rim[:, 2] - NECK_Z)
out = np.column_stack([np.sin(angle), np.zeros(len(rim)), np.cos(angle)])
rings = []
for push, rise, wide, deep in SHOULDER_RINGS:
    ring = rim + out * push
    ring[:, 0] += out[:, 0] * wide
    ring[:, 2] += out[:, 2] * deep
    ring[:, 1] = NECK_CUT + rise
    rings.append(ring)
n = len(rim)
first = len(low)
low = np.vstack([low] + rings)
for name in POSES:
    morphs[name] = np.vstack([morphs[name], np.zeros((n * len(rings), 3))])
added, added_region = [], []
previous = neck_loop
for k in range(len(rings)):
    current = [first + k * n + i for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        # The new faces run along each edge the other way round.
        added += [[previous[j], previous[i], current[i]], [previous[j], current[i], current[j]]]
        added_region += [0, 0]
    previous = current
low_tris = np.vstack([low_tris, np.array(added)])
regions = np.concatenate([regions, np.array(added_region, np.uint8)])

# --- the cap: a dome on the tilted opening, and the brim at the back ---------------------------------------------
# Added last: the collar above finds the neck by the head's open edges, and the cap has open edges of its own.
def edge_elevation(azimuth):
    """Elevation of the cap's opening at an azimuth around the head (0 = front): solves d . CAP_N = CAP_C."""
    lo, hi = -1.2, 1.4
    for _ in range(40):
        mid = (lo + hi) / 2
        d = np.array([np.cos(mid) * np.sin(azimuth), np.sin(mid), np.cos(mid) * np.cos(azimuth)])
        if d @ CAP_N > CAP_C:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def on_cap(azimuth, elevation, out=CAP_THICK):
    """A point on the cap: cast from the skull centre onto the head, then stand off by the cap's thickness."""
    d = np.array([np.cos(elevation) * np.sin(azimuth), np.sin(elevation), np.cos(elevation) * np.cos(azimuth)])
    hit = tree.ray_cast(Vector(head_center), Vector(d))[0]
    return np.array(hit) + d * out


CAP_AROUND = 18
CAP_ROWS = 5
cap_points, cap_tris = [], []
grid = []
for r in range(CAP_ROWS + 1):
    row = []
    for k in range(CAP_AROUND):
        a = 2 * np.pi * k / CAP_AROUND
        e0 = edge_elevation(a)
        e = e0 + (np.pi / 2 - e0) * (r / (CAP_ROWS + 0.6))
        row.append(len(cap_points))
        cap_points.append(on_cap(a, e))
    grid.append(row)
crown = len(cap_points)
cap_points.append(on_cap(0.0, np.pi / 2 - 0.02))
cap_region = []
for r in range(CAP_ROWS):
    for k in range(CAP_AROUND):
        a0, a1 = grid[r][k], grid[r][(k + 1) % CAP_AROUND]
        b0, b1 = grid[r + 1][k], grid[r + 1][(k + 1) % CAP_AROUND]
        cap_tris += [[a0, a1, b0], [a1, b1, b0]]
        cap_region += [1, 1]
for k in range(CAP_AROUND):
    cap_tris.append([grid[CAP_ROWS][k], grid[CAP_ROWS][(k + 1) % CAP_AROUND], crown])
# A skirt from the opening into the scalp, so no gap shows under the edge.
skirt = []
for k in range(CAP_AROUND):
    a = 2 * np.pi * k / CAP_AROUND
    skirt.append(len(cap_points))
    cap_points.append(on_cap(a, edge_elevation(a), out=-0.05))
for k in range(CAP_AROUND):
    a0, a1 = grid[0][k], grid[0][(k + 1) % CAP_AROUND]
    s0, s1 = skirt[k], skirt[(k + 1) % CAP_AROUND]
    cap_tris += [[s0, s1, a0], [s1, a1, a0]]

# The brim: a rounded bill around the back, on the opening, reaching back and a little down.
BRIM_SPAN = 0.95
BRIM_LENGTH = 0.95
BRIM_SEG = 10
BRIM_THICK = 0.05
top_in, top_out = [], []
for k in range(BRIM_SEG + 1):
    across = k / BRIM_SEG * 2 - 1
    a = np.pi + across * BRIM_SPAN
    edge = on_cap(a, edge_elevation(a), out=CAP_THICK * 0.6)
    horiz = np.array([np.sin(a), 0.0, np.cos(a)])
    reach = 0.12 + BRIM_LENGTH * max(1 - across * across, 0.0) ** 0.45
    top_in.append(edge)
    top_out.append(edge + horiz * reach + np.array([0.0, -0.22 * reach - 0.06 * across * across, 0.0]))
base = len(cap_points)
m = BRIM_SEG + 1
down = np.array([0.0, -BRIM_THICK, 0.0])
cap_points += top_in + top_out + [p + down for p in top_in] + [p + down for p in top_out]
TI, TO, BI, BO = base, base + m, base + 2 * m, base + 3 * m
for k in range(BRIM_SEG):
    cap_tris += [[TI + k, TO + k, TI + k + 1], [TI + k + 1, TO + k, TO + k + 1]]          # top
    cap_tris += [[BI + k, BI + k + 1, BO + k], [BI + k + 1, BO + k + 1, BO + k]]          # underside
    cap_tris += [[TO + k, BO + k, TO + k + 1], [TO + k + 1, BO + k, BO + k + 1]]          # rim
for a_, b_ in ((TI, TO), (TI + BRIM_SEG, TO + BRIM_SEG)):                                # the two ends
    cap_tris += [[a_, a_ + 2 * m, b_], [b_, a_ + 2 * m, b_ + 2 * m]]

first_cap = len(low)
low = np.vstack([low, np.array(cap_points)])
for name in POSES:
    morphs[name] = np.vstack([morphs[name], np.zeros((len(cap_points), 3))])
low_tris = np.vstack([low_tris, np.array(cap_tris) + first_cap])
cap_region += [1] * (len(cap_tris) - len(cap_region))
regions = np.concatenate([regions, np.array(cap_region, np.uint8)])

# --- export -------------------------------------------------------------------------------------------------------
# Runtime units: the neck joint at the origin, one unit from chin to crown, +z towards the viewer.
SCALE = 1 / (head_top[1] - (eye_l[1] - 1.3))


def export(points):
    return ((points - np.array([0, neck[1], neck[2]])) * SCALE).astype(np.float32)


out_bin = ROOT / 'public/models/AviciiHead.bin'
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
    'regions': ['skin', 'cap', 'brow', 'eye', 'unused', 'hair', 'stubble'],
    'layout': 'float32 positions, float32 morph deltas in order, uint16 triangles, uint8 region per triangle',
    'eyeY': float(export(eye_l[None])[0, 1]),
    'chinY': float(export(np.array([[0, eye_l[1] - 1.3, 0]]))[0, 1]),
    'topY': float(export(head_top[None])[0, 1]),
    'sourceRevision': (TMP / 'avicii/revision.txt').read_text().strip(),
}
(ROOT / 'public/models/AviciiHead.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('AVICII_HEAD', json.dumps(metadata), 'bytes', out_bin.stat().st_size)
