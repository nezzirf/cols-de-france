// Profil du joueur, conservé d'une séance à l'autre.

import { BIKE_JERSEY, DEFAULT_BIKE_ID } from '../sim/bikes';
import type { GroupSize } from '../sim/group';
import type { Moment, Weather } from '../world/ambiance';

export interface Profile {
  name: string;
  riderKg: number;
  ftp: number;
  difficulty: number;
  bikeId: string;
  jerseyId: string;
  /** Identifiant du col choisi, ou CUSTOM_ROUTE_ID pour le parcours personnalisé. */
  routeId: string;
  customKm: number;
  customGrade: number;
  workoutId: string | null;
  /** Où rouler une séance. */
  workoutWhere: WorkoutWhere;
  appMode: AppMode;
  appBars: AppBars;
  weather: Weather;
  moment: Moment;
  /** Faire rouler quatre coéquipiers de niveaux différents. */
  peloton: boolean;
  /** Courir contre sa meilleure sortie sur le même parcours. */
  ghost: boolean;
  /** Sortie en peloton : nombre de coureurs, watts par kilo du groupe et parcours. */
  groupRiders: GroupSize;
  groupWkg: number;
  groupRouteId: string;
}

export const CUSTOM_ROUTE_ID = 'perso';

/** Le monde d'entraînement, le parcours choisi dans l'onglet Parcours, ou une application en fond. */
export type WorkoutWhere = 'monde' | 'parcours' | 'app';
/** Capturer l'application dans la page, la laisser à part sous une barre flottante, n'afficher que le panneau (écran partagé), ou une pastille vidéo par-dessus l'application (Android). */
export type AppMode = 'capture' | 'flottante' | 'partage' | 'pastille';
export type AppBars = 'haut' | 'bas' | 'les-deux';

export interface AppOptions {
  mode: AppMode;
  bars: AppBars;
}

const PROFILE_KEY = 'cols.profile';
const DEFAULT_PROFILE: Profile = {
  name: 'Cycliste',
  riderKg: 75,
  ftp: 220,
  difficulty: 100,
  bikeId: DEFAULT_BIKE_ID,
  jerseyId: BIKE_JERSEY,
  routeId: '',
  customKm: 10,
  customGrade: 7,
  workoutId: null,
  workoutWhere: 'monde',
  appMode: 'capture',
  appBars: 'les-deux',
  weather: 'degage',
  moment: 'jour',
  peloton: false,
  ghost: true,
  groupRiders: 10,
  groupWkg: 3,
  groupRouteId: '',
};

export function loadProfile(): Profile {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Sans stockage, le profil reste valable pour la séance.
  }
}
