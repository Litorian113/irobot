"""Build the CC0 VIKI head. Run with Blender --background --factory-startup --python scripts/build_head.py.
Source assets are pinned and bundled locally; this build makes no network requests.
"""
import bpy
import json
import pathlib
import tempfile
import zipfile
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
temporary_sources = tempfile.TemporaryDirectory(prefix='viki-head-')
TMP = pathlib.Path(temporary_sources.name)
with zipfile.ZipFile(ROOT / 'scripts/model-source/makehuman-head.zip') as archive:
    archive.extractall(TMP)
DATA = TMP / 'makehuman/data'


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
neutral = base.copy()
for name in ['caucasian-female-young', 'universal-female-young-averagemuscle-averageweight']:
    neutral += target(DATA / ('targets/macrodetails/' + name + '.target'), len(base))


def group_center(name):
    ids = sorted({i for f, g in zip(faces, groups) if g == name for i in f})
    return neutral[ids].mean(axis=0)


eye_l = group_center('joint-l-eye')
eye_r = group_center('joint-r-eye')
# The jaw rig's mouth joint is inside the upper oral cavity, not on the lips.
press = target(TMP / 'faceunits/targets/faceunits/mouthPressLeft.target', len(base))
lip_ids = np.argsort(np.linalg.norm(press, axis=1))[-12:]
mouth = neutral[lip_ids].mean(axis=0)
mouth[0] = 0
# Normalize using landmarks rather than inheriting the previous scan's transform.
scale = 0.38 / ((eye_l[1] + eye_r[1]) * 0.5 - mouth[1])
offset = np.array([0, mouth[1] - 0.11 / scale, 0.4])
REF = 0.29


def canonical(points):
    return (points - offset) * scale / REF


def blender_coords(points):
    p = canonical(points)
    return np.column_stack((p[:, 0], -p[:, 2], p[:, 1]))


# Keep skin topology through the upper neck, discard helpers and the rest of the body.
head_faces = [f for f, g in zip(faces, groups) if g == 'body' and min(neutral[i, 1] for i in f) > mouth[1] - 1.1]
ids = sorted({i for f in head_faces for i in f})
remap = {old: new for new, old in enumerate(ids)}
polygons = [[remap[i] for i in f] for f in head_faces]

# Each named pose is a relative glTF morph target with corresponding normals.
poses = {
    'jawOpen': [('jawOpen', 1)],
    'mouthWide': [('mouthStretchLeft', 0.6), ('mouthStretchRight', 0.6)],
    'mouthRound': [('mouthFunnel', 0.65), ('mouthPucker', 0.45)],
    'smile': [('mouthSmileLeft', 0.75), ('mouthSmileRight', 0.75)],
    'frown': [('mouthFrownLeft', 0.65), ('mouthFrownRight', 0.65)],
    'blinkLeft': [('eyeBlinkLeft', 1)],
    'blinkRight': [('eyeBlinkRight', 1)],
    'browUp': [('browInnerUp', 0.5), ('browOuterUpLeft', 0.55), ('browOuterUpRight', 0.55)],
    'browDown': [('browDownLeft', 0.65), ('browDownRight', 0.65)],
    'mouthClose': [('mouthClose', 1)],
    'mouthPress': [('mouthPressLeft', 0.65), ('mouthPressRight', 0.65)],
    'mouthPucker': [('mouthPucker', 1)],
    'mouthFunnel': [('mouthFunnel', 1)],
    'upperLipUp': [('mouthUpperUpLeft', 0.65), ('mouthUpperUpRight', 0.65)],
    'lowerLipDown': [('mouthLowerDownLeft', 0.65), ('mouthLowerDownRight', 0.65)],
    'lowerLipRoll': [('mouthRollLower', 1)],
}
deltas = {}
for name, parts in poses.items():
    deltas[name] = sum((target(TMP / ('faceunits/targets/faceunits/' + key + '.target'), len(base)) * weight for key, weight in parts), np.zeros_like(base))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def make_mesh(name, coordinates, polygons):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(coordinates.tolist(), [], polygons)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


skin = make_mesh('Face', blender_coords(neutral[ids]), polygons)
skin.shape_key_add(name='Basis')
for name, delta in deltas.items():
    key = skin.shape_key_add(name=name)
    coords = blender_coords((neutral + delta)[ids])
    key.data.foreach_set('co', coords.astype(np.float32).ravel())

