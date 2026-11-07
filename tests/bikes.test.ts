import { describe, expect, it } from 'vitest';
import { ALL_BIKES, BIKE_KINDS, DEFAULT_BIKE_ID, findBike, setupFor, TEAMS } from '../src/sim/bikes';
import { DESIGNED_MODELS } from '../src/sim/bikeDesigns';
import { steadySpeed } from '../src/sim/physicsEngine';
import { frameLayout } from '../src/world/bikeModel';

const kmh = (id: string, watts: number, grade: number) => steadySpeed(watts, grade, 1000, setupFor(findBike(id), 75)) * 3.6;

describe('catalogue', () => {
  it('contient les 18 équipes WorldTour 2026', () => {
    expect(TEAMS).toHaveLength(18);
    expect(new Set(TEAMS.map((t) => t.id)).size).toBe(18);
  });
  it('donne à chaque équipe un vélo de route, et un seul vélo de contre-la-montre au total : le Trinity', () => {
    for (const t of TEAMS) expect(t.models.some((m) => m.kind !== 'clm')).toBe(true);
    const timeTrial = ALL_BIKES.filter((b) => b.shape === 'clm');
    expect(timeTrial.map((b) => b.id)).toEqual(['jayco:Trinity SL']);
  });
  it('a des identifiants uniques', () => {
    expect(new Set(ALL_BIKES.map((b) => b.id)).size).toBe(ALL_BIKES.length);
  });
  it('respecte le poids minimal UCI sur les vélos de route', () => {
    for (const k of Object.values(BIKE_KINDS)) expect(k.kg).toBeGreaterThanOrEqual(6.8);
  });
  it('retombe sur le vélo par défaut pour un identifiant inconnu', () => {
    expect(findBike('inconnu').id).toBe(DEFAULT_BIKE_ID);
  });
});

describe('silhouettes', () => {
  const design = (id: string) => findBike(id).design;

  it('ne décrit que des modèles du catalogue', () => {
    const names = TEAMS.flatMap((t) => t.models.map((m) => m.name));
    for (const name of DESIGNED_MODELS) expect(names).toContain(name);
  });
  it('donne des tubes plus profonds aux vélos aéro qu’aux grimpeurs', () => {
    expect(design('visma:S5').tubeDepth).toBeGreaterThan(design('visma:R5').tubeDepth * 1.5);
    expect(design('jayco:Trinity SL').tubeDepth).toBeGreaterThan(design('visma:S5').tubeDepth);
  });
  it('garde les traits reconnaissables des modèles', () => {
    expect(design('visma:S5').stem).toBe('v');
    expect(design('lidl:Madone SLR').splitSeatTube).toBe(true);
    expect(design('uae:Y1Rs').topTubeRearY).toBeLessThan(design('uae:V5Rs').topTubeRearY);
  });
  it('distingue les cadres d’une même équipe', () => {
    for (const t of TEAMS) {
      const bikes = ALL_BIKES.filter((b) => b.team === t).map((b) => JSON.stringify(b.design));
      expect(new Set(bikes).size).toBe(bikes.length);
    }
  });
  it('place les haubans plus bas sur un cadre à haubans plongeants', () => {
    const low = frameLayout(design('uae:Y1Rs'), 0.335);
    const high = frameLayout(design('visma:R5'), 0.335);
    expect(low.stay[1]).toBeLessThan(high.stay[1]);
    expect(low.seatTop[1]).toBeLessThan(high.seatTop[1]);
  });
});

describe('influence sur la vitesse', () => {
  const aero = 'visma:S5';
  const climber = 'visma:R5';
  const tt = 'jayco:Trinity SL';
  const mtb = 'generique:vtt-xc';
  const heavy = 'generique:vtt-enduro';

  it('sur le plat, le contre-la-montre gagne, puis l’aéro, puis le grimpeur', () => {
    expect(kmh(tt, 300, 0)).toBeGreaterThan(kmh(aero, 300, 0));
    expect(kmh(aero, 300, 0)).toBeGreaterThan(kmh(climber, 300, 0));
  });
  it('en col, le grimpeur devance l’aéro et le contre-la-montre', () => {
    expect(kmh(climber, 280, 9)).toBeGreaterThan(kmh(aero, 280, 9));
    expect(kmh(climber, 280, 9)).toBeGreaterThan(kmh(tt, 280, 9));
  });
  it('un VTT reste nettement derrière sur la route', () => {
    expect(kmh(mtb, 250, 0)).toBeLessThan(kmh(climber, 250, 0) - 4);
    expect(kmh(heavy, 250, 8)).toBeLessThan(kmh(mtb, 250, 8));
  });
  it('garde des ordres de grandeur réalistes', () => {
    expect(kmh(tt, 350, 0)).toBeGreaterThan(44);
    expect(kmh(tt, 350, 0)).toBeLessThan(56);
    expect(kmh(mtb, 200, 0)).toBeGreaterThan(24);
    expect(kmh(mtb, 200, 0)).toBeLessThan(33);
  });
  it('transmet le poids du cycliste et les valeurs du vélo', () => {
    const s = setupFor(findBike(mtb), 68);
    expect(s.riderKg).toBe(68);
    expect(s.bikeKg).toBe(10.8);
    expect(s.crr).toBe(0.0078);
  });
});
