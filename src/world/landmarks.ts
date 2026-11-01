// Repères réels : bornes kilométriques, panneaux de lacets, stèles, bâtiments, sommet.
// Chaque objet est posé à la distance ou aux coordonnées issues des données du parcours.

import * as THREE from 'three';
import type { Poi, Route } from '../sim/route';
import type { HeightField } from './heightField';
import { pbr } from './materials';
import { createRiderModel, ROAD_LOOK } from './rider';
import { shoulderDrop } from './road';

export interface RouteEvent {
  distM: number;
  text: string;
}

const FONT = 'Bahnschrift, "Segoe UI", sans-serif';
const stone = pbr({ color: 0x9a968c });
const metal = pbr({ color: 0x70757a });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = h / 2, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Longueur enterrée des poteaux : ils partent du sol, même sur un terrain en pente. */
const ANCHOR_M = 14;

const SIGN_SIDE_M = 5.5;
const VILLAGE_SIGN_M = 220;
const CHALET_SIGN_M = 60;

function post(width: number, top: number, mat: THREE.Material, x = 0, depth = width): THREE.Mesh {
  return box(width, top + ANCHOR_M, depth, mat, x, (top - ANCHOR_M) / 2);
}

interface PlateOptions {
  width: number;
  height: number;
  bg: string;
  fg: string;
  lines: { text: string; size: number; bold?: boolean }[];
  accent?: string;
  /** Liseré intérieur, comme sur les panneaux routiers. */
  border?: string;
  /** Barre diagonale du panneau de sortie d'agglomération. */
  strike?: string;
}

/** Plaque de texte réelle dans la scène : le texte est dessiné dans une texture. */
function plate(o: PlateOptions): THREE.Mesh {
  const px = 200;
  const c = document.createElement('canvas');
  c.width = Math.round(o.width * px);
  c.height = Math.round(o.height * px);
  const g = c.getContext('2d')!;
  g.fillStyle = o.bg;
  g.fillRect(0, 0, c.width, c.height);
  if (o.accent) {
    g.fillStyle = o.accent;
    g.fillRect(0, 0, c.width, c.height * 0.09);
  }
  g.fillStyle = o.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = o.lines.reduce((s, l) => s + l.size * 1.2, 0);
  let y = (c.height - total * px) / 2 + (o.accent ? c.height * 0.04 : 0);
  for (const line of o.lines) {
    let size = line.size * px;
    g.font = `${line.bold ? 700 : 500} ${size}px ${FONT}`;
    const w = g.measureText(line.text).width;
    if (w > c.width * 0.92) {
      size *= (c.width * 0.92) / w;
      g.font = `${line.bold ? 700 : 500} ${size}px ${FONT}`;
    }
    g.fillText(line.text, c.width / 2, y + (line.size * 1.2 * px) / 2);
    y += line.size * 1.2 * px;
  }
  if (o.border) {
    const line = c.height * 0.085;
    g.strokeStyle = o.border;
    g.lineWidth = line;
    g.beginPath();
    g.roundRect(line, line, c.width - line * 2, c.height - line * 2, line);
    g.stroke();
  }
  if (o.strike) {
    g.strokeStyle = o.strike;
    g.lineWidth = c.height * 0.1;
    g.beginPath();
    g.moveTo(c.width * 0.06, c.height * 0.86);
    g.lineTo(c.width * 0.94, c.height * 0.14);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.height), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
}

/** Sur les panneaux français, le nom du lieu est toujours en capitales. */
export function townName(name: string): string {
  return name.toLocaleUpperCase('fr-FR');
}

const SIGN_RED = '#c8102e';
const SIGN_BLACK = '#15171a';

/**
 * Panneau de ville français, sur ses deux poteaux : fond blanc et liseré rouge à l'entrée
 * d'agglomération (EB10), barré de rouge à la sortie (EB20). Un lieu-dit a un liseré noir.
 */
