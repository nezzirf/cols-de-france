import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Route, type RouteData } from '../src/sim/route';
import { HeightField } from '../src/world/heightField';
import * as THREE from 'three';
import { ribbon, shoulderDrop, stations, talusOffset } from '../src/world/road';

// Deux jambes de lacet parallèles, à 80 m l'une de l'autre et 30 m de dénivelé.
function hairpinLegs(): { route: Route; raw: Float32Array } {
  const x: number[] = [];
  const z: number[] = [];
  const ele: number[] = [];
  for (let i = 0; i <= 40; i++) {
    x.push(i * 10);
    z.push(0);
    ele.push(1000);
  }
  for (let i = 0; i <= 40; i++) {
    x.push((40 - i) * 10);
    z.push(80);
    ele.push(1030);
  }
  const terrain = { file: '', cols: 41, rows: 16, stepM: 20, x0: -200 + 200, z0: -60, scale: 1 };
  const route = new Route({ stepM: 10, x, z, ele, grade: x.map(() => 0), endM: (x.length - 1) * 10, terrain } as unknown as RouteData);
  return { route, raw: new Float32Array(41 * 16).fill(1015) };
}

/** Part des cellules du couloir de route assez raides pour s'afficher en roche. */
function steepShare(field: HeightField, t: RouteData['terrain']): number {
  const h = field.heights;
  let steep = 0;
  let total = 0;
  for (let r = 1; r < t.rows - 1; r++) {
    for (let c = 1; c < t.cols - 1; c++) {
      const k = r * t.cols + c;
      if (field.roadDistance[k] >= 55) continue;
      total++;
      if (Math.hypot(h[k + 1] - h[k - 1], h[k + t.cols] - h[k - t.cols]) / (2 * t.stepM) > 0.95) steep++;
    }
  }
  return steep / total;
}

function loadField(id: string): { route: Route; field: HeightField } {
  const d = JSON.parse(fs.readFileSync(`public/data/${id}/route.json`, 'utf8')) as RouteData;
  const bin = fs.readFileSync(`public/data/${id}/terrain.bin`);
  const u = new Uint16Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
  const raw = Float32Array.from(u, (v) => v * d.terrain.scale);
  const route = new Route(d);
  return { route, field: new HeightField(route, raw) };
}

describe('la route touche le sol', () => {
  const ids = ['alpe-dhuez', 'ventoux', 'tourmalet', 'galibier', 'izoard'];
  it.each(ids)('%s : le relief ne recouvre jamais la route', (id) => {
    const { route, field } = loadField(id);
    let covered = 0;
    let worst = 0;
    for (let d = 0; d < route.pathM; d += 3) {
      const p = route.at(d);
      for (const lateral of [0, 3, -3]) {
        const x = p.x + Math.cos(p.heading) * lateral;
        const z = p.z + Math.sin(p.heading) * lateral;
        const above = field.height(x, z) - p.ele;
        if (above > 0) covered++;
        worst = Math.max(worst, above);
      }
    }
    expect({ covered, worst: Math.round(worst * 10) / 10 }).toEqual({ covered: 0, worst: 0 });
  });
  it.each(['alpe-dhuez', 'galibier', 'izoard'])('%s : aucune paroi ne recouvre une route en contrebas', (id) => {
    const { route } = loadField(id);
    let covered = 0;
    for (const [i, s] of stations(route).entries()) {
      if (i % 5) continue;
      for (const sign of [-1, 1]) {
        const room = sign > 0 ? s.rightRoom : s.leftRoom;
        const radius = sign > 0 ? s.rightRadius : s.leftRadius;
        for (let wanted = 6; wanted <= 26; wanted += 4) {
          const o = talusOffset(sign * wanted, radius, room);
          // Paroi réduite à zéro : il ne reste que l'accotement, là où deux routes se frôlent.
          if (Math.abs(o) <= 4.6) continue;
          const n = route.nearest(s.x + s.nx * o, s.z + s.nz * o);
          // Le point de paroi tombe sur une chaussée, et il la domine.
          if (n.offsetM < 3 && s.ele + shoulderDrop(wanted) > route.eleAt(n.distM) + 0.5) covered++;
        }
      }
    }
    expect(covered).toBe(0);
  }, 30000);
  it.each(ids)('%s : pas de vide entre la route et le bas-côté', (id) => {
    const { route, field } = loadField(id);
    const { x: rx, z: rz, ele, stepM } = route.data;
    const aboveAnotherLeg = (x: number, z: number, d: number, level: number): boolean => {
      for (let i = 0; i < rx.length; i += 2) {
        if (Math.abs(i * stepM - d) >= 120 && ele[i] < level - 3 && Math.hypot(rx[i] - x, rz[i] - z) < 60) return true;
      }
      return false;
    };
    let points = 0;
    let perched = 0;
    let worst = 0;
    for (let d = 0; d < route.pathM; d += 5) {
      const p = route.at(d);
      for (const side of [-1, 1]) {
        const x = p.x + Math.cos(p.heading) * side * 5;
        const z = p.z + Math.sin(p.heading) * side * 5;
        const gap = p.ele - 0.4 - field.height(x, z);
        points++;
        worst = Math.max(worst, gap);
        // Au-dessus d'une autre jambe de lacet, seul un mur de soutènement a la place.
        // Le premier pan du talus descend de 3,4 m : au-delà de 4 m, c'est le pan raide qui se voit.
        if (gap > 4 && !aboveAnotherLeg(x, z, d, p.ele)) perched++;
      }
    }
    // Une route en remblai reste possible, le talus la couvre : ce qui compte est qu'elle reste rare.
    expect(perched / points).toBeLessThan(0.03);
    // Le talus et le mur descendent à 28 m : aucun vide ne doit pouvoir passer dessous.
    expect(worst).toBeLessThan(27);
  });
});

