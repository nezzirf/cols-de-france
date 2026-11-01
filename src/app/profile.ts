// Profil du joueur, conservé d'une séance à l'autre.

import { DEFAULT_BIKE_ID, BIKE_JERSEY } from '../sim/bikes';

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
}

export const CUSTOM_ROUTE_ID = 'perso';

/** Le monde d'entraînement, le parcours choisi dans l'onglet Parcours, ou une application en fond. */
export type WorkoutWhere = 'monde' | 'parcours' | 'app';
/** Capturer l'application dans la page, la laisser à part sous une barre flottante, ou n'afficher que le panneau (écran partagé). */
export type AppMode = 'capture' | 'flottante' | 'partage';
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
