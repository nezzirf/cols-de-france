import bpy, sys, math
from mathutils import Vector, Matrix, kdtree

# Mannequin Mixamo (FBX avec squelette) -> glb au même contrat d'os que le cycliste du jeu.
SRC, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
HEIGHT = 1.75

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
body = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
rig = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
# Le fichier garde une animation et une pose (en centimètres) : on revient à la pose de repos, qui est celle du maillage.
rig.animation_data_clear()
body.animation_data_clear()
for act in list(bpy.data.actions):
    bpy.data.actions.remove(act)
for pb in rig.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.rotation_euler = (0, 0, 0)
    pb.scale = (1, 1, 1)

def stage(tag):
    zs = [v.co.z for v in body.data.vertices]
    ys = [v.co.y for v in body.data.vertices]
    hips = [tuple(round(x, 3) for x in (rig.matrix_world @ b.head_local)) for b in rig.data.bones if b.name.endswith('Hips') or b.name == 'pelvis']
    print('STAGE', tag, 'z', round(min(zs), 3), round(max(zs), 3), 'y', round(min(ys), 3), round(max(ys), 3), 'rig', tuple(round(x, 3) for x in rig.location), tuple(round(x, 3) for x in rig.scale), hips)


# Repère du monde (mètres, Z vers le haut, visage vers -Y) : on retire le parent puis on fige les transformations.
mw = body.matrix_world.copy()
body.parent = None
body.matrix_world = mw
bpy.ops.object.select_all(action='DESELECT')
for o in (body, rig):
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()
stage('apply1')

# Taille et pieds au sol : les deux objets sont mis à l'échelle ensemble.
zs = [v.co.z for v in body.data.vertices]
zmin, zmax = min(zs), max(zs)
k = HEIGHT / (zmax - zmin)
for o in (body, rig):
    o.scale = (k, k, k)
    o.location = (0, 0, -zmin * k)
bpy.ops.object.select_all(action='DESELECT')
for o in (body, rig):
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()
stage('apply2')

# Noms d'os : ceux attendus par le jeu.
NAMES = {
    'Hips': 'pelvis', 'Spine': 'spine_01', 'Spine1': 'spine_02', 'Spine2': 'spine_03', 'Neck': 'neck_01', 'Head': 'Head',
}
for s, side in (('Left', 'l'), ('Right', 'r')):
    NAMES.update({
        f'{s}Shoulder': f'clavicle_{side}', f'{s}Arm': f'upperarm_{side}', f'{s}ForeArm': f'lowerarm_{side}', f'{s}Hand': f'hand_{side}',
        f'{s}UpLeg': f'thigh_{side}', f'{s}Leg': f'calf_{side}', f'{s}Foot': f'foot_{side}', f'{s}ToeBase': f'ball_{side}',
    })
    for mix, ours in (('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky'), ('Thumb', 'thumb')):
        for n in (1, 2, 3):
            NAMES[f'{s}Hand{mix}{n}'] = f'{ours}_{n:02d}_{side}'

DROP = [b.name for b in rig.data.bones if b.name.split(':')[-1].endswith('_End') or b.name.split(':')[-1].endswith('4')]

# Poids : la troisième phalange des doigts rejoint la deuxième (le jeu en plie deux).
def merge_group(src, dst):
    if src not in body.vertex_groups or dst not in body.vertex_groups:
        return
    gs, gd = body.vertex_groups[src], body.vertex_groups[dst]
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == gs.index:
                gd.add([v.index], g.weight, 'ADD')
    body.vertex_groups.remove(gs)

for s, side in (('Left', 'l'), ('Right', 'r')):
    for mix in ('Index', 'Middle', 'Ring', 'Pinky'):
        merge_group(f'mixamorig1:{s}Hand{mix}3', f'mixamorig1:{s}Hand{mix}2')
    # Pouce : les trois os restent, rigides avec la main.

for name in DROP:
    if name in body.vertex_groups:
        body.vertex_groups.remove(body.vertex_groups[name])

bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
for name in DROP + [f'mixamorig1:{s}Hand{m}3' for s in ('Left', 'Right') for m in ('Index', 'Middle', 'Ring', 'Pinky')]:
    if name in eb:
        eb.remove(eb[name])
bpy.ops.object.mode_set(mode='OBJECT')

for b in list(rig.data.bones):
    short = b.name.split(':')[-1]
    new = NAMES.get(short)
    if not new:
        print('SANS NOM', b.name)
        continue
    if b.name in body.vertex_groups:
        body.vertex_groups[b.name].name = new
    b.name = new
for g in list(body.vertex_groups):
    if g.name.startswith('mixamorig'):
        print('GROUPE ORPHELIN', g.name)

# Les points tirent encore leurs poids des os supprimés : renormalise.
bpy.context.view_layer.objects.active = body
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)

# Bras le long du corps comme le personnage d'origine (les zones du maillot en dépendent), puis « cuits » dans la
# pose du vélo ; la pose le long du corps reste en forme « apose ».
orig_co = None


def aim_bone(pb, direction):
    cur = (pb.tail - pb.head).normalized()
    q = cur.rotation_difference(direction.normalized())
    T = Matrix.Translation(pb.head.copy())
    pb.matrix = T @ q.to_matrix().to_4x4() @ T.inverted() @ pb.matrix
    bpy.context.view_layer.update()


def pose_and_bake(arms, keep_rest):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for s, sx in (('l', 1), ('r', -1)):
        up, low = arms
        aim_bone(rig.pose.bones[f'upperarm_{s}'], Vector((up[0] * sx, up[1], up[2])))
        aim_bone(rig.pose.bones[f'lowerarm_{s}'], Vector((low[0] * sx, low[1], low[2])))
    bpy.context.view_layer.update()
    print('POSE hips', [tuple(round(x, 3) for x in (rig.matrix_world @ b.head)) for b in rig.pose.bones if b.name == 'pelvis'], 'upperarm', rig.pose.bones['upperarm_l'].head[:], rig.pose.bones['upperarm_l'].tail[:])
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    posed = [v.co.copy() for v in me.vertices]
    ev.to_mesh_clear()
    print('POSED z', min(p.z for p in posed), max(p.z for p in posed))
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode='OBJECT')
    for i, v in enumerate(body.data.vertices):
        v.co = posed[i]
    body.data.update()
    return posed


# Parenté à l'armature : un seul modificateur d'armature, avec les groupes de points existants.
body.modifiers.clear()
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE')

stage('parented')
pose_and_bake(((0.52, 0.0, -0.85), (0.48, -0.05, -0.88)), False)
orig_co = [v.co.copy() for v in body.data.vertices]
stage('apose')
pose_and_bake(((0.02, -0.99, -0.14), (-0.07, -0.99, -0.12)), True)
bpy.context.view_layer.objects.active = body
body.shape_key_add(name='Basis')
apose = body.shape_key_add(name='apose')
for i, d in enumerate(apose.data):
    d.co = orig_co[i]

body.name = 'SuperHero_Male'
m = bpy.data.materials.new('skin')
m.use_nodes = True
b = m.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.62, 0.40, 0.29, 1)
b.inputs['Roughness'].default_value = 0.62
body.data.materials.clear()
body.data.materials.append(m)
for p in body.data.polygons:
    p.use_smooth = True

# Chaussures : coque autour du pied (même méthode que le cycliste d'origine), poids copiés du pied.
import bmesh
vs = list(orig_co)
shoes = body.copy()
shoes.data = body.data.copy()
shoes.name = 'Shoes'
bpy.context.scene.collection.objects.link(shoes)
shoes.shape_key_clear()
shoes.data.materials.clear()
mats = {}
for name, col, rough in (('shoe_upper', (0.92, 0.92, 0.9), 0.35), ('shoe_sole', (0.03, 0.03, 0.035), 0.6)):
    m2 = bpy.data.materials.new(name)
    m2.use_nodes = True
    b2 = m2.node_tree.nodes['Principled BSDF']
    b2.inputs['Base Color'].default_value = (*col, 1)
    b2.inputs['Roughness'].default_value = rough
    shoes.data.materials.append(m2)
    mats[name] = len(shoes.data.materials) - 1
