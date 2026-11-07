// Cannondale SuperSix Evo d'EF modélisé : le fichier est un seul maillage, vélo seul, dans un cube d'un mètre ; il regarde
// vers -Z comme le jeu, et son côté transmission est à +X. On y découpe les deux roues (rayons et moyeu) pour les faire
// tourner, et l'on retire les manivelles et les pédales, que le jeu redessine pour qu'elles suivent les jambes.

import * as THREE from 'three';

/** Rayon du pneu, hauteur des moyeux, position (z) des deux moyeux et sol, dans le repère du modèle. */
export const EF_TYRE_R = 0.199;
export const EF_HUB_Y = -0.0959;
export const EF_FRONT_HUB_Z = -0.2905;
export const EF_REAR_HUB_Z = 0.2905;
export const EF_GROUND_Y = -0.2949;
/** Axe du pédalier (z, y). */
export const EF_BB_Z = 0.045;
export const EF_BB_Y = -0.139;

export const EF_FRONT_NAME = 'ef_front_wheel';
export const EF_REAR_NAME = 'ef_rear_wheel';

/** Seuls les rayons et le moyeu tournent (jusqu'au bord intérieur de la jante) : pneu et jante, de révolution, restent en place. */
const SPIN_R = 0.169;
/** Demi-épaisseur d'une roue ; près du moyeu, les flasques sont plus larges. */
const WHEEL_HALF = 0.019;
const HUB_HALF = 0.026;
const HUB_ZONE = 0.07;
/** Manivelles et pédales : à plus de 5,5 cm de l'axe du vélo, près du pédalier. */
const CRANK_MIN_X = 0.055;
const CRANK_RADIUS = 0.13;

const inWheel = (x: number, y: number, z: number, hubZ: number): boolean => {
  const r = Math.hypot(y - EF_HUB_Y, z - hubZ);
  if (r > SPIN_R) return false;
  return Math.abs(x) <= (r < HUB_ZONE ? HUB_HALF : WHEEL_HALF);
};

/**
 * La manivelle droite du fichier part vers l'avant, dans le plan de la chaîne (x > 3 cm) : elle se distingue du plateau (rayon
 * de 6 cm) et de la chaîne (qui part vers l'arrière) par sa place devant le pédalier.
 */
const isCrank = (x: number, y: number, z: number): boolean => {
  const r = Math.hypot(y - EF_BB_Y, z - EF_BB_Z);
  if (Math.abs(x) > CRANK_MIN_X && r < CRANK_RADIUS) return true;
  return x > 0.03 && r > 0.058 && r < CRANK_RADIUS && z < EF_BB_Z - 0.025;
};

export function splitEfWheels(scene: THREE.Object3D): void {
  scene.updateMatrixWorld(true);
  let source: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (!source && o instanceof THREE.Mesh) source = o;
  });
  if (!source) return;
  const mesh: THREE.Mesh = source;
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) return;
  const world = mesh.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const front: number[] = [];
  const rear: number[] = [];
  const rest: number[] = [];
  const all3 = (hubZ: number): boolean => inWheel(a.x, a.y, a.z, hubZ) && inWheel(b.x, b.y, b.z, hubZ) && inWheel(c.x, c.y, c.z, hubZ);
  for (let t = 0; t < index.count; t += 3) {
    const i = index.getX(t);
    const j = index.getX(t + 1);
    const k = index.getX(t + 2);
    a.fromBufferAttribute(position, i).applyMatrix4(world);
    b.fromBufferAttribute(position, j).applyMatrix4(world);
    c.fromBufferAttribute(position, k).applyMatrix4(world);
    if (all3(EF_FRONT_HUB_Z)) front.push(i, j, k);
    else if (all3(EF_REAR_HUB_Z)) rear.push(i, j, k);
    else if (isCrank((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3)) continue;
    else rest.push(i, j, k);
  }
  // Les trois morceaux partagent les mêmes sommets : seule la liste des triangles change (le fichier pèse déjà lourd).
  const piece = (triangles: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(geometry.attributes)) g.setAttribute(name, geometry.getAttribute(name));
    g.setIndex(triangles);
    return g;
  };
  mesh.geometry = piece(rest);
  for (const [name, triangles] of [
    [EF_FRONT_NAME, front],
    [EF_REAR_NAME, rear],
  ] as [string, number[]][]) {
    const wheel = new THREE.Mesh(piece(triangles), mesh.material);
    wheel.name = name;
    wheel.position.copy(mesh.position);
    wheel.quaternion.copy(mesh.quaternion);
    wheel.scale.copy(mesh.scale);
    mesh.parent?.add(wheel);
  }
}
