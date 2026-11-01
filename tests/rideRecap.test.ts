import { describe, expect, it } from 'vitest';
import { buildTcx, rideFileName } from '../src/app/rideExport';
import { normalizedPower, type RideSample, rideStats } from '../src/sim/rideStats';

/** Une sortie de `seconds` secondes, une puissance et une altitude données seconde par seconde. */
function ride(seconds: number, power: (t: number) => number, altitude: (t: number) => number = () => 100, hr: number | null = 140): RideSample[] {
  return Array.from({ length: seconds }, (_, i) => ({
    t: i + 1,
    distanceM: (i + 1) * 8,
    powerW: power(i),
    cadenceRpm: 90,
    heartRateBpm: hr,
    altitudeM: altitude(i),
    speedKmh: 28.8,
  }));
}

describe('chiffres d’une sortie', () => {
  it('moyenne, maximum et énergie', () => {
    const stats = rideStats(ride(100, (t) => (t < 50 ? 100 : 300)), 250);
    expect(stats.avgPowerW).toBeCloseTo(200);
    expect(stats.maxPowerW).toBe(300);
    expect(stats.energyKJ).toBeCloseTo(20);
  });
  it('compte le dénivelé en montée seulement', () => {
    const stats = rideStats(ride(10, () => 150, (t) => (t < 5 ? 100 + t * 2 : 110 - (t - 4) * 3)), 250);
    expect(stats.elevationGainM).toBeCloseTo(8);
  });
  it('donne la puissance normalisée, plus haute que la moyenne quand l’effort varie', () => {
    const steady = ride(300, () => 200);
    const surging = ride(300, (t) => (Math.floor(t / 30) % 2 ? 100 : 300));
    expect(normalizedPower(steady)).toBeCloseTo(200);
    expect(normalizedPower(surging)).toBeGreaterThan(rideStats(surging, 250).avgPowerW);
  });
  it('compte 100 de charge pour une heure à la FTP', () => {
    const stats = rideStats(ride(3600, () => 250), 250);
    expect(stats.intensityFactor).toBeCloseTo(1);
    expect(stats.tss).toBeCloseTo(100);
  });
  it('ignore le cardio absent et la cadence à zéro', () => {
    const stats = rideStats(ride(60, () => 100, undefined, null), 250);
    expect(stats.avgHeartRateBpm).toBeNull();
    expect(stats.maxHeartRateBpm).toBeNull();
    const coasting = ride(10, () => 0).map((s, i) => ({ ...s, cadenceRpm: i < 5 ? 80 : 0 }));
    expect(rideStats(coasting, 250).avgCadenceRpm).toBeCloseTo(80);
  });
  it('ne plante pas sur une sortie vide', () => {
    const stats = rideStats([], 250);
    expect(stats.avgPowerW).toBe(0);
    expect(stats.tss).toBeNull();
  });
});

describe('enregistrement de la sortie', () => {
  const samples = ride(3, (t) => 200 + t);
  const record = { name: "Alpe d'Huez & co", startedAt: Date.UTC(2026, 10, 1, 17, 30), elapsedS: 3, samples, stats: rideStats(samples, 250) };
  it('écrit un fichier TCX avec un point par seconde', () => {
    const xml = buildTcx(record);
    expect(xml).toContain('<Activity Sport="Biking">');
    expect(xml.match(/<Trackpoint>/g)).toHaveLength(3);
    expect(xml).toContain('<ns3:Watts>201</ns3:Watts>');
    expect(xml).toContain('<Time>2026-11-01T17:30:01.000Z</Time>');
    expect(xml).toContain('<DistanceMeters>24.0</DistanceMeters>');
  });
  it('protège les caractères spéciaux du nom', () => {
    expect(buildTcx(record)).toContain('Alpe d&apos;Huez &amp; co');
  });
  it('nomme le fichier d’après la date', () => {
    expect(rideFileName(new Date(2026, 10, 1, 8, 5).getTime())).toBe('sortie-2026-11-01-0805.tcx');
  });
});
