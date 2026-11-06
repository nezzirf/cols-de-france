// Troupeaux des prairies : vaches et moutons modélisés à gros traits, posés sur le relief à côté de la route. Toutes
// les vaches ne forment qu'un seul objet instancié, et tous les moutons un autre : quelques centaines de bêtes ne coûtent
// presque rien à dessiner.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Herd, HerdKind } from '../sim/herds';
import type { Route } from '../sim/route';
import type { HeightField } from './heightField';

const COW_WHITE = 0xf2f0ea;
const COW_PATCH = 0x1d1c1b;
const COW_DARK = 0x2b2623;
const SHEEP_WOOL = 0xefebdf;
const SHEEP_DARK = 0x2a2724;

/** Une boîte colorée, placée dans le repère de l'animal (x vers l'avant, y vers le haut). */
function part(w: number, h: number, d: number, x: number, y: number, z: number, color: number, pitch = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (pitch !== 0) g.rotateZ(pitch);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g.toNonIndexed();
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** Vache blanche tachée de noir, la tête baissée comme quand elle broute. */
function cowGeometry(): THREE.BufferGeometry {
  const parts = [
    part(1.7, 0.78, 0.72, 0, 1.02, 0, COW_WHITE),
    part(0.5, 0.8, 0.74, 0.25, 1.03, 0, COW_PATCH),
    part(0.42, 0.8, 0.74, -0.52, 1.04, 0.0, COW_PATCH),
    part(0.5, 0.2, 0.34, 0.1, 1.41, 0.12, COW_PATCH),
    part(0.5, 0.36, 0.34, 1.0, 0.98, 0, COW_WHITE, -0.55),
    part(0.46, 0.36, 0.34, 1.18, 0.7, 0, COW_WHITE, -0.25),
    part(0.16, 0.14, 0.26, 1.42, 0.62, 0, COW_DARK),
    part(0.06, 0.12, 0.06, 1.12, 0.92, 0.2, COW_WHITE),
    part(0.06, 0.12, 0.06, 1.12, 0.92, -0.2, COW_WHITE),
    part(0.05, 0.6, 0.05, -0.9, 0.95, 0, COW_DARK),
  ];
  for (const x of [-0.6, 0.62]) {
    for (const z of [-0.24, 0.24]) parts.push(part(0.16, 0.66, 0.16, x, 0.33, z, x > 0 ? COW_WHITE : COW_PATCH));
  }
  return merged(parts);
}

/** Mouton à la laine épaisse, la tête sombre. */
function sheepGeometry(): THREE.BufferGeometry {
  const wool = new THREE.IcosahedronGeometry(0.5, 1);
  wool.scale(1.0, 0.78, 0.74);
  wool.translate(0, 0.62, 0);
  const c = new THREE.Color(SHEEP_WOOL);
  const colors = new Float32Array(wool.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  wool.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const parts = [
    wool.toNonIndexed(),
    part(0.26, 0.24, 0.2, 0.58, 0.55, 0, SHEEP_DARK, -0.35),
    part(0.07, 0.1, 0.1, 0.5, 0.66, 0.13, SHEEP_DARK),
    part(0.07, 0.1, 0.1, 0.5, 0.66, -0.13, SHEEP_DARK),
  ];
  for (const x of [-0.28, 0.3]) for (const z of [-0.15, 0.15]) parts.push(part(0.07, 0.4, 0.07, x, 0.2, z, SHEEP_DARK));
  return merged(parts);
}

/** Suite pseudo-aléatoire reproductible, pour que les bêtes se placent toujours de la même façon. */
function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Le troupeau le plus proche du cycliste, pour le son. */
export interface NearHerd {
  kind: HerdKind;
  /** Distance à la lisière du troupeau (m). */
  distanceM: number;
  /** De −1 (à gauche) à 1 (à droite), vu du cycliste. */
  pan: number;
}

interface Placed {
  kind: HerdKind;
  x: number;
  z: number;
  spreadM: number;
}

export class Herds {
  private placed: Placed[] = [];
  private meshes: THREE.InstancedMesh[] = [];

  constructor(route: Route, field: HeightField, scene: THREE.Scene, herds: Herd[]) {
    const animals: Record<HerdKind, THREE.Matrix4[]> = { vache: [], mouton: [] };
    const tints: Record<HerdKind, THREE.Color[]> = { vache: [], mouton: [] };
    const dummy = new THREE.Object3D();
    herds.forEach((herd, h) => {
      const p = route.at(herd.distM);
      // La normale à la route, à droite : même repère que pour le cycliste.
      const rx = Math.cos(p.heading) * herd.side;
      const rz = Math.sin(p.heading) * herd.side;
      const cx = p.x + rx * herd.offsetM;
      const cz = p.z + rz * herd.offsetM;
      this.placed.push({ kind: herd.kind, x: cx, z: cz, spreadM: herd.spreadM });
      const next = sequence(1000 + h * 97 + herd.distM);
      // Le troupeau regarde un peu dans la même direction, avec de l'écart d'une bête à l'autre.
      const facing = next() * Math.PI * 2;
      for (let i = 0; i < herd.count; i++) {
        const angle = next() * Math.PI * 2;
        const radius = Math.sqrt(next()) * herd.spreadM;
        const x = cx + Math.cos(angle) * radius;
        const z = cz + Math.sin(angle) * radius;
        dummy.position.set(x, field.height(x, z), z);
        dummy.rotation.set(0, facing + (next() - 0.5) * 1.6, 0);
        dummy.scale.setScalar(0.92 + next() * 0.22);
        dummy.updateMatrix();
        animals[herd.kind].push(dummy.matrix.clone());
        // Une vache sur cinq est brune ; les autres gardent leur robe blanche et noire.
        tints[herd.kind].push(herd.kind === 'vache' && next() < 0.2 ? new THREE.Color(0.62, 0.48, 0.38) : new THREE.Color(1, 1, 1));
      }
    });
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    for (const kind of ['vache', 'mouton'] as const) {
      const list = animals[kind];
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(kind === 'vache' ? cowGeometry() : sheepGeometry(), material, list.length);
      list.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, tints[kind][i]);
      });
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  get count(): number {
    return this.meshes.reduce((n, m) => n + m.count, 0);
  }

  /** Le troupeau le plus proche d'un point, avec le côté où il se trouve par rapport à la route (vecteur droit du cycliste). */
  nearest(px: number, pz: number, rightX: number, rightZ: number): NearHerd | null {
    let best: NearHerd | null = null;
    for (const h of this.placed) {
      const dx = h.x - px;
      const dz = h.z - pz;
      const d = Math.hypot(dx, dz);
      const distanceM = Math.max(0, d - h.spreadM);
      if (best && distanceM >= best.distanceM) continue;
      const side = (dx * rightX + dz * rightZ) / Math.max(10, d);
      best = { kind: h.kind, distanceM, pan: Math.max(-1, Math.min(1, side)) * 0.9 };
    }
    return best;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.removeFromParent();
    }
  }
}
