// Matière réaliste commune : réagit au soleil, au ciel et aux ombres selon sa rugosité.

import * as THREE from 'three';

export function pbr(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...params });
}