function townSign(name: string, kind: 'entree' | 'sortie' | 'lieu-dit'): THREE.Group {
  const g = new THREE.Group();
  const width = 2.1;
  const height = 0.8;
  const top = 2.4;
  g.add(post(0.07, top + height / 2 - 0.1, metal, -width * 0.32));
  g.add(post(0.07, top + height / 2 - 0.1, metal, width * 0.32));
  g.add(box(width + 0.02, height + 0.02, 0.03, metal, 0, top));
  const p = plate({
    width,
    height,
    bg: '#ffffff',
    fg: SIGN_BLACK,
    lines: [{ text: townName(name), size: 0.3, bold: true }],
    border: kind === 'lieu-dit' ? SIGN_BLACK : SIGN_RED,
    strike: kind === 'sortie' ? SIGN_RED : undefined,
  });
  p.position.set(0, top, 0.02);
  g.add(p);
  return g;
}

function stele(name: string): THREE.Group {
  const g = new THREE.Group();
  g.add(box(2.4, 0.5, 1.5, stone));
  g.add(box(1.4, 2.4, 0.6, stone, 0, 1.6));
  const p = plate({ width: 1.2, height: 0.75, bg: '#2c3136', fg: '#e8e2d0', lines: [{ text: name, size: 0.11, bold: true }] });
  p.position.set(0, 1.9, 0.31);
  g.add(p);
  return g;
}

function statue(name: string): THREE.Group {
  const g = new THREE.Group();
  g.add(box(2.6, 1.4, 4.2, stone));
  const rider = createRiderModel(pbr({ color: 0x4a4f54 }), pbr({ color: 0x3c4044 }), { ...ROAD_LOOK, mono: true });
  rider.group.scale.setScalar(1.7);
  rider.group.position.y = 1.4;
  rider.group.rotation.x = 0.3;
  rider.pose(1.2);
  g.add(rider.group);
  const p = plate({ width: 2.2, height: 0.7, bg: '#2c3136', fg: '#e8e2d0', lines: [{ text: name, size: 0.2, bold: true }] });
  p.position.set(0, 0.75, 2.12);
  g.add(p);
  return g;
}

/** Émetteur du Ventoux : la tour blanche et son mât rouge et blanc, visibles de très loin. */
function tower(): THREE.Group {
  const g = new THREE.Group();
  const white = pbr({ color: 0xece9e2 });
  const red = pbr({ color: 0xc63a2d });
  const cyl = (r: number, h: number, y: number, m: THREE.Material) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, h, 18), m);
    c.position.y = y + h / 2;
    g.add(c);
  };
  g.add(box(22, 7, 16, white));
  cyl(4.6, 26, 0, white);
  cyl(6.4, 6, 24, white);
  cyl(5, 3, 30, red);
  for (let i = 0; i < 6; i++) cyl(1.5 - i * 0.14, 4.5, 33 + i * 4.5, i % 2 ? white : red);
  return g;
}

function colPanel(name: string, altitude: number): THREE.Group {
  const g = new THREE.Group();
  g.add(post(0.14, 3.2, metal, -1.6));
  g.add(post(0.14, 3.2, metal, 1.6));
  const p = plate({
    width: 3.8,
    height: 1.6,
    bg: '#f4c20d',
    fg: '#15171a',
    lines: [
      { text: name, size: 0.4, bold: true },
      { text: `Altitude ${altitude} m`, size: 0.28 },
    ],
  });
  p.position.y = 2.7;
  g.add(p);
  return g;
}

/** Borne cycliste : hauteur restante, altitude et pente moyenne du kilomètre suivant. */
function bollard(colName: string, kmLeft: number, altitude: number, gradeNext: number): THREE.Group {
  const g = new THREE.Group();
  g.add(post(0.5, 1.5, pbr({ color: 0xf2f0ea }), 0, 0.28));
  g.add(box(0.52, 0.24, 0.3, pbr({ color: 0xe5b90e }), 0, 1.6));
  const p = plate({
    width: 0.48,
    height: 1.2,
    bg: '#f2f0ea',
    fg: '#15171a',
    lines: [
      { text: colName, size: 0.075, bold: true },
      { text: `${altitude} m`, size: 0.08 },
      { text: `${kmLeft}`, size: 0.3, bold: true },
      { text: 'km au sommet', size: 0.062 },
      { text: `${gradeNext.toFixed(1).replace('.', ',')} %`, size: 0.13, bold: true },
      { text: 'km suivant', size: 0.062 },
    ],
  });
  p.position.set(0, 0.8, 0.145);
  g.add(p);
  return g;
}

