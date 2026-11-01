import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findHairpinApexes, minRadius, roundTightBends } from '../scripts/roadGeometry.mjs';
import { findBacktracks, findDetours } from '../scripts/routeChecks.mjs';
import { gradeColor, gradeRgb, gradeTextColor } from '../src/sim/gradeColor';
import { Route, type RouteData } from '../src/sim/route';
import { CHECKPOINT_M, ghostOffset, type PersonalRecord, type PrStore, recordKey, SegmentTracker } from '../src/sim/segments';
import { isForestPixel } from '../src/world/landCover';
import { townName } from '../src/world/landmarks';

class MemoryStore implements PrStore {
  data = new Map<string, PersonalRecord>();
  load(id: string) {
    return this.data.get(id) ?? null;
  }
  save(id: string, r: PersonalRecord) {
    this.data.set(id, r);
  }
}

const SEG = { id: 's', name: 'Test', startM: 100, endM: 300 };

/** Roule à vitesse constante en renvoyant le tracker à la fin. */
function ride(store: PrStore, speed: number, untilM = 400) {
  const t = new SegmentTracker([SEG], store);
  const results = [];
  for (let time = 0, d = 0; d < untilM; time += 0.5, d += speed * 0.5) results.push(...t.update(d, time));
  return { tracker: t, results };
}

describe('échelle de pente', () => {
  it('est blanche sur le plat et en descente', () => {
    expect(gradeRgb(0)).toEqual([255, 255, 255]);
    expect(gradeRgb(-8)).toEqual([255, 255, 255]);
  });
  it('est noire aux pentes extrêmes', () => {
    expect(gradeRgb(15)).toEqual([0, 0, 0]);
    expect(gradeRgb(22)).toEqual([0, 0, 0]);
  });
  it('s’assombrit de façon continue', () => {
    const lum = (g: number) => gradeRgb(g).reduce((s, v) => s + v, 0);
    for (let g = 0; g < 15; g += 0.5) expect(lum(g + 0.5)).toBeLessThanOrEqual(lum(g));
  });
  it('choisit un texte lisible', () => {
    expect(gradeTextColor(0)).toBe('#0b0d10');
    expect(gradeTextColor(15)).toBe('#ffffff');
    expect(gradeColor(0)).toBe('rgb(255, 255, 255)');
  });
});

describe('segments', () => {
  it('enregistre un premier temps comme record', () => {
    const store = new MemoryStore();
    const { results } = ride(store, 10);
    expect(results).toHaveLength(1);
    expect(results[0].isNewPr).toBe(true);
    expect(results[0].timeS).toBeCloseTo(20, 1);
    expect(store.data.get('s')?.splits.length).toBe(200 / CHECKPOINT_M + 2);
  });
  it('n’écrase pas un record avec un temps moins bon', () => {
    const store = new MemoryStore();
    ride(store, 10);
    const { results } = ride(store, 5);
    expect(results[0].isNewPr).toBe(false);
    expect(store.data.get('s')?.timeS).toBeCloseTo(20, 1);
  });
  it('remplace le record avec un meilleur temps', () => {
    const store = new MemoryStore();
    ride(store, 5);
    const { results } = ride(store, 10);
    expect(results[0].isNewPr).toBe(true);
    expect(results[0].previousPrS).toBeCloseTo(40, 1);
  });
  it('calcule l’écart en direct à la position du cycliste', () => {
    const store = new MemoryStore();
    ride(store, 10);
    const t = new SegmentTracker([SEG], store);
    let time = 0;
    let d = 0;
    while (d < 200) {
      time += 0.1;
      d += 0.5; // 5 m/s : deux fois moins vite que le record
      t.update(d, time);
    }
    const s = t.status(d, time)[0];
    // 100 m dans le segment : 20 s contre 10 s pour le record.
    expect(s.gapS).toBeCloseTo(10, 0);
    expect(s.remainingM).toBeCloseTo(100, 3);
  });
  it('n’affiche pas d’écart sans record', () => {
    const t = new SegmentTracker([SEG], new MemoryStore());
    t.update(90, 9);
    t.update(150, 15);
    expect(t.status(150, 15)[0].gapS).toBeNull();
  });
  it('place le ghost à sa distance au même temps', () => {
    const rec: PersonalRecord = { timeS: 15, dateIso: '', splits: [0, 5, 10, 15] };
    expect(ghostOffset(rec, 7.5)).toBeCloseTo(1.5 * CHECKPOINT_M, 5);
    expect(ghostOffset(rec, 99)).toBe(3 * CHECKPOINT_M);
  });
  it('trie les segments du plus court au plus long', () => {
    const t = new SegmentTracker(
      [
        { id: 'long', name: 'L', startM: 0, endM: 1000 },
        { id: 'court', name: 'C', startM: 50, endM: 100 },
      ],
      new MemoryStore(),
    );
    t.update(0, 0);
    t.update(60, 6);
    expect(t.status(60, 6).map((s) => s.def.id)).toEqual(['court', 'long']);
  });
  it('détecte un franchissement entre deux pas de simulation', () => {
    const store = new MemoryStore();
    const t = new SegmentTracker([SEG], store);
    t.update(0, 0);
    t.update(500, 50); // grand pas : le segment est traversé d'un coup
    expect(store.data.get('s')?.timeS).toBeCloseTo(20, 5);
  });
});

