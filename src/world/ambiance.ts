// Ambiance de la sortie : le moment de la journée et la météo. Ils changent la lumière, le ciel et la brume,
// jamais l'effort : la pente et la vitesse restent celles de la route.

export type Weather = 'degage' | 'nuageux' | 'brouillard' | 'pluie';
export type Moment = 'matin' | 'jour' | 'soir';

export interface Ambiance {
  weather: Weather;
  moment: Moment;
}

export const DEFAULT_AMBIANCE: Ambiance = { weather: 'degage', moment: 'jour' };

export const WEATHERS: { id: Weather; label: string }[] = [
  { id: 'degage', label: 'Dégagé' },
  { id: 'nuageux', label: 'Nuageux' },
  { id: 'brouillard', label: 'Brouillard' },
  { id: 'pluie', label: 'Pluie' },
];

export const MOMENTS: { id: Moment; label: string }[] = [
  { id: 'matin', label: 'Matin' },
  { id: 'jour', label: 'Jour' },
  { id: 'soir', label: 'Coucher de soleil' },
];

/** Lumière du moment : direction du soleil (x, y, z), couleur et force du soleil, du ciel, teinte de l'horizon. */
interface MomentLook {
  sun: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  skyIntensity: number;
  zenith: [number, number, number];
  horizonTint: [number, number, number];
}

const MOMENT_LOOKS: Record<Moment, MomentLook> = {
  matin: { sun: [0.55, 0.3, 0.38], sunColor: 0xffd9b0, sunIntensity: 2.4, skyIntensity: 0.9, zenith: [0.14, 0.3, 0.6], horizonTint: [1, 0.93, 0.88] },
  jour: { sun: [0.55, 0.62, 0.38], sunColor: 0xfff3e2, sunIntensity: 3, skyIntensity: 1.05, zenith: [0.07, 0.24, 0.62], horizonTint: [1, 1, 1] },
  soir: { sun: [0.55, 0.13, 0.38], sunColor: 0xff9a55, sunIntensity: 1.9, skyIntensity: 0.7, zenith: [0.13, 0.15, 0.4], horizonTint: [1, 0.76, 0.62] },
};

/** Effet de la météo : couverture, assombrissement, brume, force de la lumière et pluie. */
interface WeatherLook {
  /** Seuil de couverture nuageuse du ciel (bas : couvert). */
  cover: number;
  cloudDark: number;
  fogMultiplier: number;
  /** Part de gris mélangée à la couleur de la brume. */
  fogGrey: number;
  sunFactor: number;
  skyFactor: number;
  rain: number;
}

const WEATHER_LOOKS: Record<Weather, WeatherLook> = {
  degage: { cover: 0.46, cloudDark: 0, fogMultiplier: 1, fogGrey: 0, sunFactor: 1, skyFactor: 1, rain: 0 },
  nuageux: { cover: 0.26, cloudDark: 0.3, fogMultiplier: 1.6, fogGrey: 0.35, sunFactor: 0.45, skyFactor: 0.95, rain: 0 },
  brouillard: { cover: 0.05, cloudDark: 0.15, fogMultiplier: 18, fogGrey: 0.8, sunFactor: 0.25, skyFactor: 0.95, rain: 0 },
  pluie: { cover: 0.0, cloudDark: 0.6, fogMultiplier: 6, fogGrey: 0.65, sunFactor: 0.2, skyFactor: 0.8, rain: 1 },
};

export const FOG_GREY = 0x9aa3ab;

/** Tous les réglages que la scène applique pour une ambiance donnée. */
export interface AmbianceLook {
  sunDirection: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  skyIntensity: number;
  zenith: [number, number, number];
  horizonTint: [number, number, number];
  cover: number;
  cloudDark: number;
  fogMultiplier: number;
  fogGrey: number;
  rain: number;
}

export function ambianceLook({ weather, moment }: Ambiance): AmbianceLook {
  const m = MOMENT_LOOKS[moment];
  const w = WEATHER_LOOKS[weather];
  // Sous les nuages, le ciel perd sa couleur : le zénith tire vers le gris.
  const grey = w.fogGrey * 0.7;
  const zenith = m.zenith.map((c, i) => c + (([0.42, 0.45, 0.5][i] * m.skyIntensity) - c) * grey) as [number, number, number];
  return {
    sunDirection: m.sun,
    sunColor: m.sunColor,
    sunIntensity: m.sunIntensity * w.sunFactor,
    skyIntensity: m.skyIntensity * w.skyFactor,
    zenith,
    horizonTint: m.horizonTint,
    cover: w.cover,
    cloudDark: w.cloudDark,
    fogMultiplier: w.fogMultiplier,
    fogGrey: w.fogGrey,
    rain: w.rain,
  };
}
