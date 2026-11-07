import { describe, expect, it } from 'vitest';
import { sanitizeStructures, structureLevel } from '../src/sim/structures';
import { loadRouteFile } from './helpers/routeFile';

describe('tunnels et ponts', () => {
  const tunnels = [{ fromM: 1000, toM: 1100 }];

  it('vaut 1 dedans et 0 loin', () => {
    expect(structureLevel(tunnels, 1050, 20)).toBe(1);
    expect(structureLevel(tunnels, 1000, 20)).toBe(1);
    expect(structureLevel(tunnels, 500, 20)).toBe(0);
    expect(structureLevel([], 1050, 20)).toBe(0);
  });

  it('monte et retombe en douceur aux abords', () => {
    expect(structureLevel(tunnels, 990, 20)).toBeCloseTo(0.5, 5);
    expect(structureLevel(tunnels, 1110, 20)).toBeCloseTo(0.5, 5);
    expect(structureLevel(tunnels, 970, 20)).toBe(0);
  });

  it('retient le tronçon le plus proche quand il y en a plusieurs', () => {
    const two = [{ fromM: 0, toM: 10 }, { fromM: 100, toM: 110 }];
    expect(structureLevel(two, 105, 20)).toBe(1);
    expect(structureLevel(two, 90, 20)).toBeCloseTo(0.5, 5);
  });

  it('ignore ce qui est mal formé', () => {
    expect(sanitizeStructures(null)).toEqual({ tunnels: [], bridges: [] });
    expect(sanitizeStructures({ tunnels: [{ fromM: 5, toM: 2 }, { fromM: 'a' }, { fromM: 1, toM: 9, name: 'T' }], bridges: 3 })).toEqual({
      tunnels: [{ fromM: 1, toM: 9, name: 'T' }],
      bridges: [],
    });
  });
});

describe('données OpenStreetMap des cols', () => {
  it('trouve les tunnels de l\'Izoard, dont les Roches Violettes', () => {
    const izoard = loadRouteFile('izoard');
    expect(izoard.tunnels.length).toBeGreaterThanOrEqual(3);
    expect(izoard.tunnels.some((t) => t.name?.includes('Roches Violettes'))).toBe(true);
  });

  it('garde chaque tronçon dans le parcours', () => {
    for (const id of ['alpe-dhuez', 'ventoux', 'tourmalet', 'galibier', 'izoard', 'madeleine', 'aubisque']) {
      const { tunnels, bridges, pathM } = loadRouteFile(id);
      for (const s of [...tunnels, ...bridges]) {
        expect(s.fromM).toBeGreaterThanOrEqual(0);
        expect(s.toM).toBeGreaterThan(s.fromM);
        expect(s.toM).toBeLessThanOrEqual(pathM);
      }
    }
  });
});