describe('records par type de vélo', () => {
  it('garde les records de route existants', () => {
    expect(recordKey('alpe:Montée', 'route')).toBe('cols.pr.v2.alpe:Montée');
  });
  it('sépare chaque type de vélo', () => {
    expect(recordKey('alpe:Montée', 'clm')).not.toBe(recordKey('alpe:Montée', 'route'));
    expect(recordKey('alpe:Montée', 'vtt')).not.toBe(recordKey('alpe:Montée', 'clm'));
  });
});

describe('forêt sur la photo aérienne', () => {
  it('reconnaît un couvert sombre et vert', () => {
    expect(isForestPixel(38, 60, 36)).toBe(true);
    expect(isForestPixel(70, 88, 58)).toBe(true);
  });
  it('écarte prairies, roche, neige et lacs', () => {
    expect(isForestPixel(130, 150, 80)).toBe(false);
    expect(isForestPixel(150, 145, 135)).toBe(false);
    expect(isForestPixel(240, 242, 245)).toBe(false);
    expect(isForestPixel(30, 45, 70)).toBe(false);
  });
});

describe('panneaux de ville', () => {
  it('écrit le nom en capitales, accents compris', () => {
    expect(townName('Saint-Estève')).toBe('SAINT-ESTÈVE');
    expect(townName('Bédoin')).toBe('BÉDOIN');
  });
});

