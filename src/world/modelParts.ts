// Briques communes au cycliste et au vélo. Point d'un modèle : `fx` vers l'avant, `y` vers le
// haut, `side` vers la droite ; le modèle regarde vers -Z.

import * as THREE from 'three';

export type Point = [number, number];

export const at = (fx: number, y: number, side = 0): THREE.Vector3 => new THREE.Vector3(side, y, -fx);

const UP = new THREE.Vector3(0, 1, 0);
const span = new THREE.Vector3();

/** Étire un volume de longueur 1 (axe Y) entre deux points. */
export function place(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  span.subVectors(b, a);
  const length = span.length();
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, span.divideScalar(length || 1));
  mesh.scale.set(1, length, 1);
}

/** Volume de révolution de longueur 1 à partir d'un profil de rayons régulièrement espacés. */
export function turned(radii: number[], segments = 14): THREE.BufferGeometry {
  const points = radii.map((r, i) => new THREE.Vector2(Math.max(r, 1e-4), i / (radii.length - 1)));
  const g = new THREE.LatheGeometry(points, segments);
  g.computeVertexNormals();
  return g;
}

export function ball(radius: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), mat);
}

export function link(a: Point, b: Point, radius: number, mat: THREE.Material, side = 0): THREE.Mesh {
  const m = new THREE.Mesh(turned([radius, radius], 8), mat);
  place(m, at(a[0], a[1], side), at(b[0], b[1], side));
  return m;
}

/** Tube de cadre à section ovale : `width` sur le côté, `depth` dans le sens de la marche. */
export function profiled(a: Point, b: Point, width: number, depth: number, mat: THREE.Material, side = 0): THREE.Mesh {
  const g = turned([1, 1], 14);
  g.scale(width / 2, 1, depth / 2);
  const m = new THREE.Mesh(g, mat);
  place(m, at(a[0], a[1], side), at(b[0], b[1], side));
  return m;
}
