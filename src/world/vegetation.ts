// Arbres, rochers et herbe placés sur le relief par tuiles déterministes autour du cycliste.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Biomes } from '../sim/route';
import { ROCK_COLORS } from './biomes';
import type { Occupancy } from './buildings';
import type { LandCover } from './landCover';
import type { HeightField } from './heightField';
import { toon } from './materials';

const TILE_M = 160;
const CELL_M = 11;
const RADIUS_TILES = 5;
const MAX_INSTANCES = 16000;

const GRASS_TILE_M = 24;
const GRASS_CELL_M = 1.5;
const GRASS_RADIUS_TILES = 3;
const MAX_TUFTS = 9000;

type Species = 'conifer' | 'broadleaf' | 'rock';

function painted(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Déforme une forme régulière pour lui retirer son air de primitive géométrique. */
function lumpy(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = Math.sin(x * 2.1 + seed) * Math.cos(y * 1.7 + seed) * Math.sin(z * 2.3 - seed);
    const k = 1 + n * amount;
    p.setXYZ(i, x * k, y, z * k);
  }
  return geo;
}

function coniferGeometry(): THREE.BufferGeometry {
  const parts = [painted(new THREE.CylinderGeometry(0.14, 0.3, 3, 6).translate(0, 1.5, 0), 0x4a3524)];
  [
    [2.9, 4.6, 3.2, 0xffffff],
    [2.5, 4.4, 5.4, 0xf0f0f0],
    [2.0, 4, 7.6, 0xffffff],
    [1.5, 3.4, 9.6, 0xf4f4f4],
    [0.9, 2.8, 11.4, 0xffffff],
  ].forEach(([r, h, y, tone], i) => {
    const cone = new THREE.ConeGeometry(r, h, 9, 2).translate(0, y, 0);
    parts.push(painted(lumpy(cone, 0.16, i * 1.9), tone));
  });
  return mergeGeometries(parts)!;
}

function broadleafGeometry(): THREE.BufferGeometry {
  const parts = [painted(new THREE.CylinderGeometry(0.17, 0.36, 3.8, 7).translate(0, 1.9, 0), 0x56422f)];
  [
    [2.9, 0, 5.6, 0],
    [2.3, 1.7, 4.9, 0.8],
    [2.2, -1.5, 5.1, -0.9],
    [2.0, 0.4, 7.4, -0.5],
    [1.7, -0.7, 6.8, 1.3],
  ].forEach(([r, x, y, z], i) => {
    const blob = new THREE.IcosahedronGeometry(r, 2);
    parts.push(painted(lumpy(blob, 0.13, i * 2.4).translate(x, y, z), 0xffffff));
  });
  return mergeGeometries(parts)!;
}

export function rockGeometry(): THREE.BufferGeometry {
  return painted(lumpy(new THREE.DodecahedronGeometry(1, 1), 0.2, 3).scale(1.25, 0.7, 1), 0xffffff);
}

