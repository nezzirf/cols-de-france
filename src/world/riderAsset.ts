// Cycliste modélisé (fichier glTF d'un personnage humain rigué) : chargé une fois, cloné pour chaque coureur.
// Au chargement, la position de chaque point au repos est gardée pour dessiner les vêtements dessus.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const RIDER_ASSET_URL = `${import.meta.env.BASE_URL}models/rider/Superhero_Male_FullBody.gltf`;

/** Tête du personnage dans son repère d'origine : centre du crâne et largeur. */
export interface HeadFrame {
  center: THREE.Vector3;
  width: number;
}

let asset: THREE.Object3D | null = null;
let head: HeadFrame | null = null;
let loading: Promise<void> | null = null;

/**
 * Part du corps que l'on garde autour de l'axe de l'os : 1 laisse le volume tel quel, moins de 1 l'affine.
 * Le personnage est un « superhéros » très musclé ; un coureur est plus mince, surtout en haut du corps.
 */
const SLIM: [bone: string, child: string, keep: number][] = [
  ['spine_01', 'spine_02', 0.93],
  ['spine_02', 'spine_03', 0.8],
  ['spine_03', 'neck_01', 0.76],
  ['neck_01', 'Head', 0.86],
  ...(['l', 'r'] as const).flatMap((side): [string, string, number][] => [
    [`clavicle_${side}`, `upperarm_${side}`, 0.78],
    [`upperarm_${side}`, `lowerarm_${side}`, 0.7],
    [`lowerarm_${side}`, `hand_${side}`, 0.8],
  ]),
];

/**
 * Rapproche les points du haut du corps de l'axe de leur os, à proportion de leur poids sur cet os :
 * les épaules, la poitrine et les bras s'affinent sans que les articulations se détachent.
 */
function slimUpperBody(mesh: THREE.SkinnedMesh): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const joints = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  const bones = mesh.skeleton.bones;
  const at = new Map(bones.map((b, i) => [b.name, i]));
  const segment = new Map<number, { a: THREE.Vector3; b: THREE.Vector3; keep: number }>();
  for (const [name, child, keep] of SLIM) {
    const i = at.get(name);
    const j = at.get(child);
    if (i === undefined || j === undefined) continue;
    segment.set(i, { a: bones[i].getWorldPosition(new THREE.Vector3()), b: bones[j].getWorldPosition(new THREE.Vector3()), keep });
  }
  mesh.skeleton.update();
  const toLocal = mesh.matrixWorld.clone().invert();
  const p = new THREE.Vector3();
  const move = new THREE.Vector3();
  const near = new THREE.Vector3();
  const axis = new THREE.Vector3();
  for (let v = 0; v < position.count; v++) {
    p.fromBufferAttribute(position, v);
    mesh.applyBoneTransform(v, p);
    p.applyMatrix4(mesh.matrixWorld);
    move.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const seg = segment.get(joints.getComponent(v, k));
      const w = weights.getComponent(v, k);
      if (!seg || w === 0) continue;
      axis.subVectors(seg.b, seg.a);
      const t = Math.min(1, Math.max(0, near.subVectors(p, seg.a).dot(axis) / axis.lengthSq()));
      near.copy(seg.a).addScaledVector(axis, t);
      move.addScaledVector(near.sub(p), w * (1 - seg.keep));
    }
    p.add(move).applyMatrix4(toLocal);
    position.setXYZ(v, p.x, p.y, p.z);
  }
  position.needsUpdate = true;
}

/**
 * Garde la position de chaque point au repos : le dessin des zones (maillot, cuissard, gants…) en dépend,
 * et il suit ainsi le corps quand il bouge, avec des bords nets plutôt qu'en dents de scie.
 */
function keepRestPositions(mesh: THREE.SkinnedMesh): void {
  const geometry = mesh.geometry;
  mesh.skeleton.update();
  const count = geometry.getAttribute('position').count;
  const rest = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(geometry.getAttribute('position'), i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    rest.set([v.x, v.y, v.z], i * 3);
  }
  geometry.setAttribute('aRest', new THREE.BufferAttribute(rest, 3));
}

/** Centre et largeur du crâne, d'après les points portés par l'os de la tête. */
function measureHead(mesh: THREE.SkinnedMesh): HeadFrame {
  const geometry = mesh.geometry;
  const joints = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  const names = mesh.skeleton.bones.map((b) => b.name);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < joints.count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
    if (names[joints.getComponent(i, best)] !== 'Head') continue;
    v.fromBufferAttribute(geometry.getAttribute('position'), i);
    mesh.applyBoneTransform(i, v);
    box.expandByPoint(v.applyMatrix4(mesh.matrixWorld));
  }
  const size = box.getSize(new THREE.Vector3());
  return { center: box.getCenter(new THREE.Vector3()), width: size.x };
}

/** Lance le chargement ; en cas d'échec, le jeu garde son cycliste dessiné par le code. */
export function preloadRiderAsset(): Promise<void> {
  loading ??= new GLTFLoader()
    .loadAsync(RIDER_ASSET_URL)
    .then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh && o.name === 'SuperHero_Male') {
          head = measureHead(o);
          slimUpperBody(o);
          keepRestPositions(o);
        }
      });
      asset = gltf.scene;
    })
    .catch(() => {
      asset = null;
    });
  return loading;
}

export const riderAssetReady = (): boolean => asset !== null;

/** Copie indépendante du personnage, avec son propre squelette. */
export function cloneRiderAsset(): THREE.Object3D {
  if (!asset) throw new Error('Le personnage modélisé n’est pas chargé.');
  return clone(asset);
}

export function riderHead(): HeadFrame {
  if (!head) throw new Error('Le personnage modélisé n’est pas chargé.');
  return head;
}
