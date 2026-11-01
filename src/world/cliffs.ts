// Rochers posés sur les parois qui soutiennent la route, là où elle domine le terrain.

import * as THREE from 'three';
import type { Biomes, Route } from '../sim/route';
import { ROCK_COLORS } from './biomes';
import type { HeightField } from './heightField';
import { toon } from './materials';
import { ROAD_HALF_WIDTH_M, shoulderDrop, talusOffset, type Station } from './road';
import { rockGeometry } from './vegetation';

const SPACING_M = 4;
const PER_STATION = 4;
const MAX_ROCKS = 9000;
/** La paroi doit dépasser le terrain d'au moins cette hauteur pour porter des rochers. */
const MIN_EXPOSED_M = 1.2;
const FIRST_LATERAL_M = 9;
const LAST_LATERAL_M = 26;

const hash = (a: number, b: number): number => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export function buildCliffRocks(list: Station[], route: Route, field: HeightField, biomes: Biomes): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(rockGeometry(), toon({ vertexColors: true }), MAX_ROCKS);
  const dummy = new THREE.Object3D();
  const base = new THREE.Color(ROCK_COLORS[biomes.rock]);
  const color = new THREE.Color();
  const stride = Math.max(1, Math.round(SPACING_M / (route.pathM / (list.length - 1))));
  let count = 0;
  for (let i = 0; i < list.length && count < MAX_ROCKS; i += stride) {
    const s = list[i];
    for (let k = 0; k < PER_STATION * 2 && count < MAX_ROCKS; k++) {
      const sign = k % 2 ? 1 : -1;
      const wanted = FIRST_LATERAL_M + hash(i, k) * (LAST_LATERAL_M - FIRST_LATERAL_M);
      const offset =
        sign > 0
          ? talusOffset(sign * wanted, s.rightRadius, s.rightRoom)
          : talusOffset(sign * wanted, s.leftRadius, s.leftRoom);
      if (Math.abs(offset) <= ROAD_HALF_WIDTH_M + 2) continue;
      const x = s.x + s.nx * offset;
      const z = s.z + s.nz * offset;
      const y = s.ele + shoulderDrop(wanted);
      if (y - field.height(x, z) < MIN_EXPOSED_M) continue;
      // Une paroi qui plonge sur une autre route ne doit pas la joncher de rochers.
      if (field.exactRoadDistance(x, z) < ROAD_HALF_WIDTH_M + 3) continue;
      dummy.position.set(x, y, z);
      dummy.rotation.set(hash(i, k + 7) * 6, hash(i, k + 3) * 6, hash(i, k + 5) * 6);
      dummy.scale.setScalar(0.35 + hash(i, k + 9) ** 3 * 1.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      mesh.setColorAt(count, color.copy(base).multiplyScalar(0.62 + hash(i, k + 11) * 0.45));
      count++;
    }
  }
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
