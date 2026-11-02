import bpy, sys, math
from mathutils import Vector

SRC, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
HEIGHT = 1.75
SMOOTH = int(sys.argv[sys.argv.index('--') + 3]) if len(sys.argv) > sys.argv.index('--') + 3 else 6

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
body = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]

# Met le maillage au repère du monde, retire les parents et vide.
mw = body.matrix_world.copy()
body.parent = None
body.matrix_world = mw
for o in list(bpy.context.scene.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o)
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Taille et pieds au sol.
vs = [v.co.copy() for v in body.data.vertices]
zmin = min(v.z for v in vs); zmax = max(v.z for v in vs)
k = HEIGHT / (zmax - zmin)
for v in body.data.vertices:
    v.co = Vector((v.co.x * k, v.co.y * k, (v.co.z - zmin) * k))
body.data.update()
vs = [v.co.copy() for v in body.data.vertices]
print('HEIGHT', max(v.z for v in vs), 'scale', k)


def center(zlo, zhi, xlo, xhi):
    sel = [v for v in vs if zlo <= v.z <= zhi and xlo <= v.x <= xhi]
    n = len(sel)
    return Vector((sum(v.x for v in sel) / n, sum(v.y for v in sel) / n, (zlo + zhi) / 2)), n

# Jambes : x>0 est le côté « _l ». Le centre de chaque tranche donne la ligne de la jambe.
def leg_pt(z, lo=0.02):
    c, _ = center(z - 0.02, z + 0.02, lo, 0.2)
    return c

H = HEIGHT
def zz(f): return f * H

hip_l = leg_pt(zz(0.545)); hip_l.z = zz(0.545)
knee_l = leg_pt(zz(0.295))
ankle_l = leg_pt(zz(0.055))
# pointe du pied : devant (y négatif) du pied au niveau du sol
foot = [v for v in vs if v.z < 0.06 and v.x > 0.0]
toe_y = min(v.y for v in foot)
heel_y = max(v.y for v in foot)
ball_l = Vector((ankle_l.x, toe_y + 0.07, 0.025))
toe_l = Vector((ankle_l.x, toe_y + 0.01, 0.02))
print('LEG', hip_l, knee_l, ankle_l, ball_l)

# Tronc
mid_y = lambda z: center(z - 0.03, z + 0.03, -0.2, 0.2)[0].y
pelvis = Vector((0, mid_y(zz(0.55)), zz(0.555)))
spine1 = Vector((0, mid_y(zz(0.62)), zz(0.62)))
spine2 = Vector((0, mid_y(zz(0.70)), zz(0.70)))
spine3 = Vector((0, mid_y(zz(0.78)), zz(0.78)))
neck = Vector((0, mid_y(zz(0.85)), zz(0.845)))
head = Vector((0, mid_y(zz(0.885)) - 0.0, zz(0.885)))
head_top = Vector((0, mid_y(zz(0.99)), zz(0.99)))

# Bras : ligne de l'os mesurée dans la zone x > 0.20
def arm_pt(z):
    sel = [v for v in vs if abs(z - v.z) < 0.02 and v.x > 0.24]
    return Vector((sum(v.x for v in sel) / len(sel), sum(v.y for v in sel) / len(sel), z))
shoulder_l = Vector((0.20, spine3.y, zz(0.81)))
sh_arm = arm_pt(zz(0.81))
upper_l = Vector((max(0.24, sh_arm.x - 0.02), sh_arm.y, zz(0.81)))
elbow_l = arm_pt(zz(0.665))
wrist_l = arm_pt(zz(0.53))
hand_tip = max(vs, key=lambda v: v.x)
hand_l = Vector((hand_tip.x, hand_tip.y, hand_tip.z))
# Doigts : quatre files côte à côte (selon y), de la paume jusqu'au bout des doigts, deux os chacune.
fing = [v for v in vs if v.x > 0.44 and v.z < 0.82]
fy0, fy1 = min(v.y for v in fing), max(v.y for v in fing)
fx = sum(v.x for v in fing) / len(fing)
FZ = (0.832, 0.806, min(v.z for v in fing))
FINGERS = ['index', 'middle', 'ring', 'pinky']
fy = [fy0 + (i + 0.5) * (fy1 - fy0) / 4 for i in range(4)]
palm_end = Vector((fx, (fy0 + fy1) / 2, FZ[0]))
print('ARM', upper_l, elbow_l, wrist_l, hand_l)

