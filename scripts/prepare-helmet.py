import bpy, sys
import numpy as np
from mathutils import Vector
SRC, OUT, FLIP = sys.argv[sys.argv.index('--') + 1:][:3]
FLIP = FLIP == '1'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
o = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
mw = o.matrix_world.copy()
o.parent = None
o.matrix_world = mw
for e in list(bpy.context.scene.objects):
    if e.type == 'EMPTY':
        bpy.data.objects.remove(e)
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
P = np.array([v.co[:] for v in o.data.vertices], dtype=float)
c = P.mean(axis=0)
u, s, vt = np.linalg.svd(P - c, full_matrices=False)
R = np.array(vt)
if np.linalg.det(R) < 0:
    R[2] = -R[2]
Q = (P - c) @ R.T          # x = longueur, y = largeur, z = hauteur (dôme vers -z)
# X' = largeur, Y' = longueur, Z' = -hauteur (dôme vers le haut)
W = np.stack([Q[:, 1], Q[:, 0], -Q[:, 2]], axis=1)
if FLIP:
    W[:, 0] = -W[:, 0]
    W[:, 1] = -W[:, 1]     # demi-tour autour de l'axe vertical : l'avant devient l'arrière
W *= 0.001                 # mm -> m
# Origine : centre de la bordure, au niveau du bas de la coque
W[:, 0] -= (W[:, 0].max() + W[:, 0].min()) / 2
W[:, 1] -= (W[:, 1].max() + W[:, 1].min()) / 2
W[:, 2] -= W[:, 2].min()
print('SIZE m', W.max(axis=0) - W.min(axis=0))
for i, v in enumerate(o.data.vertices):
    v.co = Vector(W[i])
o.data.update()
for p in o.data.polygons:
    p.use_smooth = True
o.name = 'Helmet'
bpy.ops.object.select_all(action='DESELECT')
o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=False)
print('EXPORTED')
