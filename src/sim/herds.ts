// Troupeaux des prairies : des vaches et des moutons qui paissent à côté de la route. Ils sont placés une fois pour
// toutes, au même endroit à chaque sortie, et jamais deux troupeaux ne se retrouvent proches l'un de l'autre.

export type HerdKind = 'vache' | 'mouton';

export interface Herd {
  kind: HerdKind;
  /** Place le long de la route (m). */
  distM: number;
  /** Côté de la route : 1 à droite, −1 à gauche. */
  side: 1 | -1;
  /** Écart du centre du troupeau à la route (m). */
  offsetM: number;
  /** Nombre de bêtes. */
  count: number;
  /** Rayon de la prairie où le troupeau est répandu (m). */
  spreadM: number;
}

/** Distance minimale entre deux troupeaux, le long de la route (m). */
export const HERD_MIN_GAP_M = 1100;
/** Les troupeaux restent à l'intérieur de la prairie, loin des lisières où elle se fond dans le paysage voisin. */
const MARGIN_M = 450;

/** Suite pseudo-aléatoire reproductible : le même parcours a toujours les mêmes troupeaux. */
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

/** Les troupeaux d'une prairie qui va de `fromM` à `toM`, des vaches puis des moutons en alternance. */
export function planHerds(fromM: number, toM: number, seed = 11): Herd[] {
  const next = sequence(seed + Math.round(fromM));
  const herds: Herd[] = [];
  let at = fromM + MARGIN_M + next() * 250;
  let kind: HerdKind = next() < 0.5 ? 'vache' : 'mouton';
  while (at <= toM - MARGIN_M) {
    herds.push({
      kind,
      distM: Math.round(at),
      side: next() < 0.5 ? -1 : 1,
      offsetM: 15 + next() * 8,
      count: kind === 'vache' ? 5 + Math.floor(next() * 4) : 9 + Math.floor(next() * 6),
      spreadM: kind === 'vache' ? 9 : 7,
    });
    kind = kind === 'vache' ? 'mouton' : 'vache';
    at += HERD_MIN_GAP_M + next() * 500;
  }
  return herds;
}
