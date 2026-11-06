// Fantômes : jusqu'à cinq coureurs virtuels qui tiennent chacun les watts par kilo choisis avant la sortie, du début
// à la fin, quoi que fasse le joueur. Ils ont son vélo et son poids : seule leur puissance change.

import type { PelotonRider } from './peloton';

export const MAX_BOTS = 5;
export const BOT_WKG_MIN = 1;
export const BOT_WKG_MAX = 6.5;
export const BOT_WKG_STEP = 0.1;
export const DEFAULT_BOT_WKG = 3;

/** Une teinte par fantôme, pour les reconnaître sur la route. */
export const BOT_TINTS = [0xffb347, 0x7fe08a, 0xff7fb0, 0xf6e05e, 0xb48cff] as const;

/** Places sur la largeur de la route : les trois premiers de front, les deux suivants derrière. */
const LANES_M = [0.1, 2.8, 0.75, 0.1, 2.8];
const SECOND_ROW_BACK_M = 3;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Le profil vient du stockage du navigateur : on ne garde que des niveaux valides, cinq au plus. */
export function sanitizeBots(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .slice(0, MAX_BOTS)
    .map((v) => round1(clamp(v, BOT_WKG_MIN, BOT_WKG_MAX)));
}

export function botName(index: number): string {
  return `Fantôme ${index + 1}`;
}

/** Les fantômes à partir de leurs niveaux en W/kg ; leur masse est celle du joueur, donc leur puissance en watts aussi. */
export function botRiders(wkgs: number[], riderKg: number): PelotonRider[] {
  return wkgs.slice(0, MAX_BOTS).map((wkg, i) => ({
    name: botName(i),
    teamId: 'fantome',
    lateralM: LANES_M[i],
    startOffsetM: i >= 3 ? -SECOND_ROW_BACK_M : 0,
    ghostTint: BOT_TINTS[i],
    powerAt: () => wkg * riderKg,
  }));
}