SHOE_TOP = 0.088
body_groups = {i: g.name for i, g in enumerate(body.vertex_groups)}
tree = kdtree.KDTree(len(vs))
for i, p in enumerate(vs):
    tree.insert(p, i)
tree.balance()
# Le corps est déjà en pose « vélo » : la zone du pied (jambes inchangées) se lit sur les points d'origine.
bm = bmesh.new()
for side in (1, -1):
    pts = [p for p in vs if p.z < SHOE_TOP and p.x * side > 0.02]
    hull_bm = bmesh.new()
    for p in pts:
        hull_bm.verts.new(p)
    res = bmesh.ops.convex_hull(hull_bm, input=hull_bm.verts, use_existing_faces=False)
    interior = res['geom_interior'] + res['geom_unused']
    bmesh.ops.delete(hull_bm, geom=list({g for g in interior if isinstance(g, bmesh.types.BMVert)}), context='VERTS')
    hull_bm.verts.ensure_lookup_table()
    hull_bm.faces.ensure_lookup_table()
    bmesh.ops.subdivide_edges(hull_bm, edges=hull_bm.edges[:], cuts=5, use_grid_fill=True, use_smooth_even=True)
    hull_bm.normal_update()
    for v in hull_bm.verts:
        v.co += v.normal * 0.007
    for _ in range(4):
        bmesh.ops.smooth_vert(hull_bm, verts=hull_bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in hull_bm.verts:
        v.co.z = max(v.co.z, 0.0)
    tmp = bpy.data.meshes.new('tmp')
    hull_bm.to_mesh(tmp)
    hull_bm.free()
    bm.from_mesh(tmp)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()
bm.normal_update()
for f in bm.faces:
    f.material_index = mats['shoe_sole'] if max(v.co.z for v in f.verts) < 0.024 else mats['shoe_upper']
bm.to_mesh(shoes.data)
bm.free()
for p in shoes.data.polygons:
    p.use_smooth = True
shoes.data.update()
shoes.vertex_groups.clear()
for g in body_groups.values():
    shoes.vertex_groups.new(name=g)
for i, v in enumerate(shoes.data.vertices):
    _, near, _ = tree.find(v.co)
    for g in body.data.vertices[near].groups:
        shoes.vertex_groups[body_groups[g.group]].add([i], g.weight, 'REPLACE')

# Yeux : le mannequin n'en a pas ; deux petites sphères cachées sous la peau donnent au jeu la hauteur des yeux
# (pour les lunettes).
head_idx = body.vertex_groups['Head'].index
head_v = [orig_co[v.index] for v in body.data.vertices if any(g.group == head_idx and g.weight > 0.5 for g in v.groups)]
top = max(p.z for p in head_v)
chin = min(p.z for p in head_v)
face_y = min(p.y for p in head_v)
eye_z = chin + 0.56 * (top - chin)
print('HEAD', chin, top, 'eye', eye_z, 'face_y', face_y)
eyes = []
for sx in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.004, location=(sx * 0.032, face_y + 0.05, eye_z))
    eyes.append(bpy.context.object)
bpy.ops.object.select_all(action='DESELECT')
for e in eyes:
    e.select_set(True)
bpy.context.view_layer.objects.active = eyes[0]
bpy.ops.object.join()
eye = bpy.context.object
eye.name = 'Eyes'
em = bpy.data.materials.new('eye')
em.use_nodes = True
eye.data.materials.append(em)
vg = eye.vertex_groups.new(name='Head')
vg.add([v.index for v in eye.data.vertices], 1.0, 'REPLACE')
eye.parent = rig
mod = eye.modifiers.new('Armature', 'ARMATURE')
mod.object = rig

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=False, export_animations=False, export_skins=True, export_morph=True,
                          export_morph_normal=False)
print('EXPORTED', OUT)
