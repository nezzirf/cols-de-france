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
