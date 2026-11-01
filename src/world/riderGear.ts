// Casque, lunettes et sangle : l'équipement de tête du cycliste, posé sur une tête centrée sur le crâne,
// de face vers -Z.

import * as THREE from 'three';
import { place, turned, weldNormals } from './modelParts';

const VENT_PIECES = 5;

/** Crâne, mâchoire et menton : une sphère resserrée vers le bas, le front en retrait. */
export function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 32, 24);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const jaw = y < 0 ? 1 - 0.42 * y * y : 1;
    const eyes = z < -0.55 && y > 0 && y < 0.34 ? 0.95 : 1;
    const chin = y < -0.7 && z < 0 ? 1.08 : 1;
    p.setXYZ(i, x * 0.086 * jaw, y * 0.118, z * 0.102 * jaw * eyes * chin);
  }
  g.computeVertexNormals();
  weldNormals(g);
  return g;
}

/** Dimensions du casque : demi-largeur, demi-hauteur et demi-longueur vers l'avant. */
const HELMET = { width: 0.104, height: 0.1, front: 0.118 };

/**
 * Point de la coque du casque à partir d'une direction : la moitié arrière s'allonge et se
 * resserre en pointe, ce qui donne le profil effilé des casques de course.
 */
export function helmetPoint(dir: THREE.Vector3, tail: number): THREE.Vector3 {
  const rear = Math.max(0, dir.z);
  const narrow = 1 - 0.55 * rear * rear;
  return new THREE.Vector3(
    dir.x * HELMET.width * narrow,
    dir.y * HELMET.height * (1 - 0.3 * rear * rear),
    dir.z * HELMET.front * (dir.z > 0 ? tail : 1),
  );
}

function helmetGeometry(tail: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.57);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const q = helmetPoint(v, tail);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  g.computeVertexNormals();
  return g;
}

export interface GearLook {
  /** Couleur du casque. */
  accent: THREE.Material;
  /** Aérations, sangle et branches de lunettes. */
  dark: THREE.Material;
  lens: THREE.Material;
  /** Contre-la-montre : casque plus long. */
  tt: boolean;
}

/** Ajoute le casque, ses aérations, la sangle et les lunettes à `head`. */
export function addHeadGear(headGroup: THREE.Object3D, { accent, dark, lens, tt }: GearLook): void {
  const tail = tt ? 2.3 : 1.65;
  const helmet = new THREE.Mesh(helmetGeometry(tail), accent);
  const shellY = 0.024;
  helmet.position.set(0, shellY, 0.004);
  headGroup.add(helmet);
  // Aérations : de longues fentes qui épousent la coque, tronçon par tronçon. Tracées d'un
  // seul trait, elles couperaient la courbure et passeraient à l'intérieur du casque.
  const ventGeo = turned([0.006, 0.012, 0.012, 0.006], 8);
  ventGeo.scale(1, 1, 0.5);
  const onShell = (d: THREE.Vector3) =>
    helmetPoint(d.clone().normalize(), tail).multiplyScalar(1.015).add(new THREE.Vector3(0, shellY, 0.004));
  const slot = (from: THREE.Vector3, to: THREE.Vector3) => {
    for (let k = 0; k < VENT_PIECES; k++) {
      const piece = new THREE.Mesh(ventGeo, dark);
      place(piece, onShell(from.clone().lerp(to, k / VENT_PIECES)), onShell(from.clone().lerp(to, (k + 1) / VENT_PIECES)));
      headGroup.add(piece);
    }
  };
  const ventCount = tt ? 1 : 2;
  for (let n = -ventCount; n <= ventCount; n++) {
    const across = n * 0.3;
    slot(new THREE.Vector3(across, 0.6, -0.75), new THREE.Vector3(across * 0.6, 0.8, 0.6));
  }
  for (const side of [-1, 1]) slot(new THREE.Vector3(side * 0.95, 0.28, -0.25), new THREE.Vector3(side * 0.7, 0.42, 0.68));
  // Sangle sous le menton.
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(turned([0.0055, 0.0055], 6), dark);
    place(strap, new THREE.Vector3(side * 0.09, 0.0, 0.01), new THREE.Vector3(side * 0.012, -0.115, -0.04));
    headGroup.add(strap);
  }
  addGlasses(headGroup, { dark, lens });
}

/** Lunettes enveloppantes : un écran courbe et brillant qui reflète le ciel, et deux branches. */
export function addGlasses(headGroup: THREE.Object3D, { dark, lens }: { dark: THREE.Material; lens: THREE.Material }): void {
  const shield = new THREE.SphereGeometry(1, 24, 8, Math.PI * 1.5 - 1.1, 2.2, 1.28, 0.62);
  const glasses = new THREE.Mesh(shield, lens);
  (lens as THREE.Material).side = THREE.DoubleSide;
  glasses.scale.set(0.098, 0.082, 0.117);
  glasses.position.set(0, 0.018, 0);
  headGroup.add(glasses);
  for (const side of [-1, 1]) {
    const temple = new THREE.Mesh(turned([0.0035, 0.0035], 6), dark);
    place(temple, new THREE.Vector3(side * 0.09, 0.018, -0.05), new THREE.Vector3(side * 0.09, 0.014, 0.03));
    headGroup.add(temple);
  }
}
