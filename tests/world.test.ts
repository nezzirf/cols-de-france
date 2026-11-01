import { describe, expect, it } from 'vitest';
import { findBacktracks, findDetours } from '../scripts/routeChecks.mjs';
import { biomeWeights, dominant, pickZone, snowAmount, type WorldBiome } from '../src/sim/worldBiomes';
import { buildWorldRoute, worldLayout } from '../src/sim/worldRoute';

const layout = worldLayout();
const { world, loop } = layout;
const period = world.periodM;
const at = (m: number) => Math.round(m / 10);

/** Poids regroupés par biome : la plage de la fin du tour et celle du début ne font qu'un biome. */
function byBiome(x: number): Record<WorldBiome, number> {
  const w = biomeWeights(x, world);
  const out = { plage: 0, prairie: 0, foret: 0, montagne: 0, canyon: 0, desert: 0 };
  world.zones.forEach((z, k) => (out[z.biome] += w[k]));
  return out;
}

describe('biomes du monde d’entraînement', () => {
  it('compte six biomes, la plage ouvrant et fermant le tour', () => {
    expect(world.zones.map((z) => z.biome)).toEqual(['plage', 'prairie', 'foret', 'montagne', 'canyon', 'desert', 'plage']);
    expect(world.zones[0].fromM).toBe(loop.fromM);
    for (let i = 1; i < world.zones.length; i++) expect(world.zones[i].fromM).toBe(world.zones[i - 1].toM);
    expect(world.zones[6].toM).toBe(loop.toM);
  });
  it('espace les frontières de plus que la transition', () => {
    for (const z of world.zones) expect(z.toX - z.fromX).toBeGreaterThan(world.blendM);
  });
  it('donne des poids positifs de somme 1 sur toute la route', () => {
    const w: number[] = [];
    for (let x = -3000; x < 50000; x += 37) {
      biomeWeights(x, world, w);
      expect(w.every((v) => v >= -1e-9)).toBe(true);
      expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    }
  });
  it('est dans son biome au milieu de chaque zone', () => {
    world.zones.forEach((z, k) => {
      expect(dominant(biomeWeights((z.fromX + z.toX) / 2, world))).toBe(k);
      expect(biomeWeights((z.fromX + z.toX) / 2, world)[k]).toBeGreaterThan(0.99);
    });
  });
  it('mélange deux biomes à parts égales sur leur frontière', () => {
    const w = biomeWeights(world.zones[0].toX, world);
    expect(w[0]).toBeCloseTo(0.5, 6);
    expect(w[1]).toBeCloseTo(0.5, 6);
  });
  it('passe d’un biome à l’autre sans à-coup, y compris au raccord du tour', () => {
    let last = byBiome(-1000);
    for (let x = -990; x < period + 1500; x += 10) {
      const w = byBiome(x);
      for (const k of Object.keys(w) as WorldBiome[]) expect(Math.abs(w[k] - last[k])).toBeLessThan(0.012);
      last = w;
    }
  });
  it('se répète à l’identique d’un tour à l’autre', () => {
    for (let x = -2500; x < 2500; x += 53) {
      const a = biomeWeights(x, world);
      const b = biomeWeights(x + period, world);
      for (let k = 0; k < a.length; k++) expect(b[k]).toBeCloseTo(a[k], 9);
    }
  });
  it('choisit chaque biome selon son poids', () => {
    expect(pickZone([0.2, 0.8, 0], 0.1)).toBe(0);
    expect(pickZone([0.2, 0.8, 0], 0.3)).toBe(1);
    expect(pickZone([0.2, 0.8, 0], 0.999)).toBe(1);
  });
  it('enneige les hauteurs seulement', () => {
    expect(snowAmount(100, 0.5)).toBe(0);
    expect(snowAmount(1500, 0.5)).toBe(1);
    expect(snowAmount(800, 0.9)).toBeGreaterThan(snowAmount(800, 0.1));
  });
});

