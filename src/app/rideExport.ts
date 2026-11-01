// Enregistrement d'une sortie dans un fichier TCX, que Strava, Garmin Connect, TrainingPeaks et la plupart des
// autres services d'entraînement savent importer.

import type { RideSample, RideStats } from '../sim/rideStats';

export interface RideRecord {
  name: string;
  /** Instant du premier coup de pédale, en millisecondes. */
  startedAt: number;
  elapsedS: number;
  samples: RideSample[];
  stats: RideStats;
}

const escapeXml = (text: string): string => text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

const iso = (ms: number): string => new Date(ms).toISOString();

/** Le fichier de la sortie, au format TCX : un tour, et un point par seconde avec puissance, cadence et cardio. */
export function buildTcx(ride: RideRecord): string {
  const { samples, stats } = ride;
  const last = samples[samples.length - 1];
  const maxSpeedMps = samples.reduce((m, s) => Math.max(m, s.speedKmh), 0) / 3.6;
  const points = samples
    .map((s) => {
      const hr = s.heartRateBpm !== null && s.heartRateBpm > 0 ? `<HeartRateBpm><Value>${Math.round(s.heartRateBpm)}</Value></HeartRateBpm>` : '';
      return `<Trackpoint><Time>${iso(ride.startedAt + s.t * 1000)}</Time><AltitudeMeters>${s.altitudeM.toFixed(1)}</AltitudeMeters><DistanceMeters>${s.distanceM.toFixed(1)}</DistanceMeters>${hr}<Cadence>${Math.round(s.cadenceRpm)}</Cadence><Extensions><ns3:TPX><ns3:Speed>${(s.speedKmh / 3.6).toFixed(2)}</ns3:Speed><ns3:Watts>${Math.round(s.powerW)}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
    })
    .join('');
  const heart =
    stats.avgHeartRateBpm !== null && stats.maxHeartRateBpm !== null
      ? `<AverageHeartRateBpm><Value>${Math.round(stats.avgHeartRateBpm)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.round(stats.maxHeartRateBpm)}</Value></MaximumHeartRateBpm>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${iso(ride.startedAt)}</Id>
<Lap StartTime="${iso(ride.startedAt)}"><TotalTimeSeconds>${ride.elapsedS.toFixed(0)}</TotalTimeSeconds><DistanceMeters>${(last?.distanceM ?? 0).toFixed(1)}</DistanceMeters><MaximumSpeed>${maxSpeedMps.toFixed(2)}</MaximumSpeed><Calories>${Math.round(stats.energyKJ)}</Calories>${heart}<Intensity>Active</Intensity><Cadence>${Math.round(stats.avgCadenceRpm)}</Cadence><TriggerMethod>Manual</TriggerMethod><Track>${points}</Track></Lap>
<Notes>${escapeXml(ride.name)} (Cols de France)</Notes></Activity></Activities>
</TrainingCenterDatabase>
`;
}

/** Nom du fichier : sortie-2026-11-01-1830.tcx. */
export function rideFileName(startedAt: number): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `sortie-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.tcx`;
}

/** Propose le fichier au téléchargement. Renvoie son nom. */
export function saveRide(ride: RideRecord): string {
  const name = rideFileName(ride.startedAt);
  const blob = new Blob([buildTcx(ride)], { type: 'application/vnd.garmin.tcx+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}
