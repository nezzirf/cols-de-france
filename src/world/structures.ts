// Ponts réels du tracé : des parapets de pierre de part et d'autre de la chaussée.

import * as THREE from 'three';
import type { Route } from '../sim/route';
import type { Span } from '../sim/structures';

const PARAPET_SEGMENT_M = 4;
const PARAPET_SIDE_M = 3.35;

export class Structures {
  private group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor(route: Route, scene: THREE.Scene) {
    const data = route.data.structures;
    if (!data) return;
    this.addParapets(route, data.bridges);
    this.group.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    scene.add(this.group);
  }

  private addParapets(route: Route, bridges: Span[]): void {
    const segments: { distM: number; side: number; length: number }[] = [];
    for (const span of bridges) {
      const n = Math.max(1, Math.ceil((span.toM - span.fromM) / PARAPET_SEGMENT_M));
      const length = (span.toM - span.fromM) / n;
      for (let i = 0; i < n; i++) for (const side of [-1, 1]) segments.push({ distM: span.fromM + (i + 0.5) * length, side, length });
    }
    if (segments.length === 0) return;
    const geometry = new THREE.BoxGeometry(0.4, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95 });
    const wall = new THREE.InstancedMesh(geometry, material, segments.length);
    const dummy = new THREE.Object3D();
    segments.forEach((s, i) => {
      const p = route.at(s.distM);
      dummy.position.set(p.x + Math.cos(p.heading) * PARAPET_SIDE_M * s.side, p.ele + 0.5, p.z + Math.sin(p.heading) * PARAPET_SIDE_M * s.side);
      dummy.rotation.set(0, -p.heading, 0);
      dummy.scale.set(1, 1, s.length + 0.1);
      dummy.updateMatrix();
      wall.setMatrixAt(i, dummy.matrix);
    });
    wall.frustumCulled = false;
    this.group.add(wall);
    this.disposables.push(geometry, material, wall);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