arm = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('Armature', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.edit_bones

def bone(name, head_p, tail_p, parent=None, connect=False):
    b = eb.new(name)
    b.head = head_p
    b.tail = tail_p
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    return b

def mirror(v): return Vector((-v.x, v.y, v.z))

root = bone('root', Vector((0, pelvis.y, 0)), Vector((0, pelvis.y, 0.1)))
bone('pelvis', pelvis, spine1, 'root')
bone('spine_01', spine1, spine2, 'pelvis', True)
bone('spine_02', spine2, spine3, 'spine_01', True)
bone('spine_03', spine3, neck, 'spine_02', True)
bone('neck_01', neck, head, 'spine_03', True)
bone('Head', head, head_top, 'neck_01', True)
for s, f in (('l', lambda v: v), ('r', mirror)):
    cl = f(Vector((0.04, spine3.y, zz(0.82))))
    bone(f'clavicle_{s}', cl, f(upper_l), 'spine_03')
    bone(f'upperarm_{s}', f(upper_l), f(elbow_l), f'clavicle_{s}', True)
    bone(f'lowerarm_{s}', f(elbow_l), f(wrist_l), f'upperarm_{s}', True)
    bone(f'hand_{s}', f(wrist_l), f(palm_end), f'lowerarm_{s}', True)
    for name, y in zip(FINGERS, fy):
        pa = f(Vector((fx, y, FZ[0])))
        pb = f(Vector((fx, y, FZ[1])))
        pc = f(Vector((fx, y, FZ[2])))
        bone(f'{name}_01_{s}', pa, pb, f'hand_{s}')
        bone(f'{name}_02_{s}', pb, pc, f'{name}_01_{s}', True)
    bone(f'thigh_{s}', f(hip_l), f(knee_l), 'pelvis')
    bone(f'calf_{s}', f(knee_l), f(ankle_l), f'thigh_{s}', True)
    bone(f'foot_{s}', f(ankle_l), f(ball_l), f'calf_{s}', True)
    bone(f'ball_{s}', f(ball_l), f(toe_l) + Vector((0, -0.02, 0)), f'foot_{s}', True)
bpy.ops.object.mode_set(mode='OBJECT')

# Poids automatiques
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
body.name = 'SuperHero_Male'

# Poids adoucis : à l'épaule, au coude et au genou, la transition entre deux os est plus progressive,
# sans quoi le deltoïde et le biceps se détachent l'un de l'autre quand le bras bouge.
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=SMOOTH, expand=0.0)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')

# Bras « cuits » dans la pose du vélo : sur le vélo, chaque bras part presque à l'horizontale vers l'avant
# par rapport au buste. Partir de la pose les bras le long du corps imposerait au jeu un pivot de près de
# 90°, qui déforme l'avant de l'épaule. La pose d'origine est gardée comme cible de forme « apose » : le jeu
# s'en sert pour dessiner le maillot et les gants au même endroit qu'avant.
from mathutils import Matrix
orig_co = [v.co.copy() for v in body.data.vertices]
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')


def aim_bone(pb, direction):
    cur = (pb.tail - pb.head).normalized()
    q = cur.rotation_difference(direction.normalized())
    head_p = pb.head.copy()
    T = Matrix.Translation(head_p)
    pb.matrix = T @ q.to_matrix().to_4x4() @ T.inverted() @ pb.matrix
    bpy.context.view_layer.update()


for s, sx in (('l', 1), ('r', -1)):
    aim_bone(rig.pose.bones[f'upperarm_{s}'], Vector((0.02 * sx, -0.99, -0.14)))
    aim_bone(rig.pose.bones[f'lowerarm_{s}'], Vector((-0.07 * sx, -0.99, -0.12)))
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
me = ev.to_mesh()
posed = [v.co.copy() for v in me.vertices]
ev.to_mesh_clear()
bpy.ops.pose.armature_apply()
bpy.ops.object.mode_set(mode='OBJECT')
for i, v in enumerate(body.data.vertices):
    v.co = posed[i]
