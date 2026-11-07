// Colnago Y1Rs modélisé : repères du fichier et découpe du pédalier.
// Le modèle est en pièces séparées (« tripo_part_N »), dans un cube d'un mètre : il regarde vers -Z, comme le jeu,
// et son côté transmission est à +X. Le plateau, la chaîne et la manivelle droite y forment une seule pièce, que
// l'on coupe ici pour que le plateau et la manivelle tournent sans emporter la chaîne.

import * as THREE from 'three';

/** Rayon du pneu, hauteur et position des deux moyeux, dans le repère du modèle. */
export const MODEL_TYRE_R = 0.2055;
export const HUB_Y = -0.095;
export const FRONT_HUB_Z = -0.294;
export const REAR_HUB_Z = 0.294;
/** Axe du pédalier (z, y). */
export const BB_Z = 0.054;
export const BB_Y = -0.1366;
/** Écartement des pédales dans le modèle, et celui que le cycliste attend (en unités du modèle). */
export const PEDAL_X = 0.044;

/** Pièce unique qui porte plateau, chaîne et manivelle droite ; après la découpe, la partie qui tourne s'appelle RING_NAME. */
export const CRANKSET_NAME = 'tripo_part_1';
export const RING_NAME = 'y1rs_ring';

/** Direction de la manivelle droite au repos, dans le plan (z, y) du modèle : vers l'avant, un peu vers le bas. */
const ARM = new THREE.Vector2(-0.105, -0.021).normalize();
const RING_RADIUS = 0.075;
const ARM_RADIUS = 0.14;
/** Les plateaux sont dans le plan x ≈ 0,03–0,045 ; la manivelle droite s'en écarte vers l'extérieur. */
const ARM_MIN_X = 0.058;

const isTurning = (cx: number, cy: number, cz: number): boolean => {
  const dz = cz - BB_Z;
  const dy = cy - BB_Y;
  const r = Math.hypot(dz, dy);
  if (r < RING_RADIUS) return true;
  return cx > ARM_MIN_X && r < ARM_RADIUS && (dz * ARM.x + dy * ARM.y) / r > Math.cos((40 * Math.PI) / 180);
};

/** Sépare, dans la pièce du pédalier, ce qui tourne (plateau, manivelle) de ce qui reste (chaîne, dérailleur avant). */
export function splitY1rsCrankset(scene: THREE.Object3D): void {
  scene.updateMatrixWorld(true);
  const source = scene.getObjectByName(CRANKSET_NAME);
  if (!(source instanceof THREE.Mesh)) return;
  const geometry = source.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) return;
  const world = source.matrixWorld;
  const v = new THREE.Vector3();
  const centre = (i: number, into: THREE.Vector3): THREE.Vector3 => into.set(0, 0, 0).add(v.fromBufferAttribute(position, i).applyMatrix4(world));
  const turning: number[] = [];
  const fixed: number[] = [];
  const sum = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    sum.set(0, 0, 0).add(centre(a, p)).add(centre(b, p)).add(centre(c, p)).multiplyScalar(1 / 3);
    // Un triangle part avec le plateau si son centre est près de l'axe ou sur la manivelle ; la pointe d'une dent
    // qui déborderait du rayon reste avec la chaîne, ce qui ne se voit pas.
    if (isTurning(sum.x, sum.y, sum.z)) turning.push(a, b, c);
    // Ce qui dépasse du plan de la chaîne sans tourner (corps du dérailleur avant) traverse la jambe : on l'écarte.
    else if (sum.x <= ARM_MIN_X) fixed.push(a, b, c);
  }
  const ringGeometry = geometry.clone();
  ringGeometry.setIndex(turning);
  geometry.setIndex(fixed);
  // La manivelle droite du fichier est écartée de 16 cm ; le cycliste a le pied à 7 cm : on la plaque contre le plateau.
  const inverse = world.clone().invert();
  const spot = ringGeometry.getAttribute('position');
  for (let i = 0; i < spot.count; i++) {
    v.fromBufferAttribute(spot, i).applyMatrix4(world);
    if (v.x > ARM_MIN_X - 0.008) {
      v.x = ARM_MIN_X - 0.008 + (v.x - (ARM_MIN_X - 0.008)) * 0.12;
      spot.setXYZ(i, ...v.applyMatrix4(inverse).toArray());
    }
  }
  spot.needsUpdate = true;
  const ring = new THREE.Mesh(ringGeometry, source.material);
  ring.name = RING_NAME;
  ring.position.copy(source.position);
  ring.quaternion.copy(source.quaternion);
  ring.scale.copy(source.scale);
  source.parent?.add(ring);
}
