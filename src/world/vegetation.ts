// Arbres, rochers et herbe placés sur le relief par tuiles déterministes autour du cycliste.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { valueNoise } from '../sim/noise';
import type { Biomes } from '../sim/route';
import { biomeWeights, pickZone, snowAmount, type WorldBiome, type WorldMeta } from '../sim/worldBiomes';
import { ROCK_COLORS } from './biomes';
import type { Occupancy } from './buildings';
import {
  barkTexture,
  broadleafTexture,
  coniferTexture,
  crossedPlanes,
  fernTexture,
  flowerTexture,
  foliageDepth,
  frondTexture,
  leafClusterTexture,
  palmTexture,
} from './foliage';
import type { HeightField } from './heightField';
import { pbr } from './materials';
import { WORLD_STYLE } from './worldStyle';
import { broadleafCrown, broadleafTrunk, coniferCrown, coniferTrunk } from './treeGeometry';

const TILE_M = 160;
const CELL_M = 11;
const RADIUS_TILES = 5;
const MAX_INSTANCES = 16000;
/** Rayon des arbres détaillés ; au-delà, des plans croisés suffisent et coûtent 40 fois moins. */
const NEAR_TREE_M = 240;
const MAX_NEAR_TREES = 2400;

const GRASS_TILE_M = 24;
const GRASS_CELL_M = 1.05;
const GRASS_RADIUS_TILES = 3;
const MAX_TUFTS = 24000;

type Species = 'conifer' | 'broadleaf' | 'palm' | 'cactus' | 'rock';
type Tree = 'conifer' | 'broadleaf';
type Plant = 'grass' | 'fern' | 'flower';

