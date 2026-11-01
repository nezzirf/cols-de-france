// Monde d'entraînement : une boucle de 46 km qui traverse six biomes, de la plage au désert, en
// passant par une montagne enneigée, puis revient au point de départ. Tout le décor est périodique :
// la fin du tour et son début sont identiques, ce qui permet d'enchaîner les tours à l'infini sans
// aucun raccord visible. Tout est généré, rien ne représente un lieu réel.

import { fbm, ridged, smoothstep } from './noise';
import { Route, type RouteData } from './route';
import { biomeWeights, type WorldBiome, type WorldMeta, type WorldZone } from './worldBiomes';

export const WORLD_ROUTE_ID = 'monde';
export const WORLD_NAME = "Monde d'entraînement";

const STEP_M = 10;
/** Tracé conservé avant le départ et après l'arrivée du tour : la route ne doit jamais s'arrêter net. */
const RUN_IN_M = 600;
const RUN_OUT_M = 1200;
const BLEND_M = 1400;
const MARGIN_M = 2200;
const TERRAIN_STEP_M = 20;
const START_ELE_M = 3;
const SEA_LEVEL_M = 0;

/**
 * Les biomes se suivent le long du tour. La plage est coupée en deux : le départ est en son milieu,
 * si bien que le raccord entre la fin et le début du tour se fait en plein sable.
 */
const ZONE_PLAN: { biome: WorldBiome; name: string; km: number }[] = [
  { biome: 'plage', name: 'Plage de sable fin', km: 2.5 },
  { biome: 'prairie', name: 'Prairies fleuries', km: 6 },
  { biome: 'foret', name: 'Forêt profonde', km: 9 },
  { biome: 'montagne', name: 'Montagne enneigée', km: 10 },
  { biome: 'canyon', name: 'Canyon rouge', km: 10 },
  { biome: 'desert', name: 'Désert de dunes', km: 6 },
  { biome: 'plage', name: 'Plage de sable fin', km: 2.5 },
];

/** Pente (%) aux kilomètres indiqués ; entre deux repères, elle varie progressivement. */
const GRADE_PLAN: [number, number][] = [
  [0, 0], [1, 0.3], [2.5, 0.8], [4, 2.2], [6, 3], [8.5, 3.4],
  [10, 4.4], [13, 5.4], [16, 5], [17.5, 5.6],
  [19, 6.6], [22, 7.6], [25, 6.6], [26.8, 3.4],
  [28.2, -1.5], [30, -8], [33, -11], [36, -9.5], [37.5, -6.5],
  [39, -5.5], [41, -5], [43.5, -3.6], [44.5, -1.8], [46, 0],
];

const LAP_KM = ZONE_PLAN.reduce((s, z) => s + z.km, 0);
const LAP_M = LAP_KM * 1000;
const TAU = Math.PI * 2;

/** Pente à une distance du tour, qui se répète d'un tour à l'autre. */
function gradeAt(km: number): number {
  const k = ((km % LAP_KM) + LAP_KM) % LAP_KM;
  const plan = GRADE_PLAN;
  for (let i = 1; i < plan.length; i++) {
    if (k <= plan[i][0]) {
      const t = smoothstep(plan[i - 1][0], plan[i][0], k);
      return plan[i - 1][1] + (plan[i][1] - plan[i - 1][1]) * t;
    }
  }
  return plan[plan.length - 1][1];
}

/**
 * Direction de la route. Chaque terme fait un nombre entier d'ondulations par tour, donc la
 * direction est la même au départ et à l'arrivée. Le tracé serpente en montagne, se redresse dans
 * le désert.
 */
function headingAt(s: number): number {
  const mountain = smoothstep(16000, 18500, s) * (1 - smoothstep(26500, 29000, s));
  const calm = 1 - 0.6 * smoothstep(37000, 39500, s) * (1 - smoothstep(41500, 43500, s));
  const wave = 0.3 * Math.sin((TAU * 51 * s) / LAP_M) + 0.2 * Math.sin((TAU * 20 * s) / LAP_M + 1);
  return wave * calm + 0.4 * Math.sin((TAU * 148 * s) / LAP_M) * mountain;
}

export interface WorldLayout {
  /** Du début du tracé (600 m avant le départ) à 1,2 km après l'arrivée du tour. */
  x: number[];
  z: number[];
  ele: number[];
  grade: number[];
  world: WorldMeta;
  /** Position du départ et de l'arrivée du tour, en mètres depuis le début du tracé. */
  loop: { fromM: number; toM: number };
  lapM: number;
}