describe('boucle du monde d’entraînement', () => {
  it('fait 46 km, avec du tracé avant le départ et après l’arrivée', () => {
    expect(layout.lapM).toBe(46000);
    expect(loop.toM - loop.fromM).toBe(46000);
    expect(loop.fromM).toBeGreaterThanOrEqual(500);
    expect((layout.x.length - 1) * 10 - loop.toM).toBeGreaterThanOrEqual(1000);
  });
  it('revient exactement à son point de départ, à la même altitude et dans la même direction', () => {
    const a = at(loop.fromM);
    const b = at(loop.toM);
    expect(layout.ele[b]).toBeCloseTo(layout.ele[a], 1);
    expect(layout.z[b]).toBeCloseTo(layout.z[a], 1);
    expect(layout.x[b] - layout.x[a]).toBeCloseTo(period, 1);
    const heading = (i: number) => Math.atan2(layout.z[i + 1] - layout.z[i - 1], layout.x[i + 1] - layout.x[i - 1]);
    expect(heading(b)).toBeCloseTo(heading(a), 3);
    expect(layout.grade[b]).toBeCloseTo(layout.grade[a], 1);
  });
  it('prolonge le tracé après l’arrivée comme il se poursuit après le départ', () => {
    const a = at(loop.fromM);
    const b = at(loop.toM);
    for (let k = -50; k < 100; k++) {
      expect(layout.x[b + k] - period).toBeCloseTo(layout.x[a + k], 1);
      expect(layout.z[b + k]).toBeCloseTo(layout.z[a + k], 1);
      expect(layout.ele[b + k]).toBeCloseTo(layout.ele[a + k], 1);
    }
  });
  it('avance toujours vers l’est, sans aller-retour ni boucle sur elle-même', () => {
    for (let i = 1; i < layout.x.length; i++) expect(layout.x[i]).toBeGreaterThan(layout.x[i - 1]);
    const route = { x: layout.x, z: layout.z, ele: layout.ele, stepM: 10 };
    expect(findBacktracks(route)).toEqual([]);
    expect(findDetours(route)).toEqual([]);
  });
  it('reste praticable : pentes de moins de 13 %', () => {
    expect(Math.max(...layout.grade.map(Math.abs))).toBeLessThan(13);
  });
  it('part du niveau de la mer, grimpe en montagne et redescend à la mer', () => {
    const lap = layout.ele.slice(at(loop.fromM), at(loop.toM) + 1);
    expect(lap[0]).toBeLessThan(5);
    expect(Math.max(...lap)).toBeGreaterThan(1000);
    expect(Math.min(...lap)).toBeGreaterThan(1);
    const [, , , mountain] = world.zones;
    expect(layout.ele[at(mountain.toM)]).toBeGreaterThan(layout.ele[at(mountain.fromM)] + 400);
  });
  it('change de pente progressivement, sans à-coup', () => {
    // Un sommet inverse la pente, mais jamais d'un coup : pas plus de 0,15 point tous les 10 m.
    for (let i = 1; i < layout.grade.length; i++) expect(Math.abs(layout.grade[i] - layout.grade[i - 1])).toBeLessThan(0.15);
  });
});

describe('relief du monde d’entraînement', () => {
  const { route, heights } = buildWorldRoute();
  const t = route.data.terrain;
  const cell = (c: number, r: number) => heights[r * t.cols + c];
  /** Altitude interpolée entre les mailles, pour comparer deux abscisses qui ne tombent pas sur la grille. */
  const height = (x: number, z: number) => {
    const fx = (x - t.x0) / t.stepM;
    const fz = (z - t.z0) / t.stepM;
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const u = fx - c;
    const v = fz - r;
    return (cell(c, r) * (1 - u) + cell(c + 1, r) * u) * (1 - v) + (cell(c, r + 1) * (1 - u) + cell(c + 1, r + 1) * u) * v;
  };

  it('couvre toute la grille de valeurs finies', () => {
    expect(heights.length).toBe(t.cols * t.rows);
    expect(heights.every(Number.isFinite)).toBe(true);
  });
  it('est le même au début et à la fin du tour, de part et d’autre du raccord', () => {
    let worst = 0;
    for (let x = -1500; x < 1500; x += 70) {
      for (let z = t.z0 + 100; z < t.z0 + (t.rows - 6) * t.stepM; z += 130) {
        worst = Math.max(worst, Math.abs(height(x, z) - height(x + period, z)));
      }
    }
    // Les deux abscisses ne tombent pas sur les mêmes mailles : l'interpolation seule explique l'écart.
    expect(worst).toBeLessThan(2.5);
  });
  it('ne creuse la mer qu’autour du raccord', () => {
    let near = 0;
    let far = 0;
    for (let r = 0; r < t.rows; r++) {
      for (let c = 0; c < t.cols; c++) {
        const x = t.x0 + c * t.stepM;
        const wx = x - period * Math.floor(x / period);
        const fromSeam = Math.min(wx, period - wx);
        if (cell(c, r) < 0) {
          if (fromSeam < 3500) near++;
          else far++;
        }
      }
    }
    expect(near).toBeGreaterThan(3000);
    expect(far).toBe(0);
  });
  it('garde la route au-dessus de la mer', () => {
    expect(Math.min(...layout.ele)).toBeGreaterThan(1);
  });
  it('n’a pas de falaise cachée entre deux mailles voisines', () => {
    let steepest = 0;
    for (let r = 0; r < t.rows; r++) {
      for (let c = 1; c < t.cols; c++) steepest = Math.max(steepest, Math.abs(cell(c, r) - cell(c - 1, r)));
    }
    // Au plus 55 m sur 20 m, aux falaises du canyon et aux crêtes de la montagne : raide, jamais vertical.
    expect(steepest).toBeLessThan(55);
  });
  it('monte de part et d’autre de la route en montagne, pour fermer la vallée', () => {
    const m = world.zones[3];
    const i = at((m.fromM + m.toM) / 2);
    expect(height(layout.x[i], layout.z[i] + 1500)).toBeGreaterThan(layout.ele[i] + 300);
    expect(height(layout.x[i], layout.z[i] - 1500)).toBeGreaterThan(layout.ele[i] + 300);
  });
});
