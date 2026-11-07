import { describe, expect, it } from 'vitest';
import { CROWD_ZONE_M, crowdDensityAt, hasCrowd, planCrowd } from '../src/sim/crowd';

describe('public des grands cols', () => {
  const end = 15000;
  const plan = planCrowd(end);

  it('reste dans les derniers kilomètres', () => {
    for (const s of plan.spectators) {
      expect(s.distM).toBeGreaterThan(end - CROWD_ZONE_M - 5);
      expect(s.distM).toBeLessThan(end);
    }
  });

  it('se resserre vers le sommet', () => {
    const count = (from: number, to: number) => plan.spectators.filter((s) => end - s.distM >= from && end - s.distM < to).length;
    expect(count(0, 500)).toBeGreaterThan(count(3000, 3500) * 3);
    expect(plan.spectators.length).toBeGreaterThan(200);
    expect(plan.spectators.length).toBeLessThan(1500);
  });

  it('garde les spectateurs hors de la chaussée', () => {
    for (const s of plan.spectators) expect(s.offsetM).toBeGreaterThan(4);
  });

  it('place des banderoles et la flamme rouge à un kilomètre', () => {
    expect(plan.banners.length).toBeGreaterThanOrEqual(10);
    expect(plan.arches.map((a) => a.distM)).toContain(end - 1000);
  });

  it('donne toujours le même public', () => {
    expect(planCrowd(end)).toEqual(plan);
  });

  it('a une densité nulle loin du sommet et pleine au bout', () => {
    expect(crowdDensityAt(end - 6000, end)).toBe(0);
    expect(crowdDensityAt(end - 50, end)).toBe(1);
    expect(crowdDensityAt(end - 2000, end)).toBeGreaterThan(0);
    expect(crowdDensityAt(end - 2000, end)).toBeLessThan(crowdDensityAt(end - 500, end));
    expect(crowdDensityAt(end + 200, end)).toBe(0);
  });

  it('concerne les vrais cols, ni le monde d\'entraînement ni les boucles', () => {
    expect(hasCrowd({ climb: { lengthKm: 20 } })).toBe(true);
    expect(hasCrowd({ climb: { lengthKm: 20 }, world: {} })).toBe(false);
    expect(hasCrowd({ climb: { lengthKm: 20 }, loop: {} })).toBe(false);
    expect(hasCrowd({ climb: { lengthKm: 1 } })).toBe(false);
  });
});
