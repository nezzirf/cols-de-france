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
  /** Débuts des paliers de la séance, en secondes de sortie : chacun devient un tour du fichier. */
  lapStarts?: number[];
}

const escapeXml = (text: string): string => text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

const iso = (ms: number): string => new Date(ms).toISOString();

/** Le fichier de la sortie, au format TCX : un tour, et un point par seconde avec puissance, cadence et cardio. */
export function buildTcx(ride: RideRecord): string {
  const laps = splitLaps(ride)
    .map((lap) => buildLap(ride, lap))
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${iso(ride.startedAt)}</Id>
${laps}
<Notes>${escapeXml(ride.name)} (Cols de France)</Notes></Activity></Activities>
</TrainingCenterDatabase>
`;
}

interface LapData {
  samples: RideSample[];
  /** Début du tour en secondes de sortie, et sa durée. */
  startS: number;
  durationS: number;
  /** Distance déjà parcourue au début du tour. */
  startDistanceM: number;
}

/** Coupe la sortie en tours : un par palier de la séance, ou un seul tour pour une sortie libre. */
function splitLaps(ride: RideRecord): LapData[] {
  const { samples } = ride;
  const starts = [...new Set((ride.lapStarts ?? []).filter((s) => s > 0))].sort((a, b) => a - b);
  const groups: RideSample[][] = [[]];
  const bounds = [0, ...starts];
  for (const s of samples) {
    let lap = 0;
    // Un point décrit la seconde qui se termine à son instant : il appartient au palier qui contient cette seconde.
    while (lap + 1 < bounds.length && s.t > bounds[lap + 1]) lap++;
    while (groups.length <= lap) groups.push([]);
    groups[lap].push(s);
  }
  const laps: LapData[] = [];
  groups.forEach((group, i) => {
    if (group.length === 0) return;
    const startS = i === 0 ? 0 : bounds[i];
    const endS = i + 1 < bounds.length ? bounds[i + 1] : ride.elapsedS;
    const previous = laps[laps.length - 1];
    const startDistanceM = previous ? previous.startDistanceM + distanceOf(previous) : 0;
    laps.push({ samples: group, startS, durationS: Math.max(1, endS - startS), startDistanceM });
  });
  // Sans séance, ou si rien ne tombe dans un tour : la sortie entière fait un seul tour.
  return laps.length > 0 ? laps : [{ samples, startS: 0, durationS: ride.elapsedS, startDistanceM: 0 }];
}

const distanceOf = (lap: LapData): number => (lap.samples[lap.samples.length - 1]?.distanceM ?? 0) - lap.startDistanceM;

const average = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

/** Un tour du fichier, avec ses propres puissance, cadence et cardio moyens : c'est ce que lisent les services de suivi. */
function buildLap(ride: RideRecord, lap: LapData): string {
  const { samples } = lap;
  const last = samples[samples.length - 1];
  const distanceM = Math.max(0, (last?.distanceM ?? 0) - lap.startDistanceM);
  const powers = samples.map((s) => s.powerW);
  const pedalling = samples.filter((s) => s.cadenceRpm > 0);
  const heartRates = samples.map((s) => s.heartRateBpm).filter((h): h is number => h !== null && h > 0);
  const maxSpeedMps = samples.reduce((m, s) => Math.max(m, s.speedKmh), 0) / 3.6;
  const points = samples
    .map((s) => {
      const hr = s.heartRateBpm !== null && s.heartRateBpm > 0 ? `<HeartRateBpm><Value>${Math.round(s.heartRateBpm)}</Value></HeartRateBpm>` : '';
      return `<Trackpoint><Time>${iso(ride.startedAt + s.t * 1000)}</Time><AltitudeMeters>${s.altitudeM.toFixed(1)}</AltitudeMeters><DistanceMeters>${s.distanceM.toFixed(1)}</DistanceMeters>${hr}<Cadence>${Math.round(s.cadenceRpm)}</Cadence><Extensions><ns3:TPX><ns3:Speed>${(s.speedKmh / 3.6).toFixed(2)}</ns3:Speed><ns3:Watts>${Math.round(s.powerW)}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
    })
    .join('');
  const heart =
    heartRates.length > 0
      ? `<AverageHeartRateBpm><Value>${Math.round(average(heartRates))}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.round(Math.max(...heartRates))}</Value></MaximumHeartRateBpm>`
      : '';
  const first = samples[0];
  const startMs = ride.startedAt + (first ? first.t : lap.startS) * 1000;
  const kJ = powers.reduce((a, b) => a + b, 0) / 1000;
  return `<Lap StartTime="${iso(startMs)}"><TotalTimeSeconds>${lap.durationS.toFixed(0)}</TotalTimeSeconds><DistanceMeters>${distanceM.toFixed(1)}</DistanceMeters><MaximumSpeed>${maxSpeedMps.toFixed(2)}</MaximumSpeed><Calories>${Math.round(kJ)}</Calories>${heart}<Intensity>Active</Intensity><Cadence>${Math.round(average(pedalling.map((s) => s.cadenceRpm)))}</Cadence><TriggerMethod>Manual</TriggerMethod><Track>${points}</Track><Extensions><ns3:LX><ns3:AvgSpeed>${(distanceM / lap.durationS).toFixed(2)}</ns3:AvgSpeed><ns3:AvgWatts>${Math.round(average(powers))}</ns3:AvgWatts><ns3:MaxWatts>${Math.round(Math.max(0, ...powers))}</ns3:MaxWatts></ns3:LX></Extensions></Lap>`;
}

/** Nom du fichier : sortie-2026-11-01-1830.tcx. */
export function rideFileName(startedAt: number): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `sortie-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.tcx`;
}

/** Le fichier de la sortie, prêt à être partagé avec une application (Strava, Garmin Connect…). */
export function rideFile(ride: RideRecord): File {
  return new File([buildTcx(ride)], rideFileName(ride.startedAt), { type: 'application/vnd.garmin.tcx+xml' });
}

/** Vrai quand le navigateur sait partager un fichier avec une autre application (surtout sur tablette et téléphone). */
export function canShareRide(ride: RideRecord): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [rideFile(ride)] });
  } catch {
    return false;
  }
}

/** Ouvre le partage du système avec le fichier de la sortie. Renvoie faux si le joueur a refermé la fenêtre. */
export async function shareRide(ride: RideRecord): Promise<boolean> {
  try {
    await navigator.share({ files: [rideFile(ride)], title: `${ride.name} · Cols de France` });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    throw err;
  }
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
