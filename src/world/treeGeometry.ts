// Arbres vus de près : un tronc et des centaines de cartes de feuillage disposées comme de vraies
// branches. Générés depuis une graine fixe, pour que tous les joueurs voient les mêmes arbres.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Cards {
  private pos: number[] = [];
  private uv: number[] = [];
  private normal: number[] = [];
  private color: number[] = [];
  count = 0;

  /** Carte en deux tronçons, ce qui permet à une branche de ployer vers sa pointe. */
  add(base: THREE.Vector3, mid: THREE.Vector3, tip: THREE.Vector3, side: THREE.Vector3, n: THREE.Vector3, shadeBase: number, shadeTip: number): void {
    const v = (p: THREE.Vector3, s: number, u: number, across: number, shade: number) => {
      this.pos.push(p.x + side.x * s, p.y + side.y * s, p.z + side.z * s);
      this.uv.push(u, across);
      this.normal.push(n.x, n.y, n.z);
      this.color.push(shade, shade, shade);
    };
    const mids = (shadeBase + shadeTip) / 2;
    for (const [a, ua, sa, b, ub, sb] of [
      [base, 0, shadeBase, mid, 0.5, mids],
      [mid, 0.5, mids, tip, 1, shadeTip],
    ] as [THREE.Vector3, number, number, THREE.Vector3, number, number][]) {
      v(a, -0.5, ua, 0, sa);
      v(b, -0.5, ub, 0, sb);
      v(b, 0.5, ub, 1, sb);
      v(a, -0.5, ua, 0, sa);
      v(b, 0.5, ub, 1, sb);
      v(a, 0.5, ua, 1, sa);
    }
    this.count++;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    return g;
  }
}

export const CONIFER_HEIGHT_M = 15;
export const BROADLEAF_HEIGHT_M = 12;

/** Résineux : des verticilles de branches, longues en bas et courtes vers la cime. */
export function coniferCrown(seed = 11): THREE.BufferGeometry {
  const rand = seeded(seed);
  const cards = new Cards();
  const bottom = 1.9;
  const top = CONIFER_HEIGHT_M - 0.5;
  for (let y = bottom; y < top; y += 0.42) {
    const t = (y - bottom) / (top - bottom);
    const branches = 4 + Math.floor(rand() * 2);
    const start = rand() * Math.PI * 2;
    for (let i = 0; i < branches; i++) {
      const a = start + (i / branches) * Math.PI * 2 + rand() * 0.5;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const length = 0.4 + Math.pow(1 - t, 0.85) * 3.5 * (0.8 + rand() * 0.35);
      const droop = length * (0.2 + rand() * 0.28);
      const base = dir.clone().multiplyScalar(0.05).setY(y);
      const mid = dir.clone().multiplyScalar(length * 0.52).setY(y - droop * 0.28);
      const tip = dir.clone().multiplyScalar(length).setY(y - droop);
      const tangent = new THREE.Vector3(-dir.z, 0.24, dir.x).multiplyScalar(length * 0.6);
      const normal = dir.clone().multiplyScalar(0.55).setY(1).normalize();
      // Le coeur de l'arbre reste sombre : le soleil n'y entre pas.
      cards.add(base, mid, tip, tangent, normal, 0.42 + 0.3 * t, 0.9 + rand() * 0.15);
    }
  }
  return cards.build();
}

/** Feuillu : des grappes de feuilles réparties sur plusieurs masses du houppier. */
export function broadleafCrown(seed = 23): THREE.BufferGeometry {
  const rand = seeded(seed);
  const cards = new Cards();
  const masses = [
    [0, 7.7, 0, 4.2, 3.2],
    [1.9, 6.2, 1.4, 3, 2.3],
    [-2.1, 6.4, -1, 3, 2.3],
    [-0.8, 5.7, 2.1, 2.5, 1.9],
    [1, 8.9, -1.3, 2.4, 1.8],
  ];
  for (const [cx, cy, cz, rx, ry] of masses) {
    for (let i = 0; i < 34; i++) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const out = new THREE.Vector3(Math.cos(a) * r, u, Math.sin(a) * r);
      const depth = 0.6 + rand() * 0.42;
      const centre = new THREE.Vector3(cx + out.x * rx * depth, cy + out.y * ry * depth, cz + out.z * rx * depth);
      const size = 1.5 + rand() * 1.2;
      const tangent = new THREE.Vector3(-out.z, rand() - 0.5, out.x).normalize();
      const along = new THREE.Vector3().crossVectors(out, tangent).normalize();
      const spin = rand() * Math.PI;
      const axisA = along.clone().multiplyScalar(Math.cos(spin)).addScaledVector(tangent, Math.sin(spin));
      const axisB = tangent.clone().multiplyScalar(Math.cos(spin)).addScaledVector(along, -Math.sin(spin));
      const base = centre.clone().addScaledVector(axisA, -size / 2);
      const tip = centre.clone().addScaledVector(axisA, size / 2);
      const normal = out.clone().setY(out.y + 0.45).normalize();
      const light = 0.52 + 0.3 * Math.max(0, out.y) + 0.26 * depth;
      cards.add(base, centre, tip, axisB.multiplyScalar(size), normal, light * 0.82, light);
    }
  }
  return cards.build();
}

function limb(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): THREE.BufferGeometry {
  const span = to.clone().sub(from);
  const g = new THREE.CylinderGeometry(r1, r0, span.length(), 8, 3).translate(0, span.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.normalize()));
  return g.translate(from.x, from.y, from.z);
}

export function coniferTrunk(): THREE.BufferGeometry {
  return mergeGeometries([limb(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, 2, 0), 0.36, 0.25), limb(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 14.6, 0), 0.25, 0.015)])!;
}

export function broadleafTrunk(): THREE.BufferGeometry {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  return mergeGeometries([
    limb(v(0, -0.4, 0), v(0.05, 3.6, 0), 0.42, 0.26),
    limb(v(0.05, 3.5, 0), v(1.7, 6.3, 1.2), 0.19, 0.05),
    limb(v(0.05, 3.5, 0), v(-1.9, 6.4, -0.9), 0.18, 0.05),
    limb(v(0.05, 3.3, 0), v(-0.6, 8.6, 0.4), 0.2, 0.05),
    limb(v(0.05, 3.9, 0), v(0.9, 8.4, -1.2), 0.14, 0.04),
  ])!;
}
