import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BuildingData, RouteData } from '../src/sim/route';
import { buildShell, insetRing, isBoxLike, projectOnRidge, ridgeOf, ringOf, signedArea } from '../src/world/buildingGeometry';

// Maison de 12 m sur 8, grand côté selon x.
const HOUSE: BuildingData = { p: [0, 0, 12, 0, 12, 8, 0, 8], h: 6, r: 3, k: 0 };

const maxY = (v: number[]) => Math.max(...v.filter((_, i) => i % 3 === 1));
const minY = (v: number[]) => Math.min(...v.filter((_, i) => i % 3 === 1));

describe('géométrie des bâtiments', () => {
  it('oriente le faîtage selon le grand côté, au milieu de la largeur', () => {
    const r = ridgeOf(ringOf(HOUSE));
    expect(Math.abs(r.a[1] - 4)).toBeLessThan(1e-6);
    expect(Math.abs(r.b[1] - 4)).toBeLessThan(1e-6);
    expect(Math.abs(r.a[0] - r.b[0])).toBeCloseTo(12, 6);
  });
  it('suit un bâtiment tourné', () => {
    const a = Math.PI / 5;
    const rot = (x: number, z: number) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
    const p = [rot(0, 0), rot(12, 0), rot(12, 8), rot(0, 8)].flat();
    const r = ridgeOf(ringOf({ ...HOUSE, p }));
    expect(Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1])).toBeCloseTo(12, 6);
  });
  it('borne la projection sur le faîtage', () => {
    const r = { a: [0, 0] as [number, number], b: [10, 0] as [number, number] };
    expect(projectOnRidge([-5, 3], r)).toEqual([0, 0]);
    expect(projectOnRidge([4, 3], r)).toEqual([4, 0]);
  });
  it('respecte les hauteurs mesurées : murs et faîtage', () => {
    const s = buildShell(HOUSE, 1000, 998, true);
    expect(maxY(s.walls)).toBe(1006);
    expect(minY(s.walls)).toBe(998);
    expect(maxY(s.roof)).toBe(1009);
    expect(minY(s.roof)).toBe(1006);
  });
  it('fait des pignons aux petits côtés et deux pans aux grands', () => {
    const s = buildShell(HOUSE, 0, -1, true);
    expect(s.gables.length / 9).toBe(2);
    expect(s.roof.length / 9).toBe(4);
  });
  it('fait un toit plat quand l’IGN le mesure plat', () => {
    const s = buildShell({ ...HOUSE, r: 0 }, 0, -1, false);
    expect(s.gables).toHaveLength(0);
    expect(s.roof.length / 9).toBe(2);
    expect(maxY(s.roof)).toBe(6);
  });
  it('garde une texture par sommet de mur', () => {
    const s = buildShell(HOUSE, 0, -1, true);
    expect(s.wallUv.length / 2).toBe(s.walls.length / 3);
  });
  it('n’affiche pas de fenêtres sur un hangar', () => {
    const s = buildShell(HOUSE, 0, -1, false);
    expect(new Set(s.wallUv)).toEqual(new Set([0.03]));
  });
});

describe('toits des emprises irrégulières', () => {
  // Bâtiment en L de 20 × 20 m, ailes de 8 m de large.
  const ELL: BuildingData = { p: [0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20], h: 6, r: 3, k: 0 };

  it('reconnaît un rectangle', () => {
    expect(isBoxLike(ringOf(HOUSE))).toBe(true);
  });
  it('reconnaît une emprise en L', () => {
    expect(isBoxLike(ringOf(ELL))).toBe(false);
  });
  it('ne dépasse jamais l’emprise du bâtiment avec un faîtage en L', () => {
    const s = buildShell(ELL, 0, -1, true);
    expect(s.gables).toHaveLength(0);
    // Le coin rentrant (8, 8) ne doit pas être enjambé : rien au-dessus de la zone vide.
    for (let i = 0; i < s.roof.length; i += 3) {
      const inVoid = s.roof[i] > 8.01 && s.roof[i + 2] > 8.01;
      expect(inVoid).toBe(false);
    }
  });
  it('fait une terrasse à la hauteur mesurée', () => {
    // Retrait de 2,4 m à la pente maximale : 2,64 m au-dessus des murs de 6 m.
    expect(maxY(buildShell(ELL, 0, -1, true).roof)).toBeCloseTo(8.64, 6);
  });
  it('décale l’emprise vers l’intérieur, dans les deux sens de parcours', () => {
    const ring = ringOf(HOUSE);
    const inner = insetRing(ring, 1)!;
    expect(Math.abs(signedArea(inner))).toBeCloseTo(10 * 6, 6);
    const back = insetRing([...ring].reverse(), 1)!;
    expect(Math.abs(signedArea(back))).toBeCloseTo(10 * 6, 6);
  });
  it('refuse un retrait plus large que le bâtiment', () => {
    expect(insetRing(ringOf(HOUSE), 5)).toBeNull();
  });
  it('retombe sur un toit plat si aucun retrait n’est possible', () => {
    const thin: BuildingData = { p: [0, 0, 20, 0, 20, 1, 1, 1, 1, 20, 0, 20], h: 6, r: 3, k: 0 };
    expect(maxY(buildShell(thin, 0, -1, true).roof)).toBe(6);
  });
  it('plafonne un toit exagéré par une cheminée ou une antenne', () => {
    const s = buildShell({ ...HOUSE, r: 14 }, 0, -1, true);
    expect(maxY(s.roof)).toBeLessThan(6 + 8 / 2 * 1.2);
  });
});

