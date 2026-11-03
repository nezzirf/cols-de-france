// Sortie en groupe : dix ou quinze coureurs qui roulent aux watts par kilo choisis avant le départ. Pendant
// l'échauffement ils restent avec le joueur, à sa vitesse ; ensuite ils tiennent ce niveau jusqu'à la fin,
// quoi que fasse le joueur : s'il va moins vite ils partent devant, s'il va plus vite il les double.

import { TEAMS } from './bikes';
import type { PelotonRider } from './peloton';

export const GROUP_SIZES = [10, 15] as const;
export type GroupSize = (typeof GROUP_SIZES)[number];

export const GROUP_WKG_MIN = 1.5;
export const GROUP_WKG_MAX = 5.5;
export const GROUP_WKG_STEP = 0.1;

/** Temps d'échauffement (s) : le groupe reste avec le joueur, puis se cale sur les watts par kilo choisis. */
export const GROUP_WARMUP_S = 15 * 60;

export interface GroupOptions {
  riders: GroupSize;
  wkg: number;
}

const FIRST_NAMES = [
  'Hugo', 'Camille', 'Mathis', 'Léa', 'Lucas', 'Inès', 'Théo', 'Chloé', 'Nathan', 'Jade',
  'Louis', 'Manon', 'Jules', 'Sarah', 'Maxime',
];

/** Masses des coureurs : de 58 à 85 kg, réparties pour qu'aucune ne se répète d'un coureur voisin. */
const MASSES_KG = [72, 61, 80, 66, 58, 77, 69, 84, 63, 74, 59, 82, 68, 71, 85];
/** Écart au niveau choisi : chacun est à ± 2 % environ, pour que le groupe ne soit pas une colonne parfaite. */
const SPREAD = [0.0, 0.012, -0.015, 0.02, -0.008, 0.006, -0.02, 0.016, -0.004, 0.01, -0.012, 0.004, 0.018, -0.006, -0.018];
/** Variation lente de l'effort, pour que le groupe respire. */
const SURGE_AMPLITUDE = 0.025;
const SURGE_PERIOD_S = 75;

/** Places sur la route : trois de front, des rangées espacées de 2,4 m, le joueur au milieu de la première. */
const LANES_M = [0.7, 1.8, 2.9];
const ROW_SPACING_M = 2.4;

export function groupRiders({ riders, wkg }: GroupOptions): PelotonRider[] {
  const rows = Math.ceil(riders / LANES_M.length);
  return Array.from({ length: riders }, (_, i) => {
    const massKg = MASSES_KG[i];
    const level = wkg * (1 + SPREAD[i]);
    const phase = i * 1.9;
    const row = Math.floor(i / LANES_M.length);
    return {
      name: FIRST_NAMES[i],
      teamId: TEAMS[i % TEAMS.length].id,
      lateralM: LANES_M[i % LANES_M.length],
      massKg,
      startOffsetM: (row - (rows - 1) / 2) * ROW_SPACING_M,
      powerAt: (clockS) => level * massKg * (1 + SURGE_AMPLITUDE * Math.sin((2 * Math.PI * clockS) / SURGE_PERIOD_S + phase)),
    };
  });
}
