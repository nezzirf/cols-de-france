// Bâtiments réels : un maillage par tuile de 400 m pour que le moteur écarte ceux hors champ.
// Les emprises et hauteurs viennent de l'IGN ; seules les couleurs sont choisies par région.

import * as THREE from 'three';
import type { BuildingData, BuildingStyle } from '../sim/route';
import { buildShell, footprintOf, isBoxLike, ringOf, signedArea } from './buildingGeometry';
import { type HouseModel, type HouseVariant, loadHouses } from './houseAsset';
import type { HeightField } from './heightField';
import { pbr } from './materials';

const TILE_M = 400;
const OCCUPANCY_CELL_M = 8;
const Kind = { Habitation: 0, Agricole: 1, Religieux: 2, Commerce: 3, Tour: 4, Leger: 5 };

const PALETTES: Record<BuildingStyle, { walls: number[]; roofs: number[] }> = {
  alpes: { walls: [0xe6dfd0, 0xd8cdb8, 0xc9c2b5, 0xbfa98c], roofs: [0x55585c, 0x4a4440, 0x6a5646] },
  provence: { walls: [0xe3cfae, 0xd9b98c, 0xe8dcc6, 0xcfa878], roofs: [0xb86a45, 0xa85a3c, 0xc47a52] },
  pyrenees: { walls: [0xe9e6de, 0xdddad2, 0xc7c4bc], roofs: [0x3e4348, 0x4a4f55] },
  queyras: { walls: [0xa98a63, 0xc9bfa9, 0x8f7251, 0xd7cfbd], roofs: [0x6e6a64, 0x7b6a58, 0x5a5550] },
};

const pick = (list: number[], seed: number): number => list[Math.abs(Math.floor(seed)) % list.length];

function colorsOf(b: BuildingData, style: BuildingStyle): { wall: number; roof: number } {
  const seed = Math.abs(b.p[0] * 7.3 + b.p[1] * 3.1);
  const p = PALETTES[style];
  switch (b.k) {
    case Kind.Agricole:
      return { wall: pick([0xa59c8b, 0x8d9296, 0x9a8468], seed), roof: pick([0x6f7478, 0x7d6f5e], seed) };
    case Kind.Religieux:
      return { wall: 0xb9b2a4, roof: pick(p.roofs, seed) };
    case Kind.Tour:
      return { wall: 0xa8a297, roof: 0x6a6660 };
    case Kind.Leger:
      return { wall: 0xc8d4d8, roof: 0xb4c4ca };
    default:
      return { wall: pick(p.walls, seed), roof: pick(p.roofs, seed) };
  }
}

function facadeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  // Fenêtre à volets, avec un linteau : assez pour lire l'échelle d'une façade.
  g.fillStyle = '#c9c2b4';
  g.fillRect(40, 26, 48, 6);
  g.fillStyle = '#31404b';
  g.fillRect(44, 32, 40, 54);
  g.fillStyle = '#8fb4c8';
  g.fillRect(47, 35, 15, 22);
  g.fillRect(66, 35, 15, 22);
  g.fillStyle = '#d7d2c6';
  g.fillRect(62, 32, 4, 54);
  g.fillStyle = '#7a5a3c';
  g.fillRect(28, 32, 16, 54);
  g.fillRect(84, 32, 16, 54);
  g.fillStyle = '#c9c2b4';
  g.fillRect(40, 86, 48, 5);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Cases occupées par un bâtiment, pour qu'aucun arbre ne pousse dans une maison. */
export class Occupancy {
  private cells = new Set<number>();
  /** Montre les maisons modélisées autour du cycliste et les bâtiments dessinés plus loin. */
  tick: ((x: number, z: number) => void) | null = null;

  update(x: number, z: number): void {
    this.tick?.(x, z);
  }

  private key(ix: number, iz: number): number {
    return (ix + 50000) * 100000 + (iz + 50000);
  }

  add(ring: [number, number][]): void {
    const xs = ring.map((p) => p[0]);
    const zs = ring.map((p) => p[1]);
    const x0 = Math.floor((Math.min(...xs) - 3) / OCCUPANCY_CELL_M);
    const x1 = Math.floor((Math.max(...xs) + 3) / OCCUPANCY_CELL_M);
    const z0 = Math.floor((Math.min(...zs) - 3) / OCCUPANCY_CELL_M);
    const z1 = Math.floor((Math.max(...zs) + 3) / OCCUPANCY_CELL_M);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) this.cells.add(this.key(ix, iz));
  }

  has(x: number, z: number): boolean {
    return this.cells.has(this.key(Math.floor(x / OCCUPANCY_CELL_M), Math.floor(z / OCCUPANCY_CELL_M)));
  }
}

interface TileBuffers {
  wallPos: number[];
  wallUv: number[];
  wallColor: number[];
  roofPos: number[];
  roofColor: number[];
}

function pushColor(target: number[], color: THREE.Color, vertexCount: number): void {
  for (let i = 0; i < vertexCount; i++) target.push(color.r, color.g, color.b);
}