/** Le tracé et son profil, sans le relief : assez léger pour afficher le parcours dans le menu. */
export function worldLayout(): WorldLayout {
  const lapSteps = LAP_M / STEP_M;
  const baseCount = lapSteps + RUN_OUT_M / STEP_M + 1;
  const bx = new Array<number>(baseCount);
  const bz = new Array<number>(baseCount);
  const be = new Array<number>(baseCount);

  // Les élévations d'abord : la boucle doit revenir à son altitude de départ, l'écart éventuel est
  // reparti sur le désert, où une légère variation de pente ne se remarque pas.
  const rise = new Array<number>(baseCount - 1);
  let drift = 0;
  for (let i = 0; i < baseCount - 1; i++) {
    rise[i] = (gradeAt((i + 0.5) * (STEP_M / 1000)) / 100) * STEP_M;
    if (i < lapSteps) drift += rise[i];
  }
  const bump = (i: number) => {
    const t = (i * STEP_M - 38000) / 6000;
    return t > 0 && t < 1 ? Math.sin(Math.PI * t) ** 2 : 0;
  };
  let bumpSum = 0;
  for (let i = 0; i < lapSteps; i++) bumpSum += bump(i);
  const repay = (i: number) => (i < lapSteps ? bump(i) : bump(i - lapSteps)) / bumpSum;
  let px = 0;
  let pz = 0;
  let pe = START_ELE_M;
  for (let i = 0; i < baseCount; i++) {
    bx[i] = px;
    bz[i] = pz;
    be[i] = pe;
    const h = headingAt(i * STEP_M);
    px += Math.cos(h) * STEP_M;
    pz += Math.sin(h) * STEP_M;
    if (i < baseCount - 1) pe += rise[i] - drift * repay(i);
  }
  // La route doit aussi revenir à la même abscisse latérale : on redresse le tracé d'un angle constant.
  const lateral = bz[lapSteps] / LAP_M;
  for (let i = 0; i < baseCount; i++) bz[i] -= lateral * i * STEP_M;
  const period = bx[lapSteps];

  // Le tracé précédant le départ est la fin du tour, décalée d'une période.
  const preCount = RUN_IN_M / STEP_M;
  const x = new Array<number>(preCount + baseCount);
  const z = new Array<number>(preCount + baseCount);
  const ele = new Array<number>(preCount + baseCount);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  for (let i = 0; i < preCount; i++) {
    const j = lapSteps - preCount + i;
    x[i] = r2(bx[j] - period);
    z[i] = r2(bz[j]);
    ele[i] = r2(be[j]);
  }
  for (let i = 0; i < baseCount; i++) {
    x[preCount + i] = r2(bx[i]);
    z[preCount + i] = r2(bz[i]);
    ele[preCount + i] = r2(be[i]);
  }
  const count = x.length;
  const grade = ele.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    return Math.round(((ele[b] - ele[a]) / ((b - a) * STEP_M)) * 10000) / 100;
  });

  const loop = { fromM: RUN_IN_M, toM: RUN_IN_M + LAP_M };
  let from = 0;
  const zones: WorldZone[] = ZONE_PLAN.map((plan) => {
    const fromM = loop.fromM + from * 1000;
    from += plan.km;
    const toM = loop.fromM + from * 1000;
    return {
      biome: plan.biome,
      name: plan.name,
      fromM,
      toM,
      fromX: x[Math.round(fromM / STEP_M)],
      toX: x[Math.round(toM / STEP_M)],
    };
  });
  return { x, z, ele, grade, world: { zones, blendM: BLEND_M, seaLevelM: SEA_LEVEL_M, periodM: x[Math.round(loop.toM / STEP_M)] }, loop, lapM: LAP_M };
}

/** Abscisse ramenée dans la période : le décor de x + P est celui de x. */
const wrap = (x: number, period: number): number => x - period * Math.floor(x / period);

/**
 * Relief propre à chaque biome, relatif à l'altitude de la route. `d` est l'écart latéral signé
 * (positif à droite, côté mer), `ad` sa valeur absolue. `mx` est l'abscisse repliée en miroir autour
 * du départ : elle ne change pas de motif au raccord, ce que seule la plage, qui l'entoure, exige.
 */
