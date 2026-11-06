import { describe, expect, it } from 'vitest';
import { habitatMix, habitatOfBiome } from '../src/world/soundscape';

describe('ambiance sonore', () => {
  it('donne à chaque milieu ses sons', () => {
    const plage = habitatMix([{ habitat: 'plage', weight: 1 }], 'jour', 'degage');
    expect(plage.surf).toBe(1);
    expect(plage.gulls).toBeGreaterThan(0.5);
    expect(plage.birds).toBe(0);
    const foret = habitatMix([{ habitat: 'foret', weight: 1 }], 'jour', 'degage');
    expect(foret.birds).toBe(1);
    expect(foret.leaves).toBeGreaterThan(0.5);
    expect(foret.surf).toBe(0);
    const montagne = habitatMix([{ habitat: 'haute-montagne', weight: 1 }], 'jour', 'degage');
    expect(montagne.wind).toBe(1);
    expect(montagne.birds).toBe(0);
  });

  it("fond deux milieux selon leur poids, quel que soit le total des poids", () => {
    const half = habitatMix([{ habitat: 'plage', weight: 1 }, { habitat: 'foret', weight: 1 }], 'jour', 'degage');
    expect(half.surf).toBeCloseTo(0.5);
    expect(half.birds).toBeCloseTo(0.5);
    const scaled = habitatMix([{ habitat: 'plage', weight: 4 }, { habitat: 'foret', weight: 4 }], 'jour', 'degage');
    expect(scaled.surf).toBeCloseTo(half.surf);
  });

  it('se tait sans milieu connu', () => {
    const none = habitatMix([], 'jour', 'degage');
    expect(Object.values(none).every((v) => v === 0)).toBe(true);
  });

  it('suit le moment et la météo', () => {
    const jour = habitatMix([{ habitat: 'prairie', weight: 1 }], 'jour', 'degage');
    const soir = habitatMix([{ habitat: 'prairie', weight: 1 }], 'soir', 'degage');
    expect(soir.crickets).toBeGreaterThan(jour.crickets);
    expect(soir.birds).toBeLessThan(jour.birds);
    const pluie = habitatMix([{ habitat: 'foret', weight: 1 }], 'jour', 'pluie');
    expect(pluie.rain).toBe(1);
    expect(pluie.birds).toBeLessThan(0.2);
  });

  it("traduit les étages d'un col en milieux", () => {
    expect(habitatOfBiome('vallée')).toBe('vallee');
    expect(habitatOfBiome('forêt')).toBe('foret');
    expect(habitatOfBiome('alpage')).toBe('alpage');
    expect(habitatOfBiome('haute montagne')).toBe('haute-montagne');
    expect(habitatOfBiome('desert')).toBe('desert');
  });
});