/** Touffe d'herbe cuite à partir du modèle 3D fourni : une vue de côté, transparente entre les brins, éclaircie pour que la teinte de la zone la colore. */
function tuftTexture(): THREE.Texture {
  const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}models/herbe/grass.png`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

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

export function rockGeometry(): THREE.BufferGeometry {
  return painted(lumpy(new THREE.DodecahedronGeometry(1, 1), 0.2, 3).scale(1.25, 0.7, 1), 0xffffff);
}

/** Cactus candélabre : un tronc cannelé et deux bras relevés, vert en tout point. */
export function cactusGeometry(): THREE.BufferGeometry {
  const green = 0x5d8f4a;
  const part = (geo: THREE.BufferGeometry) => painted(lumpy(geo, 0.05, 5), green);
  const arm = (side: number, height: number, reach: number, rise: number): THREE.BufferGeometry[] => [
    part(new THREE.CylinderGeometry(0.28, 0.3, reach, 8, 1).rotateZ(Math.PI / 2).translate(side * reach * 0.5, height, 0)),
    part(new THREE.CylinderGeometry(0.26, 0.28, rise, 8, 2).translate(side * reach, height + rise / 2, 0)),
    part(new THREE.SphereGeometry(0.26, 8, 6).translate(side * reach, height + rise, 0)),
  ];
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.4, 0.48, 4.4, 10, 3).translate(0, 2.2, 0)),
    part(new THREE.SphereGeometry(0.4, 10, 6).translate(0, 4.4, 0)),
    ...arm(-1, 1.9, 1.0, 1.7),
    ...arm(1, 2.7, 0.9, 1.2),
  ])!;
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
  /** Corpulence : deux arbres de même hauteur ne sont pas aussi larges. */
  girth: number;
  rot: number;
  color: THREE.Color;
}

interface Tuft {
  kind: Plant;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  color: THREE.Color;
}

export class Vegetation {
  private meshes: Record<Species, THREE.InstancedMesh>;
  private near: Record<Tree, { crown: THREE.InstancedMesh; trunk: THREE.InstancedMesh }>;
  private plants: Record<Plant, THREE.InstancedMesh>;
  private tiles = new Map<string, Placement[]>();
  private grassTiles = new Map<string, Tuft[]>();
  private currentKey = '';
  private grassKey = '';
  private dummy = new THREE.Object3D();
  private conifers: number[];
  private broadleaves: number[];
  private rockColor: THREE.Color;
  private palms = [0xffffff, 0xf4f6e4, 0xe6eed2];
  private cacti = [0xffffff, 0xe6f0d8, 0xf2eed0, 0xd8e4c0];
  private wind = { value: 0 };

  constructor(
    private field: HeightField,
    private biomes: Biomes,
    private occupancy: Occupancy,
    private cover: { isForest(x: number, z: number): boolean },
    scene: THREE.Scene,
    private world: WorldMeta | null = null,
  ) {
    const foliage = (map: THREE.Texture, wind: number) => {
      const m = pbr({ map, side: THREE.DoubleSide, alphaTest: 0.42, alphaToCoverage: true, roughness: 0.92 });
      this.addWind(m, wind);
      return m;
    };
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, depth?: THREE.Material) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      m.customDepthMaterial = depth;
      m.count = 0;
      scene.add(m);
      return m;
    };
    const coniferMap = coniferTexture();
    const leafMap = broadleafTexture();
    const palmMap = palmTexture();
    this.meshes = {
      conifer: mesh(crossedPlanes(8.5, 15, 3), foliage(coniferMap, 0.008), foliageDepth(coniferMap)),
      broadleaf: mesh(crossedPlanes(12, 12, 3), foliage(leafMap, 0.012), foliageDepth(leafMap)),
      palm: mesh(crossedPlanes(9, 10.5, 3), foliage(palmMap, 0.012), foliageDepth(palmMap)),
      cactus: mesh(cactusGeometry(), pbr({ vertexColors: true, roughness: 0.8 })),
      rock: mesh(rockGeometry(), pbr({ vertexColors: true, roughness: 0.95 })),
    };

    const detailed = (crown: THREE.BufferGeometry, trunk: THREE.BufferGeometry, map: THREE.Texture, bark: THREE.Texture, wind: number) => {
      const leaves = pbr({ map, side: THREE.DoubleSide, alphaTest: 0.42, alphaToCoverage: true, vertexColors: true, roughness: 0.78 });
      this.addWind(leaves, wind);
      const wood = pbr({ map: bark, bumpMap: bark, bumpScale: 2.5, roughness: 0.96 });
      this.addWind(wood, wind);
      const parts = {
        crown: new THREE.InstancedMesh(crown, leaves, MAX_NEAR_TREES),
        trunk: new THREE.InstancedMesh(trunk, wood, MAX_NEAR_TREES),
      };
      parts.crown.customDepthMaterial = foliageDepth(map);
      for (const m of [parts.crown, parts.trunk]) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        m.count = 0;
        scene.add(m);
      }
      return parts;
    };
    this.near = {
      conifer: detailed(coniferCrown(), coniferTrunk(), frondTexture(), barkTexture([84, 62, 46]), 0.008),
      broadleaf: detailed(broadleafCrown(), broadleafTrunk(), leafClusterTexture(), barkTexture([104, 94, 80]), 0.012),
    };

    const plant = (geometry: THREE.BufferGeometry, map: THREE.Texture, wind: number, count: number) => {
      const m = new THREE.InstancedMesh(geometry, foliage(map, wind), count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.plants = {
      grass: plant(crossedPlanes(0.7, 0.66, 3), tuftTexture(), 0.17, MAX_TUFTS),
      fern: plant(crossedPlanes(1.5, 0.82, 3), fernTexture(), 0.09, MAX_TUFTS),
      flower: plant(crossedPlanes(0.95, 0.62, 2), flowerTexture(), 0.2, MAX_TUFTS),
    };
    // Teintes multipliées à la texture : de légères variations d'un arbre à l'autre.
    this.conifers = biomes.trees === 'meleze' ? [0xe8f0a8, 0xf4f0a0, 0xd8e49c] : [0xffffff, 0xe4ecdc, 0xd4e0cc, 0xf0f4e8];
    this.broadleaves = [0xffffff, 0xf0f4d4, 0xdce8c4, 0xfff6cc];
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

  /** Même tirage que sur les cols, mais le biome de chaque cellule se tire au sort selon les poids. */
  private placeWorld(tx: number, tz: number, world: WorldMeta): Placement[] {
    const out: Placement[] = [];
    const n = Math.round(TILE_M / CELL_M);
    // Un nombre entier de cellules par période : le tirage de x + période est celui de x.
    const period = world.periodM;
    const cells = Math.round(period / CELL_M);
    const cellW = period / cells;
    const weights = new Array<number>(world.zones.length).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const gx = tx * n + i;
        const gz = tz * n + j;
        const gh = ((gx % cells) + cells) % cells;
        const x = (gx + hash(gh, gz, 1)) * cellW;
        const z = (gz + hash(gh, gz, 2)) * CELL_M;
        if (this.occupancy.has(x, z) || this.field.exactRoadDistance(x, z) < 10) continue;
        const y = this.field.height(x, z);
        if (y < world.seaLevelM + 1.1) continue;
        const e = 18;
        const slope = Math.hypot(this.field.height(x + e, z) - y, this.field.height(x, z + e) - y) / e;
        biomeWeights(x, world, weights);
        const biome = world.zones[pickZone(weights, hash(gh, gz, 21))].biome;
        const wx = x - period * Math.floor(x / period);
        const mx = Math.min(wx, period - wx);
        const grove = valueNoise(mx / 220, z / 220, 3);
        const snow = biome === 'montagne' ? snowAmount(y, valueNoise(mx / 400, z / 400, 12)) : 0;
        const roll = hash(gh, gz, 4);
        const pick = hash(gh, gz, 7);
        let species: Species = 'rock';
        let density = 0;
        switch (biome) {
          case 'plage':
            if (y > 1.8) {
              species = 'palm';
              density = grove > 0.5 ? 0.09 : 0.03;
            }
            break;
          case 'prairie':
            species = pick < 0.8 ? 'broadleaf' : 'conifer';
            density = grove > 0.68 ? 0.1 : 0.01;
            break;
          case 'foret':
            species = pick < 0.5 ? 'conifer' : 'broadleaf';
            density = grove < 0.22 ? 0.12 : 0.64;
            break;
          case 'montagne':
            species = 'conifer';
            density = 0.34 * (1 - 0.8 * snow);
            break;
          case 'canyon':
            species = 'cactus';
            density = 0.012;
            break;
          case 'desert':
            species = 'cactus';
            density = grove > 0.5 ? 0.06 : 0.014;
            break;
        }
        const rocks: Record<WorldBiome, number> = { plage: 0.006, prairie: 0.008, foret: 0.02, montagne: 0.05 + 0.1 * snow, canyon: 0.13, desert: 0.02 };
        const isRock = hash(gh, gz, 31) < rocks[biome] || slope > 1.5;
        if (!isRock && roll > density) continue;
        if (isRock && slope <= 1.5 && hash(gh, gz, 32) > 0.9) continue;

        const species_ = isRock ? 'rock' : species;
        const palette = species_ === 'conifer' ? this.conifers : species_ === 'palm' ? this.palms : species_ === 'cactus' ? this.cacti : this.broadleaves;
        const color =
          species_ === 'rock'
            ? new THREE.Color(WORLD_STYLE[biome].rock).multiplyScalar(0.72 + hash(gh, gz, 8) * 0.4)
            : new THREE.Color(palette[Math.floor(hash(gh, gz, 8) * palette.length)]);
        const scale = 0.72 + hash(gh, gz, 5) * 0.75;
        out.push({
          species: species_,
          x,
          y: species_ === 'rock' ? y : y - 0.2,
          z,
          scale: species_ === 'rock' ? 0.22 + hash(gh, gz, 5) ** 4 * 2.8 : scale * (1 - 0.3 * snow) * (species_ === 'cactus' ? 0.85 : 1),
          girth: species_ === 'cactus' ? 1 : 0.82 + hash(gh, gz, 9) * 0.42,
          rot: hash(gh, gz, 6) * Math.PI * 2,
          color,
        });
      }
    }
    return out;
  }

  private placeWorldGrass(tx: number, tz: number, world: WorldMeta): Tuft[] {
    const out: Tuft[] = [];
    const n = Math.round(GRASS_TILE_M / GRASS_CELL_M);
    const period = world.periodM;
    const cells = Math.round(period / GRASS_CELL_M);
    const cellW = period / cells;
    const weights = new Array<number>(world.zones.length).fill(0);
    const tint: Record<WorldBiome, number> = { plage: 0xd9d08c, prairie: 0x7aa83e, foret: 0x4d7238, montagne: 0x86904f, canyon: 0xa5805a, desert: 0xc4ad74 };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const gx = tx * n + i;
        const gz = tz * n + j;
        const gh = ((gx % cells) + cells) % cells;
        const x = (gx + hash(gh, gz, 11)) * cellW;
        const z = (gz + hash(gh, gz, 12)) * GRASS_CELL_M;
        if (hash(gh, gz, 13) > 0.8) continue;
        const y = this.field.height(x, z);
        if (y < world.seaLevelM + 1.4) continue;
        biomeWeights(x, world, weights);
        const biome = world.zones[pickZone(weights, hash(gh, gz, 19))].biome;
        const mx = Math.min(x - period * Math.floor(x / period), period - (x - period * Math.floor(x / period)));
        const snow = biome === 'montagne' ? snowAmount(y, valueNoise(mx / 400, z / 400, 12)) : 0;
        const amount: Record<WorldBiome, number> = { plage: 0.1, prairie: 1, foret: 0.95, montagne: 0.7 * (1 - snow), canyon: 0.16, desert: 0.12 };
        if (hash(gh, gz, 22) > amount[biome]) continue;
        if (this.occupancy.has(x, z) || this.field.exactRoadDistance(x, z) < 5.2) continue;
        const roll = hash(gh, gz, 14);
        let kind: Plant = 'grass';
        if (biome === 'foret' && roll < 0.35) kind = 'fern';
        else if (biome === 'prairie' && roll < 0.14) kind = 'flower';
        const shade = 0.82 + hash(gh, gz, 16) * 0.3;
        const color = kind === 'flower' ? new THREE.Color(0xffffff) : new THREE.Color(tint[biome]).multiplyScalar(shade);
        out.push({ kind, x, y: y - 0.04, z, scale: 0.75 + hash(gh, gz, 17) * 0.8, rot: hash(gh, gz, 18) * 6.28, color });
      }
    }
    return out;
  }

  private place(tx: number, tz: number): Placement[] {
    if (this.world) return this.placeWorld(tx, tz, this.world);
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
          girth: 0.82 + hash(gx, gz, 9) * 0.42,
          rot,
          color,
        });
      }
    }
    return out;
  }

  private placeGrass(tx: number, tz: number): Tuft[] {
    if (this.world) return this.placeWorldGrass(tx, tz, this.world);
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
        const wooded = this.cover.isForest(x, z);
        const roll = hash(gx, gz, 14);
        const high = y > b.forest;
        const shade = 0.82 + hash(gx, gz, 16) * 0.3;
        let kind: Plant = 'grass';
        if (wooded && roll < 0.3) kind = 'fern';
        else if (!wooded && roll < (high ? 0.1 : 0.05)) kind = 'flower';
        const color =
          kind === 'flower'
            ? new THREE.Color(0xffffff)
            : new THREE.Color(wooded ? 0x577a3e : high ? 0x8c9450 : 0x6f9440).multiplyScalar(shade);
        out.push({ kind, x, y: y - 0.04, z, scale: 0.75 + hash(gx, gz, 17) * 0.8, rot: hash(gx, gz, 18) * 6.28, color });
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
    const counts: Record<Plant, number> = { grass: 0, fern: 0, flower: 0 };
    for (let dz = -GRASS_RADIUS_TILES; dz <= GRASS_RADIUS_TILES; dz++) {
      for (let dx = -GRASS_RADIUS_TILES; dx <= GRASS_RADIUS_TILES; dx++) {
        const k = `${cx + dx}/${cz + dz}`;
        let tile = this.grassTiles.get(k);
        if (!tile) {
          tile = this.placeGrass(cx + dx, cz + dz);
          this.grassTiles.set(k, tile);
        }
        for (const t of tile) {
          const i = counts[t.kind];
          if (i >= MAX_TUFTS) continue;
          this.dummy.position.set(t.x, t.y, t.z);
          this.dummy.rotation.set(0, t.rot, 0);
          this.dummy.scale.setScalar(t.scale);
          this.dummy.updateMatrix();
          const mesh = this.plants[t.kind];
          mesh.setMatrixAt(i, this.dummy.matrix);
          mesh.setColorAt(i, t.color);
          counts[t.kind]++;
        }
      }
    }
    for (const kind of Object.keys(this.plants) as Plant[]) {
      const m = this.plants[kind];
      m.count = counts[kind];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
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

    const counts: Record<Species, number> = { conifer: 0, broadleaf: 0, palm: 0, cactus: 0, rock: 0 };
    const nearCounts: Record<Tree, number> = { conifer: 0, broadleaf: 0 };
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
          this.dummy.position.set(p.x, p.y, p.z);
          this.dummy.rotation.set(0, p.rot, 0);
          if (p.species === 'rock' || p.species === 'cactus') this.dummy.scale.setScalar(p.scale);
          else this.dummy.scale.set(p.scale * p.girth, p.scale, p.scale * p.girth);
          this.dummy.updateMatrix();

          // Les arbres proches passent en version détaillée.
          if ((p.species === 'conifer' || p.species === 'broadleaf') && Math.hypot(p.x - x, p.z - z) < NEAR_TREE_M && nearCounts[p.species] < MAX_NEAR_TREES) {
            const i = nearCounts[p.species]++;
            const { crown, trunk } = this.near[p.species];
            crown.setMatrixAt(i, this.dummy.matrix);
            crown.setColorAt(i, p.color);
            trunk.setMatrixAt(i, this.dummy.matrix);
            continue;
          }
          const i = counts[p.species];
          if (i >= MAX_INSTANCES) continue;
          const mesh = this.meshes[p.species];
          mesh.setMatrixAt(i, this.dummy.matrix);
          mesh.setColorAt(i, p.color);
          counts[p.species]++;
        }
      }
    }
    for (const tree of Object.keys(this.near) as Tree[]) {
      const { crown, trunk } = this.near[tree];
      crown.count = trunk.count = nearCounts[tree];
      crown.instanceMatrix.needsUpdate = true;
      trunk.instanceMatrix.needsUpdate = true;
      if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    }
    for (const s of Object.keys(this.meshes) as Species[]) {
      const m = this.meshes[s];
      m.count = counts[s];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