body.data.update()
bpy.context.view_layer.objects.active = body
body.shape_key_add(name='Basis')
apose = body.shape_key_add(name='apose')
for i, d in enumerate(apose.data):
    d.co = orig_co[i]

# Matière peau
m = bpy.data.materials.new('skin')
m.use_nodes = True
b = m.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.58, 0.32, 0.20, 1)
b.inputs['Roughness'].default_value = 0.62
body.data.materials.clear()
body.data.materials.append(m)
for p in body.data.polygons:
    p.use_smooth = True

# Chaussures : la peau du pied (sous la cheville) est dupliquée, gonflée et lissée pour en faire une coque,
# avec une semelle sombre. Les poids du pied sont copiés : elle suit les mêmes os.
import bmesh
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
from mathutils import kdtree
body_groups = {i: g.name for i, g in enumerate(body.vertex_groups)}
tree = kdtree.KDTree(len(body.data.vertices))
for i, v in enumerate(body.data.vertices):
    tree.insert(v.co, i)
tree.balance()
bm = bmesh.new()
for side in (1, -1):
    pts = [v.co.copy() for v in body.data.vertices if v.co.z < SHOE_TOP and v.co.x * side > 0.02]
    hull_bm = bmesh.new()
    for p in pts:
        hull_bm.verts.new(p)
    res = bmesh.ops.convex_hull(hull_bm, input=hull_bm.verts, use_existing_faces=False)
    interior = res['geom_interior'] + res['geom_unused']
    bmesh.ops.delete(hull_bm, geom=list({g for g in interior if isinstance(g, bmesh.types.BMVert)}), context='VERTS')
    hull_bm.verts.ensure_lookup_table()
    hull_bm.faces.ensure_lookup_table()
    # Arrondit : une subdivision lissée, puis un gonflement le long des normales et quelques lissages.
    bmesh.ops.subdivide_edges(hull_bm, edges=hull_bm.edges[:], cuts=5, use_grid_fill=True, use_smooth_even=True)
    hull_bm.normal_update()
    for v in hull_bm.verts:
        v.co += v.normal * 0.007
    for _ in range(4):
        bmesh.ops.smooth_vert(hull_bm, verts=hull_bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in hull_bm.verts:
        v.co.z = max(v.co.z, 0.0)       # semelle à plat sur le sol
    mesh_tmp = bpy.data.meshes.new('tmp')
    hull_bm.to_mesh(mesh_tmp)
    hull_bm.free()
    bm.from_mesh(mesh_tmp)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()
bm.normal_update()
ys = [v.co.y for v in bm.verts if v.co.x > 0]
y_front, y_back = min(ys), max(ys)
span = y_back - y_front
for f in bm.faces:
    c = f.calc_center_median()
    t = (c.y - y_front) / span            # 0 à la pointe, 1 au talon
    if max(v.co.z for v in f.verts) < 0.024:
        f.material_index = mats['shoe_sole']
    else:
        f.material_index = mats['shoe_upper']
positions = [v.co.copy() for v in bm.verts]
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

# Yeux : deux petites sphères enfoncées dans le visage, liées à l'os de la tête.
head_v = [v for v in vs if v.z > zz(0.9)]
face_y = min(v.y for v in head_v)
eyes = []
for sx in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012, location=(sx * 0.032, face_y + 0.035, zz(0.953)))
    e = bpy.context.object
    eyes.append(e)
bpy.ops.object.select_all(action='DESELECT')
for e in eyes: e.select_set(True)
bpy.context.view_layer.objects.active = eyes[0]
bpy.ops.object.join()
eye = bpy.context.object
eye.name = 'Eyes'
em = bpy.data.materials.new('eye'); em.use_nodes = True
em.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.9, 0.9, 0.9, 1)
eye.data.materials.append(em)
vg = eye.vertex_groups.new(name='Head')
vg.add([v.index for v in eye.data.vertices], 1.0, 'REPLACE')
eye.parent = rig
mod = eye.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

# Export
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=False, export_animations=False, export_skins=True, export_morph=True,
                          export_morph_normal=False)
print('EXPORTED', OUT)
bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb', '.blend'))