/** Taille des tuiles des bâtiments modélisés et distance du cycliste à leur centre en dessous de laquelle on les montre. */
const HOUSE_TILE_M = 200;
const HOUSE_NEAR_M = 330;
/** Un habitat compte comme maison entre ces surfaces (m²) ; au-delà de 12 m de haut et de 150 m², c'est un immeuble. */
const HOUSE_AREA_M2 = [30, 420];
const BLOCK_HEIGHT_M = 12;
const BLOCK_AREA_M2 = 150;
/** Dénivelé maximal sous l'emprise (m) pour qu'un bâtiment soit remplacé : au-delà, le terrain est en pente. */
const FLAT_M = 0.9;
/** Le toit garde la hauteur mesurée, mais le modèle ne s'étire pas au-delà de ce rapport à sa largeur. */
const MAX_STRETCH = 1.8;
const TINTS = [0xffffff, 0xf4efe6, 0xece8f0, 0xf6f0dc, 0xe8eee6, 0xfaf3ec];

interface HouseInstance {
  variant: HouseVariant;
  x: number;
  y: number;
  z: number;
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  /** Hauteur du soubassement entre le point le plus bas du terrain et le pied de la maison. */
  found: number;
  tint: number;
}

const rand = (b: BuildingData, salt: number): number => {
  const v = Math.sin(b.p[0] * 12.9898 + b.p[1] * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

/** Quel modèle pour cette emprise : un immeuble pour les grands bâtiments hauts, sinon l'une des deux maisons selon sa forme. */
function variantOf(b: BuildingData, area: number, long: number, wide: number): HouseVariant | null {
  if (b.k !== Kind.Habitation) return null;
  if (b.h >= BLOCK_HEIGHT_M && area >= BLOCK_AREA_M2) return 'immeuble';
  if (area < HOUSE_AREA_M2[0] || area > HOUSE_AREA_M2[1]) return null;
  // Une emprise allongée prend la maison longue ; une emprise carrée la maison compacte. Une fois sur trois, l'autre, pour varier.
  const elongated = long / Math.max(wide, 0.1) >= 1.35;
  const first: HouseVariant = elongated ? 'maisonA' : 'maisonB';
  const other: HouseVariant = elongated ? 'maisonB' : 'maisonA';
  return rand(b, 3) < 0.7 ? first : other;
}

export function buildBuildings(list: BuildingData[], style: BuildingStyle, field: HeightField, scene: THREE.Scene): Occupancy {
  const occupancy = new Occupancy();
  const tiles = new Map<string, TileBuffers>();
  // Les bâtiments qui ont un modèle gardent leur forme dessinée pour le lointain, par tuiles plus petites.
  const farTiles = new Map<string, TileBuffers>();
  const instances = new Map<string, HouseInstance[]>();
  const wall = new THREE.Color();
  const roof = new THREE.Color();

  for (const b of list) {
    const ring = ringOf(b);
    occupancy.add(ring);
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const groundY = field.height(cx, cz);
    const heights = ring.map(([x, z]) => field.height(x, z));
    const baseY = Math.min(groundY, ...heights) - 1;
    const shell = buildShell(b, groundY, baseY, b.k === Kind.Habitation || b.k === Kind.Commerce);

    // Un modèle est posé sur l'emprise réelle : même centre, même sens, même longueur et même largeur.
    let variant: HouseVariant | null = null;
    let box = null as ReturnType<typeof footprintOf> | null;
    if (b.k === Kind.Habitation && isBoxLike(ring)) {
      box = footprintOf(ring);
      variant = variantOf(b, Math.abs(signedArea(ring)), box.length, box.width);
    }
    // Les maisons modélisées ne se posent que sur le plat : sur une pente, le bâtiment dessiné, qui s'enfonce dans le versant, reste.
    let high = groundY;
    let low = groundY;
    if (variant && box) {
      const along = box.length / 2;
      const across = box.width / 2;
      const px = -box.uz;
      const pz = box.ux;
      const samples = [groundY, ...heights];
      for (const [a, c] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        samples.push(field.height(box.cx + box.ux * along * a + px * across * c, box.cz + box.uz * along * a + pz * across * c));
      }
      high = Math.max(...samples);
      low = Math.min(...samples);
      if (high - low > FLAT_M) variant = null;
    }
    const key = variant
      ? `${Math.floor(cx / HOUSE_TILE_M)}/${Math.floor(cz / HOUSE_TILE_M)}`
      : `${Math.floor(cx / TILE_M)}/${Math.floor(cz / TILE_M)}`;
    const bucket = variant ? farTiles : tiles;
    let tile = bucket.get(key);
    if (!tile) {
      tile = { wallPos: [], wallUv: [], wallColor: [], roofPos: [], roofColor: [] };
      bucket.set(key, tile);
    }
    const colors = colorsOf(b, style);
    wall.set(colors.wall);
    roof.set(colors.roof);
    for (const v of shell.walls) tile.wallPos.push(v);
    for (const v of shell.wallUv) tile.wallUv.push(v);
    pushColor(tile.wallColor, wall, shell.walls.length / 3);
    for (const v of shell.roof) tile.roofPos.push(v);
    pushColor(tile.roofColor, roof, shell.roof.length / 3);
    // Les pignons prolongent le mur : même couleur, sans fenêtre.
    for (const v of shell.gables) tile.wallPos.push(v);
    for (let i = 0; i < shell.gables.length / 3; i++) tile.wallUv.push(0.03, 0.03);
    pushColor(tile.wallColor, wall, shell.gables.length / 3);

    if (variant && box) {
      // Le pied de la maison est au niveau du terrain le plus haut de l'emprise ; un petit soubassement comble l'écart côté bas.
      const floor = high - 0.12;
      const list = instances.get(key) ?? [];
      instances.set(key, list);
      list.push({
        variant,
        x: box.cx,
        y: floor,
        z: box.cz,
        rot: Math.atan2(box.ux, box.uz),
        sx: box.width,
        sy: b.h,
        sz: box.length,
        found: floor - (low - 0.3),
        tint: TINTS[Math.floor(rand(b, 5) * TINTS.length)],
      });
    }
  }

  const wallMaterial = pbr({ map: facadeTexture(), vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
  const roofMaterial = pbr({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
  const group = new THREE.Group();
  const mesh = (target: THREE.Group, pos: number[], color: number[], material: THREE.Material, uv?: number[]) => {
    if (pos.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    target.add(m);
  };
  for (const t of tiles.values()) {
    mesh(group, t.wallPos, t.wallColor, wallMaterial, t.wallUv);
    mesh(group, t.roofPos, t.roofColor, roofMaterial);
  }
  scene.add(group);

  // Tuiles de bâtiments modélisés : forme dessinée (loin) ou modèles (près), jamais les deux.
  interface HouseTile {
    cx: number;
    cz: number;
    far: THREE.Group;
    near: THREE.Group;
  }
  const houseTiles: HouseTile[] = [];
  for (const [key, buffers] of farTiles) {
    const [ix, iz] = key.split('/').map(Number);
    const far = new THREE.Group();
    mesh(far, buffers.wallPos, buffers.wallColor, wallMaterial, buffers.wallUv);
    mesh(far, buffers.roofPos, buffers.roofColor, roofMaterial);
    const near = new THREE.Group();
    near.visible = false;
    scene.add(far, near);
    houseTiles.push({ cx: (ix + 0.5) * HOUSE_TILE_M, cz: (iz + 0.5) * HOUSE_TILE_M, far, near });
  }
  const tileOf = new Map<string, HouseTile>();
  for (const [key] of farTiles) {
    const [ix, iz] = key.split('/').map(Number);
    tileOf.set(key, houseTiles.find((t) => t.cx === (ix + 0.5) * HOUSE_TILE_M && t.cz === (iz + 0.5) * HOUSE_TILE_M)!);
  }

  let ready = false;
  void loadHouses().then((models) => {
    if (!models) return;
    const materials = {} as Record<HouseVariant, THREE.Material>;
    const foundation = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const foundationMaterial = pbr({ color: 0x8d887d, roughness: 0.95 });
    for (const v of Object.keys(models) as HouseVariant[]) materials[v] = pbr({ map: models[v].map, roughness: 0.9, side: THREE.DoubleSide });
    for (const [key, list] of instances) {
      const tile = tileOf.get(key);
      if (!tile) continue;
      for (const v of Object.keys(models) as HouseVariant[]) {
        const those = list.filter((i) => i.variant === v);
        if (those.length === 0) continue;
        const model: HouseModel = models[v];
        const inst = new THREE.InstancedMesh(model.geometry, materials[v], those.length);
        const m = new THREE.Object3D();
        const tint = new THREE.Color();
        those.forEach((h, i) => {
          const horizontal = Math.sqrt((h.sx / model.width) * (h.sz / model.length));
          m.position.set(h.x, h.y, h.z);
          m.rotation.set(0, h.rot, 0);
          m.scale.set(h.sx / model.width, Math.min(h.sy / model.height, horizontal * MAX_STRETCH), h.sz / model.length);
          m.updateMatrix();
          inst.setMatrixAt(i, m.matrix);
          inst.setColorAt(i, tint.set(h.tint));
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = false;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        tile.near.add(inst);
      }
      const footed = list.filter((i) => i.found > 0.2);
      if (footed.length > 0) {
        const feet = new THREE.InstancedMesh(foundation, foundationMaterial, footed.length);
        const m = new THREE.Object3D();
        footed.forEach((h, i) => {
          m.position.set(h.x, h.y - h.found, h.z);
          m.rotation.set(0, h.rot, 0);
          m.scale.set(h.sx * 0.97, h.found + 0.05, h.sz * 0.97);
          m.updateMatrix();
          feet.setMatrixAt(i, m.matrix);
        });
        feet.receiveShadow = true;
        feet.computeBoundingSphere();
        tile.near.add(feet);
      }
    }
    ready = true;
  });

  occupancy.tick = (x: number, z: number) => {
    for (const t of houseTiles) {
      const near = ready && Math.hypot(t.cx - x, t.cz - z) < HOUSE_NEAR_M;
      t.near.visible = near;
      t.far.visible = !near;
    }
  };
  return occupancy;
}
