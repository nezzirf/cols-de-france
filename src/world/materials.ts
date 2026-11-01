// Matière réaliste commune : réagit au soleil, au ciel et aux ombres selon sa rugosité.

import * as THREE from 'three';

export function pbr(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...params });
}

/** Peinture de cadre : une couche de vernis par-dessus la couleur, qui donne un reflet net et profond. */
export function lacquer(params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ roughness: 0.34, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06, ...params });
}

/** Tissu technique : le duvet des fibres éclaircit les bords, ce qui arrondit les volumes. */
export function textile(params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  // Le duvet reprend la teinte du tissu, à peine éclaircie : un noir reste noir.
  const sheenColor = new THREE.Color(params.color ?? 0xffffff).lerp(new THREE.Color(0xffffff), 0.18);
  return new THREE.MeshPhysicalMaterial({ roughness: 0.74, sheen: 0.45, sheenRoughness: 0.6, sheenColor, ...params });
}

/** Peau : un léger éclat sur les bords, sans reflet de plastique. */
export function skinMaterial(color: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, sheen: 0.6, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffc9a8) });
}
