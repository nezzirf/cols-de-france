// Zones de puissance (modèle de Coggan, en pourcentage de la FTP).

export interface PowerZone {
  id: number;
  name: string;
  /** Borne haute en pourcentage de la FTP (exclue). */
  upToPct: number;
  color: string;
}

export const ZONES: PowerZone[] = [
  { id: 1, name: 'Récupération', upToPct: 55, color: '#8a97a6' },
  { id: 2, name: 'Endurance', upToPct: 75, color: '#3fa7ff' },
  { id: 3, name: 'Tempo', upToPct: 90, color: '#4cc46a' },
  { id: 4, name: 'Seuil', upToPct: 105, color: '#f2c230' },
  { id: 5, name: 'VO2 max', upToPct: 120, color: '#ff8a2b' },
  { id: 6, name: 'Anaérobie', upToPct: 150, color: '#ff4d4d' },
  { id: 7, name: 'Sprint', upToPct: Infinity, color: '#c04dff' },
];

/** Numéro de zone (1 à 7) d'une puissance, ou 0 sans FTP. */
export function powerZone(powerW: number, ftp: number): number {
  if (ftp <= 0) return 0;
  const pct = (powerW / ftp) * 100;
  return ZONES.find((z) => pct < z.upToPct)!.id;
}

/** Secondes passées dans chaque zone, à raison d'un point par seconde. */
export function timeInZones(powers: number[], ftp: number): number[] {
  const seconds = ZONES.map(() => 0);
  if (ftp <= 0) return seconds;
  for (const p of powers) seconds[powerZone(p, ftp) - 1]++;
  return seconds;
}
