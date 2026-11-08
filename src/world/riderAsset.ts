// Cycliste modélisé (fichier glTF d'un personnage humain rigué) : chargé une fois, cloné pour chaque coureur.
// Au chargement, la position de chaque point au repos est gardée pour dessiner les vêtements dessus.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const RIDER_ASSET_URL = `${import.meta.env.BASE_URL}models/rider/mannequin.glb`;

/** Tête du personnage dans son repère d'origine (mètres, debout, de face vers +Z). */
export interface HeadFrame {
  /** Largeur de la tête. */
  width: number;
  /** Sommet du crâne, centre et dimensions de la boîte de la tête. */
  top: number;
  centre: THREE.Vector3;
  size: THREE.Vector3;
  /** Milieu des yeux. */
  eyes: THREE.Vector3;
  /** Calotte du casque : le haut du crâne du personnage, gonflé et allongé vers l'arrière. */
  shell: THREE.BufferGeometry;
  /** Où la sangle part du casque (côté droit, à reflèter à gauche) et où elle passe sous le menton. */
  temple: THREE.Vector3;
  chin: THREE.Vector3;
  /** Repères des aérations sur la calotte : avant de la tête, milieu et profondeur. */
  vents: { front: number; middle: number; depth: number };
  /** Avant du visage (z) à la hauteur y, sur l'axe du nez. */
  faceZ(y: number): number;
  /** Passe du repère d'origine à celui de l'os de la tête, au repos. */
  restInverse: THREE.Matrix4;
}

let asset: THREE.Object3D | null = null;
let head: HeadFrame | null = null;
let loading: Promise<void> | null = null;

/** Tête modélisée (visage, casque et lunettes), allégée à une trentaine de milliers de triangles : elle remplace celle du mannequin. */
export const HEAD_MODEL_URL = `${import.meta.env.BASE_URL}models/pogi/pogi-head-hd.glb`;
let headModel: { geometry: THREE.BufferGeometry; map: THREE.Texture | null } | null = null;

/** Tête modélisée, ou rien si elle n'a pas pu être chargée : le jeu garde alors la tête du mannequin. */
export const riderHeadModel = (): { geometry: THREE.BufferGeometry; map: THREE.Texture | null } | null => headModel;

/** Texture ramenée à 1024 px : une seule image sert à tous les coureurs. */
function shrink(map: THREE.Texture | null): THREE.Texture | null {
  const image = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!map || !image || typeof document === 'undefined') return map;
  const size = 3072;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')?.drawImage(image, 0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = map.flipY;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

async function loadHeadModel(): Promise<void> {
  try {
    const gltf = await new GLTFLoader().loadAsync(HEAD_MODEL_URL);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || headModel) return;
      const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
      headModel = { geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), map: shrink(material.map ?? null) };
    });
  } catch {
    headModel = null;
  }
}

/** Retire la tête du mannequin (les triangles dont tous les points sont portés par l'os de la tête) : celle du modèle la remplace. */
function removeMannequinHead(body: THREE.SkinnedMesh, eyes: THREE.SkinnedMesh): void {
  const geometry = body.geometry;
  const joints = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  const names = body.skeleton.bones.map((bone) => bone.name);
  const onHead = (v: number): boolean => {
    let best = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(v, k) > weights.getComponent(v, best)) best = k;
    return names[joints.getComponent(v, best)] === 'Head';
  };
  const index = geometry.getIndex()!;
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (!(onHead(a) && onHead(b) && onHead(c))) kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  eyes.visible = false;
}

/** Casque de route modélisé : en mètres, dôme vers le haut (y), avant vers +Z, posé sur sa bordure en y = 0. */
export const HELMET_URL = `${import.meta.env.BASE_URL}models/casque/helmet.glb`;
let helmet: THREE.BufferGeometry | null = null;

/** Casque modélisé, ou rien s'il n'a pas pu être chargé : le jeu garde alors la calotte tirée du crâne. */
export const riderHelmetGeometry = (): THREE.BufferGeometry | null => helmet;

