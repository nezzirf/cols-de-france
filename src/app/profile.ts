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
}

export const CUSTOM_ROUTE_ID = 'perso';

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