describe('données réelles des cols', () => {
  const ids = ['alpe-dhuez', 'ventoux', 'tourmalet', 'galibier', 'izoard', 'madeleine', 'aubisque'];
  const load = (id: string) =>
    new Route(JSON.parse(fs.readFileSync(`public/data/${id}/route.json`, 'utf8')) as RouteData);

  it.each(ids)('%s : conforme aux chiffres officiels', (id) => {
    const c = load(id).data.climb;
    expect(Math.abs(c.lengthKm - c.official.lengthKm)).toBeLessThan(1.2);
    expect(Math.abs(c.avgGradePct - c.official.avgGradePct)).toBeLessThan(0.8);
  });
  it.each(ids)('%s : commence par un échauffement en vallée', (id) => {
    const r = load(id);
    expect(r.data.footM).toBeGreaterThan(4000);
    expect(Math.abs(r.averageGrade(0, r.data.footM))).toBeLessThan(4); // plat ou faux-plat
  });
  it.each(ids)('%s : aucun virage ne replie la chaussée', (id) => {
    const { x, z } = load(id).data;
    // La chaussée fait 3 m de demi-largeur : l'axe doit toujours tourner plus large que cela.
    expect(minRadius(x, z)).toBeGreaterThan(3.5);
  });
  it('Alpe d’Huez : les 21 lacets sont ronds', () => {
    const r = load('alpe-dhuez').data;
    for (const h of r.hairpins) {
      const i = Math.round(h.distM / r.stepM);
      expect(minRadius(r.x.slice(i - 6, i + 7), r.z.slice(i - 6, i + 7))).toBeGreaterThan(5.5);
    }
  });
  it('évase une épingle sans toucher au reste du tracé', () => {
    const x: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < 40; i++) {
      x.push(i * 10);
      z.push(0);
    }
    for (let i = 39; i >= 0; i--) {
      x.push(i * 10);
      z.push(8);
    }
    const [apex] = findHairpinApexes(x, z, 9);
    // Une épingle se mesure à l'écart entre ses deux jambes juste avant le sommet.
    const gap = (px: number[], pz: number[]) => Math.hypot(px[apex - 3] - px[apex + 3], pz[apex - 3] - pz[apex + 3]);
    const before = gap(x, z);
    const r = roundTightBends(x, z, 9);
    expect(gap(r.x, r.z)).toBeGreaterThan(before + 1.5);
    expect(r.shift).toBeLessThan(12);
    expect(r.x[0]).toBe(0);
    expect(r.z[5]).toBe(0);
  });
  it.each(ids)('%s : la route continue après l’arrivée', (id) => {
    const r = load(id);
    expect(r.pathM - r.lengthM).toBeGreaterThan(150);
    expect(r.data.climb.topM).toBe(Math.round(r.eleAt(r.lengthM)));
  });
  it.each(ids)('%s : la route ne fait jamais d’aller-retour', (id) => {
    expect(findBacktracks(load(id).data)).toEqual([]);
  });
  it.each(ids)('%s : la route ne fait jamais de boucle sur elle-même', (id) => {
    expect(findDetours(load(id).data)).toEqual([]);
  });
  it('ne prend pas pour une boucle un lacet à pente douce, dont les jambes restent au même niveau', () => {
    const x: number[] = [];
    const z: number[] = [];
    for (let i = 0; i <= 15; i++) {
      x.push(i * 10);
      z.push(0);
    }
    for (let a = 1; a <= 4; a++) {
      const angle = (a / 5) * Math.PI;
      x.push(150 + 12 * Math.sin(angle));
      z.push(12 - 12 * Math.cos(angle));
    }
    for (let i = 15; i >= 0; i--) {
      x.push(i * 10);
      z.push(24);
    }
    expect(findDetours({ x, z, ele: new Array(x.length).fill(800), stepM: 10 })).toEqual([]);
  });
  it('détecte une boucle qui fait un tour complet avant de revenir', () => {
    const x: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < 6; i++) {
      x.push(i * 10 - 50);
      z.push(0);
    }
    const r = 41;
    for (let k = 1; k <= 26; k++) {
      const angle = (k / 26) * 2 * Math.PI;
      x.push(r * Math.sin(angle));
      z.push(r - r * Math.cos(angle));
    }
    for (let i = 1; i <= 8; i++) {
      x.push(i * 10);
      z.push(0);
    }
    expect(findDetours({ x, z, ele: new Array(x.length).fill(800), stepM: 10 }).length).toBeGreaterThan(0);
  });
  it('détecte un demi-tour court dans une rue de village', () => {
    const n = 44;
    const x = Array.from({ length: n }, (_, i) => (i < 22 ? i * 10 : (43 - i) * 10));
    const z = Array.from({ length: n }, (_, i) => (i < 22 ? 0 : 5));
    expect(findBacktracks({ x, z, ele: new Array(n).fill(1700), stepM: 10 }).length).toBeGreaterThan(0);
  });
  it('détecte un aller-retour sur le plat, mais pas un lacet qui monte', () => {
    const n = 120;
    const x = Array.from({ length: n }, (_, i) => (i < 60 ? i * 10 : (119 - i) * 10));
    const z = Array.from({ length: n }, (_, i) => (i < 60 ? 0 : 30));
    const flat = new Array(n).fill(700);
    expect(findBacktracks({ x, z, ele: flat, stepM: 10 }).length).toBe(1);
    const climbing = flat.map((e, i) => e + i);
    expect(findBacktracks({ x, z, ele: climbing, stepM: 10 })).toEqual([]);
  });
  it.each(ids)('%s : profil sans pic impossible', (id) => {
    const g = load(id).data.grade.map(Math.abs);
    expect(Math.max(...g)).toBeLessThan(16);
  });
  it('Alpe d’Huez : 21 lacets numérotés de 21 à 1 en montant', () => {
    const h = load('alpe-dhuez').data.hairpins;
    expect(h.map((v) => v.number)).toEqual(Array.from({ length: 21 }, (_, i) => 21 - i));
    for (let i = 1; i < h.length; i++) expect(h[i].ele).toBeGreaterThan(h[i - 1].ele);
  });
  it('Ventoux : le Chalet Reynard est à 6 km environ du sommet', () => {
    const r = load('ventoux');
    const p = r.data.pois.find((x) => x.name === 'Chalet Reynard')!;
    expect((r.lengthM - p.distM) / 1000).toBeGreaterThan(5.5);
    expect((r.lengthM - p.distM) / 1000).toBeLessThan(7);
    expect(p.offsetM).toBeLessThan(40);
  });
});

describe('interpolation du parcours', () => {
  const data = { stepM: 10, x: [0, 10, 20], z: [0, 0, 0], ele: [100, 101, 103], grade: [10, 15, 20], endM: 20 } as RouteData;
  const route = new Route(data);
  it('interpole altitude et pente', () => {
    expect(route.eleAt(5)).toBeCloseTo(100.5, 6);
    expect(route.gradeAt(15)).toBeCloseTo(17.5, 6);
  });
  it('reste borné aux extrémités', () => {
    expect(route.eleAt(-5)).toBe(100);
    expect(route.eleAt(99)).toBe(103);
  });
  it('suit une courbe sans angle aux points du tracé', () => {
    const bent = new Route({ stepM: 10, x: [0, 10, 20, 20, 20], z: [0, 0, 0, -10, -20], ele: [0, 0, 0, 0, 0], grade: [0, 0, 0, 0, 0], endM: 40 } as RouteData);
    // Sur une ligne brisée le passage serait à z = 0 pile ; la courbe arrondit l'angle.
    expect(bent.at(15).z).toBeGreaterThan(0.2);
    const before = bent.at(19.5).heading;
    const after = bent.at(20.5).heading;
    expect(Math.abs(after - before)).toBeLessThan(0.4); // 1 m plus loin, sur un angle droit
  });
  it('calcule la pente moyenne', () => {
    expect(route.averageGrade(0, 20)).toBeCloseTo(15, 6);
  });
});
