// Parcours personnalisé : un tracé généré, sans lien avec une route réelle, fait de 5 km de plat
// pour s'échauffer puis d'une montée à la pente choisie.

import { Route, type RouteData } from './route';

export interface CustomRouteOptions {
  /** Longueur de la partie choisie, après l'échauffement. */
  climbKm: number;
  gradePct: number;
}

export const WARMUP_KM = 5;
export const MAX_CLIMB_KM = 60;
export const MAX_GRADE_PCT = 20;

const STEP_M = 10;
const RUN_OUT_M = 600;
const TRANSITION_M = 60;
const START_ELE_M = 480;
const TERRAIN_STEP_M = 20;
const TERRAIN_MARGIN_M = 2500;
/** Le versant monte des deux côtés de la route : on roule dans une vallée, pas sur une digue. */
const VALLEY_SLOPE = 0.2;

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Pente voulue à une distance donnée : nulle à l'échauffement, puis celle choisie. */
export function customGradeAt(distM: number, footM: number, endM: number, gradePct: number): number {
  return gradePct * smoothstep(footM - TRANSITION_M, footM + TRANSITION_M, distM) * (1 - smoothstep(endM, endM + TRANSITION_M, distM));
}

/** Collines douces, identiques d'une sortie à l'autre. */
function hills(x: number, z: number): number {
  return (
    Math.sin(x * 0.0013 + z * 0.0009) * 34 +
    Math.sin(x * 0.0031 - z * 0.0017 + 1.3) * 16 +
    Math.sin(x * 0.0071 + z * 0.0053 + 4.1) * 6
  );
}

export function buildCustomRoute({ climbKm, gradePct }: CustomRouteOptions): { route: Route; heights: Float32Array } {
  const climb = Math.max(0.5, Math.min(MAX_CLIMB_KM, climbKm));
  const grade = Math.max(0, Math.min(MAX_GRADE_PCT, gradePct));
  const footM = WARMUP_KM * 1000;
  const endM = Math.round(footM + climb * 1000);
  const count = Math.round((endM + RUN_OUT_M) / STEP_M) + 1;

  const x = new Array<number>(count);
  const z = new Array<number>(count);
  const ele = new Array<number>(count);
  let px = 0;
  let pz = 0;
  let pe = START_ELE_M;
  for (let i = 0; i < count; i++) {
    const s = i * STEP_M;
    x[i] = Math.round(px * 100) / 100;
    z[i] = Math.round(pz * 100) / 100;
    ele[i] = Math.round(pe * 100) / 100;
    const heading = 0.42 * Math.sin(s / 780) + 0.26 * Math.sin(s / 2100 + 1);
    px += Math.cos(heading) * STEP_M;
    pz += Math.sin(heading) * STEP_M;
    pe += (customGradeAt(s + STEP_M / 2, footM, endM, grade) / 100) * STEP_M;
  }
  const gradeSeries = ele.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    return Math.round(((ele[b] - ele[a]) / ((b - a) * STEP_M)) * 10000) / 100;
  });

  const minX = Math.min(...x) - TERRAIN_MARGIN_M;
  const maxX = Math.max(...x) + TERRAIN_MARGIN_M;
  const minZ = Math.min(...z) - TERRAIN_MARGIN_M;
  const maxZ = Math.max(...z) + TERRAIN_MARGIN_M;
  const x0 = Math.floor(minX / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const z0 = Math.floor(minZ / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const cols = Math.ceil((maxX - x0) / TERRAIN_STEP_M) + 1;
  const rows = Math.ceil((maxZ - z0) / TERRAIN_STEP_M) + 1;
  const heights = new Float32Array(cols * rows);
  let index = 0;
  for (let c = 0; c < cols; c++) {
    const cx = x0 + c * TERRAIN_STEP_M;
    // Le tracé avance toujours vers +x : on suit le point de même abscisse, sans le rechercher.
    while (index + 1 < count && x[index + 1] < cx) index++;
    for (let r = 0; r < rows; r++) {
      const cz = z0 + r * TERRAIN_STEP_M;
      const offset = Math.abs(cz - z[index]);
      heights[r * cols + c] = ele[index] + offset * VALLEY_SLOPE + hills(cx, cz) * smoothstep(60, 500, offset);
    }
  }

  const gain = ele[Math.round(endM / STEP_M)] - ele[Math.round(footM / STEP_M)];
  const round = (v: number) => Math.round(v * 10) / 10;
  const name = 'Parcours personnalisé';
  const data: RouteData = {
    id: `perso-${round(climb)}-${round(grade)}`,
    name,
    subtitle: `${WARMUP_KM} km de plat puis ${round(climb)} km à ${round(grade)} %`,
    massif: 'Personnalisé',
    stepM: STEP_M,
    origin: { lat: 45, lon: 6 },
    x,
    z,
    ele,
    grade: gradeSeries,
    footM,
    endM,
    climb: {
      lengthKm: round(climb),
      avgGradePct: round(grade),
      gainM: Math.round(gain),
      topM: Math.round(ele[Math.round(endM / STEP_M)]),
      official: { lengthKm: round(climb), avgGradePct: round(grade) },
    },
    biomes: { valley: 1100, forest: 1800, alpage: 2400, rock: 'gris', trees: 'mixte' },
    buildingStyle: 'alpes',
    pois: [],
    hairpins: [],
    segments: [{ id: `perso:${round(climb)}:${round(grade)}`, name: 'Montée personnalisée', startM: footM, endM }],
    terrain: { file: '', cols, rows, stepM: TERRAIN_STEP_M, x0, z0, scale: 1, ortho: { file: '', width: 0, height: 0 } },
    sources: [],
  };
  return { route: new Route(data), heights };
}
