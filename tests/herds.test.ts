import { describe, expect, it } from 'vitest';
import { HERD_MIN_GAP_M, planHerds } from '../src/sim/herds';

describe('troupeaux des prairies', () => {
  const herds = planHerds(3100, 9100);

  it('place plusieurs troupeaux dans une prairie de 6 km', () => {
    expect(herds.length).toBeGreaterThanOrEqual(3);
    expect(herds.length).toBeLessThanOrEqual(5);
  });

  it('ne met jamais deux troupeaux proches', () => {
    for (let i = 1; i < herds.length; i++) expect(herds[i].distM - herds[i - 1].distM).toBeGreaterThanOrEqual(HERD_MIN_GAP_M);
  });

  it('alterne vaches et moutons', () => {
    for (let i = 1; i < herds.length; i++) expect(herds[i].kind).not.toBe(herds[i - 1].kind);
  });

  it('reste dans la prairie, loin de ses lisières', () => {
    for (const h of herds) {
      expect(h.distM).toBeGreaterThan(3100 + 400);
      expect(h.distM).toBeLessThan(9100 - 400);
    }
  });

  it('garde les bêtes à l\'écart de la chaussée, des deux côtés selon les troupeaux', () => {
    for (const h of herds) expect(h.offsetM).toBeGreaterThan(h.spreadM);
    for (const h of herds) expect([-1, 1]).toContain(h.side);
  });

  it('donne toujours les mêmes troupeaux', () => {
    expect(planHerds(3100, 9100)).toEqual(herds);
  });

  it('en met moins quand la prairie est courte, et aucun si elle est trop petite', () => {
    expect(planHerds(0, 2000).length).toBeLessThanOrEqual(1);
    expect(planHerds(0, 800)).toEqual([]);
  });
});
