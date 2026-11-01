import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BROADLEAF_HEIGHT_M, broadleafCrown, broadleafTrunk, CONIFER_HEIGHT_M, coniferCrown, coniferTrunk } from '../src/world/treeGeometry';

const box = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};
const quads = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 12;

describe('arbres détaillés', () => {
  it('donne à un résineux des centaines de branches', () => {
    expect(quads(coniferCrown())).toBeGreaterThan(120);
  });
  it('donne à un feuillu des centaines de grappes', () => {
    expect(quads(broadleafCrown())).toBeGreaterThan(120);
  });
  it('resserre un résineux vers sa cime', () => {
    const p = coniferCrown().getAttribute('position');
    let low = 0;
    let high = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (p.getY(i) < 5) low = Math.max(low, r);
      if (p.getY(i) > 12) high = Math.max(high, r);
    }
    expect(low).toBeGreaterThan(high * 2);
  });
  it('respecte les hauteurs annoncées', () => {
    expect(box(coniferCrown()).max.y).toBeLessThan(CONIFER_HEIGHT_M + 0.2);
    expect(box(broadleafCrown()).max.y).toBeLessThan(BROADLEAF_HEIGHT_M + 1.5);
  });
  it('plante les troncs dans le sol', () => {
    expect(box(coniferTrunk()).min.y).toBeLessThan(0);
    expect(box(broadleafTrunk()).min.y).toBeLessThan(0);
  });
  it('génère toujours le même arbre pour une même graine', () => {
    const a = coniferCrown(5).getAttribute('position').array;
    const b = coniferCrown(5).getAttribute('position').array;
    expect(a).toEqual(b);
  });
  it('assombrit le coeur de l’arbre', () => {
    const c = coniferCrown().getAttribute('color');
    expect(c.getX(0)).toBeLessThan(c.getX(1));
  });
});
