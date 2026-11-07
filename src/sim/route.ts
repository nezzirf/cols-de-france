// Accès aux données d'un parcours, indexées par la distance parcourue.

import { sanitizeStructures, type Structures } from './structures';
import type { WorldMeta } from './worldBiomes';

export interface Poi {
  name: string;
  type: 'village' | 'eglise' | 'stele' | 'statue' | 'chalet' | 'tour' | 'col';
  x: number;
  z: number;
  distM: number;
  offsetM: number;
}

export interface Hairpin {
  number: number;
  distM: number;
  side: number;
  ele: number;
  name: string | null;
}

export interface SegmentDef {
  id: string;
  name: string;
  startM: number;
  endM: number;
}

export interface Biomes {
  valley: number;
  forest: number;
  alpage: number;
  rock: 'gris' | 'calcaire' | 'schiste' | 'dolomie';
  trees: 'mixte' | 'cedre' | 'hetre' | 'sapin' | 'meleze';
}

export interface OrthoMeta {
  file: string;
  width: number;
  height: number;
}

export interface TerrainMeta {
  file: string;
  cols: number;
  rows: number;
  stepM: number;
  x0: number;
  z0: number;
  scale: number;
  ortho: OrthoMeta;
}

export interface ClimbInfo {
  lengthKm: number;
  avgGradePct: number;
  gainM: number;
  topM: number;
  official: { lengthKm: number; avgGradePct: number };
}

export type BuildingStyle = 'alpes' | 'provence' | 'pyrenees' | 'queyras';

/** Bâtiment réel : emprise [x, z, x, z…] en mètres, murs `h`, faîtage `r` au-dessus, nature `k`. */
export interface BuildingData {
  p: number[];
  h: number;
  r: number;
  k: number;
}

export interface RouteData {
  id: string;
  name: string;
  subtitle: string;
  massif: string;
  stepM: number;
  origin: { lat: number; lon: number };
  x: number[];
  z: number[];
  ele: number[];
  grade: number[];
  footM: number;
  endM: number;
  climb: ClimbInfo;
  biomes: Biomes;
  buildingStyle: BuildingStyle;
  pois: Poi[];
  hairpins: Hairpin[];
  segments: SegmentDef[];
  terrain: TerrainMeta;
  sources: string[];
  /** Présent seulement pour le monde d'entraînement : ses biomes se suivent le long de la route. */
  world?: WorldMeta;
  /** Parcours en boucle : en arrivant à `toM`, le cycliste repart de `fromM`, indéfiniment. */
  loop?: { fromM: number; toM: number };
  /** Tunnels et ponts réels du tracé, quand le fichier existe. */
  structures?: Structures;
}

export interface RouteSummary {
  id: string;
  name: string;
  subtitle: string;
  massif: string;
  climb: ClimbInfo;
  totalKm: number;
  warmupKm: number;
}

export interface RoutePoint {
  x: number;
  z: number;
  ele: number;
  grade: number;
  /** Direction de la route, en radians (0 = vers -Z, sens horaire vu du dessus). */
  heading: number;
}

/** Demi-longueur sur laquelle est mesurée la direction de la route. */
const HEADING_SPAN_M = 2;

export class Route {
  /** Distance à l'arrivée. */
  readonly lengthM: number;
  /** Longueur du tracé complet, qui se prolonge après l'arrivée. */
  readonly pathM: number;

  constructor(readonly data: RouteData) {
    this.lengthM = data.endM;
    this.pathM = (data.x.length - 1) * data.stepM;
  }

  private lerp(series: number[], distM: number): number {
    const f = Math.max(0, Math.min(this.data.x.length - 1, distM / this.data.stepM));
    const i = Math.min(series.length - 2, Math.floor(f));
    return series[i] + (series[i + 1] - series[i]) * (f - i);
  }

