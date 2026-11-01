// Parcours du salon : une boucle plate et douce, sans décor, pour rouler devant un écran. Les pentes
// restent sous 2,5 % : rien n'oblige à lever les yeux de la série.

import { Route, type RouteData } from './route';

export const SALON_ROUTE_ID = 'salon';

const STEP_M = 10;
const LAP_M = 12000;
const RUN_IN_M = 600;
const RUN_OUT_M = 1200;
const BASE_ELE_M = 100;
const ROLL_M = 14;
const ROLLS_PER_LAP = 3;

export function buildSalonRoute(): Route {
  const count = (RUN_IN_M + LAP_M + RUN_OUT_M) / STEP_M + 1;
  const x = Array.from({ length: count }, (_, i) => i * STEP_M);
  const z = new Array<number>(count).fill(0);
  // Un nombre entier d'ondulations par tour : le profil est le même au départ et à l'arrivée.
  const ele = x.map((px) => Math.round((BASE_ELE_M + ROLL_M * Math.sin((2 * Math.PI * ROLLS_PER_LAP * (px - RUN_IN_M)) / LAP_M)) * 100) / 100);
  const grade = ele.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    return Math.round(((ele[b] - ele[a]) / ((b - a) * STEP_M)) * 10000) / 100;
  });
  const loop = { fromM: RUN_IN_M, toM: RUN_IN_M + LAP_M };
  const data: RouteData = {
    id: SALON_ROUTE_ID,
    name: 'Parcours du salon',
    subtitle: 'Boucle plate de 12 km, sans décor',
    massif: 'Salon',
    stepM: STEP_M,
    origin: { lat: 45, lon: 6 },
    x,
    z,
    ele,
    grade,
    footM: loop.fromM,
    endM: loop.toM,
    climb: { lengthKm: LAP_M / 1000, avgGradePct: 0, gainM: ROLL_M * 2 * ROLLS_PER_LAP, topM: BASE_ELE_M + ROLL_M, official: { lengthKm: LAP_M / 1000, avgGradePct: 0 } },
    biomes: { valley: 300, forest: 900, alpage: 1500, rock: 'gris', trees: 'mixte' },
    buildingStyle: 'alpes',
    pois: [],
    hairpins: [],
    segments: [{ id: `${SALON_ROUTE_ID}:tour`, name: 'Tour du salon', startM: loop.fromM, endM: loop.toM }],
    terrain: { file: '', cols: 0, rows: 0, stepM: 20, x0: 0, z0: 0, scale: 1, ortho: { file: '', width: 0, height: 0 } },
    sources: [],
    loop,
  };
  return new Route(data);
}
