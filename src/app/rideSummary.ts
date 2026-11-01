// Récap reconstruit à partir des points d'une sortie : pour terminer une sortie interrompue ou revoir une sortie passée.

import { rideStats, type RideSample } from '../sim/rideStats';
import type { RideSummary } from './game';

export function summaryFromSamples(samples: RideSample[], ftp: number, startedAt: number): RideSummary {
  const stats = rideStats(samples, ftp);
  const elapsedS = samples.length > 0 ? samples[samples.length - 1].t : 0;
  const covered = samples.length > 0 ? samples[samples.length - 1].distanceM : 0;
  return {
    elapsedS,
    distanceKm: covered / 1000,
    avgSpeedKmh: elapsedS > 0 ? (covered / elapsedS) * 3.6 : 0,
    avgPowerW: stats.avgPowerW,
    maxPowerW: stats.maxPowerW,
    results: [],
    samples,
    stats,
    startedAt,
  };
}