  /** Courbe de Catmull-Rom : elle passe par chaque point du tracé sans y faire d'angle. */
  private curve(series: number[], distM: number): number {
    const last = series.length - 1;
    const f = Math.max(0, Math.min(last, distM / this.data.stepM));
    const i = Math.min(last - 1, Math.floor(f));
    const t = f - i;
    const p0 = series[Math.max(0, i - 1)];
    const p1 = series[i];
    const p2 = series[i + 1];
    const p3 = series[Math.min(last, i + 2)];
    return (
      0.5 *
      (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
    );
  }

  eleAt(distM: number): number {
    return this.lerp(this.data.ele, distM);
  }

  gradeAt(distM: number): number {
    return this.lerp(this.data.grade, distM);
  }

  at(distM: number): RoutePoint {
    const x = this.curve(this.data.x, distM);
    const z = this.curve(this.data.z, distM);
    const ax = this.curve(this.data.x, distM - HEADING_SPAN_M);
    const az = this.curve(this.data.z, distM - HEADING_SPAN_M);
    const bx = this.curve(this.data.x, distM + HEADING_SPAN_M);
    const bz = this.curve(this.data.z, distM + HEADING_SPAN_M);
    return {
      x,
      z,
      ele: this.eleAt(distM),
      grade: this.gradeAt(distM),
      heading: Math.atan2(bx - ax, -(bz - az)),
    };
  }

  /** Point de la route le plus proche d'une position, avec l'écart latéral. */
  nearest(px: number, pz: number): { distM: number; offsetM: number } {
    const { x, z, stepM } = this.data;
    let bestD = Infinity;
    let distM = 0;
    for (let i = 0; i + 1 < x.length; i++) {
      const dx = x[i + 1] - x[i];
      const dz = z[i + 1] - z[i];
      const t = Math.max(0, Math.min(1, ((px - x[i]) * dx + (pz - z[i]) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(px - x[i] - dx * t, pz - z[i] - dz * t);
      if (d < bestD) {
        bestD = d;
        distM = (i + t) * stepM;
      }
    }
    return { distM, offsetM: bestD };
  }

  toLatLon(x: number, z: number): { lat: number; lon: number } {
    const { lat, lon } = this.data.origin;
    const metersPerDegree = (6371008.8 * Math.PI) / 180;
    return { lat: lat - z / metersPerDegree, lon: lon + x / (metersPerDegree * Math.cos((lat * Math.PI) / 180)) };
  }

  /** Pente moyenne (%) entre deux distances. */
  averageGrade(fromM: number, toM: number): number {
    const a = Math.max(0, fromM);
    const b = Math.min(this.lengthM, toM);
    if (b <= a) return 0;
    return ((this.eleAt(b) - this.eleAt(a)) / (b - a)) * 100;
  }
}

export async function loadRouteIndex(): Promise<RouteSummary[]> {
  const res = await fetch('data/index.json');
  if (!res.ok) throw new Error(`Liste des cols introuvable (HTTP ${res.status})`);
  return res.json();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Photo aérienne introuvable : ${url}`));
    image.src = url;
  });
}

export async function loadRoute(
  id: string,
): Promise<{ route: Route; heights: Float32Array; buildings: BuildingData[]; ortho: HTMLImageElement }> {
  const [json, bin, buildings, ortho, structures] = await Promise.all([
    fetch(`data/${id}/route.json`).then((r) => {
      if (!r.ok) throw new Error(`Parcours ${id} introuvable (HTTP ${r.status})`);
      return r.json() as Promise<RouteData>;
    }),
    fetch(`data/${id}/terrain.bin`).then((r) => {
      if (!r.ok) throw new Error(`Relief ${id} introuvable (HTTP ${r.status})`);
      return r.arrayBuffer();
    }),
    fetch(`data/${id}/buildings.json`).then((r) => {
      if (!r.ok) throw new Error(`Bâtiments ${id} introuvables (HTTP ${r.status})`);
      return r.json() as Promise<BuildingData[]>;
    }),
    loadImage(`data/${id}/ortho.jpg`),
    // Facultatif : un parcours sans ce fichier n'a simplement ni tunnel ni pont.
    fetch(`data/${id}/structures.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  if (structures) json.structures = sanitizeStructures(structures);
  const raw = new Uint16Array(bin);
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = raw[i] * json.terrain.scale;
  return { route: new Route(json), heights, buildings, ortho };
}