function hairpinPanel(number: number, name: string | null): THREE.Group {
  const g = new THREE.Group();
  g.add(post(0.12, 2.6, metal));
  const p = plate({
    width: 1.5,
    height: 1.25,
    bg: '#0d5c3f',
    fg: '#ffffff',
    lines: name
      ? [
          { text: `${number}`, size: 0.56, bold: true },
          { text: name, size: 0.14 },
        ]
      : [
          { text: `${number}`, size: 0.62, bold: true },
          { text: 'Virage', size: 0.14 },
        ],
  });
  p.position.set(0, 2.6, 0.07);
  g.add(p);
  return g;
}

/** Panneau brun de signalisation touristique, pour annoncer chaque nouveau biome. */
function zoneSign(name: string, km: number): THREE.Group {
  const g = new THREE.Group();
  const width = 4;
  const height = 1.2;
  const top = 2.7;
  g.add(post(0.09, top + height / 2 - 0.1, metal, -width * 0.36));
  g.add(post(0.09, top + height / 2 - 0.1, metal, width * 0.36));
  g.add(box(width + 0.02, height + 0.02, 0.03, metal, 0, top));
  const p = plate({
    width,
    height,
    bg: '#6b3b18',
    fg: '#ffffff',
    lines: [
      { text: name.toLocaleUpperCase('fr-FR'), size: 0.28, bold: true },
      { text: `km ${km.toFixed(0)}`, size: 0.2 },
    ],
    border: '#ffffff',
  });
  p.position.set(0, top, 0.02);
  g.add(p);
  return g;
}

function finishBanner(label: string): THREE.Group {
  const g = new THREE.Group();
  g.add(post(0.3, 6, metal, -5));
  g.add(post(0.3, 6, metal, 5));
  const p = plate({ width: 10.4, height: 1.5, bg: '#b5121b', fg: '#ffffff', lines: [{ text: label, size: 0.85, bold: true }] });
  p.position.y = 5.6;
  g.add(p);
  return g;
}

export class Landmarks {
  readonly events: RouteEvent[] = [];
  readonly group = new THREE.Group();

  constructor(
    private route: Route,
    private field: HeightField,
    scene: THREE.Scene,
  ) {
    if (route.data.world) this.addZoneSigns();
    else this.addBollards();
    this.addHairpins();
    route.data.pois.forEach((p) => this.addPoi(p));
    this.addFinish();
    this.events.sort((a, b) => a.distM - b.distM);
    this.group.traverse((o) => (o.castShadow = true));
    scene.add(this.group);
  }

  /** Sol réellement visible : le relief, ou le talus de la route s'il passe au-dessus. */
  private surfaceAt(x: number, z: number, roadEle: number): number {
    const talus = roadEle + shoulderDrop(this.field.exactRoadDistance(x, z));
    return Math.max(this.field.height(x, z), talus);
  }

  /** Place sur l'accotement, à `side` mètres à droite (ou gauche) de la route. */
  private onShoulder(obj: THREE.Object3D, distM: number, side: number): void {
    const p = this.route.at(distM);
    const x = p.x + Math.cos(p.heading) * side;
    const z = p.z + Math.sin(p.heading) * side;
    obj.position.set(x, this.surfaceAt(x, z, p.ele), z);
    obj.rotation.y = -p.heading;
    this.group.add(obj);
  }