/** Lunettes de sport modélisées : en mètres, écran vers -Z, branches vers +Z, centrées en x. */
export const GLASSES_URL = `${import.meta.env.BASE_URL}models/lunette/scene.gltf`;
let glasses: { geometry: THREE.BufferGeometry; map: THREE.Texture | null } | null = null;

/** Lunettes modélisées, ou rien si elles n'ont pas pu être chargées : le cycliste n'en porte alors pas. */
export const riderGlasses = (): { geometry: THREE.BufferGeometry; map: THREE.Texture | null } | null => glasses;

async function loadGlasses(): Promise<void> {
  try {
    const gltf = await new GLTFLoader().loadAsync(GLASSES_URL);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || glasses) return;
      const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshBasicMaterial;
      glasses = { geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), map: material.map ?? null };
    });
  } catch {
    glasses = null;
  }
}

async function loadHelmet(): Promise<void> {
  try {
    const gltf = await new GLTFLoader().loadAsync(HELMET_URL);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && !helmet) helmet = o.geometry.clone().applyMatrix4(o.matrixWorld);
    });
  } catch {
    helmet = null;
  }
}

/**
 * Part du corps que l'on garde autour de l'axe de l'os : 1 laisse le volume tel quel, moins de 1 l'affine.
 * Le personnage est un « superhéros » très musclé ; un coureur est plus mince, surtout en haut du corps.
 */
const SLIM: [bone: string, child: string, keep: number][] = [];

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
  const apose = geometry.morphAttributes.position?.[0];
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(geometry.getAttribute('position'), i);
    mesh.applyBoneTransform(i, v);
    // Le personnage est fabriqué les bras en avant (pose du vélo) ; la forme « apose » garde la pose d'origine,
    // bras le long du corps, sur laquelle les zones du maillot, des gants et des chaussures sont calées.
    if (apose) v.set(v.x + apose.getX(i), v.y + apose.getY(i), v.z + apose.getZ(i));
    v.applyMatrix4(mesh.matrixWorld);
    rest.set([v.x, v.y, v.z], i * 3);
  }
  geometry.setAttribute('aRest', new THREE.BufferAttribute(rest, 3));
  // La forme n'a servi qu'à cela : on la retire pour ne pas la payer à chaque image.
  geometry.morphAttributes = {};
  mesh.morphTargetInfluences = undefined;
  mesh.morphTargetDictionary = undefined;
}

/** Épaisseur de la coque du casque, et allongement vers l'arrière (part de la profondeur de la tête). */
const SHELL_THICKNESS = 0.014;
const SHELL_TAIL = 0.55;
/** Dans la queue, la coque descend vers la nuque : le profil d'un casque aéro. */
const SHELL_DROP = 0.04;

/**
 * Mesure la tête et fabrique la calotte du casque à partir de son crâne : les triangles au-dessus d'une
 * ligne qui passe au-dessus des sourcils, des tempes et de la nuque, gonflés le long de leur normale.
 * Le casque épouse ainsi la tête au lieu de flotter dessus.
 */
