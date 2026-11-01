// Combinaison du cycliste : un maillot et un cuissard modélisés, qui gardent leur forme et font le tronc du
// cycliste. Elle se rattache au squelette du personnage fabriqué en code, os par os, d'après la distance de
// chaque point du tissu aux membres.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const SUIT_URL = `${import.meta.env.BASE_URL}models/combinaison/scene.gltf`;

/** La combinaison est modélisée en millimètres, col du maillot en haut : on la pose à la taille du personnage. */
const MM = 0.001;
const COLLAR_TOP_MM = 68;
const COLLAR_HEIGHT = 1.55;
const CENTER_MM = 8;
/** Une pièce de moins de points que cela n'est pas du tissu (fermeture éclair). */
const MIN_FABRIC = 2000;
/** Le maillot (9 000 points) recouvre le haut du cuissard (50 000) : on le gonfle de quelques millimètres. */
const JERSEY_LIFT = 0.005;
/** Écart, en mètres, au-delà duquel un os pèse peu sur un point du tissu. */
const REACH = 0.05;

export interface SuitPart {
  /** Dans le repère du personnage au repos (mètres, debout, de face vers +Z). */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const vectors = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.Vector3[] =>
  Array.from({ length: attribute.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(attribute, i));

/**
 * Les normales d'une pièce peuvent regarder vers l'intérieur du tissu. On compare, pour quelques points, la
 * normale à la direction qui va du centre de leurs voisins vers eux : si la plupart rentrent, on les retourne.
 */
function faceOutward(geometry: THREE.BufferGeometry): void {
  const points = vectors(geometry.getAttribute('position'));
  const normals = geometry.getAttribute('normal');
  if (points.length < MIN_FABRIC) return;
  const step = Math.ceil(points.length / 300);
  const middle = new THREE.Vector3();
  const here = new THREE.Vector3();
  let outward = 0;
  let tested = 0;
  for (let i = 0; i < points.length; i += step) {
    middle.set(0, 0, 0);
    let count = 0;
    for (const q of points) {
      if (q.distanceToSquared(points[i]) < 0.12 * 0.12) {
        middle.add(q);
        count++;
      }
    }
    here.subVectors(points[i], middle.divideScalar(count)).normalize();
    tested++;
    if (here.dot(new THREE.Vector3().fromBufferAttribute(normals, i)) > 0) outward++;
  }
  if (outward >= tested / 2) return;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
  normals.needsUpdate = true;
}

/** Écarte chaque point de `distance` le long de sa normale. */
function inflate(geometry: THREE.BufferGeometry, distance: number): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, position.getX(i) + normal.getX(i) * distance, position.getY(i) + normal.getY(i) * distance, position.getZ(i) + normal.getZ(i) * distance);
  }
  position.needsUpdate = true;
}

export async function loadSuit(): Promise<SuitPart[]> {
  const gltf = await new GLTFLoader().loadAsync(SUIT_URL);
  gltf.scene.updateMatrixWorld(true);
  const fit = new THREE.Matrix4()
    .makeTranslation(0, COLLAR_HEIGHT, 0)
    .multiply(new THREE.Matrix4().makeScale(MM, MM, MM))
    .multiply(new THREE.Matrix4().makeTranslation(CENTER_MM, COLLAR_TOP_MM, 0));
  const parts: SuitPart[] = [];
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = o.geometry.clone();
    geometry.applyMatrix4(o.matrixWorld);
    geometry.applyMatrix4(fit);
    faceOutward(geometry);
    const material = (o.material as THREE.MeshStandardMaterial).clone();
    material.side = THREE.DoubleSide;
    // Le maillot recouvre le haut du cuissard : on le gonfle et on le fait gagner le test de profondeur, sans
    // quoi les deux tissus se disputent les mêmes pixels et le bord est déchiqueté.
    const points = geometry.getAttribute('position').count;
    if (points >= MIN_FABRIC && points < MIN_FABRIC * 10) {
      inflate(geometry, JERSEY_LIFT);
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -2;
    }
    parts.push({ geometry, material });
  });
  return parts;
}

/** Un membre du squelette : l'os qui le fait bouger, et le segment qu'il occupe au repos. */
export interface Limb {
  bone: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/** Distance d'un point à un segment. */
function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, scratch: THREE.Vector3): number {
  const span = scratch.subVectors(b, a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(span) / span.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(span, t));
}

/**
 * Rattache la combinaison au squelette : chaque point du tissu prend les os des membres les plus proches, avec un
 * poids qui décroît vite avec la distance. Deux membres voisins (bras et torse, cuisses) se partagent les points
 * qui sont entre eux, et le tissu plie sans se déchirer.
 */
export function skinSuit(skeleton: THREE.Skeleton, limbs: Limb[], suit: SuitPart[]): THREE.SkinnedMesh[] {
  const scratch = new THREE.Vector3();
  return suit.map(({ geometry, material }, n) => {
    const points = vectors(geometry.getAttribute('position'));
    const skinIndex = new Uint16Array(points.length * 4);
    const skinWeight = new Float32Array(points.length * 4);
    const near: { bone: number; d: number }[] = [];
    points.forEach((p, i) => {
      // Le plus proche de chaque os : un os peut porter plusieurs segments (le tronc).
      const best = new Map<number, number>();
      for (const limb of limbs) {
        const d = distanceToSegment(p, limb.from, limb.to, scratch);
        if (d < (best.get(limb.bone) ?? Infinity)) best.set(limb.bone, d);
      }
      near.length = 0;
      for (const [bone, d] of best) near.push({ bone, d });
      near.sort((a, b) => a.d - b.d);
      const closest = near[0].d;
      const top = near.slice(0, 4).map(({ bone, d }) => ({ bone, w: Math.exp(-((d * d - closest * closest) / (REACH * REACH))) }));
      const total = top.reduce((sum, { w }) => sum + w, 0);
      top.forEach(({ bone, w }, k) => {
        skinIndex[i * 4 + k] = bone;
        skinWeight[i * 4 + k] = w / total;
      });
    });
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `Suit_${n}`;
    mesh.frustumCulled = false;
    mesh.bind(skeleton);
    return mesh;
  });
}
