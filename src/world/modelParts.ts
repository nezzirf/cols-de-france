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

/**
 * Moyenne les normales des points confondus. Une surface fermée a deux rangées de sommets au même
 * endroit : sans cela, l'éclairage y dessine une couture.
 */
export function weldNormals(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e4)}/${Math.round(p.getY(i) * 1e4)}/${Math.round(p.getZ(i) * 1e4)}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const sum = new THREE.Vector3();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    sum.set(0, 0, 0);
    for (const i of list) sum.add(new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)));
    sum.normalize();
    for (const i of list) n.setXYZ(i, sum.x, sum.y, sum.z);
  }
}

/** Volume de révolution de longueur 1 à partir d'un profil de rayons régulièrement espacés. */
export function turned(radii: number[], segments = 14): THREE.BufferGeometry {
  const points = radii.map((r, i) => new THREE.Vector2(Math.max(r, 1e-4), i / (radii.length - 1)));
  const g = new THREE.LatheGeometry(points, segments);
  g.computeVertexNormals();
  weldNormals(g);
  return g;
}

/**
 * Déforme une pièce de longueur 1 selon sa position : renvoie le décalage [x, z] de chaque point.
 * Sert à poser les volumes que la révolution ne donne pas : muscles, omoplates.
 */
export function sculpt(g: THREE.BufferGeometry, shift: (x: number, y: number, z: number) => [number, number]): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const [dx, dz] = shift(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, p.getX(i) + dx, p.getY(i), p.getZ(i) + dz);
  }
  g.computeVertexNormals();
  weldNormals(g);
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