describe('bâtiments réels', () => {
  const load = (id: string) => ({
    route: JSON.parse(fs.readFileSync(`public/data/${id}/route.json`, 'utf8')) as RouteData,
    buildings: JSON.parse(fs.readFileSync(`public/data/${id}/buildings.json`, 'utf8')) as BuildingData[],
  });
  const ids = ['alpe-dhuez', 'ventoux', 'tourmalet', 'galibier', 'izoard', 'madeleine', 'aubisque'];
  const near = (b: BuildingData, x: number, z: number, r: number) =>
    Math.hypot(b.p[0] - x, b.p[1] - z) < r;

  it.each(ids)('%s : contient des centaines de bâtiments aux hauteurs plausibles', (id) => {
    const { buildings } = load(id);
    expect(buildings.length).toBeGreaterThan(500);
    const heights = buildings.map((b) => b.h).sort((a, c) => a - c);
    const median = heights[heights.length >> 1];
    expect(median).toBeGreaterThan(2);
    expect(median).toBeLessThan(12);
  });
  it.each(ids)('%s : aucun mur sur la chaussée', (id) => {
    const { route, buildings } = load(id);
    // Chaussée tramée au mètre, le long de la route et sur toute sa largeur utile.
    const road = new Set<string>();
    for (let i = 0; i + 1 < route.x.length; i++) {
      for (let t = 0; t < 1; t += 0.1) {
        const x = route.x[i] + (route.x[i + 1] - route.x[i]) * t;
        const z = route.z[i] + (route.z[i + 1] - route.z[i]) * t;
        for (let a = 0; a < 6.28; a += 0.5) {
          road.add(`${Math.round(x + Math.cos(a) * 2.2)}/${Math.round(z + Math.sin(a) * 2.2)}`);
        }
      }
    }
    let overlaps = 0;
    for (const b of buildings) {
      const ring = ringOf(b);
      ring.forEach(([ax, az], i) => {
        const [bx, bz] = ring[(i + 1) % ring.length];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az));
        for (let k = 0; k <= n; k++) {
          if (road.has(`${Math.round(ax + ((bx - ax) * k) / n)}/${Math.round(az + ((bz - az) * k) / n)}`)) overlaps++;
        }
      });
    }
    expect(overlaps).toBe(0);
  });
  // Tolérance (1,7 m) : le faîtage d'une emprise presque rectangulaire suit son rectangle, un peu plus
  // large qu'elle. Le défaut visé est la grande lame qui sortait des bâtiments irréguliers.
  it.each(ids)('%s : chaque toit reste au-dessus de son emprise', (id) => {
    const { buildings } = load(id);
    let outside = 0;
    for (const b of buildings) {
      const xs = b.p.filter((_, i) => i % 2 === 0);
      const zs = b.p.filter((_, i) => i % 2 === 1);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      const s = buildShell(b, 0, -1, true);
      for (let i = 0; i < s.roof.length; i += 3) {
        if (s.roof[i] < x0 - 1.7 || s.roof[i] > x1 + 1.7 || s.roof[i + 2] < z0 - 1.7 || s.roof[i + 2] > z1 + 1.7) outside++;
      }
    }
    expect(outside).toBe(0);
  });
  it('Ventoux : le bâtiment du Chalet Reynard existe à sa place', () => {
    const { route, buildings } = load('ventoux');
    const p = route.pois.find((x) => x.name === 'Chalet Reynard')!;
    expect(buildings.some((b) => near(b, p.x, p.z, 40))).toBe(true);
  });
  it('Ventoux : la tour IGN laisse la place au modèle de l’émetteur', () => {
    const { route, buildings } = load('ventoux');
    const p = route.pois.find((x) => x.type === 'tour')!;
    expect(buildings.filter((b) => b.h > 30 && near(b, p.x, p.z, 25))).toHaveLength(0);
  });
  it('Tourmalet : La Mongie est bien construite', () => {
    const { route, buildings } = load('tourmalet');
    const p = route.pois.find((x) => x.name === 'La Mongie')!;
    expect(buildings.filter((b) => near(b, p.x, p.z, 450)).length).toBeGreaterThan(30);
  });
});
