// Chiffres d'une sortie, calculés à partir d'un point par seconde.

/** Une seconde de sortie. */
export interface RideSample {
  /** Secondes écoulées depuis le premier coup de pédale. */
  t: number;
  /** Distance parcourue depuis le départ, tours compris. */
  distanceM: number;
  powerW: number;
  cadenceRpm: number;
  heartRateBpm: number | null;
  altitudeM: number;
  speedKmh: number;
}

export interface RideStats {
  avgPowerW: number;
  maxPowerW: number;
  /** Puissance normalisée : les à-coups pèsent plus que la moyenne, comme dans l'effort ressenti. */
  normalizedPowerW: number;
  /** Moyenne sur les secondes où l'on pédale. */
  avgCadenceRpm: number;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  elevationGainM: number;
  energyKJ: number;
  /** Rapport de la puissance normalisée à la FTP, ou null sans FTP. */
  intensityFactor: number | null;
  /** Charge d'entraînement : 100 pour une heure à la FTP. */
  tss: number | null;
}

/** Fenêtre de la moyenne glissante de la puissance normalisée. */
const NP_WINDOW_S = 30;

const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

/** Puissance normalisée : racine quatrième de la moyenne des puissances lissées sur 30 s, à la puissance 4. */
export function normalizedPower(samples: RideSample[]): number {
  if (samples.length === 0) return 0;
  if (samples.length < NP_WINDOW_S) return mean(samples.map((s) => s.powerW));
  const smoothed: number[] = [];
  let sum = 0;
  samples.forEach((s, i) => {
    sum += s.powerW;
    if (i >= NP_WINDOW_S) sum -= samples[i - NP_WINDOW_S].powerW;
    if (i >= NP_WINDOW_S - 1) smoothed.push(sum / NP_WINDOW_S);
  });
  return mean(smoothed.map((p) => p ** 4)) ** 0.25;
}

/** Chiffres d'une portion de la sortie, entre `fromS` et `toS` (secondes de sortie, bornes comprises). */
export interface RangeStats {
  durationS: number;
  avgPowerW: number;
  avgHeartRateBpm: number | null;
  avgSpeedKmh: number;
  distanceKm: number;
  elevationGainM: number;
}

export function rangeStats(samples: RideSample[], fromS: number, toS: number): RangeStats | null {
  const part = samples.filter((s) => s.t >= fromS && s.t <= toS);
  if (part.length < 2) return null;
  const hr = part.map((s) => s.heartRateBpm).filter((v): v is number => v !== null && v > 0);
  let gain = 0;
  for (let i = 1; i < part.length; i++) gain += Math.max(0, part[i].altitudeM - part[i - 1].altitudeM);
  const durationS = part[part.length - 1].t - part[0].t;
  const distanceM = part[part.length - 1].distanceM - part[0].distanceM;
  return {
    durationS,
    avgPowerW: mean(part.map((s) => s.powerW)),
    avgHeartRateBpm: hr.length > 0 ? mean(hr) : null,
    avgSpeedKmh: durationS > 0 ? (distanceM / durationS) * 3.6 : 0,
    distanceKm: distanceM / 1000,
    elevationGainM: gain,
  };
}

/** Durées (s) des meilleures puissances suivies : sprint, minute, cinq minutes, vingt minutes. */
export const BEST_WINDOWS_S = [5, 60, 300, 1200] as const;

/** Meilleure puissance moyenne tenue sur `windowS` secondes consécutives, ou null si la sortie est plus courte. */
export function bestPower(samples: RideSample[], windowS: number): number | null {
  if (samples.length < windowS) return null;
  let sum = 0;
  let best = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i].powerW;
    if (i >= windowS) sum -= samples[i - windowS].powerW;
    if (i >= windowS - 1) best = Math.max(best, sum / windowS);
  }
  return best;
}

/** Meilleures puissances par durée, en watts entiers. Les durées plus longues que la sortie sont absentes. */
export function powerBests(samples: RideSample[]): Record<number, number> {
  const bests: Record<number, number> = {};
  for (const w of BEST_WINDOWS_S) {
    const p = bestPower(samples, w);
    if (p !== null) bests[w] = Math.round(p);
  }
  return bests;
}

/** FTP estimée : 95 % de la meilleure puissance sur vingt minutes. */
export function estimateFtp(best20MinW: number | undefined): number | null {
  return best20MinW ? Math.round(best20MinW * 0.95) : null;
}

export function rideStats(samples: RideSample[], ftp: number): RideStats {
  const hr = samples.map((s) => s.heartRateBpm).filter((v): v is number => v !== null && v > 0);
  const pedalling = samples.filter((s) => s.cadenceRpm > 0).map((s) => s.cadenceRpm);
  let gain = 0;
  for (let i = 1; i < samples.length; i++) gain += Math.max(0, samples[i].altitudeM - samples[i - 1].altitudeM);
  const np = normalizedPower(samples);
  const intensity = ftp > 0 && samples.length > 0 ? np / ftp : null;
  return {
    avgPowerW: mean(samples.map((s) => s.powerW)),
    maxPowerW: samples.reduce((m, s) => Math.max(m, s.powerW), 0),
    normalizedPowerW: np,
    avgCadenceRpm: mean(pedalling),
    avgHeartRateBpm: hr.length > 0 ? mean(hr) : null,
    maxHeartRateBpm: hr.length > 0 ? Math.max(...hr) : null,
    elevationGainM: gain,
    // Les points sont à une seconde d'écart : un watt par point, c'est un joule.
    energyKJ: samples.reduce((e, s) => e + s.powerW, 0) / 1000,
    intensityFactor: intensity,
    tss: intensity === null ? null : (samples.length * np * intensity) / (ftp * 3600) * 100,
  };
}