# Bake one Catmull-Clark subdivision for each pose so morphs retain the same topology.
subd = skin.modifiers.new('Smooth anatomy', 'SUBSURF')
subd.levels = 1
subd.render_levels = 1
depsgraph = bpy.context.evaluated_depsgraph_get()
subdivided = []
baked_faces = None
for name in ['Basis'] + list(poses):
    for key in skin.data.shape_keys.key_blocks:
        if key.name != 'Basis':
            key.value = 1.0 if key.name == name else 0.0
    bpy.context.view_layer.update()
    evaluated = skin.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    coords = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', coords)
    subdivided.append(coords.reshape((-1, 3)).copy())
    if baked_faces is None:
        baked_faces = [list(poly.vertices) for poly in mesh.polygons]
    evaluated.to_mesh_clear()
bpy.data.objects.remove(skin, do_unlink=True)
skin = make_mesh('Face', subdivided[0], baked_faces)
skin.shape_key_add(name='Basis')
for name, coordinates in zip(poses, subdivided[1:]):
    key = skin.shape_key_add(name=name)
    key.data.foreach_set('co', coordinates.ravel())

# Fit actual eyeballs using the official barycentric proxy mapping after the female morph.
eye_vertices, eye_faces, _ = read_obj(DATA / 'eyes/high-poly/high-poly.obj')
proxy_lines = (DATA / 'eyes/high-poly/high-poly.mhclo').read_text().splitlines()
proxy_scale = np.ones(3)
start = 0
for idx, line in enumerate(proxy_lines):
    fields = line.split()
    if not fields:
        continue
    if fields[0] in ('x_scale', 'y_scale', 'z_scale'):
        axis = 'xyz'.index(fields[0][0])
        a, b, denominator = int(fields[1]), int(fields[2]), float(fields[3])
        proxy_scale[axis] = abs(neutral[a, axis] - neutral[b, axis]) / denominator
    if fields[0] == 'verts':
        start = idx + 1
        break
fitted = []
for line in proxy_lines[start:]:
    fields = line.split()
    if len(fields) != 9 or not fields[0].isdigit():
        break
    refs = [int(x) for x in fields[:3]]
    weights = np.array([float(x) for x in fields[3:6]])
    displacement = np.array([float(x) for x in fields[6:9]]) * proxy_scale
    fitted.append((neutral[refs] * weights[:, None]).sum(axis=0) + displacement)
assert len(fitted) == len(eye_vertices), (len(fitted), len(eye_vertices))
eyes = make_mesh('Eyes', blender_coords(np.array(fitted)), eye_faces)

# A recessed mouth interior prevents a view into the hollow head when the lips part.
# It stays below the upper lip and follows half the jaw's opening.
mouth_local = canonical(np.array([mouth]))[0]
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16)
oral = bpy.context.object
oral.name = 'MouthInterior'
oral.location = (mouth_local[0], -(mouth_local[2] - 0.75), mouth_local[1] - 0.13)
oral.scale = (0.65, 0.25, 0.45)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for poly in oral.data.polygons:
    poly.use_smooth = True
oral.shape_key_add(name='Basis')
key = oral.shape_key_add(name='jawOpen')
for v in key.data:
    v.co.z -= 0.18

# Material names are semantic: the runtime uses one coordinated data material per part.
for obj, name, color in [(skin, 'Skin', (0.55, 0.55, 0.55, 1)), (eyes, 'Eyes', (0.32, 0.32, 0.32, 1)), (oral, 'MouthInterior', (0.015, 0.015, 0.02, 1))]:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    obj.data.materials.append(mat)
    obj['vikiPart'] = name

bpy.ops.object.select_all(action='DESELECT')
for obj in [skin, eyes, oral]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = skin
out = ROOT / 'public/models/VikiHead.glb'
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
    export_yup=True, export_morph=True, export_morph_normal=True, export_extras=True,
    export_animations=False, export_texcoords=False, export_normals=True)
metadata = {
    'referenceScale': REF,
    'eyeX': float(abs(canonical(np.array([eye_l]))[0, 0]) * REF),
    'eyeY': 0.49,
    'eyeZ': float(canonical(np.array([eye_l]))[0, 2] * REF),
    'mouthY': 0.11,
    'sourceRevision': (TMP / 'revision.txt').read_text(),
    'morphs': list(poses),
    'sourceVertices': len(ids),
    'vertices': len(skin.data.vertices),
}
(ROOT / 'public/models/VikiHead.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('VIKI_MODEL', json.dumps(metadata), 'bytes', out.stat().st_size)
