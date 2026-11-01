// Transmission : une chaîne faite de vrais maillons qui épouse le plateau, le pignon et les galets du
// dérailleur, et qui avance avec le pédalier.

import * as THREE from 'three';
import { at, type Point } from './modelParts';

/** Pas d'une chaîne de vélo : 12,7 mm. */
export const CHAIN_PITCH = 0.0127;

/** Un cercle que la chaîne contourne ; `dir` vaut +1 si elle le tourne à l'endroit, -1 à l'envers. */
export interface Wheel {
  c: Point;
  r: number;
  dir: 1 | -1;
}

interface Piece {
  length: number;
  /** Position et cap (radians) à la fraction `u` de la pièce. */
  at(u: number): { p: Point; heading: number };
}

const TAU = Math.PI * 2;
const mod = (a: number): number => ((a % TAU) + TAU) % TAU;

/**
 * Courroie fermée autour de cercles pris dans l'ordre : segments de tangente et arcs. Une tangente
 * entre deux cercles de même sens est extérieure, entre deux sens contraires elle croise (le S du dérailleur).
 */
export function chainLoop(wheels: Wheel[]): { length: number; sample(s: number): { p: Point; heading: number } } {
  const n = wheels.length;
  const heading = wheels.map((w, i) => {
    const next = wheels[(i + 1) % n];
    const dx = next.c[0] - w.c[0];
    const dy = next.c[1] - w.c[1];
    const d = Math.hypot(dx, dy);
    return Math.atan2(dy, dx) - Math.asin((next.dir * next.r - w.dir * w.r) / d);
  });
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const w = wheels[i];
    const arrive = heading[(i + n - 1) % n];
    const depart = heading[i];
    const sweep = w.dir > 0 ? mod(depart - arrive) : -mod(arrive - depart);
    const start = arrive + (w.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    pieces.push({
      length: Math.abs(sweep) * w.r,
      at: (u) => {
        const a = start + sweep * u;
        return { p: [w.c[0] + w.r * Math.cos(a), w.c[1] + w.r * Math.sin(a)], heading: arrive + sweep * u };
      },
    });
    const next = wheels[(i + 1) % n];
    const from: Point = [w.c[0] + w.r * Math.cos(depart + (w.dir > 0 ? -Math.PI / 2 : Math.PI / 2)), w.c[1] + w.r * Math.sin(depart + (w.dir > 0 ? -Math.PI / 2 : Math.PI / 2))];
    const to: Point = [next.c[0] + next.r * Math.cos(depart + (next.dir > 0 ? -Math.PI / 2 : Math.PI / 2)), next.c[1] + next.r * Math.sin(depart + (next.dir > 0 ? -Math.PI / 2 : Math.PI / 2))];
    pieces.push({
      length: Math.hypot(to[0] - from[0], to[1] - from[1]),
      at: (u) => ({ p: [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u], heading: depart }),
    });
  }
  const length = pieces.reduce((sum, piece) => sum + piece.length, 0);
  return {
    length,
    sample(s) {
      let rest = mod2(s, length);
      for (const piece of pieces) {
        if (rest <= piece.length || piece === pieces[pieces.length - 1]) return piece.at(piece.length > 0 ? Math.min(1, rest / piece.length) : 0);
        rest -= piece.length;
      }
      return pieces[0].at(0);
    },
  };
}

const mod2 = (a: number, m: number): number => ((a % m) + m) % m;

export interface Chain {
  group: THREE.Group;
  /** Fait avancer la chaîne de `distance` mètres le long de son circuit. */
  advance(distance: number): void;
}

/** Chaîne en maillons extérieurs brillants et intérieurs plus sombres, un par demi-pas. */
export function buildChain(wheels: Wheel[], side: number, outer: THREE.Material, inner: THREE.Material): Chain {
  const loop = chainLoop(wheels);
  const links = Math.round(loop.length / CHAIN_PITCH / 2) * 2;
  const spacing = loop.length / links;
  const group = new THREE.Group();
  const outerPlates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0058, 0.0074, spacing * 0.92), outer, links / 2);
  const innerPlates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0043, 0.0064, spacing * 0.78), inner, links / 2);
  group.add(outerPlates, innerPlates);
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3(1, 0, 0);
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  let travelled = 0;
  const place = () => {
    for (let k = 0; k < links; k++) {
      const { p, heading } = loop.sample(k * spacing + travelled);
      z.set(0, Math.sin(heading), -Math.cos(heading));
      y.crossVectors(z, x);
      m.makeBasis(x, y, z).setPosition(at(p[0], p[1], side));
      (k % 2 === 0 ? outerPlates : innerPlates).setMatrixAt(k >> 1, m);
    }
    outerPlates.instanceMatrix.needsUpdate = true;
    innerPlates.instanceMatrix.needsUpdate = true;
  };
  place();
  return {
    group,
    advance(distance) {
      travelled = mod2(distance, loop.length);
      place();
    },
  };
}