function offset(biome: WorldBiome, cx: number, mx: number, cz: number, d: number, ad: number): number {
  switch (biome) {
    case 'plage': {
      if (d > 0) return -12 * smoothstep(8, 80, d) - 0.012 * Math.max(0, d - 80);
      return 0.05 * ad + 2.2 * fbm(mx / 160, cz / 160, 3, 1) * smoothstep(30, 160, ad);
    }
    case 'prairie':
      return 0.1 * ad + 34 * (fbm(cx / 900, cz / 900, 3, 2) - 0.5) * smoothstep(50, 350, ad);
    case 'foret':
      return 0.16 * ad + 80 * (fbm(cx / 700, cz / 700, 4, 3) - 0.35) * smoothstep(50, 420, ad);
    case 'montagne':
      return 0.42 * ad + 430 * ridged(cx / 1150, cz / 1150, 4, 4) * smoothstep(90, 800, ad);
    case 'canyon': {
      // Mesas : le bruit est quantifié en gradins aux flancs raides.
      const n = Math.max(0, (fbm(cx / 1500, cz / 1500, 3, 5) - 0.3) * 16);
      const step = Math.floor(n) + smoothstep(0.9, 1, n - Math.floor(n));
      return 0.06 * ad + 42 * step * smoothstep(60, 380, ad);
    }
    case 'desert': {
      const phase = (cx * 0.6 + cz * 0.8) * 0.0052 + 3.2 * fbm(cx / 800, cz / 800, 3, 6);
      const dune = Math.pow(Math.abs(Math.sin(phase)), 0.75);
      return 0.07 * ad + (15 * dune + 22 * (fbm(cx / 600, cz / 600, 3, 7) - 0.4)) * smoothstep(40, 260, ad);
    }
  }
}

export function buildWorldRoute(): { route: Route; heights: Float32Array } {
  const layout = worldLayout();
  const { x, z, ele, grade, world, loop } = layout;
  const period = world.periodM;

  const minX = Math.min(...x) - MARGIN_M;
  const maxX = Math.max(...x) + MARGIN_M;
  const minZ = Math.min(...z) - MARGIN_M;
  const maxZ = Math.max(...z) + MARGIN_M;
  const x0 = Math.floor(minX / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const z0 = Math.floor(minZ / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const cols = Math.ceil((maxX - x0) / TERRAIN_STEP_M) + 1;
  const rows = Math.ceil((maxZ - z0) / TERRAIN_STEP_M) + 1;
  const heights = new Float32Array(cols * rows);

  // Le tour proprement dit : c'est lui qui se répète, avant comme après.
  const first = Math.round(loop.fromM / STEP_M);
  const last = Math.round(loop.toM / STEP_M);
  const biomes = world.zones.map((zone) => zone.biome);
  const weights = new Array<number>(biomes.length).fill(0);
  for (let c = 0; c < cols; c++) {
    const cx = x0 + c * TERRAIN_STEP_M;
    const wx = wrap(cx, period);
    const mx = Math.min(wx, period - wx);
    let low = first;
    let high = last;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (x[mid] <= wx) low = mid;
      else high = mid;
    }
    biomeWeights(wx, world, weights);
    for (let r = 0; r < rows; r++) {
      const cz = z0 + r * TERRAIN_STEP_M;
      const d = cz - z[low];
      const ad = Math.abs(d);
      let off = 0;
      for (let k = 0; k < biomes.length; k++) {
        if (weights[k] > 0.002) off += weights[k] * offset(biomes[k], wx, mx, cz, d, ad);
      }
      heights[r * cols + c] = ele[low] + off;
    }
  }

  let gain = 0;
  for (let i = first + 1; i <= last; i++) if (ele[i] > ele[i - 1]) gain += ele[i] - ele[i - 1];
  const lengthKm = LAP_KM;
  const data: RouteData = {
    id: WORLD_ROUTE_ID,
    name: WORLD_NAME,
    subtitle: `Boucle de ${lengthKm} km, de la plage au désert`,
    massif: 'Monde',
    stepM: STEP_M,
    origin: { lat: 43.3, lon: 6.5 },
    x,
    z,
    ele,
    grade,
    footM: loop.fromM,
    endM: loop.toM,
    climb: {
      lengthKm,
      avgGradePct: 0,
      gainM: Math.round(gain),
      topM: Math.round(Math.max(...ele)),
      official: { lengthKm, avgGradePct: 0 },
    },
    biomes: { valley: 300, forest: 900, alpage: 1500, rock: 'gris', trees: 'mixte' },
    buildingStyle: 'alpes',
    pois: [],
    hairpins: [],
    segments: [
      { id: `${WORLD_ROUTE_ID}:tour`, name: 'Tour des six biomes', startM: loop.fromM, endM: loop.toM },
      ...world.zones.map((zone, k) => ({ id: `${WORLD_ROUTE_ID}:z${k}`, name: zone.name, startM: zone.fromM, endM: zone.toM })),
    ],
    terrain: { file: '', cols, rows, stepM: TERRAIN_STEP_M, x0, z0, scale: 1, ortho: { file: '', width: 0, height: 0 } },
    sources: [],
    world,
    loop,
  };
  return { route: new Route(data), heights };
}
