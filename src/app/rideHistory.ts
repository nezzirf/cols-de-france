// Historique des sorties, gardé dans le navigateur : un résumé par sortie, et les points seconde par seconde
// des plus récentes pour pouvoir les revoir, les réexporter ou courir contre elles.

import { BEST_WINDOWS_S, type RideSample, type RideStats, powerBests } from '../sim/rideStats';
import { type PackedSamples, packSamples, unpackSamples } from '../sim/samplesPack';

const HISTORY_KEY = 'cols.history';
const SAMPLES_KEY = 'cols.ride.';
/** Nombre de sorties dont on garde les points ; les plus anciennes ne gardent que leur résumé. */
export const KEPT_SAMPLES = 20;
/** Nombre maximal de sorties dans l'historique. */
export const MAX_HISTORY = 300;

/** Ce que l'historique garde de chaque sortie. */
export interface HistoryEntry {
  /** Instant du départ en millisecondes, aussi identifiant. */
  id: number;
  name: string;
  /** Parcours roulé, ou null pour une sortie devant un écran. */
  routeId: string | null;
  elapsedS: number;
  distanceKm: number;
  elevationGainM: number;
  avgPowerW: number;
  normalizedPowerW: number;
  tss: number | null;
  /** Meilleures puissances de la sortie, par durée en secondes. */
  bests: Record<number, number>;
  /** Vrai tant que les points de la sortie sont encore gardés. */
  detailed: boolean;
}

export interface RideToLog {
  name: string;
  routeId: string | null;
  startedAt: number;
  elapsedS: number;
  distanceKm: number;
  samples: RideSample[];
  stats: RideStats;
}

/** Les sorties plus courtes ne valent pas d'être gardées. */
export const MIN_LOGGED_S = 60;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function loadHistory(store: Store | null = defaultStore()): HistoryEntry[] {
  try {
    const list = JSON.parse(store?.getItem(HISTORY_KEY) ?? '[]') as HistoryEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeHistory(list: HistoryEntry[], store: Store | null): void {
  try {
    store?.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Stockage plein ou indisponible : la sortie reste enregistrable depuis le récap.
  }
}

/** Ajoute une sortie (la même sortie ne s'ajoute pas deux fois). Renvoie l'entrée, ou null si elle est trop courte. */
export function addRide(ride: RideToLog, store: Store | null = defaultStore()): HistoryEntry | null {
  if (ride.elapsedS < MIN_LOGGED_S || ride.samples.length < 2) return null;
  const list = loadHistory(store).filter((e) => e.id !== ride.startedAt);
  const entry: HistoryEntry = {
    id: ride.startedAt,
    name: ride.name,
    routeId: ride.routeId,
    elapsedS: Math.round(ride.elapsedS),
    distanceKm: ride.distanceKm,
    elevationGainM: Math.round(ride.stats.elevationGainM),
    avgPowerW: Math.round(ride.stats.avgPowerW),
    normalizedPowerW: Math.round(ride.stats.normalizedPowerW),
    tss: ride.stats.tss === null ? null : Math.round(ride.stats.tss),
    bests: powerBests(ride.samples),
    detailed: true,
  };
  list.push(entry);
  list.sort((a, b) => b.id - a.id);
  const kept = list.slice(0, MAX_HISTORY);
  try {
    store?.setItem(SAMPLES_KEY + entry.id, JSON.stringify(packSamples(ride.samples)));
  } catch {
    entry.detailed = false;
  }
  kept.forEach((e, i) => {
    if (i >= KEPT_SAMPLES && e.detailed) {
      e.detailed = false;
      try {
        store?.removeItem(SAMPLES_KEY + e.id);
      } catch {
        // Rien à faire.
      }
    }
  });
  for (const gone of list.slice(MAX_HISTORY)) {
    try {
      store?.removeItem(SAMPLES_KEY + gone.id);
    } catch {
      // Rien à faire.
    }
  }
  writeHistory(kept, store);
  return entry;
}

export function loadSamples(id: number, store: Store | null = defaultStore()): RideSample[] | null {
  try {
    const raw = store?.getItem(SAMPLES_KEY + id);
    return raw ? unpackSamples(JSON.parse(raw) as PackedSamples) : null;
  } catch {
    return null;
  }
}

export function deleteRide(id: number, store: Store | null = defaultStore()): void {
  writeHistory(loadHistory(store).filter((e) => e.id !== id), store);
  try {
    store?.removeItem(SAMPLES_KEY + id);
  } catch {
    // Rien à faire.
  }
}

/** Meilleure puissance de l'historique pour chaque durée, hors la sortie `except`. */
export function personalBests(history: HistoryEntry[], except?: number): Record<number, number> {
  const best: Record<number, number> = {};
  for (const e of history) {
    if (e.id === except) continue;
    for (const w of BEST_WINDOWS_S) {
      const p = e.bests[w];
      if (p !== undefined && p > (best[w] ?? 0)) best[w] = p;
    }
  }
  return best;
}

export interface Totals {
  rides: number;
  elapsedS: number;
  distanceKm: number;
  elevationGainM: number;
  tss: number;
}

/** Cumul des sorties des sept derniers jours. */
export function weekTotals(history: HistoryEntry[], now = Date.now()): Totals {
  const since = now - 7 * 24 * 3600 * 1000;
  const totals: Totals = { rides: 0, elapsedS: 0, distanceKm: 0, elevationGainM: 0, tss: 0 };
  for (const e of history) {
    if (e.id < since) continue;
    totals.rides++;
    totals.elapsedS += e.elapsedS;
    totals.distanceKm += e.distanceKm;
    totals.elevationGainM += e.elevationGainM;
    totals.tss += e.tss ?? 0;
  }
  return totals;
}

/**
 * Sortie de référence pour courir contre soi-même sur un parcours : la plus rapide parmi celles dont on garde
 * les points et qui ont couvert au moins `minKm`.
 */
export function referenceRide(routeId: string, minKm: number, store: Store | null = defaultStore()): RideSample[] | null {
  const candidates = loadHistory(store)
    .filter((e) => e.routeId === routeId && e.detailed && e.distanceKm >= minKm)
    .sort((a, b) => b.distanceKm / b.elapsedS - a.distanceKm / a.elapsedS);
  for (const c of candidates) {
    const samples = loadSamples(c.id, store);
    if (samples) return samples;
  }
  return null;
}
