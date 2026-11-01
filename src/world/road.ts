// Ruban de route construit sur le tracé réel. Les talus utilisent la matière du terrain,
// pour que la route semble taillée dans le versant et non posée dessus.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Route } from '../sim/route';
import { toon } from './materials';

export const ROAD_HALF_WIDTH_M = 3;
const VERGE_M = 1.6;
const TEXTURE_REPEAT_M = 12;
const POST_SPACING_M = 50;
const PARAPET_MAX = 4000;
const PARAPET_SPACING_M = 2;
const PARAPET_RADIUS_M = 26;
/** Pas du maillage le long de la route : assez fin pour que les lacets soient ronds. */
const MESH_STEP_M = 2;
/** Portée d'un virage sur la largeur des talus voisins, et vitesse à laquelle elle se relâche. */
const BEND_WINDOW = 14;
const BEND_RELEASE = 1.3;
/** Rayons entre lesquels le talus intérieur d'un virage passe de mur à pente douce. */
const TALUS_WALL_M = 14;
const TALUS_FULL_M = 34;
const WALL_WIDTH = 0.1;
/** Recherche des jambes voisines : portée, tolérance le long de la route et marge à leur axe. */
const ROOM_CELL_M = 30;
const ROOM_REACH_M = 34;
const ROOM_ALONG_M = 14;
const ROOM_MARGIN_M = 7.5;
const SAME_LEG_M = 40;

/** Profil en travers : hauteur de la surface par rapport à la route, selon l'écart à son axe. */
const SECTION: [number, number][] = [
  [ROAD_HALF_WIDTH_M, 0],
  [ROAD_HALF_WIDTH_M + VERGE_M, -0.4],
  [ROAD_HALF_WIDTH_M + VERGE_M + 7, -3.4],
  [ROAD_HALF_WIDTH_M + VERGE_M + 22, -28],
];

/** Dénivelé du talus à cet écart. Infini au-delà du talus : seul le relief compte alors. */
const FULL_TALUS_WIDTH_M = SECTION[SECTION.length - 1][0] - SECTION[1][0];

export function shoulderDrop(lateralM: number): number {
  const d = Math.abs(lateralM);
  if (d <= SECTION[0][0]) return 0;
  for (let i = 1; i < SECTION.length; i++) {
    const [d0, y0] = SECTION[i - 1];
    const [d1, y1] = SECTION[i];
    if (d <= d1) return y0 + ((y1 - y0) * (d - d0)) / (d1 - d0);
  }
  return -Infinity;
}

function roadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  const vergeShare = VERGE_M / (2 * (ROAD_HALF_WIDTH_M + VERGE_M));
  const left = c.width * vergeShare;
  const right = c.width * (1 - vergeShare);
  g.fillStyle = '#8b8671';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#4a4d52';
  g.fillRect(left, 0, right - left, c.height);
  // Bitume patiné : plus sombre dans les traces de roues, avec des reprises de goudron.
  const wear = g.createLinearGradient(left, 0, right, 0);
  wear.addColorStop(0, 'rgba(255,255,255,0.05)');
  wear.addColorStop(0.28, 'rgba(0,0,0,0.13)');
  wear.addColorStop(0.5, 'rgba(255,255,255,0.03)');
  wear.addColorStop(0.72, 'rgba(0,0,0,0.13)');
  wear.addColorStop(1, 'rgba(255,255,255,0.05)');
  g.fillStyle = wear;
  g.fillRect(left, 0, right - left, c.height);
  for (let i = 0; i < 90000; i++) {
    const v = 50 + Math.random() * 60;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.32)`;
    g.fillRect(left + Math.random() * (right - left), Math.random() * c.height, 2, 2);
  }
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(28,29,32,0.5)';
    g.fillRect(left + Math.random() * (right - left - 90), Math.random() * c.height, 5, 240 + Math.random() * 300);
  }
  for (let i = 0; i < 16000; i++) {
    const v = 90 + Math.random() * 70;
    g.fillStyle = `rgba(${v},${v - 6},${v - 30},0.55)`;
    const x = Math.random() < 0.5 ? Math.random() * left : right + Math.random() * left;
    g.fillRect(x, Math.random() * c.height, 5, 5);
  }
  g.fillStyle = 'rgba(238,238,232,0.95)';
  g.fillRect(left + 10, 0, 11, c.height);
  g.fillRect(right - 21, 0, 11, c.height);
  g.fillRect(c.width / 2 - 6, 0, 12, c.height * 0.42);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

export interface Station {
  x: number;
  z: number;
  ele: number;
  /** Normale horizontale, à droite de la route. */
  nx: number;
  nz: number;
  /** Rayon du virage côté droit et côté gauche : infini du côté extérieur. */
  rightRadius: number;
  leftRadius: number;
  /** Place libre de chaque côté avant une autre portion de route, plus basse. */
  rightRoom: number;
  leftRoom: number;
}

/** Points du maillage le long de la route, avec le rayon de courbure local. */
export function stations(route: Route): Station[] {
  const count = Math.ceil(route.pathM / MESH_STEP_M) + 1;
  const list: Station[] = [];
  for (let i = 0; i < count; i++) {
    const p = route.at(Math.min(route.pathM, i * MESH_STEP_M));
    list.push({ x: p.x, z: p.z, ele: p.ele, nx: Math.cos(p.heading), nz: Math.sin(p.heading), rightRadius: Infinity, leftRadius: Infinity, rightRoom: Infinity, leftRoom: Infinity });
  }
  for (let i = 1; i + 1 < count; i++) {
    const a = list[i - 1];
    const b = list[i + 1];
    const turn = a.nx * b.nz - a.nz * b.nx;
    if (Math.abs(turn) < 1e-5) continue;
    const radius = (2 * MESH_STEP_M) / Math.abs(turn);
    // Tourner à droite place le centre du virage à droite : c'est ce côté-là qui se replie.
    // La limite se relâche avec la distance : un saut brusque ferait de longues pointes.
    for (let k = Math.max(0, i - BEND_WINDOW); k <= Math.min(count - 1, i + BEND_WINDOW); k++) {
      const limit = radius + Math.abs(k - i) * MESH_STEP_M * BEND_RELEASE;
      if (turn > 0) list[k].rightRadius = Math.min(list[k].rightRadius, limit);
      else list[k].leftRadius = Math.min(list[k].leftRadius, limit);
    }
  }
  measureRoom(list);
  return list;
}

/** Repère, de chaque côté de la route, la distance à une autre jambe qui passe en contrebas. */
function measureRoom(list: Station[]): void {
  const key = (x: number, z: number) => Math.floor(x / ROOM_CELL_M) * 100000 + Math.floor(z / ROOM_CELL_M);
  const grid = new Map<number, number[]>();
  list.forEach((s, i) => {
    const k = key(s.x, s.z);
    const cell = grid.get(k);
    if (cell) cell.push(i);
    else grid.set(k, [i]);
  });
  const skip = Math.round(SAME_LEG_M / MESH_STEP_M);
  const reach = Math.ceil(ROOM_REACH_M / ROOM_CELL_M);
  const found: { i: number; lateral: number }[] = [];
  list.forEach((s, i) => {
    const cx = Math.floor(s.x / ROOM_CELL_M);
    const cz = Math.floor(s.z / ROOM_CELL_M);
    let right = Infinity;
    let left = Infinity;
    for (let a = cx - reach; a <= cx + reach; a++) {
      for (let b = cz - reach; b <= cz + reach; b++) {
        for (const j of grid.get(a * 100000 + b) ?? []) {
          if (Math.abs(i - j) < skip || list[j].ele >= s.ele) continue;
          const dx = list[j].x - s.x;
          const dz = list[j].z - s.z;
          const lateral = dx * s.nx + dz * s.nz;
          const along = Math.abs(-dx * s.nz + dz * s.nx);
          if (along > ROOM_ALONG_M || Math.abs(lateral) > ROOM_REACH_M) continue;
          if (lateral > 0) right = Math.min(right, lateral);
          else left = Math.min(left, -lateral);
        }
      }
    }
    if (right < Infinity) found.push({ i, lateral: right });
    if (left < Infinity) found.push({ i, lateral: -left });
  });
  // La limite se relâche le long de la route, sinon la paroi changerait de largeur d'un coup.
  for (const { i, lateral } of found) {
    const clear = Math.abs(lateral) - ROOM_MARGIN_M;
    for (let k = Math.max(0, i - BEND_WINDOW); k <= Math.min(list.length - 1, i + BEND_WINDOW); k++) {
      const limit = clear + Math.abs(k - i) * MESH_STEP_M * BEND_RELEASE;
      if (lateral > 0) list[k].rightRoom = Math.min(list[k].rightRoom, limit);
      else list[k].leftRoom = Math.min(list[k].leftRoom, limit);
    }
  }
}

/**
 * Écart à l'axe d'un point du talus. Le creux d'une épingle n'a pas la place d'une pente, où
 * celles des deux jambes se croiseraient : le talus s'y resserre en mur de soutènement, à la
 * même profondeur, pour qu'aucun vide ne s'ouvre sous le bord de la route.
 */
export function talusOffset(offset: number, radius: number, room = Infinity): number {
  const edge = ROAD_HALF_WIDTH_M + VERGE_M;
  if (Math.abs(offset) <= edge) return offset;
  const space = Math.max(0, Math.min(1, (radius - TALUS_WALL_M) / (TALUS_FULL_M - TALUS_WALL_M)));
  const keep = WALL_WIDTH + (1 - WALL_WIDTH) * space;
  const free = Math.max(0, room - edge);
  const width = Math.min(FULL_TALUS_WIDTH_M * keep, free);
  return Math.sign(offset) * (edge + ((Math.abs(offset) - edge) / FULL_TALUS_WIDTH_M) * width);
}

interface Row {
  o: number;
  y: number;
  u?: number;
}

export function ribbon(list: Station[], across: Row[]): THREE.BufferGeometry {
  const n = list.length;
  const pos = new Float32Array(n * across.length * 3);
  const uv = new Float32Array(n * across.length * 2);
  for (let i = 0; i < n; i++) {
    across.forEach((p, k) => {
      const v = i * across.length + k;
      const s = list[i];
      const o = p.o > 0 ? talusOffset(p.o, s.rightRadius, s.rightRoom) : talusOffset(p.o, s.leftRadius, s.leftRoom);
      pos[v * 3] = s.x + s.nx * o;
      pos[v * 3 + 1] = s.ele + p.y;
      pos[v * 3 + 2] = s.z + s.nz * o;
      uv[v * 2] = p.u ?? 0;
      uv[v * 2 + 1] = (i * MESH_STEP_M) / TEXTURE_REPEAT_M;
    });
  }
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < across.length - 1; k++) {
      const a = i * across.length + k;
      const b = a + 1;
      const c = a + across.length;
      const d = c + 1;
      // Sens de parcours qui tourne la face visible vers le ciel. Inversé, le talus disparaît
      // vu d'en face et laisse voir le dessous de la route.
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

export function buildRoad(route: Route, ground: THREE.Material, list: Station[]): THREE.Object3D {
  const group = new THREE.Group();
  const outer = ROAD_HALF_WIDTH_M + VERGE_M;
  const share = VERGE_M / (2 * outer);
  const surface = new THREE.Mesh(
    ribbon(list, [
      { o: -outer, y: -0.4, u: 0 },
      { o: -ROAD_HALF_WIDTH_M, y: 0, u: share },
      { o: ROAD_HALF_WIDTH_M, y: 0, u: 1 - share },
      { o: outer, y: -0.4, u: 1 },
    ]),
    toon({ map: roadTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  surface.frustumCulled = false;
  surface.receiveShadow = true;
  group.add(surface);

  // Talus doux : sans lui, une route en lacet surplombant le terrain abaissé flotterait.
  for (const sign of [-1, 1]) {
    const across = SECTION.slice(1).map(([o, y]) => ({ o: sign * o, y }));
    const slope = new THREE.Mesh(ribbon(list, sign > 0 ? across : across.reverse()), ground);
    slope.material = ground;
    slope.frustumCulled = false;
    slope.receiveShadow = true;
    group.add(slope);
  }

  group.add(delineators(route), parapets(list));
  return group;
}

/** Murets de pierre à l'extérieur des virages serrés, comme sur les routes de montagne. */
function parapets(list: Station[]): THREE.InstancedMesh {
  const block = new THREE.BoxGeometry(1.55, 0.62, 0.42).translate(0, 0.2, 0);
  const mesh = new THREE.InstancedMesh(block, toon({ color: 0xffffff }), PARAPET_MAX);
  const m = new THREE.Object3D();
  const color = new THREE.Color();
  let count = 0;
  const stride = Math.round(PARAPET_SPACING_M / MESH_STEP_M);
  for (let i = 0; i < list.length && count < PARAPET_MAX; i += stride) {
    const s = list[i];
    // Virage à droite : le vide est à gauche, et inversement.
    const side = s.rightRadius < PARAPET_RADIUS_M ? -1 : s.leftRadius < PARAPET_RADIUS_M ? 1 : 0;
    if (side === 0) continue;
    const lateral = side * (ROAD_HALF_WIDTH_M + 1.05);
    m.position.set(s.x + s.nx * lateral, s.ele - 0.1, s.z + s.nz * lateral);
    m.rotation.y = -Math.atan2(s.nz, s.nx);
    m.updateMatrix();
    mesh.setMatrixAt(count, m.matrix);
    const tone = 0.62 + ((i * 7919) % 100) / 400;
    mesh.setColorAt(count, color.setRGB(tone, tone * 0.97, tone * 0.9));
    count++;
  }
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Balises de bord de route : blanches à bande noire, une à droite puis une à gauche. */
function delineators(route: Route): THREE.InstancedMesh {
  const paint = (g: THREE.BufferGeometry, tone: number) => {
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(tone), 3));
    return g;
  };
  const post = mergeGeometries([
    paint(new THREE.BoxGeometry(0.12, 0.72, 0.09).translate(0, 0.36, 0), 1),
    paint(new THREE.BoxGeometry(0.125, 0.2, 0.095).translate(0, 0.82, 0), 0.03),
    paint(new THREE.BoxGeometry(0.12, 0.08, 0.09).translate(0, 0.96, 0), 1),
  ])!;
  const posts = Math.floor(route.pathM / POST_SPACING_M);
  const mesh = new THREE.InstancedMesh(post, toon({ vertexColors: true }), posts);
  const m = new THREE.Object3D();
  for (let i = 0; i < posts; i++) {
    const p = route.at(i * POST_SPACING_M);
    const side = (i % 2 ? 1 : -1) * (ROAD_HALF_WIDTH_M + 1.2);
    m.position.set(p.x + Math.cos(p.heading) * side, p.ele - 0.35, p.z + Math.sin(p.heading) * side);
    m.rotation.y = -p.heading;
    m.updateMatrix();
    mesh.setMatrixAt(i, m.matrix);
  }
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
