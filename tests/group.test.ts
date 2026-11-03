import { describe, expect, it } from 'vitest';
import { GROUP_SIZES, GROUP_WARMUP_S, groupRiders } from '../src/sim/group';
import { Peloton, type PelotonRoute } from '../src/sim/peloton';
import { DEFAULT_SETUP, PhysicsEngine } from '../src/sim/physicsEngine';

const flat: PelotonRoute = { lengthM: 500000, gradeAt: () => 0, eleAt: () => 100 };
const climb: PelotonRoute = { lengthM: 500000, gradeAt: () => 8, eleAt: () => 1000 };

/** Fait rouler le joueur à puissance constante pendant `seconds` ; rend la distance parcourue. */
function rideUser(route: PelotonRoute, powerW: number, seconds: number, peloton?: Peloton): number {
  const user = new PhysicsEngine({ ...DEFAULT_SETUP });
  user.distanceM = 12;
  for (let t = 0; t < seconds; t += 0.5) {
    user.advance(0.5, { powerW, gradePct: route.gradeAt(user.distanceM), altitudeM: route.eleAt(user.distanceM) });
    peloton?.advance(0.5, { distM: user.distanceM, traveledM: user.distanceM, speedMps: user.speedMps });
  }
  return user.distanceM;
}

describe('composition du groupe', () => {
  it.each(GROUP_SIZES)('compte %i coureurs de noms distincts', (size) => {
    const riders = groupRiders({ riders: size, wkg: 3 });
    expect(riders).toHaveLength(size);
    expect(new Set(riders.map((r) => r.name)).size).toBe(size);
  });
  it('a des masses de 58 à 85 kg', () => {
    for (const r of groupRiders({ riders: 15, wkg: 3 })) {
      expect(r.massKg!).toBeGreaterThanOrEqual(58);
      expect(r.massKg!).toBeLessThanOrEqual(85);
    }
  });
  it('place les coureurs sur la largeur de la route, sans que deux soient au même endroit', () => {
    const riders = groupRiders({ riders: 15, wkg: 3 });
    const spots = new Set(riders.map((r) => `${r.lateralM}/${r.startOffsetM}`));
    expect(spots.size).toBe(15);
    for (const r of riders) expect(Math.abs(r.startOffsetM!)).toBeLessThanOrEqual(5);
  });
  it('ne développe, une fois calé, que les watts par kilo choisis à 5 % près, quelle que soit la masse', () => {
    for (const wkg of [2, 3.5, 5]) {
      for (const r of groupRiders({ riders: 15, wkg })) {
        let total = 0;
        let n = 0;
        for (let t = GROUP_WARMUP_S + 10; t < GROUP_WARMUP_S + 10 + 450; t += 1) {
          total += r.powerAt(t);
          n++;
        }
        expect(total / n / r.massKg!).toBeGreaterThan(wkg * 0.95);
        expect(total / n / r.massKg!).toBeLessThan(wkg * 1.05);
      }
    }
  });
});

describe('échauffement avec le joueur', () => {
  const build = (wkg: number) => new Peloton(flat, DEFAULT_SETUP, 250, 12, 12, groupRiders({ riders: 10, wkg }), GROUP_WARMUP_S);
  it.each([1.2, 4.5])('reste groupé autour du joueur à %s W/kg pendant les quinze minutes', (userWkg) => {
    const peloton = build(3.5);
    const user = rideUser(flat, userWkg * DEFAULT_SETUP.riderKg, GROUP_WARMUP_S - 5, peloton);
    for (const s of peloton.states()) expect(Math.abs(s.distM - user)).toBeLessThanOrEqual(5);
    const counts = peloton.counts(user);
    expect(counts.ahead + counts.behind).toBe(10);
  });
  it('se cale ensuite sur son niveau : il part devant si le joueur est plus lent', () => {
    const peloton = build(3.5);
    const user = rideUser(flat, 1.8 * DEFAULT_SETUP.riderKg, GROUP_WARMUP_S + 600, peloton);
    expect(peloton.counts(user).ahead).toBe(10);
  });
  it('se cale ensuite sur son niveau : le joueur plus fort le double', () => {
    const peloton = build(2.5);
    const user = rideUser(flat, 4.5 * DEFAULT_SETUP.riderKg, GROUP_WARMUP_S + 600, peloton);
    expect(peloton.counts(user)).toEqual({ ahead: 0, behind: 10 });
  });
});

describe('le groupe face au joueur', () => {
  it('part devant quand le joueur roule moins fort', () => {
    const peloton = new Peloton(flat, DEFAULT_SETUP, 250, 12, 12, groupRiders({ riders: 10, wkg: 3.5 }), GROUP_WARMUP_S);
    const user = rideUser(flat, 1.8 * DEFAULT_SETUP.riderKg, 25 * 60, peloton);
    expect(peloton.counts(user).ahead).toBe(10);
    expect(peloton.neighbours(user).ahead).not.toBeNull();
    expect(peloton.neighbours(user).behind).toBeNull();
  });
  it('est doublé quand le joueur roule plus fort', () => {
    const peloton = new Peloton(flat, DEFAULT_SETUP, 250, 12, 12, groupRiders({ riders: 10, wkg: 2.5 }), GROUP_WARMUP_S);
    const user = rideUser(flat, 4.5 * DEFAULT_SETUP.riderKg, 25 * 60, peloton);
    expect(peloton.counts(user)).toEqual({ ahead: 0, behind: 10 });
  });
  it('tient son niveau : à vitesse égale en montée, les coureurs restent groupés', () => {
    const peloton = new Peloton(climb, DEFAULT_SETUP, 250, 12, 12, groupRiders({ riders: 15, wkg: 3 }), GROUP_WARMUP_S);
    rideUser(climb, 100, GROUP_WARMUP_S + 600, peloton);
    const speeds = peloton.states().map((s) => s.speedKmh);
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeLessThan(1.15);
  });
  it('compte les coureurs devant et derrière', () => {
    const peloton = new Peloton(flat, DEFAULT_SETUP, 250, 12, 12, groupRiders({ riders: 15, wkg: 3 }), GROUP_WARMUP_S);
    const counts = peloton.counts(12);
    expect(counts.ahead + counts.behind).toBe(15);
  });
});