  private addBollards(): void {
    const r = this.route;
    const { climb, footM, endM, name } = r.data;
    const top = climb.topM;
    for (let k = 1; endM - k * 1000 >= footM; k++) {
      const at = endM - k * 1000;
      const g = r.averageGrade(at, at + 1000);
      const short = name.replace(/^Col (du |d'|de la )/, '');
      this.onShoulder(bollard(short, k, Math.round(r.eleAt(at)), g), at, 4.6);
      this.events.push({
        distM: at,
        text: `Borne · ${k} km du sommet (${top} m) · ${g.toFixed(1).replace('.', ',')} % au km suivant`,
      });
    }
  }

  private addHairpins(): void {
    for (const h of this.route.data.hairpins) {
      // Panneau à l'extérieur du lacet.
      this.onShoulder(hairpinPanel(h.number, h.name), h.distM, -h.side * 6.5);
      this.events.push({
        distM: h.distM,
        text: `Virage ${h.number}${h.name ? ` · ${h.name}` : ''} · ${h.ele} m`,
      });
    }
  }

  /** Panneaux d'entrée et de sortie : les bâtiments du lieu sont les vrais, posés par buildBuildings. */
  private addPlaceSigns(poi: Poi): void {
    if (poi.type === 'chalet') {
      const distM = Math.max(0, poi.distM - CHALET_SIGN_M);
      this.onShoulder(townSign(poi.name, 'lieu-dit'), distM, SIGN_SIDE_M);
      this.events.push({ distM, text: poi.name });
      return;
    }
    const distM = Math.max(0, poi.distM - VILLAGE_SIGN_M);
    this.onShoulder(townSign(poi.name, 'entree'), distM, SIGN_SIDE_M);
    this.events.push({ distM, text: poi.name });
    const exitM = poi.distM + VILLAGE_SIGN_M;
    if (exitM < this.route.lengthM) this.onShoulder(townSign(poi.name, 'sortie'), exitM, SIGN_SIDE_M);
  }

  private addPoi(poi: Poi): void {
    if (poi.type === 'village' || poi.type === 'chalet') {
      this.addPlaceSigns(poi);
      return;
    }
    if (poi.type === 'eglise') {
      this.events.push({ distM: poi.distM, text: poi.name });
      return;
    }
    const p = this.route.at(poi.distM);
    const obj =
      poi.type === 'stele' ? stele(poi.name)
      : poi.type === 'statue' ? statue(poi.name)
      : poi.type === 'tour' ? tower()
      : colPanel(poi.name, Math.round(this.route.eleAt(poi.distM)));

    // Coordonnées réelles, en écartant juste l'objet de la chaussée si le point OSM y tombe.
    let { x, z } = poi;
    const clearance = { stele: 7, statue: 9, col: 6, tour: 30 }[poi.type];
    const dist = Math.hypot(x - p.x, z - p.z);
    if (dist < clearance) {
      const nx = dist > 0.5 ? (x - p.x) / dist : Math.cos(p.heading);
      const nz = dist > 0.5 ? (z - p.z) / dist : Math.sin(p.heading);
      x = p.x + nx * clearance;
      z = p.z + nz * clearance;
    }
    obj.position.set(x, this.surfaceAt(x, z, p.ele) - 0.15, z);
    obj.rotation.y = Math.atan2(p.x - x, p.z - z); // tourné vers la route
    this.group.add(obj);
    if (poi.offsetM < 500) this.events.push({ distM: poi.distM, text: poi.name });
  }

  /** Un panneau à l'entrée de chaque biome, posé sur l'accotement. */
  private addZoneSigns(): void {
    const start = this.route.data.loop?.fromM ?? 0;
    // Le premier panneau est celui de la fin du tour : celui du départ le doublerait.
    for (const zone of this.route.data.world!.zones) {
      if (zone.fromM <= start) continue;
      this.onShoulder(zoneSign(zone.name, (zone.fromM - start) / 1000), zone.fromM, SIGN_SIDE_M);
    }
  }

  private addFinish(): void {
    const { endM, name, climb } = this.route.data;
    // Une boucle n'a pas d'arrivée : le tour suivant commence sans interruption.
    if (this.route.data.loop) return;
    if (this.route.data.world) {
      this.onShoulder(finishBanner(`ARRIVÉE · ${name}`), endM - 8, 0);
      return;
    }
    this.onShoulder(finishBanner(`SOMMET · ${name}`), endM - 8, 0);
    this.onShoulder(colPanel(name, climb.topM), endM - 45, 6.5);
  }
}
