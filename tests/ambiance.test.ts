import { describe, expect, it } from 'vitest';
import { ambianceLook, ambianceNow, isDynamic, momentAtHour, momentLookAtHour, weatherAt } from '../src/world/ambiance';

describe('météo qui change en roulant', () => {
  it('donne toujours le même ciel pour une même graine', () => {
    expect(weatherAt(42, 1500)).toEqual(weatherAt(42, 1500));
  });

  it('change de temps au fil de la sortie, sans jamais répéter le même', () => {
    const seen = new Set<string>();
    for (let t = 0; t < 4 * 3600; t += 30) {
      const w = weatherAt(7, t);
      expect(w.from === w.to && w.t > 0).toBe(false);
      seen.add(w.from);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('fond doucement un temps dans le suivant', () => {
    let previous = weatherAt(3, 0);
    for (let t = 1; t < 7200; t++) {
      const now = weatherAt(3, t);
      if (now.from === previous.from && now.to === previous.to) expect(Math.abs(now.t - previous.t)).toBeLessThan(0.05);
      previous = now;
    }
  });

  it('fait monter la pluie progressivement', () => {
    const rains: number[] = [];
    for (let t = 0; t < 4 * 3600; t += 10) rains.push(ambianceNow({ weather: 'variable', moment: 'jour' }, { hour: 12, elapsedS: t, seed: 5 }).look.rain);
    expect(Math.max(...rains)).toBe(1);
    const jumps = rains.slice(1).map((r, i) => Math.abs(r - rains[i]));
    expect(Math.max(...jumps)).toBeLessThan(0.3);
  });
});

describe('moment qui suit l\'heure réelle', () => {
  it('est nuit en pleine nuit, jour à midi', () => {
    expect(momentLookAtHour(2).night).toBe(1);
    expect(momentLookAtHour(12).night).toBe(0);
    expect(momentAtHour(2)).toBe('nuit');
    expect(momentAtHour(12)).toBe('jour');
    expect(momentAtHour(7.5)).toBe('matin');
    expect(momentAtHour(19.5)).toBe('soir');
  });

  it('s\'assombrit sans saut entre la fin du jour et la nuit', () => {
    let previous = momentLookAtHour(17.5).sunIntensity;
    for (let h = 17.5; h <= 21.5; h += 0.05) {
      const s = momentLookAtHour(h).sunIntensity;
      expect(Math.abs(s - previous)).toBeLessThan(0.2);
      previous = s;
    }
    expect(momentLookAtHour(21.5).sunIntensity).toBeLessThan(1);
  });

  it('garde les réglages fixes inchangés', () => {
    const look = ambianceLook({ weather: 'pluie', moment: 'jour' });
    expect(look.rain).toBe(1);
    expect(look.night).toBe(0);
    expect(isDynamic({ weather: 'pluie', moment: 'jour' })).toBe(false);
    expect(isDynamic({ weather: 'variable', moment: 'jour' })).toBe(true);
    expect(isDynamic({ weather: 'degage', moment: 'reel' })).toBe(true);
  });
});
