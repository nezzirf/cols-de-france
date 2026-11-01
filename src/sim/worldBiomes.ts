// Biomes du monde d'entraînement. Chacun occupe un tronçon de la route ; entre deux tronçons, des
// poids continus les fondent l'un dans l'autre sur plus d'un kilomètre, sans aucune frontière nette.

import { smoothstep } from './noise';

export type WorldBiome = 'plage' | 'prairie' | 'foret' | 'montagne' | 'canyon' | 'desert';

export interface WorldZone {
  biome: WorldBiome;
  name: string;
  fromM: number;
  toM: number;
  /** Abscisse du début et de la fin : la route avance toujours vers +x, le décor s'en sert. */
  fromX: number;
  toX: number;
}

export interface WorldMeta {
  zones: WorldZone[];
  /** Largeur de la transition entre deux biomes, centrée sur leur frontière. */
  blendM: number;
  seaLevelM: number;
  /** Longueur du motif qui se répète : le décor de x + période est celui de x. */
  periodM: number;
}

/**
 * Poids de chaque biome à l'abscisse `x`, positifs et de somme 1. Les frontières étant espacées de
 * plus que la transition, un biome ne se mélange qu'avec ses deux voisins.
 */
export function biomeWeights(rawX: number, meta: WorldMeta, out: number[] = []): number[] {
  const zones = meta.zones;
  const x = rawX - meta.periodM * Math.floor(rawX / meta.periodM);
  const half = meta.blendM / 2;
  let before = 1;
  for (let k = 0; k < zones.length; k++) {
    // `after` vaut 0 avant la frontière qui suit la zone k et 1 une fois franchie.
    const after = k < zones.length - 1 ? smoothstep(zones[k].toX - half, zones[k].toX + half, x) : 0;
    out[k] = before - after;
    before = after;
  }
  return out;
}

export function dominant(weights: number[]): number {
  let best = 0;
  for (let k = 1; k < weights.length; k++) if (weights[k] > weights[best]) best = k;
  return best;
}

/** Choisit un biome au hasard selon les poids : c'est ce qui rend les lisières naturelles. */
export function pickZone(weights: number[], roll: number): number {
  let sum = 0;
  for (let k = 0; k < weights.length; k++) {
    sum += weights[k];
    if (roll < sum) return k;
  }
  return weights.length - 1;
}

/** Part du sol couverte de neige : elle monte avec l'altitude, et le bruit en fait des plaques. */
export function snowAmount(altitudeM: number, noise: number): number {
  return smoothstep(550, 900, altitudeM + (noise - 0.5) * 220);
}
