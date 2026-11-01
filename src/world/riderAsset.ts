// Cycliste modélisé (fichier glTF d'un personnage humain rigué) : chargé une fois, cloné pour chaque coureur.
// Au chargement, la position de chaque point au repos est gardée pour dessiner les vêtements dessus.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fitBodyInside, loadSuit, skinSuit } from './riderSuit';

export const RIDER_ASSET_URL = `${import.meta.env.BASE_URL}models/rider/Superhero_Male_FullBody.gltf`;

/** Tête du personnage dans son repère d'origine (mètres, debout, de face vers +Z). */
export interface HeadFrame {
  /** Largeur de la tête. */
  width: number;
  /** Milieu des yeux. */
  eyes: THREE.Vector3;
  /** Calotte du casque : le haut du crâne du personnage, gonflé et allongé vers l'arrière. */
  shell: THREE.BufferGeometry;
  /** Où la sangle part du casque (côté droit, à reflèter à gauche) et où elle passe sous le menton. */
  temple: THREE.Vector3;
  chin: THREE.Vector3;
  /** Repères des aérations sur la calotte : avant de la tête, milieu et profondeur. */
  vents: { front: number; middle: number; depth: number };
  /** Passe du repère d'origine à celui de l'os de la tête, au repos. */
  restInverse: THREE.Matrix4;
}

let asset: THREE.Object3D | null = null;
let head: HeadFrame | null = null;
let loading: Promise<void> | null = null;
let suited = false;

/**
 * Part du corps que l'on garde autour de l'axe de l'os : 1 laisse le volume tel quel, moins de 1 l'affine.
 * Le personnage est un « superhéros » très musclé ; un coureur est plus mince, surtout en haut du corps.
 */
const SLIM: [bone: string, child: string, keep: number][] = [
  ['pelvis', 'spine_01', 0.82],
  ['spine_01', 'spine_02', 0.86],
  ['spine_02', 'spine_03', 0.84],
  ['spine_03', 'neck_01', 0.82],
  ['neck_01', 'Head', 0.86],
  ...(['l', 'r'] as const).flatMap((side): [string, string, number][] => [
    [`clavicle_${side}`, `upperarm_${side}`, 0.82],
    [`upperarm_${side}`, `lowerarm_${side}`, 0.74],
    [`lowerarm_${side}`, `hand_${side}`, 0.8],
    [`thigh_${side}`, `calf_${side}`, 0.7],
    [`calf_${side}`, `foot_${side}`, 0.9],
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

/** Position de chaque point du corps au repos, et nom de l'os qui le porte le plus. */
function bodyAtRest(mesh: THREE.SkinnedMesh): { rest: THREE.Vector3[]; bone: string[] } {
  const geometry = mesh.geometry;
  const joints = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  const names = mesh.skeleton.bones.map((b) => b.name);
  mesh.skeleton.update();
  const rest: THREE.Vector3[] = [];
  const bone: string[] = [];
  for (let i = 0; i < geometry.getAttribute('position').count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
    const p = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), i);
    mesh.applyBoneTransform(i, p);
    rest.push(p.applyMatrix4(mesh.matrixWorld));
    bone.push(names[joints.getComponent(i, best)]);
  }
  return { rest, bone };
}

/**
 * Enfile la combinaison : le corps se glisse sous le tissu, qui garde sa forme, puis la combinaison prend
 * les os et les poids du corps pour le suivre. Renvoie ses deux ou trois pièces.
 */
function putOnSuit(body: THREE.SkinnedMesh, suit: Awaited<ReturnType<typeof loadSuit>>): THREE.SkinnedMesh[] {
  const { rest, bone } = bodyAtRest(body);
  // La tête, les mains et les pieds ne sont pas couverts : ils restent tels quels.
  const under = fitBodyInside(rest, suit, (i) => /^(Head|hand|index|middle|pinky|ring|thumb|foot|ball)/.test(bone[i]));
  const toLocal = body.matrixWorld.clone().invert();
  const position = body.geometry.getAttribute('position');
  rest.forEach((p, i) => {
    const local = p.clone().applyMatrix4(toLocal);
    position.setXYZ(i, local.x, local.y, local.z);
  });
  position.needsUpdate = true;
  // Le tronc, c'est la combinaison : les triangles du corps entièrement sous le tissu sont retirés. Il ne reste que
  // ce qui en dépasse (tête, cou, bras, mains, jambes) et un anneau de recouvrement à chaque ouverture, pour que les
  // membres y entrent sans vide.
  const index = body.geometry.getIndex()!;
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (!(under[a] && under[b] && under[c])) kept.push(a, b, c);
  }
  body.geometry.setIndex(kept);
  return skinSuit(body, rest, suit);
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
    eyes: eyeBox.getCenter(new THREE.Vector3()),
    shell,
    temple: new THREE.Vector3(size.x * 0.46, edge(middle.z) + 0.004, middle.z + size.z * 0.02),
    chin: new THREE.Vector3(size.x * 0.05, box.min.y + 0.02, middle.z + size.z * 0.12),
    vents: { front: middle.z + size.z / 2, middle: middle.z, depth: size.z },
    restInverse: headBone.matrixWorld.clone().invert(),
  };
}

/** Lance le chargement ; en cas d'échec, le jeu garde son cycliste dessiné par le code. */
export function preloadRiderAsset(): Promise<void> {
  loading ??= Promise.all([new GLTFLoader().loadAsync(RIDER_ASSET_URL), loadSuit().catch(() => null)])
    .then(([gltf, suit]) => {
      gltf.scene.updateMatrixWorld(true);
      const found: { body?: THREE.SkinnedMesh; eyes?: THREE.SkinnedMesh } = {};
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh && o.name === 'SuperHero_Male') found.body = o;
        if (o instanceof THREE.SkinnedMesh && o.name === 'Eyes') found.eyes = o;
      });
      const { body, eyes } = found;
      if (body && eyes) {
        slimUpperBody(body);
        const parts = suit ? putOnSuit(body, suit) : [];
        for (const part of parts) body.parent!.add(part);
        suited = parts.length > 0;
        keepRestPositions(body);
        head = measureHead(body, eyes, gltf.scene.getObjectByName('Head')!);
      }
      asset = gltf.scene;
    })
    .catch(() => {
      asset = null;
    });
  return loading;
}

export const riderAssetReady = (): boolean => asset !== null;

/** La combinaison modélisée a été enfilée : le maillot et le cuissard ne sont plus peints sur la peau. */
export const riderIsSuited = (): boolean => suited;

/** Copie indépendante du personnage, avec son propre squelette. */
export function cloneRiderAsset(): THREE.Object3D {
  if (!asset) throw new Error('Le personnage modélisé n’est pas chargé.');
  return clone(asset);
}

export function riderHead(): HeadFrame {
  if (!head) throw new Error('Le personnage modélisé n’est pas chargé.');
  return head;
}