function measureHead(mesh: THREE.SkinnedMesh, eyesMesh: THREE.SkinnedMesh, headBone: THREE.Object3D): HeadFrame {
  const geometry = mesh.geometry;
  const count = geometry.getAttribute('position').count;
  const joints = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  const names = mesh.skeleton.bones.map((bone) => bone.name);
  const normals = geometry.getAttribute('normal');
  const rest: THREE.Vector3[] = [];
  const normal: THREE.Vector3[] = [];
  const onHead: boolean[] = [];
  const box = new THREE.Box3();
  for (let i = 0; i < count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
    const p = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), i);
    mesh.applyBoneTransform(i, p);
    rest.push(p.applyMatrix4(mesh.matrixWorld));
    normal.push(new THREE.Vector3().fromBufferAttribute(normals, i).transformDirection(mesh.matrixWorld));
    onHead.push(names[joints.getComponent(i, best)] === 'Head');
    if (onHead[i]) box.expandByPoint(rest[i]);
  }
  const size = box.getSize(new THREE.Vector3());
  const middle = box.getCenter(new THREE.Vector3());
  const top = box.max.y;
  // Le bord du casque : haut sur le front, plus bas sur les tempes, jusqu'à la nuque derrière.
  const edge = (z: number): number => {
    const back = (1 - THREE.MathUtils.clamp((z - middle.z) / (size.z / 2), -1, 1)) / 2;
    return top - size.y * (0.34 + 0.3 * back);
  };

  const index = geometry.getIndex()!;
  const used = new Map<number, number>();
  const positions: number[] = [];
  const rim: number[] = [];
  const triangles: number[] = [];
  const keep = (v: number): number => {
    let at = used.get(v);
    if (at === undefined) {
      at = positions.length / 3;
      used.set(v, at);
      const q = rest[v].clone().addScaledVector(normal[v], SHELL_THICKNESS);
      const behind = THREE.MathUtils.clamp((middle.z - q.z) / (size.z / 2), 0, 1);
      q.z = middle.z + (q.z - middle.z) * (1 + SHELL_TAIL * behind);
      q.y -= SHELL_DROP * behind * behind;
      positions.push(q.x, q.y, q.z);
      rim.push(rest[v].y - edge(rest[v].z));
    }
    return at;
  };
  for (let t = 0; t < index.count; t += 3) {
    const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (!(onHead[a] && onHead[b] && onHead[c])) continue;
    const centre = rest[a].clone().add(rest[b]).add(rest[c]).multiplyScalar(1 / 3);
    if (centre.y > edge(centre.z)) triangles.push(keep(a), keep(b), keep(c));
  }
  let shell: THREE.BufferGeometry = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shell.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
  shell.setIndex(triangles);
  // Les points confondus de la peau (coutures du dessin) sont soudés : la coque est lisse.
  shell = mergeVertices(shell, 1e-4);
  shell.computeVertexNormals();

  const eyeBox = new THREE.Box3();
  const v = new THREE.Vector3();
  eyesMesh.skeleton.update();
  for (let i = 0; i < eyesMesh.geometry.getAttribute('position').count; i++) {
    v.fromBufferAttribute(eyesMesh.geometry.getAttribute('position'), i);
    eyesMesh.applyBoneTransform(i, v);
    eyeBox.expandByPoint(v.applyMatrix4(eyesMesh.matrixWorld));
  }
  return {
    width: size.x,
    top,
    centre: middle,
    size,
    eyes: eyeBox.getCenter(new THREE.Vector3()),
    shell,
    temple: new THREE.Vector3(size.x * 0.46, edge(middle.z) + 0.004, middle.z + size.z * 0.02),
    chin: new THREE.Vector3(size.x * 0.05, box.min.y + 0.02, middle.z + size.z * 0.12),
    vents: { front: middle.z + size.z / 2, middle: middle.z, depth: size.z },
    faceZ: (y: number): number => {
      let front = -Infinity;
      for (let i = 0; i < count; i++) {
        if (onHead[i] && Math.abs(rest[i].x) < 0.012 && Math.abs(rest[i].y - y) < 0.008) front = Math.max(front, rest[i].z);
      }
      return Number.isFinite(front) ? front : middle.z + size.z / 2;
    },
    restInverse: headBone.matrixWorld.clone().invert(),
  };
}

/** Lance le chargement ; en cas d'échec, le jeu garde son cycliste dessiné par le code. */
export function preloadRiderAsset(): Promise<void> {
  loading ??= new GLTFLoader()
    .loadAsync(RIDER_ASSET_URL)
    .then(async (gltf) => {
      await Promise.all([loadHelmet(), loadGlasses(), loadHeadModel()]);
      gltf.scene.updateMatrixWorld(true);
      let body: THREE.SkinnedMesh | null = null;
      let eyes: THREE.SkinnedMesh | null = null;
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh && o.name === 'SuperHero_Male') body = o;
        if (o instanceof THREE.SkinnedMesh && o.name === 'Eyes') eyes = o;
      });
      if (body && eyes) {
        slimUpperBody(body);
        keepRestPositions(body);
        head = measureHead(body, eyes, gltf.scene.getObjectByName('Head')!);
        if (headModel) removeMannequinHead(body, eyes);
      }
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
