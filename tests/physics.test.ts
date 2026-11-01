import { describe, expect, it } from 'vitest';
import {
  airDensity,
  DEFAULT_SETUP,
  effectiveMass,
  gravity,
  PhysicsEngine,
  resistiveForces,
  steadyPower,
  steadySpeed,
  trainerCommand,
} from '../src/sim/physicsEngine';

const setup = { ...DEFAULT_SETUP, riderKg: 70, bikeKg: 8 };

describe('atmosphère et gravité', () => {
  it('donne la densité standard au niveau de la mer', () => {
    expect(airDensity(0)).toBeCloseTo(1.225, 2);
  });
  it('donne environ 1,007 kg/m³ à 2000 m (table ISA)', () => {
    expect(airDensity(2000)).toBeCloseTo(1.0066, 2);
  });
  it('donne environ 9,806 m/s² à 45° de latitude', () => {
    expect(gravity(45, 0)).toBeCloseTo(9.806, 3);
  });
  it('diminue la gravité avec l’altitude', () => {
    expect(gravity(45, 2000)).toBeLessThan(gravity(45, 0));
  });
});

describe('forces', () => {
  it('annule la gravité sur le plat', () => {
    expect(resistiveForces(10, 0, 0, setup).gravity).toBe(0);
  });
  it('utilise le sinus de la pente et non le pourcentage', () => {
    const f = resistiveForces(5, 10, 0, setup).gravity;
    expect(f).toBeCloseTo(78 * gravity(45, 0) * Math.sin(Math.atan(0.1)), 6);
  });
  it('rend la gravité motrice en descente', () => {
    expect(resistiveForces(10, -6, 0, setup).gravity).toBeLessThan(0);
  });
  it('réduit la traînée en altitude', () => {
    const low = resistiveForces(10, 0, 0, setup).aero;
    const high = resistiveForces(10, 0, 2600, setup).aero;
    expect(high / low).toBeCloseTo(airDensity(2600) / airDensity(0), 6);
  });
  it('compte l’inertie des roues dans la masse effective', () => {
    expect(effectiveMass(setup)).toBeGreaterThan(78);
    expect(effectiveMass(setup)).toBeLessThan(81);
  });
});

describe('ordres de grandeur réels', () => {
  it('250 W à plat donnent 33 à 38 km/h', () => {
    const kmh = steadySpeed(250, 0, 100, setup) * 3.6;
    expect(kmh).toBeGreaterThan(33);
    expect(kmh).toBeLessThan(38);
  });
  it('250 W à 8 % pour 78 kg donnent 11 à 14 km/h', () => {
    const kmh = steadySpeed(250, 8, 1200, setup) * 3.6;
    expect(kmh).toBeGreaterThan(11);
    expect(kmh).toBeLessThan(14);
  });
  it('un temps Alpe d’Huez cohérent : 13,8 km à 8,1 % à 300 W en moins d’une heure', () => {
    const v = steadySpeed(300, 8.1, 1300, setup);
    const minutes = 13800 / v / 60;
    expect(minutes).toBeGreaterThan(40);
    expect(minutes).toBeLessThan(60);
  });
  it('la puissance et la vitesse d’équilibre sont réciproques', () => {
    const v = steadySpeed(280, 5, 900, setup);
    expect(steadyPower(v, 5, 900, setup)).toBeCloseTo(280, 3);
  });
});

describe('intégration', () => {
  it('converge vers la vitesse d’équilibre', () => {
    const e = new PhysicsEngine(setup);
    for (let i = 0; i < 180; i++) e.advance(1, { powerW: 250, gradePct: 6, altitudeM: 1000 });
    expect(e.speedMps).toBeCloseTo(steadySpeed(250, 6, 1000, setup), 2);
  });
  it('ne donne pas un résultat dépendant du découpage du temps', () => {
    const a = new PhysicsEngine(setup);
    const b = new PhysicsEngine(setup);
    const input = { powerW: 300, gradePct: 4, altitudeM: 500 };
    for (let i = 0; i < 6000; i++) a.advance(0.01, input);
    for (let i = 0; i < 60; i++) b.advance(1, input);
    expect(a.distanceM).toBeCloseTo(b.distanceM, 1);
  });
  it('démarre à l’arrêt sans diverger', () => {
    const e = new PhysicsEngine(setup);
    e.advance(1, { powerW: 400, gradePct: 0, altitudeM: 0 });
    expect(e.speedMps).toBeGreaterThan(0);
    expect(e.speedMps).toBeLessThan(10);
  });
  it('ne recule jamais', () => {
    const e = new PhysicsEngine(setup);
    e.speedMps = 2;
    for (let i = 0; i < 30; i++) e.advance(1, { powerW: 0, gradePct: 12, altitudeM: 1500 });
    expect(e.speedMps).toBe(0);
  });
  it('accélère en roue libre dans une descente', () => {
    const e = new PhysicsEngine(setup);
    e.advance(5, { powerW: 0, gradePct: -7, altitudeM: 1000 });
    expect(e.speedMps).toBeGreaterThan(3);
  });
  it('garde son élan : la masse retarde l’arrivée à l’équilibre', () => {
    const e = new PhysicsEngine(setup);
    e.speedMps = 10;
    e.advance(1, { powerW: 200, gradePct: 8, altitudeM: 1000 });
    expect(e.speedMps).toBeGreaterThan(steadySpeed(200, 8, 1000, setup));
  });
});

describe('consigne home trainer', () => {
  it('applique la difficulté à la pente', () => {
    expect(trainerCommand(10, 0, setup, 0.5).gradePct).toBe(5);
  });
  it('fait baisser le coefficient aérodynamique en altitude', () => {
    expect(trainerCommand(5, 2600, setup, 1).cwKgPerM).toBeLessThan(trainerCommand(5, 300, setup, 1).cwKgPerM);
  });
  it('borne la pente envoyée', () => {
    expect(trainerCommand(35, 0, setup, 1).gradePct).toBe(20);
  });
});
