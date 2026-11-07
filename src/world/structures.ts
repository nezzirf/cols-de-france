// Ponts réels du tracé : des parapets de pierre de part et d'autre de la chaussée, et le ruisseau qui passe dessous.

import * as THREE from 'three';
import type { Route } from '../sim/route';
import type { Span } from '../sim/structures';
import type { HeightField } from './heightField';

const PARAPET_SEGMENT_M = 4;
const PARAPET_SIDE_M = 3.35;
/** Le ruisseau s'étend de chaque côté de la route sur cette distance (m). */
const STREAM_REACH_M = 46;
const STREAM_STEPS = 32;
/** L'eau affleure le sol : un peu au-dessus pour ne pas disparaître dans le relief. */
const WATER_LIFT_M = 0.1;
const FLOW_MPS = 0.55;

/** Le cours du ruisseau sous un pont : traverse la route, avec quelques méandres. */
export interface StreamPath {
  width: number;
  forward: { x: number; z: number };
  /** Points du milieu de l'eau, avec leur écart à la route. */
  points: { x: number; z: number; s: number }[];
}

export function streamPath(route: Route, span: Span): StreamPath {
  const mid = (span.fromM + span.toM) / 2;
  const p = route.at(mid);
  const right = { x: Math.cos(p.heading), z: Math.sin(p.heading) };
  const forward = { x: Math.sin(p.heading), z: -Math.cos(p.heading) };
  // Plus le pont est long, plus le cours d'eau est large.
  const width = Math.max(3, Math.min(9, (span.toM - span.fromM) * 0.11));
  const points = [];
  for (let i = 0; i <= STREAM_STEPS; i++) {
    const s = -STREAM_REACH_M + (2 * STREAM_REACH_M * i) / STREAM_STEPS;
    const wander = Math.sin(s * 0.09 + mid) * 3.2;
    points.push({ x: p.x + right.x * s + forward.x * wander, z: p.z + right.z * s + forward.z * wander, s });
  }
  return { width, forward, points };
}

/** Les emplacements de l'eau et de ses berges : ni arbre ni herbe n'y poussent. */
export function streamFootprints(route: Route): [number, number][][] {
  const rings: [number, number][][] = [];
  for (const span of route.data.structures?.bridges ?? []) {
    const { width, points } = streamPath(route, span);
    const r = width / 2 + 2.8;
    for (const q of points) rings.push([[q.x - r, q.z - r], [q.x + r, q.z - r], [q.x + r, q.z + r], [q.x - r, q.z + r]]);
  }
  return rings;
}

/** Des traînées claires sur fond bleu-vert : la texture qui défile fait le courant. */
function waterTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c6e82';
  g.fillRect(0, 0, c.width, c.height);
  let seed = 7;
  const next = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 70; i++) {
    const x = next() * c.width;
    const y = next() * c.height;
    const len = 14 + next() * 40;
    g.strokeStyle = `rgba(225, 242, 247, ${0.1 + next() * 0.22})`;
    g.lineWidth = 1 + next() * 2.2;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (next() - 0.5) * 10, y + len / 2, x + (next() - 0.5) * 6, y + len);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Structures {
  private group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private flow: THREE.CanvasTexture | null = null;

  constructor(route: Route, private field: HeightField, scene: THREE.Scene) {
    const data = route.data.structures;
    if (!data) return;
    this.addParapets(route, data.bridges);
    for (const span of data.bridges) this.addStream(route, span);
    this.group.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    scene.add(this.group);
  }

  /** Un ruisseau qui traverse la route sous le pont, posé sur le relief, avec des berges de gravier. */
  private addStream(route: Route, span: Span): void {
    const { width, forward, points } = streamPath(route, span);
    if (!this.flow) {
      this.flow = waterTexture();
      this.disposables.push(this.flow);
    }
    const ribbon = (half: number, lift: number): THREE.BufferGeometry => {
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const { x: cx, z: cz, s } = points[i];
        for (const side of [-1, 1]) {
          const x = cx + forward.x * half * side;
          const z = cz + forward.z * half * side;
          positions.push(x, this.field.height(x, z) + lift, z);
          uvs.push(side < 0 ? 0 : 1, s / 7);
        }
        if (i > 0) {
          const a = (i - 1) * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      g.computeVertexNormals();
      return g;
    };
    const banks = ribbon(width / 2 + 1.6, WATER_LIFT_M * 0.4);
    const water = ribbon(width / 2, WATER_LIFT_M);
    const bankMat = new THREE.MeshStandardMaterial({ color: 0x8c8678, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const waterMat = new THREE.MeshStandardMaterial({ map: this.flow, roughness: 0.12, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.group.add(new THREE.Mesh(banks, bankMat), new THREE.Mesh(water, waterMat));
    this.disposables.push(banks, water, bankMat, waterMat);
  }

  /** Le courant : la texture de l'eau défile le long du ruisseau. */
  update(dt: number): void {
    if (this.flow) this.flow.offset.y -= (FLOW_MPS / 7) * dt;
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