/** Touffe : quelques brins effilés, sans transparence pour rester peu coûteuse. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const colors: number[] = [];
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const r = 0.13 + (i % 2) * 0.09;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const wx = -z * 0.5;
    const wz = x * 0.5;
    const h = 0.42 + (i % 3) * 0.1;
    pos.push(x - wx, 0, z - wz, x + wx, 0, z + wz, x * 2.1, h, z * 2.1);
    colors.push(0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 1, 1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const hash = (x: number, y: number, s: number): number => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

interface Placement {
  species: Species;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  color: THREE.Color;
}

interface Tuft {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  color: THREE.Color;
}

export class Vegetation {
  private meshes: Record<Species, THREE.InstancedMesh>;
  private grass: THREE.InstancedMesh;
  private tiles = new Map<string, Placement[]>();
  private grassTiles = new Map<string, Tuft[]>();
  private currentKey = '';
  private grassKey = '';
  private dummy = new THREE.Object3D();
  private conifers: number[];
  private broadleaves: number[];
  private rockColor: THREE.Color;
  private wind = { value: 0 };

  constructor(
    private field: HeightField,
    private biomes: Biomes,
    private occupancy: Occupancy,
    private cover: LandCover,
    scene: THREE.Scene,
  ) {
    const material = toon({ vertexColors: true });
    const swaying = toon({ vertexColors: true });
    this.addWind(swaying, 0.012);
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.meshes = {
      conifer: mesh(coniferGeometry(), swaying),
      broadleaf: mesh(broadleafGeometry(), swaying),
      rock: mesh(rockGeometry(), material),
    };
    const grassMaterial = toon({ vertexColors: true });
    this.addWind(grassMaterial, 0.2);
    this.grass = new THREE.InstancedMesh(tuftGeometry(), grassMaterial, MAX_TUFTS);
    this.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.grass.frustumCulled = false;
    this.grass.count = 0;
    this.grass.receiveShadow = true;
    scene.add(this.grass);
    this.conifers = biomes.trees === 'meleze' ? [0x7f9a3e, 0x8fa444, 0x6e8a3e] : [0x2c5a35, 0x37683c, 0x264d31, 0x427544];
    this.broadleaves = [0x4f8038, 0x5e8f40, 0x447033, 0x6c9344];
    this.rockColor = new THREE.Color(ROCK_COLORS[biomes.rock]);
  }

  /** Balancement au vent, proportionnel à la hauteur : le pied reste fixe. */
  private addWind(material: THREE.Material, amount: number): void {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = this.wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float sway = sin(uWind * 1.4 + instanceMatrix[3].x * 0.09 + instanceMatrix[3].z * 0.07);
            transformed.x += sway * transformed.y * ${amount.toFixed(3)};
            transformed.z += cos(uWind * 1.1 + instanceMatrix[3].x * 0.07) * transformed.y * ${(amount * 0.6).toFixed(3)};
          #endif`,
        );
    };
  }

  private treeRatio(): number {
    // Part de conifères dans la forêt, selon l'essence réelle de chaque massif.
    return { mixte: 0.55, cedre: 0.6, hetre: 0.45, sapin: 0.92, meleze: 1 }[this.biomes.trees];
  }

  private place(tx: number, tz: number): Placement[] {
    const out: Placement[] = [];
    const b = this.biomes;
    const n = Math.round(TILE_M / CELL_M);
    const ratio = this.treeRatio();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const gx = tx * n + i;
        const gz = tz * n + j;
        const x = (gx + hash(gx, gz, 1)) * CELL_M;
        const z = (gz + hash(gx, gz, 2)) * CELL_M;
        if (this.occupancy.has(x, z) || this.field.exactRoadDistance(x, z) < 10) continue;
        const y = this.field.height(x, z);
        const e = 18;
        const slope = Math.hypot(this.field.height(x + e, z) - y, this.field.height(x, z + e) - y) / e;
        const jitter = y + (hash(gx, gz, 3) - 0.5) * 120;
        const roll = hash(gx, gz, 4);
        const scale = 0.72 + hash(gx, gz, 5) * 0.75;
        const rot = hash(gx, gz, 6) * Math.PI * 2;

        // La photo aérienne dit où est la forêt ; l'altitude choisit seulement l'essence.
        const wooded = this.cover.isForest(x, z);
        let density = 0;
        let species: Species = 'rock';
        if (jitter < b.valley) {
          density = wooded ? 0.66 : 0.025;
          species = hash(gx, gz, 7) < ratio * 0.5 ? 'conifer' : 'broadleaf';
        } else if (jitter < b.forest) {
          density = wooded ? 0.72 : 0.03;
          species = hash(gx, gz, 7) < ratio ? 'conifer' : 'broadleaf';
        } else if (jitter < b.alpage) {
          density = wooded ? 0.5 : 0.05;
          species = wooded || hash(gx, gz, 7) < 0.3 ? 'conifer' : 'rock';
        } else {
          density = wooded ? 0.3 : 0.5;
          species = wooded ? 'conifer' : 'rock';
        }
        if (slope > 1.5 && species !== 'rock') species = 'rock';
        if (roll > density) continue;

        const isRock = species === 'rock';
        const palette = species === 'conifer' ? this.conifers : this.broadleaves;
        const color = isRock
          ? this.rockColor.clone().multiplyScalar(0.72 + hash(gx, gz, 8) * 0.4)
          : new THREE.Color(palette[Math.floor(hash(gx, gz, 8) * palette.length)]);
        out.push({
          species,
          x,
          y: isRock ? y : y - 0.2,
          z,
          scale: isRock ? 0.22 + hash(gx, gz, 5) ** 4 * 2.8 : scale * (y > b.forest - 120 ? 0.72 : 1),
          rot,
          color,
        });
      }
    }
    return out;
  }

  private placeGrass(tx: number, tz: number): Tuft[] {
    const out: Tuft[] = [];
    const b = this.biomes;
    const n = Math.round(GRASS_TILE_M / GRASS_CELL_M);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const gx = tx * n + i;
        const gz = tz * n + j;
        const x = (gx + hash(gx, gz, 11)) * GRASS_CELL_M;
        const z = (gz + hash(gx, gz, 12)) * GRASS_CELL_M;
        const y = this.field.height(x, z);
        if (y > b.alpage + 40 || hash(gx, gz, 13) > 0.8) continue;
        if (this.occupancy.has(x, z) || this.field.exactRoadDistance(x, z) < 5.2) continue;
        const roll = hash(gx, gz, 14);
        const inForest = y > b.valley && y < b.forest;
        // Fleurs des prés : des touches de couleur, surtout en alpage.
        const flowers = y > b.forest ? 0.1 : 0.035;
        let color: THREE.Color;
        if (roll < flowers && !inForest) {
          color = new THREE.Color([0xf4e04d, 0xffffff, 0xc95ad1, 0xe8603c][Math.floor(hash(gx, gz, 15) * 4)]);
        } else if (inForest) {
          color = new THREE.Color(0x3c6a2c).multiplyScalar(0.8 + hash(gx, gz, 16) * 0.4);
        } else if (y > b.forest) {
          color = new THREE.Color(0x7d8c42).multiplyScalar(0.85 + hash(gx, gz, 16) * 0.3);
        } else {
          color = new THREE.Color(0x5e8a34).multiplyScalar(0.85 + hash(gx, gz, 16) * 0.3);
        }
        out.push({ x, y: y - 0.04, z, scale: 0.8 + hash(gx, gz, 17) * 0.9, rot: hash(gx, gz, 18) * 6.28, color });
      }
    }
    return out;
  }

  private updateGrass(x: number, z: number): void {
    const cx = Math.floor(x / GRASS_TILE_M);
    const cz = Math.floor(z / GRASS_TILE_M);
    const key = `${cx}/${cz}`;
    if (key === this.grassKey) return;
    this.grassKey = key;
    let count = 0;
    for (let dz = -GRASS_RADIUS_TILES; dz <= GRASS_RADIUS_TILES; dz++) {
      for (let dx = -GRASS_RADIUS_TILES; dx <= GRASS_RADIUS_TILES; dx++) {
        const k = `${cx + dx}/${cz + dz}`;
        let tile = this.grassTiles.get(k);
        if (!tile) {
          tile = this.placeGrass(cx + dx, cz + dz);
          this.grassTiles.set(k, tile);
        }
        for (const t of tile) {
          if (count >= MAX_TUFTS) break;
          this.dummy.position.set(t.x, t.y, t.z);
          this.dummy.rotation.set(0, t.rot, 0);
          this.dummy.scale.setScalar(t.scale);
          this.dummy.updateMatrix();
          this.grass.setMatrixAt(count, this.dummy.matrix);
          this.grass.setColorAt(count, t.color);
          count++;
        }
      }
    }
    this.grass.count = count;
    this.grass.instanceMatrix.needsUpdate = true;
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
    // Les tuiles lointaines ne reservent plus : on évite que le cache grossisse sans fin.
    if (this.grassTiles.size > 600) this.grassTiles.clear();
  }

  update(x: number, z: number, dt: number): void {
    this.wind.value += dt;
    this.updateGrass(x, z);
    const cx = Math.floor(x / TILE_M);
    const cz = Math.floor(z / TILE_M);
    const key = `${cx}/${cz}`;
    if (key === this.currentKey) return;
    this.currentKey = key;

    const counts: Record<Species, number> = { conifer: 0, broadleaf: 0, rock: 0 };
    for (let dz = -RADIUS_TILES; dz <= RADIUS_TILES; dz++) {
      for (let dx = -RADIUS_TILES; dx <= RADIUS_TILES; dx++) {
        if (dx * dx + dz * dz > RADIUS_TILES * RADIUS_TILES + 2) continue;
        const k = `${cx + dx}/${cz + dz}`;
        let tile = this.tiles.get(k);
        if (!tile) {
          tile = this.place(cx + dx, cz + dz);
          this.tiles.set(k, tile);
        }
        for (const p of tile) {
          const i = counts[p.species];
          if (i >= MAX_INSTANCES) continue;
          this.dummy.position.set(p.x, p.y, p.z);
          this.dummy.rotation.set(0, p.rot, 0);
          this.dummy.scale.setScalar(p.scale);
          this.dummy.updateMatrix();
          const mesh = this.meshes[p.species];
          mesh.setMatrixAt(i, this.dummy.matrix);
          mesh.setColorAt(i, p.color);
          counts[p.species]++;
        }
      }
    }
    for (const s of Object.keys(this.meshes) as Species[]) {
      const m = this.meshes[s];
      m.count = counts[s];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
