// Profil du joueur, conservé d'une séance à l'autre.

import { BIKE_JERSEY, DEFAULT_BIKE_ID } from '../sim/bikes';
import { sanitizeBots } from '../sim/bots';
import type { GroupSize } from '../sim/group';
import type { MomentChoice, WeatherChoice } from '../world/ambiance';

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
  weather: WeatherChoice;
  moment: MomentChoice;
  /** Faire rouler quatre coéquipiers de niveaux différents. */
  peloton: boolean;
  /** Courir contre sa meilleure sortie sur le même parcours. */
  ghost: boolean;
  /** Sons d'ambiance : vagues à la plage, oiseaux en forêt, vent en montagne. */
  sound: boolean;
  /** Rouler en peloton sur le parcours choisi : un groupe de coureurs qui tient son niveau en watts par kilo. */
  group: boolean;
  groupRiders: GroupSize;
  groupWkg: number;
  groupRouteId: string;
  /** Volume des sons d'ambiance, de 0 à 100. */
  volume: number;
  /** Apparence des menus : celle de l'appareil, claire ou sombre. */
  theme: Theme;
  /** Messages d'alerte d'effort (trop de watts trop tôt, cadence basse). */
  alerts: boolean;
  /** Le chrono s'arrête quand on ne pédale plus. */
  autoPause: boolean;
  /** L'écran reste allumé pendant la sortie. */
  screenOn: boolean;
  /** Fantômes : le niveau en W/kg de chacun, cinq au plus. */
  bots: number[];
}

export type Theme = 'auto' | 'clair' | 'sombre';

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
  sound: true,
  group: false,
  volume: 70,
  theme: 'auto',
  alerts: true,
  autoPause: true,
  screenOn: true,
  groupRiders: 10,
  groupWkg: 3,
  groupRouteId: '',
  bots: [],
};

export function loadProfile(): Profile {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}');
    return { ...DEFAULT_PROFILE, ...saved, bots: sanitizeBots(saved.bots) };
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
