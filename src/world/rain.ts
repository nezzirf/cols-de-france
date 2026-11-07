// Pluie : des traits qui tombent dans un volume autour de la caméra.

import * as THREE from 'three';

const DROPS = 2200;
const SPAN_M = 46;
const HEIGHT_M = 22;
const FALL_MPS = 14;
const LENGTH_M = 0.7;
const SLANT = 0.12;

export class Rain {
  readonly mesh: THREE.LineSegments;
  private positions: Float32Array;
  private tops: Float32Array;

  constructor() {
    this.positions = new Float32Array(DROPS * 6);
    this.tops = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) {
      this.tops[i * 3] = (Math.random() - 0.5) * SPAN_M * 2;
      this.tops[i * 3 + 1] = Math.random() * HEIGHT_M;
      this.tops[i * 3 + 2] = (Math.random() - 0.5) * SPAN_M * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xcfd9e2, transparent: true, opacity: 0.38, depthWrite: false, fog: false });
    this.mesh = new THREE.LineSegments(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Force de la pluie, de 0 à 1 : les gouttes deviennent plus visibles. */
  setIntensity(v: number): void {
    (this.mesh.material as THREE.LineBasicMaterial).opacity = 0.38 * Math.max(0, Math.min(1, v));
  }

  /** Fait tomber la pluie autour de `center` ; chaque trait revient en haut quand il touche le sol. */
  update(dt: number, center: THREE.Vector3): void {
    const { tops, positions } = this;
    for (let i = 0; i < DROPS; i++) {
      let y = tops[i * 3 + 1] - FALL_MPS * dt;
      if (y < 0) y += HEIGHT_M;
      tops[i * 3 + 1] = y;
      const x = center.x + tops[i * 3];
      const z = center.z + tops[i * 3 + 2];
      const worldY = center.y - 6 + y;
      const k = i * 6;
      positions[k] = x;
      positions[k + 1] = worldY;
      positions[k + 2] = z;
      positions[k + 3] = x - SLANT * LENGTH_M;
      positions[k + 4] = worldY + LENGTH_M;
      positions[k + 5] = z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
