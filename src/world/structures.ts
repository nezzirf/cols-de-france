// Tunnels et ponts réels du tracé : une galerie en arche avec ses luminaires pour chaque tunnel, des parapets de pierre
// de part et d'autre de la chaussée pour chaque pont.

import * as THREE from 'three';
import type { Route } from '../sim/route';
import type { Span } from '../sim/structures';

/** Demi-largeur intérieure de la galerie (m) : la chaussée fait 3 m de demi-largeur, il reste une banquette. */
const HALF_WIDTH_M = 4.6;
/** Hauteur des piédroits avant que la voûte ne s'arrondisse (m). */
const WALL_M = 2.3;
const ARCH_STEPS = 12;
/** Distance entre deux coupes de la galerie le long de la route (m). */
const STATION_M = 3;
const LAMP_EVERY_M = 14;
const PARAPET_SEGMENT_M = 4;
const PARAPET_SIDE_M = 3.35;

/** La coupe d'une galerie : piédroit gauche, voûte, piédroit droit, en (écart latéral, hauteur). */
function section(): [number, number][] {
  const pts: [number, number][] = [[-HALF_WIDTH_M, 0], [-HALF_WIDTH_M, WALL_M]];
  for (let i = 1; i < ARCH_STEPS; i++) {
    const a = Math.PI - (Math.PI * i) / ARCH_STEPS;
    pts.push([Math.cos(a) * HALF_WIDTH_M, WALL_M + Math.sin(a) * HALF_WIDTH_M]);
  }
  pts.push([HALF_WIDTH_M, WALL_M], [HALF_WIDTH_M, 0]);
  return pts;
}

function tunnelGeometry(route: Route, span: Span): THREE.BufferGeometry {
  const profile = section();
  const stations = Math.max(2, Math.ceil((span.toM - span.fromM) / STATION_M) + 1);
  const positions: number[] = [];
  for (let s = 0; s < stations; s++) {
    const d = span.fromM + ((span.toM - span.fromM) * s) / (stations - 1);
    const p = route.at(d);
    for (const [lat, up] of profile) positions.push(p.x + Math.cos(p.heading) * lat, p.ele + up, p.z + Math.sin(p.heading) * lat);
  }
  const indices: number[] = [];
  const n = profile.length;
  for (let s = 0; s + 1 < stations; s++) {
    for (let i = 0; i + 1 < n; i++) {
      const a = s * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export class Structures {
  private group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor(route: Route, scene: THREE.Scene) {
    const data = route.data.structures;
    if (!data) return;
    for (const span of data.tunnels) this.addTunnel(route, span);
    this.addParapets(route, data.bridges);
    this.group.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    scene.add(this.group);
  }

  private addTunnel(route: Route, span: Span): void {
    const geometry = tunnelGeometry(route, span);
    // Le même volume vu de l'extérieur (béton clair) et de l'intérieur (parois sombres).
    const outside = new THREE.MeshStandardMaterial({ color: 0x7a766d, roughness: 0.95, side: THREE.FrontSide });
    const inside = new THREE.MeshStandardMaterial({ color: 0x4a4844, roughness: 0.98, side: THREE.BackSide });
    this.group.add(new THREE.Mesh(geometry, outside), new THREE.Mesh(geometry, inside));
    this.disposables.push(geometry, outside, inside);

    // Une ligne de luminaires au sommet de la voûte.
    const count = Math.max(1, Math.floor((span.toM - span.fromM) / LAMP_EVERY_M));
    const lampGeo = new THREE.BoxGeometry(0.28, 0.07, 1.1);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const d = span.fromM + ((i + 0.5) * (span.toM - span.fromM)) / count;
      const p = route.at(d);
      dummy.position.set(p.x, p.ele + WALL_M + HALF_WIDTH_M - 0.08, p.z);
      dummy.rotation.set(0, -p.heading, 0);
      dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);
    }
    lamps.frustumCulled = false;
    this.group.add(lamps);
    this.disposables.push(lampGeo, lampMat, lamps);
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
