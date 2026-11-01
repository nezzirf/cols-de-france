// Sauvegarde automatique de la sortie en cours : après une coupure ou une page fermée par erreur,
// on peut reprendre là où on en était, ou terminer la sortie pour la retrouver dans l'historique.

import type { RideSample } from '../sim/rideStats';
import type { Workout } from '../sim/workout';
import { type PackedSamples, packSamples, unpackSamples } from '../sim/samplesPack';

const KEY = 'cols.inprogress';
/** Une sortie interrompue depuis plus longtemps n'est plus proposée. */
export const MAX_AGE_MS = 12 * 3600 * 1000;
/** Sous cette durée, la reprise n'a pas d'intérêt. */
export const MIN_RESUME_S = 60;

/** L'état du jeu à restaurer. */
export interface GameState {
  elapsedS: number;
  energyJ: number;
  maxPowerW: number;
  distanceM: number;
  laps: number;
  startedAt: number;
}

export interface SavedRide {
  /** Parcours roulé, ou null pour une sortie devant un écran. */
  routeId: string | null;
  name: string;
  workout: Workout | null;
  state: GameState;
  samples: RideSample[];
  savedAt: number;
}

interface Stored extends Omit<SavedRide, 'samples'> {
  packed: PackedSamples;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function saveInProgress(ride: SavedRide, store: Store | null = defaultStore()): void {
  const { samples, ...rest } = ride;
  try {
    store?.setItem(KEY, JSON.stringify({ ...rest, packed: packSamples(samples) } satisfies Stored));
  } catch {
    // Stockage plein ou indisponible : la sortie continue, sans reprise possible.
  }
}

/** La sortie interrompue, si elle est assez longue et assez récente pour valoir une reprise. */
export function loadInProgress(now = Date.now(), store: Store | null = defaultStore()): SavedRide | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const { packed, ...rest } = JSON.parse(raw) as Stored;
    if (now - rest.savedAt > MAX_AGE_MS || rest.state.elapsedS < MIN_RESUME_S) return null;
    return { ...rest, samples: unpackSamples(packed) };
  } catch {
    return null;
  }
}

export function clearInProgress(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // Rien à faire.
  }
}
