// Le public des grands cols : des spectateurs au bord de la route sur les derniers kilomètres, de plus en plus
// serrés vers le sommet, des banderoles, et l'arche de la flamme rouge à un kilomètre de l'arrivée. Tout est placé
// une fois pour toutes, au même endroit à chaque sortie.

/** Longueur de route, avant l'arrivée, où le public se presse (m). */
export const CROWD_ZONE_M = 4000;
/** Distance à l'arrivée à partir de laquelle la foule est au plus dense (m). */
const PACKED_M = 150;

export interface Spectator {
  distM: number;
  /** Côté de la route : 1 à droite, −1 à gauche. */
  side: 1 | -1;
  /** Écart à l'axe de la route (m). */
  offsetM: number;
  scale: number;
  /** Bras en l'air : ceux-là sautent et acclament. */
  cheering: boolean;
  /** Teinte du vêtement, de 0 à 1. */
  hue: number;
  phase: number;
}

export interface BannerPlan {
  distM: number;
  side: 1 | -1;
  text: string;
  bg: string;
  fg: string;
}

export interface ArchPlan {
  distM: number;
  label: string;
}

export interface CrowdPlan {
  spectators: Spectator[];
  banners: BannerPlan[];
  arches: ArchPlan[];
}

const MESSAGES = ['ALLEZ !', 'COURAGE', 'FORZA', 'VAMOS', 'ALLEZ ALLEZ', 'BRAVO', 'HOP HOP HOP', 'TIENS BON', 'GO GO GO', 'ENCORE UN EFFORT'];
const COLORS: [string, string][] = [
  ['#f2c230', '#1a1a1a'],
  ['#d62828', '#ffffff'],
  ['#1d6fd6', '#ffffff'],
  ['#ffffff', '#c1121f'],
  ['#2a9d4a', '#ffffff'],
  ['#ff7a1a', '#ffffff'],
];

function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Densité du public, de 0 (aucun) à 1 (la foule du sommet), selon la distance qu'il reste jusqu'à l'arrivée. */
export function crowdDensityAt(distM: number, endM: number): number {
  const toGo = endM - distM;
  if (toGo < -60 || toGo > CROWD_ZONE_M) return 0;
  if (toGo <= PACKED_M) return toGo < 0 ? Math.max(0, 1 + toGo / 60) : 1;
  const x = 1 - (toGo - PACKED_M) / (CROWD_ZONE_M - PACKED_M);
  return Math.pow(Math.max(0, Math.min(1, x)), 1.4);
}

/** Le public d'un col qui finit à `endM`. */
export function planCrowd(endM: number, seed = 21): CrowdPlan {
  const next = sequence(seed + Math.round(endM));
  const spectators: Spectator[] = [];
  let toGo = CROWD_ZONE_M - next() * 40;
  while (toGo > 18) {
    const density = crowdDensityAt(endM - toGo, endM);
    const people = 1 + Math.floor(next() * (1 + 4 * density));
    const side: 1 | -1 = next() < 0.5 ? -1 : 1;
    for (let i = 0; i < people; i++) {
      spectators.push({
        distM: endM - toGo + (next() - 0.5) * 4,
        side: i > 0 && density > 0.6 && next() < 0.5 ? (-side as 1 | -1) : side,
        offsetM: 4.3 + next() * 3.6,
        scale: 0.9 + next() * 0.2,
        cheering: next() < 0.35 + 0.45 * density,
        hue: next(),
        phase: next() * Math.PI * 2,
      });
    }
    // Un spectateur tous les 60 m au début de la zone, un groupe tous les 6 m aux derniers mètres.
    toGo -= 6 + 54 * Math.pow(Math.max(0, Math.min(1, (toGo - PACKED_M) / (CROWD_ZONE_M - PACKED_M))), 1.3) * (0.7 + next() * 0.6);
  }

  const banners: BannerPlan[] = [];
  let at = CROWD_ZONE_M - 150 - next() * 120;
  let k = 0;
  while (at > 60) {
    const [bg, fg] = COLORS[Math.floor(next() * COLORS.length)];
    banners.push({
      distM: endM - at,
      side: next() < 0.5 ? -1 : 1,
      text: MESSAGES[(k + Math.floor(next() * 3)) % MESSAGES.length],
      bg,
      fg,
    });
    k++;
    at -= 140 + next() * 140;
  }

  return {
    spectators,
    banners,
    arches: [{ distM: endM - 1000, label: '1 KM' }, { distM: endM - 500, label: '500 M' }],
  };
}

/** Un col réel : le public n'a de sens ni dans le monde d'entraînement ni sur une boucle. */
export function hasCrowd(route: { world?: unknown; loop?: unknown; climb: { lengthKm: number } }): boolean {
  return !route.world && !route.loop && route.climb.lengthKm >= 3;
}

/** Poids de chaque modèle de spectateur : l'accroupi est écarté (pose figée impossible à redresser), celui aux bras écartés apparaît moins souvent. */
export const LOOK_WEIGHTS = [1, 0, 1, 1, 0.6, 1];

/**
 * Quel modèle pour chaque spectateur : le même ne revient jamais parmi les `gap` voisins précédents du même côté,
 * ni juste en face de l'autre côté de la route. Tirage reproductible, selon la place de chacun.
 */
export function assignLooks(list: Spectator[], weights: number[] = LOOK_WEIGHTS, gap = 4): number[] {
  const order = list.map((_, i) => i).sort((a, b) => list[a].distM - list[b].distM);
  const looks = new Array<number>(list.length).fill(0);
  const recent: Record<string, { look: number; distM: number }[]> = { '-1': [], '1': [] };
  for (const i of order) {
    const s = list[i];
    const mine = recent[String(s.side)];
    const opposite = recent[String(-s.side)];
    // On écarte d'abord les modèles récents des deux côtés ; si rien ne reste, seulement ceux du même côté.
    const sameSide = mine.slice(-gap).map((r) => r.look);
    const facing = opposite.filter((r) => Math.abs(r.distM - s.distM) < 9).map((r) => r.look);
    const every = weights.map((_, k) => k).filter((k) => weights[k] > 0);
    const allowed = [[...sameSide, ...facing], sameSide, sameSide.slice(-2), sameSide.slice(-1)]
      .map((banned) => every.filter((k) => !banned.includes(k)))
      .find((list) => list.length > 0)!;
    const total = allowed.reduce((sum, k) => sum + weights[k], 0);
    // Un tirage qui ne dépend que du spectateur : la même foule à chaque passage.
    const roll = (Math.abs(Math.sin(s.distM * 12.9898 + s.offsetM * 78.233 + s.phase * 37.719) * 43758.5453) % 1) * total;
    let acc = 0;
    let pick = allowed[allowed.length - 1];
    for (const k of allowed) {
      acc += weights[k];
      if (roll < acc) {
        pick = k;
        break;
      }
    }
    looks[i] = pick;
    mine.push({ look: pick, distM: s.distM });
    if (mine.length > 12) mine.shift();
  }
  return looks;
}
