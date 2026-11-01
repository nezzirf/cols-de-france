// Style graphique commun. Tous les objets partagent la même rampe de lumière : la changer
// fait passer toute la scène du rendu « cartoon » (aplats) au rendu « doux » (dégradé).

import * as THREE from 'three';

const RAMP_SIZE = 64;
const rampData = new Uint8Array(RAMP_SIZE);
const ramp = new THREE.DataTexture(rampData, RAMP_SIZE, 1, THREE.RedFormat);
ramp.minFilter = THREE.LinearFilter;
ramp.magFilter = THREE.LinearFilter;

/** Paliers de lumière du mode cartoon : ombre, mi-teinte, lumière, plein soleil. */
const BANDS: [number, number][] = [
  [0.2, 0.46],
  [0.46, 0.68],
  [0.78, 0.88],
  [1.01, 1],
];

export function setRamp(cartoon: boolean): void {
  for (let i = 0; i < RAMP_SIZE; i++) {
    const t = i / (RAMP_SIZE - 1);
    const value = cartoon ? BANDS.find(([limit]) => t < limit)![1] : 0.42 + 0.58 * t;
    rampData[i] = Math.round(value * 255);
  }
  ramp.needsUpdate = true;
}
setRamp(true);

export function toon(params: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: ramp, ...params });
}
