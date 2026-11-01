// Relief réel d'un parcours, creusé le long de la route.
// La grille DEM (20 m) n'a pas la finesse d'une route : on l'abaisse et on la raccorde
// autour du tracé, dont l'altitude IGN fait foi.

import type { Route, TerrainMeta } from '../sim/route';

const CORE_M = 16;
const BLEND_M = 55;
const ROAD_SINK_M = 1.4;
/**
 * Autour de chaque point de route, le relief reste sous un cône : plat, puis pente de 54°.
 * La partie plate couvre une maille entière de la grille : plus étroite, un sommet de maille
 * proche d'une jambe haute ferait passer son triangle par-dessus la jambe basse.
 */
const CEILING_FLAT_M = 22;
/** En deçà de cet écart le long du tracé, c'est la même portion de route, pas une autre jambe. */
const SAME_LEG_M = 25;
const CEILING_SLOPE = 1.4;
/** Largeur de sol ramenée au niveau de la route après lissage. */
const PIN_M = 15;
const SMOOTH_PASSES = 4;
const ROAD_HASH_M = 40;

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class HeightField {
  readonly meta: TerrainMeta;
  readonly heights: Float32Array;
  /** Distance à la route par cellule (m), bornée à BLEND_M. */
  readonly roadDistance: Float32Array;
  private axis: { x: number[]; z: number[] };
  private roadHash = new Map<number, number[]>();

  constructor(route: Route, raw: Float32Array, smoothPasses = SMOOTH_PASSES) {
    this.meta = route.data.terrain;
    const { cols, rows, stepM, x0, z0 } = this.meta;
    this.heights = raw.slice();
    this.roadDistance = new Float32Array(raw.length).fill(BLEND_M);
    // Altitude cible : moyenne des points de route voisins, pondérée par la proximité. Prendre
    // seulement le plus proche créerait une falaise à mi-chemin entre deux jambes de lacet.
    const eleSum = new Float32Array(raw.length);
    const weightSum = new Float32Array(raw.length);
    const nearestEle = new Float32Array(raw.length);
    const nearestIndex = new Int32Array(raw.length);
    const ceiling = new Float32Array(raw.length).fill(Infinity);
    const reach = Math.ceil(BLEND_M / stepM);
    const { x, z, ele } = route.data;
    this.axis = { x, z };
    for (let i = 0; i < x.length; i++) {
      const key = Math.floor(x[i] / ROAD_HASH_M) * 100000 + Math.floor(z[i] / ROAD_HASH_M);
      const list = this.roadHash.get(key);
      if (list) list.push(i);
      else this.roadHash.set(key, [i]);
    }

    for (let i = 0; i < x.length; i++) {
      const cc = Math.round((x[i] - x0) / stepM);
      const cr = Math.round((z[i] - z0) / stepM);
      for (let r = Math.max(0, cr - reach); r <= Math.min(rows - 1, cr + reach); r++) {
        for (let c = Math.max(0, cc - reach); c <= Math.min(cols - 1, cc + reach); c++) {
          const d = Math.hypot(x0 + c * stepM - x[i], z0 + r * stepM - z[i]);
          const k = r * cols + c;
          if (d >= BLEND_M) continue;
          const weight = (1 - d / BLEND_M) ** 2;
          eleSum[k] += ele[i] * weight;
          weightSum[k] += weight;
          if (d < this.roadDistance[k]) {
            this.roadDistance[k] = d;
            nearestEle[k] = ele[i];
            nearestIndex[k] = i;
          }
        }
      }
    }
    // Plafond de la portion que la cellule longe, calé sur la route à sa hauteur : prendre le
    // point bas des environs laisserait le sol 2 à 3 m sous la chaussée sur une rampe à 10 %.
    for (let k = 0; k < raw.length; k++) {
      if (this.roadDistance[k] < BLEND_M) {
        ceiling[k] = nearestEle[k] + Math.max(0, this.roadDistance[k] - CEILING_FLAT_M) * CEILING_SLOPE;
      }
    }
    // Puis celui des autres jambes voisines, sous lesquelles le relief doit aussi passer.
    const sameLeg = Math.round(SAME_LEG_M / route.data.stepM);
    for (let i = 0; i < x.length; i++) {
      const cc = Math.round((x[i] - x0) / stepM);
      const cr = Math.round((z[i] - z0) / stepM);
      for (let r = Math.max(0, cr - reach); r <= Math.min(rows - 1, cr + reach); r++) {
        for (let c = Math.max(0, cc - reach); c <= Math.min(cols - 1, cc + reach); c++) {
          const k = r * cols + c;
          if (Math.abs(i - nearestIndex[k]) < sameLeg) continue;
          const d = Math.hypot(x0 + c * stepM - x[i], z0 + r * stepM - z[i]);
          if (d < BLEND_M) ceiling[k] = Math.min(ceiling[k], ele[i] + Math.max(0, d - CEILING_FLAT_M) * CEILING_SLOPE);
        }
      }
    }
    for (let k = 0; k < raw.length; k++) {
      const d = this.roadDistance[k];
      if (d >= BLEND_M) continue;
      const t = smoothstep(CORE_M, BLEND_M, d);
      const target = eleSum[k] / weightSum[k] - ROAD_SINK_M;
      const blended = target + (raw[k] - target) * t;
      this.heights[k] = Math.min(blended, ceiling[k] - ROAD_SINK_M);
    }
    this.smoothCorridor(ceiling, smoothPasses);
    // Le lissage fait glisser le sol loin de la route : on le ramène à son niveau le long d'elle.
    for (let k = 0; k < raw.length; k++) {
      if (this.roadDistance[k] < PIN_M) this.heights[k] = Math.min(nearestEle[k], ceiling[k]) - ROAD_SINK_M;
    }
  }

  /**
   * Étale les talus sur plusieurs cellules : sur une grille de 20 m, un talus étroit en
   * diagonale apparaît en escalier, et le seuil de couleur de la roche suit cet escalier.
   */
  private smoothCorridor(ceiling: Float32Array, passes: number): void {
    const { cols, rows } = this.meta;
    const h = this.heights;
    const next = new Float32Array(h);
    for (let pass = 0; pass < passes; pass++) {
      for (let r = 1; r < rows - 1; r++) {
        for (let c = 1; c < cols - 1; c++) {
          const k = r * cols + c;
          if (this.roadDistance[k] >= BLEND_M) continue;
          const mean = (h[k] * 2 + h[k - 1] + h[k + 1] + h[k - cols] + h[k + cols]) / 6;
          next[k] = Math.min(mean, ceiling[k] - ROAD_SINK_M);
        }
      }
      h.set(next);
    }
  }

  /** Distance réelle à l'axe de la route. Plus précise que la grille, pour poser l'herbe au bord. */
  exactRoadDistance(px: number, pz: number): number {
    const cx = Math.floor(px / ROAD_HASH_M);
    const cz = Math.floor(pz / ROAD_HASH_M);
    let best = Infinity;
    const { x, z } = this.axis;
    for (let a = cx - 1; a <= cx + 1; a++) {
      for (let b = cz - 1; b <= cz + 1; b++) {
        for (const i of this.roadHash.get(a * 100000 + b) ?? []) {
          for (const k of [i - 1, i]) {
            if (k < 0 || k + 1 >= x.length) continue;
            const dx = x[k + 1] - x[k];
            const dz = z[k + 1] - z[k];
            const t = Math.max(0, Math.min(1, ((px - x[k]) * dx + (pz - z[k]) * dz) / (dx * dx + dz * dz || 1)));
            best = Math.min(best, Math.hypot(px - x[k] - dx * t, pz - z[k] - dz * t));
          }
        }
      }
    }
    return best;
  }

  private bilinear(field: Float32Array, x: number, z: number): number {
    const { cols, rows, stepM, x0, z0 } = this.meta;
    const fx = Math.max(0, Math.min(cols - 1.001, (x - x0) / stepM));
    const fz = Math.max(0, Math.min(rows - 1.001, (z - z0) / stepM));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const ax = fx - c;
    const az = fz - r;
    const k = r * cols + c;
    return (
      (field[k] * (1 - ax) + field[k + 1] * ax) * (1 - az) +
      (field[k + cols] * (1 - ax) + field[k + cols + 1] * ax) * az
    );
  }

  /** Altitude exacte de la surface affichée : les mêmes triangles que le maillage du relief. */
  height(x: number, z: number): number {
    const { cols, rows, stepM, x0, z0 } = this.meta;
    const fx = Math.max(0, Math.min(cols - 1.001, (x - x0) / stepM));
    const fz = Math.max(0, Math.min(rows - 1.001, (z - z0) / stepM));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const u = fx - c;
    const v = fz - r;
    const h = this.heights;
    const k = r * cols + c;
    const a = h[k];
    const b = h[k + 1];
    const d = h[k + cols];
    const e = h[k + cols + 1];
    return u + v <= 1 ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
  }

  distanceToRoad(x: number, z: number): number {
    return this.bilinear(this.roadDistance, x, z);
  }
}
