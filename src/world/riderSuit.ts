// Combinaison du cycliste : un maillot et un cuissard modélisés, qui gardent leur forme. C'est le corps qui
// s'y glisse : ses points qui dépassent sont repoussés à l'intérieur, puis la combinaison hérite du squelette
// du corps pour suivre ses mouvements.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const SUIT_URL = `${import.meta.env.BASE_URL}models/combinaison/scene.gltf`;

/** La combinaison est modélisée en millimètres, col du maillot en haut : on la pose à la taille du personnage. */
const MM = 0.001;
const COLLAR_TOP_MM = 68;
const COLLAR_HEIGHT = 1.55;
const CENTER_MM = 8;
/** Le corps reste au moins à cette distance sous le tissu : ses triangles sont grands, et une marge évite qu'ils percent entre deux points. */
const MARGIN = 0.02;
/** Portée de la recherche du tissu le plus proche. */
const REACH = 0.1;
/** Écart de côté jusqu'auquel un point reste sous le tissu (mailles du maillage), et où il n'est plus recouvert. */
const SEAM = 0.012;
const HEM = 0.04;
/** Une pièce de moins de points que cela n'est pas du tissu qui recouvre le corps. */
const MIN_LAYER = 2000;

export interface SuitPart {
  /** Dans le repère du personnage au repos (mètres, debout, de face vers +Z). */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/**
 * Les normales d'une pièce peuvent regarder vers l'intérieur du tissu. On compare, pour quelques points, la
 * normale à la direction qui va du centre de leurs voisins vers eux : si la plupart rentrent, on les retourne.
 */
function faceOutward(geometry: THREE.BufferGeometry): void {
  const points = vectors(geometry.getAttribute('position'));
  const normals = geometry.getAttribute('normal');
  if (points.length < MIN_LAYER) return;
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
    parts.push({ geometry, material });
  });
  return parts;
}

/** Grille de recherche du point le plus proche. */
class Grid {
  private cells = new Map<string, number[]>();
  constructor(
    private points: THREE.Vector3[],
    private size: number,
  ) {
    points.forEach((p, i) => {
      const key = this.key(p.x, p.y, p.z);
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    });
  }

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.size)}/${Math.floor(y / this.size)}/${Math.floor(z / this.size)}`;
  }

  point(i: number): THREE.Vector3 {
    return this.points[i];
  }

  /** Indice du point le plus proche à moins de `radius`, ou -1. */
  nearest(p: THREE.Vector3, radius: number): number {
    const rings = Math.ceil(radius / this.size);
    const cx = Math.floor(p.x / this.size);
    const cy = Math.floor(p.y / this.size);
    const cz = Math.floor(p.z / this.size);
    let best = -1;
    let bestSq = radius * radius;
    for (let x = cx - rings; x <= cx + rings; x++)
      for (let y = cy - rings; y <= cy + rings; y++)
        for (let z = cz - rings; z <= cz + rings; z++) {
          for (const i of this.cells.get(`${x}/${y}/${z}`) ?? []) {
            const d = this.points[i].distanceToSquared(p);
            if (d < bestSq) {
              bestSq = d;
              best = i;
            }
          }
        }
    return best;
  }
}

const vectors = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.Vector3[] =>
  Array.from({ length: attribute.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(attribute, i));

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Repousse sous le tissu les points du corps qui le dépassent, là où la combinaison les recouvre. Un point est
 * recouvert quand le tissu le plus proche est juste au-dessus de lui ; au-delà d'un bord du tissu (col, manches,
 * jambes), le plus proche est sur le bord, de côté : on le repousse de moins en moins, pour que le corps se
 * raccorde sans marche. `rest` donne la position au repos de chaque point du corps (modifiée sur place) et
 * `skip` les points à laisser tels quels (tête, mains).
 */
export function fitBodyInside(rest: THREE.Vector3[], suit: SuitPart[], skip: (i: number) => boolean): void {
  // Les petites pièces (fermeture éclair) ne comptent pas : seul le tissu recouvre le corps.
  const layers = suit
    .filter(({ geometry }) => geometry.getAttribute('position').count >= MIN_LAYER)
    .map(({ geometry }) => {
      const points = vectors(geometry.getAttribute('position'));
      return { points, normals: vectors(geometry.getAttribute('normal')).map((v) => v.normalize()), grid: new Grid(points, REACH) };
    });
  const diff = new THREE.Vector3();
  rest.forEach((p, i) => {
    if (skip(i)) return;
    // Chaque couche (maillot, cuissard) peut recouvrir le point : on le repousse sous la plus exigeante.
    let push = 0;
    let along: THREE.Vector3 | null = null;
    for (const layer of layers) {
      const at = layer.grid.nearest(p, REACH);
      if (at < 0) continue;
      // Hauteur du point sous la surface du tissu, le long de la normale : positive s'il dépasse.
      const out = diff.subVectors(p, layer.points[at]).dot(layer.normals[at]);
      if (out < -MARGIN) continue;
      // Écart de côté avec le tissu : petit sous le tissu, grand au-delà de son bord.
      const aside = Math.sqrt(Math.max(0, diff.lengthSq() - out * out));
      const covered = 1 - smoothstep(SEAM, HEM, aside);
      if ((out + MARGIN) * covered > push) {
        push = (out + MARGIN) * covered;
        along = layer.normals[at];
      }
    }
    if (along) p.addScaledVector(along, -push);
  });
}

/**
 * Donne à chaque point de la combinaison les os et les poids du point du corps le plus proche : elle suit
 * alors le squelette comme une seconde peau.
 */
export function skinSuit(
  body: THREE.SkinnedMesh,
  bodyRest: THREE.Vector3[],
  suit: SuitPart[],
): THREE.SkinnedMesh[] {
  const grid = new Grid(bodyRest, 0.03);
  const joints = body.geometry.getAttribute('skinIndex');
  const weights = body.geometry.getAttribute('skinWeight');
  const toLocal = body.matrixWorld.clone().invert();
  return suit.map(({ geometry, material }, n) => {
    const positions = vectors(geometry.getAttribute('position'));
    const skinIndex = new Uint16Array(positions.length * 4);
    const skinWeight = new Float32Array(positions.length * 4);
    positions.forEach((p, i) => {
      let at = -1;
      for (let radius = 0.03; at < 0 && radius < 0.5; radius *= 2) at = grid.nearest(p, radius);
      if (at < 0) at = 0;
      for (let k = 0; k < 4; k++) {
        skinIndex[i * 4 + k] = joints.getComponent(at, k);
        skinWeight[i * 4 + k] = weights.getComponent(at, k);
      }
    });
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geometry.applyMatrix4(toLocal);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `Suit_${n}`;
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    mesh.scale.copy(body.scale);
    mesh.frustumCulled = false;
    mesh.bind(body.skeleton, body.bindMatrix);
    return mesh;
  });
}
