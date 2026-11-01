// Bâtiments réels : un maillage par tuile de 400 m pour que le moteur écarte ceux hors champ.
// Les emprises et hauteurs viennent de l'IGN ; seules les couleurs sont choisies par région.

import * as THREE from 'three';
import type { BuildingData, BuildingStyle } from '../sim/route';
import { buildShell, ringOf } from './buildingGeometry';
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

export function buildBuildings(list: BuildingData[], style: BuildingStyle, field: HeightField, scene: THREE.Scene): Occupancy {
  const occupancy = new Occupancy();
  const tiles = new Map<string, TileBuffers>();
  const wall = new THREE.Color();
  const roof = new THREE.Color();

  for (const b of list) {
    const ring = ringOf(b);
    occupancy.add(ring);
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const groundY = field.height(cx, cz);
    const baseY = Math.min(groundY, ...ring.map(([x, z]) => field.height(x, z))) - 1;
    const shell = buildShell(b, groundY, baseY, b.k === Kind.Habitation || b.k === Kind.Commerce);

    const key = `${Math.floor(cx / TILE_M)}/${Math.floor(cz / TILE_M)}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { wallPos: [], wallUv: [], wallColor: [], roofPos: [], roofColor: [] };
      tiles.set(key, tile);
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
  }

  const wallMaterial = pbr({ map: facadeTexture(), vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
  const roofMaterial = pbr({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
  const group = new THREE.Group();
  const mesh = (pos: number[], color: number[], material: THREE.Material, uv?: number[]) => {
    if (pos.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  for (const t of tiles.values()) {
    mesh(t.wallPos, t.wallColor, wallMaterial, t.wallUv);
    mesh(t.roofPos, t.roofColor, roofMaterial);
  }
  scene.add(group);
  return occupancy;
}