describe('faces de la route et des parois', () => {
  const route = new Route({
    stepM: 10,
    x: Array.from({ length: 30 }, (_, i) => i * 10),
    z: new Array(30).fill(0),
    ele: new Array(30).fill(1000),
    grade: new Array(30).fill(0),
    endM: 290,
  } as RouteData);

  it('tourne la chaussée vers le ciel, pour ne jamais montrer son dessous', () => {
    const g = ribbon(stations(route), [
      { o: -3, y: 0 },
      { o: 3, y: 0 },
    ]);
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    expect(n.getY(20)).toBeGreaterThan(0.99);
  });
  it.each([1, -1])('tourne la paroi vers l’extérieur et vers le haut (côté %i)', (sign) => {
    const rows = [
      { o: sign * 5, y: -0.4 },
      { o: sign * 27, y: -28 },
    ];
    const g = ribbon(stations(route), sign > 0 ? rows : rows.reverse());
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    expect(n.getY(20)).toBeGreaterThan(0);
    expect(Math.sign(n.getZ(20))).toBe(sign);
  });
});

describe('profil en travers de la route', () => {
  it('est plat sur la chaussée', () => {
    expect(shoulderDrop(2)).toBe(0);
    expect(shoulderDrop(-3)).toBe(0);
  });
  it('descend le long du talus, des deux côtés', () => {
    expect(shoulderDrop(6.5)).toBeLessThan(-0.4);
    expect(shoulderDrop(-6.5)).toBe(shoulderDrop(6.5));
  });
  it('resserre le talus en mur dans un virage serré, sans toucher à la chaussée', () => {
    expect(talusOffset(3, 9)).toBe(3);
    expect(talusOffset(26.6, 1000)).toBeCloseTo(26.6, 6);
    expect(talusOffset(26.6, 9)).toBeLessThan(7);
    expect(talusOffset(-26.6, 9)).toBeGreaterThan(-7);
    // Assez étroit pour ne jamais atteindre le centre d'une épingle de 9 m de rayon.
    expect(talusOffset(26.6, 9)).toBeLessThan(9);
  });
  it('resserre aussi le talus quand une autre route passe en contrebas', () => {
    expect(talusOffset(26.6, 1000, 12)).toBeLessThanOrEqual(12);
    expect(talusOffset(-26.6, 1000, 12)).toBeGreaterThanOrEqual(-12);
    expect(talusOffset(26.6, 1000, 2)).toBeCloseTo(4.6, 6);
  });
  it('laisse la place au relief au-delà du talus', () => {
    expect(shoulderDrop(40)).toBe(-Infinity);
  });
});

describe('relief creusé autour de la route', () => {
  it('Alpe d’Huez : étale les talus étroits, source des dents de scie vues du ciel', () => {
    const d = JSON.parse(fs.readFileSync('public/data/alpe-dhuez/route.json', 'utf8')) as RouteData;
    const bin = fs.readFileSync('public/data/alpe-dhuez/terrain.bin');
    const u = new Uint16Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
    const raw = Float32Array.from(u, (v) => v * d.terrain.scale);
    const before = steepShare(new HeightField(new Route(d), raw, 0), d.terrain);
    const after = steepShare(new HeightField(new Route(d), raw), d.terrain);
    expect(after).toBeLessThan(before * 0.75);
  });
  it('passe sous les deux jambes d’un lacet', () => {
    const { route, raw } = hairpinLegs();
    const f = new HeightField(route, raw);
    expect(f.height(200, 0)).toBeLessThan(1000);
    expect(f.height(200, 80)).toBeLessThan(1030);
  });
  it('ne crée pas de falaise entre les deux jambes', () => {
    const { route, raw } = hairpinLegs();
    const f = new HeightField(route, raw);
    let steepest = 0;
    for (let z = 0; z < 80; z += 20) {
      steepest = Math.max(steepest, Math.abs(f.height(200, z + 20) - f.height(200, z)));
    }
    // 30 m de dénivelé sur 80 m : aucune marche ne doit en concentrer la majeure partie.
    expect(steepest).toBeLessThan(15);
  });
  it('laisse le relief réel intact loin de la route', () => {
    const { route, raw } = hairpinLegs();
    const f = new HeightField(route, raw);
    expect(f.height(200, 200)).toBe(1015);
  });
});
